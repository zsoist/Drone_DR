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
import hashlib
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import jobs as jobstore
import perf
import scenes as scenestore
import scene_manifest
from splat_presets import normalize_splat_request, resolve_splat_spec

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

VAULT = Path("/Volumes/SSD/drone-vault")
PIPE = Path(__file__).resolve().parent
SPLAT_TRANSFORM = PIPE.parent / "tools" / "node_modules" / "@playcanvas" / "splat-transform" / "bin" / "cli.mjs"
SPLAT_ROOT = PIPE.parent / "splat" / "OpenSplat"
SPLAT_CPU_BIN = SPLAT_ROOT / "build" / "opensplat"
SPLAT_MPS_BIN = SPLAT_ROOT / "build-mps" / "opensplat"
LIBTORCH_LIB = PIPE.parent / "splat" / "libtorch" / "lib"
DOCKER = "/usr/local/bin/docker"
POLL_S = 3
VIEWER_ACTIVITY = Path("/tmp/aerobrain-viewer-active")
VIEWER_ACTIVE_S = 45
FULL_CPUS = os.cpu_count() or 10
STREAM_CPUS = max(2, FULL_CPUS - 3)
# caps de memoria/concurrencia desde config/hardware.json (única fuente de verdad):
# antes vivían como literales aquí y en capture_quality — calibrados para 16GB pero
# atados a nada; mover el vault a otra máquina los dejaba corriendo sin aviso.
import hwconfig
_HWCFG = hwconfig.load()
_CAPS = _HWCFG["caps"]
OPENSPLAT_MEMORY_MIB = int(_CAPS["opensplat_mib"])
ODM_LIGHT = _CAPS["odm_light"]     # rapido/estandar + fallback fast-ortho
ODM_HEAVY = _CAPS["odm_heavy"]     # alta/extra/ultra + retry OpenMVS


def rebuild_index():
    subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)


def rebuild_scene_manifest(cid: str) -> dict | None:
    """Refresh the game/site contract whenever ODM or splat assets change."""
    try:
        return scene_manifest.build(cid)
    except (OSError, ValueError, SystemExit) as exc:
        print(f"  scene.v2 refresh skipped for {cid}: {exc}", flush=True)
        return None


def viewer_active(now: float | None = None) -> bool:
    try:
        age = (time.time() if now is None else now) - VIEWER_ACTIVITY.stat().st_mtime
        return 0 <= age <= VIEWER_ACTIVE_S
    except OSError:
        return False


def adaptive_priority(container: str | None = None):
    """Return a reversible policy callback for a running heavy process.

    With no viewer, compute gets every CPU. During video playback, OpenSplat is
    moved to Darwin background scheduling and ODM keeps seven of ten M4 cores,
    reserving capacity for the origin, tunnel, browser and OS. The policy returns
    to full power automatically 45 seconds after the last viewer heartbeat.
    """
    state = {"mode": None}

    def apply(pid: int):
        active = viewer_active()
        mode = "streaming" if active else "full"
        if state["mode"] == mode:
            return
        if container:
            cpus = STREAM_CPUS if active else FULL_CPUS
            r = subprocess.run([DOCKER, "update", "--cpus", str(cpus), container],
                               capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                raise RuntimeError((r.stderr or r.stdout or "docker update failed")[-160:])
            note = f"ODM {cpus}/{FULL_CPUS} CPU"
        else:
            flag = "-b" if active else "-B"
            r = subprocess.run(["/usr/sbin/taskpolicy", flag, "-p", str(pid)],
                               capture_output=True, text=True, timeout=5)
            if r.returncode != 0:
                raise RuntimeError((r.stderr or r.stdout or "taskpolicy failed")[-160:])
            note = "OpenSplat background" if active else "OpenSplat full"
        state["mode"] = mode
        print(f"  resource policy → {mode}: {note}", flush=True)

    return apply


def browser_gate(jid: str, kind: str, cid: str, timeout: int = 75):
    jobstore.update(jid, detail=f"verificando {kind} en navegador", stage="browser-qa", progress=0.97)
    # el timeout del gate (página) va explícito; el del subprocess deja margen para Chrome
    if jobstore.run_tracked(jid, ["python3", str(PIPE / "browser_gate.py"), kind, cid,
                                  "--timeout", str(timeout)],
                            timeout=timeout + 30) != 0:
        raise RuntimeError(f"browser gate falló para {kind} {cid}")


def crop_floaters(splat_path: Path) -> bool:
    """Quita los floaters outlier del .splat (halo de baja confianza en los bordes de splats
    aéreos; el alpha-removal del viewer NO los toca). Caja por-eje (P2..P98 × 1.06) = corta el
    ~6% exterior respetando footprints cuadrados/corredor. In-place, atómico, no fatal."""
    tmp = splat_path.with_suffix(".crop.tmp")
    try:
        r = subprocess.run(["node", str(PIPE / "crop_splat.mjs"), str(splat_path), str(tmp), "0.02", "1.06"],
                           capture_output=True, text=True, timeout=300)
        if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < splat_path.stat().st_size * 0.5:
            raise RuntimeError((r.stderr or r.stdout or "sin salida")[-200:])
        print(f"  {r.stdout.strip()}", flush=True)
        os.replace(tmp, splat_path)
        return True
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"  crop de floaters falló (no fatal): {e}", flush=True)
        return False


def export_viewer_sog(splat_path: Path) -> Path | None:
    """Exporta SOG comprimido para Spark conservando el .splat fuente auditable."""
    out = splat_path.with_name(f"{splat_path.stem}.clean.sog")
    tmp = splat_path.with_name(f".{splat_path.stem}.clean.tmp.sog")
    try:
        if not SPLAT_TRANSFORM.is_file():
            raise RuntimeError(f"splat-transform ausente: {SPLAT_TRANSFORM}")
        r = subprocess.run(["node", str(SPLAT_TRANSFORM), str(splat_path), str(tmp), "--overwrite"],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 1024:
            raise RuntimeError((r.stderr or r.stdout or "sin salida")[-200:])
        os.replace(tmp, out)
        return out
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"  SOG export falló (no fatal): {e}", flush=True)
        return None


def _cancelled(jid: str) -> bool:
    return (jobstore.get(jid) or {}).get("status") in jobstore.CANCEL_STATES


def clean_odm_outputs(proj: Path) -> list[str]:
    """Start a fresh ODM solve without deleting the just-geotagged images.

    Reprocessing a failed project with new frame extraction while keeping stale
    opensfm/odm_* outputs can poison match_features or make a fallback inherit a
    half-written dense stage. For a new 3D job, generated outputs are disposable;
    the source of truth is images/ + frames_manifest.json.
    """
    odm_root = (VAULT / "odm").resolve()
    if proj.resolve().parent != odm_root or not proj.name.startswith("proj_"):
        raise RuntimeError(f"ruta ODM insegura para limpiar: {proj}")
    keep = {"images", "frames_manifest.json", ".geotag.args"}
    removed = []
    for p in proj.iterdir():
        if p.name in keep:
            continue
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
        removed.append(p.name)
    return removed


