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
import math
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
import urllib.request
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jobs as jobstore
import perf as perfmod
import scenes as scenestore
from splat_presets import (normalize_splat_request, public_splat_profiles,
                           resolve_splat_spec)
from pathlib import Path

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

WEB = Path("/Volumes/SSD/work/forge-projects/aerobrain/web")
VAULT = Path("/Volumes/SSD/drone-vault")
# binarios 3D grandes con URL estable: cachean con revalidación 304 (nunca stale, nunca re-bajar MBs)
REVALIDATE_EXTS = (".ply", ".splat", ".ksplat", ".sog", ".spz", ".obj", ".mtl", ".laz", ".geojson", ".tif")
# editor SuperSplat auto-hosteado (post-procesado de splats: limpiar floaters, crop, export)
SUPERSPLAT = Path("/Volumes/SSD/work/forge-projects/aerobrain/splat/supersplat/dist")
PIPE = Path("/Volumes/SSD/work/forge-projects/aerobrain/pipeline")
TOKEN_FILE = VAULT / ".token"
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(24))
    TOKEN_FILE.chmod(0o600)
TOKEN = TOKEN_FILE.read_text().strip()
VIEWER_ACTIVITY = Path("/tmp/aerobrain-viewer-active")
VIEWER_ACTIVE_S = 45

# OJO: jobstore.init(orphan_kinds=...) NO va aquí a nivel de módulo. El worker importa este
# módulo (splat_quality/prune) y un init con LIGHT_KINDS desde el proceso worker MATARÍA los
# jobs ligeros (edit/upload) que el server tiene corriendo. El init vive en __main__.
JLOCK = threading.Lock()         # compat: secciones que actualizan detail
PERF = perfmod.PerfSampler(jobstore)   # panel de performance en vivo (hilo 1Hz solo si alguien mira)
_CLIENT_ERR_BUDGET = {"n": 0, "reset": 0.0}   # rate-limit global de /api/client_error


def mark_viewer_activity():
    try:
        VIEWER_ACTIVITY.touch()
    except OSError:
        pass


def viewer_activity() -> tuple[bool, float | None]:
    try:
        age = max(0.0, time.time() - VIEWER_ACTIVITY.stat().st_mtime)
        return age <= VIEWER_ACTIVE_S, round(age, 1)
    except OSError:
        return False, None


_HTML_ASSET_RE = re.compile(
    r'(?P<prefix>(?:src|href)=["\'])(?P<path>[^"\']+\.(?:js|css))\?v=[^"\']+(?P<suffix>["\'])',
    re.IGNORECASE)


def render_html(f: Path) -> bytes:
    """Replace placeholder asset versions with exact on-disk fingerprints."""
    text = f.read_text()

    def replace(match):
        asset_path = urllib.parse.urlparse(match.group("path")).path.lstrip("/")
        asset = (WEB / asset_path).resolve()
        try:
            asset.relative_to(WEB.resolve())
        except ValueError:
            return match.group(0)
        if not asset.is_file():
            return match.group(0)
        version = asset.stat().st_mtime_ns
        return (f'{match.group("prefix")}{match.group("path")}?v={version}'
                f'{match.group("suffix")}')

    return _HTML_ASSET_RE.sub(replace, text).encode()


def static_cache_policy(f: Path, request_path: str) -> tuple[bool, str]:
    """Return (revalidate, Cache-Control) for GET and HEAD consistently."""
    suffix = f.suffix.lower()
    model_img = suffix in (".jpg", ".png", ".webp") and str(f).startswith(str(VAULT / "models"))
    request_qs = urllib.parse.parse_qs(urllib.parse.urlparse(request_path).query)
    code_asset = suffix in (".js", ".css")
    expected_version = str(f.stat().st_mtime_ns) if f.is_file() else ""
    versioned_code = code_asset and request_qs.get("v") == [expected_version]
    vendor_asset = code_asset and str(f).startswith(str(WEB / "vendor"))
    revalidate = (suffix in REVALIDATE_EXTS or str(f).startswith(str(SUPERSPLAT))
                  or model_img or (code_asset and not versioned_code and not vendor_asset))
    cacheable = suffix in (".mp4", ".jpg", ".png", ".woff2", ".svg", ".webp")
    if versioned_code:
        return revalidate, "public, max-age=31536000, immutable"
    if vendor_asset:
        return revalidate, "public, max-age=86400, stale-while-revalidate=604800"
    if revalidate:
        return revalidate, "no-cache"
    if cacheable:
        return revalidate, "public, max-age=86400"
    return revalidate, "no-store, must-revalidate"


def clip_history_files(hist_dir: Path, cid: str) -> list:
    """Archivos de historial que pertenecen EXACTAMENTE a este clip.
    Formato de archivado: '{cid}-{YYYYMMDD}-{HHMMSS}.{clean.sog|splat|ksplat|ply}'.
    cruzaría el guion y capturaría el historial de un clip VECINO '{cid}-<suf>' (p.ej. el clip
    'A' se comería el de 'A-2') — pérdida de datos entre clips. El regex ancla los 8+6 dígitos
    del timestamp, así 'A-2-...' nunca cae en el conjunto de 'A'."""
    if not hist_dir.is_dir():
        return []
    pat = re.compile(rf"{re.escape(cid)}-\d{{8}}-\d{{6}}\.(clean\.sog|spz|splat|ksplat|ply|meta\.json|cameras\.json)$", re.IGNORECASE)
    return [p for p in hist_dir.iterdir() if p.is_file() and pat.fullmatch(p.name)]


