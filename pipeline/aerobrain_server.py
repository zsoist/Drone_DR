"""AeroBrain server — static con HTTP Range (iOS lo exige) + upload + edit API.

Endpoints:
  GET  /...                     estáticos de web/ y /data/ (vault) con 206 Range
  POST /upload?name=f.mp4       sube video (auth por cookie o X-Token) → procesa solo
  POST /api/edit                {clip_id, segments:[...]} → ffmpeg
  POST /api/odm                 encola fotogrametría ODM en el worker
  POST /api/splat               encola entrenamiento OpenSplat en el worker
  GET  /api/jobs                estado de cola/trabajos
  POST /api/rescan              regenera índices

Auth externa: cookie HttpOnly o header X-Token. Los agentes locales en 127.0.0.1
son trusted por diseño; tokens en querystring no se aceptan.
"""
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jobs as jobstore
from splat_presets import resolve_splat_spec
from pathlib import Path

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

WEB = Path("/Volumes/SSD/work/forge-projects/aerobrain/web")
VAULT = Path("/Volumes/SSD/drone-vault")
# binarios 3D grandes con URL estable: cachean con revalidación 304 (nunca stale, nunca re-bajar MBs)
REVALIDATE_EXTS = (".ply", ".splat", ".ksplat", ".obj", ".mtl", ".laz", ".geojson", ".tif")
# editor SuperSplat auto-hosteado (post-procesado de splats: limpiar floaters, crop, export)
SUPERSPLAT = Path("/Volumes/SSD/work/forge-projects/aerobrain/splat/supersplat/dist")
PIPE = Path("/Volumes/SSD/work/forge-projects/aerobrain/pipeline")
TOKEN_FILE = VAULT / ".token"
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(24))
    TOKEN_FILE.chmod(0o600)
TOKEN = TOKEN_FILE.read_text().strip()

jobstore.init(orphan_kinds=jobstore.LIGHT_KINDS)
JLOCK = threading.Lock()         # compat: secciones que actualizan detail


def clip_history_files(hist_dir: Path, cid: str) -> list:
    """Archivos de historial que pertenecen EXACTAMENTE a este clip.
    Formato de archivado: '{cid}-{YYYYMMDD}-{HHMMSS}.{splat|ksplat|ply}'. Un glob '{cid}-*'
    cruzaría el guion y capturaría el historial de un clip VECINO '{cid}-<suf>' (p.ej. el clip
    'A' se comería el de 'A-2') — pérdida de datos entre clips. El regex ancla los 8+6 dígitos
    del timestamp, así 'A-2-...' nunca cae en el conjunto de 'A'."""
    if not hist_dir.is_dir():
        return []
    pat = re.compile(rf"{re.escape(cid)}-\d{{8}}-\d{{6}}\.(splat|ksplat|ply|meta\.json|cameras\.json)$", re.IGNORECASE)
    return [p for p in hist_dir.iterdir() if p.is_file() and pat.fullmatch(p.name)]


def prune_splat_history(hist_dir: Path, cid: str, keep: int = 6):
    """Keep the latest N version groups, not merely N files.

    A version can have .splat + .ksplat + .meta.json + .cameras.json. Pruning by file count
    breaks old versions into unusable partial sets.
    """
    groups = {}
    pat = re.compile(rf"({re.escape(cid)}-\d{{8}}-\d{{6}})\.(splat|ksplat|ply|meta\.json|cameras\.json)$",
                     re.IGNORECASE)
    for p in clip_history_files(hist_dir, cid):
        m = pat.fullmatch(p.name)
        if m:
            groups.setdefault(m.group(1), []).append(p)
    stale = sorted(groups.items(), key=lambda kv: max(p.stat().st_mtime for p in kv[1]), reverse=True)[keep:]
    for _, files in stale:
        for p in files:
            p.unlink(missing_ok=True)


def job_add(kind, label, container=""):
    return jobstore.add(kind, label, container)


def job_end(j, status, detail=""):
    jobstore.end(j["id"], status, detail)


def rebuild_index():
    subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)


def read_json_file(path: Path, max_bytes: int = 8_000_000):
    """Lee un JSON nuestro con tope de tamaño (defensa OOM ante archivos corruptos/enormes)."""
    if path.stat().st_size > max_bytes:
        raise ValueError(f"archivo {path.name} excede {max_bytes} bytes")
    return json.loads(path.read_text())


def health_status() -> tuple[dict, int]:
    checks = {}

    checks["web"] = WEB.is_dir()
    checks["vault"] = VAULT.is_dir()
    try:
        du = shutil.disk_usage(VAULT)
        checks["disk_free_gb"] = round(du.free / 1024**3, 1)
        checks["disk_ok"] = du.free > 10 * 1024**3
    except OSError:
        checks["disk_ok"] = False

    for name in ("flights.json", "system.json"):
        p = VAULT / "manifest" / name
        try:
            read_json_file(p, 2_000_000)
            checks[name] = True
        except Exception:
            checks[name] = False

    try:
        with sqlite3.connect(jobstore.DB, timeout=2) as c:
            c.execute("SELECT 1").fetchone()
            active = c.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]
        checks["jobs_db"] = True
        checks["active_jobs"] = int(active)
    except Exception:
        checks["jobs_db"] = False

    ok = all(v for k, v in checks.items() if k not in ("disk_free_gb", "active_jobs"))
    return {"ok": ok, "checks": checks, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, (200 if ok else 503)


def process_upload(path: Path, j):
    try:
        subprocess.run(["python3", str(PIPE / "process.py"), str(path)],
                       check=True, cwd=PIPE, capture_output=True, text=True)
        rebuild_index()
        job_end(j, "done", path.stem)
    except subprocess.CalledProcessError as e:
        job_end(j, "error", (e.stderr or str(e))[-300:])


# LUT presets — investigados de los grandes (DaVinci/LightCut), intensidad ~50%
LUTS = {
    "none": "",
    "cine": "curves=blue='0/0.04 0.5/0.47 1/0.96':red='0/0.02 0.5/0.53 1/1',eq=contrast=1.07:saturation=1.1",
    "vivid": "eq=saturation=1.32:contrast=1.1:brightness=0.02",
    "warm": "colorbalance=rs=0.07:gs=0.02:bs=-0.07,eq=saturation=1.12",
    "moody": "eq=contrast=1.16:brightness=-0.05:saturation=0.82",
    "bw": "hue=s=0,eq=contrast=1.22",
}
FONT = "/System/Library/Fonts/Helvetica.ttc"


def _ffmpeg_has(filter_name: str) -> bool:
    """¿El ffmpeg activo trae este filtro? (algunos builds vienen sin freetype→drawtext)."""
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                             capture_output=True, text=True, timeout=15).stdout
        return f" {filter_name} " in out
    except Exception:
        return False


HAS_DRAWTEXT = _ffmpeg_has("drawtext")   # sin drawtext, el título se omite (el export NO falla)
KEYS_ENV = Path("/Volumes/SSD/_system/claude/.api-keys.env")
SPLAT_BIN = Path("/Volumes/SSD/work/forge-projects/aerobrain/splat/OpenSplat/build/opensplat")
SPLAT_MPS_BIN = Path("/Volumes/SSD/work/forge-projects/aerobrain/splat/OpenSplat/build-mps/opensplat")


def any_opensplat_bin_exists() -> bool:
    """The worker can train with either CPU or Metal/MPS OpenSplat builds."""
    return SPLAT_BIN.exists() or SPLAT_MPS_BIN.exists()


def _sb_keys():
    k = {}
    for line in KEYS_ENV.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            a, _, b = line.strip().partition("=")
            k[a] = b.strip().strip('"')
    return k


def semantic_search(q: str, k: int = 12) -> dict:
    """Embeds la consulta (OpenAI, server-side) y pide a Supabase los vuelos más
    parecidos vía el RPC match_flights. La OpenAI key NUNCA toca el frontend."""
    import urllib.request
    keys = _sb_keys()
    url = keys.get("SUPABASE_DRONE_URL", "").rstrip("/")
    pub = keys.get("SUPABASE_DRONE_PUBLISHABLE_KEY", "")
    oa = keys.get("OPENAI_API_KEY", "")
    if not (url and pub and oa):
        return {"error": "Supabase/OpenAI no configurados", "results": []}
    er = urllib.request.Request("https://api.openai.com/v1/embeddings",
        data=json.dumps({"model": "text-embedding-3-small", "input": q[:400]}).encode(),
        headers={"Authorization": f"Bearer {oa}", "Content-Type": "application/json"})
    vec = json.loads(urllib.request.urlopen(er, timeout=30).read())["data"][0]["embedding"]
    rr = urllib.request.Request(f"{url}/rest/v1/rpc/match_flights",
        data=json.dumps({"query": vec, "k": k}).encode(),
        headers={"apikey": pub, "Authorization": f"Bearer {pub}", "Content-Type": "application/json"})
    return {"results": json.loads(urllib.request.urlopen(rr, timeout=30).read())}


