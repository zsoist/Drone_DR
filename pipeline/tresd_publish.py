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
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
DOCKER = "/usr/local/bin/docker"


def sh_in_odm(proj: Path, script: str) -> str:
    r = subprocess.run([DOCKER, "run", "--rm", "-v", f"{proj}:/d",
                        "--entrypoint", "bash", "opendronemap/odm", "-c", script],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])
    return r.stdout


def main():
    cid = sys.argv[1]
    proj = Path(sys.argv[2]) if len(sys.argv) > 2 else VAULT / "odm" / "proj0104"
    out = VAULT / "models" / cid
    (out / "model").mkdir(parents=True, exist_ok=True)

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
    valid = ndimage.binary_erosion(a > 128, iterations=3, border_value=0)
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

    # 2) nube de puntos → PLY submuestreado para el browser (pdal vive en SuperBuild)
    print("nube de puntos…")
    sh_in_odm(proj, """set -e; P=/code/SuperBuild/install/bin/pdal; export LD_LIBRARY_PATH=/code/SuperBuild/install/lib;
      N=$($P info --summary /d/odm_georeferencing/odm_georeferenced_model.laz 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['summary']['num_points'])");
      STEP=$(( (N + 799999) / 800000 )); [ $STEP -lt 1 ] && STEP=1;
      echo "puntos: $N → step $STEP";
      $P translate /d/odm_georeferencing/odm_georeferenced_model.laz /d/.web_cloud.ply \
        -f filters.decimation --filters.decimation.step=$STEP""")

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
    valid = ndimage.binary_erosion(a > 128, iterations=3, border_value=0)
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
    print("modelo texturizado…")
    tex = proj / "odm_texturing"
    for f in tex.glob("odm_textured_model_geo*"):
        (out / "model" / f.name).write_bytes(f.read_bytes())
    for f in [*tex.glob("*.jpg"), *tex.glob("*.png")]:
        (out / "model" / f.name).write_bytes(f.read_bytes())
    # el .mtl referencia texturas por nombre relativo — ya quedan al lado

    # QA de la reconstrucción (estilo Pix4D/DroneDeploy report)
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
            "cameras_reconstructed": rs.get("reconstructed_shots_count"),
            "cameras_total": rs.get("initial_shots_count"),
            "reprojection_error_px": round(rs.get("reprojection_error_pixels", 0), 2),
            "sparse_points": rs.get("reconstructed_points_count"),
            "area_m2": round(area, 1),
            "gsd_cm_px": gsd_cm,
        }

    # sidecars .gz: el server los sirve con Content-Encoding gzip — la malla OBJ
    # (texto) baja ~70% y la nube PLY ~30%; el browser descomprime transparente
    import gzip as _gzip
    for gf in [out / "cloud.ply", out / "model" / "odm_textured_model_geo.obj",
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
        "ortho_bytes": (out / "ortho.webp").stat().st_size if (out / "ortho.webp").exists() else 0,
        "qa": qa,
        "cloud_bytes": (out / "cloud.ply").stat().st_size if (out / "cloud.ply").exists() else 0,
        "model_obj": "model/odm_textured_model_geo.obj",
        "textures": len([*(out / "model").glob("*.jpg"), *(out / "model").glob("*.png")]),
        **dsm_meta,
        "has_dsm": (out / "dsm_4326.tif").exists(),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"✅ publicado → {out} · nube {meta['cloud_bytes'] / 1e6:.0f}MB · {meta['textures']} texturas")


if __name__ == "__main__":
    main()