def prune_splat_history(hist_dir: Path, cid: str, keep: int = 6):
    """Keep the latest N version groups, not merely N files.

    A version can have .splat + .ksplat + .meta.json + .cameras.json. Pruning by file count
    breaks old versions into unusable partial sets.
    """
    groups = {}
    pat = re.compile(rf"({re.escape(cid)}-\d{{8}}-\d{{6}})\.(clean\.sog|spz|splat|ksplat|ply|meta\.json|cameras\.json)$",
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

    checks["viewer_active"], checks["viewer_age_s"] = viewer_activity()

    ok = all(v for k, v in checks.items()
             if k not in ("disk_free_gb", "active_jobs", "viewer_active", "viewer_age_s"))
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


def requires_local_splat_binary(backend: str) -> bool:
    return str(backend or "metal").lower() != "cuda"


def build_splat_job_spec(cid: str, raw: dict | None,
                         preflight_result: dict | None = None) -> dict:
    """Build the one immutable splat request used by every enqueue path."""
    raw = raw or {}
    request = normalize_splat_request(raw)
    model_preset = str(raw.get("model_preset") or "estandar")
    if model_preset not in ("rapido", "estandar", "alta", "extra", "ultra"):
        model_preset = "estandar"
    return {
        "clip_id": cid,
        **request,
        "auto_model": bool(raw.get("auto_model")),
        "model_preset": model_preset,
        "preflight": preflight_result,
        "title": str(raw.get("title") or "")[:80].strip(),
        **({"scene_id": raw.get("scene_id")} if raw.get("scene_id") else {}),
        **({"version_id": raw.get("version_id")} if raw.get("version_id") else {}),
    }


def build_followup_splat_spec(cid: str, raw: dict) -> dict:
    """Normalize phased ODM/scene fields through the direct-job contract."""
    return build_splat_job_spec(cid, {
        "preset": raw.get("splat_preset") or "cinematic",
        "backend": raw.get("splat_backend") or raw.get("backend") or "metal",
        "resolution": raw.get("splat_resolution") or raw.get("resolution"),
        "requested_downscale": raw.get("splat_requested_downscale"),
        "best_available": raw.get("best_available", True),
        "scene_id": raw.get("scene_id"),
        "version_id": raw.get("version_id") or cid,
        "title": raw.get("title"),
    })


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
            try:
                size = f.stat().st_size
            except OSError:
                continue                       # SD extraída a mitad del escaneo: salta el archivo, no 500
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


def odm_live_phase(log: str, current: float | None = None) -> dict | None:
    """Return the latest measured ODM sub-stage visible in a rolling log tail."""
    low = re.sub(r"\x1b\[[0-9;]*m", "", str(log or "")).lower()
    phases = [
        ("odm-features", "extrayendo features", 0.20,
         (r"opensfm[^\n]*detect_features", r"found\s+\d+\s+points\s+in")),
        ("odm-matching", "comparando imágenes", 0.35,
         (r"opensfm[^\n]*match_features", r"matching\s+s?\d*_?f_", r"matched\s+\d+\s+pairs")),
        ("odm-tracks", "construyendo tracks", 0.40,
         (r"opensfm[^\n]*create_tracks", r"good tracks:\s*\d+")),
        ("odm-reconstruct", "reconstruyendo cámaras", 0.43,
         (r"opensfm[^\n]*\sreconstruct\s", r"incremental reconstruction",
          r"resection inliers", r"reconstruction\s+\d+:\s*\d+\s+images",
          r"attempting merge", r"merging reconstruction",
          r"export_geocoords[^\n]*--reconstruction")),
        ("odm-undistort", "corrigiendo lentes", 0.50,
         (r"opensfm[^\n]*\bundistort\b", r"undistorting image")),
        ("odm-depthmaps", "calculando profundidad CUDA", 0.58,
         (r"depthmap resolution", r"estimated depth-maps", r"fused depth-maps")),
        ("odm-filterpoints", "filtrando nube densa", 0.72,
         (r"point visibility checks", r"filter-point-cloud")),
        ("odm-mesh", "construyendo malla", 0.75,
         (r"poissonrecon", r"running\s+odm_meshing\s+stage")),
        ("odm-texture", "texturizando modelo", 0.82,
         (r"mvstex", r"running\s+(?:mvs_|odm_)texturing\s+stage")),
        ("odm-map", "generando DSM y ortofoto", 0.88,
         (r"running\s+odm_dem\s+stage", r"running\s+odm_orthophoto\s+stage")),
    ]
    latest = None
    for stage, label, progress, patterns in phases:
        for pattern in patterns:
            matches = list(re.finditer(pattern, low))
            if matches and (latest is None or matches[-1].end() > latest[0]):
                latest = (matches[-1].end(), stage, label, progress)
    if latest is None:
        return None
    return {"stage": latest[1], "label": latest[2],
            "progress": max(float(current or 0), latest[3])}


ODM_STAGE_ORDER = (
    "odm-features", "odm-matching", "odm-match-save", "odm-tracks",
    "odm-reconstruct", "odm-undistort", "odm-depthmaps", "odm-filterpoints", "odm-mesh",
    "odm-texture", "odm-map", "odm-products",
)


def odm_stage_rank(stage: str | None) -> int:
    try:
        return ODM_STAGE_ORDER.index(str(stage or ""))
    except ValueError:
        return -1


def _trainer_duration_seconds(value: str) -> float | None:
    """Parse Nerfstudio's compact duration columns without treating ms as minutes."""
    units = {"d": 86400.0, "h": 3600.0, "m": 60.0, "s": 1.0, "ms": .001}
    parts = re.findall(r"(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)\b", str(value or ""), re.I)
    if not parts:
        return None
    return sum(float(number) * units[unit.lower()] for number, unit in parts)


def splat_live_telemetry(log: str, target_iterations: int | None) -> dict | None:
    """Extract the latest exact Nerfstudio step, instantaneous rate and trainer ETA.

    Rich redraws its last rows repeatedly. Selecting the greatest step makes that
    output deterministic while each retry remains isolated by ``run_tracked``.
    """
    target = int(target_iterations or 0)
    clean = re.sub(r"\x1b\[[0-9;]*m", "", str(log or ""))
    rows = []
    for index, line in enumerate(clean.splitlines()):
        line = re.sub(r"^\[[^\]]+\]\s*", "", line).strip()
        columns = re.split(r"\s{2,}", line)
        if len(columns) < 3:
            continue
        head = re.fullmatch(r"([\d,]+)\s+\(([\d.]+)%\)", columns[0])
        if not head:
            continue
        step = int(head.group(1).replace(",", ""))
        iteration_s = _trainer_duration_seconds(columns[1])
        eta_s = _trainer_duration_seconds(columns[2])
        rows.append((step, index, float(head.group(2)), iteration_s, eta_s))
    if not rows:
        return None
    step, _, pct, iteration_s, eta_s = max(rows, key=lambda item: (item[0], item[1]))
    if target <= 0 and pct > 0:
        target = max(step, round(step * 100 / pct))
    out = {
        "current_iteration": step,
        "target_iterations": target or None,
        "iteration_pct": round(100 * step / target, 2) if target else round(pct, 2),
        "eta_source": "trainer_live",
    }
    if iteration_s is not None and iteration_s > 0:
        out["iteration_time_ms"] = round(iteration_s * 1000, 3)
        out["iterations_per_second"] = round(1 / iteration_s, 2)
    if eta_s is not None:
        out["eta_remaining_s"] = max(0, round(eta_s))
    elif target and iteration_s is not None:
        out["eta_remaining_s"] = max(0, round((target - step) * iteration_s))
    return out


def counted_phase_telemetry(detail: str, stage: str, stage_history: list,
                            now: float | None = None) -> dict | None:
    """Derive a measured phase rate/ETA from an exact N/T worker counter.

    The final ratio is intentional: ODM detail starts with ``2/3`` before the
    authoritative feature count. This projection is phase-local and never used
    as proof that a job or artifact completed.
    """
    detail_text = str(detail or "")
    camera_pattern = (r"\b(\d+)/(\d+)\s+cámaras registradas\b"
                      if stage == "odm-reconstruct" else
                      r"\b(\d+)/(\d+)\s+cámaras\b"
                      if stage == "odm-depthmaps" else None)
    camera_count = (re.search(camera_pattern, detail_text, re.I)
                    if camera_pattern else None)
    point_count = (re.search(r"\b([\d,]+)/([\d,]+)\s+puntos\b", detail_text, re.I)
                   if stage == "odm-filterpoints" else None)
    phase_text = detail_text.rsplit("·", 1)[-1]
    counts = ([camera_count.groups()] if camera_count else
              [point_count.groups()] if point_count else
              re.findall(r"\b(\d+)/(\d+)\b", phase_text))
    if not counts:
        return None
    completed, total = (int(value.replace(",", "")) for value in counts[-1])
    completed = min(completed, total)
    if completed <= 0 or total <= 0 or completed >= total:
        return None
    starts = [float(item["ts"]) for item in (stage_history or [])
              if item.get("stage") == stage and item.get("ts") is not None]
    if not starts:
        return None
    elapsed = max(0.0, float(now if now is not None else time.time()) - min(starts))
    if elapsed < 10:
        return None
    low = detail_text.lower()
    unit = ("cameras" if camera_count else "points" if point_count else
            "features" if "feature" in low else
            "images" if "imágenes" in low else "items")
    out = {
        "phase_completed": completed,
        "phase_total": total,
        "phase_unit": unit,
    }
    native_eta = re.search(r"ETA OpenMVS\s+(\d+)\s+s\b", detail_text, re.I)
    if native_eta:
        out.update(eta_remaining_s=int(native_eta.group(1)),
                   eta_source="openmvs_live")
        return out
    rate = completed / elapsed
    if rate <= 0:
        return None
    out["phase_items_per_minute"] = round(rate * 60, 1)
    # OpenSfM may validly finish with fewer registered cameras than submitted.
    # The counter remains useful as measured throughput, but treating the
    # submitted total as a required terminal target fabricates an ETA.
    if stage == "odm-reconstruct":
        out["eta_source"] = "counted_phase_rate"
    else:
        out.update(
            eta_remaining_s=max(0, round((total - completed) / rate)),
            eta_source="counted_phase_live",
        )
    return out


def odm_registration_live_telemetry(detail: str) -> dict:
    """Parse only explicit OpenSfM evidence persisted by the CUDA observer."""
    text = str(detail or "")
    out = {}
    cameras = re.search(r"\b([\d,]+)/([\d,]+)\s+cámaras registradas\b", text, re.I)
    if cameras:
        out.update(cameras_registered=int(cameras.group(1).replace(",", "")),
                   cameras_total=int(cameras.group(2).replace(",", "")))
    sources = re.search(r"\b([\d,]+)/([\d,]+)\s+fuentes activas\b", text, re.I)
    if sources:
        out.update(active_sources=int(sources.group(1).replace(",", "")),
                   total_sources=int(sources.group(2).replace(",", "")))
    tracks = re.search(r"\b([\d,]+)\s+tracks robustos\b", text, re.I)
    if tracks:
        out["good_tracks"] = int(tracks.group(1).replace(",", ""))
    return out


def derive_odm_progress(log: str, current: float | None = None, cid: str = "",
                        started: float | None = None) -> float | None:
    """Progreso best-effort de un job ODM a partir del log.

    Anclado a TRANSICIONES REALES ("running/finished <x> stage") y a los
    porcentajes explícitos de OpenMVS — jamás a palabras sueltas: el volcado de
    config que ODM imprime al arrancar contiene "orthophoto", "dem", "dsm"...
    y el matcheo ingenuo saltaba la barra a 96% en el minuto uno (bug cazado en
    el primer run CUDA). Los marcadores de filesystem solo cuentan si el archivo
    es POSTERIOR al inicio del job: el proj_<cid> conserva outputs de corridas
    anteriores del mismo clip. Monotónico y conservador: UI/ETA, nunca éxito."""
    low = (log or "").lower()
    best = 0.0
    bands = {"dataset": (0.16, 0.20), "split": (0.20, 0.20), "merge": (0.20, 0.20),
             "opensfm": (0.20, 0.55), "openmvs": (0.58, 0.72),
             "odm_filterpoints": (0.72, 0.75), "odm_meshing": (0.75, 0.80),
             "mvs_texturing": (0.80, 0.86), "odm_texturing": (0.80, 0.86),
             "odm_georeferencing": (0.86, 0.88), "odm_dem": (0.88, 0.92),
             "odm_orthophoto": (0.92, 0.95), "odm_report": (0.95, 0.96),
             "odm_postprocess": (0.95, 0.96)}
    stage = None
    for m in re.finditer(r"(running|finished)\s+([a-z_]+)\s+stage", low):
        verb, name = m.group(1), m.group(2)
        if name in bands:
            lo, hi = bands[name]
            best = max(best, hi if verb == "finished" else lo)
            stage = name if verb == "running" else stage
    # el log del jobstore es cola rodante: la línea "running <x> stage" puede haber
    # scrolleado fuera — inferir el stage por FIRMAS de trabajo que sí viven en el tail
    if stage is None:
        sig = [("openmvs", r"fused depth-maps|estimated depth-maps|point visibility|densifypointcloud|depthmap resolution"),
               ("opensfm", r"undistorting image|resection inliers|matching f_|extracting root_"),
               ("odm_meshing", r"poissonrecon|dem2mesh"),
               ("mvs_texturing", r"mvstex|texturing"),
               ("odm_dem", r"gapfill|merged\.vrt"),
               ("odm_orthophoto", r"orthophoto area")]
        for name, pat in sig:
            if re.search(pat, low):
                stage = name
                best = max(best, bands[name][0])
                break
    # sub-progreso dentro del stage activo (marcadores de LÍNEAS de trabajo, no config)
    if stage == "opensfm":
        feats = low.count("extracting root_")
        if feats:
            best = max(best, 0.21 + min(0.13, feats * 0.13 / 250))
        if "matching f_" in low:
            best = max(best, 0.36)
        if "resection inliers" in low or "incremental reconstruction" in low:
            best = max(best, 0.42)
        if "undistorting image" in low:
            best = max(best, 0.50)
    if stage == "openmvs":
        pcts = re.findall(r"\((\d+(?:\.\d+)?)%[,)]", (log or "")[-8000:])
        if pcts:
            best = max(best, 0.58 + 0.14 * min(1.0, float(pcts[-1]) / 100))
    if "browser gate" in low or "publicando assets" in low:
        best = max(best, 0.96)
    best = max(float(current or 0), best)
    if cid:
        safe_cid = re.sub(r"[^\w-]", "", cid)
        proj = VAULT / "odm" / f"proj_{safe_cid}"
        fs_marks = [
            (0.50, proj / "opensfm" / "reconstruction.json"),
            (0.72, proj / "odm_filterpoints" / "point_cloud.ply"),
            (0.76, proj / "odm_meshing"),
            (0.82, proj / "odm_texturing"),
            (0.88, proj / "odm_dem"),
            (0.92, proj / "odm_orthophoto"),
            (0.96, VAULT / "models" / cid / "meta.json"),
        ]
        for pct, path in fs_marks:
            try:
                if path.exists() and (started is None or path.stat().st_mtime >= started):
                    best = max(best, pct)
            except OSError:
                pass
    return best


def _job_spec(row: dict) -> dict:
    raw = row.get("spec")
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}


def refresh_running_job(row: dict) -> dict:
    """Overlay measured progress from the rolling log without persisting guesses."""
    if row.get("status") != "running":
        return row
    if row.get("kind") == "splat":
        # El tail conserva las últimas líneas del trainer durante export/publish/QA.
        # Sólo la fase train puede convertirlas en telemetría viva; en fases
        # posteriores manda el estado exacto persistido por el worker.
        if row.get("stage") != "train":
            return row
        spec = _job_spec(row)
        live = splat_live_telemetry(row.get("log") or "", spec.get("iters"))
        if live:
            row.update(live)
            pct = float(live.get("iteration_pct") or 0)
            lo, hi = ((0.30, 0.76) if str(spec.get("backend") or "").lower() == "cuda"
                      else (0.05, 0.98))
            row["progress"] = max(float(row.get("progress") or 0),
                                  lo + (hi - lo) * pct / 100)
            step = int(live["current_iteration"])
            target = int(live.get("target_iterations") or spec.get("iters") or 0)
            rate = live.get("iterations_per_second")
            eta = live.get("eta_remaining_s")
            detail = f"entrenando {step:,}/{target:,} iteraciones"
            if rate:
                detail += f" · {rate:g} iter/s"
            if eta is not None:
                detail += f" · {round(eta)} s restantes"
            row["detail"] = detail
            return row
        matches = re.findall(r"\((\d+)%\)", row.get("log") or "")
        if matches:
            row["progress"] = max(row.get("progress") or 0,
                                  0.05 + 0.93 * int(matches[-1]) / 100)
        return row
    if row.get("kind") != "3d":
        return row
    row["progress"] = derive_odm_progress(row.get("log") or "", row.get("progress"),
                                          row.get("label") or "", row.get("started"))
    live = odm_live_phase(row.get("log") or "", row.get("progress"))
    if live and str(row.get("stage") or "").startswith("odm"):
        # stdout del SSH puede ir detrás de los artefactos medidos por el tick del
        # worker. Un tail aún lleno de pares no puede devolver save/tracks a matching.
        if odm_stage_rank(row.get("stage")) > odm_stage_rank(live.get("stage")):
            return row
        spec = _job_spec(row)
        backend = (row.get("backend") or
                   ("NVIDIA CUDA" if spec.get("backend") == "cuda" else "local"))
        exact_detail = str(row.get("detail") or "")
        detail = (f"2/3 ODM {spec.get('preset') or 'estandar'} en "
                  f"{backend} · {live['label']}")
        exact_phase = exact_detail.rsplit("·", 1)[-1]
        preserves_measured_evidence = bool(re.search(
            r"\b[\d,]+/[\d,]+\b|tracks robustos|reconstrucción\s+\d+",
            exact_detail, re.I))
        if (live["stage"] == row.get("stage")
                and preserves_measured_evidence):
            detail = exact_detail
            counts = re.findall(r"\b(\d+)/(\d+)\b", exact_detail)
            count = counts[-1] if counts else None
            if count and int(count[1]) > 0:
                completed = min(int(count[0]), int(count[1]))
                measured = round(0.215 + 0.135 * completed / int(count[1]), 4)
                live["progress"] = max(float(live["progress"]), measured)
        row.update(progress=live["progress"], stage=live["stage"],
                   detail=detail)
    return row


