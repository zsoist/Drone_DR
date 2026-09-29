#!/usr/bin/env python3
"""Backfill de proxies web (1080p + 720p H.264) para clips que quedaron sin video.

Históricamente solo tier "full" generaba proxies (cuota R2 de 10GB, ya irrelevante:
todo se sirve local desde el vault). Resultado: 76/103 clips con player negro.
Este batch usa los MISMOS encoders de process.py (VideoToolbox HW) y al final
reconstruye el índice para que has_proxy/has_proxy720 reflejen la realidad.

Idempotente: salta lo que ya existe; un clip fallido no tumba el batch.
Uso: python3 backfill_proxies.py [--dry-run]
"""
import json
import subprocess
import sys
from pathlib import Path

from process import ffprobe, make_proxy, make_proxy_720

VAULT = Path("/Volumes/SSD/drone-vault")


def find_raw(cid: str) -> Path | None:
    vids = [r for r in (VAULT / "raw").rglob(f"{cid}.*")
            if r.suffix.lower() in (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".mts")]
    return vids[0] if vids else None


def main() -> int:
    dry = "--dry-run" in sys.argv
    manifests = sorted((VAULT / "manifest").glob("DJI_*.json")) + \
        sorted((VAULT / "manifest").glob("UP_*.json"))
    (VAULT / "proxies").mkdir(exist_ok=True)
    (VAULT / "proxies720").mkdir(exist_ok=True)
    todo, done, failed = [], 0, []
    for mf in manifests:
        try:
            cid = json.loads(mf.read_text())["clip_id"]
        except (ValueError, KeyError, OSError):
            continue
        p1080 = VAULT / "proxies" / f"{cid}.mp4"
        p720 = VAULT / "proxies720" / f"{cid}.mp4"
        if p1080.exists() and p720.exists():
            continue
        todo.append((cid, p1080, p720))
    print(f"backfill: {len(todo)} clips sin proxy completo", flush=True)
    if dry:
        for cid, *_ in todo:
            print(f"  {cid}")
        return 0
    for i, (cid, p1080, p720) in enumerate(todo, 1):
        raw = find_raw(cid)
        if not raw:
            failed.append((cid, "raw no encontrado"))
            continue
        try:
            probe = ffprobe(raw)
            has_audio = any(s["codec_type"] == "audio" for s in probe["streams"])
            if not p1080.exists():
                tmp = p1080.with_suffix(".tmp.mp4")
                make_proxy(raw, tmp, has_audio)
                tmp.rename(p1080)
            if not p720.exists():
                tmp = p720.with_suffix(".tmp.mp4")
                # fuente = proxy 1080 recién hecho: encode 2x más rápido que desde el raw 4K
                make_proxy_720(p1080, tmp, has_audio)
                tmp.rename(p720)
            done += 1
            print(f"[{i}/{len(todo)}] ✅ {cid}", flush=True)
        except (subprocess.CalledProcessError, OSError, StopIteration, ValueError) as e:
            failed.append((cid, str(e)[:120]))
            for t in (p1080.with_suffix(".tmp.mp4"), p720.with_suffix(".tmp.mp4")):
                t.unlink(missing_ok=True)
            print(f"[{i}/{len(todo)}] ❌ {cid}: {e}", flush=True)
    print(f"backfill listo: {done} ok, {len(failed)} fallidos", flush=True)
    for cid, err in failed:
        print(f"  ❌ {cid}: {err}")
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_index.py")],
                   check=False)
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
