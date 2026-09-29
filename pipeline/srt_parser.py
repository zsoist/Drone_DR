"""Parse DJI .SRT telemetry into flight.json: 1Hz GPS track + flight stats.

DJI Flip/Neo2 SRT blocks look like:
    1
    00:00:00,000 --> 00:00:00,033
    <font size="28">FrameCnt: 1, DiffTime: 33ms
    2026-07-04 16:09:33.953
    [iso: 2090] [shutter: 1/120.0] ... [latitude: 4.751684] [longitude: -74.064017]
    [rel_alt: 0.100 abs_alt: 2563.893] [ct: 5232] </font>
"""
import json
import math
import re
import sys
from pathlib import Path

from fsutil import atomic_write_json  # noqa: E402

FIELD_RE = re.compile(
    r"\[iso:\s*(?P<iso>[\d.]+)\].*?"
    r"\[shutter:\s*(?P<shutter>[^\]]+)\].*?"
    r"\[latitude:\s*(?P<lat>-?[\d.]+)\]\s*"
    r"\[longitude:\s*(?P<lon>-?[\d.]+)\]\s*"
    r"\[rel_alt:\s*(?P<rel_alt>-?[\d.]+)\s+abs_alt:\s*(?P<abs_alt>-?[\d.]+)\]",
    re.DOTALL,
)
CUE_RE = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->")
TIME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.(\d+)", re.MULTILINE)


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def point_at(points: list, t: float):
    """Punto del track más cercano al segundo de VIDEO `t` (bisect sobre `vt`).
    Sin `vt` (tracks viejos) cae al índice, como antes."""
    import bisect
    if not points:
        return None
    vts = [p.get("vt") for p in points]
    if any(v is None for v in vts):
        return points[max(0, min(int(t), len(points) - 1))]
    i = bisect.bisect_left(vts, t)
    if i <= 0:
        return points[0]
    if i >= len(points):
        return points[-1]
    return points[i] if vts[i] - t < t - vts[i - 1] else points[i - 1]


def parse_srt(srt_path: Path) -> dict:
    text = srt_path.read_text(errors="ignore")
    points = []
    last_second = None
    # Each subtitle block is separated by a blank line
    for block in text.split("\n\n"):
        t = TIME_RE.search(block)
        f = FIELD_RE.search(block)
        if not (t and f):
            continue
        cue = CUE_RE.search(block)
        vt = (int(cue.group(1)) * 3600 + int(cue.group(2)) * 60 + int(cue.group(3))
              + int(cue.group(4).ljust(3, "0")) / 1000.0) if cue else None
        second = t.group(1)  # datetime truncated to the second → 1Hz downsample
        if second == last_second:
            continue
        # drop pre-GPS-lock points: DJI logs 0,0 until it gets a fix
        if abs(float(f.group("lat"))) < 0.01 and abs(float(f.group("lon"))) < 0.01:
            continue
        last_second = second
        points.append({
            "t": second,
            # tiempo de VIDEO (s) del bloque: los puntos descartados (sin lock GPS / huecos)
            # rompen la equivalencia índice==segundo; los consumidores deben buscar por vt.
            "vt": round(vt, 3) if vt is not None else None,
            "lat": float(f.group("lat")),
            "lon": float(f.group("lon")),
            "rel_alt": float(f.group("rel_alt")),
            "abs_alt": float(f.group("abs_alt")),
            "iso": int(float(f.group("iso"))),
            "shutter": f.group("shutter").strip(),
        })

    stats = {}
    if points:
        lats = [p["lat"] for p in points]
        lons = [p["lon"] for p in points]
        dist = sum(
            haversine_m(points[i]["lat"], points[i]["lon"],
                        points[i + 1]["lat"], points[i + 1]["lon"])
            for i in range(len(points) - 1)
        )
        stats = {
            "duration_s": len(points),
            "video_span_s": (round(points[-1]["vt"] - points[0]["vt"], 1)
                             if points[-1].get("vt") is not None and points[0].get("vt") is not None
                             else None),
            "start": points[0]["t"],
            "end": points[-1]["t"],
            "max_rel_alt_m": max(p["rel_alt"] for p in points),
            "distance_m": round(dist, 1),
            "bbox": [min(lons), min(lats), max(lons), max(lats)],
            "home": [points[0]["lon"], points[0]["lat"]],
        }
    return {"source": srt_path.name, "stats": stats, "points": points}


def main():
    srt = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else srt.with_suffix(".flight.json")
    data = parse_srt(srt)
    atomic_write_json(out, data, separators=(",", ":"), ensure_ascii=True)
    s = data["stats"]
    print(f"{srt.name}: {len(data['points'])} pts, "
          f"{s.get('distance_m', 0)}m recorridos, "
          f"alt max {s.get('max_rel_alt_m', 0)}m → {out}")


if __name__ == "__main__":
    main()
