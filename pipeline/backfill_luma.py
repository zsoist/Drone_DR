#!/usr/bin/env python3
"""Brillo medio real por clip → manifest (avg_luma, dark_frac).

El montaje automático elegía tomas nocturnas porque, sin análisis AI, recibían la
puntuación neutra. Medir el brillo de la MINIATURA no sirve: se desvía hasta ±25 respecto
al clip (la miniatura sale del 25% de la duración y puede caer en el único momento
iluminado). Aquí se muestrea el proxy entero.

  avg_luma   0-255, media de las muestras
  dark_frac  fracción de muestras por debajo de 24 (negro efectivo)

Idempotente: salta lo que ya tiene el dato salvo --force.
"""
import json
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
W, H = 32, 18


def measure(proxy: Path) -> dict | None:
    """Una muestra cada 4s a 32x18 en gris: barato y suficiente para decidir usabilidad."""
    try:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(proxy),
             "-vf", "fps=1/4,scale=32:18,format=gray", "-f", "rawvideo", "-"],
            capture_output=True, timeout=180).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    n = W * H
    frames = [sum(raw[i * n:(i + 1) * n]) / n for i in range(len(raw) // n)]
    if not frames:
        return None
    return {"avg_luma": round(sum(frames) / len(frames), 1),
            "dark_frac": round(sum(1 for f in frames if f < 24) / len(frames), 3)}


def main() -> int:
    force = "--force" in sys.argv
    mfs = sorted((VAULT / "manifest").glob("DJI_*.json")) + \
        sorted((VAULT / "manifest").glob("UP_*.json"))
    done = skipped = failed = 0
    for mf in mfs:
        try:
            m = json.loads(mf.read_text())
        except (ValueError, OSError):
            continue
        if "avg_luma" in m and not force:
            skipped += 1
            continue
        proxy = VAULT / "proxies" / f"{m['clip_id']}.mp4"
        if not proxy.exists():
            continue
        r = measure(proxy)
        if not r:
            failed += 1
            continue
        m.update(r)
        mf.write_text(json.dumps(m, indent=1))
        done += 1
        if done % 20 == 0:
            print(f"  {done} medidos…", flush=True)
    print(f"luma: {done} medidos · {skipped} ya tenían · {failed} fallidos", flush=True)
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_index.py")], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