def live_perf_payload(payload: dict) -> dict:
    """Make the live System job table agree with the Jobs API's measured stage.

    Historical samples remain immutable; only the current telemetry row receives
    the fresh log-derived phase. CPU and memory measurements stay owned by perf.py.
    """
    out = dict(payload or {})
    now = dict(out.get("now") or {})
    sampled = [dict(item) for item in (now.get("jobs") or [])]
    if sampled:
        active = {row.get("id"): refresh_running_job(row)
                  for row in jobstore.recent(12)
                  if row.get("status") in ("running", "queued")}
        for item in sampled:
            current = active.get(item.get("id"))
            if current:
                item.update({key: current.get(key)
                             for key in ("stage", "progress", "detail")})
    now["jobs"] = sampled
    out["now"] = now
    return out


def _job_model_meta(label: str) -> dict:
    try:
        return json.loads((VAULT / "models" / label / "meta.json").read_text())
    except (OSError, ValueError):
        return {}


_PROJ_SIZE_CACHE: dict = {}

def _proj_input_mb(cid: str) -> int | None:
    """Peso real de las imágenes de entrada del proyecto (medido, cacheado por cid)."""
    if not cid:
        return None
    if cid in _PROJ_SIZE_CACHE:
        return _PROJ_SIZE_CACHE[cid]
    d = VAULT / "odm" / f"proj_{re.sub(r'[^\w-]', '', cid)}" / "images"
    try:
        mb = round(sum(f.stat().st_size for f in d.iterdir() if f.is_file()) / 1048576)
    except OSError:
        mb = None
    _PROJ_SIZE_CACHE[cid] = mb
    return mb


def normalize_job_summary(row: dict, latest_done: dict | None = None) -> dict:
    """Compact Jobs contract with requested/effective quality kept separate."""
    spec = _job_spec(row)
    now = time.time()
    started = row.get("started")
    finished = row.get("finished")
    elapsed = max(0.0, (finished or now) - started) if started else None
    clean_tail = jobstore.strip_terminal_controls(row.get("log") or "").strip()
    structured_events = (jobstore.events(row["id"])
                         if row.get("id") and row.get("kind") in ("3d", "splat") else [])
    terminal = structured_events[-1] if structured_events else {}
    checkpoint_event = next((event for event in reversed(structured_events)
                             if event.get("event") in (
                                 "cuda_checkpoint",
                                 "recovery_checkpoint_reverified",
                             )), None)
    checkpoint_data = (checkpoint_event or {}).get("data") or {}
    recovered = any(event.get("event") in ("browser_qa_recovered", "recovered")
                    for event in structured_events)
    if (row.get("status") == "done" and terminal.get("event") in
            ("completed", "browser_qa_recovered", "recovered")):
        clean_tail = str(terminal.get("message") or row.get("detail") or clean_tail).strip()
    out = {key: row.get(key) for key in
           ("id", "kind", "label", "status", "detail", "stage", "progress",
            "started", "finished", "artifact")}
    out.update({
        "title": spec.get("title") or "",
        "started_iso": (time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(started))
                        if started else None),
        "finished_iso": (time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(finished))
                         if finished else None),
        "elapsed_s": round(elapsed, 1) if elapsed is not None else None,
        "log_tail": clean_tail,
        "last_event": terminal.get("event"),
        "recovered": recovered,
        "requested_preset": spec.get("preset"),
        "effective_preset": None,
        "requested_iterations": spec.get("iters"),
        "requested_backend": spec.get("backend"),
        "effective_backend": None,
        "backend_policy": spec.get("backend_policy"),
        "requested_resolution": spec.get("resolution"),
        "requested_downscale": spec.get("requested_downscale"),
        "effective_resolution": None,
        "effective_downscale": None,
        "source_count": len(spec.get("sources") or ([spec.get("clip_id")] if spec.get("clip_id") else [])),
        "photo_count": len(spec.get("photos") or []),
        "outcome": row.get("status"),
        "backend": row.get("backend"),
        "stage_history": (jobstore.stage_history(row["id"])
                          if row.get("kind") in ("3d", "splat") else []),
        "fallback": False,
        "artifact_exists": bool(row.get("artifact") and (VAULT / str(row["artifact"])).exists()),
        "resume_available": bool(checkpoint_event),
        "checkpoint_step": checkpoint_data.get("step"),
        "checkpoint_bytes": checkpoint_data.get("bytes"),
    })
    if row.get("kind") == "3d" and row.get("status") == "running":
        counted = counted_phase_telemetry(
            str(out.get("detail") or ""), str(out.get("stage") or ""),
            out.get("stage_history") or [], now=now)
        if counted:
            out.update(counted)
    for key in ("current_iteration", "target_iterations", "iteration_pct",
                "iteration_time_ms", "iterations_per_second", "eta_remaining_s",
                "eta_source", "phase_completed", "phase_total", "phase_unit",
                "phase_items_per_minute"):
        if row.get(key) is not None:
            out[key] = row[key]

    meta = _job_model_meta(str(row.get("label") or ""))
    recon = meta.get("reconstruction") or {}
    if row.get("kind") == "3d":
        if latest_done is None:
            latest_done = jobstore.latest_done_ids(("3d",))
        meta_job_id = recon.get("job_id") or meta.get("job_id")
        meta_matches_job = (meta_job_id == row.get("id") if meta_job_id
                            else latest_done.get(("3d", row.get("label"))) == row.get("id"))
        qa = (meta.get("qa") or {}) if meta_matches_job else {}
        out.update({
            "requested_preset": ((recon.get("requested_preset") if meta_matches_job else None)
                                 or spec.get("preset")),
            "effective_preset": ((recon.get("effective_preset") or meta.get("preset"))
                                 if meta_matches_job else None),
            "dense_quality_requested": (meta.get("dense_quality_requested") if meta_matches_job else None),
            "dense_quality": (meta.get("dense_quality") if meta_matches_job else None),
            "product_mode": ((meta.get("pipeline_mode") or qa.get("status")) if meta_matches_job else None),
            "merge_label": (recon.get("merge_label") if meta_matches_job else None),
            "cameras_registered": qa.get("cameras_reconstructed"),
            "cameras_total": qa.get("cameras_total"),
        })
        m_img = re.search(r"\((\d+) imagenes\)", str(row.get("detail") or ""))
        if m_img:
            out["images_total"] = int(m_img.group(1))
        if row.get("status") == "running":
            out.update(odm_registration_live_telemetry(str(out.get("detail") or "")))
        out["input_mb"] = _proj_input_mb(str(row.get("label") or ""))
        out["fallback"] = bool(meta_matches_job and (meta.get("dense_fallback")
                               or (out["requested_preset"] and out["effective_preset"]
                                   and out["requested_preset"] != out["effective_preset"])
                               or out.get("product_mode") == "ortho_25d_fallback"))
    elif row.get("kind") == "splat":
        runs = recon.get("splat_runs") or []
        run = next((item for item in reversed(runs) if item.get("job_id") == row.get("id")), {})
        out.update({
            "requested_preset": run.get("requested_preset") or spec.get("preset"),
            "effective_preset": run.get("effective_preset") or run.get("preset"),
            "requested_iterations": run.get("requested_iterations") or spec.get("iters"),
            "requested_backend": run.get("requested_backend") or spec.get("backend"),
            "effective_backend": (run.get("effective_backend") or run.get("backend")
                                  or row.get("backend")),
            "backend_policy": run.get("backend_policy") or spec.get("backend_policy"),
            "requested_resolution": run.get("resolution") or spec.get("resolution"),
            "requested_downscale": (run.get("requested_downscale")
                                    or spec.get("requested_downscale")),
            "effective_resolution": run.get("effective_resolution"),
            "effective_downscale": run.get("effective_downscale") or run.get("input_scale"),
            "input_scale": run.get("effective_downscale") or run.get("input_scale"),
            "iterations": run.get("target_iters"),
            # el run publicado manda; mientras entrena, el backend vivo del job row
            "backend": (run.get("effective_backend") or run.get("backend")
                        or row.get("backend")),
            # 32 bytes por gaussiana en el formato .splat — conteo exacto, no estimado
            "gaussians": (run.get("bytes") // 32) if run.get("bytes") else None,
            "input_mb": _proj_input_mb(str(row.get("label") or "")),
            "peak_mib": run.get("peak_mib"),
            "memory_cap_mib": run.get("mem_cap_mib"),
            "image_cache_device": run.get("image_cache_device"),
            "decoded_image_cache_mib": run.get("decoded_image_cache_mib"),
            "gpu_cache_budget_mib": run.get("gpu_cache_budget_mib"),
            "resumed_from_step": run.get("resumed_from_step") or spec.get("resume_step"),
            "attempts": run.get("attempts") or [],
            "cameras_registered": run.get("cameras"),
        })
        out["fallback"] = bool(run.get("fallback"))
    if row.get("status") == "done" and out["fallback"]:
        out["outcome"] = "completed_with_fallback"
    return out


def splat_profiles_with_history(vault: Path | None = None) -> list[dict]:
    """Public profile contract enriched with honest, machine-local CUDA timing.

    A measured value is the median end-to-end duration of successful runs for
    that exact profile. Unmeasured CUDA tiers are explicitly projected from the
    nearest measured CUDA tier on the same GPU by iteration count; the UI must
    keep that distinction visible instead of presenting a projection as a fact.
    """
    root = Path(vault or VAULT)
    samples: list[dict] = []
    for meta_path in (root / "models").glob("*/meta.json"):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, ValueError, TypeError):
            continue
        recon = meta.get("reconstruction") or {}
        qa = meta.get("qa") or recon.get("qa") or {}
        runs = recon.get("splat_runs") or meta.get("splat_runs") or []
        for run in runs:
            backend = str(run.get("effective_backend") or run.get("backend") or "")
            preset = str(run.get("effective_preset") or run.get("preset") or "")
            duration = run.get("duration_s")
            iters = run.get("target_iters") or run.get("requested_iterations")
            if ("cuda" not in backend.lower() or run.get("fallback") or
                    preset not in {p["key"] for p in public_splat_profiles()}):
                continue
            try:
                duration = float(duration)
                iters = int(iters)
            except (TypeError, ValueError):
                continue
            if duration <= 0 or iters <= 0:
                continue
            successful_duration = None
            for attempt in reversed(run.get("attempts") or []):
                try:
                    attempt_duration = float(attempt.get("duration_s") or 0)
                except (TypeError, ValueError):
                    continue
                if attempt.get("rc") in (0, None) and attempt_duration > 0:
                    successful_duration = attempt_duration
                    break
            training_seconds = successful_duration or duration
            fixed_overhead = max(0.0, duration - training_seconds)
            samples.append({
                "preset": preset, "seconds": duration, "iters": iters,
                "training_seconds": training_seconds,
                "fixed_overhead_s": fixed_overhead,
                "iteration_time_ms": training_seconds * 1000 / iters,
                "iterations_per_second": iters / training_seconds,
                "cameras": run.get("cameras") or qa.get("cameras_reconstructed"),
                "resolution": run.get("effective_resolution") or
                              ("half" if int(run.get("effective_downscale") or
                                             run.get("input_scale") or 1) == 2 else "full"),
                "gpu": run.get("remote_gpu") or "NVIDIA CUDA",
            })

    profiles = public_splat_profiles()
    by_key = {profile["key"]: profile for profile in profiles}
    for key, profile in by_key.items():
        exact = [sample for sample in samples if sample["preset"] == key]
        if exact:
            ordered = sorted(exact, key=lambda item: item["seconds"])
            mid = ordered[len(ordered) // 2]
            profile["eta"] = {
                "source": "measured", "seconds": round(mid["seconds"]),
                "training_seconds": round(mid["training_seconds"]),
                "fixed_overhead_s": round(mid["fixed_overhead_s"]),
                "iteration_time_ms": round(mid["iteration_time_ms"], 2),
                "iterations_per_second": round(mid["iterations_per_second"], 2),
                "sample_count": len(exact), "cameras": mid.get("cameras"),
                "resolution": mid["resolution"], "gpu": mid["gpu"],
            }
            continue
        if "cuda" not in profile["supported_backends"] or not samples:
            continue
        target = int(profile["iters"])
        baseline = min(samples, key=lambda item: abs(item["iters"] - target))
        training_seconds = baseline["training_seconds"] * target / baseline["iters"]
        seconds = training_seconds + baseline["fixed_overhead_s"]
        profile["eta"] = {
            "source": "projected_from_measured", "seconds": round(seconds),
            "training_seconds": round(training_seconds),
            "fixed_overhead_s": round(baseline["fixed_overhead_s"]),
            "iteration_time_ms": round(baseline["iteration_time_ms"], 2),
            "iterations_per_second": round(baseline["iterations_per_second"], 2),
            "range_low_s": round(seconds * .85), "range_high_s": round(seconds * 1.25),
            "baseline_profile": baseline["preset"],
            "baseline_iterations": baseline["iters"],
            "cameras": baseline.get("cameras"), "resolution": baseline["resolution"],
            "gpu": baseline["gpu"],
        }
    return profiles


def splat_campaign_inventory(vault: Path | None, preset: str,
                              scope: str = "active_sites", pending_fn=None) -> dict:
    """Find reproducible CUDA campaign targets without mutating the queue."""
    root = Path(vault or VAULT)
    profile = resolve_splat_spec({"preset": preset})
    target_iters = int(profile["iters"])
    pending_fn = pending_fn or jobstore.pending
    active_versions, versioned, scene_by_active, improving_active = set(), set(), {}, set()
    scenes_dir = root / "manifest" / "scenes"
    for path in scenes_dir.glob("scene_*.json") if scenes_dir.exists() else []:
        try:
            scene = json.loads(path.read_text())
        except (OSError, ValueError, TypeError):
            continue
        if scene.get("active_version"):
            active_versions.add(scene["active_version"])
            scene_by_active[scene["active_version"]] = scene.get("id")
            if any(v.get("status") in ("processing", "queued")
                   for v in scene.get("versions") or []
                   if v.get("id") != scene.get("active_version")):
                improving_active.add(scene["active_version"])
        versioned.update(v.get("id") for v in scene.get("versions") or [] if v.get("id"))
    eligible, skipped = [], []
    for meta_path in sorted((root / "models").glob("*/meta.json")):
        cid = meta_path.parent.name
        reason = None
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, ValueError, TypeError):
            skipped.append({"clip_id": cid, "reason": "invalid_model_metadata"})
            continue
        if cid in improving_active:
            reason = "scene_improvement_in_progress"
        elif scope == "active_sites" and cid in versioned and cid not in active_versions:
            reason = "inactive_site_version"
        qa = meta.get("qa") or {}
        if not reason and int(qa.get("cameras_reconstructed") or 0) <= 0:
            reason = "no_registered_cameras"
        project = root / "odm" / f"proj_{cid}"
        if not reason and not (project / "opensfm" / "reconstruction.json").exists():
            reason = "missing_odm_poses"
        if not reason and (pending_fn("splat", cid) or pending_fn("3d", cid)):
            reason = "already_queued_or_running"
        runs = (meta.get("reconstruction") or {}).get("splat_runs") or []
        achieved_iters = max((int(run.get("target_iters") or run.get("requested_iterations") or 0)
                              for run in runs
                              if "cuda" in str(run.get("effective_backend") or run.get("backend") or "").lower()
                              and not run.get("fallback")), default=0)
        if not reason and achieved_iters >= target_iters:
            reason = "already_at_or_above_target"
        if reason:
            skipped.append({"clip_id": cid, "reason": reason,
                            "achieved_iterations": achieved_iters})
            continue
        image_dir = project / "images"
        input_bytes = sum(path.stat().st_size for path in image_dir.iterdir()
                          if path.is_file()) if image_dir.exists() else 0
        try:
            cameras = sum(1 for line in (project / "opensfm" / "image_list.txt").read_text().splitlines()
                          if line.strip())
        except OSError:
            cameras = int(qa.get("cameras_reconstructed") or 0)
        eligible.append({
            "clip_id": cid,
            "title": meta.get("title") or cid,
            "cameras": cameras,
            "input_bytes": input_bytes,
            "achieved_iterations": achieved_iters,
            **({"scene_id": scene_by_active[cid]} if scene_by_active.get(cid) else {}),
        })
    return {
        "preset": profile["key"], "label": profile["label"], "iterations": target_iters,
        "backend": "cuda", "backend_policy": "strict", "scope": scope,
        "eligible": eligible, "skipped": skipped,
        "total_input_bytes": sum(row["input_bytes"] for row in eligible),
    }


