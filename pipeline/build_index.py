"""Aggregate per-clip manifests into flights.json + system.json for the web app."""
import json
import os
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")


def dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def write_atomic(path: Path, text: str):
    """tmp + os.replace: la app lee estos manifests directo; un write parcial concurrente
    (worker + server llaman rebuild_index) los dejaría truncados y vaciaría la UI."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


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


# el mismo clip puede tener .ksplat (optimizado) y .splat (fuente): UNA entrada por clip,
# el mejor formato gana — así el conteo de la UI no se infla al exportar .ksplat
SPLAT_PRIORITY = {".ksplat": 0, ".splat": 1, ".ply": 2}


def best_splats(splat_dir: Path) -> list:
    if not splat_dir.exists():
        return []
    by_clip = {}
    for p in sorted(splat_dir.glob("*")):
        if not (p.is_file() and p.suffix.lower() in SPLAT_PRIORITY):
            continue
        cur = by_clip.get(p.stem)
        if cur is None or SPLAT_PRIORITY[p.suffix.lower()] < SPLAT_PRIORITY[cur.suffix.lower()]:
            by_clip[p.stem] = p
    return [{"name": p.name, "bytes": p.stat().st_size,
             "format": p.suffix.lower().lstrip("."), "clip_id": p.stem}
            for p in sorted(by_clip.values())]


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
        "splats": best_splats(VAULT / "splats"),
        "last_ingest": {"files": last["file_count"], "bytes": last["total_bytes"],
                        "at": last["ingested_at"]} if last else None,
        "models": load_models(VAULT / "models"),   # tolera meta.json corrupto (no vacía la UI)
    }
    write_atomic(VAULT / "manifest" / "system.json", json.dumps(system, separators=(",", ":")))
    print(f"flights.json: {len(flights)} vuelos · system.json: "
          f"{system['storage']['raw'] / 1e9:.0f}GB raw, {system['ai_count']} AI")


if __name__ == "__main__":
    main()
