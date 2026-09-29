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


def main():
    argv = sys.argv[1:]
    profile = argv[argv.index("--profile") + 1] if "--profile" in argv else None
    photos = [x for x in argv[argv.index("--photos") + 1].split(",") if x] if "--photos" in argv else []
    # --sources a,b,c (multi-fuente) o cid posicional (compat 1 fuente)
    if "--sources" in argv:
        sources = [s for s in argv[argv.index("--sources") + 1].split(",") if s]
    else:
        sources = [a for a in argv if not a.startswith("--")][:1]
    if not sources:
        raise SystemExit("uso: odm_prep.py <cid> | --sources a,b,c [--proj-id id] [--photos ...] [--profile ...]")
    # entity U0: el proyecto puede llevar identidad propia (recon_<hash>) en vez de heredar
    # la del primario — los combinados nuevos ya no usurpan el clip_id. --proj-id solo
    # aplica junto a --sources (el modo posicional de compat lo ignora por diseño).
    proj_id = argv[argv.index("--proj-id") + 1] if "--proj-id" in argv and "--sources" in argv else sources[0]
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
    multi = len(sources) > 1 or bool(photos)
    for idx, src in enumerate(sources):
        prefix = f"s{idx}_" if multi else ""        # 1 sola fuente sin fotos → nombres f_XXXX intactos (compat)
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

    total = sum(1 for a in geotag_args if a == "-execute")   # un -execute por imagen geotaggeada
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
    # -common_args: -overwrite_original aplica a TODOS los -execute (no solo el primero)
    subprocess.run(["exiftool", "-@", str(argfile), "-common_args", "-overwrite_original"],
                   check=True, capture_output=True)
    for leak in images.glob("*.jpg_original"):
        leak.unlink()
    camera_override = argv[argv.index("--camera-profile") + 1] if "--camera-profile" in argv else None
    camera = select_camera_profile(detect_camera_models(images), camera_override)
    atomic_write_json(proj / "frames_manifest.json",
        {"profile": profile, "sources": per_source, "photos": n_photos,
         "total_frames": total, "width": width, "fps": fps, "camera_profile": camera},
        indent=1, ensure_ascii=True)
    if camera["args"]:
        print(f"cámara {camera['label']} ({camera['reason']}"
              f"{'' if camera['verified'] else ', perfil SIN verificar'}) → ODM {' '.join(camera['args'])}",
              flush=True)
    src_lbl = f"{len(sources)} video(s)" + (f" + {n_photos} foto(s)" if n_photos else "")
    print(f"✅ {total} frames geotagged de {src_lbl} → {proj}")


if __name__ == "__main__":
    main()