def splat_project_preflight(cid: str, job_spec: dict, vault: Path | None = None,
                             node: dict | None = None) -> dict | None:
    """Run the same measured project preflight for direct and batch CUDA jobs."""
    root = Path(vault or VAULT)
    project = root / "odm" / f"proj_{cid}"
    image_list = project / "opensfm" / "image_list.txt"
    if not image_list.exists():
        return None
    import preflight as _pf
    from PIL import Image as _Img
    lines = [line.strip() for line in image_list.read_text().splitlines() if line.strip()]
    try:
        first = lines[0].replace("/datasets/code", str(project))
        width = _Img.open(first).width
    except (IndexError, OSError, ValueError):
        width = 3072
    image_dir = project / "images"
    project_bytes = sum(path.stat().st_size for path in image_dir.iterdir()
                        if path.is_file()) if image_dir.exists() else 0
    return _pf.splat_preflight_for_backend(
        max(1, len(lines)), width, job_spec["preset"], job_spec["backend"],
        node=node, project_bytes=project_bytes,
        wsl_free_bytes=(node or {}).get("wsl_free_bytes"),
        bridge_free_bytes=(node or {}).get("bridge_free_bytes"))


def source_evidence(clip_id: str, vault: Path | None = None) -> dict:
    """Measured, reproducible capture evidence used by scene and altitude products."""
    root = Path(vault or VAULT)
    clip_id = re.sub(r"[^\w-]", "", str(clip_id))
    payload = {}
    for path in (root / "tracks" / f"{clip_id}.flight.json",
                 root / "manifest" / f"{clip_id}.json"):
        try:
            data = json.loads(path.read_text())
            payload = {**data, **payload}
        except (OSError, ValueError, TypeError):
            continue
    stats = payload.get("stats") or {}
    try:
        altitude = round(float(stats.get("max_rel_alt_m") or 0), 1)
    except (TypeError, ValueError):
        altitude = 0.0
    bbox = stats.get("bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4):
        bbox = None
    row = {
        "clip_id": clip_id,
        "altitude_m": altitude,
        "altitude_band_m": scenestore.altitude_band(altitude),
        "capture_at": stats.get("start"),
        "coverage_bbox": bbox,
        "distance_m": stats.get("distance_m"),
        "status": "eligible",
    }
    return {key: value for key, value in row.items() if value is not None}


def scene_source_compatibility(scene: dict, sources: list, *, evidence_fn=source_evidence,
                               max_distance_m: float = 500.0) -> dict:
    """Enforce a measured same-place boundary before building a scene version."""
    limit = max(1.0, float(max_distance_m or 500.0))
    measured = {}
    for source in sources:
        try:
            row = evidence_fn(str(source)) or {}
        except (KeyError, OSError, ValueError, TypeError):
            row = {}
        bbox = row.get("coverage_bbox")
        center = None
        if (isinstance(bbox, (list, tuple)) and len(bbox) == 4
                and all(isinstance(value, (int, float)) for value in bbox)):
            center = ((float(bbox[0]) + float(bbox[2])) / 2,
                      (float(bbox[1]) + float(bbox[3])) / 2)
        measured[str(source)] = {"evidence": row, "center": center}

    anchor = (scene or {}).get("anchor") or {}
    try:
        anchor_center = (float(anchor["lon"]), float(anchor["lat"]))
        anchor_source = "scene"
    except (KeyError, TypeError, ValueError):
        first = next(((source, row["center"]) for source, row in measured.items()
                      if row["center"] is not None), None)
        anchor_center = first[1] if first else None
        anchor_source = f"source:{first[0]}" if first else None

    accepted = []
    rejected = []
    for source in map(str, sources):
        center = measured.get(source, {}).get("center")
        if center is None or anchor_center is None:
            rejected.append({"clip_id": source, "reason": "coverage_unknown",
                             "distance_m": None})
            continue
        mean_lat = math.radians((anchor_center[1] + center[1]) / 2)
        dx = (center[0] - anchor_center[0]) * 111320 * math.cos(mean_lat)
        dy = (center[1] - anchor_center[1]) * 111320
        distance = round(math.hypot(dx, dy), 1)
        if distance <= limit:
            accepted.append(source)
        else:
            rejected.append({"clip_id": source, "reason": "outside_site_radius",
                             "distance_m": distance, "max_distance_m": limit})
    return {"accepted": accepted, "rejected": rejected,
            "max_distance_m": limit, "anchor_source": anchor_source}


def prepare_scene_version(scene_id: str, sources: list, photos: list, preset: str,
                          title: str, then_splat: bool = False,
                          splat_preset: str = "cinematic",
                          best_available: bool = True,
                          splat_backend: str = "cuda",
                          splat_resolution: str | None = None,
                          odm_backend: str = "cuda") -> tuple[str, dict]:
    """Create immutable scene-version membership and its 3D job specification."""
    scene = scenestore.get_scene(scene_id)
    sources = list(dict.fromkeys(str(x) for x in sources if str(x)))
    photos = list(dict.fromkeys(Path(str(x)).name for x in photos if str(x)))
    if not sources:
        raise ValueError("a scene version needs at least one video")
    if preset not in ("rapido", "estandar", "alta", "extra", "ultra"):
        preset = "estandar"
    reconstruction_id = jobstore.recon_id_for(sources, photos)
    evidence = [source_evidence(source) for source in sources]
    scenestore.update_source_evidence(scene_id, evidence)
    scenestore.add_version(scene_id, reconstruction_id, sources, photos, "processing",
                           source_evidence=evidence)
    spec = {
        "clip_id": reconstruction_id,
        "primary_cid": sources[0],
        "scene_id": scene_id,
        "version_id": reconstruction_id,
        "preset": preset,
        "title": str(title or scene.get("title") or "Escena")[:80].strip(),
        "sources": sources,
        "photos": photos,
        "then_splat": bool(then_splat),
        "backend": "cuda" if str(odm_backend).lower() == "cuda" else None,
        "backend_policy": ("strict" if str(odm_backend).lower() == "cuda"
                           and preset in ("alta", "extra", "ultra") else "best_available"),
    }
    if then_splat:
        followup = build_followup_splat_spec(reconstruction_id, {
            "splat_preset": splat_preset,
            "splat_backend": splat_backend,
            "splat_resolution": splat_resolution,
            "best_available": best_available,
            "scene_id": scene_id,
            "version_id": reconstruction_id,
            "title": title,
        })
        spec.update({
            "splat": followup,
            # Compatibility fields for workers deployed before the nested contract.
            "splat_preset": followup["preset"],
            "splat_backend": followup["backend"],
            "splat_resolution": followup["resolution"],
            "best_available": followup["best_available"],
        })
    return reconstruction_id, spec


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


def _ff(cmd: list):
    """ffmpeg con stderr CAPTURADO y timeout: antes un fallo daba 'returned non-zero exit
    status 1' en la UI y la causa real moría en el stdout del server. 30 min por paso."""
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "ffmpeg falló sin stderr").strip()[-300:])


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
        # tmp POR JOB (no compartido): dos exports concurrentes con e{i}.mp4 fijos se pisaban
        # los segmentos → ambos reels corruptos. El finally lo limpia entero (también en error).
        tmp = VAULT / "reels" / f".tmp-{j['id']}"
        tmp.mkdir(parents=True, exist_ok=True)
        segs = []
        transitions = []  # transición de ENTRADA a cada corte (nombre del contrato v7)
        trans_durs = []   # transDur por corte (paralelo a transitions)
        if len(spec["segments"]) > 24:
            raise ValueError(f"máximo 24 cortes por reel (llegaron {len(spec['segments'])})")
        raw_segs = spec["segments"][:24]
        # xfade exige MISMO fps en todos los inputs: con 'Fuente' (fps=0) y clips 30/60
        # mezclados el export moría. Si hay transiciones, normaliza los segmentos a 30.
        wants_xfade_pre = len(raw_segs) > 1 and any(
            XFADE_MAP.get(str((s if isinstance(s, dict) else {}).get("transition", "none")))
            for s in raw_segs[1:] if isinstance(s, dict))
        if wants_xfade_pre and not fps:
            rate = ["-r", "30"]
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
            if b - a > 120:
                # antes: min(b-a,120) truncaba EN SILENCIO (preview 3 min, reel 2 min)
                raise ValueError(f"el corte {i + 1} dura {b - a:.0f}s — máximo 120s por corte")
            in_dur = b - a
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
            # -t de ENTRADA (antes de -i): sin él, 'reverse' bufferea desde 'a' hasta el FIN
            # del archivo y el -t de salida se queda con los ÚLTIMOS out_dur seg invertidos
            # (contenido equivocado) + pico de RAM de minutos de 1080p.
            cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(a), "-t", f"{in_dur:.3f}", "-i", str(src)]
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
            _ff(cmd)
            jobstore.update(j["id"], progress=(i + 1) / (len(raw_segs) + 1),
                            detail=f"corte {i + 1}/{len(raw_segs)}")
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
            _ff(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(lst), "-c", "copy", str(out)])
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
            jobstore.update(j["id"], detail="componiendo transiciones", progress=0.92)
            _ff(cmd)
        for s in segs:
            s.unlink()
        rebuild_index()
        job_end(j, "done", out.name)
    except Exception as e:
        job_end(j, "error", str(e)[-300:])
    finally:
        shutil.rmtree(VAULT / "reels" / f".tmp-{j['id']}", ignore_errors=True)



