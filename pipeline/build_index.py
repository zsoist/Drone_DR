"""Aggregate per-clip manifests into flights.json + system.json for the web app."""
import json
import math
import os
import re
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")


def dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def write_atomic(path: Path, text: str):
    """tmp + os.replace: la app lee estos manifests directo; un write parcial concurrente
    (worker + server llaman rebuild_index) los dejaría truncados y vaciaría la UI."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        tmp.write_text(text)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def load_models(models_dir: Path) -> list:
    """Un meta.json corrupto (write parcial) NO debe tumbar todo el índice: skip + log."""
    out = []
    if not models_dir.exists():
        return out
    for d in sorted(models_dir.iterdir()):
        mf = d / "meta.json"
        if not mf.exists():
            continue
        try:
            out.append(json.loads(mf.read_text()))
        except (ValueError, OSError) as e:
            print(f"  skip meta.json corrupto {d.name}: {e}", flush=True)
    return out


# el mismo entrenamiento puede tener .ksplat (optimizado) y .splat (fuente): UNA entrada por
# VERSIÓN, no una por formato. Importante: un clip puede tener varias versiones de splat
# (entrenos 2k/7k/15k, ediciones de SuperSplat, etc.) y la UI debe poder elegir entre todas.
SPLAT_PRIORITY = {".ksplat": 0, ".splat": 1, ".ply": 2}
HIST_RE = re.compile(r"^(?P<cid>.+)-(?P<date>\d{8})-(?P<time>\d{6})$")
SPLAT_PRESET_BY_ITERS = {
    1000: ("fast", "Fast"),
    2000: ("medium", "Medium"),
    7000: ("cinematic", "Cinematic"),
    15000: ("ultra", "Ultra"),
}


def _splat_stats(base: Path, stem: str) -> dict:
    """Calidad del splat para las tarjetas: cámaras/loss/iters del sidecar .meta.json +
    conteo de gaussianas derivado del .splat fuente (32 bytes/gaussiana exactos)."""
    out = {}
    meta_p = base / f"{stem}.meta.json"
    if meta_p.exists():
        try:
            m = json.loads(meta_p.read_text())
            if isinstance(m.get("cameras"), int):
                out["cameras"] = m["cameras"]
            loss = m.get("final_loss")
            if isinstance(loss, (int, float)) and math.isfinite(loss):
                out["loss"] = round(float(loss), 4)
            iters = m.get("last_step") or m.get("target_iters")
            if isinstance(iters, int):
                out["iters"] = iters
            if isinstance(m.get("preset"), str):
                out["preset"] = m["preset"]
            if isinstance(m.get("preset_label"), str):
                out["preset_label"] = m["preset_label"]
            if isinstance(m.get("backend"), str):
                out["backend"] = m["backend"]
        except (ValueError, OSError):
            pass
    if out.get("iters") in SPLAT_PRESET_BY_ITERS:
        key, label = SPLAT_PRESET_BY_ITERS[out["iters"]]
        out.setdefault("preset", key)
        out.setdefault("preset_label", label)
    src = base / f"{stem}.splat"     # si existe, da conteo exacto de gaussianas
    if src.exists():
        n = src.stat().st_size // 32
        if n > 0:
            out["gaussians"] = n
    return out


def _splat_version(stem: str) -> dict:
    m = HIST_RE.match(stem)
    if not m:
        return {"clip_id": stem, "version_id": stem, "current": True}
    d, t = m.group("date"), m.group("time")
    return {
        "clip_id": m.group("cid"),
        "version_id": stem,
        "current": False,
        "archived_at": f"{d[:4]}-{d[4:6]}-{d[6:8]} {t[:2]}:{t[2:4]}:{t[4:6]}",
    }


def all_splats(splat_dir: Path) -> list:
    if not splat_dir.exists():
        return []
    by_version = {}
    for base, prefix in ((splat_dir, ""), (splat_dir / "history", "history/")):
        if not base.exists():
            continue
        for p in sorted(base.glob("*")):
            # glob('*') SÍ incluye dotfiles: un '.upload-<cid>-<hex>.splat' huérfano (subida
            # cortada) se publicaría como splat FANTASMA e imborrable desde la UI.
            if p.name.startswith(".") or not (p.is_file() and p.suffix.lower() in SPLAT_PRIORITY):
                continue
            key = f"{prefix}{p.stem}"
            cur = by_version.get(key)
            if cur is None or SPLAT_PRIORITY[p.suffix.lower()] < SPLAT_PRIORITY[cur.suffix.lower()]:
                by_version[key] = p
    out = []
    for key, p in by_version.items():
        base = p.parent
        rel = p.relative_to(splat_dir).as_posix()
        info = _splat_version(p.stem)
        out.append({"name": p.name, "path": rel, "bytes": p.stat().st_size,
                    "format": p.suffix.lower().lstrip("."), **info,
                    **_splat_stats(base, p.stem)})
    return sorted(out, key=lambda s: (s["clip_id"], 0 if s.get("current") else 1,
                                     -(s.get("iters") or 0), s.get("archived_at") or "", s["name"]))


def main():
    flights = []
    routes = []
    clip_manifests = sorted([*(VAULT / "manifest").glob("DJI_*.json"),
                             *(VAULT / "manifest").glob("UP_*.json")])
    for mf in clip_manifests:
        m = json.loads(mf.read_text())
        cid = m["clip_id"]                     # DJI_20260704160358_0104_D
        ts = cid.split("_")[1]                 # 20260704160358
        m["date"] = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
        m["time"] = f"{ts[8:10]}:{ts[10:12]}"
        m["has_proxy"] = (VAULT / "proxies" / f"{cid}.mp4").exists()
        m["has_proxy720"] = (VAULT / "proxies720" / f"{cid}.mp4").exists()
        # ruta relativa del original: habilita reproducción 4K y foto-captura del raw
        raws = list((VAULT / "raw").rglob(f"{cid}.*"))
        vids = [r for r in raws if r.suffix.lower() in (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".mts")]
        if vids:
            m["raw_rel"] = str(vids[0].relative_to(VAULT / "raw"))
        # AI embebido: evita 1 fetch por clip en cada página (móvil sufre)
        aif = VAULT / "ai" / f"{cid}.json"
        if aif.exists():
            a = json.loads(aif.read_text())
            m["ai"] = {k: a.get(k) for k in
                       ("summary", "scene_type", "tags", "highlights", "travel_score")}
        flights.append(m)
        # ruta simplificada (1 punto cada 4s) para el mapa global: 1 request, no 40
        tf = VAULT / "tracks" / f"{cid}.flight.json"
        if tf.exists():
            pts = json.loads(tf.read_text())["points"][::4]
            if pts:
                routes.append({"cid": cid,
                               "line": [[round(p["lon"], 6), round(p["lat"], 6)] for p in pts]})
    flights.sort(key=lambda f: f["clip_id"].split("_")[1], reverse=True)
    write_atomic(VAULT / "manifest" / "flights.json",
                 json.dumps({"flights": flights}, separators=(",", ":")))
    write_atomic(VAULT / "manifest" / "routes.json",
                 json.dumps({"routes": routes}, separators=(",", ":")))

    # system.json: storage + reels + splats + last ingest
    ingests = sorted((VAULT / "manifest").glob("ingest-*.json"))
    last = json.loads(ingests[-1].read_text()) if ingests else None
    system = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "storage": {k: dir_size(VAULT / k) for k in
                    ["raw", "proxies", "frames", "thumbs", "tracks", "reels", "splats"]},
        "ai_count": len(list((VAULT / "ai").glob("DJI_*.json"))) if (VAULT / "ai").exists() else 0,
        "reels": [{"name": p.name, "bytes": p.stat().st_size}
                  for p in sorted((VAULT / "reels").glob("*.mp4"))] if (VAULT / "reels").exists() else [],
        "photos": [{"name": p.name, "bytes": p.stat().st_size}
                   for p in sorted((VAULT / "photos").glob("*.jpg"), reverse=True)] if (VAULT / "photos").exists() else [],
        "splats": all_splats(VAULT / "splats"),
        "last_ingest": {"files": last["file_count"], "bytes": last["total_bytes"],
                        "at": last["ingested_at"]} if last else None,
        "models": load_models(VAULT / "models"),   # tolera meta.json corrupto (no vacía la UI)
    }
    write_atomic(VAULT / "manifest" / "system.json", json.dumps(system, separators=(",", ":")))
    print(f"flights.json: {len(flights)} vuelos · system.json: "
          f"{system['storage']['raw'] / 1e9:.0f}GB raw, {system['ai_count']} AI")


if __name__ == "__main__":
    main()
