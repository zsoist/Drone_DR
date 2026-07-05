"""Aggregate per-clip manifests into flights.json + system.json for the web app."""
import json
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")


def dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


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
    (VAULT / "manifest" / "flights.json").write_text(
        json.dumps({"flights": flights}, separators=(",", ":")))
    (VAULT / "manifest" / "routes.json").write_text(
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
        "splats": [{"name": p.name, "bytes": p.stat().st_size}
                   for p in sorted((VAULT / "splats").glob("*"))
                   if p.is_file()] if (VAULT / "splats").exists() else [],
        "last_ingest": {"files": last["file_count"], "bytes": last["total_bytes"],
                        "at": last["ingested_at"]} if last else None,
    }
    (VAULT / "manifest" / "system.json").write_text(json.dumps(system, separators=(",", ":")))
    print(f"flights.json: {len(flights)} vuelos · system.json: "
          f"{system['storage']['raw'] / 1e9:.0f}GB raw, {system['ai_count']} AI")


if __name__ == "__main__":
    main()