# ── NODO GPU (PC RTX 4060 Ti en LAN): probe SSH cacheado + WoL + sleep ──
# Todo REAL: si el PC duerme se reporta dormido; nada se inventa.
GPU_NODE = {"ts": 0.0, "data": {"status": "unknown"}}
GPU_NODE_IP = "192.168.1.5"
GPU_NODE_MAC = "BC:5F:F4:45:7E:B8"

def gpu_node_status(force: bool = False) -> dict:
    import shutil, socket, subprocess, time as _t
    now = _t.time()
    if not force and now - GPU_NODE["ts"] < 20:
        return GPU_NODE["data"]
    data = {"ip": GPU_NODE_IP, "status": "asleep", "ts": int(now)}
    try:
        sock = socket.create_connection((GPU_NODE_IP, 22), timeout=1.2)
        sock.close()
        data["status"] = "awake"
        q = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=3", "-o", "BatchMode=yes", "pc",
             "nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,"
             "utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits"
             " & netstat -e"],
            capture_output=True, timeout=10)
        # bytes + decode tolerante: el netstat de Windows en español sale en cp850
        # ("Estadísticas...") y text=True (utf-8 estricto) reventaba TODO el probe
        q_out = (q.stdout or b"").decode("utf-8", "replace")
        if q.returncode == 0 and q_out.strip():
            f = [x.strip() for x in q_out.strip().splitlines()[0].split(",")]
            data.update({"gpu": f[0], "driver": f[1], "vram_total_mb": int(float(f[2])),
                         "vram_used_mb": int(float(f[3])), "util_pct": int(float(f[4])),
                         "temp_c": int(float(f[5])), "power_w": round(float(f[6]), 1)})
            # netstat -e: primera línea "Bytes  <rx>  <tx>" = NIC física de Windows —
            # el eth0 de WSL NO ve los scp del staging NTFS (medido: 340MB invisibles)
            for ln in q_out.splitlines():
                t = ln.split()
                if len(t) == 3 and t[1].isdigit() and t[2].isdigit():
                    data["_net_raw"] = {"rx": int(t[1]), "tx": int(t[2]), "t": now}
                    break
        wsl = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=3", "-o", "BatchMode=yes", "pc",
             "wsl -d Ubuntu -- bash -lc \"head -1 /proc/stat; grep -E 'MemTotal|MemAvailable' /proc/meminfo\""],
            capture_output=True, text=True, timeout=12)
        raw = (wsl.stdout or "").replace("\x00", "")
        cpu_line = mem = {}
        for ln in raw.splitlines():
            t = ln.split()
            if not t:
                continue
            if t[0] == "cpu" and len(t) >= 8:
                # jiffies: user nice system idle iowait irq softirq
                vals = [int(x) for x in t[1:8]]
                data["_cpu_raw"] = {"busy": sum(vals) - vals[3] - vals[4], "total": sum(vals)}
            elif t[0] == "MemTotal:":
                data["pc_ram_total_gb"] = round(int(t[1]) / 1048576, 1)
            elif t[0] == "MemAvailable:":
                data["_ram_avail_kb"] = int(t[1])
        if data.get("pc_ram_total_gb") and data.get("_ram_avail_kb"):
            data["pc_ram_used_gb"] = round(data["pc_ram_total_gb"] - data.pop("_ram_avail_kb") / 1048576, 1)
        # tasas por delta contra la muestra anterior (mismo cache que el TTL)
        prev = (GPU_NODE.get("data") or {})
        pc, pp = data.get("_cpu_raw"), prev.get("_cpu_raw")
        if pc and pp and pc["total"] > pp["total"]:
            data["pc_cpu_pct"] = round(100 * (pc["busy"] - pp["busy"]) / (pc["total"] - pp["total"]))
        nc, np_ = data.get("_net_raw"), prev.get("_net_raw")
        if nc and np_ and nc["t"] > np_["t"]:
            dt = nc["t"] - np_["t"]
            data["net_rx_mbps"] = round((nc["rx"] - np_["rx"]) / dt / 131072, 1)  # Mbit/s
            data["net_tx_mbps"] = round((nc["tx"] - np_["tx"]) / dt / 131072, 1)
    except Exception:
        pass
    GPU_NODE.update(ts=now, data=data)
    return data


def gpu_cuda_preflight_status(force: bool = False) -> dict:
    """Combine the fast UI node status with the pinned WSL CUDA environment probe."""
    node = dict(gpu_node_status(force))
    if node.get("status") != "awake":
        return node
    try:
        import gpu_lane
        node.update(gpu_lane.probe())
        node["status"] = "awake"
    except Exception as exc:
        node["environment_verified"] = False
        node["environment_error"] = str(exc)[-300:]
    GPU_NODE.update(ts=time.time(), data=node)
    return node

