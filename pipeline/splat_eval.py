"""Eval harness held-out para splats (Phase 1): split → train → render → score.

El principio (aprendido a la mala en multi-source): "se ve mejor" no es evidencia.
Un splat solo se evalúa contra vistas que el entrenamiento JAMÁS vio, renderizadas
desde sus poses conocidas y comparadas contra la ground truth con PSNR/SSIM/LPIPS.

Piezas:
  make_split  — cirugía determinista de reconstruction.json (seed = clip_id, así el
                MISMO split se reusa entre runs de la misma escena → comparabilidad).
                Los shots de test salen del entrenamiento; NO se etiquetan manifests
                porque OpenSplat itera reconstruction.shots, no image_list.
  train       — entrena sobre el dir train con el MISMO comando del pipeline
                (opensplat_train_cmd: incluye el workaround SH=0 — la baseline mide
                lo que SHIPPEA hoy, no una variante idealizada). Salida .ply
                (loadPly no lee .splat). Peak RSS muestreado como en producción.
  render      — modo --render-cameras (patch local a OpenSplat): carga el modelo y
                emite pares render/GT de las cámaras test. La GT sale del MISMO
                camino interno del trainer (cv::undistort + tensor) — comparar
                contra frames crudos daría métricas falsas por la distorsión Brown.
  score       — PSNR/SSIM a resolución completa; LPIPS (AlexNet, MPS) con lado
                máximo 1024 (activaciones a 3072px no caben — documentado en el
                eval block). 3 side-by-side GT|render|diff para QA de ojo.

Todo run queda en vault/eval/<cid>/<run_id>/run.json con params_hash — un número
sin su contexto de medición no es un dato.

Uso:
    python3 splat_eval.py run <cid> [preset] [--cpu]
    python3 splat_eval.py score <render_dir>
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

VAULT = Path("/Volumes/SSD/drone-vault")

from worker import (PeakTracker, choose_splat_backend, opensplat_train_cmd,
                    OPENSPLAT_MEMORY_MIB, LIBTORCH_LIB, _HWCFG)
from splat_presets import SPLAT_PRESETS

MIN_TEST, MAX_TEST, TEST_FRAC = 8, 25, 0.10
LPIPS_MAX_SIDE = 1024


def _minimal_env() -> dict:
    """Env explícito y MÍNIMO para el trainer — jamás heredar la shell interactiva.

    Lección del P0 (11-jul): la shell de la sesión llevaba MallocNanoZone=0 (lo
    setea Claude Code) y cada nohup lo heredó; launchd no. No fue la causa del P0,
    pero fue contaminante confirmado del harness: los discriminadores comparaban
    entornos distintos sin saberlo. Un run de eval solo lleva lo que declara."""
    return {"PATH": "/usr/bin:/bin:/usr/sbin:/opt/homebrew/bin",
            "HOME": os.environ.get("HOME", "/tmp"),
            "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)}


def _source_of(name: str) -> str:
    """Prefijo de fuente multi-source ('s0_', 's1_', 'ph_') o '' para single-source."""
    import re
    m = re.match(r"^(s\d+_|ph_)", name)
    return m.group(1) if m else ""


def _pick_even(names: list, k: int, seed_key: str) -> set:
    """k nombres espaciados uniformemente con offset determinista del seed."""
    n = len(names)
    if k >= n:
        return set(names)
    stride = n / k
    offset = int(hashlib.sha1(seed_key.encode()).hexdigest(), 16) % max(1, int(stride))
    idx: list = []
    for j in range(k):
        i = (int(j * stride) + offset) % n
        while i in idx:
            i = (i + 1) % n
        idx.append(i)
    return {names[i] for i in idx}


def make_split(proj: Path, out_root: Path, seed_key: str) -> dict:
    """Parte reconstruction.json en train/test dirs mínimos (solo el JSON +
    image_list; las imágenes se leen de las rutas originales). Determinista.

    Multi-source: el split se ESTRATIFICA por fuente (s0_/s1_/ph_) — muestrear
    uniforme sobre el total dejaría los test views en el clip dominante y el
    PSNR global escondería que las vistas de una fuente rinden 5 dB peor
    (la versión eval del falso 82%). Cada fuente aporta ≥2 vistas test
    (dejando ≥2 de train), proporcional a su tamaño."""
    src = proj / "opensfm" / "reconstruction.json"
    recons = json.loads(src.read_text())
    shots_all = sorted(n for r in recons for n in r.get("shots", {}))
    n = len(shots_all)
    if n < 12:
        raise SystemExit(f"{n} shots — muy pocos para un split honesto (mínimo 12)")
    n_test = max(MIN_TEST, min(MAX_TEST, round(n * TEST_FRAC)))
    groups: dict = {}
    for s in shots_all:
        groups.setdefault(_source_of(s), []).append(s)
    if len(groups) == 1:
        test = _pick_even(shots_all, n_test, seed_key)
    else:
        test = set()
        for pfx, names in sorted(groups.items()):
            quota = max(2, round(n_test * len(names) / n))
            quota = min(quota, max(0, len(names) - 2))   # cada fuente conserva ≥2 train
            test |= _pick_even(names, quota, seed_key + pfx)

    il_src = proj / "opensfm" / "image_list.txt"
    il_txt = il_src.read_text().replace("/datasets/code", str(proj))
    for part, keep in (("train", lambda s: s not in test), ("test", lambda s: s in test)):
        d = out_root / part
        d.mkdir(parents=True, exist_ok=True)
        pruned = []
        for r in recons:
            shots = {k: v for k, v in r.get("shots", {}).items() if keep(k)}
            if shots:
                pruned.append({**r, "shots": shots})
        (d / "reconstruction.json").write_text(json.dumps(pruned))
        (d / "image_list.txt").write_text(il_txt)
    split = {"seed_key": seed_key, "n_total": n, "n_train": n - len(test),
             "n_test": len(test), "test_views": sorted(test)}
    if len(groups) > 1:
        split["by_source"] = {pfx or "(sin prefijo)": {
            "total": len(names), "test": sum(1 for t in test if _source_of(t) == pfx)}
            for pfx, names in sorted(groups.items())}
    (out_root / "split.json").write_text(json.dumps(split, indent=1))
    return split


# NO tocar los train_args del preset: la baseline reproduce el comando shipped
# VERBATIM. La primera versión quitaba --save-every por "limpieza" y ese mismo
# run OOM'eó donde producción había pasado — desviación no controlada. Los saves
# intermedios caen dentro del run dir del eval y se limpian al final.


# ESPEJO de la cadena OOM de producción (worker.run_splat): la baseline mide lo
# que SHIPPEA — y "Render ultra" shipped es ultra-que-degrada-solo, no ultra-o-muerte.
# El primer intento de baseline sin escalones OOM'eó con 22 cámaras (rc=-9): la
# memoria depende del CONTENIDO de la escena, no del nº de cámaras.
RUNGS = ([], ["-d", "2"], ["-d", "2", "--densify-grad-thresh", "0.0006"])
RUNG_LB = ("full", "media resolución", "media resolución + densificación acotada")


def train(train_dir: Path, out_ply: Path, preset_key: str, force_cpu: bool = False) -> dict:
    preset = SPLAT_PRESETS[preset_key]
    iters = int(preset["iters"])
    backend = choose_splat_backend(iters, force_cpu=force_cpu)
    base_args = list(preset.get("train_args") or [])
    env = _minimal_env()
    attempts = []
    for rung, extra in enumerate(RUNGS):
        cmd = opensplat_train_cmd(train_dir, out_ply, iters, backend, base_args + extra)
        peak = PeakTracker()
        t0 = time.time()
        # stdout a archivo, NO a DEVNULL: un rc=1 sin el mensaje del trainer es
        # in-diagnosticable (aprendido con el experimento watermark)
        tlog = open(out_ply.parent / f"train-rung{rung}.log", "w")
        proc = subprocess.Popen(cmd, env=env, stdout=tlog,
                                stderr=subprocess.STDOUT, start_new_session=True)
        timeout = time.time() + int(preset.get("timeout") or 4 * 3600)
        while proc.poll() is None:
            if time.time() > timeout:
                proc.kill()
                raise SystemExit(f"train timeout ({preset_key})")
            peak(proc.pid)
            time.sleep(5)
        rec = {"rung": rung, "rung_label": RUNG_LB[rung], "rc": proc.returncode,
               "duration_s": round(time.time() - t0, 1), "peak_mib": peak.peak_mib,
               "peak_source": peak.peak_source}
        attempts.append(rec)
        if proc.returncode == 0:
            return {"cmd": cmd, "backend": backend["device"], "iters": iters,
                    "rung": rung, "rung_label": RUNG_LB[rung], "attempts": attempts,
                    "duration_s": rec["duration_s"], "peak_mib": peak.peak_mib,
                    "peak_source": peak.peak_source,
                    "mem_cap_mib": OPENSPLAT_MEMORY_MIB,
                    "caps_provisional": bool(_HWCFG.get("provisional"))}
        if proc.returncode != -9:
            raise SystemExit(f"opensplat rc={proc.returncode} (no-OOM, no se degrada)")
        print(f"  OOM escalón {rung} (peak {peak.peak_mib} MiB {peak.peak_source}) "
              f"→ {RUNG_LB[min(rung + 1, 2)]}", flush=True)
    raise SystemExit(f"OOM en los 3 escalones ({preset_key}): {attempts}")


def render(test_dir: Path, model_ply: Path, out_dir: Path, force_cpu: bool = False) -> int:
    backend = choose_splat_backend(1, force_cpu=force_cpu)
    cmd = [str(backend["bin"]), str(test_dir), "--resume", str(model_ply),
           "--render-cameras", str(out_dir)]
    if backend.get("cpu_flag"):
        cmd.append("--cpu")
    r = subprocess.run(cmd, env=_minimal_env(),
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise SystemExit(f"render-cameras rc={r.returncode}: {(r.stdout or '')[-300:]}")
    return len(list(out_dir.glob("*.render.png")))


def score(render_dir: Path, use_lpips: bool = True, side_by_side: int = 3) -> dict:
    """PSNR/SSIM full-res + LPIPS (lado máx 1024). Espera pares *.render.png/*.gt.png."""
    from PIL import Image
    from skimage.metrics import peak_signal_noise_ratio, structural_similarity
    pairs = []
    for rf in sorted(render_dir.glob("*.render.png")):
        gf = render_dir / rf.name.replace(".render.png", ".gt.png")
        if gf.exists():
            pairs.append((rf, gf))
    if not pairs:
        raise SystemExit(f"sin pares render/gt en {render_dir}")
    lpips_net = None
    if use_lpips:
        import torch
        import lpips as lpips_mod
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        lpips_net = lpips_mod.LPIPS(net="alex", verbose=False).to(dev)
    per_view = []
    for i, (rf, gf) in enumerate(pairs):
        ri = np.asarray(Image.open(rf).convert("RGB"))
        gi = np.asarray(Image.open(gf).convert("RGB"))
        if ri.shape != gi.shape:
            raise SystemExit(f"dimensiones distintas render/gt: {rf.name} {ri.shape} vs {gi.shape}")
        psnr = peak_signal_noise_ratio(gi, ri, data_range=255)
        psnr = min(float(psnr), 60.0)              # inf (idénticas) no es serializable
        ssim = float(structural_similarity(gi, ri, channel_axis=-1, data_range=255))
        row = {"view": rf.name.replace(".render.png", ""),
               "psnr": round(psnr, 2), "ssim": round(ssim, 4)}
        if lpips_net is not None:
            import torch
            scale = LPIPS_MAX_SIDE / max(ri.shape[:2])
            if scale < 1:
                h, w = (int(ri.shape[0] * scale), int(ri.shape[1] * scale))
                ri_l = np.asarray(Image.fromarray(ri).resize((w, h), Image.LANCZOS))
                gi_l = np.asarray(Image.fromarray(gi).resize((w, h), Image.LANCZOS))
            else:
                ri_l, gi_l = ri, gi
            to_t = lambda a: (torch.from_numpy(a.copy()).permute(2, 0, 1)[None].float()
                              / 127.5 - 1.0).to(next(lpips_net.parameters()).device)
            with torch.no_grad():
                row["lpips"] = round(float(lpips_net(to_t(ri_l), to_t(gi_l))), 4)
        per_view.append(row)
        if i < side_by_side:                       # GT | render | diff para QA de ojo
            diff = np.abs(gi.astype(int) - ri.astype(int)).astype(np.uint8)
            sxs = np.concatenate([gi, ri, diff], axis=1)
            Image.fromarray(sxs).save(render_dir / f"sxs_{i}_{row['view']}.jpg", quality=80)
    first = np.asarray(Image.open(pairs[0][0]))
    agg = {"n_test_views": len(per_view),
           # evidencia de la regla de resolución: el render sale SIEMPRE a resolución
           # GT completa (el modo render no hereda el -d del training) — un modelo
           # entrenado a media res paga su pérdida de detalle en el número
           "render_px": [int(first.shape[1]), int(first.shape[0])],
           "psnr": round(float(np.mean([v["psnr"] for v in per_view])), 2),
           "ssim": round(float(np.mean([v["ssim"] for v in per_view])), 4)}
    if lpips_net is not None:
        agg["lpips"] = round(float(np.mean([v["lpips"] for v in per_view])), 4)
        agg["lpips_max_side"] = LPIPS_MAX_SIDE
    agg["per_view"] = per_view
    return agg


def _trainer_context(force_cpu: bool = False) -> dict:
    """Versión del binario + hash del patch local: 'mismo trainer' debe ser
    verificable aunque OpenSplat se re-clone y el patch se reaplique sobre otra base."""
    backend = choose_splat_backend(1, force_cpu=force_cpu)
    try:
        v = subprocess.run([str(backend["bin"]), "--version"],
                           env={**os.environ, "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)},
                           capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        v = "unknown"
    patch = Path(__file__).resolve().parent.parent / "patches" / "opensplat-render-cameras.patch"
    return {"version": v, "binary": str(backend["bin"]), "device": backend["device"],
            "patch_sha": hashlib.sha1(patch.read_bytes()).hexdigest()[:12]
            if patch.exists() else None}


def _machine_load() -> dict:
    """Condición de carga al arrancar el run: el cap de 11000 fue calibrado con el
    sistema de producción vivo — una baseline con la máquina libre tiene headroom
    que producción no tendrá, y el 'knee' del sweep 2.5 depende de eso."""
    running = None
    try:
        import jobs
        running = [j["id"] for j in jobs.recent(10) if j.get("status") == "running"]
    except Exception:
        pass
    return {"load1": round(os.getloadavg()[0], 2), "worker_jobs_running": running}


def run(cid: str, preset_key: str = "cinematic", force_cpu: bool = False) -> Path:
    proj = VAULT / "odm" / f"proj_{cid}"
    if not (proj / "opensfm" / "reconstruction.json").exists():
        raise SystemExit(f"{proj} sin reconstruction.json — corre el 3D primero")
    run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{preset_key}"
    root = VAULT / "eval" / cid / run_id
    root.mkdir(parents=True)
    print(f"[{run_id}] split…", flush=True)
    split = make_split(proj, root, seed_key=cid)
    print(f"  {split['n_train']} train / {split['n_test']} test", flush=True)
    model = root / "model.ply"
    print(f"[{run_id}] train {preset_key}…", flush=True)
    tinfo = train(root / "train", model, preset_key, force_cpu)
    print(f"  {tinfo['duration_s']}s · peak {tinfo['peak_mib']} MiB ({tinfo['peak_source']})", flush=True)
    renders = root / "renders"
    print(f"[{run_id}] render vistas test…", flush=True)
    n = render(root / "test", model, renders, force_cpu)
    print(f"  {n} pares render/gt", flush=True)
    for inter in root.glob("model_*.ply"):
        inter.unlink()                              # saves intermedios de --save-every
    print(f"[{run_id}] score…", flush=True)
    ev = score(renders)
    # multi-source: métricas POR FUENTE — el PSNR global esconde que una fuente
    # rinda 5 dB peor (la versión eval del falso 82%)
    srcs = {_source_of(v["view"]) for v in ev["per_view"]}
    if len(srcs) > 1:
        ev["by_source"] = {}
        for s in sorted(srcs):
            vs = [v for v in ev["per_view"] if _source_of(v["view"]) == s]
            ev["by_source"][s or "(sin prefijo)"] = {
                "n": len(vs),
                "psnr": round(float(np.mean([v["psnr"] for v in vs])), 2),
                "ssim": round(float(np.mean([v["ssim"] for v in vs])), 4),
                # LPIPS per-fuente (pedido pre-2.0): la métrica que DECIDE también
                # debe leerse por composición, no solo PSNR/SSIM
                **({"lpips": round(float(np.mean([v["lpips"] for v in vs])), 4)}
                   if all("lpips" in v for v in vs) else {})}
    rec = {"run_id": run_id, "clip_id": cid, "preset": preset_key,
           "params_hash": hashlib.sha1(json.dumps(
               [tinfo["cmd"], split["test_views"]]).encode()).hexdigest()[:12],
           "trainer": _trainer_context(force_cpu),
           "machine_load": _machine_load(),
           "split": split, "train": tinfo, "eval": ev,
           "created": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    (root / "run.json").write_text(json.dumps(rec, indent=1))
    print(f"✅ PSNR {ev['psnr']} · SSIM {ev['ssim']}"
          + (f" · LPIPS {ev['lpips']}" if "lpips" in ev else "") + f" → {root}/run.json")
    return root


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "run" and len(a) >= 2:
        run(a[1], a[2] if len(a) > 2 and not a[2].startswith("--") else "cinematic",
            force_cpu="--cpu" in a)
    elif a and a[0] == "score" and len(a) >= 2:
        print(json.dumps(score(Path(a[1])), indent=1))
    else:
        raise SystemExit("uso: splat_eval.py run <cid> [preset] [--cpu] | score <render_dir>")