def _deepseek(prompt: str) -> str:
    import urllib.request
    key = ""
    for line in KEYS_ENV.read_text().splitlines():
        if line.startswith("DEEPSEEK_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps({"model": "deepseek-chat", "temperature": 0.6,
                         "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


SD_VIDEO_EXT = (".MP4", ".mp4", ".MOV", ".mov")
SD_PHOTO_EXT = (".JPG", ".jpg", ".JPEG", ".DNG", ".dng", ".PNG", ".png")
SD_SKIP_VOLS = ("SSD", "Macintosh HD", "com.apple.TimeMachine.localsnapshots")


def sd_volumes() -> list:
    """Tarjetas montadas con estructura DCIM (DJI). Nunca lista el SSD."""
    vols = []
    vault_idx = None
    for v in sorted(Path("/Volumes").iterdir()):
        try:
            if v.name in SD_SKIP_VOLS or not (v / "DCIM").is_dir():
                continue
        except OSError:
            continue
        if vault_idx is None:
            # nombre -> tamaños en raw/: una pasada, O(1) por archivo de la SD
            vault_idx = {}
            for rf in (VAULT / "raw").rglob("*"):
                if rf.is_file():
                    vault_idx.setdefault(rf.name, set()).add(rf.stat().st_size)
        vids, fotos = [], []
        for f in sorted((v / "DCIM").rglob("*")):
            if not f.is_file() or f.name.startswith("."):
                continue
            size = f.stat().st_size
            entry = {"name": f.name, "rel": str(f.relative_to(v)),
                     "bytes": size, "in_vault": size in vault_idx.get(f.name, ())}
            if f.suffix in SD_VIDEO_EXT:
                entry["srt"] = f.with_suffix(".SRT").exists() or f.with_suffix(".srt").exists()
                vids.append(entry)
            elif f.suffix in SD_PHOTO_EXT:
                fotos.append(entry)
        du = shutil.disk_usage(v)
        vols.append({"volume": v.name, "total": du.total, "free": du.free,
                     "videos": vids, "photos": fotos})
    return vols


def _sd_resolve(volume: str, rel: str, exts: tuple = SD_VIDEO_EXT) -> Path:
    """Valida que el archivo pedido viva dentro del volumen (sin traversal)."""
    if "/" in volume or volume in ("", ".", "..") or volume in SD_SKIP_VOLS:
        raise ValueError("volumen inválido")
    base = (Path("/Volumes") / volume).resolve()
    if base.parent != Path("/Volumes").resolve() or not (base / "DCIM").is_dir():
        raise ValueError("volumen inválido")
    f = (base / rel).resolve()
    f.relative_to(base)          # ValueError si escapa
    if f.suffix not in exts or not f.is_file():
        raise ValueError(f"archivo no permitido: {rel}")
    return f


def _same_size_copy(src: Path) -> Path | None:
    """Archivo respaldado con el mismo nombre y tamaño. Un nombre igual no basta."""
    for hit in (VAULT / "raw").rglob(src.name):
        if hit.is_file() and hit.stat().st_size == src.stat().st_size:
            return hit
    return None


def _srt_backed_up(src: Path, backup: Path) -> bool:
    """Si la SD trae SRT, sólo borrarlo si existe copia junto al RAW respaldado."""
    for ss in (src.with_suffix(".SRT"), src.with_suffix(".srt")):
        if ss.exists() and not (backup.parent / ss.name).exists():
            return False
    return True


def run_sd_clean(spec: dict, j):
    """Libera espacio sin copiar ni reprocesar: borra sólo archivos ya respaldados
    byte-a-byte en raw/. Si hay SRT sin copia, conserva ese par en la SD."""
    try:
        volume = str(spec.get("volume", ""))
        rels = [str(x) for x in spec.get("files", [])][:500]
        cleaned, kept = 0, 0
        for i, rel in enumerate(rels):
            src = _sd_resolve(volume, rel, SD_VIDEO_EXT + SD_PHOTO_EXT)
            jobstore.update(j["id"], detail=f"verificando respaldo {i + 1}/{len(rels)} · {src.name}",
                            stage="clean", progress=0.05 + 0.9 * i / max(1, len(rels)))
            backup = _same_size_copy(src)
            if not backup or not _srt_backed_up(src, backup):
                kept += 1
                continue
            for ss in (src.with_suffix(".SRT"), src.with_suffix(".srt")):
                ss.unlink(missing_ok=True)
            src.unlink()
            cleaned += 1
        jobstore.update(j["id"], progress=1.0)
        msg = f"{cleaned} archivos respaldados borrados de la SD"
        if kept:
            msg += f" · {kept} conservados por respaldo incompleto"
        job_end(j, "done", msg)
    except Exception as e:
        job_end(j, "error", str(e)[-250:])


def run_sd_import(spec: dict, j):
    """Copia videos de la SD al vault (verificando tamaño), procesa proxies y,
    si se pidió, limpia la SD — SOLO los archivos cuya copia quedó verificada."""
    try:
        volume = str(spec.get("volume", ""))
        drone = re.sub(r"[^\w -]", "", str(spec.get("drone", "") or volume)).strip() or volume
        rels = [str(x) for x in spec.get("files", [])][:500]
        clean = bool(spec.get("clean"))
        clean_only = bool(spec.get("clean_only"))
        if clean_only:
            # liberar espacio: NO copia ni re-procesa — borra de la SD solo lo
            # que ya esta verificado en el vault (mismo nombre y tamano)
            freed = 0
            for i, rel in enumerate(rels):
                src = _sd_resolve(volume, rel, SD_VIDEO_EXT + SD_PHOTO_EXT)
                dest = None
                for hit in (VAULT / "raw").rglob(src.name):
                    if hit.stat().st_size == src.stat().st_size:
                        dest = hit
                        break
                jobstore.update(j["id"], detail=f"verificando {i + 1}/{len(rels)} · {src.name}",
                                progress=0.05 + 0.9 * i / max(1, len(rels)))
                if dest:
                    for ss in (src.with_suffix(".SRT"), src.with_suffix(".srt")):
                        ss.unlink(missing_ok=True)
                    src.unlink()
                    freed += 1
            job_end(j, "done", f"{freed} videos borrados de la SD (ya respaldados) · "
                               f"{len(rels) - freed} sin respaldo verificado, intactos")
            return
        copied = []
        for i, rel in enumerate(rels):
            src = _sd_resolve(volume, rel)
            dest = VAULT / "raw" / drone / src.parent.name / src.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            jobstore.update(j["id"], detail=f"copiando {i + 1}/{len(rels)} · {src.name}",
                            stage="copy", progress=0.05 + 0.45 * i / max(1, len(rels)))
            if not dest.exists() or dest.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dest)
            for ss in (src.with_suffix(".SRT"), src.with_suffix(".srt")):
                if ss.exists():
                    shutil.copy2(ss, dest.parent / ss.name)
            if dest.stat().st_size != src.stat().st_size:
                raise RuntimeError(f"copia no verificada: {src.name}")
            copied.append((src, dest))
        for i, (src, dest) in enumerate(copied):
            jobstore.update(j["id"], detail=f"procesando {i + 1}/{len(copied)} · proxy + GPS + thumbs",
                            stage="process", progress=0.5 + 0.4 * i / max(1, len(copied)))
            subprocess.run(["python3", str(PIPE / "process.py"), str(dest)],
                           check=True, cwd=PIPE, capture_output=True, text=True)
        cleaned = 0
        if clean:
            jobstore.update(j["id"], detail="limpiando la SD (solo copias verificadas)", stage="clean", progress=0.93)
            for src, dest in copied:
                if dest.exists() and dest.stat().st_size == src.stat().st_size:
                    for ss in (src.with_suffix(".SRT"), src.with_suffix(".srt")):
                        ss.unlink(missing_ok=True)
                    src.unlink()
                    cleaned += 1
        rebuild_index()
        jobstore.update(j["id"], progress=1.0)
        job_end(j, "done", f"{len(copied)} videos importados a raw/{drone}"
                           + (f" · {cleaned} borrados de la SD" if clean else ""))
    except Exception as e:
        job_end(j, "error", str(e)[-250:])


def find_raw(cid: str, size: int | None = None) -> Path | None:
    for ext in (".MP4", ".mp4", ".MOV", ".mov", ".mkv", ".avi", ".webm", ".mts"):
        hits = list((VAULT / "raw").rglob(f"{cid}{ext}"))
        for h in hits:
            if size is None or h.stat().st_size == size:
                return h
    return None


def capture_frame(spec: dict, j):
    """Foto 4K real: extrae el frame del ORIGINAL (no del proxy 1080p)."""
    try:
        cid = re.sub(r"[^\w-]", "", spec["clip_id"])
        t = max(0.0, float(spec.get("t", 0)))
        src = find_raw(cid) or (VAULT / "proxies" / f"{cid}.mp4")
        if not src.exists():
            raise FileNotFoundError("clip no encontrado")
        (VAULT / "photos").mkdir(exist_ok=True)
        out = VAULT / "photos" / f"{cid}_{t:07.1f}s.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(src),
                        "-frames:v", "1", "-q:v", "2", str(out)], check=True)
        job_end(j, "done", f"photos/{out.name}")
    except Exception as e:
        job_end(j, "error", str(e)[-200:])


def check_polygon(pts, step_m=0.5, max_cells=20_000_000):
    """Rechaza polígonos absurdos antes de asignar una malla enorme en memoria."""
    import math
    if not isinstance(pts, list) or len(pts) < 3:
        raise ValueError("polígono necesita >=3 vértices")
    if len(pts) > 500:
        raise ValueError("demasiados vértices (máx 500)")
    lons = [float(p[0]) for p in pts]; lats = [float(p[1]) for p in pts]
    lat0 = sum(lats) / len(lats)
    w = (max(lons) - min(lons)) * 111320 * math.cos(math.radians(lat0))
    h = (max(lats) - min(lats)) * 110540
    cells = (w / step_m) * (h / step_m)
    if cells > max_cells:
        raise ValueError(f"área demasiado grande (~{w*h/1e6:.1f} km²) — dibuja un polígono más chico")


def _load_dsm(mdir: Path):
    """Carga DSM binario + georreferencia. Devuelve (arr, gt, h, w, nodata)."""
    import numpy as np
    meta = read_json_file(mdir / "meta.json", 4_000_000)
    h, w = meta["dsm_shape"]
    gt = meta["dsm_gt"]
    arr = np.memmap(mdir / "dsm.bin", dtype=np.float32, mode="r", shape=(h, w))
    return arr, gt, h, w, meta.get("dsm_nodata")


