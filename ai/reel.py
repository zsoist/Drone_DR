"""Auto-editor de viaje: corta un reel con los mejores momentos según el AI.

Toma los highlights de drone-vault/ai/*.json (detectados por Gemini vision),
ordena por travel_score, y corta segmentos de los proxies con ffmpeg.

Output: drone-vault/reels/reel-<fecha>.mp4 (1080p) y opcional 9:16 vertical.

Usage:
    python3 reel.py                    # reel con top momentos de todo el vault
    python3 reel.py --date 2026-07-04  # solo vuelos de ese día
    python3 reel.py --vertical         # 1080x1920 para IG/TikTok
"""
import json
import subprocess
import sys
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
SEG_LEN = 5          # segundos por highlight
MAX_SEGS = 10        # reel máximo ≈ 50s


def collect(date_filter: str | None) -> list[dict]:
    moments = []
    for f in sorted((VAULT / "ai").glob("DJI_*.json")):
        a = json.loads(f.read_text())
        cid = a["clip_id"]
        if date_filter and date_filter.replace("-", "") not in cid:
            continue
        proxy = VAULT / "proxies" / f"{cid}.mp4"
        if not proxy.exists():
            continue
        for h in a.get("highlights", []):
            moments.append({
                "clip": proxy, "t": max(0, h["t"] - SEG_LEN // 2),
                "score": a.get("travel_score", 5), "reason": h.get("reason", ""),
            })
    moments.sort(key=lambda m: -m["score"])
    return moments[:MAX_SEGS]


def main():
    date = sys.argv[sys.argv.index("--date") + 1] if "--date" in sys.argv else None
    vertical = "--vertical" in sys.argv
    moments = collect(date)
    if not moments:
        print("Sin highlights aún — corre analyze.py --all primero")
        return
    # re-sort chronologically so the reel tells the story in order
    moments.sort(key=lambda m: (m["clip"].name, m["t"]))

    tmp = VAULT / "reels" / ".tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    vf = ("crop=ih*9/16:ih,scale=1080:1920" if vertical else "scale=-2:1080")
    segs = []
    for i, m in enumerate(moments):
        seg = tmp / f"seg_{i:02d}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(m["t"]),
                        "-i", str(m["clip"]), "-t", str(SEG_LEN),
                        "-vf", vf, "-c:v", "h264_videotoolbox", "-b:v", "8M",
                        "-an", str(seg)], check=True)
        segs.append(seg)
        print(f"✂️  {m['clip'].stem} @ {m['t']}s — {m['reason'][:60]}")

    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs))
    suffix = "-vertical" if vertical else ""
    out = VAULT / "reels" / f"reel-{date or time.strftime('%Y%m%d')}{suffix}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", str(lst), "-c", "copy", str(out)], check=True)
    for s in [*segs, lst]:
        s.unlink()
    print(f"🎬 {out} ({out.stat().st_size / 1e6:.0f}MB, {len(segs)} momentos)")


if __name__ == "__main__":
    main()
