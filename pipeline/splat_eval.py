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


def make_split(proj: Path, out_root: Path, seed_key: str) -> dict:
    """Parte reconstruction.json en train/test dirs mínimos (solo el JSON +
    image_list; las imágenes se leen de las rutas originales). Determinista."""
    src = proj / "opensfm" / "reconstruction.json"
    recons = json.loads(src.read_text())
    shots_all = sorted(n for r in recons for n in r.get("shots", {}))
    n = len(shots_all)
    if n < 12:
        raise SystemExit(f"{n} shots — muy pocos para un split honesto (mínimo 12)")
    n_test = max(MIN_TEST, min(MAX_TEST, round(n * TEST_FRAC)))
    stride = n / n_test
    offset = int(hashlib.sha1(seed_key.encode()).hexdigest(), 16) % max(1, int(stride))
    test_idx: list = []
    for k in range(n_test):
        i = (int(k * stride) + offset) % n
        while i in test_idx:
            i = (i + 1) % n
        test_idx.append(i)
    test = {shots_all[i] for i in test_idx}

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
    (out_root / "split.json").write_text(json.dumps(split, indent=1))
    return split


def _strip_save_every(args: list) -> list:
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
            continue
        if a == "--save-every":
            skip = True
            continue
        out.append(a)
    return out


def train(train_dir: Path, out_ply: Path, preset_key: str, force_cpu: bool = False) -> dict:
    preset = SPLAT_PRESETS[preset_key]
    iters = int(preset["iters"])
    backend = choose_splat_backend(iters, force_cpu=force_cpu)
    train_args = _strip_save_every(list(preset.get("train_args") or []))
    cmd = opensplat_train_cmd(train_dir, out_ply, iters, backend, train_args)
    peak = PeakTracker()
    t0 = time.time()
    env = {"DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)}
    proc = subprocess.Popen(cmd, env={**__import__("os").environ, **env},
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                            start_new_session=True)
    timeout = time.time() + int(preset.get("timeout") or 4 * 3600)
    while proc.poll() is None:
        if time.time() > timeout:
            proc.kill()
            raise SystemExit(f"train timeout ({preset_key})")
        peak(proc.pid)
        time.sleep(5)
    if proc.returncode != 0:
        raise SystemExit(f"opensplat rc={proc.returncode}"
                         + (" (OOM: cap de memoria)" if proc.returncode == -9 else ""))
    return {"cmd": cmd, "backend": backend["device"], "iters": iters,
            "duration_s": round(time.time() - t0, 1), "peak_rss_mib": peak.peak_mib,
            "mem_cap_mib": OPENSPLAT_MEMORY_MIB,
            "caps_provisional": bool(_HWCFG.get("provisional"))}


def render(test_dir: Path, model_ply: Path, out_dir: Path, force_cpu: bool = False) -> int:
    backend = choose_splat_backend(1, force_cpu=force_cpu)
    cmd = [str(backend["bin"]), str(test_dir), "--resume", str(model_ply),
           "--render-cameras", str(out_dir)]
    if backend.get("cpu_flag"):
        cmd.append("--cpu")
    r = subprocess.run(cmd, env={**__import__("os").environ,
                                 "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)},
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
    agg = {"n_test_views": len(per_view),
           "psnr": round(float(np.mean([v["psnr"] for v in per_view])), 2),
           "ssim": round(float(np.mean([v["ssim"] for v in per_view])), 4)}
    if lpips_net is not None:
        agg["lpips"] = round(float(np.mean([v["lpips"] for v in per_view])), 4)
        agg["lpips_max_side"] = LPIPS_MAX_SIDE
    agg["per_view"] = per_view
    return agg


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
    print(f"  {tinfo['duration_s']}s · peak {tinfo['peak_rss_mib']} MiB", flush=True)
    renders = root / "renders"
    print(f"[{run_id}] render vistas test…", flush=True)
    n = render(root / "test", model, renders, force_cpu)
    print(f"  {n} pares render/gt", flush=True)
    print(f"[{run_id}] score…", flush=True)
    ev = score(renders)
    rec = {"run_id": run_id, "clip_id": cid, "preset": preset_key,
           "params_hash": hashlib.sha1(json.dumps(
               [tinfo["cmd"], split["test_views"]]).encode()).hexdigest()[:12],
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
