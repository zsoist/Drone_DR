"""AeroBrain worker — ejecuta los jobs pesados (ODM 3D, OpenSplat) FUERA del server.

Arquitectura: el server web sólo ENCOLA (status=queued) en el SQLite de jobs;
este proceso los reclama atómicamente y los ejecuta. Reiniciar el server web ya
no mata una fotogrametría de 40 minutos — cada proceso marca huérfanos sólo de
los kinds que le pertenecen (server=light, worker=heavy).

Corre como launchd: com.aerobrain.worker (KeepAlive).
Cancel sigue funcionando: /api/job_cancel marca el status y mata pid/container;
run_tracked (compartido) detecta el cambio y corta la secuencia.
"""
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import jobs as jobstore

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

VAULT = Path("/Volumes/SSD/drone-vault")
PIPE = Path(__file__).resolve().parent
SPLAT_ROOT = PIPE.parent / "splat" / "OpenSplat"
SPLAT_CPU_BIN = SPLAT_ROOT / "build" / "opensplat"
SPLAT_MPS_BIN = SPLAT_ROOT / "build-mps" / "opensplat"
LIBTORCH_LIB = PIPE.parent / "splat" / "libtorch" / "lib"
DOCKER = "/usr/local/bin/docker"
POLL_S = 3


def rebuild_index():
    subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)


def browser_gate(jid: str, kind: str, cid: str, timeout: int = 75):
    jobstore.update(jid, detail=f"verificando {kind} en navegador", stage="browser-qa", progress=0.97)
    # el timeout del gate (página) va explícito; el del subprocess deja margen para Chrome
    if jobstore.run_tracked(jid, ["python3", str(PIPE / "browser_gate.py"), kind, cid,
                                  "--timeout", str(timeout)],
                            timeout=timeout + 30) != 0:
        raise RuntimeError(f"browser gate falló para {kind} {cid}")


def export_ksplat(splat_path: Path) -> Path | None:
    """Exporta <cid>.ksplat junto al .splat publicado (carga más rápida en el viewer).

    No fatal: si node o la conversión fallan, el .splat sigue siendo el asset servible.
    Escritura atómica (tmp + os.replace) para que el viewer nunca vea un .ksplat a medias.
    """
    out = splat_path.with_suffix(".ksplat")
    tmp = splat_path.with_suffix(".ksplat.tmp")
    try:
        r = subprocess.run(["node", str(PIPE / "make_ksplat.mjs"), str(splat_path), str(tmp)],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 1024:
            raise RuntimeError((r.stderr or r.stdout or "sin salida")[-200:])
        os.replace(tmp, out)
        return out
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"  ksplat export falló (no fatal): {e}", flush=True)
        return None


def _cancelled(jid: str) -> bool:
    return (jobstore.get(jid) or {}).get("status") in jobstore.CANCEL_STATES


# presets de calidad ODM: mismo pipeline completo (dense+mesh+DSM), distinto trade-off
PRESETS = {
    "rapido":   {"eta": "~25-40 min", "timeout": 2 * 3600,
                 "args": ["--pc-quality", "low", "--feature-quality", "medium",
                          "--orthophoto-resolution", "8", "--dem-resolution", "15"]},
    "estandar": {"eta": "~45-75 min", "timeout": 3 * 3600,
                 "args": ["--pc-quality", "medium", "--feature-quality", "medium",
                          "--orthophoto-resolution", "5", "--dem-resolution", "10"]},
    # alta: pc-quality high (ultra = 8.5x tiempo, no vale en M4 16GB — community ODM);
    # mesh-size 300k = recomendación urbana oficial para edificios/techos (default 200k)
    "alta":     {"eta": "~2-4 h", "timeout": 6 * 3600,
                 "args": ["--pc-quality", "high", "--feature-quality", "high",
                          "--orthophoto-resolution", "3", "--dem-resolution", "5",
                          "--mesh-size", "300000", "--pc-copc"]},
}


def publish_splat_stage(stage: Path, cid: str, quality: dict, splat_dir: Path | None = None) -> Path:
    """Atomically promote a staged OpenSplat output to the public vault.

    Training writes into splats/.training/<job>. Only a passed quality gate may
    replace splats/<cid>.splat, so killed/restarted jobs cannot corrupt the last
    known-good public splat.
    """
    splat_dir = splat_dir or (VAULT / "splats")
    tmp_out = stage / f"{cid}.splat"
    tmp_meta = stage / f"{cid}.meta.json"
    final_out = splat_dir / f"{cid}.splat"
    if not quality.get("passed"):
        raise RuntimeError(quality.get("reason") or "splat no pasó el quality gate")
    splat_dir.mkdir(parents=True, exist_ok=True)
    tmp_meta.write_text(json.dumps(quality, indent=1))
    os.replace(tmp_out, final_out)
    os.replace(tmp_meta, splat_dir / f"{cid}.meta.json")
    cam = stage / "cameras.json"
    if cam.exists():
        os.replace(cam, splat_dir / f"{cid}.cameras.json")
    shutil.rmtree(stage, ignore_errors=True)
    return final_out


