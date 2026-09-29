"""Prepara un vuelo para fotogrametría ODM: frames 2K + geotag desde el track SRT.

El paso clave es el geotag: ODM sin GPS en EXIF reconstruye sin escala ni
georreferencia (aprendido a la mala: ortofoto de 67x66px). Con GPS, el bundle
adjustment converge y la ortofoto sale georreferenciada de verdad.

Usage:
    python3 odm_prep.py DJI_20260704160358_0104_D [--camera-profile neo2]
    # luego:
    docker run --rm -m 7g -v /Volumes/SSD/drone-vault/odm/<proj>:/datasets/code \
      opendronemap/odm --project-path /datasets --fast-orthophoto \
      --pc-quality low --feature-quality medium --max-concurrency 4
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from srt_parser import point_at

from paths import VAULT  # noqa: E402
from fsutil import atomic_write_json, atomic_write_text  # noqa: E402
FPS = 0.5          # 1 frame cada 2s
WIDTH = 2688       # default: balance calidad/RAM en 16GB


# ---- perfiles de cámara: EXIF Model -> args extra de ODM ----------------------------------
# Un lente ultra-ancho (Neo 2, ~120°) necesita el modelo Brown; sin él OpenSfM asume perspectiva
# y la escena se "abomba" (doming). --use-fixed-camera-params congela los parámetros ajustados
# (ayuda contra el doming en vuelos de una sola altura). Cualquier otra cámara: SIN args extra.
#
# Clave = EXIF Model normalizado (minúsculas, solo [a-z0-9]). `verified=False` = la clave NO se
# leyó de un archivo real de esa cámara: ningún Neo 2 existe hoy en el vault (solo FC8582 = Flip,
# 24 mm eq., FOV 73.7°). Al ingerir el primer Neo 2, `camera_profile.models` de frames_manifest.json
# muestra el Model real: añádelo aquí y pon verified=True. Los DJI de consumo suelen exponer un
# código FCxxxx en vez del nombre comercial, así que estas claves pueden no coincidir nunca.
_BROWN = ["--camera-lens", "brown", "--use-fixed-camera-params"]
CAMERA_PROFILES = {
    "djineo2": {"label": "DJI Neo 2", "args": _BROWN, "verified": False},
    "neo2":    {"label": "DJI Neo 2", "args": _BROWN, "verified": False},
}


def normalize_camera_model(model) -> str:
    return "".join(ch for ch in str(model or "").lower() if ch.isalnum())


def detect_camera_models(images: Path) -> dict:
    """{EXIF Model: nº de imágenes} de los JPG/PNG de `images`. Los frames de video no traen
    Model (solo las fotos), así que un set solo-video devuelve {}."""
    try:
        out = subprocess.run(
            ["exiftool", "-json", "-Model", "-ext", "jpg", "-ext", "jpeg", "-ext", "png", str(images)],
            capture_output=True, text=True, timeout=300)
        rows = json.loads(out.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    counts: dict = {}
    for row in rows:
        m = str(row.get("Model") or "").strip()
        if m:
            counts[m] = counts.get(m, 0) + 1
    return counts


def select_camera_profile(models: dict, override: str | None = None) -> dict:
    """Decide los args extra de ODM. Gana el Model más frecuente con perfil (>= la mitad de las
    imágenes con Model); `override` (clave de CAMERA_PROFILES) fuerza uno. Siempre devuelve un
    registro auditable, también cuando no hay coincidencia (args == [])."""
    record = {"profile": None, "label": None, "args": [], "verified": None,
              "models": dict(models), "reason": "sin coincidencia: ODM por defecto"}
    if override:
        key = normalize_camera_model(override)
        if key not in CAMERA_PROFILES:
            raise SystemExit(f"--camera-profile desconocido: {override}")
        prof = CAMERA_PROFILES[key]
        record.update(profile=key, label=prof["label"], args=list(prof["args"]),
                      verified=prof["verified"], reason="forzado por --camera-profile")
        return record
    total = sum(models.values())
    best = None
    for model, n in models.items():
        key = normalize_camera_model(model)
        if key in CAMERA_PROFILES and (best is None or n > best[1]):
            best = (key, n, model)
    if best and best[1] * 2 >= total:
        prof = CAMERA_PROFILES[best[0]]
        record.update(profile=best[0], label=prof["label"], args=list(prof["args"]),
                      verified=prof["verified"],
                      reason=f"EXIF Model {best[2]!r} en {best[1]}/{total} imágenes")
    elif not models:
        record["reason"] = "sin EXIF Model (frames de video): ODM por defecto"
    return record


def merge_odm_args(base: list, extra: list) -> list:
    """base + extra sin duplicar ni pisar flags que el preset ya fija (el preset manda)."""
    out = list(base)
    have = {a for a in out if str(a).startswith("--")}
    i = 0
    while i < len(extra):
        flag = extra[i]
        has_val = i + 1 < len(extra) and not str(extra[i + 1]).startswith("--")
        if flag not in have:
            out.append(flag)
            if has_val:
                out.append(extra[i + 1])
            have.add(flag)
        i += 2 if has_val else 1
    return out


def camera_extra_args(proj: Path) -> list:
    """Args extra guardados por odm_prep en frames_manifest.json (sobrevive a clean_odm_outputs)."""
    try:
        args = json.loads((Path(proj) / "frames_manifest.json").read_text()).get("camera_profile", {}).get("args", [])
    except (OSError, ValueError, AttributeError):
        return []
    return [str(a) for a in args] if isinstance(args, list) else []


def find_raw(cid: str) -> Path:
    for p in (VAULT / "raw").rglob(f"{cid}.*"):
        if p.suffix.lower() in (".mp4", ".mov"):
            return p
    raise FileNotFoundError(cid)


PROFILE_FPS = {"preview": 0.33, "balanced": 0.5, "premium": 1.0, "splat": 0.75}
# Extra/ultra necesitan más detalle de textura, pero ODM/OpenMVS en el M4 de
# 16GB no aguanta 4 workers sobre 4K completo. La estrategia correcta es subir
# moderadamente la imagen y bajar concurrencia en el worker.
PROFILE_WIDTH = {"preview": 2048, "balanced": 2688, "premium": 3072, "splat": 3072}


def frame_time(path: Path, fps: float) -> float:
    """Segundo de video de un frame f_NNNN.jpg. El filtro fps de ffmpeg emite el frame 1 en t=0,
    así que frame num → (num-1)/fps."""
    return (int(path.stem.split("_")[1]) - 1) / fps


def prune_frames(images, track_pts, fps, profile, manifest_path=None):
    """Poda adaptativa post-extracción: fuera el cuartil borroso y los frames
    casi-duplicados (sin movimiento GPS). Opera sobre los f_*.jpg de `images`.
    Escribe frames_manifest.json solo si se pasa manifest_path (multi-fuente lo omite)."""
    from capture_quality import choose_frames, sharpness
    from PIL import Image
    files = sorted(images.glob("f_*.jpg"))
    if len(files) < 40:
        return len(files)                      # clips chicos: no vale la pena podar
    sharp_by_t, time_of = {}, {}
    for f in files:
        t = round(frame_time(f, fps), 1)       # por número de archivo, no por índice
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
    if manifest_path is not None:
        atomic_write_json(manifest_path,
            {"profile": profile, "kept": len(keep), "dropped": dropped,
             "width": PROFILE_WIDTH.get(profile, WIDTH), "fps": fps, "frames": chosen},
            indent=1, ensure_ascii=True)
    print(f"poda adaptativa [{profile}]: {len(keep)} frames elegidos · {dropped} descartados "
          f"(blur / casi-duplicados)", flush=True)
    return len(keep)


def _load_pts(cid: str) -> list:
    tf = VAULT / "tracks" / f"{cid}.flight.json"
    if not tf.exists():
        return []
    try:
        pts = json.loads(tf.read_text()).get("points", [])
    except (ValueError, OSError):
        return []
    return [p for p in pts if isinstance(p.get("lat"), (int, float))
            and isinstance(p.get("lon"), (int, float))]


def _geotag(path: Path, p: dict) -> list:
    """Args de exiftool para escribir GPS en EXIF de una imagen (un -execute)."""
    return [
        f"-GPSLatitude={abs(p['lat'])}", f"-GPSLatitudeRef={'N' if p['lat'] >= 0 else 'S'}",
        f"-GPSLongitude={abs(p['lon'])}", f"-GPSLongitudeRef={'E' if p['lon'] >= 0 else 'W'}",
        f"-GPSAltitude={p.get('abs_alt', 0)}", "-GPSAltitudeRef=0",
        str(path), "-execute",
    ]


def _photo_parent(name: str):
    """Foto 'DJI_..._0104_D_00003.0s.jpg' → (clip_id, segundos). Devuelve (None, 0) si no calza."""
    import re
    m = re.match(r"^(.+?)_(\d+(?:\.\d+)?)s\.(?:jpg|jpeg|png)$", name, re.I)
    if m:
        return m.group(1), float(m.group(2))
    return None, 0.0


def _extract_source(tmp_dir: Path, images: Path, src_cid: str, prefix: str, profile, fps: float, width: int) -> tuple[list, int]:
    """Extrae + poda de UN video fuente hacia tmp_dir con `prefix`. Devuelve los args de geotag
    apuntando a la ruta FINAL en images/ (exiftool corre DESPUÉS del swap, no sobre tmp_dir)."""
    raw = find_raw(src_cid)
    pts = _load_pts(src_cid)
    if not pts:
        raise SystemExit(f"{src_cid} sin track GPS — ODM no puede georreferenciarlo")
    stmp = tmp_dir / f".ext_{prefix or 's'}"      # subdir por-fuente (nombres f_XXXX limpios para la poda)
    if stmp.exists():
        shutil.rmtree(stmp)
    stmp.mkdir(parents=True)
    print(f"[{prefix or 'único'}] frames {width}px de {raw.name}…", flush=True)
    # -hwaccel videotoolbox: decodifica el HEVC 4K en el Media Engine del M4
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y",
                             "-hwaccel", "videotoolbox", "-i", str(raw),
                             "-vf", f"fps={fps},scale={width}:-2", "-q:v", "2",
                             str(stmp / "f_%04d.jpg")])
    import time as _t
    while proc.poll() is None:
        _t.sleep(8)
        print(f"[{prefix or 'único'}] frames: {len(list(stmp.glob('f_*.jpg')))}", flush=True)
    if proc.returncode != 0:
        shutil.rmtree(stmp, ignore_errors=True)
        raise SystemExit(f"ffmpeg falló extrayendo frames de {src_cid}")
    if profile:
        prune_frames(stmp, pts, fps, profile, manifest_path=None)
    # mueve los supervivientes a tmp_dir con prefijo por-fuente + arma su geotag
    args = []
    survivors = sorted(stmp.glob("f_*.jpg"))
    for f in survivors:
        # el número del ARCHIVO fija el tiempo (no el índice tras poda); posición por tiempo
        # de VIDEO (vt), no por índice: puntos descartados (sin lock/dropouts) desplazan el índice
        pt = point_at(pts, frame_time(f, fps))
        name = f"{prefix}{f.name}" if prefix else f.name   # 's0_f_0042.jpg' o 'f_0042.jpg'
        os.replace(f, tmp_dir / name)
        args += _geotag(images / name, pt)   # ruta FINAL: el geotag corre tras el swap
    shutil.rmtree(stmp, ignore_errors=True)
    return args, len(survivors)


# ---- sets de FOTOS (raw/<set>/<pasada>/*.JPG) como fuente ---------------------------------------
# Las fotos del dron traen su propio EXIF GPS/gimbal: NO se re-geotaggean (a diferencia de los
# frames de video). Cada pasada es una "fuente" con su prefijo s<N>_ (mismo esquema que el video),
# de modo que worker.odm_registration / odm_frame_preflight las cuentan por fuente sin cambios.
# Token de fuente en --sources / job spec: "set:<set>/<pasada>".
PHOTO_SET_TOKEN = "set:"
PHOTO_SET_MAX_IMAGES = 1000        # tope de fotos ÚNICAS (tras dedup) por reconstrucción
PHOTO_SET_JPG_EXT = (".jpg", ".jpeg")
PHOTO_SET_RESERVED = ("uploads", "audio", "photos", "reels")   # raw/uploads = videos subidos
GPS_WARN_COVERAGE = 0.9
_LABEL_RE = __import__("re").compile(r"[\w -]{1,60}")


def raw_root() -> Path:
    return (VAULT / "raw")


def valid_photo_label(name) -> bool:
    r"""Mismo alfabeto que el upload (server.photo_set_label): [\w -], ≤60, sin reservados,
    sin espacios en los bordes. Sin puntos ni separadores → no hay traversal posible."""
    s = str(name or "")
    return bool(_LABEL_RE.fullmatch(s)) and s == s.strip() and s.lower() not in PHOTO_SET_RESERVED


def photo_set_token(set_name: str, pass_name: str) -> str:
    return f"{PHOTO_SET_TOKEN}{set_name}/{pass_name}"


def is_photo_set_ref(ref) -> bool:
    return str(ref or "").startswith(PHOTO_SET_TOKEN)


def parse_photo_set_ref(ref) -> tuple:
    """'set:A/nadir' | 'raw/A/nadir' | 'A' → (set, pass|None). Valida nombres (SystemExit)."""
    s = str(ref or "").strip()
    if s.startswith(PHOTO_SET_TOKEN):
        s = s[len(PHOTO_SET_TOKEN):]
    elif s.startswith("raw/"):
        s = s[len("raw/"):]
    parts = s.split("/")
    if not 1 <= len(parts) <= 2:
        raise SystemExit(f"set de fotos inválido: {ref!r} (esperaba <set>[/<pasada>])")
    for part in parts:
        if not valid_photo_label(part):
            raise SystemExit(f"nombre de set/pasada inválido: {part!r}")
    return parts[0], (parts[1] if len(parts) == 2 else None)


def photo_set_pass_dirs(set_name: str, pass_name: str | None = None, root: Path | None = None) -> list:
    """[(set, pasada, Path)] existentes bajo raw/. Sin symlinks ni salidas de raw/ (resolve)."""
    base = (root or raw_root())
    try:
        base_r = base.resolve()
    except OSError:
        return []
    sd = base / set_name
    if not sd.is_dir() or sd.is_symlink():
        raise SystemExit(f"set de fotos no existe en raw/: {set_name}")
    names = [pass_name] if pass_name else sorted(
        p.name for p in sd.iterdir() if p.is_dir() and not p.is_symlink() and valid_photo_label(p.name))
    out = []
    for n in names:
        d = sd / n
        if not d.is_dir() or d.is_symlink():
            if pass_name:
                raise SystemExit(f"pasada no existe: {set_name}/{n}")
            continue
        try:
            d.resolve().relative_to(base_r)
        except ValueError:
            raise SystemExit(f"pasada fuera de raw/: {set_name}/{n}")
        out.append((set_name, n, d))
    return out


def _gps_ok(lat, lon) -> bool:
    return (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and abs(lat) <= 90 and abs(lon) <= 180 and not (lat == 0 and lon == 0))


def _exif_date(v):
    """'2026:03:15 12:15:28' → '2026-03-15T12:15:28' (None si no calza)."""
    import re
    m = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", str(v or ""))
    return f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}" if m else None


def read_photo_exif(directory: Path) -> dict:
    """{filename: {lat, lon, alt, model, date, gimbal}} con UNA llamada a exiftool por directorio.
    Falla suave ({}): el caller trata las fotos sin fila como sin GPS."""
    try:
        out = subprocess.run(
            ["exiftool", "-json", "-n", "-q", "-GPSLatitude", "-GPSLongitude", "-GPSAltitude",
             "-Model", "-DateTimeOriginal", "-GimbalPitchDegree", "-GimbalYawDegree",
             "-ext", "jpg", "-ext", "jpeg", "-ext", "dng", str(directory)],
            capture_output=True, text=True, timeout=600)
        rows = json.loads(out.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    res = {}
    for r in rows:
        name = Path(str(r.get("SourceFile") or "")).name
        if not name:
            continue
        lat, lon = r.get("GPSLatitude"), r.get("GPSLongitude")
        res[name] = {"lat": lat if _gps_ok(lat, lon) else None, "lon": lon if _gps_ok(lat, lon) else None,
                     "alt": r.get("GPSAltitude") if isinstance(r.get("GPSAltitude"), (int, float)) else None,
                     "model": str(r.get("Model") or "").strip() or None,
                     "date": _exif_date(r.get("DateTimeOriginal")),
                     "gimbal": r.get("GimbalPitchDegree") is not None}
    return res


def _jpeg_magic(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(3) == b"\xff\xd8\xff"
    except OSError:
        return False


def scan_photo_pass(set_name: str, pass_name: str, directory: Path) -> dict:
    """Inventario de UNA pasada: JPG/JPEG utilizables + DNG (sin gemelo JPG → omitidos)."""
    jpgs, dngs, junk = [], [], []
    for f in sorted(directory.iterdir(), key=lambda p: p.name):
        if not f.is_file() or f.is_symlink() or f.name.startswith("."):
            continue
        ext = f.suffix.lower()
        if ext in PHOTO_SET_JPG_EXT:
            try:
                ok = f.stat().st_size > 0 and _jpeg_magic(f)
            except OSError:
                ok = False
            (jpgs if ok else junk).append(f)
        elif ext == ".dng":
            dngs.append(f)
    twins = {f.stem.lower() for f in jpgs}
    dng_paired = [f for f in dngs if f.stem.lower() in twins]
    dng_only = [f for f in dngs if f.stem.lower() not in twins]
    exif = read_photo_exif(directory) if (jpgs or dngs) else {}
    rows = []
    for f in jpgs:
        e = exif.get(f.name) or {}
        rows.append({"path": f, "name": f.name, "lat": e.get("lat"), "lon": e.get("lon"),
                     "alt": e.get("alt"), "model": e.get("model"), "date": e.get("date"),
                     "gimbal": bool(e.get("gimbal"))})
    return {"set": set_name, "pass": pass_name, "dir": directory, "rows": rows,
            "dng_paired": [f.name for f in dng_paired], "dng_only": [f.name for f in dng_only],
            "invalid": [f.name for f in junk]}


def summarize_rows(rows: list) -> dict:
    """Conteo, cobertura GPS, cámaras y rango de fechas de una lista de filas de foto."""
    n = len(rows)
    gps = sum(1 for r in rows if r.get("lat") is not None)
    models: dict = {}
    for r in rows:
        if r.get("model"):
            models[r["model"]] = models.get(r["model"], 0) + 1
    dates = sorted(r["date"] for r in rows if r.get("date"))
    alts = sorted(r["alt"] for r in rows if r.get("alt") is not None)
    return {"count": n, "gps": gps, "gps_coverage": round(gps / n, 3) if n else 0.0,
            "gimbal": sum(1 for r in rows if r.get("gimbal")),
            "models": models, "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
            "alt_min": alts[0] if alts else None, "alt_max": alts[-1] if alts else None}


def _sha1(path: Path) -> str:
    import hashlib
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dedup_photo_groups(groups: list) -> list:
    """Quita duplicados EXACTOS (mismo contenido) dentro del job: la misma foto subida en dos
    pasadas/sets. Solo se hashean los archivos que comparten tamaño. Conserva la primera y anota
    las descartadas en group['duplicates']. (NO es near-duplicate: el solape entre fotos vecinas
    es justo lo que el SfM necesita.)"""
    by_size: dict = {}
    for g in groups:
        for r in g["rows"]:
            try:
                r["size"] = r["path"].stat().st_size
            except OSError:
                r["size"] = -1
            by_size.setdefault(r["size"], []).append(r)
    dup_ids = {}
    for size, rs in by_size.items():
        if len(rs) < 2 or size < 0:
            continue
        seen: dict = {}
        for r in rs:                      # rs conserva el orden grupo→nombre
            digest = _sha1(r["path"])
            if digest in seen:
                dup_ids[id(r)] = seen[digest]
            else:
                seen[digest] = r
    for g in groups:
        keep, dups = [], []
        for r in g["rows"]:
            first = dup_ids.get(id(r))
            if first is None:
                keep.append(r)
            else:
                dups.append({"name": r["name"], "same_as": f"{first['set']}/{first['pass']}/{first['name']}"})
        g["rows"], g["duplicates"] = keep, dups
    return groups


def prepare_photo_groups(refs: list) -> list:
    """refs (tokens/rutas) → grupos por pasada listos para preparar. Falla ANTES de extraer video:
    set inexistente, pasada sin JPG usables, grupo sin GPS o más de PHOTO_SET_MAX_IMAGES únicas."""
    groups, seen_dirs = [], set()
    for ref in refs:
        set_name, pass_name = parse_photo_set_ref(ref)
        for s, p, d in photo_set_pass_dirs(set_name, pass_name):
            if d in seen_dirs:
                continue
            seen_dirs.add(d)
            g = scan_photo_pass(s, p, d)
            for r in g["rows"]:
                r["set"], r["pass"] = s, p
            groups.append(g)
    dedup_photo_groups(groups)
    total = sum(len(g["rows"]) for g in groups)
    if total > PHOTO_SET_MAX_IMAGES:
        raise SystemExit(f"{total} fotos únicas en los sets elegidos — máximo {PHOTO_SET_MAX_IMAGES} por "
                         f"reconstrucción; elige menos pasadas o divide el set")
    for g in groups:
        label = f"{g['set']}/{g['pass']}"
        if g["dng_only"]:
            print(f"[{label}] {len(g['dng_only'])} DNG sin JPG gemelo omitidos (ODM usa JPG; "
                  f"exporta JPG o vuela en JPG+RAW)", flush=True)
        if not g["rows"]:
            why = (f"{len(g['dng_only'])} DNG sin JPG gemelo" if g["dng_only"] else
                   f"{len(g['invalid'])} JPG inválidos" if g["invalid"] else "vacía")
            raise SystemExit(f"la pasada {label} no tiene fotos JPG utilizables ({why})")
        g["summary"] = summarize_rows(g["rows"])
        if g["summary"]["gps"] == 0:
            raise SystemExit(f"{label} sin GPS en el EXIF — ODM no puede georreferenciarlo")
        if g["summary"]["gps_coverage"] < GPS_WARN_COVERAGE:
            print(f"⚠ [{label}] solo {g['summary']['gps']}/{g['summary']['count']} fotos con GPS "
                  f"({g['summary']['gps_coverage']:.0%}) — ODM georreferencia peor", flush=True)
    return groups


def stage_photo_group(tmp_dir: Path, prefix: str, group: dict) -> list:
    """Enlaza/copia las fotos SIN tocar su EXIF a tmp_dir como <prefix>f_<stem>.jpg.
    Devuelve la procedencia por imagen (para frames_manifest)."""
    import re
    prov, used = [], set()
    for r in group["rows"]:
        stem = re.sub(r"[^\w.-]", "_", Path(r["name"]).stem)[:100] or "img"
        name, n = f"{prefix}f_{stem}.jpg", 1
        while name.lower() in used:            # IMG.JPG vs img.jpeg
            n += 1
            name = f"{prefix}f_{stem}-{n}.jpg"
        used.add(name.lower())
        dst = tmp_dir / name
        try:
            os.link(r["path"], dst)            # mismo FS: sin duplicar GBs (el swap solo reubica el enlace)
        except OSError:
            shutil.copy2(r["path"], dst)
        prov.append({"file": name, "src": f"{r['set']}/{r['pass']}/{r['name']}",
                     "gps": r["lat"] is not None, "model": r["model"], "date": r["date"]})
    return prov



def main():
    argv = sys.argv[1:]
    profile = argv[argv.index("--profile") + 1] if "--profile" in argv else None
    photos = [x for x in argv[argv.index("--photos") + 1].split(",") if x] if "--photos" in argv else []
    # --sources a,b,c (multi-fuente) o cid posicional (compat 1 fuente)
    if "--sources" in argv:
        sources = [s for s in argv[argv.index("--sources") + 1].split(",") if s]
    else:
        positional = [a for i, a in enumerate(argv)
                      if not a.startswith("--") and not (i and argv[i - 1].startswith("--"))]
        sources = positional[:1]
    # sets de fotos: tokens "set:<set>/<pasada>" dentro de --sources (así los pasa el worker sin
    # cambios) y/o --photo-set / --photo-sets a,b (rutas "raw/<set>[/<pasada>]" o "<set>[/<pasada>]").
    # El orden de `entries` fija el prefijo s<N>_ (= índice de fuente en el job spec).
    photo_refs = []
    for flag in ("--photo-set", "--photo-sets"):
        if flag in argv:
            photo_refs += [x for x in argv[argv.index(flag) + 1].split(",") if x]
    entries = []
    for ref in list(sources) + photo_refs:
        if is_photo_set_ref(ref) or ref in photo_refs:
            # un set completo expande a UNA fuente por pasada (su propio prefijo y evidencia)
            set_name, pass_name = parse_photo_set_ref(ref)
            entries += [photo_set_token(s_, p_) for s_, p_, _d in photo_set_pass_dirs(set_name, pass_name)]
        else:
            entries.append(ref)
    entries = list(dict.fromkeys(entries))
    if not entries:
        raise SystemExit("uso: odm_prep.py <cid> | --sources a,b,c [--proj-id id] [--photos ...] "
                         "[--photo-set raw/<set>[/<pasada>]] [--profile ...]")
    has_video = any(not is_photo_set_ref(e) for e in entries)
    if not has_video and "--proj-id" not in argv:
        raise SystemExit("un job solo de fotos necesita --proj-id (identidad recon_<hash>)")
    # fallo rápido y barato ANTES de extraer video: valida/inventaría/dedup los sets de fotos
    photo_groups = prepare_photo_groups([e for e in entries if is_photo_set_ref(e)])
    groups_by_pass = {(g["set"], g["pass"]): g for g in photo_groups}
    # entity U0: el proyecto puede llevar identidad propia (recon_<hash>) en vez de heredar
    # la del primario — los combinados nuevos ya no usurpan el clip_id. --proj-id solo
    # aplica junto a --sources (el modo posicional de compat lo ignora por diseño).
    proj_id = (argv[argv.index("--proj-id") + 1]
               if "--proj-id" in argv and ("--sources" in argv or photo_groups) else entries[0])
    proj = VAULT / "odm" / f"proj_{proj_id}"
    images = proj / "images"
    images.mkdir(parents=True, exist_ok=True)
    fps = PROFILE_FPS.get(profile, FPS)
    width = PROFILE_WIDTH.get(profile, WIDTH)

    # todo a un dir TEMPORAL y swap atómico al final: si ffmpeg falla o cancelan, el opensfm
    # previo NO queda apuntando a imágenes inexistentes (se perdía poder re-entrenar el splat).
    tmp_dir = proj / "images.new"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    geotag_args = []
    per_source = []
    photo_set_images = 0
    photo_set_prov = []
    multi = len(entries) > 1 or bool(photos) or bool(photo_groups)
    for idx, src in enumerate(entries):
        prefix = f"s{idx}_" if multi else ""        # 1 sola fuente sin fotos → nombres f_XXXX intactos (compat)
        if is_photo_set_ref(src):
            set_name, pass_name = parse_photo_set_ref(src)
            g = groups_by_pass[(set_name, pass_name)]
            prov = stage_photo_group(tmp_dir, prefix, g)
            photo_set_images += len(prov)
            summ = g["summary"]
            per_source.append({"cid": src, "prefix": prefix, "frames": len(prov), "kind": "photo_set",
                               "set": g["set"], "pass": g["pass"], **summ})
            photo_set_prov.append({"set": g["set"], "pass": g["pass"], "prefix": prefix, **summ,
                                   "dng_paired": g["dng_paired"], "dng_only_skipped": g["dng_only"],
                                   "invalid_skipped": g["invalid"], "duplicates": g["duplicates"],
                                   "images": prov})
            continue
        source_args, source_frames = _extract_source(
            tmp_dir, images, src, prefix, profile, fps, width)
        geotag_args += source_args
        per_source.append({"cid": src, "prefix": prefix or None,
                           "frames": source_frames})

    # fotos: se copian y geotaggean desde el track del clip padre en su instante
    n_photos = 0
    for name in photos:
        sp = VAULT / "photos" / Path(name).name
        if not sp.is_file():
            print(f"foto no encontrada, saltada: {name}", flush=True)
            continue
        name = f"ph_{sp.name}"
        shutil.copy2(sp, tmp_dir / name)
        parent, t = _photo_parent(sp.name)
        pts = _load_pts(parent) if parent else []
        if pts:
            geotag_args += _geotag(images / name, point_at(pts, t))   # ruta final tras swap
        n_photos += 1

    total = sum(1 for a in geotag_args if a == "-execute") + photo_set_images   # un -execute por imagen geotaggeada + fotos con EXIF propio
    if total == 0:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise SystemExit("cero imágenes geotaggeadas — nada que procesar")

    # SWAP atómico: fuera todas las imágenes viejas (cualquier prefijo), entran las nuevas
    for old in images.iterdir():
        if old.is_file() and old.suffix.lower() in (".jpg", ".jpeg", ".png"):
            old.unlink()
    for f in tmp_dir.iterdir():
        if f.is_file():
            os.replace(f, images / f.name)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    # INVALIDA el opensfm viejo AQUÍ (frames nuevos, poses viejas = splat corrupto si cancelan)
    for stale in (proj / "opensfm" / "image_list.txt",
                  proj / "opensfm" / "reconstruction.json"):
        stale.unlink(missing_ok=True)

    # geotag de TODAS las imágenes en una sola pasada de exiftool
    argfile = proj / ".geotag.args"
    argfile.write_text("\n".join(geotag_args))
    # -common_args: -overwrite_original aplica a TODOS los -execute (no solo el primero).
    # Sin argumentos (job solo de fotos con EXIF propio) exiftool no tiene nada que hacer: se omite.
    if geotag_args:
        subprocess.run(["exiftool", "-@", str(argfile), "-common_args", "-overwrite_original"],
                       check=True, capture_output=True)
    for leak in images.glob("*.jpg_original"):
        leak.unlink()
    camera_override = argv[argv.index("--camera-profile") + 1] if "--camera-profile" in argv else None
    camera = select_camera_profile(detect_camera_models(images), camera_override)
    atomic_write_json(proj / "frames_manifest.json",
        {"profile": profile, "sources": per_source, "photos": n_photos,
         "total_frames": total, "width": width, "fps": fps, "camera_profile": camera,
         **({"photo_sets": photo_set_prov} if photo_set_prov else {})},
        indent=1, ensure_ascii=True)
    if camera["args"]:
        print(f"cámara {camera['label']} ({camera['reason']}"
              f"{'' if camera['verified'] else ', perfil SIN verificar'}) → ODM {' '.join(camera['args'])}",
              flush=True)
    n_video = sum(1 for e in entries if not is_photo_set_ref(e))
    parts = ([f"{n_video} video(s)"] if n_video else []) + \
        ([f"{n_photos} foto(s)"] if n_photos else []) + \
        ([f"{photo_set_images} foto(s) de {len(photo_groups)} pasada(s)"] if photo_set_images else [])
    src_lbl = " + ".join(parts)
    print(f"✅ {total} frames geotagged de {src_lbl} → {proj}")


if __name__ == "__main__":
    main()