def _poly_grid(pts, step_m=0.5):
    """Malla regular lon/lat dentro del bbox del polígono + máscara ray-casting."""
    import math
    import numpy as np
    lons = [p[0] for p in pts]; lats = [p[1] for p in pts]
    lat0 = sum(lats) / len(lats)
    dlon = step_m / (111320 * math.cos(math.radians(lat0)))
    dlat = step_m / 110540
    LON, LAT = np.meshgrid(np.arange(min(lons), max(lons), dlon),
                           np.arange(min(lats), max(lats), dlat))
    mask = np.zeros(LON.shape, dtype=bool)
    P = pts + [pts[0]]
    for i in range(len(P) - 1):
        (x1, y1), (x2, y2) = P[i], P[i + 1]
        mask ^= ((y1 <= LAT) != (y2 <= LAT)) & \
                (LON < (x2 - x1) * (LAT - y1) / (y2 - y1 + 1e-15) + x1)
    return LON, LAT, mask, step_m * step_m


def _sample_grid(arr, gt, h, w, nod, LON, LAT):
    """Muestrea el DSM en cada punto de la malla (nearest). NaN fuera/nodata."""
    import numpy as np
    X = ((LON - gt[0]) / gt[1]).astype(int)
    Y = ((LAT - gt[3]) / gt[5]).astype(int)
    inside = (X >= 0) & (X < w) & (Y >= 0) & (Y < h)
    out = np.full(LON.shape, np.nan, dtype=np.float64)
    vals = np.asarray(arr)[np.clip(Y, 0, h - 1), np.clip(X, 0, w - 1)]
    out[inside] = vals[inside]
    if nod is not None:
        out[np.abs(out - nod) < 1e-3] = np.nan
    return out


def compare_dsm(mdir_a: Path, mdir_b: Path, pts: list) -> dict:
    """Multi-fecha: cambio de volumen entre dos DSMs del mismo sector.
    B = más nuevo; positivo = material AGREGADO desde A (construcción/relleno)."""
    import numpy as np
    LON, LAT, mask, cell = _poly_grid(pts, step_m=0.5)
    za = _sample_grid(*_load_dsm(mdir_a), LON, LAT)
    zb = _sample_grid(*_load_dsm(mdir_b), LON, LAT)
    valid = mask & ~np.isnan(za) & ~np.isnan(zb)
    if not valid.any():
        return {"error": "sin solape entre las dos fechas en ese polígono"}
    # CO-REGISTRO VERTICAL (offset + tilt): sin GCPs cada reconstrucción hereda la
    # cota GPS del dron (error de decenas de metros) Y puede quedar inclinada
    # respecto a la otra. Ajustamos un plano robusto a la diferencia sobre el
    # terreno estable y lo restamos; sólo lo que sobrevive es cambio real.
    # (Validación same-day: sesgo puro daba -79.5m; mediana lo bajó a 2.3m; el
    #  plano corrige también el tilt residual.)
    D = (zb - za)
    X, Y = LON[valid], LAT[valid]
    dv = D[valid]
    # arranque ROBUSTO: los inliers de la mediana definen el "terreno estable";
    # los cambios reales (edificios/pilas) son outliers y NUNCA entran al fit
    med0 = np.median(dv)
    nmad0 = 1.4826 * np.median(np.abs(dv - med0))
    keep = np.abs(dv - med0) <= max(3 * nmad0, 0.5)
    if keep.sum() < 100:  # solape casi todo cambiado: sólo offset por mediana
        keep = np.ones(dv.shape, dtype=bool)
    coef = np.array([0.0, 0.0, med0])
    Aall = np.column_stack([X - X.mean(), Y - Y.mean(), np.ones(len(X))])
    for _ in range(2):
        A = Aall[keep]
        coef, *_ = np.linalg.lstsq(A, dv[keep], rcond=None)
        resid = dv - Aall @ coef
        m = np.median(resid[keep])
        n = 1.4826 * np.median(np.abs(resid[keep] - m))
        keep = np.abs(resid - m) <= max(3 * n, 0.5)
        if keep.sum() < 100:
            break
    diff = dv - Aall @ coef
    # incertidumbre honesta: NMAD del residual sobre terreno estable
    nmad = float(1.4826 * np.median(np.abs(diff[keep] - np.median(diff[keep]))))
    added = float(np.clip(diff, 0, None).sum() * cell)
    removed = float(np.clip(-diff, 0, None).sum() * cell)
    return {"net_change_m3": round(added - removed, 1), "added_m3": round(added, 1),
            "removed_m3": round(removed, 1), "mean_change_m": round(float(diff.mean()), 2),
            "max_rise_m": round(float(diff.max()), 1), "max_drop_m": round(float(diff.min()), 1),
            "vertical_bias_corrected_m": round(float(coef[2]), 2),
            "uncertainty_m": round(nmad, 2),
            "area_m2": round(cell * int(valid.sum()), 1), "overlap_cells": int(valid.sum())}


def measure_dsm(mdir: Path, spec: dict) -> dict:
    """Mediciones survey en el host: numpy sobre el DSM binario (sin docker)."""
    import math
    import numpy as np
    arr, gt, h, w, nod = _load_dsm(mdir)
    pts = spec.get("points", [])

    def elev(lon, lat):
        x = int((lon - gt[0]) / gt[1]); y = int((lat - gt[3]) / gt[5])
        if 0 <= y < h and 0 <= x < w:
            v = float(arr[y, x])
            return None if (nod is not None and abs(v - nod) < 1e-3) else v
        return None

    if spec.get("type") == "profile":
        (lon1, lat1), (lon2, lat2) = pts[0], pts[-1]
        prof = [elev(lon1 + (lon2 - lon1) * i / 120, lat1 + (lat2 - lat1) * i / 120)
                for i in range(121)]
        dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
        return {"profile": prof, "distance_m": round(2 * 6371000 * math.asin(math.sqrt(a)), 1)}

    # volumen: ray-casting vectorizado dentro del polígono
    lons = gt[0] + (np.arange(w) + 0.5) * gt[1]
    lats = gt[3] + (np.arange(h) + 0.5) * gt[5]
    LON, LAT = np.meshgrid(lons, lats)
    mask = np.zeros((h, w), dtype=bool)
    P = pts + [pts[0]]
    for i in range(len(P) - 1):
        (x1, y1), (x2, y2) = P[i], P[i + 1]
        mask ^= ((y1 <= LAT) != (y2 <= LAT)) & \
                (LON < (x2 - x1) * (LAT - y1) / (y2 - y1 + 1e-15) + x1)
    if nod is not None:
        mask &= np.abs(arr - nod) > 1e-3
    if not mask.any():
        return {"error": "polígono fuera del DSM"}
    vals = arr[mask].astype(np.float64)
    base = float(np.percentile(vals, 5))
    lat0 = float(np.mean([p[1] for p in pts]))
    cell = abs(gt[1]) * 111320 * math.cos(math.radians(lat0)) * abs(gt[5]) * 110540
    return {"volume_m3": round(float(np.clip(vals - base, 0, None).sum() * cell), 1),
            "cut_m3": round(float(np.clip(base - vals, 0, None).sum() * cell), 1),
            "base_elev": round(base, 1),
            "area_m2": round(cell * int(mask.sum()), 1),
            "max_height": round(float(vals.max() - base), 1)}


def splat_quality(out: Path, log: str, n_cams: int, iters: int) -> dict:
    """Quality gate del splat: tamaño + cámaras + convergencia de loss."""
    size = out.stat().st_size if out.exists() else 0
    step_rows = re.findall(
        r"Step\s+(\d+):\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|nan|inf)",
        log or "", flags=re.I)
    losses = [v.lower() for _, v in step_rows]
    final_loss = next((float(x) for x in reversed(losses) if x not in ("nan", "inf")), None)
    last_step = max((int(s) for s, _ in step_rows), default=0)
    reasons = []
    if losses and losses[-1] in ("nan", "inf"):
        reasons.append("el entrenamiento divergió (loss=nan) — reintenta o baja las iteraciones")
    if iters and last_step and last_step < int(iters * 0.95):
        reasons.append(f"entrenamiento incompleto ({last_step}/{iters} pasos)")
    if size < 200_000:
        reasons.append(f"archivo muy pequeño ({size} bytes) — escena insuficiente")
    if n_cams < 8:
        reasons.append(f"solo {n_cams} cámaras — vuela una órbita con más solape (>=8)")
    if final_loss is not None and final_loss > 0.5:
        reasons.append(f"loss final alto ({final_loss}) — captura ruidosa")
    return {"passed": not reasons, "reason": " · ".join(reasons) or "ok",
            "bytes": size, "cameras": n_cams, "final_loss": final_loss,
            "last_step": last_step, "steps_logged": len(step_rows), "target_iters": iters}