def opensplat_runtime(bin_path: Path) -> str:
    """Return the CMake GPU runtime for an OpenSplat binary, if discoverable."""
    cache = bin_path.parent / "CMakeCache.txt"
    if not bin_path.exists() or not cache.exists():
        return "missing"
    for line in cache.read_text(errors="ignore").splitlines():
        if line.startswith("GPU_RUNTIME:"):
            return line.rsplit("=", 1)[-1].strip() or "CPU"
    return "unknown"


def metal_toolchain_available() -> bool:
    try:
        return subprocess.run(["xcrun", "--find", "metal"], capture_output=True,
                              timeout=5).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def choose_splat_backend(iters: int, force_cpu: bool = False, mps_ready: bool | None = None,
                         mps_bin: Path = SPLAT_MPS_BIN, cpu_bin: Path = SPLAT_CPU_BIN) -> dict:
    """Select the strongest local OpenSplat backend without losing CPU fallback.

    OpenSplat uses GPU automatically when built with MPS; passing --cpu disables
    that path. The current stable binary is CPU-only, while build-mps/ is the
    safe slot for a Metal build. Keeping both lets us upgrade quality without
    breaking the known-good CPU trainer.
    """
    if mps_ready is None:
        mps_ready = opensplat_runtime(mps_bin) == "MPS" and metal_toolchain_available()
    if not force_cpu and mps_ready:
        return {"bin": mps_bin, "device": "Metal/MPS", "cpu_flag": False,
                "note": f"{iters} iters aceleradas por GPU local"}
    runtime = opensplat_runtime(cpu_bin)
    return {"bin": cpu_bin, "device": "CPU", "cpu_flag": True,
            "note": f"{iters} iters en CPU fallback ({runtime})"}


def opensplat_train_cmd(project: Path, out: Path, iters: int, backend: dict) -> list[str]:
    # taskpolicy -c utility: QoS bajo para que 4h de entrenamiento CPU no roben fluidez
    # a la UI/web (taskpolicy hace exec — mismo pid, el cancel del jobstore sigue funcionando)
    cmd = ["/usr/sbin/taskpolicy", "-c", "utility", str(backend["bin"]), str(project)]
    if backend.get("cpu_flag"):
        cmd.append("--cpu")
    cmd += ["-n", str(iters), "-o", str(out), "--sh-degree-interval", str(iters + 1)]
    return cmd


def run_3d(j: dict):
    cid = j["spec"]["clip_id"]
    preset = PRESETS.get(j["spec"].get("preset", "estandar"), PRESETS["estandar"])
    proj = VAULT / "odm" / f"proj_{cid}"
    container = f"odm-{j['id']}"
    jobstore.update(j["id"], container=container)

    frame_profile = {"rapido": "preview", "estandar": "balanced", "alta": "premium"}[
        j["spec"].get("preset", "estandar") if j["spec"].get("preset", "estandar") in
        ("rapido", "estandar", "alta") else "estandar"]
    jobstore.update(j["id"], detail="1/3 frames + geotag + selección adaptativa",
                    stage="frames", progress=0.05)
    if jobstore.run_tracked(j["id"], ["python3", str(PIPE / "odm_prep.py"), cid,
                                      "--profile", frame_profile],
                            timeout=1800) != 0:
        raise RuntimeError("odm_prep falló")

    jobstore.update(j["id"], detail=f"2/3 fotogrametría ODM ({preset['eta']})",
                    stage="odm", progress=0.15)
    if jobstore.run_tracked(j["id"],
            [DOCKER, "run", "--rm", "--name", container,
             "-m", "7g", "-v", f"{proj}:/datasets/code", "opendronemap/odm",
             "--project-path", "/datasets", "--max-concurrency", "4",
             "--dsm", "--dtm", "--skip-report", *preset["args"]],
            timeout=preset["timeout"]) != 0:
        raise RuntimeError("ODM falló")

    jobstore.update(j["id"], detail="3/3 publicando assets web", stage="publish", progress=0.9)
    if jobstore.run_tracked(j["id"],
            ["python3", str(PIPE / "tresd_publish.py"), cid, str(proj)],
            timeout=1800) != 0:
        raise RuntimeError("publicación falló")

    # graba preset + título elegidos en el asistente (la UI los muestra en tarjeta/reporte)
    mf = VAULT / "models" / cid / "meta.json"
    if mf.exists():
        m = json.loads(mf.read_text())
        m["preset"] = j["spec"].get("preset", "estandar")
        if j["spec"].get("title"):
            m["title"] = j["spec"]["title"]
        mf.write_text(json.dumps(m, indent=1))
    rebuild_index()
    browser_gate(j["id"], "model", cid)
    jobstore.update(j["id"], progress=1.0)
    jobstore.end(j["id"], "done", f"modelo 3D de {cid} listo — míralo en el tab 3D",
                 artifact=f"models/{cid}/meta.json")


