"""Publica los productos ODM de un proyecto como assets web en vault/models/<cid>/.

Outputs:
  ortho.jpg          preview 2K de la ortofoto (GDAL — ffmpeg lee los GeoTIFF negro)
  ortho_full.jpg     versión 5K para zoom
  meta.json          corners WGS84 de la ortofoto (para overlay en MapLibre) + stats
  cloud.ply          nube de puntos submuestreada (~600k pts) para three.js
  model/             mesh texturizado (obj + mtl + texturas) para three.js

Todo lo pesado corre DENTRO del contenedor ODM (GDAL/PDAL viven ahí).

Usage: python3 tresd_publish.py <clip_id> [<proj_dir>]
"""
import json
import re
import os
import shutil
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
DOCKER = "/usr/local/bin/docker"


def wgs84_area_m2(corners):
    """Área aproximada de una huella WGS84 chica, suficiente para QA/GSD UI."""
    if not corners or len(corners) < 3:
        return 0.0
    import math
    lat0 = sum(float(p[1]) for p in corners) / len(corners)
    pts = []
    for lon, lat in corners:
        x = float(lon) * 111320 * math.cos(math.radians(lat0))
        y = float(lat) * 110540
        pts.append((x, y))
    area = 0.0
    for i, (x1, y1) in enumerate(pts):
        x2, y2 = pts[(i + 1) % len(pts)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def sh_in_odm(proj: Path, script: str) -> str:
    # contenedor CON NOMBRE determinista: si cancelan el job, matar la CLI de docker NO mata
    # el contenedor; con nombre, el siguiente run lo barre (rm -f) en vez de dejar un huérfano
    # GDAL/PDAL quemando CPU hasta 30 min. (mismo patrón que fast-ortho/run_odm_container)
    name = f"publish-{proj.name}"
    subprocess.run([DOCKER, "rm", "-f", name], capture_output=True, timeout=30)
    r = subprocess.run([DOCKER, "run", "--rm", "--name", name, "-v", f"{proj}:/d",
                        "--entrypoint", "bash", "opendronemap/odm", "-c", script],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])
    return r.stdout


def make_viewer_mesh(geo, dst):
    n = 0
    sx = sy = sz = 0.0
    with open(geo) as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                sx += float(p[1]); sy += float(p[2]); sz += float(p[3])
                n += 1
    if not n:
        return None
    cx, cy, cz = sx / n, sy / n, sz / n
    with open(geo) as f, open(dst, "w") as o:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                rest = (" " + " ".join(p[4:])) if len(p) > 4 else ""
                o.write(f"v {float(p[1]) - cx:.3f} {float(p[2]) - cy:.3f} {float(p[3]) - cz:.3f}{rest}\n")
            else:
                o.write(line)
    return [round(cx, 4), round(cy, 4), round(cz, 4)]