def derive_odm_progress(log: str, current: float | None = None, cid: str = "") -> float | None:
    """Best-effort progress for ODM jobs from log text.

    The worker cannot easily stream structured progress from ODM, but the log has
    stable stage markers. Keep this monotonic and conservative: it drives UI/ETA
    only, never success/failure decisions.
    """
    txt = (log or "").lower()
    marks = [
        (0.18, ("opensfm", "extract_metadata")),
        (0.24, ("detect_features", "feature")),
        (0.32, ("match_features", "matching")),
        (0.42, ("reconstruct", "bundle")),
        (0.50, ("finished opensfm stage", "export_openmvs")),
        (0.58, ("depthmap resolution", "densifypointcloud")),
        (0.66, ("filterpoints", "filter point cloud")),
        (0.74, ("meshing", "poissonrecon", "dem2mesh")),
        (0.82, ("texturing", "mvstex", "texture")),
        (0.88, ("dsm", "dtm", "dem", "merged.vrt")),
        (0.92, ("orthophoto", "odm_orthophoto")),
        (0.96, ("browser gate", "publicando", "verificando model")),
    ]
    best = None
    for pct, needles in marks:
        if any(n in txt for n in needles):
            best = pct
    best = max(float(current or 0), float(best or 0))
    if cid:
        safe_cid = re.sub(r"[^\w-]", "", cid)
        proj = VAULT / "odm" / f"proj_{safe_cid}"
        fs_marks = [
            (0.50, proj / "opensfm" / "reconstruction.json"),
            (0.66, proj / "odm_filterpoints" / "point_cloud.ply"),
            (0.74, proj / "odm_meshing"),
            (0.82, proj / "odm_texturing"),
            (0.88, proj / "odm_dem"),
            (0.92, proj / "odm_orthophoto"),
            (0.96, VAULT / "models" / cid / "meta.json"),
        ]
        for pct, path in fs_marks:
            if path.exists():
                best = max(float(best or 0), pct)
    return best


ASPECTS = {
    "16:9": "scale=-2:1080",
    "9:16": "crop=ih*9/16:ih,scale=1080:1920",
    "1:1": "crop=ih:ih,scale=1080:1080",
    "4:5": "crop=ih*4/5:ih,scale=1080:1350",
}

# altura destino por aspecto/resolución → aspect_vf() escala el resto en proporción
_ASPECT_H = {
    "16:9": {"1080": 1080, "2160": 2160},
    "9:16": {"1080": 1920, "2160": 3840},
    "1:1":  {"1080": 1080, "2160": 2160},
    "4:5":  {"1080": 1350, "2160": 2700},
}


def aspect_vf(aspect, resolution="1080"):
    # devuelve el filtro de crop/scale para el aspecto en la resolución pedida.
    # 1080 = comportamiento actual (default); 2160 duplica el destino.
    res = "2160" if str(resolution) == "2160" else "1080"
    if res == "1080":
        return ASPECTS.get(aspect, ASPECTS["16:9"])
    # 2160 (4K): mismo recorte, destino duplicado
    if aspect == "16:9":
        return "scale=-2:2160"
    if aspect == "9:16":
        return "crop=ih*9/16:ih,scale=2160:3840"
    if aspect == "1:1":
        return "crop=ih:ih,scale=2160:2160"
    if aspect == "4:5":
        return "crop=ih*4/5:ih,scale=2160:2700"
    return "scale=-2:2160"


XFADE_DUR = 0.4  # duración de crossfade (video + audio)
XFADE_DEFAULT = 0.4  # transDur por defecto para transiciones de librería

# nombres del contrato v7 → nombres válidos de transición de xfade en ffmpeg.
# crossfade/fade → 'fade'; el resto mapea 1:1 a la librería de xfade.
XFADE_MAP = {
    "fade": "fade",
    "crossfade": "fade",
    "dissolve": "dissolve",
    "wipeleft": "wipeleft",
    "wiperight": "wiperight",
    "slideup": "slideup",
    "slidedown": "slidedown",
    "circleopen": "circleopen",
    "circleclose": "circleclose",
    "radial": "radial",
    "smoothleft": "smoothleft",
    "fadeblack": "fadeblack",
    "fadewhite": "fadewhite",
    "pixelize": "pixelize",
}


def _clampf(v, lo, hi, default):
    # sanitiza numéricos del cliente: float + clamp, fallback si no es número.
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _grade_vf(grade):
    # traduce grade{bright,contrast,sat,temp} del contrato a filtros ffmpeg.
    # 100 = neutro para bright/contrast/sat; temp -100..100 (frío→cálido).
    # devuelve "" si todo es neutro (nada que aplicar).
    if not isinstance(grade, dict) or not grade:
        return ""
    bright = _clampf(grade.get("bright", 100), 50, 150, 100)
    contrast = _clampf(grade.get("contrast", 100), 50, 150, 100)
    sat = _clampf(grade.get("sat", 100), 0, 200, 100)
    temp = _clampf(grade.get("temp", 0), -100, 100, 0)
    parts = []
    # eq: brightness (bright-100)/100 → -0.5..0.5 ; contrast/100 ; saturation/100
    if bright != 100 or contrast != 100 or sat != 100:
        b = (bright - 100) / 100.0
        c = contrast / 100.0
        s = sat / 100.0
        parts.append(f"eq=brightness={b:.4f}:contrast={c:.4f}:saturation={s:.4f}")
    # temp: cálido (>0) sube rojos y baja azules; frío (<0) inverso. escala suave.
    if temp != 0:
        shift = temp / 100.0 * 0.3
        parts.append(f"colorbalance=rs={shift:.4f}:bs={-shift:.4f}")
    return ",".join(parts)


def _valid_hex6(c):
    # valida color hex de 6 dígitos (sin #). fallback 'ffffff'.
    c = str(c or "").lstrip("#").strip()
    if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
        return c.lower()
    return "ffffff"


def _title_drawtext(txt, style):
    # construye el filtro drawtext respetando titleStyle{pos,size,color,box}.
    # mantiene sombra + fade de alpha. txt ya viene sanitizado por el caller.
    style = style if isinstance(style, dict) else {}
    pos = style.get("pos", "bottom")
    y = {"top": "h*0.08", "mid": "(h-th)/2", "bottom": "h*0.82"}.get(pos, "h*0.82")
    # size 1..100 → divisor ~28 (pequeño) .. 8 (grande); mayor size = divisor menor
    size = _clampf(style.get("size", 42), 1, 100, 42)
    div = 28 - (size - 1) / 99.0 * 20  # 1→28 , 100→8
    color = _valid_hex6(style.get("color", "ffffff"))
    box = ""
    if style.get("box"):
        box = ":box=1:boxcolor=black@0.45:boxborderw=12"
    return (f"drawtext=fontfile={FONT}:text='{txt}':fontcolor=0x{color}"
            f":fontsize=h/{div:.2f}{box}"
            f":shadowx=2:shadowy=2:x=(w-text_w)/2:y={y}:alpha='min(1,t)'")


def _atempo_chain(speed):
    # atempo solo acepta 0.5..2.0 → encadena factores para speeds fuera de rango
    # p.ej. 4x = atempo=2.0,atempo=2.0 ; 0.25x = atempo=0.5,atempo=0.5
    if speed == 1:
        return []
    factors, rem = [], speed
    while rem > 2.0:
        factors.append(2.0)
        rem /= 2.0
    while rem < 0.5:
        factors.append(0.5)
        rem /= 0.5
    factors.append(rem)
    return [f"atempo={f:.4f}".rstrip("0").rstrip(".") for f in factors]


def _has_audio(src):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a",
                            "-show_entries", "stream=index", "-of", "csv=p=0", str(src)],
                           capture_output=True, text=True)
        return bool(r.stdout.strip())
    except Exception:
        return False


