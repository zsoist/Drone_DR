"""Capture Intelligence — analiza un vuelo ANTES de gastar 40 min de ODM.

Mide del video + SRT:
  - nitidez (varianza laplaciana sobre frames muestreados)
  - estabilidad de exposición (deriva de brillo)
  - continuidad GPS (huecos), velocidad, distancia entre frames
  - cobertura de rumbo/paralaje (spread de headings)
y produce:
  - aptitud 0-10 para ortho/DSM, malla y gaussian splat, con razones
  - warnings accionables ("solo nadir", "riesgo de blur", "órbita incompleta")
  - perfil recomendado + presupuesto de frames
  - selección adaptativa de frames (nitidez + espaciado GPS + presupuesto)

Reporte cacheado en vault/manifest/capture/<cid>.json.

Usage: python3 capture_quality.py <clip_id> [--profile preview|balanced|premium|splat]
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from srt_parser import parse_srt

VAULT = Path("/Volumes/SSD/drone-vault")
CACHE = VAULT / "manifest" / "capture"

PROFILES = {
    "preview": {"budget": 160, "min_dist_m": 4.0, "blur_drop": 0.15},
    "balanced": {"budget": 450, "min_dist_m": 2.0, "blur_drop": 0.20},
    "premium": {"budget": 1200, "min_dist_m": 1.0, "blur_drop": 0.25},
    "splat": {"budget": 700, "min_dist_m": 1.5, "blur_drop": 0.30},
}
N_SAMPLES = 24


def _video_for(cid: str) -> Path | None:
    p = VAULT / "proxies" / f"{cid}.mp4"
    if p.exists():
        return p
    for ext in (".MP4", ".mp4", ".MOV", ".mov"):
        hits = list((VAULT / "raw").rglob(f"{cid}{ext}"))
        if hits:
            return hits[0]
    return None


def sharpness(img: Image.Image) -> float:
    """Varianza laplaciana en gris — el estándar barato de detección de blur."""
    g = np.asarray(img.convert("L"), dtype=np.float32)
    lap = (np.abs(np.diff(g, 2, axis=0)).mean() + np.abs(np.diff(g, 2, axis=1)).mean())
    return round(float(lap), 2)


def sample_frames(video: Path, duration_s: float, n: int = N_SAMPLES) -> list[dict]:
    """n frames uniformes a 480px — una sola pasada de ffmpeg."""
    out = []
    with tempfile.TemporaryDirectory() as td:
        fps = max(n / max(duration_s, 1), 0.05)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(video),
             "-vf", f"fps={fps:.4f},scale=480:-2", "-frames:v", str(n),
             f"{td}/s_%03d.jpg"],
            check=True, capture_output=True, timeout=180)
        files = sorted(Path(td).glob("s_*.jpg"))
        for i, f in enumerate(files):
            img = Image.open(f)
            t = (i + 0.5) * duration_s / max(len(files), 1)
            out.append({"t": round(t, 1), "sharp": sharpness(img),
                        "bright": round(float(np.asarray(img.convert("L")).mean()), 1)})
    return out


def _bearing(a, b) -> float:
    dlon = math.radians(b[0] - a[0])
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    y = math.sin(dlon) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _hav_m(a, b) -> float:
    R = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _t_seconds(points: list) -> list[float]:
    """El SRT trae t como datetime string — normaliza a segundos desde el inicio."""
    from datetime import datetime
    out, t0 = [], None
    for p in points:
        t = p["t"]
        v = datetime.fromisoformat(t).timestamp() if isinstance(t, str) else float(t)
        if t0 is None:
            t0 = v
        out.append(v - t0)
    return out


def gps_metrics(points: list) -> dict:
    """Continuidad, velocidad, spread de rumbos y paralaje desde el track 1Hz."""
    if len(points) < 3:
        return {"ok": False}
    pts = [p for p in points if isinstance(p.get("lon"), (int, float)) and isinstance(p.get("lat"), (int, float))]
    if len(pts) < 3:
        return {"ok": False}          # dropout GPS (lon/lat null) ya no crashea math.radians(None)
    points = pts
    lls = [(p["lon"], p["lat"]) for p in points]
    alts = [p.get("rel_alt", 0) or 0 for p in points]
    ts = _t_seconds(points)
    gaps = sum(1 for i in range(1, len(ts)) if ts[i] - ts[i - 1] > 2.5)
    dists = [_hav_m(lls[i - 1], lls[i]) for i in range(1, len(lls))]
    speeds = [d / max(ts[i + 1] - ts[i], 0.5) for i, d in enumerate(dists)]
    bearings = [_bearing(lls[i - 1], lls[i]) for i in range(1, len(lls)) if dists[i - 1] > 0.5]
    # spread de rumbos en 12 sectores de 30°: 12/12 = órbita completa
    sectors = len({int(b // 30) for b in bearings}) if bearings else 0
    return {
        "ok": True,
        "gaps": gaps,
        "distance_m": round(sum(dists), 1),
        "speed_avg_ms": round(float(np.mean(speeds)), 2) if speeds else 0,
        "speed_max_ms": round(float(np.max(speeds)), 2) if speeds else 0,
        "alt_min_m": round(min(alts), 1),
        "alt_max_m": round(max(alts), 1),
        "heading_sectors": sectors,
        "points": len(points),
    }


def analyze(cid: str) -> dict:
    video = _video_for(cid)
    if not video:
        return {"error": "video no encontrado"}
    srt = None
    for ext in (".SRT", ".srt"):
        hits = list((VAULT / "raw").rglob(f"{cid}{ext}"))
        if hits:
            srt = hits[0]
            break
    track = parse_srt(srt) if srt else {"points": [], "stats": {}}
    dur = track["stats"].get("duration_s") or 60
    frames = sample_frames(video, dur)
    sharps = [f["sharp"] for f in frames] or [0]
    brights = [f["bright"] for f in frames] or [0]
    g = gps_metrics(track["points"])

    sharp_med = float(np.median(sharps))
    blur_frac = float(np.mean([s < sharp_med * 0.5 for s in sharps]))
    expo_drift = float(np.std(brights))

    warnings = []
    if not g.get("ok"):
        warnings.append("Sin GPS utilizable — ODM no puede georreferenciar este clip.")
    else:
        if g["gaps"] > 2:
            warnings.append(f"{g['gaps']} huecos de GPS/SRT — el geotag tendrá saltos.")
        if g["speed_max_ms"] > 9:
            warnings.append("Tramos muy rápidos (>9 m/s) — riesgo de blur de movimiento y poco solape.")
        if g["heading_sectors"] <= 3:
            warnings.append("Vuelo casi recto (poco cambio de rumbo) — malla y splat saldrán débiles; vuela una órbita.")
        elif g["heading_sectors"] < 8:
            warnings.append("Órbita incompleta — el paralaje cubre solo parte de la escena.")
        if g["alt_max_m"] < 25:
            warnings.append("Altura baja (<25 m) — cobertura por frame muy chica para mapear.")
        if g["distance_m"] < 60:
            warnings.append("Muy poca distancia recorrida — frames casi duplicados, poca geometría nueva.")
    if blur_frac > 0.25:
        warnings.append(f"{int(blur_frac * 100)}% de los frames con blur notable — baja la velocidad o sube el shutter.")
    if expo_drift > 26:
        warnings.append("Exposición inestable — bloquea exposición/WB en el dron para texturas uniformes.")

    def clamp(x):
        return round(max(0.0, min(10.0, x)), 1)

    ortho = clamp((6 if g.get("ok") else 0)
                  + (2 if g.get("alt_max_m", 0) >= 50 else 1 if g.get("alt_max_m", 0) >= 25 else 0)
                  + (2 - blur_frac * 6) - g.get("gaps", 0) * 0.5)
    mesh = clamp((3 if g.get("ok") else 0)
                 + g.get("heading_sectors", 0) * 0.55
                 + (1.5 - blur_frac * 5))
    splat = clamp((2.5 if g.get("ok") else 0)
                  + g.get("heading_sectors", 0) * 0.6
                  + (2 - blur_frac * 6)
                  - (1 if expo_drift > 26 else 0))

    if splat >= 7 and mesh >= 6:
        rec = "premium"
    elif g.get("heading_sectors", 0) >= 8:
        rec = "splat"
    elif ortho >= 6:
        rec = "balanced"
    else:
        rec = "preview"

    # ---- riesgo de MEMORIA del gaussian (predicción, no autopsia) ----
    # La densificación crece con el ÁREA de escena, no con el nº de cámaras: un clip de
    # ~47 ha reventó 3× el cap de 11GB donde uno de 13 ha con más cámaras pasó. Señales:
    # footprint del vuelo (distancia × altura) + historial REAL de OOM (-9) del clip.
    oom_hits = 0
    try:
        errlog = VAULT / "ops" / "errors.jsonl"
        if errlog.exists():
            for line in errlog.read_text().splitlines():
                if "código -9" in line and cid in line:
                    oom_hits += 1
    except OSError:
        pass
    footprint_ha = (g.get("distance_m", 0) * max(g.get("alt_max_m", 40), 25) * 1.2) / 10000
    mem = {"footprint_ha": round(footprint_ha, 1), "oom_previos": oom_hits}
    if oom_hits >= 2 or footprint_ha > 38:
        mem.update(level="alto", advice="Escena grande para el cap de 11GB — usa Cinematic, o "
                   "Ultra sabiendo que degradará solo (media resolución / densificación acotada).")
    elif oom_hits == 1 or footprint_ha > 22:
        mem.update(level="medio", advice="Ultra puede requerir el reintento automático a media "
                   "resolución; Cinematic pasa sin drama.")
    else:
        mem.update(level="bajo", advice="Cualquier preset cabe en memoria.")

    report = {
        "clip_id": cid,
        "video": video.name,
        "duration_s": dur,
        "sharp_median": round(sharp_med, 1),
        "blur_frac": round(blur_frac, 2),
        "expo_drift": round(expo_drift, 1),
        "gps": g,
        "suitability": {"ortho_dsm": ortho, "mesh": mesh, "splat": splat},
        "memory_risk": mem,
        "warnings": warnings,
        "recommended_profile": rec,
        "recommended_frames": PROFILES[rec]["budget"],
        "samples": frames,
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / f"{cid}.json").write_text(json.dumps(report, indent=1))
    return report


def cached(cid: str) -> dict | None:
    f = CACHE / f"{cid}.json"
    return json.loads(f.read_text()) if f.exists() else None


def choose_frames(track_points: list, frame_times: list, sharp_by_time: dict,
                  profile: str = "balanced") -> list[dict]:
    """Selección adaptativa: descarta el cuartil más borroso del vecindario y
    exige movimiento GPS mínimo entre frames elegidos. Respeta el presupuesto."""
    cfg = PROFILES.get(profile, PROFILES["balanced"])
    _secs = _t_seconds(track_points)
    pos_by_t = {round(sec): (p["lon"], p["lat"]) for sec, p in zip(_secs, track_points)}
    sharp_vals = sorted(sharp_by_time.values())
    cut = sharp_vals[int(len(sharp_vals) * cfg["blur_drop"])] if sharp_vals else 0
    best = sharp_vals[-1] if sharp_vals else 0
    chosen, last_pos = [], None
    for t in frame_times:
        reason = []
        s = sharp_by_time.get(t)
        # borroso: bajo el percentil de corte, o empatado con él Y lejos del mejor
        # (el empate importa cuando un bloque entero comparte el valor mínimo)
        if s is not None and (s < cut or (s == cut and s < best * 0.5)):
            continue
        pos = pos_by_t.get(int(t)) or pos_by_t.get(round(t))
        if pos and last_pos:
            d = _hav_m(last_pos, pos)
            if d < cfg["min_dist_m"]:
                continue                               # casi duplicado
            reason.append(f"+{d:.1f}m")
        if s is not None:
            reason.append(f"sharp {s}")
        chosen.append({"t": t, "why": " · ".join(reason) or "espaciado"})
        if pos:
            last_pos = pos
        if len(chosen) >= cfg["budget"]:
            break
    return chosen


if __name__ == "__main__":
    _cid = sys.argv[1]
    r = analyze(_cid)
    print(json.dumps({k: v for k, v in r.items() if k != "samples"}, indent=1, ensure_ascii=False))