def run_splat(j: dict):
    # import tardío: reutiliza el quality gate del server sin duplicarlo
    from aerobrain_server import splat_quality
    cid = j["spec"]["clip_id"]
    # preferir la reconstrucción más nueva con opensfm válido: un re-run alta crea
    # proj_<cid> premium; proj0104 es el dir legacy de 0104 (fallback)
    candidates = [VAULT / "odm" / f"proj_{cid}"]
    if cid.endswith("0104_D"):
        candidates.append(VAULT / "odm" / "proj0104")
    proj = next((c for c in candidates if (c / "opensfm" / "image_list.txt").exists()), candidates[0])
    il = proj / "opensfm" / "image_list.txt"
    il.write_text(il.read_text().replace("/datasets/code", str(proj)))
    n_cams = len([ln for ln in il.read_text().splitlines() if ln.strip()])
    splat_dir = VAULT / "splats"
    splat_dir.mkdir(exist_ok=True)
    stage = splat_dir / ".training" / j["id"]
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)
    tmp_out = stage / f"{cid}.splat"
    ITERS = int(j["spec"].get("iters", 2000))
    backend = choose_splat_backend(ITERS, force_cpu=bool(j["spec"].get("force_cpu")))
    if not backend["bin"].exists():
        raise RuntimeError(f"opensplat no está compilado: {backend['bin']}")
    jobstore.update(j["id"], detail=f"entrenando {ITERS} iters sobre {n_cams} cámaras ({backend['device']})",
                    stage="train", progress=0.1)
    try:
        # --sh-degree-interval > iters: el salto de armónicos esféricos del step
        # 1000 era lo que hacía divergir el loss a nan en CPU (3 corridas murieron
        # justo después). El formato .splat ni siquiera exporta los coeficientes
        # SH, así que entrenar solo el grado 0 no pierde nada y es estable.
        rc = jobstore.run_tracked(j["id"],
            opensplat_train_cmd(proj, tmp_out, ITERS, backend),
            timeout=4 * 3600, abort_re=r"Step \d+: nan",
            progress_re=r"\((\d+)%\)",
            env={**os.environ, "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)})
    except RuntimeError as e:
        if "abortado" in str(e):
            # una vez el loss es nan los pesos no se recuperan: seguir es quemar CPU
            raise RuntimeError("el entrenamiento divergió (loss=nan) — se abortó para no quemar "
                               "horas de CPU. Reintenta: la inicialización aleatoria suele converger.")
        raise
    if rc != 0:
        raise RuntimeError(f"opensplat salió con código {rc}")
    quality = splat_quality(tmp_out, (jobstore.get(j["id"]) or {}).get("log", ""), n_cams, ITERS)
    if not quality["passed"]:
        raise RuntimeError(quality["reason"])
    final_out = publish_splat_stage(stage, cid, quality, splat_dir)
    jobstore.update(j["id"], detail="exportando .ksplat optimizado para el viewer", progress=0.94)
    export_ksplat(final_out)
    rebuild_index()
    browser_gate(j["id"], "splat", cid, timeout=90)
    jobstore.update(j["id"], progress=1.0)
    jobstore.end(j["id"], "done",
                 f"{final_out.name} · loss {quality['final_loss']} · {n_cams} cámaras",
                 artifact=f"splats/{final_out.name}")


RUNNERS = {"3d": run_3d, "splat": run_splat}


def main():
    # al arrancar, SOLO los heavy jobs (de este dueño) que quedaron running son huérfanos
    jobstore.init(orphan_kinds=jobstore.HEAVY_KINDS)
    # el worker es único: al arrancar no hay entrenamientos vivos, así que cualquier
    # stage de .training/ es de un job muerto — límpialo para no acumular GBs huérfanos
    training = VAULT / "splats" / ".training"
    if training.exists():
        for d in training.iterdir():
            shutil.rmtree(d, ignore_errors=True)
            print(f"limpiado stage huérfano: {d.name}", flush=True)
    print(f"worker listo · poll {POLL_S}s · kinds {jobstore.HEAVY_KINDS}", flush=True)
    while True:
        j = jobstore.claim(jobstore.HEAVY_KINDS)
        if not j:
            time.sleep(POLL_S)
            continue
        print(f"→ {j['id']} ({j['kind']}) {j['label']}", flush=True)
        try:
            RUNNERS[j["kind"]](j)
            print(f"✓ {j['id']} done", flush=True)
        except Exception as e:
            if not _cancelled(j["id"]):
                jobstore.end(j["id"], "error", str(e)[-250:])
            print(f"✗ {j['id']}: {e}", flush=True)


if __name__ == "__main__":
    main()