# presets de calidad ODM: mismo pipeline completo (dense+mesh+DSM), distinto trade-off.
# mem = RAM del contenedor ODM (VM OrbStack 10G, ~0.75G ya usados por servicios).
# 8.5G deja margen real a la VM. concurrency baja en alta/extra/ultra:
# la doc ODM estima ~1GB por thread a 2MP; nuestros frames premium son ~5MP, así que
# subir calidad y mantener 4 workers es pedirle a OpenMVS que se estrelle.
# fallback = preset al que se degrada automáticamente si ODM revienta — "si no es capaz, baja".
PRESETS = {
    "rapido":   {"eta": "~25-40 min", "timeout": 2 * 3600, **ODM_LIGHT,
                 "args": ["--pc-quality", "low", "--feature-quality", "medium",
                          "--orthophoto-resolution", "8", "--dem-resolution", "15"]},
    "estandar": {"eta": "~45-75 min", "timeout": 3 * 3600, **ODM_LIGHT,
                 "args": ["--pc-quality", "medium", "--feature-quality", "medium",
                          "--orthophoto-resolution", "5", "--dem-resolution", "10"]},
    # alta: para video DJI nadir corto, el producto premium real es poses + nube + DSM/ortho
    # + Gaussian splat. El mesh completo/2.5D puede quemar horas en renderdem sobre tiles
    # vacíos y terminar con una malla inútil. --skip-3dmodel mantiene la ruta eficiente y
    # publicable para inspección/splats; vuelos oblicuos/orbita pueden usar extra/ultra si se
    # quiere forzar malla pesada.
    "alta":     {"eta": "~15 min-4 h", "timeout": 6 * 3600, **ODM_HEAVY, "fallback": "estandar",
                 "args": ["--pc-quality", "high", "--feature-quality", "high",
                          "--orthophoto-resolution", "3", "--dem-resolution", "5",
                          "--mesh-size", "300000", "--pc-skip-geometric", "--skip-3dmodel"]},
    # extra: malla más densa (mesh 600k + octree 11) con pc-quality high. octree 12 CRASHEA
    # ("strange values", exit 134) en datasets reales — la comunidad ODM recomienda <=11.
    "extra":    {"eta": "~4-7 h", "timeout": 9 * 3600, **ODM_HEAVY, "fallback": "alta",
                 "args": ["--pc-quality", "high", "--feature-quality", "high",
                          "--orthophoto-resolution", "2", "--dem-resolution", "4",
                          "--mesh-size", "600000", "--mesh-octree-depth", "11",
                          "--pc-skip-geometric"]},
    # ultra: pc-quality ultra (~8.5x tiempo) + mesh 800k, octree 11 (12 revienta). El máximo
    # del M4; la CADENA de fallback (ultra→extra→alta→estandar) garantiza que nunca se pierda
    # el trabajo por un preset demasiado agresivo.
    "ultra":    {"eta": "~8-14 h", "timeout": 16 * 3600, **ODM_HEAVY, "fallback": "extra",
                 "args": ["--pc-quality", "ultra", "--feature-quality", "ultra",
                          "--orthophoto-resolution", "2", "--dem-resolution", "3",
                          "--mesh-size", "800000", "--mesh-octree-depth", "11",
                          "--pc-skip-geometric"]},
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
    # Antes se pisaba el splat anterior del mismo clip. Eso impedía comparar 2k/7k/15k o
    # ediciones SuperSplat. Ahora el set actual se archiva como una versión fechada y la UI
    # expone todas las versiones desde manifest/system.json.
    hist = splat_dir / "history"
    hist.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    archived_splat = None
    archived_viewer = None
    for old in (splat_dir / f"{cid}.clean.sog", splat_dir / f"{cid}.ksplat",
                splat_dir / f"{cid}.splat", splat_dir / f"{cid}.ply",
                splat_dir / f"{cid}.meta.json", splat_dir / f"{cid}.cameras.json"):
        if old.is_file():
            suffix = old.name[len(cid):]
            dst = hist / f"{cid}-{ts}{suffix}"
            os.replace(old, dst)
            if suffix == ".splat":
                archived_splat = f"splats/history/{dst.name}"
            elif suffix in (".clean.sog", ".ksplat"):
                archived_viewer = f"splats/history/{dst.name}"
    if archived_splat or archived_viewer:
        jobstore.retarget_splat_artifacts(cid, archived_splat, archived_viewer)
    # poda de versiones también en la ruta de ENTRENAMIENTO (antes solo en /api/splat_upload):
    # iterar cinematic/ultra archivaba 20MB+ por corrida sin límite
    from aerobrain_server import prune_splat_history
    prune_splat_history(hist, cid, keep=6)
    os.replace(tmp_meta, splat_dir / f"{cid}.meta.json")
    os.replace(tmp_out, final_out)
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


class PeakTracker:
    """Peak de memoria del job vía phys_footprint del kernel (footprint(1)).

    ps RSS SUBESTIMA ~20× a los procesos MPS: las asignaciones Metal no viven en
    el RSS (medido en vivo: RSS 489 MiB vs phys_footprint 10 GB en el MISMO
    opensplat — por eso los primeros OOM reportaban "peak 2.5GB" contra un cap de
    11GB). taskpolicy -m vigila el footprint, así que el peak honesto es ese.
    El kernel además rastrea phys_footprint_peak él solo: el tick solo lo lee,
    no persigue spikes. Fallback a RSS del process-group si footprint(1) falla.
    Envuelve el callback de prioridad existente: un solo tick hace ambas cosas.
    """

    def __init__(self, inner=None):
        self.inner = inner
        self.peak_mib = 0
        self.peak_source = "rss"

    def __call__(self, pid: int):
        try:
            out = subprocess.run(["/usr/bin/footprint", "-f", "bytes", str(pid)],
                                 capture_output=True, text=True, timeout=10).stdout
            m = re.search(r"phys_footprint_peak:\s*(\d+)", out)
            if m:
                self.peak_mib = max(self.peak_mib, int(m.group(1)) // (1024 * 1024))
                self.peak_source = "phys_footprint"
            elif self.peak_source != "phys_footprint":
                self._rss(pid)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            if self.peak_source != "phys_footprint":
                self._rss(pid)                            # medir nunca tumba el job
        if self.inner:
            self.inner(pid)

    def _rss(self, pid: int):
        try:
            out = subprocess.run(["ps", "-Ao", "pgid,rss"], capture_output=True,
                                 text=True, timeout=5).stdout
            rss_kb = 0
            for line in out.splitlines()[1:]:
                p = line.split()
                if len(p) == 2 and p[0] == str(pid):      # setsid: pgid == pid líder
                    rss_kb += int(p[1])
            self.peak_mib = max(self.peak_mib, rss_kb // 1024)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass


def opensplat_train_cmd(project: Path, out: Path, iters: int, backend: dict,
                        extra_args: list[str] | None = None) -> list[str]:
    # Arranca a prioridad normal para usar toda la máquina cuando está ociosa.
    # adaptive_priority() lo mueve de forma reversible a Darwin background si
    # aparece un viewer y lo devuelve a full al terminar la reproducción.
    cmd = ["/usr/sbin/taskpolicy", "-m", str(OPENSPLAT_MEMORY_MIB),
           str(backend["bin"]), str(project)]
    if backend.get("cpu_flag"):
        cmd.append("--cpu")
    cmd += ["-n", str(iters), "-o", str(out), "--sh-degree-interval", str(iters + 1)]
    cmd += list(extra_args or [])
    return cmd


def fmt_duration(seconds: float | int | None) -> str:
    if not seconds:
        return ""
    seconds = float(seconds)
    if seconds >= 3600:
        return f"{seconds / 3600:.1f}h"
    if seconds >= 60:
        return f"{seconds / 60:.0f}m"
    return f"{seconds:.0f}s"


def fmt_iters(n: int | None) -> str:
    if not n:
        return ""
    return f"{n // 1000}k" if n >= 1000 and n % 1000 == 0 else str(n)


def splat_done_detail(viewer_out: Path, quality: dict, n_cams: int) -> str:
    requested = quality.get("requested_preset")
    effective = quality.get("effective_preset") or quality.get("preset")
    quality_label = quality.get("preset_label") or effective
    if requested and effective and requested != effective:
        quality_label = f"{requested.title()} solicitado → {quality_label} efectivo"
    scale = int(quality.get("input_scale") or 1)
    parts = [
        viewer_out.name,
        quality_label,
        f"entrada -d{scale}" if scale > 1 else "entrada completa",
        (fmt_iters(int(quality["target_iters"])) + " iters") if quality.get("target_iters") else "",
        quality.get("backend"),
        fmt_duration(quality.get("duration_s")),
        (f"loss {quality.get('final_loss')}" if quality.get("final_loss") is not None
         else "loss n/d"),
        f"{n_cams} cámaras",
    ]
    return " · ".join(str(p) for p in parts if p)


def job_stage_timings(jid: str, *, now: float | None = None) -> dict:
    """Aggregate observed stage durations from immutable stage events."""
    history = jobstore.stage_history(jid)
    if not history:
        return {}
    end = float(now if now is not None else time.time())
    totals = {}
    for index, row in enumerate(history):
        start = float(row["ts"])
        stop = float(history[index + 1]["ts"]) if index + 1 < len(history) else end
        stage = str(row.get("stage") or "unknown")
        totals[stage] = round(totals.get(stage, 0.0) + max(0.0, stop - start), 1)
    return totals


_SPLAT_RUN_FIELDS = (
    "preset", "preset_label", "requested_preset", "effective_preset",
    "requested_iterations", "target_iters", "last_step", "final_loss", "bytes",
    "cameras", "duration_s", "requested_backend", "effective_backend", "backend",
    "backend_policy", "resolution", "requested_downscale", "effective_downscale",
    "effective_resolution", "input_scale", "fallback", "attempts", "peak_mib",
    "remote_peak_vram_mib", "peak_source", "mem_cap_mib", "caps_provisional",
    "remote_gpu", "remote_driver", "cuda_runtime", "torch", "gsplat",
    "telemetry_samples", "image_cache_device", "decoded_image_cache_mib",
    "gpu_cache_budget_mib", "resumed_from_step", "trainer", "trainer_args",
    "params_hash", "stage_timings",
)


def splat_run_record(jid: str, quality: dict) -> dict:
    """Build one complete, bounded reconstruction.splat_runs[] record."""
    return {
        "job_id": jid,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **{key: quality.get(key) for key in _SPLAT_RUN_FIELDS if key in quality},
    }


def splat_attempt_plan(spec: dict | None) -> list[dict]:
    """Build a bounded, truthful OpenSplat fallback ladder.

    The preflight can prove that full-resolution image loading is wasteful, so
    those jobs start at -d2. Cross-preset fallback is opt-out (`best_available`
    defaults true) and only executes after an OOM; callers must still record the
    requested and effective presets separately.
    """
    spec = spec or {}
    normalized = normalize_splat_request(spec)
    requested = resolve_splat_spec(spec)["key"]
    if normalized["backend"] == "cuda":
        resolution = normalized["resolution"]
        downscales = {"auto": (1, 2), "full": (1,), "half": (2,)}[resolution]
        return [{
            "preset": requested,
            "d": d,
            "reason": ("cuda_requested_full" if d == 1 else
                       "cuda_oom_resolution_retry" if resolution == "auto" else
                       "cuda_requested_half"),
        } for d in downscales]
    recommended_d = int((spec.get("preflight") or {}).get("recommended_d") or 1)
    recommended_d = 2 if recommended_d >= 2 else 1
    best_available = spec.get("best_available", True) is not False

    plan = [{
        "preset": requested,
        "d": recommended_d,
        "reason": "preflight_input_floor" if recommended_d == 2 else "requested_quality",
    }]
    if recommended_d == 1:
        plan.append({"preset": requested, "d": 2, "reason": "oom_resolution_fallback"})

    if best_available and requested in ("ultra", "cinematic"):
        ladder = ("ultra", "cinematic", "medium")
        for lower in ladder[ladder.index(requested) + 1:]:
            plan.append({"preset": lower, "d": 2, "reason": "oom_quality_fallback"})
    return plan


def record_scene_completion(j: dict, meta: dict) -> dict | None:
    """Record a finished reconstruction version and promote only a valid first version."""
    spec = j.get("spec") or {}
    scene_id = spec.get("scene_id")
    version_id = spec.get("version_id") or spec.get("clip_id")
    if not scene_id or not version_id:
        return None
    recon = meta.get("reconstruction") or {}
    qa = meta.get("qa") or {}
    merge_label = recon.get("merge_label") or "SINGLE"
    required_ok = bool((qa.get("cameras_reconstructed") or 0) > 0
                       and (meta.get("pipeline_mode") or qa.get("status")))
    status = "ready" if required_ok and merge_label in ("SINGLE", "FULL") else (
        "partial" if merge_label == "PARTIAL" else "failed")
    metrics = scenestore.model_metrics(meta)
    contributions = []
    for row in recon.get("sources") or []:
        if not isinstance(row, dict) or not row.get("clip_id"):
            continue
        merged = row.get("merged") is not False
        contributions.append({
            "clip_id": row["clip_id"],
            "submitted": row.get("submitted") or 0,
            "registered": row.get("registered") or 0,
            "merged": merged,
            "reason": row.get("reason") or (
                "registered in shared component" if merged else "no shared registration component"),
        })
    if contributions:
        scenestore.record_contributions(scene_id, version_id, contributions)
    version = scenestore.update_version(
        scene_id, version_id, status=status, merge_label=merge_label,
        required_artifacts_ok=required_ok, metrics=metrics,
        artifact=f"models/{version_id}/meta.json", requested_preset=spec.get("preset"),
        effective_preset=recon.get("effective_preset") or meta.get("preset"),
        completed_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"), job_id=j.get("id"))
    scene = scenestore.get_scene(scene_id)
    if status == "ready" and not scene.get("active_version"):
        scenestore.promote(scene_id, version_id)
    return version


ODM_FRAME_PROFILE = {"rapido": "preview", "estandar": "balanced",
                     "alta": "premium", "extra": "premium", "ultra": "premium"}


def odm_cmd(container: str, proj: Path, preset: dict, rerun_from: str | None = None,
            stable_dense: bool = False) -> list[str]:
    cmd = [DOCKER, "run", "--rm", "--name", container,
           "-m", preset.get("mem", ODM_LIGHT["mem"]), "-v", f"{proj}:/datasets/code", "opendronemap/odm",
           "--project-path", "/datasets",
           "--max-concurrency", str(preset.get("concurrency", ODM_LIGHT["concurrency"])),
           "--dsm", "--dtm", "--skip-report", *preset["args"]]
    if stable_dense and "--pc-skip-geometric" not in cmd:
        cmd.append("--pc-skip-geometric")
    if rerun_from:
        cmd += ["--rerun-from", rerun_from]
    return cmd


def _replace_arg(args: list[str], flag: str, value: str) -> list[str]:
    out = list(args)
    try:
        out[out.index(flag) + 1] = value
    except (ValueError, IndexError):
        out += [flag, value]
    return out


def openmvs_retry_preset(preset: dict) -> dict:
    """Retry high presets with the same web-facing outputs but safer dense depthmaps.

    On M4/16GB, OpenMVS high fusion can be killed near the memory ceiling. ODM's
    own recovery then enters a tiled/sub-scene pass that segfaults on nadir-only
    unbounded scenes. A useful retry must therefore lower the dense map pressure;
    repeating the same high/ultra dense command only burns time before the same
    recovery crash.
    """
    retry = dict(preset)
    retry["args"] = _replace_arg(list(preset["args"]), "--pc-quality", "medium")
    retry["mem"] = ODM_HEAVY["mem"]
    retry["concurrency"] = ODM_HEAVY["concurrency"]
    return retry


CUDA_DENSE_SAFE_FRAME_CAP = 320


def odm_cuda_dense_preflight(preset_name: str, preset: dict,
                             frame_preflight: dict) -> tuple[dict, dict]:
    """Choose the strongest calibrated dense rung before a large remote solve.

    The RTX run with 426 registered Ultra views completed depth estimation but
    exceeded the 20 GiB container ceiling while fusing those maps. Above the
    calibrated frame cap we retain Ultra features, mesh, DSM and orthophoto
    settings, while lowering only pc-quality to the proven memory-safe rung.
    """
    selected = dict(preset)
    selected["args"] = list(preset.get("args") or [])
    total = int(frame_preflight.get("total_frames") or sum(
        int(row.get("submitted") or 0)
        for row in (frame_preflight.get("by_source") or {}).values()))
    requested = _preset_arg(preset, "--pc-quality")
    adjusted = (preset_name in ("alta", "extra", "ultra")
                and total >= CUDA_DENSE_SAFE_FRAME_CAP
                and requested != "medium")
    if adjusted:
        selected = openmvs_retry_preset(selected)
    effective = _preset_arg(selected, "--pc-quality")
    return selected, {
        "adjusted": adjusted,
        "frames": total,
        "frame_cap": CUDA_DENSE_SAFE_FRAME_CAP,
        "requested_dense_quality": requested,
        "effective_dense_quality": effective,
        "reason": ("large_scene_fusion_memory_preflight" if adjusted
                   else "requested_dense_quality_safe"),
    }


def odm_cuda_is_strict(spec: dict, preset_name: str) -> bool:
    """High-quality CUDA ODM never spills onto the Mac after a node failure."""
    if str((spec or {}).get("backend") or "").lower() != "cuda":
        return False
    return (str((spec or {}).get("backend_policy") or "").lower() == "strict"
            or preset_name in ("alta", "extra", "ultra"))


def _preset_arg(preset: dict | None, flag: str, default: str = "unknown") -> str:
    args = (preset or {}).get("args") or []
    try:
        return str(args[args.index(flag) + 1])
    except (ValueError, IndexError):
        return default


def odm_quality_provenance(requested_preset: str, effective_preset: str,
                           dense_quality: str | None = None) -> dict:
    """Describe requested output preset separately from effective dense quality."""
    requested_dense = _preset_arg(PRESETS.get(requested_preset), "--pc-quality")
    effective_dense = dense_quality or _preset_arg(PRESETS.get(effective_preset), "--pc-quality")
    return {
        "effective_preset": effective_preset,
        "requested_preset": requested_preset,
        "dense_quality": effective_dense,
        "dense_quality_requested": requested_dense,
        "dense_fallback": effective_dense != requested_dense,
    }


def run_odm_container(jid, container, proj, preset, preset_name, rerun_from: str | None = None,
                      stable_dense: bool = False):
    """Corre ODM con la memoria del preset; devuelve el exit code de run_tracked."""
    # el AutoRemove de docker tras un kill es ASÍNCRONO: relanzar con el mismo --name en la
    # cadena de fallback puede dar "name already in use" (rc 125) y quemar un escalón entero.
    # rm -f síncrono garantiza el nombre libre (no-op si no existe).
    try:
        subprocess.run([DOCKER, "rm", "-f", container], capture_output=True, timeout=30)
    except (subprocess.TimeoutExpired, OSError):
        pass
    return jobstore.run_tracked(jid, odm_cmd(container, proj, preset, rerun_from, stable_dense),
                                timeout=preset["timeout"], tick=adaptive_priority(container))


def fast_ortho_cmd(container: str, proj: Path, ortho_res: str = "5") -> list[str]:
    """Last-resort ODM path when OpenMVS dense/full mesh fails.

    Official ODM `--fast-orthophoto` skips dense reconstruction/full 3D model and
    generates an orthophoto from the sparse/25D path. It is the right degraded
    product for valid reconstructions that crash in DensifyPointCloud.
    """
    return [DOCKER, "run", "--rm", "--name", container,
            "-m", ODM_LIGHT["mem"], "-v", f"{proj}:/datasets/code", "opendronemap/odm",
            "--project-path", "/datasets", "--max-concurrency", str(ODM_LIGHT["concurrency"]),
            "--fast-orthophoto", "--skip-report",
            "--orthophoto-resolution", ortho_res,
            "--rerun-from", "odm_georeferencing"]


def run_fast_ortho_fallback(jid: str, proj: Path, container: str) -> int:
    # registra el NOMBRE REAL del contenedor: cancel/timeout matan `docker kill <job.container>`,
    # y si sigue apuntando a `odm-{jid}` (ya muerto) el `-ortho` quedaría huérfano quemando CPU
    jobstore.update(jid, container=container,
                    detail="2/3 OpenMVS falló → fallback fast-orthophoto/25D",
                    stage="odm-fallback", progress=0.55)
    jobstore.event(jid, "odm_product_fallback",
                   "OpenMVS falló; generando ortofoto/DSM 25D",
                   level="warning", data={"effective_product": "ortho_25d"})
    try:
        return jobstore.run_tracked(jid, fast_ortho_cmd(container, proj), timeout=2 * 3600,
                                    tick=adaptive_priority(container))
    except TimeoutError:
        print("  ODM fast-orthophoto agotó el tiempo", flush=True)
        return 124


def run_odm_step(jid, container, proj, preset, preset_name, rerun_from: str | None = None,
                 stable_dense: bool = False):
    """ODM degradando el TIMEOUT a rc=124 en vez de propagar la excepción: un preset demasiado
    agresivo suele AGOTAR el tiempo (no reventar con exit code), y run_tracked lanza TimeoutError.
    Sin esto, el timeout se saltaba TODA la cadena de fallback ultra→extra→alta→estandar y se
    perdían horas. Cancel/abort (RuntimeError) SÍ propagan: el operador manda."""
    try:
        return run_odm_container(jid, container, proj, preset, preset_name, rerun_from, stable_dense)
    except TimeoutError:
        print(f"  ODM {preset_name} agotó el tiempo → tratado como fallo (rc=124) para el fallback", flush=True)
        # run_tracked ya hizo end(jid,'error') ANTES de lanzar: si seguimos la cadena con el job
        # en 'error', cancel() lo rechaza (no-running), el orphan-recovery lo ignora si el worker
        # muere (contenedor huérfano quemando CPU), y la UI muestra "error" mientras procesa.
        jobstore.update(jid, status="running", finished=None)
        return 124


def _openmvs_unstable(jid: str, rc: int) -> bool:
    if rc in (134, 139):
        return True
    log = ((jobstore.get(jid) or {}).get("log") or "").lower()
    return any(s in log for s in ("densifypointcloud", "openmvs", "strange values",
                                  "corrupted double-linked list"))


def odm_registration(proj: Path, sources: list) -> dict:
    """Lee opensfm/reconstruction.json tras el SfM y reporta CUÁNTAS imágenes de CADA fuente
    se integraron de verdad. Sin esto, un modelo 'combinado' puede DESCARTAR una fuente entera
    en silencio (SfM no la co-registra) y aún así verse OK (test real: 0106 aportó 0/7 frames).
    Devuelve componentes, ratio global y por-fuente + qué fuentes NO fusionaron."""
    rj = proj / "opensfm" / "reconstruction.json"
    out = {"components": 0, "registered": 0, "total": 0, "by_source": {}, "dropped_sources": []}
    try:
        recs = json.loads(rj.read_text())
    except (ValueError, OSError):
        return out
    def _pref(name):
        return name.split("_")[0] + "_" if name.startswith("s") and "_f_" in name else "s0_"
    # SUBMITTED por-fuente (del image_list) y REGISTERED por-fuente (de la reconstrucción)
    submitted = {}
    try:
        for ln in (proj / "opensfm" / "image_list.txt").read_text().splitlines():
            n = ln.strip().split("/")[-1]
            if n:
                submitted[_pref(n)] = submitted.get(_pref(n), 0) + 1
    except OSError:
        pass
    total = sum(submitted.values())
    reg_by_prefix = {}
    for r in recs:
        for shot in r.get("shots", {}):
            reg_by_prefix[_pref(shot)] = reg_by_prefix.get(_pref(shot), 0) + 1
    registered = sum(reg_by_prefix.values())
    # una fuente FUSIONÓ si registró ≥5 imágenes Y ≥60% de las que aportó (regla del review §5;
    # NO hard-fail: el modelo sobrevive, solo cambia el label y el auto-splat)
    by_source = {}
    for idx, src in enumerate(sources):
        pref = f"s{idx}_" if len(sources) > 1 else "s0_"
        reg = reg_by_prefix.get(pref, 0)
        sub = submitted.get(pref, 0) or 1
        merged = reg >= 5 and reg / sub >= 0.6
        by_source[src] = {"submitted": submitted.get(pref, 0), "registered": reg,
                          "ratio": round(reg / sub, 2), "merged": merged}
        if len(sources) > 1 and not merged:
            out["dropped_sources"].append(src)
    out.update(components=len(recs), registered=registered, total=total, by_source=by_source,
               merged_sources=len(sources) - len(out["dropped_sources"]))
    return out


def odm_frame_preflight(proj: Path, sources: list, minimum_frames: int = 5) -> dict:
    """Gate a multi-source solve using exact frames left after adaptive selection.

    Registration requires at least five images from every source.  Running feature
    matching when a source submitted fewer than five can never produce a FULL merge,
    so this check runs after local extraction and before any remote GPU work.
    """
    minimum = max(1, int(minimum_frames or 5))
    try:
        manifest = json.loads((proj / "frames_manifest.json").read_text())
    except (OSError, ValueError, TypeError):
        manifest = {}
    manifest_rows = {str(row.get("cid")): row for row in manifest.get("sources") or []
                     if isinstance(row, dict) and row.get("cid")}
    multi = len(sources) > 1 or bool(manifest.get("photos"))
    by_source = {}
    viable_sources = []
    sparse_sources = []
    for index, source in enumerate(sources):
        source = str(source)
        row = manifest_rows.get(source, {})
        prefix = row.get("prefix")
        if prefix is None:
            prefix = f"s{index}_" if multi else ""
        pattern = f"{prefix}f_*.jpg" if prefix else "f_*.jpg"
        submitted = sum(1 for _ in (proj / "images").glob(pattern))
        viable = submitted >= minimum
        reason = (f"selección adaptativa dejó {submitted}/{minimum} frames mínimos"
                  if not viable else f"{submitted} frames listos para registro")
        by_source[source] = {
            "clip_id": source,
            "prefix": prefix or None,
            "submitted": submitted,
            "minimum": minimum,
            "viable": viable,
            "reason": reason,
        }
        (viable_sources if viable else sparse_sources).append(source)
    return {
        "minimum_frames": minimum,
        "total_frames": sum(row["submitted"] for row in by_source.values()),
        "by_source": by_source,
        "viable_sources": viable_sources,
        "sparse_sources": sparse_sources,
    }


def frame_viable_recovery_spec(parent_spec: dict, viable_sources: list) -> dict:
    """Retarget an immutable scene job and its phased splat to a viable subset."""
    viable = list(dict.fromkeys(str(source) for source in viable_sources if str(source)))
    if not viable:
        raise ValueError("frame recovery needs at least one viable source")
    spec = json.loads(json.dumps(parent_spec or {}))
    photos = list(spec.get("photos") or [])
    recovery_id = jobstore.recon_id_for(viable, photos)
    spec.update({
        "clip_id": recovery_id,
        "version_id": recovery_id,
        "primary_cid": viable[0],
        "sources": viable,
    })
    if isinstance(spec.get("splat"), dict):
        spec["splat"].update({"clip_id": recovery_id, "version_id": recovery_id})
    return spec


def queue_frame_viable_recovery(j: dict, preflight: dict) -> str | None:
    """Persist an impossible attempt and enqueue its exact viable scene subset."""
    spec = j.get("spec") or {}
    scene_id = spec.get("scene_id")
    version_id = spec.get("version_id") or spec.get("clip_id")
    requested = list(spec.get("sources") or [])
    viable = list(preflight.get("viable_sources") or [])
    sparse = list(preflight.get("sparse_sources") or [])
    if not scene_id or not version_id or not sparse or not viable or viable == requested:
        return None

    contributions = []
    for source in sparse:
        row = (preflight.get("by_source") or {}).get(source) or {}
        contributions.append({
            "clip_id": source,
            "submitted": int(row.get("submitted") or 0),
            "registered": 0,
            "merged": False,
            "reason": row.get("reason") or "insufficient frames for registration",
        })
    scenestore.record_contributions(scene_id, version_id, contributions)
    scenestore.update_version(
        scene_id, version_id, status="failed", merge_label="PARTIAL",
        required_artifacts_ok=False,
        metrics={"frame_preflight": preflight},
        completed_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"), job_id=j.get("id"))

    recovery = frame_viable_recovery_spec(spec, viable)
    recovery_id = recovery["clip_id"]
    scene = scenestore.get_scene(scene_id)
    evidence = [row for row in scene.get("source_evidence") or []
                if row.get("clip_id") in set(viable)]
    scenestore.add_version(scene_id, recovery_id, viable, recovery.get("photos") or [],
                           "processing", source_evidence=evidence)
    if jobstore.pending("3d", recovery_id):
        pending = next((row for row in jobstore.recent(200)
                        if row.get("kind") == "3d" and row.get("label") == recovery_id
                        and row.get("status") in ("queued", "running")), None)
        return pending.get("id") if pending else recovery_id
    queued = jobstore.enqueue("3d", recovery_id, recovery)
    scenestore.update_version(scene_id, recovery_id, job_id=queued["id"])
    jobstore.event(
        j["id"], "scene_frame_preflight_recovery",
        f"{len(sparse)} fuente(s) bajo {preflight.get('minimum_frames', 5)} frames; "
        f"recovery {recovery_id} con {len(viable)} fuente(s)", level="warning",
        data={"sparse_sources": sparse, "viable_sources": viable,
              "recovery_job": queued["id"], "recovery_version": recovery_id})
    return queued["id"]


def merge_label(n_sources: int, n_photos: int, dropped: list) -> str:
    """Label de fusión de la entity (U0): la composición al frente, jamás escondida.
    SINGLE = una fuente sin fotos; PARTIAL = alguna fuente no co-registró;
    FULL = todas fusionaron. FAILED lo pone el job al morir, no este derivador."""
    if n_sources <= 1 and not n_photos:
        return "SINGLE"
    return "PARTIAL" if dropped else "FULL"


def odm_cuda_feature_progress(total_images: int, preset_name: str):
    """Report image loading separately from completed feature extraction."""
    total = max(1, int(total_images or 0))
    preset = str(preset_name or "").strip() or "CUDA"
    loaded = 0
    completed = 0

    def observe(line: str) -> dict | None:
        nonlocal loaded, completed
        text = line or ""
        reading = re.search(r"Reading data for image .+\(queue-size=(\d+)\)", text, re.I)
        if reading:
            loaded = min(total, max(loaded, int(reading.group(1))))
            return {
                "progress": round(0.20 + 0.015 * loaded / total, 4),
                "detail": (f"2/3 ODM {preset} en NVIDIA CUDA · "
                           f"cargando imágenes {loaded}/{total}"),
            }
        if re.search(r"Found\s+\d+\s+points\s+in\s+", text, re.I):
            completed = min(total, completed + 1)
            return {
                "progress": round(0.215 + 0.135 * completed / total, 4),
                "detail": (f"2/3 ODM {preset} en NVIDIA CUDA · "
                           f"extrayendo features {completed}/{total}"),
            }
        return None

    return observe


def run_odm_cuda(j: dict, proj: Path, preset: dict, preset_name: str) -> int:
    """Corre la fotogrametria en el nodo CUDA (odm:gpu en el PC). Devuelve rc:
    0 = outputs ya en proj, listos para el publish local; !=0 o excepcion deja
    que el caller aplique la politica remota/local del preset. El ssh es el proceso trackeado: log/progreso/
    timeout/cancel son el aparato de siempre (matar el ssh tumba la VM WSL y el
    contenedor con ella)."""
    import odm_gpu_lane
    odm_gpu_lane.probe()
    name = j["id"].replace("_", "-")
    container = f"odm-gpu-{name[:40]}"
    completed = False
    jobstore.event(j["id"], "odm_cuda", "nodo CUDA verificado — fotogrametria remota",
                   data={"image": "opendronemap/odm:gpu", "preset": preset_name})
    try:
        n = odm_gpu_lane.ship_images(proj, name)
        jobstore.update(j["id"],
                        detail=f"2/3 ODM {preset_name} en NVIDIA CUDA · cargando imágenes 0/{n}",
                        stage="odm-features", progress=0.20,
                        container=container, backend="NVIDIA CUDA")
        rc = jobstore.run_tracked(
            j["id"], odm_gpu_lane.remote_run_argv(name, container, list(preset["args"])),
            timeout=preset["timeout"], line_progress=odm_cuda_feature_progress(n, preset_name))
        if rc != 0:
            return rc
        jobstore.update(j["id"], detail="2/3 trayendo resultados del nodo CUDA",
                        stage="odm", progress=0.5)
        got = odm_gpu_lane.fetch_outputs(proj, name)
        jobstore.update(j["id"], backend="NVIDIA CUDA")
        jobstore.event(j["id"], "odm_cuda_done", f"outputs recuperados: {', '.join(got)}")
        completed = True
        return 0
    finally:
        if completed:
            odm_gpu_lane.cleanup(name, container)
        else:
            jobstore.event(
                j["id"], "odm_cuda_evidence_retained",
                f"evidencia remota preservada en /root/gpu-jobs/odm/{name}",
                level="warning", data={"remote_dir": f"/root/gpu-jobs/odm/{name}"})


def build_3d_assets(j: dict, cid: str, preset_name: str = "estandar", title: str = "",
                    sources: list | None = None, photos: list | None = None) -> str:
    """Build ODM web assets for a clip and return the real preset used.

    Shared by the normal 3D job and the "splat from video" path. It deliberately
    does not call jobstore.end(); callers decide whether the job is complete or
    whether another stage (OpenSplat) follows.
    """
    if preset_name not in PRESETS:
        preset_name = "estandar"
    preset = PRESETS[preset_name]
    requested_preset = preset_name
    proj = VAULT / "odm" / f"proj_{cid}"
    container = f"odm-{j['id']}"
    jobstore.update(j["id"], container=container)

    frame_profile = ODM_FRAME_PROFILE.get(preset_name, "balanced")
    # entity U0: cid puede ser un recon_<hash> (identidad propia del combinado) — en ese
    # caso las fuentes son clips REALES distintos del cid y no se fuerza ninguno como
    # primario de identidad. Para single-source legacy, cid sigue mandando (alias no-op).
    src_list = sources or [cid]
    is_recon = cid.startswith("recon_")
    if not is_recon and src_list[0] != cid:
        src_list = [cid] + [s for s in src_list if s != cid]   # cid manda la identidad (legacy)
    n_extra = len(src_list) - 1 + len(photos or [])
    jobstore.update(j["id"], detail=f"1/3 frames + geotag + selección adaptativa"
                    + (f" · {len(src_list)} videos" + (f" + {len(photos)} fotos" if photos else "")
                       if n_extra else ""),
                    stage="frames", progress=0.05)
    prep_cmd = ["python3", str(PIPE / "odm_prep.py"), "--sources", ",".join(src_list),
                "--proj-id", cid, "--profile", frame_profile]
    if photos:
        prep_cmd += ["--photos", ",".join(photos)]
    if jobstore.run_tracked(j["id"], prep_cmd, timeout=1800 + 1200 * (len(src_list) - 1)) != 0:
        raise RuntimeError("odm_prep falló")
    frame_preflight = odm_frame_preflight(proj, src_list)
    if len(src_list) > 1 and frame_preflight["sparse_sources"]:
        recovery_job = queue_frame_viable_recovery(j, frame_preflight)
        if recovery_job:
            sparse = ", ".join(frame_preflight["sparse_sources"])
            raise RuntimeError(
                f"preflight de registro: {sparse} bajo el mínimo de 5 frames; "
                f"recovery viable encolado ({recovery_job})")
    removed = clean_odm_outputs(proj)
    if removed:
        print(f"  ODM fresh start: limpiados {len(removed)} outputs previos", flush=True)

    jobstore.update(j["id"], detail=f"2/3 fotogrametría ODM {preset_name} ({preset['eta']})",
                    stage="odm", progress=0.15)
    effective_dense_quality = _preset_arg(preset, "--pc-quality")
    rc = -1
    cuda_requested = str(j["spec"].get("backend") or "").lower() == "cuda"
    cuda_strict = odm_cuda_is_strict(j["spec"], preset_name)
    if cuda_requested:
        cuda_preset, dense_preflight = odm_cuda_dense_preflight(
            preset_name, preset, frame_preflight)
        effective_dense_quality = dense_preflight["effective_dense_quality"]
        if dense_preflight["adjusted"]:
            jobstore.event(
                j["id"], "odm_cuda_dense_preflight",
                f"{dense_preflight['frames']} frames: dense "
                f"{dense_preflight['requested_dense_quality']} → "
                f"{dense_preflight['effective_dense_quality']} para fusión estable",
                level="warning", data=dense_preflight)
            jobstore.update(
                j["id"],
                detail=f"2/3 ODM {preset_name} CUDA · fusión densa "
                       f"{dense_preflight['effective_dense_quality']} preflight",
                stage="odm", progress=0.15)
        try:
            rc = run_odm_cuda(j, proj, cuda_preset, preset_name)
        except Exception as e:
            jobstore.event(j["id"], "odm_cuda_failure",
                           f"nodo CUDA falló: {str(e)[:260]}", level="warning")
            rc = -1
        if _cancelled(j["id"]):
            raise RuntimeError("ODM cancelado; no se inicia ningún fallback")
        if rc != 0 and cuda_strict:
            jobstore.event(
                j["id"], "odm_cuda_strict_stop",
                f"ODM CUDA terminó con rc={rc}; Alta/Extra/Ultra no cae al Mac",
                level="error", data={"rc": rc, "preset": preset_name,
                                     "backend_policy": "strict"})
            raise RuntimeError(
                f"ODM CUDA estricto falló (rc={rc}); solicitud preservada sin fallback local")
        if rc != 0 and not _cancelled(j["id"]):
            if rc > 0:                       # el contenedor remoto corrió y murió con rc real
                jobstore.event(j["id"], "odm_cuda_fallback",
                               f"ODM remoto salió con rc={rc} → ODM local", level="warning",
                               data={"rc": rc})
            jobstore.update(j["id"], status="running", finished=None, container=None,
                            backend=None,
                            detail=f"2/3 fotogrametria ODM {preset_name} local (fallback)",
                            stage="odm", progress=0.15)
    if _cancelled(j["id"]):
        raise RuntimeError("ODM cancelado; no se inicia ningún fallback")
    if rc != 0:
        rc = run_odm_step(j["id"], container, proj, preset, preset_name)
    # CADENA de fallback (no un solo nivel): un preset pesado puede reventar por OOM (137), por
    # "strange values" (134, malla demasiado densa) o AGOTAR EL TIEMPO (124 vía run_odm_step) →
    # baja escalón por escalón hasta uno probado (ultra→extra→alta→estandar). Antes: un solo
    # fallback, y un timeout se saltaba la cadena entera perdiendo horas.
    stable_tried = set()
    while rc != 0 and not _cancelled(j["id"]):
        if preset_name in ("alta", "extra", "ultra") and preset_name not in stable_tried and _openmvs_unstable(j["id"], rc):
            stable_tried.add(preset_name)
            retry_preset = openmvs_retry_preset(preset)
            print(f"  ODM {preset_name} falló en OpenMVS (rc={rc}) → retry dense medio sin sub-scene recovery", flush=True)
            jobstore.update(j["id"], detail=f"2/3 ODM {preset_name}: retry OpenMVS estable",
                            stage="odm", progress=0.15)
            jobstore.event(j["id"], "odm_dense_retry",
                           f"{preset_name}: reintento OpenMVS con nube densa medium",
                           level="warning", data={"requested_preset": requested_preset,
                                                  "effective_dense_quality": "medium"})
            effective_dense_quality = _preset_arg(retry_preset, "--pc-quality")
            rc = run_odm_step(j["id"], container, proj, retry_preset, preset_name,
                              rerun_from="openmvs", stable_dense=True)
            continue
        if not preset.get("fallback"):
            break
        fb = preset["fallback"]
        print(f"  ODM {preset_name} falló (rc={rc}) → fallback a {fb}", flush=True)
        jobstore.update(j["id"], detail=f"2/3 ODM {preset_name} no fue capaz → bajando a {fb}",
                        stage="odm", progress=0.15)
        jobstore.event(j["id"], "odm_preset_fallback",
                       f"{preset_name} falló; continúa con {fb}", level="warning",
                       data={"from": preset_name, "to": fb, "requested_preset": requested_preset})
        preset_name, preset = fb, PRESETS[fb]
        effective_dense_quality = _preset_arg(preset, "--pc-quality")
        rc = run_odm_step(j["id"], container, proj, preset, preset_name, rerun_from="openmvs")
    if _cancelled(j["id"]):
        raise RuntimeError("ODM cancelado; no se inicia fallback 25D")
    if rc != 0:
        fb_container = f"{container}-ortho"
        rc2 = run_fast_ortho_fallback(j["id"], proj, fb_container)
        if rc2 != 0:
            raise RuntimeError("ODM falló (incluido fallback fast-orthophoto/25D)")
        preset_name = "ortho_25d_fallback"
        effective_dense_quality = "sparse_25d"

    jobstore.update(j["id"], detail="3/3 publicando assets web", stage="publish", progress=0.9)
    # 2h, no 30min: dentro corren TRES pasos docker (ortho/nube/DSM, hasta 1800s c/u) +
    # texturas PIL + gzip del OBJ. En extra/ultra el kill a 1800s caía a MITAD de la
    # publicación con model/ ya wipeado → visor roto con meta viejo.
    if jobstore.run_tracked(j["id"],
            ["python3", str(PIPE / "tresd_publish.py"), cid, str(proj)],
            timeout=7200) != 0:
        raise RuntimeError("publicación falló")

    # graba preset + título elegidos en el asistente (la UI los muestra en tarjeta/reporte)
    mf = VAULT / "models" / cid / "meta.json"
    if mf.exists():
        m = json.loads(mf.read_text())
        m["preset"] = preset_name                 # el REAL usado (puede ser el fallback)
        if preset_name != requested_preset:
            m["preset_requested"] = requested_preset
        quality_provenance = odm_quality_provenance(
            requested_preset, preset_name, effective_dense_quality)
        for key in ("dense_quality", "dense_quality_requested", "dense_fallback"):
            m[key] = quality_provenance[key]
        if title:
            m["title"] = title
        multi = (sources and len(sources) > 1) or photos
        if multi:                                     # modelo combinado: registra sus fuentes
            m["sources"] = list(sources or [cid])
            if photos:
                m["source_photos"] = list(photos)
            # GATE por-fuente: cuántas imágenes de cada fuente se integraron de verdad
            reg = odm_registration(proj, src_list)
            m["odm_report"] = reg
            if reg["dropped_sources"]:
                m["partial_merge"] = reg["dropped_sources"]
                print(f"  ⚠ fusión PARCIAL: {reg['dropped_sources']} no co-registraron "
                      f"({reg['registered']}/{reg['total']} imgs) — el splat NO se auto-encolará",
                      flush=True)
        else:
            reg = {"by_source": {}, "dropped_sources": []}
        # entity U0: bloque reconstruction UNIFORME (single y combinado) — la identidad,
        # la composición per-fuente y los splat_runs viven juntos; la UI (U1-U3) renderiza
        # esto, nunca lo re-deriva. splat_runs los va llenando run_splat al publicar.
        m["reconstruction"] = {
            "id": cid,
            "job_id": j["id"],
            "backend": (jobstore.get(j["id"]) or {}).get("backend"),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "sources": [{"clip_id": s, **reg["by_source"].get(s, {"merged": True})}
                        for s in src_list],
            "photos": list(photos or []),
            "merge_label": merge_label(len(src_list), len(photos or []), reg["dropped_sources"]),
            **quality_provenance,
            "splat_runs": m.get("reconstruction", {}).get("splat_runs", []),
        }
        _t = mf.with_suffix(".json.tmp"); _t.write_text(json.dumps(m, indent=1)); os.replace(_t, mf)
    rebuild_index()
    browser_gate(j["id"], "model", cid)
    return preset_name


def phased_splat_job_spec(parent_spec: dict, cid: str) -> dict:
    """Return the immutable follow-up request, with legacy queue compatibility."""
    followup = dict(parent_spec.get("splat") or {})
    if not followup:
        followup = {
            "clip_id": cid,
            "preset": str(parent_spec.get("splat_preset") or "cinematic"),
            "backend": parent_spec.get("splat_backend"),
            "resolution": parent_spec.get("splat_resolution"),
            "best_available": parent_spec.get("best_available", True) is not False,
        }
    followup.update({
        "clip_id": cid,
        "scene_id": parent_spec.get("scene_id"),
        "version_id": parent_spec.get("version_id") or cid,
    })
    return followup


def run_3d(j: dict):
    cid = j["spec"]["clip_id"]
    sources = j["spec"].get("sources") or [cid]
    photos = j["spec"].get("photos") or []
    build_3d_assets(j, cid, j["spec"].get("preset", "estandar"),
                    str(j["spec"].get("title", ""))[:80].strip(),
                    sources=sources, photos=photos)
    jobstore.update(j["id"], progress=1.0)
    extra = ""
    if len(sources) > 1 or photos:
        extra = f" (fusión de {len(sources)} videos" + (f" + {len(photos)} fotos" if photos else "") + ")"
    # ¿fusión parcial? (una fuente no co-registró) — el modelo NO es "mejor por combinar"
    partial = []
    mm = {}
    try:
        mm = json.loads((VAULT / "models" / cid / "meta.json").read_text())
        partial = mm.get("partial_merge") or []
    except (ValueError, OSError):
        pass
    if partial:
        extra = f" · ⚠ {len(partial)} fuente(s) no fusionaron (mira el reporte)"
    if j["spec"].get("scene_id") and mm:
        mm["scene_id"] = j["spec"]["scene_id"]
        mm["scene_version"] = j["spec"].get("version_id") or cid
        meta_path = VAULT / "models" / cid / "meta.json"
        tmp_meta = meta_path.with_suffix(".json.tmp")
        tmp_meta.write_text(json.dumps(mm, indent=1))
        os.replace(tmp_meta, meta_path)
        version = record_scene_completion(j, mm)
        site_manifest = rebuild_scene_manifest(cid)
        if version and site_manifest and site_manifest.get("coverage"):
            version = scenestore.update_version(
                j["spec"]["scene_id"], cid,
                coverage_products=site_manifest["coverage"]["shapes"]["circle"])
        rebuild_index()
        jobstore.event(j["id"], "scene_version_ready" if version and version.get("status") == "ready" else "scene_version_not_promoted",
                       f"Versión {cid}: {version.get('status') if version else 'sin escena'}",
                       level="warning" if partial else "info",
                       data={"scene_id": j["spec"]["scene_id"], "version_id": cid,
                             "merge_label": (mm.get("reconstruction") or {}).get("merge_label")})
    jobstore.end(j["id"], "done", f"modelo 3D de {cid} listo{extra} — míralo en el tab 3D",
                 artifact=f"models/{cid}/meta.json")
    # phased: gaussian al terminar — pero NO sobre una fusión parcial (§gate del review)
    if j["spec"].get("then_splat"):
        if partial:
            print(f"  splat phased OMITIDO: fusión parcial ({partial}) — reprocesa con otras fuentes", flush=True)
        else:
            try:
                jobstore.enqueue("splat", cid, phased_splat_job_spec(j["spec"], cid))
                print(f"  encolado gaussian splat para {cid} (phased)", flush=True)
            except Exception as e:
                print(f"  no se pudo encolar el splat phased: {e}", flush=True)


def run_splat_cuda(j: dict, proj: Path, cid: str, stage: Path, tmp_out: Path,
                   iters: int, downscale: int = 1, *, train_args: list | None = None,
                   reuse_dataset: bool = False, timeout_s: int = 4 * 3600,
                   resume_checkpoint: str | None = None,
                   resume_step: int | None = None) -> dict:
    """Run one strict CUDA resolution attempt and return measured evidence."""
    import gpu_lane
    from ply2splat import ply_to_splat

    name = f"job-{j['id'].replace('_', '-')[:40]}"
    info = {}
    try:
        info = gpu_lane.probe()
        jobstore.event(j["id"], "cuda_lane", f"nodo GPU verificado: torch {info['torch']} · "
                       f"gsplat {info['gsplat']}", data=info)
        image_cache = gpu_lane.image_cache_policy(
            proj, downscale, info.get("vram_total_mb") or 0)
        effective_train_args = gpu_lane.with_image_cache_policy(train_args, image_cache)
        jobstore.event(
            j["id"], "cuda_image_cache",
            f"cache de {image_cache['images']} imágenes en {image_cache['device'].upper()} · "
            f"{image_cache['decoded_mib']} MiB decodificados · entrada d{downscale}",
            data=image_cache)
        if not reuse_dataset:
            # Puente de poses: export OpenSfM→COLMAP medido con error sub-GSD.
            ds = stage / "cuda-ds"
            if ds.exists():
                shutil.rmtree(ds)
            ds.mkdir(parents=True)
            (ds / "images").symlink_to(proj / "images")
            r = subprocess.run([DOCKER, "run", "--rm", "-v", f"{proj}:/datasets/code",
                                "--entrypoint", "/code/SuperBuild/install/bin/opensfm/bin/opensfm",
                                "opendronemap/odm", "export_colmap", "/datasets/code/opensfm"],
                               capture_output=True, text=True, timeout=900)
            if r.returncode != 0:
                raise RuntimeError(f"export_colmap falló: {(r.stderr or r.stdout)[-300:]}")
            exported = next((d for d in [proj / "opensfm" / "colmap_export",
                                         proj / "colmap_export"]
                             if (d / "cameras.txt").exists()), None)
            if exported is None:
                hits = list(proj.rglob("cameras.txt"))
                exported = hits[0].parent if hits else None
            if exported is None:
                raise RuntimeError("export_colmap no produjo cameras.txt en el proyecto")
            sp = ds / "sparse" / "0"
            sp.mkdir(parents=True)
            for filename in ("cameras.txt", "images.txt", "points3D.txt"):
                shutil.copy2(exported / filename, sp / filename)
            jobstore.update(j["id"], detail=f"enviando dataset al nodo CUDA ({iters} iters)",
                            stage="transfer", progress=0.15)
            gpu_lane.ship_dataset(ds, name)

        gpu_lane.prep_dataset(name, downscale)
        jobstore.update(j["id"],
                        detail=f"entrenando {iters} iteraciones en NVIDIA CUDA · entrada d{downscale}",
                        stage="train", progress=0.3, backend="NVIDIA CUDA")
        run_id = f"gpu-{int(time.time())}"
        resume_checkpoint = gpu_lane.validate_resume_checkpoint(resume_checkpoint)
        if resume_checkpoint:
            jobstore.event(j["id"], "cuda_resumed",
                           f"reanudando checkpoint exacto desde paso {int(resume_step or 0):,}",
                           data={"step": int(resume_step or 0), "downscale": downscale})
        gpu_lane.install_train_script(name, iters, downscale, run_id,
                                      train_args=effective_train_args,
                                      resume_checkpoint=resume_checkpoint)
        t0 = time.time()
        rc = jobstore.run_tracked(
            j["id"], gpu_lane.train_argv(name, iters, downscale, run_id,
                                          train_args=effective_train_args),
            timeout=timeout_s, tail=80,
            progress_re=r"\((\d+)(?:\.\d+)?%\)", progress_span=(0.3, 0.76))
        if rc != 0:
            log = (jobstore.get(j["id"]) or {}).get("log", "")
            if _cancelled(j["id"]):
                log += "\ncancelled by user"
            kind = gpu_lane.classify_cuda_failure(rc, log)
            checkpoint = gpu_lane.archive_latest_checkpoint(name, j["id"])
            if checkpoint:
                jobstore.event(j["id"], "cuda_checkpoint",
                               f"checkpoint {checkpoint['step']:,} preservado para recuperación",
                               level="warning", data=checkpoint)
            raise gpu_lane.CudaLaneError(kind, f"ns-train CUDA falló ({kind}, rc={rc})",
                                         rc=rc, checkpoint=checkpoint)

        m = {"train_s": round(time.time() - t0, 1)}
        jobstore.update(j["id"], detail="exportando y trayendo el splat CUDA",
                        stage="publish", progress=0.8)
        m.update(gpu_lane.finalize_train(name, run_id))
        ply = gpu_lane.fetch(name, stage)
        conv = ply_to_splat(ply, tmp_out)
        ply.unlink()
        gpu_lane.cleanup(name, success=True)
        measured = {
            **m, **conv,
            "effective_downscale": downscale,
            "remote_gpu": info.get("gpu"),
            "remote_driver": info.get("driver"),
            "torch": info.get("torch"),
            "cuda_runtime": info.get("cuda_runtime"),
            "gsplat": info.get("gsplat"),
            "wsl_free_bytes": info.get("wsl_free_bytes"),
            "bridge_free_bytes": info.get("bridge_free_bytes"),
            "image_cache": image_cache,
            "trainer_args": effective_train_args,
            "resumed_from_step": int(resume_step or 0) if resume_checkpoint else None,
        }
        jobstore.event(j["id"], "cuda_trained",
                       f"{iters} iters d{downscale} en {m['train_s']}s · "
                       f"{conv['gaussians']} gaussianas · pico {m.get('remote_peak_vram_mib', 0)} MiB",
                       data=measured)
        return measured
    except gpu_lane.CudaLaneError:
        try:
            gpu_lane.cleanup(name, success=False)
        except Exception:
            pass
        raise
    except Exception as exc:
        try:
            gpu_lane.cleanup(name, success=False)
        except Exception:
            pass
        kind = gpu_lane.classify_cuda_failure(getattr(exc, "returncode", None), str(exc))
        raise gpu_lane.CudaLaneError(kind, str(exc),
                                    rc=getattr(exc, "returncode", None)) from exc


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
    if not (proj / "opensfm" / "image_list.txt").exists():
        if not j["spec"].get("auto_model"):
            raise RuntimeError("primero procesa el vuelo en 3D (necesita las poses de ODM)")
        model_preset = str(j["spec"].get("model_preset") or "estandar")
        jobstore.update(j["id"], detail=f"preparando modelo base ODM {model_preset} para gaussian splat",
                        stage="model-base", progress=0.03)
        build_3d_assets(j, cid, model_preset,
                        str(j["spec"].get("title") or f"{cid} · splat base")[:80].strip())
        proj = VAULT / "odm" / f"proj_{cid}"
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
    requested = resolve_splat_spec(j.get("spec") or {})
    requested_key = requested["key"]
    attempt_plan = splat_attempt_plan(j.get("spec") or {})
    train_start = time.time()
    peak = None
    rc = -1
    attempts = []
    effective = requested
    effective_d = 1
    backend = None
    cuda_quality = None
    is_cuda = str(j["spec"].get("backend") or "").lower() == "cuda"
    cuda_metrics = {}
    effective_train_args = []
    if is_cuda:
        import gpu_lane
        iters = int(requested["iters"])
        cuda_args = list((requested.get("cuda") or {}).get("train_args") or [])
        effective_train_args = list(cuda_args)
        resolution = normalize_splat_request(j.get("spec") or {})["resolution"]
        resume_checkpoint = j["spec"].get("resume_checkpoint")
        resume_step = int(j["spec"].get("resume_step") or 0)
        resume_downscale = int(j["spec"].get("resume_downscale") or 1)
        for attempt_no, policy in enumerate(attempt_plan, start=1):
            effective_d = int(policy["d"])
            label = (f"{requested['label']} · NVIDIA CUDA · entrada "
                     f"{'completa' if effective_d == 1 else 'media'} · "
                     f"intento {attempt_no}/{len(attempt_plan)}")
            if attempt_no > 1:
                jobstore.update(j["id"], status="running", finished=None, pid=None,
                                detail=label, stage="train", progress=0.15)
            jobstore.event(j["id"], "cuda_attempt", label,
                           level="warning" if attempt_no > 1 else "info",
                           data={"attempt": attempt_no, "preset": requested_key,
                                 "iters": iters, "d": effective_d,
                                 "resolution": resolution, "backend_policy": "strict"})
            attempt_start = time.time()
            try:
                cm = run_splat_cuda(
                    j, proj, cid, stage, tmp_out, iters, effective_d,
                    train_args=cuda_args, reuse_dataset=attempt_no > 1,
                    timeout_s=int(requested.get("timeout") or 4 * 3600),
                    resume_checkpoint=(resume_checkpoint if attempt_no == 1
                                       and effective_d == resume_downscale else None),
                    resume_step=(resume_step if attempt_no == 1
                                 and effective_d == resume_downscale else None),
                )
            except gpu_lane.CudaLaneError as exc:
                attempt_row = {
                    "attempt": attempt_no, "preset": requested_key, "d": effective_d,
                    "reason": policy["reason"], "rc": exc.rc,
                    "failure": exc.kind, "duration_s": round(time.time() - attempt_start, 1),
                    "backend": "NVIDIA CUDA", "will_retry":
                    bool(attempt_no < len(attempt_plan)
                         and gpu_lane.should_retry_cuda(exc.kind, resolution, effective_d)),
                }
                if exc.checkpoint:
                    attempt_row["checkpoint_step"] = exc.checkpoint.get("step")
                    attempt_row["resume_available"] = True
                attempts.append(attempt_row)
                jobstore.event(j["id"], "cuda_attempt_failed",
                               f"{label} falló: {exc.kind}",
                               level="warning" if attempt_row["will_retry"] else "error",
                               data=attempt_row)
                if attempt_row["will_retry"] and not _cancelled(j["id"]):
                    continue
                raise RuntimeError(
                    f"CUDA estricto falló ({exc.kind}) en {requested['label']} d{effective_d}: {exc}"
                ) from exc
            rc = 0
            cuda_metrics = cm
            effective_train_args = list(cm.get("trainer_args") or cuda_args)
            attempt_row = {
                "attempt": attempt_no, "preset": requested_key, "d": effective_d,
                "reason": policy["reason"], "rc": 0,
                "duration_s": cm.get("train_s"),
                "peak_mib": cm.get("remote_peak_vram_mib"),
                "peak_source": "nvidia-smi", "backend": "NVIDIA CUDA",
            }
            attempts.append(attempt_row)
            jobstore.event(j["id"], "cuda_attempt_succeeded", label, data=attempt_row)
            backend = {
                "device": "NVIDIA CUDA",
                "note": f"{iters} iters en {cm.get('remote_gpu') or 'GPU remota'} ({cm['train_s']}s)",
            }
            size = tmp_out.stat().st_size
            reasons = []
            if size < 200_000:
                reasons.append(f"archivo muy pequeño ({size} bytes) — escena insuficiente")
            if n_cams < 8:
                reasons.append(f"solo {n_cams} cámaras — vuela una órbita con más solape (>=8)")
            cuda_quality = {
                "passed": not reasons, "reason": " · ".join(reasons) or "ok",
                "bytes": size, "cameras": n_cams, "final_loss": None,
                "last_step": iters, "steps_logged": 0, "target_iters": iters,
            }
            break
    if not is_cuda:
      for attempt_no, policy in enumerate(attempt_plan, start=1):
          effective = resolve_splat_spec({"preset": policy["preset"]})
          effective_d = int(policy["d"])
          iters = int(effective["iters"])
          backend = choose_splat_backend(iters, force_cpu=bool(j["spec"].get("force_cpu")))
          if not backend["bin"].exists():
              raise RuntimeError(f"opensplat no está compilado: {backend['bin']}")
          # tracker NUEVO por intento: el sidecar debe registrar el peak de la corrida
          # que PUBLICÓ, no el máximo contaminado por los escalones OOM anteriores
          peak = PeakTracker(adaptive_priority())
          train_args = list(effective.get("train_args") or [])
          if effective_d > 1:
              train_args += ["-d", str(effective_d)]
          effective_train_args = list(train_args)
          if tmp_out.exists():
              tmp_out.unlink()
          label = (f"{effective['label']} · entrada {'-d ' + str(effective_d) if effective_d > 1 else 'completa'}"
                   f" · intento {attempt_no}/{len(attempt_plan)}")
          if attempt_no > 1:
              jobstore.update(j["id"], status="running", finished=None,   # run_tracked ya marcó error
                              detail=f"Sin memoria → {label} ({backend['device']})",
                              stage="train", progress=0.1)
              print(f"  OpenSplat OOM (-9) → {label}", flush=True)
          else:
              jobstore.update(j["id"], detail=f"{label} sobre {n_cams} cámaras ({backend['device']})",
                              stage="train", progress=0.1)
          jobstore.event(j["id"], "splat_attempt", label,
                         level="warning" if attempt_no > 1 else "info",
                         data={"attempt": attempt_no, "total_attempts": len(attempt_plan),
                               "requested_preset": requested_key,
                               "effective_preset": effective["key"], "d": effective_d,
                               "reason": policy["reason"], "backend": backend["device"]})
          attempt_start = time.time()
          try:
              # --sh-degree-interval > iters: el salto de armónicos esféricos del step
              # 1000 era lo que hacía divergir el loss a nan en CPU (3 corridas murieron
              # justo después). El formato .splat ni siquiera exporta los coeficientes
              # SH, así que entrenar solo el grado 0 no pierde nada y es estable.
              rc = jobstore.run_tracked(j["id"],
                  opensplat_train_cmd(proj, tmp_out, iters, backend, train_args),
                  # tail=60 (default 12): OpenSplat termina con líneas de save/export — con tail
                  # corto el gate se quedaba SIN líneas 'Step' y saltaba los checks de convergencia
                  tail=60,
                  timeout=int(effective.get("timeout") or 4 * 3600), abort_re=r"Step \d+: nan",
                  progress_re=r"\((\d+)%\)",
                  env={**os.environ, "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)},
                  tick=peak)
          except RuntimeError as e:
              if "abortado" in str(e):
                  # una vez el loss es nan los pesos no se recuperan: seguir es quemar CPU
                  raise RuntimeError("el entrenamiento divergió (loss=nan) — se abortó para no quemar "
                                     "horas de CPU. Reintenta: la inicialización aleatoria suele converger.")
              raise
          attempt_row = {"attempt": attempt_no, "preset": effective["key"], "d": effective_d,
                         "reason": policy["reason"], "rc": rc,
                         "duration_s": round(time.time() - attempt_start, 1),
                         "peak_mib": peak.peak_mib, "peak_source": peak.peak_source}
          attempts.append(attempt_row)
          if rc == 0:
              jobstore.event(j["id"], "splat_attempt_succeeded",
                             f"{effective['label']} -d {effective_d} completó",
                             data={**attempt_row, "requested_preset": requested_key,
                                   "backend": backend["device"]})
          else:
              jobstore.event(j["id"], "splat_attempt_failed",
                             f"{effective['label']} -d {effective_d} terminó con rc={rc}"
                             + (" (OOM)" if rc == -9 else ""),
                             level="warning" if rc == -9 and attempt_no < len(attempt_plan) else "error",
                             data={**attempt_row, "requested_preset": requested_key,
                                   "backend": backend["device"], "will_retry":
                                   bool(rc == -9 and attempt_no < len(attempt_plan))})
          if rc == -9 and attempt_no < len(attempt_plan) and not _cancelled(j["id"]):
              perf.log_error("opensplat-oom", f"OOM en intento {attempt_no} ({effective['key']} -d{effective_d})",
                             ctx={"cid": cid, "requested_preset": requested_key,
                                  "effective_preset": effective["key"], "attempt": attempt_no,
                                  "d": effective_d,
                                  "peak_mib": peak.peak_mib, "peak_source": peak.peak_source,
                                  "cap_mib": OPENSPLAT_MEMORY_MIB})
              continue
          break
    if rc != 0:
        raise RuntimeError(f"opensplat salió con código {rc}"
                           + (" (sin memoria en todos los intentos permitidos)"
                              if rc == -9 else ""))
    quality = cuda_quality or splat_quality(tmp_out, (jobstore.get(j["id"]) or {}).get("log", ""),
                            n_cams, int(effective["iters"]))
    quality.update({
        "preset": effective["key"],
        "preset_label": effective["label"],
        "requested_preset": requested_key,
        "effective_preset": effective["key"],
        "input_scale": effective_d,
        # en el lane CUDA -d2 es la config de diseño, no la escalera OOM de Metal:
        # solo cuenta como fallback lo que degradó respecto a lo pedido
        "fallback": (requested_key != effective["key"] or effective_d != 1),
        "attempts": attempts,
        "backend": backend["device"],
        "backend_note": backend["note"],
        "duration_s": round(time.time() - train_start, 1),
        # peak de la corrida publicada — el eje X del sweep de densificación (Phase 2.5)
        # y el campo peak_memory del futuro splat_runs[] naciendo en el schema semilla
        "peak_mib": (cuda_metrics.get("remote_peak_vram_mib") if is_cuda
                     else peak.peak_mib if peak else 0),
        "peak_source": "nvidia-smi" if is_cuda else peak.peak_source if peak else None,
        "mem_cap_mib": OPENSPLAT_MEMORY_MIB,
        # sin esto, un run con caps heurísticos (mismatch de RAM) sería indistinguible
        # de uno calibrado — contaminación que la baseline de Phase 1 no puede permitirse
        "caps_provisional": bool(_HWCFG.get("provisional")),
        "requested_iterations": int(requested["iters"]),
        "requested_backend": "cuda" if is_cuda else j["spec"].get("backend"),
        "effective_backend": backend["device"],
        "backend_policy": j["spec"].get("backend_policy") or ("strict" if is_cuda else "best_available"),
        "resolution": j["spec"].get("resolution"),
        "requested_downscale": j["spec"].get("requested_downscale"),
        "effective_downscale": effective_d,
        "effective_resolution": "full" if effective_d == 1 else "half",
        "remote_gpu": cuda_metrics.get("remote_gpu"),
        "remote_driver": cuda_metrics.get("remote_driver"),
        "cuda_runtime": cuda_metrics.get("cuda_runtime"),
        "torch": cuda_metrics.get("torch"),
        "gsplat": cuda_metrics.get("gsplat"),
        "telemetry_samples": cuda_metrics.get("telemetry_samples"),
        "remote_peak_vram_mib": cuda_metrics.get("remote_peak_vram_mib"),
        "image_cache_device": (cuda_metrics.get("image_cache") or {}).get("device"),
        "decoded_image_cache_mib": (cuda_metrics.get("image_cache") or {}).get("decoded_mib"),
        "gpu_cache_budget_mib": (cuda_metrics.get("image_cache") or {}).get("gpu_cache_budget_mib"),
        "resumed_from_step": cuda_metrics.get("resumed_from_step"),
    })
    quality["trainer"] = "nerfstudio-splatfacto" if is_cuda else "opensplat"
    quality["trainer_args"] = effective_train_args
    params = {
        "trainer": quality["trainer"], "preset": effective["key"],
        "iters": int(effective["iters"]), "downscale": effective_d,
        "args": effective_train_args,
    }
    quality["params_hash"] = hashlib.sha256(
        json.dumps(params, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    quality["stage_timings"] = job_stage_timings(j["id"])
    if not quality["passed"]:
        raise RuntimeError(quality["reason"])
    final_out = publish_splat_stage(stage, cid, quality, splat_dir)
    # entity U0: cada run publicado queda en reconstruction.splat_runs del modelo —
    # el historial con peak/preset/backend/caps_provisional que la UI (U3.2) renderiza
    # y que el modelo de memoria consume como dataset (proyectado-vs-observado)
    mf = VAULT / "models" / cid / "meta.json"
    if mf.exists():
        try:
            m = json.loads(mf.read_text())
            recon = m.setdefault("reconstruction", {"id": cid, "splat_runs": []})
            runs = recon.setdefault("splat_runs", [])
            runs.append(splat_run_record(j["id"], quality))
            del runs[:-10]                            # historial acotado, como splats/history
            _t = mf.with_suffix(".json.tmp"); _t.write_text(json.dumps(m, indent=1)); os.replace(_t, mf)
        except (ValueError, OSError) as e:
            print(f"  splat_runs no actualizado ({e}) — el sidecar sigue siendo la fuente", flush=True)
    jobstore.update(j["id"], detail="limpiando floaters de los bordes", progress=0.93)
    crop_floaters(final_out)                    # de-halo antes de generar el SOG
    jobstore.update(j["id"], detail="comprimiendo SOG para el viewer", progress=0.94)
    viewer_out = export_viewer_sog(final_out) or final_out
    rebuild_scene_manifest(cid)
    rebuild_index()
    browser_gate(j["id"], "splat", cid, timeout=90)
    if j["spec"].get("scene_id"):
        try:
            scene = scenestore.get_scene(j["spec"]["scene_id"])
            version_id = j["spec"].get("version_id") or cid
            version = next(v for v in scene["versions"] if v["id"] == version_id)
            metrics = dict(version.get("metrics") or {})
            metrics["splat"] = {k: quality.get(k) for k in
                                ("requested_preset", "effective_preset", "requested_iterations",
                                 "target_iters", "requested_backend", "effective_backend",
                                 "backend_policy", "resolution", "requested_downscale",
                                 "effective_downscale", "effective_resolution", "input_scale",
                                 "final_loss", "peak_mib", "remote_peak_vram_mib", "mem_cap_mib",
                                 "remote_gpu", "image_cache_device", "decoded_image_cache_mib",
                                 "gpu_cache_budget_mib", "resumed_from_step", "trainer",
                                 "params_hash", "backend", "fallback")}
            scenestore.update_version(scene["id"], version_id, metrics=metrics)
            # The first rebuild was needed for browser_gate; publish the new scene metrics too.
            rebuild_index()
        except (KeyError, ValueError, OSError, StopIteration) as e:
            print(f"  scene splat metrics no actualizados: {e}", flush=True)
    jobstore.update(j["id"], progress=1.0)
    jobstore.end(j["id"], "done", splat_done_detail(viewer_out, quality, n_cams),
                 artifact=f"splats/{viewer_out.name}")


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
    # auto-sana el manifest: si un SIGKILL cayó a media publicación (entre publicar el .splat y el
    # rebuild final, ventana de segundos por crop+ksplat), system.json quedó con stats del splat
    # ANTERIOR mientras el disco ya tiene el nuevo. launchd reinicia el worker → reconciliamos aquí.
    try:
        rebuild_index()
    except Exception as e:
        print(f"rebuild_index de arranque falló (no fatal): {e}", flush=True)
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
            if (j.get("spec") or {}).get("scene_id") and j["kind"] == "3d":
                try:
                    scenestore.update_version(j["spec"]["scene_id"],
                                              j["spec"].get("version_id") or j["spec"].get("clip_id"),
                                              status="failed", completed_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                                              job_id=j["id"])
                except (KeyError, ValueError, OSError):
                    pass
            print(f"✗ {j['id']}: {e}", flush=True)
            # stage huérfano de un splat fallido: cientos de MB que antes vivían hasta el
            # próximo reinicio del worker (KeepAlive ≈ nunca)
            shutil.rmtree(VAULT / "splats" / ".training" / j["id"], ignore_errors=True)


if __name__ == "__main__":
    main()
