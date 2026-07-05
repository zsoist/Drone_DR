"""Aggregate per-clip manifests into flights.json for the web app."""
import json
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")


def main():
    flights = []
    for mf in sorted((VAULT / "manifest").glob("DJI_*.json")):
        m = json.loads(mf.read_text())
        cid = m["clip_id"]                     # DJI_20260704160358_0104_D
        ts = cid.split("_")[1]                 # 20260704160358
        m["date"] = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
        m["time"] = f"{ts[8:10]}:{ts[10:12]}"
        m["has_proxy"] = (VAULT / "proxies" / f"{cid}.mp4").exists()
        flights.append(m)
    flights.sort(key=lambda f: f["clip_id"].split("_")[1], reverse=True)
    out = VAULT / "manifest" / "flights.json"
    out.write_text(json.dumps({"flights": flights}, separators=(",", ":")))
    print(f"flights.json: {len(flights)} vuelos")


if __name__ == "__main__":
    main()
