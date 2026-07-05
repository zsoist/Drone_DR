"""Post-process ingested clips: proxy + thumb + keyframes + track + manifest.

Per-clip artifacts (driven by its processing tier from policy.py):
  proxies/<id>.mp4         1080p HEVC via VideoToolbox HW encoder (web-ready)
  thumbs/<id>.jpg          poster frame at 25% of duration
  frames/<id>/f_%04d.jpg   keyframes every 2s @ 960px (AI vision input)
  tracks/<id>.flight.json  1Hz GPS track from SRT
  manifest/<id>.json       unified clip metadata

Usage:
    python3 process.py <raw.MP4>...      # explicit clips
    python3 process.py --all             # every un-processed MP4 in the vault
"""
import json
import subprocess
import sys
from pathlib import Path

from srt_parser import parse_srt
from policy import processing_tier

VAULT = Path("/Volumes/SSD/drone-vault")


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_format", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def run_ffmpeg(args: list[str]):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def clip_id(mp4: Path) -> str:
    return mp4.stem  # DJI_20260704160358_0104_D


def make_proxy(mp4: Path, out: Path, has_audio: bool):
    # H.264 (not HEVC): universal browser playback (Firefox/Android choke on HEVC)
    # 6Mbps @1080p ≈ 45MB/min → ~40 clips full-tier fit in R2's 10GB free tier
    args = ["-hwaccel", "videotoolbox", "-i", str(mp4),
            "-vf", "scale=-2:1080", "-c:v", "h264_videotoolbox",
            "-b:v", "6M", "-maxrate", "8M"]
    args += ["-c:a", "aac", "-b:a", "128k"] if has_audio else ["-an"]
    args += ["-movflags", "+faststart", str(out)]
    run_ffmpeg(args)


def process_clip(mp4: Path) -> dict:
    cid = clip_id(mp4)
    probe = ffprobe(mp4)
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    has_audio = any(s["codec_type"] == "audio" for s in probe["streams"])
    duration = float(probe["format"]["duration"])

    srt = mp4.with_suffix(".SRT")
    track = parse_srt(srt) if srt.exists() else None
    if track:
        (VAULT / "tracks" / f"{cid}.flight.json").write_text(
            json.dumps(track, separators=(",", ":")))

    meta = {
        "clip_id": cid,
        "raw": mp4.name,  # name only: vault layout is canonical, not the source path
        "duration_s": round(duration, 1),
        "resolution": f'{vstream["width"]}x{vstream["height"]}',
        "fps": round(eval(vstream["avg_frame_rate"]), 2),
        "size_bytes": int(probe["format"]["size"]),
        "has_srt": track is not None,
        "stats": (track or {}).get("stats", {}),
    }
    tier = processing_tier(meta)
    meta["tier"] = tier

    thumb = VAULT / "thumbs" / f"{cid}.jpg"
    run_ffmpeg(["-ss", str(duration * 0.25), "-i", str(mp4),
                "-frames:v", "1", "-vf", "scale=-2:720", "-q:v", "3", str(thumb)])

    if tier == "full":
        proxy = VAULT / "proxies" / f"{cid}.mp4"
        make_proxy(mp4, proxy, has_audio)
        meta["proxy_bytes"] = proxy.stat().st_size

    if tier in ("full", "standard"):
        # decode the 1080p proxy when it exists — 4K60 HEVC decode is the bottleneck
        src = VAULT / "proxies" / f"{cid}.mp4" if tier == "full" else mp4
        fdir = VAULT / "frames" / cid
        fdir.mkdir(parents=True, exist_ok=True)
        run_ffmpeg(["-i", str(src), "-vf", "fps=1/2,scale=960:-2",
                    "-q:v", "4", str(fdir / "f_%04d.jpg")])
        meta["frame_count"] = len(list(fdir.glob("f_*.jpg")))

    (VAULT / "manifest" / f"{cid}.json").write_text(json.dumps(meta, indent=1))
    print(f"✅ {cid} [{tier}] {meta['duration_s']}s "
          f"proxy={'%.0fMB' % (meta.get('proxy_bytes', 0) / 1e6) if 'proxy_bytes' in meta else '—'} "
          f"frames={meta.get('frame_count', '—')}")
    return meta


def main():
    if "--all" in sys.argv:
        done = {p.stem for p in (VAULT / "manifest").glob("*.json")}
        exts = (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".webm")
        clips = [p for p in sorted((VAULT / "raw").rglob("*"))
                 if p.suffix.lower() in exts and p.is_file() and p.stem not in done]
    else:
        clips = [Path(a) for a in sys.argv[1:]]
    if not clips:
        print("nothing to process")
        return
    for mp4 in clips:
        try:
            process_clip(mp4)
        except subprocess.CalledProcessError as e:
            print(f"✗ {mp4.name}: {e}")


if __name__ == "__main__":
    main()