def obj_stats(path: Path) -> dict:
    stats = {"vertices": 0, "faces": 0}
    if not path.exists():
        return stats
    with open(path, errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                stats["vertices"] += 1
            elif line.startswith("f "):
                stats["faces"] += 1
    return stats


# tiers de textura del VISOR con presupuesto de memoria GPU. Cada página se sube
# DESCOMPRIMIDA (lado²×4 bytes) sin importar el peso del JPEG, así que N páginas de
# 4096² = GBs: Chrome desktop aguanta, Safari/iPhone las evicta EN SILENCIO → parches
# negros ("malla destrozada"). Dos calidades para que el visor elija/cambie:
#   bajo (vtl_): 1024px, ~256MB techo — móvil/rápido
#   alto (vth_): 2048px, ~1024MB techo — desktop/HD
# El detalle fino real vive en la ortofoto 5K y en el OBJ 4096 de descarga.
# El M4 (10-core GPU, Metal 4, 16GB unificada) aguanta desktop tiers grandes; el techo
# lo pone Safari/iPhone (evicta >~1GB). Por eso extra/ultra los sirve el visor SOLO en
# desktop. "ultra" no se regenera: usa el geo.mtl 4096 original (ya publicado).
VIEWER_TIERS = {
    "bajo":  {"prefix": "vtl_", "mtl": "odm_textured_model_viewer_low.mtl",   "cap": 1024, "budget_mb": 256},
    "alto":  {"prefix": "vth_", "mtl": "odm_textured_model_viewer.mtl",       "cap": 2048, "budget_mb": 1024},
    "extra": {"prefix": "vtx_", "mtl": "odm_textured_model_viewer_extra.mtl", "cap": 3072, "budget_mb": 2560},
}


def _budget_side(n_pages: int, cap: int, budget_mb: int) -> int:
    side = cap
    while n_pages and n_pages * side * side * 4 > budget_mb * 1024 * 1024 and side > 512:
        side -= 512
    return side


def make_viewer_textures(model_dir: Path) -> dict:
    """Genera los sets de textura del visor (bajo/alto/extra) + sus .mtl. Idempotente.

    Decodifica cada página fuente UNA sola vez (no una por tier: eran N×3 decodes de 4096²)
    y reescala en memoria a cada tier de mayor a menor — cada reescalado parte del anterior,
    más pequeño = más rápido que reabrir el 4096 original tres veces.
    """
    from PIL import Image
    mtl = model_dir / "odm_textured_model_geo.mtl"
    if not mtl.exists():
        return {}
    lines = mtl.read_text().splitlines()
    pages = [ln.split()[1] for ln in lines if ln.strip().startswith("map_Kd")]
    if not pages:
        return {}
    # lados por tier, ordenados de mayor a menor (reescalado en cascada)
    tiers = sorted(VIEWER_TIERS.items(), key=lambda kv: -kv[1]["cap"])
    sides = {t: _budget_side(len(pages), cfg["cap"], cfg["budget_mb"]) for t, cfg in tiers}
    for ln in lines:
        if not ln.strip().startswith("map_Kd"):
            continue
        src = model_dir / ln.split()[1]
        if not src.exists():
            continue
        im = Image.open(src).convert("RGB")      # UNA decodificación por página
        for tier, cfg in tiers:
            side = sides[tier]
            if max(im.size) > side:              # reescala desde el estado actual (cascada)
                r = side / max(im.size)
                im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
            im.save(model_dir / f"{cfg['prefix']}{Path(src.name).stem}.jpg", quality=82, optimize=True)
    # .mtl por tier (apunta a las páginas reescaladas)
    out = {}
    for tier, cfg in tiers:
        out_lines = [ln.replace(ln.split()[1], f"{cfg['prefix']}{Path(ln.split()[1]).stem}.jpg")
                     if ln.strip().startswith("map_Kd") else ln for ln in lines]
        (model_dir / cfg["mtl"]).write_text("\n".join(out_lines) + "\n")
        out[tier] = {"mtl": cfg["mtl"], "side": sides[tier], "pages": len(pages),
                     "gpu_mb": round(len(pages) * sides[tier] * sides[tier] * 4 / 1048576)}
    return out


def ply_vertex_count(path: Path) -> int | None:
    if not path.exists():
        return None
    with open(path, "rb") as f:
        for raw in f:
            line = raw.decode("ascii", "ignore").strip()
            if line.startswith("element vertex "):
                return int(line.split()[-1])
            if line == "end_header":
                break
    return None


def find_copc_asset(proj: Path) -> Path | None:
    """Find an ODM COPC output if --pc-copc was enabled for the run."""
    geo = proj / "odm_georeferencing"
    names = [
        "odm_georeferenced_model.copc.laz",
        "odm_georeferenced_model.copc.las",
        "odm_georeferenced_model_copc.laz",
    ]
    for name in names:
        p = geo / name
        if p.exists():
            return p
    found = sorted([*geo.glob("*.copc.laz"), *geo.glob("*.copc.las"), *geo.glob("*copc*.laz")])
    return found[0] if found else None


def find_texture_dir(proj: Path) -> tuple[Path | None, str]:
    """Prefer full ODM texturing; fall back to fast-orthophoto/25D texturing.

    OpenMVS densification can fail on otherwise valid video reconstructions. ODM's
    fast-orthophoto path still emits odm_texturing_25d plus a georeferenced ortho,
    which is useful and should publish as an honest fallback instead of leaving
    the job as a dead error.
    """
    full = proj / "odm_texturing"
    fast = proj / "odm_texturing_25d"
    if (full / "odm_textured_model_geo.obj").exists():
        return full, "full_3d"
    if (fast / "odm_textured_model_geo.obj").exists():
        return fast, "ortho_25d_fallback"
    return None, "no_mesh"


def main():
    cid = sys.argv[1]
    proj = Path(sys.argv[2]) if len(sys.argv) > 2 else VAULT / "odm" / "proj0104"
    out = VAULT / "models" / cid
    (out / "model").mkdir(parents=True, exist_ok=True)
    prior_meta = {}
    if (out / "meta.json").exists():
        try:
            prior_meta = json.loads((out / "meta.json").read_text())
        except (OSError, ValueError):
            prior_meta = {}

    # 1) ortofoto: previews + corners WGS84 + alpha con feather (borde fundido)
    print("ortofoto…")
    info = sh_in_odm(proj, r"""python3 - << 'EOF'
import json
import numpy as np
from osgeo import gdal, osr
from scipy import ndimage
from PIL import Image
FEATHER = 36  # px de fundido en el borde del PNG de 2000px

def feather_png(path, px=FEATHER):
    # erosiona 3px (mata el halo oscuro de interpolacion del borde) y luego
    # funde hacia adentro con la distancia al nodata: el overlay se disuelve
    # en el satelite en vez de cortarse como una losa pegada.
    # Nota: PIL en vez de gdal ReadAsArray — el gdal_array del contenedor no
    # carga con numpy 2.x, pero el PNG ya esta escrito y PIL lo lee sin drama.
    im = Image.open(path).convert('RGBA')
    arr = np.array(im)
    a = arr[..., 3]
    if not (a < 255).any():                      # PNG sin nodata: alpha desde negro puro
        a = (~np.all(arr[..., :3] == 0, axis=-1)).astype(np.uint8) * 255
    valid = ndimage.binary_erosion(a > 128, iterations=9, border_value=0)
    dist = ndimage.distance_transform_edt(valid)
    arr[..., 3] = np.minimum(a, np.clip(dist / px, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(arr).save(path)
    Image.fromarray(arr).save(path[:-4] + '.webp', quality=82, method=4)  # movil
    return arr[..., 3]

ds = gdal.Open('/d/odm_orthophoto/odm_orthophoto.tif')
gt = ds.GetGeoTransform()
w, h = ds.RasterXSize, ds.RasterYSize
src = osr.SpatialReference(); src.ImportFromWkt(ds.GetProjection())
dst = osr.SpatialReference(); dst.ImportFromEPSG(4326)
dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tr = osr.CoordinateTransformation(src, dst)
def px(x, y):
    X = gt[0] + x * gt[1] + y * gt[2]; Y = gt[3] + x * gt[4] + y * gt[5]
    lon, lat, _ = tr.TransformPoint(X, Y)
    return [lon, lat]
corners = [px(0, 0), px(w, 0), px(w, h), px(0, h)]  # TL TR BR BL
gdal.Translate('/d/.web_ortho.jpg', ds, format='JPEG', bandList=[1, 2, 3], width=2000)
gdal.Translate('/d/.web_ortho_full.jpg', ds, format='JPEG', bandList=[1, 2, 3], width=5000)
gdal.Translate('/d/.web_ortho.png', ds, format='PNG', width=2000)
feather_png('/d/.web_ortho.png')
print(json.dumps({"corners": corners, "size": [w, h], "feather_px": FEATHER}))
EOF""")
    ometa = json.loads(info.strip().splitlines()[-1])

    # 1b) tiles XYZ a resolución NATIVA (el overlay 2000px es solo la vista lejana):
    # gdal2tiles webmercator; maplibre los funde por zoom. Best-effort: sin tiles
    # el mapa sigue con el overlay — jamás tumbar un publish por la capa de lujo.
    print("tiles ortho…")
    tiles_meta = {}
    try:
        sh_in_odm(proj, "rm -rf /d/.web_tiles && python3 -m osgeo_utils.gdal2tiles "
                        "--xyz -w none --processes 8 -r bilinear "
                        "/d/odm_orthophoto/odm_orthophoto.tif /d/.web_tiles >/dev/null 2>&1 "
                        "&& ls /d/.web_tiles")
        zooms = sorted(int(z.name) for z in (proj / ".web_tiles").iterdir()
                       if z.name.isdigit())
        if zooms:
            dest = out / "tiles"
            if dest.exists():
                shutil.rmtree(dest)
            shutil.move(str(proj / ".web_tiles"), dest)
            tiles_meta = {"tiles": True, "tiles_minzoom": zooms[0], "tiles_maxzoom": zooms[-1]}
    except (RuntimeError, OSError) as e:
        print(f"  tiles omitidos: {str(e)[:120]}")

    # 2) nube de puntos → PLY submuestreado para el browser (pdal vive en SuperBuild)
    print("nube de puntos…")
    cloud_info = sh_in_odm(proj, """set -e; P=/code/SuperBuild/install/bin/pdal; export LD_LIBRARY_PATH=/code/SuperBuild/install/lib;
      N=$($P info --summary /d/odm_georeferencing/odm_georeferenced_model.laz 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['summary']['num_points'])");
      STEP=$(( (N + 799999) / 800000 )); [ $STEP -lt 1 ] && STEP=1;
      echo "puntos: $N → step $STEP";
      $P translate /d/odm_georeferencing/odm_georeferenced_model.laz /d/.web_cloud.ply \
        -f filters.decimation --filters.decimation.step=$STEP""")
    cm = re.search(r"puntos:\s*(\d+)\s*.*step\s*(\d+)", cloud_info)
    source_points = int(cm.group(1)) if cm else None
    decimation_step = int(cm.group(2)) if cm else None
    copc_src = find_copc_asset(proj)
    copc_asset = None
    if copc_src:
        copc_asset = "cloud.copc.laz"
        shutil.copy2(copc_src, out / copc_asset)

    for src_name, dst_name in [(".web_ortho.jpg", "ortho.jpg"), (".web_ortho_full.jpg", "ortho_full.jpg"),
                               (".web_ortho.png", "ortho.png"),
                               (".web_ortho.webp", "ortho.webp"),
                               (".web_cloud.ply", "cloud.ply")]:
        p = proj / src_name
        if p.exists():
            p.replace(out / dst_name)

    # 2.5) DSM → relieve coloreado + hillshade + curvas de nivel (si existe)
    dsm_meta = {}
    if (proj / "odm_dem" / "dsm.tif").exists():
        print("elevación (DSM + curvas)…")
        out_dem = sh_in_odm(proj, r"""python3 - << 'EOF'
import json
import numpy as np
from osgeo import gdal, ogr, osr
from scipy import ndimage
from PIL import Image
FEATHER = 36

def feather_png(path, px=FEATHER):
    im = Image.open(path).convert('RGBA')
    arr = np.array(im)
    a = arr[..., 3]
    valid = ndimage.binary_erosion(a > 128, iterations=9, border_value=0)
    dist = ndimage.distance_transform_edt(valid)
    arr[..., 3] = np.minimum(a, np.clip(dist / px, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(arr).save(path)
    Image.fromarray(arr).save(path[:-4] + '.webp', quality=82, method=4)  # movil
    return arr[..., 3]

# todo desde el DSM ya warpeado a WGS84: overlays y esquinas quedan alineados
gdal.Warp('/d/.web_dsm_4326.tif', '/d/odm_dem/dsm.tif', dstSRS='EPSG:4326')
dsm = gdal.Open('/d/.web_dsm_4326.tif')
b = dsm.GetRasterBand(1)
lo, hi = b.ComputeStatistics(True)[:2]
ramp = f"{lo} 38 84 124\n{lo + (hi-lo)*0.35} 82 155 104\n{lo + (hi-lo)*0.65} 222 190 88\n{hi} 194 82 60\nnv 0 0 0 0\n"
open('/tmp/ramp.txt','w').write(ramp)
gdal.DEMProcessing('/d/.web_dsm_color.tif', dsm, 'color-relief', colorFilename='/tmp/ramp.txt', addAlpha=True)
gdal.DEMProcessing('/d/.web_hillshade.tif', dsm, 'hillshade', zFactor=1.3)
gdal.Translate('/d/.web_dsm_color.png', '/d/.web_dsm_color.tif', format='PNG', width=2000)
gdal.Translate('/d/.web_hillshade.png', '/d/.web_hillshade.tif', format='PNG', width=2000)
# color: feather sobre su propio alpha (el 'nv 0 0 0 0' de la rampa marca el nodata)
alpha = feather_png('/d/.web_dsm_color.png')
# hillshade: gris sin canal alpha — hereda el alpha ya fundido del color
# (misma grilla DSM, mismo width=2000 → dimensiones identicas)
hs = Image.open('/d/.web_hillshade.png').convert('RGBA')
ha = np.array(hs)
ha[..., 3] = alpha
Image.fromarray(ha).save('/d/.web_hillshade.png')
Image.fromarray(ha).save('/d/.web_hillshade.webp', quality=82, method=4)
gt = dsm.GetGeoTransform(); w, h = dsm.RasterXSize, dsm.RasterYSize
corners = [[gt[0], gt[3]], [gt[0] + w * gt[1], gt[3]],
           [gt[0] + w * gt[1], gt[3] + h * gt[5]], [gt[0], gt[3] + h * gt[5]]]
# ortofoto warpeada EXACTAMENTE a la grilla del DSM: par pixel-perfect para el
# comparador foto <-> elevacion del share (misma huella, mismo alpha fundido)
oc = gdal.Warp('', '/d/odm_orthophoto/odm_orthophoto.tif', format='MEM', dstSRS='EPSG:4326',
               outputBounds=(gt[0], gt[3] + h * gt[5], gt[0] + w * gt[1], gt[3]),
               width=alpha.shape[1], height=alpha.shape[0])
gdal.Translate('/d/.web_ortho_cmp.png', oc, format='PNG')
ci = Image.open('/d/.web_ortho_cmp.png').convert('RGBA')
ca = np.array(ci)
ca[..., 3] = alpha
Image.fromarray(ca).save('/d/.web_ortho_cmp.webp', quality=82, method=4)
# DSM como binario plano float32: el host lo lee con numpy sin GDAL (mediciones rápidas)
gdal.Translate('/d/.web_dsm.envi', dsm, format='ENVI', outputType=gdal.GDT_Float32)
interval = 5 if (hi - lo) > 25 else 2 if (hi - lo) > 12 else 1
contour_w = min(450, dsm.RasterXSize)
gdal.Translate('/d/.web_dsm_contours.tif', dsm, format='GTiff', width=contour_w, resampleAlg='bilinear')
contour_ds = gdal.Open('/d/.web_dsm_contours.tif')
ds_out = ogr.GetDriverByName('GeoJSON').CreateDataSource('/d/.web_contours.geojson')
srs = osr.SpatialReference(); srs.ImportFromEPSG(4326)
lyr = ds_out.CreateLayer('contours', srs)
lyr.CreateField(ogr.FieldDefn('elev', ogr.OFTReal))
gdal.ContourGenerate(contour_ds.GetRasterBand(1), interval, 0, [], 0, 0, lyr, -1, 0)
ds_out = None
print(json.dumps({"dsm_min": round(lo, 1), "dsm_max": round(hi, 1),
                  "contour_interval": interval, "dsm_corners": corners,
                  "contour_max_width": contour_w,
                  "dsm_shape": [h, w], "dsm_gt": list(gt),
                  "dsm_nodata": dsm.GetRasterBand(1).GetNoDataValue()}))
EOF""")
        dsm_meta = json.loads(out_dem.strip().splitlines()[-1])
        for src_name, dst_name in [(".web_dsm_color.png", "dsm_color.png"),
                                   (".web_dsm_color.webp", "dsm_color.webp"),
                                   (".web_hillshade.png", "hillshade.png"),
                                   (".web_hillshade.webp", "hillshade.webp"),
                                   (".web_ortho_cmp.webp", "ortho_cmp.webp"),
                                   (".web_dsm.envi", "dsm.bin"),
                                   (".web_contours.geojson", "contours.geojson")]:
            p = proj / src_name
            if p.exists():
                p.replace(out / dst_name)
        # copia el DSM warpeado a 4326: es la base de mediciones de volumen/perfil
        if (proj / ".web_dsm_4326.tif").exists():
            (proj / ".web_dsm_4326.tif").replace(out / "dsm_4326.tif")

    # 3) mesh texturizado → carpeta web (obj + mtl + texturas)
    # limpiar primero: un re-publish (p.ej. estandar→alta) puede producir MENOS
    # materiales — sin wipe, las texturas del run viejo quedan huérfanas mezcladas
    print("modelo texturizado…")
    shutil.rmtree(out / "model", ignore_errors=True)
    (out / "model").mkdir(parents=True, exist_ok=True)
    tex, pipeline_mode = find_texture_dir(proj)
    if tex is not None:
        for f in tex.glob("odm_textured_model_geo*"):
            (out / "model" / f.name).write_bytes(f.read_bytes())
        for f in [*tex.glob("*.jpg"), *tex.glob("*.png")]:
            (out / "model" / f.name).write_bytes(f.read_bytes())
    # el .mtl referencia texturas por nombre relativo — ya quedan al lado
    # viewer mesh: vertices re-centrados al origen. El OBJ georeferenciado vive en
    # coordenadas UTM (~cientos de miles) y three.js parsea a float32 → artefactos
    # de precision. GIS/descarga usan el geo; el visor usa este.
    geo_obj = out / "model" / "odm_textured_model_geo.obj"
    mesh_offset = None
    if geo_obj.exists():
        mesh_offset = make_viewer_mesh(geo_obj, out / "model" / "odm_textured_model_viewer.obj")
    make_viewer_textures(out / "model")
    mesh_stats = obj_stats(geo_obj)
    mesh_ok = mesh_stats["vertices"] >= 100 and mesh_stats["faces"] >= 50

    # QA de la reconstrucción (estilo Pix4D/DroneDeploy report).
    # GATE del audit: un modelo NUNCA se publica con qa vacio — si stats.json
    # falta, cae a metricas parciales de reconstruction.json o marca "missing".
    qa = {}
    stats_f = proj / "opensfm" / "stats" / "stats.json"
    if stats_f.exists():
        st = json.loads(stats_f.read_text())
        rs = st.get("reconstruction_statistics", {})
        ps = st.get("processing_statistics", {})
        area = ps.get("area") or 0
        # resolución de la ortofoto en cm/px = sqrt(área / nº píxeles) * 100
        px_total = ometa["size"][0] * ometa["size"][1]
        gsd_cm = round((area / px_total) ** 0.5 * 100, 1) if px_total and area else None
        qa = {
            "status": "ok",
            "cameras_reconstructed": rs.get("reconstructed_shots_count"),
            "cameras_total": rs.get("initial_shots_count"),
            "reprojection_error_px": round(rs.get("reprojection_error_pixels", 0), 2),
            "sparse_points": rs.get("reconstructed_points_count"),
            "area_m2": round(area, 1),
            "gsd_cm_px": gsd_cm,
        }
    else:
        rec_f = proj / "opensfm" / "reconstruction.json"
        if rec_f.exists():
            try:
                rec = json.loads(rec_f.read_text())
                total = len([ln for ln in (proj / "opensfm" / "image_list.txt").read_text().splitlines() if ln.strip()]) \
                    if (proj / "opensfm" / "image_list.txt").exists() else None
                qa = {"status": "parcial",
                      "cameras_reconstructed": sum(len(r.get("shots", {})) for r in rec),
                      "cameras_total": total,
                      "sparse_points": sum(len(r.get("points", {})) for r in rec)}
            except (ValueError, OSError):
                qa = {"status": "missing"}
        else:
            qa = {"status": "missing"}

    if not qa.get("area_m2"):
        area = wgs84_area_m2(ometa.get("corners"))
        px_total = ometa["size"][0] * ometa["size"][1]
        if area and px_total:
            qa["area_m2"] = round(area, 1)
            qa["gsd_cm_px"] = round((area / px_total) ** 0.5 * 100, 1)
            qa.setdefault("status", "parcial")
    if pipeline_mode == "ortho_25d_fallback":
        qa["status"] = "ortho_25d"
        qa["note"] = (
            "Publicado con malla 25D de ODM: conserva ortofoto, DSM/DTM y nube; "
            "la malla full 3D queda como producto secundario para vuelos nadir."
        )
    if pipeline_mode == "no_mesh":
        qa["status"] = qa.get("status") if qa.get("status") not in (None, "ok") else "parcial"
        qa["mesh_note"] = "Procesado sin malla texturizada completa; nube/DSM/ortho/splat son los productos principales."
    if not mesh_ok:
        qa["mesh_note"] = "ODM produjo una malla débil o vacía; usa nube de puntos / splat para inspección 3D."

    # sidecars .gz: el server los sirve con Content-Encoding gzip — la malla OBJ
    # (texto) baja ~70% y la nube PLY ~30%; el browser descomprime transparente
    import gzip as _gzip
    for gf in [out / "cloud.ply", out / "model" / "odm_textured_model_geo.obj",
               out / "model" / "odm_textured_model_viewer.obj",
               out / "model" / "odm_textured_model_geo.mtl"]:
        if gf.exists():
            with open(gf, "rb") as fi, _gzip.open(str(gf) + ".gz", "wb", compresslevel=6) as fo:
                while chunk := fi.read(1 << 20):
                    fo.write(chunk)

    meta = {
        "clip_id": cid,
        "corners": ometa["corners"],
        "cmp_asset": "ortho_cmp.webp" if (out / "ortho_cmp.webp").exists() else None,
        "ortho_px": ometa["size"],
        "ortho_asset": "ortho.webp" if (out / "ortho.webp").exists() else "ortho.png",
        "dsm_asset": "dsm_color.webp" if (out / "dsm_color.webp").exists() else "dsm_color.png",
        "hills_asset": "hillshade.webp" if (out / "hillshade.webp").exists() else "hillshade.png",
        "ortho_feather_px": ometa.get("feather_px", 0),
        **tiles_meta,
        "ortho_bytes": (out / "ortho.webp").stat().st_size if (out / "ortho.webp").exists() else 0,
        "qa": qa,
        "pipeline_mode": pipeline_mode,
        "cloud_bytes": (out / "cloud.ply").stat().st_size if (out / "cloud.ply").exists() else 0,
        "cloud_points": ply_vertex_count(out / "cloud.ply"),
        "cloud_copc_asset": copc_asset,
        "cloud_copc_bytes": (out / copc_asset).stat().st_size if copc_asset and (out / copc_asset).exists() else 0,
        "model_obj": "model/odm_textured_model_geo.obj" if geo_obj.exists() else None,
        "mesh_ok": mesh_ok,
        "mesh_stats": mesh_stats,
        "model_viewer": "model/odm_textured_model_viewer.obj"
                        if mesh_ok and (out / "model" / "odm_textured_model_viewer.obj").exists()
                        else None,
        "mesh_offset": mesh_offset,
        "textures": len([*(out / "model").glob("*.jpg"), *(out / "model").glob("*.png")]),
        **dsm_meta,
        "has_dsm": (out / "dsm_4326.tif").exists(),
    }
    # Preserve operator-facing metadata across manual re-publish. The worker writes
    # these after publish, but agents often run tresd_publish.py directly while fixing
    # overlays/QA. Dropping the preset makes the UI/docs lie about which route built it.
    for k in ("preset", "preset_requested", "title", "dense_quality",
              "dense_quality_requested", "dense_fallback"):
        if k in prior_meta and k not in meta:
            meta[k] = prior_meta[k]
    # limpieza: temporales y basura de macOS no se publican
    for junk in [*out.rglob(".DS_Store"), *out.glob(".*.tif"), *out.glob("*.aux.xml")]:
        junk.unlink(missing_ok=True)
    _mtmp = out / "meta.json.tmp"; _mtmp.write_text(json.dumps(meta, indent=1))
    os.replace(_mtmp, out / "meta.json")   # atómico: un write parcial vaciaría el índice
    # el manifest NUNCA queda stale tras publicar (el audit encontró model_viewer
    # ausente del system.json porque el rebuild solo lo hacía el worker)
    subprocess.run(["python3", str(Path(__file__).parent / "build_index.py")], check=True)
    print(f"✅ publicado → {out} · nube {meta['cloud_bytes'] / 1e6:.0f}MB · {meta['textures']} texturas")


if __name__ == "__main__":
    main()
