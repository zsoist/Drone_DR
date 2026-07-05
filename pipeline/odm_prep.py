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


PROFILE_FPS = {"preview": 0.33, "balanced": 0.5, "premium": 1.0, "splat": 0.75}


def prune_frames(images, track_pts, fps, profile):
    """Poda adaptativa post-extracción: fuera el cuartil borroso y los frames
    casi-duplicados (sin movimiento GPS). Escribe frames_manifest.json."""
    from capture_quality import choose_frames, sharpness
    from PIL import Image
    files = sorted(images.glob("f_*.jpg"))
    if len(files) < 40:
        return len(files)                      # clips chicos: no vale la pena podar
    sharp_by_t, time_of = {}, {}
    for i, f in enumerate(files):
        t = round((i + 0.5) / fps, 1)
        time_of[t] = f
        img = Image.open(f)
        img.thumbnail((480, 480))
        sharp_by_t[t] = sharpness(img)
    chosen = choose_frames(track_pts, sorted(sharp_by_t), sharp_by_t, profile)
    keep = {c["t"] for c in chosen}
    dropped = 0
    for t, f in time_of.items():
        if t not in keep:
            f.unlink()
            dropped += 1
    (images.parent / "frames_manifest.json").write_text(json.dumps(
        {"profile": profile, "kept": len(keep), "dropped": dropped,
         "frames": chosen}, indent=1))
    print(f"poda adaptativa [{profile}]: {len(keep)} frames elegidos · {dropped} descartados "
          f"(blur / casi-duplicados)", flush=True)
    return len(keep)


def main():
    cid = sys.argv[1]
    profile = None
    if "--profile" in sys.argv:
        profile = sys.argv[sys.argv.index("--profile") + 1]
    raw = find_raw(cid)
    track = json.loads((VAULT / "tracks" / f"{cid}.flight.json").read_text())
    pts = track["points"]
    proj = VAULT / "odm" / f"proj_{cid}"
    images = proj / "images"
    images.mkdir(parents=True, exist_ok=True)

    expected = int(json.loads((VAULT / "manifest" / f"{cid}.json").read_text())
                   .get("duration_s", 0) * FPS) if (VAULT / "manifest" / f"{cid}.json").exists() else 0
    print(f"frames 2K de {raw.name} (~{expected or '?'} esperados)…", flush=True)
    # -hwaccel videotoolbox: decodifica el HEVC 4K60 10-bit en el Media Engine del M4
    # (antes: software decode = fase 1 de ~4-5 min; ahora ~2-3x más rápido)
    fps = PROFILE_FPS.get(profile, FPS)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y",
                             "-hwaccel", "videotoolbox", "-i", str(raw),
                             "-vf", f"fps={fps},scale={WIDTH}:-2", "-q:v", "2",
                             str(images / "f_%04d.jpg")])
    import time as _t
    while proc.poll() is None:
        _t.sleep(8)
        n = len(list(images.glob("f_*.jpg")))
        print(f"frames: {n}/{expected or '?'}", flush=True)   # → log tail de la UI
    if proc.returncode != 0:
        raise SystemExit("ffmpeg falló extrayendo frames")

    if profile:
        prune_frames(images, pts, fps, profile)

    frames = sorted(images.glob("f_*.jpg"))
    args = []
    for f in frames:
        # el numero del ARCHIVO (no el indice tras la poda) fija el timestamp:
        # f_0042.jpg = frame 42 de la extraccion a `fps`
        num = int(f.stem.split("_")[1])
        sec = min(int((num - 0.5) / fps), len(pts) - 1)
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
