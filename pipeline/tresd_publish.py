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

    # 1) ortofoto: previews + corners WGS84
    print("ortofoto…")
    info = sh_in_odm(proj, r"""python3 - << 'EOF'
import json
from osgeo import gdal, osr
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
print(json.dumps({"corners": corners, "size": [w, h]}))
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
                               (".web_cloud.ply", "cloud.ply")]:
        p = proj / src_name
        if p.exists():
            p.replace(out / dst_name)

    # 3) mesh texturizado → carpeta web (obj + mtl + texturas)
    print("modelo texturizado…")
    tex = proj / "odm_texturing"
    for f in tex.glob("odm_textured_model_geo*"):
        (out / "model" / f.name).write_bytes(f.read_bytes())
    for f in [*tex.glob("*.jpg"), *tex.glob("*.png")]:
        (out / "model" / f.name).write_bytes(f.read_bytes())
    # el .mtl referencia texturas por nombre relativo — ya quedan al lado

    meta = {
        "clip_id": cid,
        "corners": ometa["corners"],
        "ortho_px": ometa["size"],
        "cloud_bytes": (out / "cloud.ply").stat().st_size if (out / "cloud.ply").exists() else 0,
        "model_obj": "model/odm_textured_model_geo.obj",
        "textures": len([*(out / "model").glob("*.jpg"), *(out / "model").glob("*.png")]),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"✅ publicado → {out} · nube {meta['cloud_bytes'] / 1e6:.0f}MB · {meta['textures']} texturas")


if __name__ == "__main__":
    main()