def _probe_dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def run_edit(spec: dict, j):
    try:
        fps = int(spec.get("fps") or 0)
        fps = fps if fps in (24, 30, 60) else 0        # 0 = fps del fuente
        br = f'{_clampf(spec.get("bitrate", 10), 3, 60, 10):g}M'
        rate = ["-r", str(fps)] if fps else []
        default_cid = re.sub(r"[^\w-]", "", spec.get("clip_id", ""))
        aspect = spec.get("aspect") or ("9:16" if spec.get("vertical") else "16:9")
        resolution = "2160" if str(spec.get("resolution", "1080")) == "2160" else "1080"
        base_vf = aspect_vf(aspect, resolution)
        lut = LUTS.get(spec.get("filter", "none"), "")
        fade = spec.get("fade", True)
        keep_audio = spec.get("audio") == "original"  # NUEVO: conservar audio del fuente
        title = str(spec.get("title", ""))[:60].replace("\\", "").replace("'", "").replace("%", "").replace(":", r"\:")
        tmp = VAULT / "reels" / ".tmp"
        tmp.mkdir(parents=True, exist_ok=True)
        segs = []
        transitions = []  # transición de ENTRADA a cada corte (nombre del contrato v7)
        trans_durs = []   # transDur por corte (paralelo a transitions)
        raw_segs = spec["segments"][:24]
        for i, s in enumerate(raw_segs):
            if not isinstance(s, dict):
                s = {"a": s[0], "b": s[1]}
            a, b = float(s["a"]), float(s["b"])
            speed = min(max(float(s.get("speed", 1)), 0.1), 100.0)
            if b <= a:
                continue
            # multi-clip: cada corte puede venir de un clip distinto (timeline CapCut-style)
            cid = re.sub(r"[^\w-]", "", s.get("clip_id", "") or default_cid)
            src = VAULT / "proxies" / f"{cid}.mp4"
            if not src.exists():
                raise FileNotFoundError(f"{cid} sin proxy")
            seg_lut = LUTS.get(s.get("filter", spec.get("filter", "none")), lut)
            seg_title = str(s.get("title", ""))[:60].replace("\\", "").replace("'", "").replace("%", "").replace(":", r"\:")
            title_style = s.get("titleStyle") if isinstance(s.get("titleStyle"), dict) else {}
            grade_vf = _grade_vf(s.get("grade"))
            reverse = bool(s.get("reverse"))
            freeze = _clampf(s.get("freeze", 0), 0, 30, 0) if s.get("freeze") else 0
            in_dur = min(b - a, 120)
            # freeze congela el frame de 'a' durante 'freeze' seg; ignora speed/reverse
            out_dur = freeze if freeze else in_dur / speed
            vf = [base_vf]
            if seg_lut:
                vf.append(seg_lut)
            # grade DESPUÉS del LUT y ANTES de setpts (contrato v7)
            if grade_vf:
                vf.append(grade_vf)
            if freeze:
                # congela el primer frame: recorta ~1 frame y lo clona por 'freeze' seg
                vf.append(f"trim=0:0.04,setpts=N/FRAME_RATE/TB,tpad=stop_duration={freeze:.2f}:stop_mode=clone")
            else:
                if reverse:
                    vf.append("reverse")
                if speed != 1:
                    vf.append(f"setpts=PTS/{speed}")
            if fade:
                vf.append(f"fade=t=in:st=0:d=0.25,fade=t=out:st={max(out_dur - 0.25, 0):.2f}:d=0.25")
            if (seg_title or (title and i == 0)) and HAS_DRAWTEXT:
                txt = seg_title or title
                vf.append(_title_drawtext(txt, title_style if seg_title else {}))
            seg = tmp / f"e{i}.mp4"
            cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(a), "-i", str(src)]
            if keep_audio:
                src_audio = _has_audio(src)
                # audio real solo tiene sentido a velocidad normal (o casi): reverse, freeze y
                # speeds extremos (fuera de 0.5..4) no se pueden mapear a atempo sin romper →
                # se silencia ESE segmento con anullsrc de out_dur (streams siguen emparejados).
                audio_ok = src_audio and not reverse and not freeze and 0.5 <= speed <= 4.0
                if not audio_ok:
                    cmd += ["-f", "lavfi", "-t", f"{out_dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
                # audio recortado al mismo rango, atempo para la velocidad, normalizado aac/48k/stereo
                af = []
                if audio_ok and speed != 1:
                    af += _atempo_chain(speed)
                af.append("aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo")
                a_map = "0:a:0" if audio_ok else "1:a:0"
                # -t = out_dur (duración REAL del segmento tras setpts): el video y el
                # silencio anullsrc quedan de la misma longitud → sin desfase A/V en la concat
                cmd += ["-t", f"{out_dur:.3f}", "-map", "0:v:0", "-map", a_map,
                        "-vf", ",".join(vf), "-af", ",".join(af),
                        *rate, "-c:v", "h264_videotoolbox", "-b:v", br,
                        "-c:a", "aac", "-ar", "48000", "-ac", "2", str(seg)]
            else:
                cmd += ["-t", f"{out_dur:.3f}", "-vf", ",".join(vf), "-an",
                        *rate, "-c:v", "h264_videotoolbox", "-b:v", br, str(seg)]
            subprocess.run(cmd, check=True)
            segs.append(seg)
            transitions.append(s.get("transition", "none"))
            trans_durs.append(_clampf(s.get("transDur", XFADE_DEFAULT), 0.2, 1.5, XFADE_DEFAULT))
        if not segs:
            raise ValueError("sin segmentos válidos")
        out = VAULT / "reels" / f"edit-{time.strftime('%Y%m%d-%H%M%S')}{'-v' if spec.get('vertical') else ''}.mp4"

        # cualquier corte (idx>=1) con transición != 'none' entra a la ruta xfade encadenada
        def _xname(t):
            return XFADE_MAP.get(t) if t and t != "none" else None
        wants_xfade = len(segs) > 1 and any(_xname(t) for t in transitions[1:])
        if not wants_xfade:
            # ruta concat actual (rápida, probada) — cortes duros; 'fade' ya aplicado por segmento
            lst = tmp / "l.txt"
            lst.write_text("".join(f"file '{s}'\n" for s in segs))
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                            "-i", str(lst), "-c", "copy", str(out)], check=True)
            lst.unlink()
        else:
            # pase final con xfade encadenado en cada corte que pida transición de librería;
            # los cortes 'none' van duros (xfade fade con duración ~0.001).
            durs = [_probe_dur(s) for s in segs]
            cmd = ["ffmpeg", "-v", "error", "-y"]
            for s in segs:
                cmd += ["-i", str(s)]
            fc = []
            vprev, aprev = "[0:v]", "[0:a]"
            acc = durs[0]  # tiempo acumulado del stream de video ya compuesto
            for i in range(1, len(segs)):
                xname = _xname(transitions[i])  # nombre mapeado de ffmpeg o None si 'none'
                td = trans_durs[i]              # transDur ya clamp 0.2..1.5
                # transición no puede durar más que el clip más corto del par
                td = min(td, max(min(durs[i - 1], durs[i]) - 0.05, 0.05))
                d = td if xname else 0.0
                vout = f"[v{i}]"
                offset = acc - d  # inicio del solape sobre la línea de tiempo actual
                fc.append(f"{vprev}[{i}:v]xfade=transition={xname or 'fade'}"
                          f":duration={d if xname else 0.001:.3f}"
                          f":offset={max(offset, 0):.3f}{vout}")
                if keep_audio:
                    aout = f"[a{i}]"
                    if xname:
                        fc.append(f"{aprev}[{i}:a]acrossfade=d={td:.3f}{aout}")
                    else:
                        fc.append(f"{aprev}[{i}:a]concat=n=2:v=0:a=1{aout}")
                    aprev = aout
                vprev = vout
                acc = acc + durs[i] - d
            maps = ["-map", vprev]
            if keep_audio:
                maps += ["-map", aprev]
            cmd += ["-filter_complex", ";".join(fc), *maps,
                    "-c:v", "h264_videotoolbox", "-b:v", br]
            if keep_audio:
                cmd += ["-c:a", "aac", "-ar", "48000", "-ac", "2"]
            cmd.append(str(out))
            subprocess.run(cmd, check=True)
        for s in segs:
            s.unlink()
        rebuild_index()
        job_end(j, "done", out.name)
    except Exception as e:
        job_end(j, "error", str(e)[-300:])


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # ---------- static with Range ----------
    def resolve(self):
        p = urllib.parse.urlparse(self.path).path
        p = urllib.parse.unquote(p)
        if p == "/":
            p = "/home.html"
        if p.startswith("/supersplat"):
            # editor SuperSplat (MIT, build local en splat/supersplat/dist) — post-pro de splats
            base = SUPERSPLAT.resolve()
            rel = p[len("/supersplat"):].lstrip("/") or "index.html"
        else:
            base = (VAULT if p.startswith("/data/") else WEB).resolve()
            rel = p[6:] if p.startswith("/data/") else p.lstrip("/")
        f = (base / rel).resolve()
        try:
            f.relative_to(base)  # contención estricta (startswith es bypasseable: vault2/)
        except ValueError:
            return None
        return f if f.is_file() else None

    def do_GET(self):
        if self.path.startswith("/api/healthz"):
            body, code = health_status()
            if not (self._is_local() or self.headers.get("X-Token", "") == TOKEN or self.session_ok()):
                body = {"ok": body["ok"], "ts": body["ts"]}
            return self.send_json(body, code)
        if self.path.startswith("/api/whoami"):
            if self._is_local() or self.headers.get("X-Token", "") == TOKEN or self.session_ok():
                return self.send_json({"ok": True, "local": self._is_local()})
            return self.send_json({"ok": False}, 403)
        if self.path.startswith("/api/jobs"):
            if not self.auth():
                return
            jobs = jobstore.recent()
            for j in jobs:
                # progreso derivado del log si el worker corre codigo viejo (stale DB)
                if j["kind"] == "splat" and j["status"] == "running":
                    m = re.findall(r"\((\d+)%\)", j.get("log") or "")
                    if m:
                        j["progress"] = max(j.get("progress") or 0, 0.05 + 0.93 * int(m[-1]) / 100)
                if j["kind"] == "3d" and j["status"] == "running":
                    j["progress"] = derive_odm_progress(j.get("log") or "", j.get("progress"), j.get("label") or "")
                # los links de jobs viejos no deben apuntar a modelos borrados
                if j["status"] == "done" and j.get("artifact"):
                    j["artifact_exists"] = (VAULT / j["artifact"]).exists()
            return self.send_json({"jobs": jobs})
        if self.path.startswith("/api/capture_report"):
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            cid = re.sub(r"[^\w-]", "", (qs.get("clip_id") or [""])[0])
            if not cid:
                return self.send_json({"error": "clip_id requerido"}, 400)
            import capture_quality
            try:
                rep = (None if "force" in qs else capture_quality.cached(cid)) or capture_quality.analyze(cid)
            except Exception as e:
                return self.send_json({"error": str(e)[-200:]}, 500)
            rep.pop("samples", None)
            return self.send_json(rep)
        if self.path.startswith("/api/sd_scan"):
            if not self.auth():
                return
            return self.send_json({"volumes": sd_volumes()})
        if self.path.startswith("/api/studio_media"):
            if not self.auth():
                return
            out = {}
            for key, sub, ext in (("reels", "reels", ".mp4"), ("photos", "photos", ".jpg")):
                base = VAULT / sub
                items = []
                if base.is_dir():
                    for f in base.iterdir():
                        if f.name.startswith(".") or f.is_symlink() or not f.is_file() or f.suffix.lower() != ext:
                            continue
                        st = f.stat()
                        items.append({"name": f.name, "bytes": st.st_size, "mtime": st.st_mtime})
                items.sort(key=lambda x: x["mtime"], reverse=True)
                out[key] = items
            return self.send_json(out)
        if self.path.startswith("/api/properties"):
            if not self.auth():
                return
            return self.do_GET_properties()
        f = self.resolve()
        if not f:
            return self.send_error(404)
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        # binarios 3D pesados (nube/malla/splat): cachear PERO revalidar (no-cache + 304).
        # Las URLs no llevan versión y un re-entreno reescribe el mismo nombre — max-age
        # serviría stale; no-store re-bajaría MBs en cada visita. 304 = lo mejor de ambos.
        # los bundles de SuperSplat (23MB dist) solo cambian al rebuildear: 304 también.
        # imágenes bajo models/ (vt*/ortho/dsm) cambian en re-procesado → revalidan, no 24h stale
        model_img = (f.suffix.lower() in (".jpg", ".png", ".webp")
                     and str(f).startswith(str(VAULT / "models")))
        revalidate = (f.suffix.lower() in REVALIDATE_EXTS or str(f).startswith(str(SUPERSPLAT))
                      or model_img)
        mtime = int(f.stat().st_mtime)
        if revalidate and not rng:
            ims = self.headers.get("If-Modified-Since")
            if ims:
                try:
                    since = parsedate_to_datetime(ims).timestamp()
                except (TypeError, ValueError):
                    since = -1
                if mtime <= since:
                    self.send_response(304)
                    self.send_header("Last-Modified", formatdate(mtime, usegmt=True))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    return
        # sidecar .gz pre-comprimido (nube/malla): Content-Encoding gzip transparente.
        # Solo sin Range — gzip + rangos parciales no se mezclan.
        gz = Path(str(f) + ".gz")
        if not rng and gz.is_file() and "gzip" in self.headers.get("Accept-Encoding", ""):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(gz.stat().st_size))
            if revalidate:
                self.send_header("Last-Modified", formatdate(mtime, usegmt=True))
                self.send_header("Cache-Control", "no-cache")
            else:
                self.send_header("Cache-Control", "no-store, must-revalidate")
            self.end_headers()
            with open(gz, "rb") as fh:
                while chunk := fh.read(1 << 19):
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        return
            try:
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            return
        size = f.stat().st_size
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        self.send_response(206 if rng else 200)
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        # media inmutable se cachea; binarios 3D revalidan (304); código NUNCA se cachea
        # (iPhone quedó quemado con CSS viejo)
        cacheable = f.suffix in (".mp4", ".jpg", ".png", ".woff2", ".svg", ".webp")
        if revalidate:
            self.send_header("Last-Modified", formatdate(mtime, usegmt=True))
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=86400" if cacheable else "no-store, must-revalidate")
        if f.suffix == ".html":
            # SuperSplat vive embebido en un iframe de splatlab.html (mismo origen)
            anc = "'self'" if str(f).startswith(str(SUPERSPLAT)) else "'none'"
            self.send_header("Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "  # wasm: el sort worker de splats compila WebAssembly
                "style-src 'self' 'unsafe-inline'; "        # inline style attrs (bajo riesgo)
                "img-src 'self' data: blob: https:; "
                "connect-src 'self' https://server.arcgisonline.com https://basemaps.cartocdn.com; "
                f"worker-src 'self' blob:; media-src 'self' blob:; frame-src 'self'; frame-ancestors {anc}")
            self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(1024 * 1024, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)
        try:
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def do_HEAD(self):
        if self.path.startswith("/api/healthz"):
            body, code = health_status()
            if not (self._is_local() or self.headers.get("X-Token", "") == TOKEN or self.session_ok()):
                body = {"ok": body["ok"], "ts": body["ts"]}
            payload = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.end_headers()
            return
        f = self.resolve()
        if not f:
            return self.send_error(404)
        gz = Path(str(f) + ".gz")
        self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        # espejo del GET: binarios 3D anuncian validador para el caché condicional
        if f.suffix.lower() in REVALIDATE_EXTS:
            self.send_header("Last-Modified", formatdate(int(f.stat().st_mtime), usegmt=True))
            self.send_header("Cache-Control", "no-cache")
        if gz.is_file() and "gzip" in self.headers.get("Accept-Encoding", ""):
            # espejo exacto de lo que GET va a servir (audit: HEAD mentia el tamano)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(gz.stat().st_size))
        else:
            self.send_header("Content-Length", str(f.stat().st_size))
        self.send_header("Content-Type", mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self.end_headers()

    # ---------- API ----------
    def _cookie(self, name):
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return ""

    def _is_local(self) -> bool:
        # El server bindea 127.0.0.1 y sólo se expone al mundo por Cloudflare
        # Tunnel, que estampa CF-Connecting-IP/CF-Ray en requests externos.
        # Además bloqueamos browser-CSRF desde páginas externas hacia localhost:
        # agentes/curl no mandan Sec-Fetch-Site; la UI local manda same-origin.
        if self.headers.get("CF-Connecting-IP") or self.headers.get("CF-Ray"):
            return False
        host, _ = self.client_address
        if host not in ("127.0.0.1", "::1"):
            return False
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if site and site not in ("same-origin", "same-site", "none"):
            return False
        origin = self.headers.get("Origin") or ""
        if origin and not (origin.startswith("http://127.0.0.1:8790") or
                           origin.startswith("http://localhost:8790")):
            return False
        return True

    def session_ok(self) -> bool:
        return jobstore.session_valid(self._cookie("ab_s"))

    def auth(self, q=None):
        # agentes locales (mismo Mac): acceso sin fricción para test/automatización
        if self._is_local():
            return True
        # externos (vía túnel): header X-Token o cookie de sesión; query tokens NO
        if self.headers.get("X-Token", "") == TOKEN or self.session_ok():
            return True
        self.send_json({"error": "auth requerida (header X-Token o sesión)"}, 403)
        return False

    def read_json(self, max_bytes=1_000_000):
        n = int(self.headers.get("Content-Length", 0))
        if not 0 < n <= max_bytes:
            raise ValueError(f"body inválido ({n} bytes)")
        return json.loads(self.rfile.read(n))

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # cliente se fue; nada que enviar

    def do_POST(self):
        try:
            self._post()
        except (ValueError, json.JSONDecodeError):
            self._safe_send({"error": "JSON inválido o body demasiado grande"}, 400)
        except BrokenPipeError:
            pass
        except Exception as e:
            self._safe_send({"error": "error interno del servidor"}, 500)

    def _safe_send(self, obj, code):
        try:
            self.send_json(obj, code)
        except Exception:
            pass

    def _post(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/login":
            try:
                body = self.read_json(4096)
            except Exception:
                return self.send_json({"error": "body inválido"}, 400)
            ok = False
            if body.get("token"):
                ok = str(body["token"]) == TOKEN
            elif body.get("user") and body.get("password") is not None:
                import hashlib
                env = _sb_keys()
                u_ok = str(body["user"]).strip().lower() == env.get("AEROBRAIN_USER", "").strip().lower()
                p_ok = (hashlib.sha256(str(body["password"]).encode()).hexdigest()
                        == env.get("AEROBRAIN_PASS_SHA256", ""))
                ok = u_ok and p_ok
            if not ok:
                time.sleep(1)  # frena fuerza bruta
                return self.send_json({"error": "credenciales inválidas"}, 403)
            jobstore.session_delete(self._cookie("ab_s"))  # rota el id viejo
            sid = jobstore.session_create(30)
            body_out = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie",
                             f"ab_s={sid}; Path=/; Max-Age={30*86400}; HttpOnly; SameSite=Strict; Secure")
            self.send_header("Content-Length", str(len(body_out)))
            self.end_headers()
            self.wfile.write(body_out)
            return
        if u.path == "/api/logout":
            jobstore.session_delete(self._cookie("ab_s"))
            self.send_response(200)
            self.send_header("Set-Cookie", "ab_s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if u.path == "/api/job_cancel":
            if not self.auth(q):
                return
            spec = self.read_json(4096)
            ok = jobstore.cancel(str(spec.get("id", "")))
            return self.send_json({"ok": ok})
        if u.path == "/upload":
            if not self.auth(q):
                return
            name = re.sub(r"[^\w.\-]", "_", Path(q.get("name", ["video.mp4"])[0]).name)
            ext = Path(name).suffix.lower() or ".mp4"
            if ext not in (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".webm"):
                return self.send_json({"error": f"formato {ext} no soportado"}, 400)
            length = int(self.headers.get("Content-Length", 0))
            if not length:
                return self.send_json({"error": "body vacío"}, 400)
            if length > 25 * 1024**3:  # 25GB tope de cordura (video 4K real cabe de sobra)
                return self.send_json({"error": "archivo > 25GB"}, 413)
            cid = f"UP_{time.strftime('%Y%m%d%H%M%S')}_{Path(name).stem[:40]}"
            dest = VAULT / "raw" / "uploads"
            dest.mkdir(parents=True, exist_ok=True)
            path = dest / f"{cid}{ext}"
            read = 0
            with open(path, "wb") as f:
                while read < length:
                    chunk = self.rfile.read(min(1024 * 512, length - read))
                    if not chunk:
                        break
                    f.write(chunk)
                    read += len(chunk)
            j = job_add("upload", name)
            threading.Thread(target=process_upload, args=(path, j), daemon=True).start()
            return self.send_json({"ok": True, "clip_id": cid, "bytes": read, "job": j["id"]})
        if u.path == "/api/splat_upload":
            # round-trip de Splat Lab: sube el splat EDITADO (SuperSplat export) y publícalo
            # versionado — los formatos anteriores del clip van a splats/history/ (nada se pierde)
            if not self.auth(q):
                return
            cid = re.sub(r"[^\w-]", "", q.get("cid", [""])[0])
            name = re.sub(r"[^\w.\-]", "_", Path(q.get("name", [""])[0]).name)
            ext = Path(name).suffix.lower()
            if not cid:
                return self.send_json({"error": "cid requerido"}, 400)
            if ext not in (".ply", ".splat", ".ksplat"):
                return self.send_json({"error": f"formato {ext or '?'} no soportado (.ply/.splat/.ksplat)"}, 400)
            if jobstore.pending("splat", cid):     # no pisar un entrenamiento que escribe el mismo .splat
                return self.send_json({"error": "hay un entrenamiento de splat activo para este clip — espera a que termine"}, 409)
            length = int(self.headers.get("Content-Length", 0))
            if not length:
                return self.send_json({"error": "body vacío"}, 400)
            if length > 2 * 1024**3:
                return self.send_json({"error": "archivo > 2GB"}, 413)
            sdir = VAULT / "splats"
            sdir.mkdir(parents=True, exist_ok=True)
            tmp = sdir / f".upload-{cid}-{secrets.token_hex(4)}{ext}"   # único: 2 uploads no colisionan
            read = 0
            with open(tmp, "wb") as f:
                while read < length:
                    chunk = self.rfile.read(min(1024 * 512, length - read))
                    if not chunk:
                        break
                    f.write(chunk)
                    read += len(chunk)
            if read != length:
                tmp.unlink(missing_ok=True)
                return self.send_json({"error": f"subida incompleta ({read}/{length} bytes)"}, 400)
            # archiva TODAS las variantes publicadas: si quedara un .ksplat viejo, el
            # manifest lo preferiría sobre el archivo editado recién subido. Conservamos también
            # metadata/cámaras para que el selector de versiones no pierda calidad/iters/cámaras.
            hist = sdir / "history"
            hist.mkdir(exist_ok=True)
            ts = time.strftime("%Y%m%d-%H%M%S")
            archived = []
            for old in (sdir / f"{cid}.splat", sdir / f"{cid}.ksplat", sdir / f"{cid}.ply",
                        sdir / f"{cid}.meta.json", sdir / f"{cid}.cameras.json"):
                if old.is_file():
                    suffix = old.name[len(cid):]
                    os.replace(old, hist / f"{cid}-{ts}{suffix}")
                    archived.append(old.name)
            prune_splat_history(hist, cid, keep=6)
            final = sdir / f"{cid}{ext}"
            os.replace(tmp, final)
            kname = None
            if ext != ".ksplat":   # optimizado para el viewer (no fatal si node falla)
                ktmp = sdir / f"{cid}.ksplat.tmp"
                try:
                    r = subprocess.run(["node", str(PIPE / "make_ksplat.mjs"), str(final), str(ktmp)],
                                       capture_output=True, text=True, timeout=600)
                    if r.returncode == 0 and ktmp.exists() and ktmp.stat().st_size > 1024:
                        os.replace(ktmp, sdir / f"{cid}.ksplat")
                        kname = f"{cid}.ksplat"
                    else:
                        ktmp.unlink(missing_ok=True)
                except (OSError, subprocess.TimeoutExpired):
                    ktmp.unlink(missing_ok=True)
            rebuild_index()
            return self.send_json({"ok": True, "published": final.name, "ksplat": kname,
                                   "archived": archived, "bytes": read})
        if u.path == "/api/edit":
            if not self.auth(q):
                return
            spec = self.read_json()
            j = job_add("edit", f'{len(spec.get("segments", []))} cortes')
            threading.Thread(target=run_edit, args=(spec, j), daemon=True).start()
            return self.send_json({"ok": True, "job": j["id"]})
        if u.path == "/api/sd_import":
            if not self.auth(q):
                return
            spec = self.read_json()
            _exts = SD_VIDEO_EXT + (SD_PHOTO_EXT if spec.get("clean_only") else ())
            try:
                for rel in list(spec.get("files", []))[:500]:
                    _sd_resolve(str(spec.get("volume", "")), str(rel), _exts)
            except (ValueError, OSError) as e:
                return self.send_json({"error": str(e)}, 400)
            if not spec.get("files"):
                return self.send_json({"error": "elige al menos un video"}, 400)
            j = job_add("ingest", f'{spec.get("volume", "?")} · {len(spec["files"])} archivos')
            target = run_sd_clean if spec.get("clean_only") else run_sd_import
            threading.Thread(target=target, args=(spec, j), daemon=True).start()
            return self.send_json({"ok": True, "job": j["id"]})
        if u.path == "/api/frame":
            if not self.auth(q):
                return
            spec = self.read_json()
            j = job_add("foto4k", f'{spec.get("clip_id", "?")} @ {spec.get("t", 0)}s')
            th = threading.Thread(target=capture_frame, args=(spec, j), daemon=True)
            th.start()
            th.join(timeout=25)  # las fotos son rápidas: respuesta síncrona con la URL
            fresh = jobstore.get(j["id"]) or {}   # re-lee del store (el dict local es stale)
            done = fresh.get("status") == "done"
            return self.send_json({"ok": done, "url": f"/data/{fresh.get('detail')}" if done else None,
                                   "error": None if done else (fresh.get("detail") or "captura falló o tardó demasiado")})
        if u.path == "/api/measure":
            # mediciones survey contra el DSM: volumen (stockpile) y perfil de elevación
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            mdir = VAULT / "models" / cid
            if not (mdir / "dsm.bin").exists():
                return self.send_json({"error": "este proyecto no tiene DSM aún"}, 404)
            try:
                if spec.get("type") == "volume":
                    check_polygon(spec.get("points", []))
                return self.send_json(measure_dsm(mdir, spec))
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            except Exception as e:
                return self.send_json({"error": str(e)[-200:]}, 500)
        if u.path == "/api/compare":
            if not self.auth(q):
                return
            spec = self.read_json()
            a = re.sub(r"[^\w-]", "", str(spec.get("clip_a", "")))
            b = re.sub(r"[^\w-]", "", str(spec.get("clip_b", "")))
            da, db = VAULT / "models" / a, VAULT / "models" / b
            if not ((da / "dsm.bin").exists() and (db / "dsm.bin").exists()):
                return self.send_json({"error": "ambas fechas necesitan modelo 3D con DSM"}, 404)
            try:
                check_polygon(spec.get("points", []))
                return self.send_json(compare_dsm(da, db, spec.get("points", [])))
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            except Exception as e:
                return self.send_json({"error": str(e)[-200:]}, 500)
        if u.path == "/api/odm":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            if not cid:
                return self.send_json({"error": "clip_id requerido"}, 400)
            if jobstore.pending("3d", cid):
                return self.send_json({"error": "ese vuelo ya está en cola o procesándose"}, 409)
            preset = str(spec.get("preset", "estandar"))
            if preset not in ("rapido", "estandar", "alta", "extra", "ultra"):
                preset = "estandar"
            j = jobstore.enqueue("3d", cid, {"clip_id": cid, "preset": preset,
                                             "title": str(spec.get("title", ""))[:80].strip()})
            return self.send_json({"ok": True, "job": j["id"], "queued": True})
        if u.path == "/api/model_update":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            mdir = VAULT / "models" / cid
            if not cid or not (mdir / "meta.json").exists():
                return self.send_json({"error": "modelo no encontrado"}, 404)
            meta = json.loads((mdir / "meta.json").read_text())
            meta["title"] = str(spec.get("title", ""))[:80].strip()
            _mt = mdir / "meta.json.tmp"; _mt.write_text(json.dumps(meta, indent=1)); os.replace(_mt, mdir / "meta.json")
            rebuild_index()
            return self.send_json({"ok": True, "title": meta["title"]})
        if u.path == "/api/model_delete":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            mdir = (VAULT / "models" / cid).resolve()
            if not cid or mdir.parent != (VAULT / "models").resolve() or not mdir.is_dir():
                return self.send_json({"error": "modelo no encontrado"}, 404)
            if jobstore.pending("3d", cid) or jobstore.pending("splat", cid):
                return self.send_json({"error": "hay un trabajo activo sobre este modelo — cancélalo primero"}, 409)
            freed = ["models/" + cid]
            shutil.rmtree(mdir)
            # borra TODO el set de splat del clip + historial: si sobrevive el .ksplat, best_splats
            # lo rankea sobre el .splat y el splat "borrado" RESUCITA en la UI (cid ya saneado)
            sdir = VAULT / "splats"
            for extra in sdir.glob(f"{cid}.*"):        # .splat .ksplat .cameras.json .meta.json
                if extra.is_file():
                    extra.unlink(); freed.append("splats/" + extra.name)
            hist = sdir / "history"
            for h in clip_history_files(hist, cid):     # re-subidas archivadas de SuperSplat (solo ESTE clip)
                if h.is_file():
                    h.unlink(); freed.append("splats/history/" + h.name)
            # purga opcional del proyecto ODM (GBs de frames+etapas; el video RAW nunca se toca)
            # sin alias legacy proj0104: cada clip usa SU proyecto (proj0104 compartido = data-loss si 2 clips 0104_D)
            proj = (VAULT / "odm" / f"proj_{cid}").resolve()
            if spec.get("purge_source") and proj.parent == (VAULT / "odm").resolve() and proj.is_dir():
                shutil.rmtree(proj)
                freed.append("odm/" + proj.name)
            jobstore.clear_artifacts(cid)
            rebuild_index()
            return self.send_json({"ok": True, "freed": freed})
        if u.path == "/api/splat_delete":
            # borra SOLO el splat (a la papelera, reversible) — el modelo 3D, la nube y el
            # video RAW no se tocan. Para nuke completo del clip existe /api/model_delete.
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            if not cid:
                return self.send_json({"error": "clip_id requerido"}, 400)
            if jobstore.pending("splat", cid):
                return self.send_json({"error": "hay un entrenamiento activo sobre este splat — cancélalo primero"}, 409)
            sdir = (VAULT / "splats").resolve()
            tdir = VAULT / "trash" / "splats"
            tdir.mkdir(parents=True, exist_ok=True)
            moved = []

            def _to_trash(src: Path, rel: str):
                dst = tdir / src.name
                if dst.exists():
                    dst = tdir / f"{src.stem}.{time.time_ns()}{src.suffix}"
                shutil.move(str(src), str(dst))
                moved.append(rel + src.name)

            for extra in sorted(sdir.glob(f"{cid}.*")):     # .splat .ksplat .cameras.json .meta.json
                if extra.is_file() and not extra.is_symlink() and extra.resolve().parent == sdir:
                    _to_trash(extra, "splats/")
            hist = sdir / "history"
            for h in sorted(clip_history_files(hist, cid)):   # re-subidas archivadas de SuperSplat (solo ESTE clip)
                if h.is_file() and not h.is_symlink():
                    _to_trash(h, "splats/history/")
            if not moved:
                return self.send_json({"error": "no hay splat para este clip"}, 404)
            rebuild_index()
            return self.send_json({"ok": True, "moved": moved})
        if u.path == "/api/media_op":
            if not self.auth(q):
                return
            spec = self.read_json()
            op = str(spec.get("op", ""))
            mtype = str(spec.get("type", ""))
            name = str(spec.get("name", ""))
            if op not in ("rename", "delete", "duplicate"):
                return self.send_json({"error": "op inválida"}, 400)
            if mtype not in ("reel", "photo"):
                return self.send_json({"error": "type inválido"}, 400)
            if not name or "/" in name or "\\" in name or name.startswith("."):
                return self.send_json({"error": "nombre inválido"}, 400)
            base = (VAULT / ("reels" if mtype == "reel" else "photos")).resolve()
            if (base / name).is_symlink():
                return self.send_json({"error": "nombre inválido"}, 400)
            src = (base / name).resolve()
            try:
                src.relative_to(base)  # contención: nunca fuera del directorio
            except ValueError:
                return self.send_json({"error": "nombre inválido"}, 400)
            if not src.is_file():
                return self.send_json({"error": "archivo no encontrado"}, 400)
            if op == "delete":
                tdir = VAULT / "trash" / mtype
                tdir.mkdir(parents=True, exist_ok=True)
                dst = tdir / src.name
                if dst.exists():
                    dst = tdir / f"{src.stem}.{time.time_ns()}{src.suffix}"
                shutil.move(str(src), str(dst))
                rebuild_index()
                return self.send_json({"ok": True, "name": dst.name})
            if op == "rename":
                new_name = re.sub(r"[^\w.\- ]", "", str(spec.get("new_name", ""))).strip()
                if new_name.lower().endswith(src.suffix.lower()):  # quita ext duplicada
                    new_name = new_name[: -len(src.suffix)].strip()
                if not new_name or new_name.startswith("."):
                    return self.send_json({"error": "nombre nuevo inválido"}, 400)
                dst = base / (new_name + src.suffix)
                if dst.exists():
                    return self.send_json({"error": "ya existe un archivo con ese nombre"}, 400)
                src.rename(dst)
                rebuild_index()
                return self.send_json({"ok": True, "name": dst.name})
            # duplicate: sufijo " copia" (o " copia 2", " copia 3", ...)
            dst = base / f"{src.stem} copia{src.suffix}"
            n = 2
            while dst.exists():
                dst = base / f"{src.stem} copia {n}{src.suffix}"
                n += 1
            shutil.copy2(src, dst)
            rebuild_index()
            return self.send_json({"ok": True, "name": dst.name})
        if u.path == "/api/splat":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            proj = VAULT / "odm" / f"proj_{cid}"    # sin alias legacy: cada clip usa SU proyecto (proj0104 compartido = data-loss si 2 clips 0104_D)
            has_model = (proj / "opensfm" / "reconstruction.json").exists()
            if not has_model and not spec.get("auto_model"):
                return self.send_json({"error": "primero procesa el vuelo en 3D (necesita las poses de ODM)"}, 400)
            if not has_model and not (VAULT / "manifest" / f"{cid}.json").exists():
                return self.send_json({"error": "clip no encontrado en el vault"}, 404)
            try:
                preset = resolve_splat_spec(spec)
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            if not any_opensplat_bin_exists():
                return self.send_json({"error": "opensplat no está compilado"}, 500)
            if jobstore.pending("splat", cid) or jobstore.pending("3d", cid):
                return self.send_json({"error": "ese vuelo ya tiene un modelo/splat en cola o entrenando"}, 409)
            model_preset = str(spec.get("model_preset") or "estandar")
            if model_preset not in ("rapido", "estandar", "alta", "extra", "ultra"):
                model_preset = "estandar"
            j = jobstore.enqueue("splat", cid, {"clip_id": cid, "preset": preset["key"], "iters": preset["iters"],
                                                "auto_model": bool(spec.get("auto_model")),
                                                "model_preset": model_preset,
                                                "title": str(spec.get("title", ""))[:80].strip()})
            return self.send_json({"ok": True, "job": j["id"], "queued": True,
                                   "preset": preset["key"], "iters": preset["iters"]})
        if u.path == "/api/analyze":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            j = job_add("analyze", f"{cid} (profundo)")

            def _run():
                try:
                    subprocess.run(["python3", str(PIPE.parent / "ai" / "analyze.py"),
                                    cid, "--deep"], check=True, capture_output=True, text=True,
                                   cwd=PIPE.parent / "ai")
                    rebuild_index()
                    job_end(j, "done", cid)
                except subprocess.CalledProcessError as e:
                    job_end(j, "error", (e.stderr or str(e))[-250:])
            threading.Thread(target=_run, daemon=True).start()
            return self.send_json({"ok": True, "job": j["id"]})
        if u.path == "/api/highlight":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            aif = VAULT / "ai" / f"{cid}.json"
            data = read_json_file(aif) if aif.exists() else {"clip_id": cid, "tags": [], "highlights": []}
            data.setdefault("highlights", []).append({
                "t": round(float(spec.get("t", 0)), 1),
                "reason": str(spec.get("reason", "marcado por Daniel"))[:120],
                "type": "manual"})
            data["highlights"].sort(key=lambda h: h["t"])
            aif.parent.mkdir(exist_ok=True)
            aif.write_text(json.dumps(data, ensure_ascii=False, indent=1))
            rebuild_index()
            return self.send_json({"ok": True, "highlights": data["highlights"]})
        if u.path == "/api/clip":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            mf = VAULT / "manifest" / f"{cid}.json"
            if not mf.exists():
                return self.send_json({"error": "clip no existe"}, 404)
            m = read_json_file(mf)
            for k in ("label", "archived"):
                if k in spec:
                    m[k] = spec[k]
            mf.write_text(json.dumps(m, indent=1))
            rebuild_index()
            return self.send_json({"ok": True})
        if u.path == "/api/rescan":
            if not self.auth(q):
                return
            rebuild_index()
            return self.send_json({"ok": True})
        if u.path == "/api/property":
            if not self.auth(q):
                return
            spec = self.read_json()
            slug = re.sub(r"[^a-z0-9-]", "", str(spec.get("slug", "")).lower())[:40]
            if not slug:
                return self.send_json({"error": "slug requerido"}, 400)
            spec["slug"] = slug
            spec["updated"] = time.strftime("%Y-%m-%d %H:%M")
            pdir = VAULT / "properties"
            pdir.mkdir(exist_ok=True)
            (pdir / f"{slug}.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1))
            return self.send_json({"ok": True, "url": f"https://vuelos.metislab.work/p.html?id={slug}"})
        if u.path == "/api/property_ai":
            if not self.auth(q):
                return
            body = self.read_json()
            slug = re.sub(r"[^a-z0-9-]", "", str(body.get("slug", "")).lower())
            pf = VAULT / "properties" / f"{slug}.json"
            if not pf.exists():
                return self.send_json({"error": "propiedad no existe"}, 404)
            p = read_json_file(pf)
            prompt = (
                "Escribe la descripción de venta para una propiedad, en español, tono premium "
                "inmobiliario, 2 párrafos cortos + 4 líneas de características precedidas por '· '. "
                "TEXTO PLANO: sin markdown, sin asteriscos, sin títulos, sin emojis, sin exagerar. "
                "Datos: " + json.dumps(p, ensure_ascii=False))
            p["descripcion"] = _deepseek(prompt)
            pf.write_text(json.dumps(p, ensure_ascii=False, indent=1))
            return self.send_json({"ok": True, "descripcion": p["descripcion"]})
        self.send_error(404)

    def do_GET_properties(self):
        pdir = VAULT / "properties"
        out = []
        if pdir.exists():
            for f in sorted(pdir.glob("*.json")):
                p = json.loads(f.read_text())
                out.append({"slug": p.get("slug"), "titulo": p.get("titulo", ""),
                            "precio": p.get("precio", ""), "updated": p.get("updated", "")})
        return self.send_json({"properties": out})


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Origin server behind Cloudflare Tunnel.

    iOS, Cloudflare and browser QA cancel requests during navigation or when a
    range/asset is no longer needed. The stock server prints those socket resets
    as tracebacks; suppress only that noise so logs remain useful for real bugs.
    """
    daemon_threads = True
    request_queue_size = 128

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    # limpia temporales de subida huérfanos (.upload-<cid>-<hex>.<ext>): una subida cortada por
    # reinicio/OOM deja el tmp en splats/. best_splats ya los ignora, pero purgarlos evita acumular
    # GBs invisibles (igual que el worker limpia .training/). Solo al arrancar el server, no en import.
    try:
        for _tmp in (VAULT / "splats").glob(".upload-*"):
            if _tmp.is_file():
                _tmp.unlink(missing_ok=True)
                print(f"limpiado upload huérfano: {_tmp.name}")
    except OSError:
        pass
    print(f"AeroBrain server :8790 · token en {TOKEN_FILE}")
    QuietThreadingHTTPServer(("127.0.0.1", 8790), H).serve_forever()
