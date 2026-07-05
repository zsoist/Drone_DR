"""Prepara un vuelo para fotogrametría ODM: frames 2K + geotag desde el track SRT.

El paso clave es el geotag: ODM sin GPS en EXIF reconstruye sin escala ni
georreferencia (aprendido a la mala: ortofoto de 67x66px). Con GPS, el bundle
adjustment converge y la ortofoto sale georreferenciada de verdad.

Usage:
    python3 odm_prep.py DJI_20260704160358_0104_D
    # luego:
    docker run --rm -m 7g -v /Volumes/SSD/drone-vault/odm/<proj>:/datasets/code \
      opendronemap/odm --project-path /datasets --fast-orthophoto \
      --pc-quality low --feature-quality medium --max-concurrency 4
"""
import json
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
FPS = 0.5          # 1 frame cada 2s
WIDTH = 2688       # 2K: balance calidad/EOM en 16GB RAM


def find_raw(cid: str) -> Path:
    for p in (VAULT / "raw").rglob(f"{cid}.*"):
        if p.suffix.lower() in (".mp4", ".mov"):
            return p
    raise FileNotFoundError(cid)


def main():
    cid = sys.argv[1]
    raw = find_raw(cid)
    track = json.loads((VAULT / "tracks" / f"{cid}.flight.json").read_text())
    pts = track["points"]
    proj = VAULT / "odm" / f"proj_{cid}"
    images = proj / "images"
    images.mkdir(parents=True, exist_ok=True)

    print(f"frames 2K de {raw.name}…")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw),
                    "-vf", f"fps={FPS},scale={WIDTH}:-2", "-q:v", "2",
                    str(images / "f_%04d.jpg")], check=True)

    frames = sorted(images.glob("f_*.jpg"))
    args = []
    for i, f in enumerate(frames, 1):
        sec = min(int((i - 0.5) / FPS), len(pts) - 1)
        p = pts[sec]
        args += [
            f"-GPSLatitude={abs(p['lat'])}", f"-GPSLatitudeRef={'N' if p['lat'] >= 0 else 'S'}",
            f"-GPSLongitude={abs(p['lon'])}", f"-GPSLongitudeRef={'E' if p['lon'] >= 0 else 'W'}",
            f"-GPSAltitude={p['abs_alt']}", "-GPSAltitudeRef=0",
            str(f), "-execute",
        ]
    argfile = proj / ".geotag.args"
    argfile.write_text("\n".join(args))
    subprocess.run(["exiftool", "-overwrite_original", "-@", str(argfile)],
                   check=True, capture_output=True)
    print(f"✅ {len(frames)} frames geotagged → {proj}")


if __name__ == "__main__":
    main()