def gpu_node_wake() -> dict:
    import socket
    raw = bytes.fromhex(GPU_NODE_MAC.replace(":", ""))
    pkt = b"\xff" * 6 + raw * 16
    sk = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sk.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sk.sendto(pkt, ("192.168.1.255", 9))
    sk.close()
    return {"ok": True, "sent": GPU_NODE_MAC}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def end_headers(self):
        if self.headers.get("CF-Connecting-IP") or self.headers.get("CF-Ray"):
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def redirect_external_http(self) -> bool:
        if not (self.headers.get("CF-Connecting-IP") or self.headers.get("CF-Ray")):
            return False
        proto = (self.headers.get("X-Forwarded-Proto") or "").lower()
        visitor = (self.headers.get("CF-Visitor") or "").replace(" ", "").lower()
        if proto != "http" and '"scheme":"http"' not in visitor:
            return False
        host = (self.headers.get("Host") or "vuelos.metislab.work").split(":", 1)[0].lower()
        if host not in ("vuelos.metislab.work", "www.metislab.work"):
            host = "vuelos.metislab.work"
        self.send_response(308)
        self.send_header("Location", f"https://{host}{self.path}")
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        return True

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
        # DENYLIST del vault (crítico): /data servía TODA la raíz sin auth — /data/.token filtraba
        # el TOKEN MAESTRO por el túnel público (write total) y /data/manifest/jobs.db la BD entera.
        # El vault mezcla assets públicos (models/thumbs/manifest/ai/splats) con secretos y estado.
        if base == VAULT.resolve():
            parts = f.relative_to(base).parts
            if (any(seg.startswith(".") for seg in parts)                    # .token .training .tmp-* dotfiles
                    or f.suffix.lower() in (".db", ".token", ".env", ".sqlite", ".jsonl", ".log")
                    or parts[0] in ("ops", "trash", "odm", "raw")):          # dirs internos: nunca públicos
                return None
        return f if f.is_file() else None

    def do_GET(self):
        if self.redirect_external_http():
            return
        if self.path.startswith("/api/healthz"):
            body, code = health_status()
            if not (self._is_local() or self.headers.get("X-Token", "") == TOKEN or self.session_ok()):
                body = {"ok": body["ok"], "ts": body["ts"]}
            return self.send_json(body, code)
        if self.path.startswith("/api/whoami"):
            if self._is_local() or self.headers.get("X-Token", "") == TOKEN or self.session_ok():
                return self.send_json({"ok": True, "local": self._is_local()})
            return self.send_json({"ok": False}, 403)
        if self.path.startswith("/api/viewer_ping"):
            # Sec-Fetch-Site OBLIGATORIA y del propio sitio: todos los navegadores la mandan
            # en fetch(); antes un `site` vacío (curl remoto) pasaba y cualquiera podía mantener
            # ODM en 7 cores y OpenSplat en background 24/7 pingueando gratis. Local exento (tests).
            site = (self.headers.get("Sec-Fetch-Site") or "").lower()
            if not (self._is_local() or site in ("same-origin", "same-site")):
                return self.send_json({"ok": False}, 403)
            mark_viewer_activity()
            return self.send_json({"ok": True})
        if self.path.startswith("/api/gpu_node"):
            if not self.auth():
                return
            force = "force=1" in self.path
            return self.send_json(gpu_node_status(force))
        if urllib.parse.urlparse(self.path).path == "/api/splat_profiles":
            if not self.auth():
                return
            return self.send_json({"profiles": splat_profiles_with_history(),
                                   "resolution_options": ["auto", "full", "half"]})
        if self.path.startswith("/api/perf"):
            # telemetría en vivo del Mac (CPU/GPU/RAM/swap/térmica/disk + uso por job).
            # El sampler solo corre mientras alguien consulta — idle = 0 costo.
            if not self.auth():
                return
            return self.send_json(live_perf_payload(PERF.get()))
        if self.path.startswith("/api/error_report_content"):
            # Authenticated reader: ops/ is intentionally denied by the public /data resolver.
            if not self.auth():
                return
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = (query.get("name") or [""])[0]
            if not re.fullmatch(r"error-report-\d{8}-\d{4}\.md", name):
                return self.send_json({"error": "reporte inválido"}, 400)
            rdir = (VAULT / "ops" / "reports").resolve()
            report = (rdir / name).resolve()
            try:
                report.relative_to(rdir)
                if not report.is_file() or report.stat().st_size > 2_000_000:
                    raise OSError("missing or oversized")
                content = report.read_text(errors="replace")
            except (OSError, ValueError):
                return self.send_json({"error": "reporte no encontrado"}, 404)
            return self.send_json({"name": name, "content": content,
                                   "bytes": report.stat().st_size})
        if self.path.startswith("/api/error_reports"):
            # Lista metadata only; report bodies stay private behind the authenticated reader.
            if not self.auth():
                return
            rdir = VAULT / "ops" / "reports"
            reps = sorted(rdir.glob("error-report-*.md"), reverse=True)[:12] if rdir.is_dir() else []
            latest = {}
            lj = rdir / "latest.json"
            if lj.is_file():
                try:
                    latest = json.loads(lj.read_text())
                except ValueError:
                    pass
            recent = []
            if perfmod.ERRLOG.is_file():
                for line in perfmod.ERRLOG.read_text().splitlines()[-15:][::-1]:
                    try:
                        recent.append(json.loads(line))
                    except ValueError:
                        continue
            return self.send_json({"reports": [
                {"name": p.name, "bytes": p.stat().st_size,
                 "ts": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.stat().st_mtime))}
                for p in reps], "latest": latest, "recent_errors": recent})
        if urllib.parse.urlparse(self.path).path == "/api/scenes":
            if not self.auth():
                return
            return self.send_json({"scenes": scenestore.list_scenes()})
        if urllib.parse.urlparse(self.path).path == "/api/scene":
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                return self.send_json({"scene": scenestore.get_scene(str((qs.get("id") or [""])[0]))})
            except (KeyError, ValueError):
                return self.send_json({"error": "escena no encontrada"}, 404)
        api_url = urllib.parse.urlparse(self.path)
        if api_url.path == "/api/job_log":
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(api_url.query)
            jid = str((qs.get("id") or [""])[0])
            if not jobstore.get(jid):
                return self.send_json({"error": "trabajo no encontrado"}, 404)
            try:
                after = int((qs.get("after") or [0])[0])
                limit = int((qs.get("limit") or [500])[0])
                return self.send_json(jobstore.log_chunk(jid, after, limit))
            except (TypeError, ValueError):
                return self.send_json({"error": "cursor de log inválido"}, 400)
        if api_url.path == "/api/job":
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(api_url.query)
            jid = str((qs.get("id") or [""])[0])
            row = jobstore.get(jid)
            if not row:
                return self.send_json({"error": "trabajo no encontrado"}, 404)
            refresh_running_job(row)
            detail = normalize_job_summary(row)
            detail["spec"] = _job_spec(row)
            detail["events"] = jobstore.events(jid)
            return self.send_json({"job": detail})
        if api_url.path == "/api/jobs":
            if not self.auth():
                return
            jobs = jobstore.recent()
            for j in jobs:
                # progreso derivado del log si el worker corre codigo viejo (stale DB)
                refresh_running_job(j)
            latest_done = jobstore.latest_done_ids(("3d",))
            summaries = [normalize_job_summary(j, latest_done) for j in jobs]
            counts = {
                "all": len(summaries),
                "active": sum(j["status"] in ("running", "queued") for j in summaries),
                "done": sum(j["status"] == "done" for j in summaries),
                "error": sum(j["status"] in ("error", "cancel_failed") for j in summaries),
            }
            return self.send_json({"jobs": summaries, "counts": counts})
        if self.path.startswith("/api/geocode"):
            # nombres humanos (ciudad · barrio): proxy server-side a Nominatim con
            # caché persistente — el cliente jamás toca hosts externos nuevos.
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                lat = round(float((qs.get("lat") or [""])[0]), 3)
                lon = round(float((qs.get("lon") or [""])[0]), 3)
            except ValueError:
                return self.send_json({"error": "lat/lon inválidos"}, 400)
            gc_file = VAULT / "manifest" / "geocode.json"
            try:
                cache = json.loads(gc_file.read_text()) if gc_file.exists() else {}
            except ValueError:
                cache = {}
            key = f"{lat},{lon}"
            if key not in cache:
                try:
                    req = urllib.request.Request(
                        f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}"
                        f"&format=jsonv2&zoom=16&accept-language=es",
                        headers={"User-Agent": "AeroBrain/1.0 (uso personal)"})
                    with urllib.request.urlopen(req, timeout=8) as r:
                        a = json.loads(r.read()).get("address", {})
                    barrio = a.get("neighbourhood") or a.get("suburb") or a.get("quarter") or a.get("village") or ""
                    ciudad = a.get("city") or a.get("town") or a.get("municipality") or a.get("state") or ""
                    cache[key] = {"name": " · ".join(x for x in (barrio, ciudad) if x) or None}
                    _t = gc_file.with_suffix(".json.tmp")
                    _t.write_text(json.dumps(cache, ensure_ascii=False))
                    os.replace(_t, gc_file)
                except Exception:
                    return self.send_json({"name": None, "cached": False})
            return self.send_json({**cache[key], "cached": True})
        if self.path.startswith("/api/capture_report"):
            if not self.auth():
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            cid = re.sub(r"[^\w-]", "", (qs.get("clip_id") or [""])[0])
            if not cid:
                return self.send_json({"error": "clip_id requerido"}, 400)
            import capture_quality
            try:
                rep = None if "force" in qs else capture_quality.cached(cid)
                if rep and "memory_risk" not in rep:
                    rep = None                    # cache pre-upgrade: re-analiza para incluir el riesgo de memoria
                rep = rep or capture_quality.analyze(cid)
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
        if f.suffix.lower() == ".html" and str(f).startswith(str(WEB)):
            payload = render_html(f)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; "
                "connect-src 'self' data: blob: https://server.arcgisonline.com https://basemaps.cartocdn.com; "
                "worker-src 'self' blob:; media-src 'self' blob:; frame-src 'self'; frame-ancestors 'none'")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        if f.suffix.lower() == ".mp4":
            ua = self.headers.get("User-Agent", "")
            # el probe externo TAMBIÉN va en la whitelist: su Range-GET cada 15 min marcaba
            # actividad de viewer y degradaba ODM/OpenSplat 45s por corrida — el monitoreo
            # se auto-infligía ~5% del wall-time de los jobs pesados
            if not ua.startswith(("AeroBrainWatchdog/", "AeroBrainOpsStatus/", "AeroBrainExternalProbe/")):
                mark_viewer_activity()
        # binarios 3D pesados (nube/malla/splat): cachear PERO revalidar (no-cache + 304).
        # Las URLs no llevan versión y un re-entreno reescribe el mismo nombre — max-age
        # serviría stale; no-store re-bajaría MBs en cada visita. 304 = lo mejor de ambos.
        # los bundles de SuperSplat (23MB dist) solo cambian al rebuildear: 304 también.
        # imágenes bajo models/ (vt*/ortho/dsm) cambian en re-procesado → revalidan, no 24h stale
        revalidate, cache_header = static_cache_policy(f, self.path)
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
            self.send_header("Cache-Control", cache_header)
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
        # media se cachea; 3D revalida; código sólo es immutable con fingerprint exacto
        # (evita tanto túnel lento como CSS viejo quemado en iPhone)
        if revalidate:
            self.send_header("Last-Modified", formatdate(mtime, usegmt=True))
        self.send_header("Cache-Control", cache_header)
        if f.suffix == ".html":
            # SuperSplat vive embebido en un iframe de splatlab.html (mismo origen)
            anc = "'self'" if str(f).startswith(str(SUPERSPLAT)) else "'none'"
            self.send_header("Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "  # wasm: el sort worker de splats compila WebAssembly
                "style-src 'self' 'unsafe-inline'; "        # inline style attrs (bajo riesgo)
                "img-src 'self' data: blob: https:; "
                "connect-src 'self' data: blob: https://server.arcgisonline.com https://basemaps.cartocdn.com; "
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
        if self.redirect_external_http():
            return
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
        if f.suffix.lower() == ".html" and str(f).startswith(str(WEB)):
            payload = render_html(f)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return
        gz = Path(str(f) + ".gz")
        revalidate, cache_header = static_cache_policy(f, self.path)
        self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        # espejo del GET: binarios 3D anuncian validador para el caché condicional
        if revalidate:
            self.send_header("Last-Modified", formatdate(int(f.stat().st_mtime), usegmt=True))
        self.send_header("Cache-Control", cache_header)
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
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # cliente se fue; nada que enviar

    def do_POST(self):
        if self.redirect_external_http():
            return
        try:
            self._post()
        except (ValueError, json.JSONDecodeError):
            self._safe_send({"error": "JSON inválido o body demasiado grande"}, 400)
        except BrokenPipeError:
            pass
        except Exception as e:
            # un 500 sin causa registrada es in-diagnosticable (lección del arco):
            # el estado siempre viaja con su porqué
            try:
                import traceback
                perfmod.log_error("server-500", f"{type(e).__name__}: {e}",
                                  ctx={"path": self.path, "tb": traceback.format_exc()[-400:]})
            except Exception:
                pass
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
            cid = f"UP_{time.strftime('%Y%m%d%H%M%S')}{secrets.token_hex(2)}_{Path(name).stem[:40]}"
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
            if read != length:
                path.unlink(missing_ok=True)   # corte de red/túnel: NO procesar un video truncado
                return self.send_json({"error": f"subida incompleta ({read}/{length} bytes) — reintenta"}, 400)
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
            if ext not in (".ply", ".splat", ".ksplat", ".sog", ".spz"):
                return self.send_json({"error": f"formato {ext or '?'} no soportado"}, 400)
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
            # lee el meta ANTES de archivarlo: la versión editada hereda cámaras/iters (sin loss,
            # ya no es medible tras la edición). Sin esto queda iters=0 y el sort "iters primero"
            # dejaría el splat recién editado DEBAJO del viejo — el round-trip de SuperSplat no serviría.
            old_meta = {}
            meta_p = sdir / f"{cid}.meta.json"
            if meta_p.is_file():
                try:
                    old_meta = json.loads(meta_p.read_text())
                except (ValueError, OSError):
                    old_meta = {}
            archived_splat = archived_viewer = None
            for old in (sdir / f"{cid}.clean.sog", sdir / f"{cid}.spz",
                        sdir / f"{cid}.splat", sdir / f"{cid}.ksplat", sdir / f"{cid}.ply",
                        meta_p, sdir / f"{cid}.cameras.json"):
                if old.is_file():
                    suffix = old.name[len(cid):]
                    dst = hist / f"{cid}-{ts}{suffix}"
                    os.replace(old, dst)
                    archived.append(old.name)
                    if suffix == ".splat":
                        archived_splat = f"splats/history/{dst.name}"
                    elif suffix in (".clean.sog", ".spz", ".ksplat"):
                        archived_viewer = f"splats/history/{dst.name}"
            # los jobs 'done' del entrenamiento anterior deben seguir apuntando a SU versión
            # archivada, no al path mutable que ahora es el archivo editado (mismo contrato que
            # publish_splat_stage)
            if archived_splat or archived_viewer:
                jobstore.retarget_splat_artifacts(cid, archived_splat, archived_viewer)
            prune_splat_history(hist, cid, keep=6)
            final = sdir / f"{cid}{ext}"
            os.replace(tmp, final)
            if old_meta:
                new_meta = {k: v for k, v in old_meta.items() if k != "final_loss"}
                new_meta["edited"] = True          # editado en SuperSplat: el loss ya no aplica
                meta_p.write_text(json.dumps(new_meta, indent=1))
            optimized = None
            if ext not in (".sog", ".spz", ".ksplat"):
                ktmp = sdir / f".{cid}.clean.tmp.sog"
                try:
                    tool = PIPE.parent / "tools/node_modules/@playcanvas/splat-transform/bin/cli.mjs"
                    r = subprocess.run(["node", str(tool), str(final), str(ktmp), "--overwrite"],
                                       capture_output=True, text=True, timeout=600)
                    if r.returncode == 0 and ktmp.exists() and ktmp.stat().st_size > 1024:
                        os.replace(ktmp, sdir / f"{cid}.clean.sog")
                        optimized = f"{cid}.clean.sog"
                    else:
                        ktmp.unlink(missing_ok=True)
                except (OSError, subprocess.TimeoutExpired):
                    ktmp.unlink(missing_ok=True)
            rebuild_index()
            return self.send_json({"ok": True, "published": final.name, "optimized": optimized,
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
            _vol = str(spec.get("volume", ""))
            if any(x.get("kind") == "ingest" and x.get("status") in ("running", "queued")
                   for x in jobstore.recent(10)):
                return self.send_json({"error": "ya hay una importación corriendo — espera a que termine"}, 409)
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
        if u.path == "/api/scene_create":
            if not self.auth(q):
                return
            spec = self.read_json()
            scene = scenestore.create_scene(str(spec.get("title") or "Escena"),
                                             spec.get("anchor") if isinstance(spec.get("anchor"), dict) else {},
                                             spec.get("sources") if isinstance(spec.get("sources"), list) else [],
                                             spec.get("photos") if isinstance(spec.get("photos"), list) else [],
                                             source_evidence=[source_evidence(cid) for cid in
                                               (spec.get("sources") if isinstance(spec.get("sources"), list) else [])])
            existing = re.sub(r"[^\w-]", "", str(spec.get("existing_version") or ""))
            if existing and (VAULT / "models" / existing / "meta.json").exists():
                sources = spec.get("sources") if isinstance(spec.get("sources"), list) else [existing]
                photos = spec.get("photos") if isinstance(spec.get("photos"), list) else []
                try:
                    meta = json.loads((VAULT / "models" / existing / "meta.json").read_text())
                    recon = meta.get("reconstruction") or {}
                    qa = meta.get("qa") or {}
                    version = scenestore.add_version(
                        scene["id"], existing, sources, photos, "ready",
                        merge_label=recon.get("merge_label") or "SINGLE",
                        required_artifacts_ok=bool(qa.get("cameras_reconstructed")),
                        metrics=scenestore.model_metrics(meta),
                        source_evidence=[source_evidence(cid) for cid in sources])
                    if version.get("required_artifacts_ok") and version.get("merge_label") in ("SINGLE", "FULL"):
                        scene = scenestore.promote(scene["id"], existing)
                except (ValueError, OSError):
                    pass
            return self.send_json({"ok": True, "scene": scene})
        if u.path == "/api/scene_improve":
            if not self.auth(q):
                return
            spec = self.read_json()
            scene_id = re.sub(r"[^\w-]", "", str(spec.get("scene_id", "")))
            try:
                scene = scenestore.get_scene(scene_id)
            except (KeyError, ValueError):
                return self.send_json({"error": "escena no encontrada"}, 404)
            active = next((v for v in scene.get("versions", [])
                           if v.get("id") == scene.get("active_version")), None) or {}
            if isinstance(spec.get("sources"), list):
                requested_sources = spec["sources"]
            else:
                requested_sources = [*active.get("sources", []), *(spec.get("new_sources") or [])]
            sources = []
            for value in requested_sources:
                cid = re.sub(r"[^\w-]", "", str(value))
                if (cid and cid not in sources
                        and (VAULT / "manifest" / f"{cid}.json").exists()
                        and (VAULT / "tracks" / f"{cid}.flight.json").exists()):
                    sources.append(cid)
            if not sources:
                return self.send_json({"error": "elige al menos un video con GPS"}, 400)
            if len(sources) > 24:
                return self.send_json({"error": "máximo 24 videos por versión de escena"}, 400)
            compatibility = scene_source_compatibility(scene, sources)
            if compatibility["rejected"]:
                far = [row for row in compatibility["rejected"]
                       if row["reason"] == "outside_site_radius"]
                unknown = [row for row in compatibility["rejected"]
                           if row["reason"] == "coverage_unknown"]
                parts = []
                if far:
                    parts.append(f"{len(far)} fuera del radio de sitio de 500 m")
                if unknown:
                    parts.append(f"{len(unknown)} sin cobertura GPS medible")
                return self.send_json({
                    "error": "no se mezclaron zonas distintas: " + "; ".join(parts),
                    "code": "SCENE_SOURCE_INCOMPATIBLE",
                    "rejected_sources": compatibility["rejected"],
                    "max_distance_m": compatibility["max_distance_m"],
                }, 400)
            requested_photos = spec.get("photos") if isinstance(spec.get("photos"), list) else [
                *active.get("photos", []), *(spec.get("new_photos") or [])]
            photos = [Path(str(p)).name for p in requested_photos
                      if isinstance(p, str) and (VAULT / "photos" / Path(str(p)).name).is_file()][:80]
            reconstruction_id = jobstore.recon_id_for(sources, photos)
            if jobstore.pending("3d", reconstruction_id):
                return self.send_json({"error": "esa versión ya está en cola o procesándose"}, 409)
            try:
                reconstruction_id, job_spec = prepare_scene_version(
                    scene_id, sources, photos, str(spec.get("preset") or "alta"),
                    str(spec.get("title") or scene.get("title") or "Escena"),
                    bool(spec.get("then_splat")), str(spec.get("splat_preset") or "cinematic"),
                    spec.get("best_available", True) is not False,
                    str(spec.get("splat_backend") or "cuda"),
                    spec.get("splat_resolution") or spec.get("resolution"),
                    str(spec.get("backend") or "cuda"))
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            job = jobstore.enqueue("3d", reconstruction_id, job_spec)
            scenestore.update_version(scene_id, reconstruction_id, job_id=job["id"])
            return self.send_json({"ok": True, "job": job["id"], "scene_id": scene_id,
                                   "reconstruction": reconstruction_id,
                                   "sources": len(sources), "photos": len(photos)})
        if u.path == "/api/scene_promote":
            if not self.auth(q):
                return
            spec = self.read_json()
            try:
                scene = scenestore.promote(str(spec.get("scene_id") or ""),
                                           str(spec.get("version_id") or ""))
                version_ids = {v.get("id") for v in scene.get("versions") or [] if v.get("id")}
                for version_id in version_ids:
                    if (VAULT / "models" / version_id / "meta.json").exists():
                        subprocess.run(["python3", str(PIPE / "scene_manifest.py"), version_id],
                                       check=False, timeout=180)
                rebuild_index()
                return self.send_json({"ok": True, "scene": scene})
            except (KeyError, ValueError) as e:
                return self.send_json({"error": str(e)}, 409)
        if u.path == "/api/odm":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            if not cid or not (VAULT / "manifest" / f"{cid}.json").exists():
                return self.send_json({"error": "clip no encontrado en el vault"}, 404)
            if jobstore.pending("3d", cid):
                return self.send_json({"error": "ese vuelo ya está en cola o procesándose"}, 409)
            preset = str(spec.get("preset", "estandar"))
            if preset not in ("rapido", "estandar", "alta", "extra", "ultra"):
                preset = "estandar"
            # MULTI-FUENTE: sources = videos a fundir (cid primario + otros del mismo lugar);
            # cada uno debe tener track GPS. photos = fotos sueltas del vault.
            raw_sources = spec.get("sources") if isinstance(spec.get("sources"), list) else [cid]
            sources, seen = [], set()
            for s in raw_sources:
                s = re.sub(r"[^\w-]", "", str(s))
                if s and s not in seen and (VAULT / "tracks" / f"{s}.flight.json").exists():
                    seen.add(s); sources.append(s)
            if cid not in sources:                       # el primario manda la identidad
                sources.insert(0, cid)
            sources = [cid] + [s for s in sources if s != cid]
            if len(sources) > 6:
                return self.send_json({"error": "máximo 6 videos por modelo combinado"}, 400)
            photos = [Path(str(p)).name for p in (spec.get("photos") or [])
                      if isinstance(p, str) and (VAULT / "photos" / Path(str(p)).name).is_file()][:40]
            # entity U0: los combinados nuevos nacen con identidad PROPIA (recon_<hash>,
            # determinista por set de fuentes+fotos) — ya no usurpan el clip_id del primario.
            # Los single-source conservan su cid: alias no-op, share links intactos.
            ident = jobstore.recon_id_for(sources, photos) if (len(sources) > 1 or photos) else cid
            if ident != cid and jobstore.pending("3d", ident):
                return self.send_json({"error": "esa combinación ya está en cola o procesándose"}, 409)
            job_spec = {"clip_id": ident, "primary_cid": cid, "preset": preset,
                        "title": str(spec.get("title", ""))[:80].strip(),
                        "sources": sources, "photos": photos}
            if str(spec.get("backend") or "").lower() == "cuda":
                job_spec["backend"] = "cuda"
                job_spec["backend_policy"] = (
                    "strict" if preset in ("alta", "extra", "ultra") else "best_available")
            if spec.get("then_splat"):                   # phased: gaussian tras el 3D
                try:
                    followup = build_followup_splat_spec(ident, spec)
                except ValueError as e:
                    return self.send_json({"error": str(e)}, 400)
                job_spec.update({
                    "then_splat": True,
                    "splat": followup,
                    "splat_preset": followup["preset"],
                    "splat_backend": followup["backend"],
                    "splat_resolution": followup["resolution"],
                    "best_available": followup["best_available"],
                })
            j = jobstore.enqueue("3d", ident, job_spec)
            return self.send_json({"ok": True, "job": j["id"], "queued": True,
                                   "reconstruction": ident,
                                   "sources": len(sources), "photos": len(photos)})
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
        if u.path == "/api/splat_campaign":
            if not self.auth(q):
                return
            request = self.read_json()
            preset = str(request.get("preset") or "frontier")
            if preset not in ("ultra", "ultra20", "frontier", "grandmaster"):
                return self.send_json({"error": "campaña admite 15K, 20K, 30K o 40K"}, 400)
            scope = "all_models" if request.get("scope") == "all_models" else "active_sites"
            resolution = str(request.get("resolution") or "auto")
            if resolution not in ("auto", "full", "half"):
                return self.send_json({"error": "resolución inválida"}, 400)
            plan = splat_campaign_inventory(VAULT, preset, scope=scope)
            node = gpu_cuda_preflight_status()
            blocked_verdicts = {"REJECTED", "INPUT_FLOOR_EXCEEDS_CAP", "NODE_UNAVAILABLE",
                                "ENVIRONMENT_INVALID", "INSUFFICIENT_DISK"}
            specs, blocked = [], []
            for row in plan["eligible"]:
                raw = {"preset": preset, "backend": "cuda", "resolution": resolution,
                       "best_available": False, "scene_id": row.get("scene_id"),
                       "version_id": row["clip_id"] if row.get("scene_id") else None,
                       "title": row.get("title")}
                spec = build_splat_job_spec(row["clip_id"], raw)
                pfv = splat_project_preflight(row["clip_id"], spec, node=node)
                spec["preflight"] = pfv
                row["preflight"] = pfv
                if pfv and pfv.get("verdict") in blocked_verdicts:
                    blocked.append({"clip_id": row["clip_id"], "verdict": pfv.get("verdict"),
                                    "note": pfv.get("note")})
                specs.append(spec)
            plan.update({"resolution": resolution, "node": node, "blocked": blocked,
                         "ready_to_enqueue": bool(specs) and not blocked})
            if not request.get("confirm"):
                return self.send_json({"ok": True, "dry_run": True, "plan": plan})
            if blocked:
                return self.send_json({"error": "campaña bloqueada por preflight; no se encoló ningún job",
                                       "plan": plan}, 409)
            if not specs:
                return self.send_json({"error": "no hay modelos elegibles", "plan": plan}, 409)
            if any(jobstore.pending("splat", spec["clip_id"]) or
                   jobstore.pending("3d", spec["clip_id"]) for spec in specs):
                return self.send_json({"error": "la cola cambió; vuelve a ejecutar el dry-run"}, 409)
            campaign_id = f"cuda-{preset}-{int(time.time())}"
            jobs = []
            for position, spec in enumerate(specs, 1):
                spec["campaign"] = {"id": campaign_id, "position": position,
                                    "total": len(specs)}
                job = jobstore.enqueue("splat", spec["clip_id"], spec)
                jobs.append({"id": job["id"], "clip_id": spec["clip_id"],
                             "position": position})
            return self.send_json({"ok": True, "campaign_id": campaign_id,
                                   "queued": jobs, "plan": plan})
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
                job_spec = build_splat_job_spec(cid, spec)
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            if (requires_local_splat_binary(job_spec["backend"])
                    and not any_opensplat_bin_exists()):
                return self.send_json({"error": "opensplat no está compilado"}, 500)
            if jobstore.pending("splat", cid) or jobstore.pending("3d", cid):
                return self.send_json({"error": "ese vuelo ya tiene un modelo/splat en cola o entrenando"}, 409)
            # PREFLIGHT (U1.3): veredicto ANTES de encolar — el P1 hecho producto.
            # Con proyecto existente el conteo es EXACTO (image_list); REJECTED no
            # encola (salvo force_preflight: escape consciente). La proyección viaja
            # al job = telemetría proyectado-vs-observado permanente del modelo.
            pfv = splat_project_preflight(
                cid, job_spec,
                node=(gpu_cuda_preflight_status() if job_spec["backend"] == "cuda" else None))
            if pfv:
                blocked = ("REJECTED", "INPUT_FLOOR_EXCEEDS_CAP", "NODE_UNAVAILABLE",
                           "ENVIRONMENT_INVALID", "INSUFFICIENT_DISK")
                if pfv["verdict"] in blocked and not spec.get("force_preflight"):
                    return self.send_json({"error": "preflight: la carga de entrada queda fuera del sobre seguro — "
                                           + pfv.get("note", ""), "preflight": pfv}, 409)
            job_spec["preflight"] = pfv
            j = jobstore.enqueue("splat", cid, job_spec)
            return self.send_json({"ok": True, "job": j["id"], "queued": True,
                                   "preset": job_spec["preset"], "iters": job_spec["iters"],
                                   "backend": job_spec["backend"],
                                   "resolution": job_spec["resolution"],
                                   "preflight": pfv})
        if u.path == "/api/preflight":
            # U1.3 en el modal: proyección de memoria per-preset ANTES de encolar.
            # Etiquetada como proyección del modelo (±25%) — la UI jamás la vende como promesa.
            if not self.auth(q):
                return
            spec = self.read_json()
            import preflight as _pf
            try:
                n = max(1, min(5000, int(spec.get("n_images", 0))))
                w = max(640, min(8192, int(spec.get("width", 2688))))
                p = resolve_splat_spec({"preset": str(spec.get("preset", "medium"))})["key"]
                backend = normalize_splat_request({"preset": p,
                                                   "backend": spec.get("backend")})["backend"]
            except (TypeError, ValueError):
                return self.send_json({"error": "parámetros inválidos"}, 400)
            node = gpu_cuda_preflight_status(bool(spec.get("force"))) if backend == "cuda" else None
            return self.send_json(_pf.splat_preflight_for_backend(
                n, w, p, backend, node=node,
                project_bytes=max(0, int(spec.get("project_bytes") or 0)),
                wsl_free_bytes=node.get("wsl_free_bytes") if node else None,
                bridge_free_bytes=node.get("bridge_free_bytes") if node else None))
        if u.path == "/api/suggest_name":
            # DeepSeek (lane de texto): nombre de proyecto corto y humano desde lugar+fecha+tomas
            if not self.auth(q):
                return
            spec = self.read_json()
            place = str(spec.get("place", ""))[:80]
            date = str(spec.get("date", ""))[:20]
            n = max(1, min(20, int(spec.get("n", 1) or 1)))
            try:
                name = _deepseek(
                    f"Nombre corto (máx 5 palabras, español, sin comillas ni emojis) para un proyecto "
                    f"de fotogrametría con dron: lugar '{place}', fecha {date}, {n} video(s). "
                    f"Estilo: evocador pero sobrio, tipo 'Atardecer en Suba' o 'Casa Chía — combinado'. "
                    f"Responde SOLO el nombre.").strip().strip('"')[:60]
                return self.send_json({"name": name})
            except Exception as e:
                return self.send_json({"error": f"DeepSeek no disponible: {e}"}, 502)
        if u.path == "/api/client_error":
            # errores JS del frontend → registro central. Sin auth (los reporta también la
            # página pública), pero: mismo-origen obligatorio + presupuesto global 60/h
            # (un abusador no puede inflar el log ni gastar disco).
            site = (self.headers.get("Sec-Fetch-Site") or "").lower()
            if not (self._is_local() or site in ("same-origin", "same-site")):
                return self.send_json({"ok": False}, 403)
            now = time.time()
            if now > _CLIENT_ERR_BUDGET["reset"]:
                _CLIENT_ERR_BUDGET.update(n=0, reset=now + 3600)
            if _CLIENT_ERR_BUDGET["n"] >= 60:
                return self.send_json({"ok": False, "rate": True}, 429)
            _CLIENT_ERR_BUDGET["n"] += 1
            try:
                spec = self.read_json(max_bytes=4000)
            except (ValueError, json.JSONDecodeError):
                return self.send_json({"error": "body inválido"}, 400)
            perfmod.log_error("client", str(spec.get("msg", ""))[:300],
                              {"page": str(spec.get("page", ""))[:80],
                               "stack": str(spec.get("stack", ""))[:200]})
            return self.send_json({"ok": True})
        if u.path == "/api/error_report":
            # genera el reporte AI (DeepSeek SOLO escribe; el .md queda para revisión humana/Codex)
            if not self.auth(q):
                return
            j = job_add("error_report", "reporte de errores (DeepSeek)")

            def _run_report():
                try:
                    rc = jobstore.run_tracked(j["id"],
                                              ["python3", str(PIPE / "error_report.py"),
                                               "--days", "7"], timeout=300)
                    tail = (jobstore.get(j["id"]) or {}).get("log") or ""
                    if rc == 0:
                        job_end(j, "done", tail.strip().splitlines()[-1][-200:] if tail.strip()
                                else "reporte generado")
                    else:
                        job_end(j, "error", tail.strip()[-200:] or "error_report falló")
                except (subprocess.TimeoutExpired, OSError) as e:
                    job_end(j, "error", str(e)[-200:])
            threading.Thread(target=_run_report, daemon=True).start()
            return self.send_json({"ok": True, "job": j["id"]})
        if u.path == "/api/search":
            # búsqueda semántica (embeddings + Supabase RPC). Quedó MUERTA cuando el refactor
            # del worker borró este handler — la UI mostraba 'sin sesión' en falso.
            if not self.auth(q):
                return
            spec = self.read_json()
            qtext = str(spec.get("q", "")).strip()[:400]
            if not qtext:
                return self.send_json({"results": []})
            try:
                return self.send_json(semantic_search(qtext))
            except Exception as e:
                return self.send_json({"error": f"búsqueda AI no disponible: {str(e)[-120:]}", "results": []}, 502)
        if u.path == "/api/analyze":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            # dedupe + validación: doble click = 2 análisis deep concurrentes (2× costo LLM
            # y carrera sobre ai/{cid}.json); cid inexistente = job basura
            if not cid or not (VAULT / "manifest" / f"{cid}.json").exists():
                return self.send_json({"error": "clip no encontrado"}, 404)
            if any(x.get("kind") == "analyze" and x.get("label", "").startswith(cid)
                   and x.get("status") in ("running", "queued") for x in jobstore.recent(12)):
                return self.send_json({"error": "ese análisis ya está corriendo"}, 409)
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
        if u.path == "/api/gpu_node/wake":
            if not self.auth():
                return
            return self.send_json(gpu_node_wake())
        if u.path == "/api/gpu_node/sleep":
            if not self.auth():
                return
            import subprocess
            try:
                # guardia de cortesía: pantalla desbloqueada = alguien usando el PC
                chk = subprocess.run(["ssh", "-o", "ConnectTimeout=3", "-o", "BatchMode=yes", "pc",
                    'tasklist /FI "IMAGENAME eq LogonUI.exe" | find /C "LogonUI"'],
                    capture_output=True, text=True, timeout=8)
                locked = (chk.stdout or "").replace("\x00", "").strip().splitlines()
                if locked and locked[-1].strip() == "0":
                    return self.send_json({"ok": False, "reason": "sesion activa en el PC"}, 409)
                subprocess.run(["ssh", "-o", "ConnectTimeout=3", "-o", "BatchMode=yes", "pc",
                    "rundll32.exe powrprof.dll,SetSuspendState 0,1,0"],
                    capture_output=True, timeout=8)
                GPU_NODE["ts"] = 0.0            # invalidar caché
                return self.send_json({"ok": True})
            except Exception as e:
                return self.send_json({"ok": False, "reason": str(e)}, 500)
        if u.path == "/api/scene_objects":
            # objetos de escena del juego (FLIGHTVERSE): valida contra el
            # contrato de docs/SCENE_OBJECTS.md y escribe objects.json
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            mdir = VAULT / "models" / cid
            if not cid or not (mdir / "meta.json").exists():
                return self.send_json({"error": "clip_id inválido"}, 400)
            objs = spec.get("objects")
            if not isinstance(objs, list) or len(objs) > 200:
                return self.send_json({"error": "objects: lista de máx 200"}, 400)
            clean = []
            for o in objs:
                if not isinstance(o, dict):
                    return self.send_json({"error": "objeto no es dict"}, 400)
                typ = str(o.get("type", ""))
                if typ not in ("glb", "ring", "beacon", "box"):
                    return self.send_json({"error": f"type inválido: {typ}"}, 400)
                try:
                    pos = [float(v) for v in o.get("pos", [])]
                    assert len(pos) == 3 and all(abs(v) < 5000 for v in pos)
                except Exception:
                    return self.send_json({"error": "pos inválida"}, 400)
                item = {"type": typ, "pos": pos,
                        "yaw": float(o.get("yaw", 0)),
                        "scale": max(0.05, min(50.0, float(o.get("scale", 1)))),
                        "ground": bool(o.get("ground", True))}
                if typ == "glb":
                    f = re.sub(r"[^\w.-]", "", str(o.get("file", "")))
                    if not f.endswith(".glb"):
                        return self.send_json({"error": "glb requiere file *.glb"}, 400)
                    item["file"] = f
                for k in ("spin", "bob", "color"):
                    if k in o:
                        item[k] = o[k] if k == "color" else bool(o[k])
                clean.append(item)
            (mdir / "objects.json").write_text(json.dumps({"version": 1, "objects": clean}, ensure_ascii=False))
            return self.send_json({"ok": True, "count": len(clean)})

        if u.path == "/api/highlight":
            if not self.auth(q):
                return
            spec = self.read_json()
            cid = re.sub(r"[^\w-]", "", str(spec.get("clip_id", "")))
            if not cid:
                return self.send_json({"error": "clip_id requerido"}, 400)
            try:
                t_val = float(spec.get("t", 0))
            except (TypeError, ValueError):
                t_val = 0.0
            if not math.isfinite(t_val):
                return self.send_json({"error": "t inválido"}, 400)   # NaN rompía el JSON del panel AI
            aif = VAULT / "ai" / f"{cid}.json"
            data = read_json_file(aif) if aif.exists() else {"clip_id": cid, "tags": [], "highlights": []}
            data.setdefault("highlights", []).append({
                "t": round(t_val, 1),
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
            if "label" in spec:
                m["label"] = str(spec["label"])[:80]     # sin cap, un body de 1MB entraba al flights.json público
            if "archived" in spec:
                m["archived"] = bool(spec["archived"])
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
    jobstore.init(orphan_kinds=jobstore.LIGHT_KINDS)   # solo el server marca huérfanos sus LIGHT
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
