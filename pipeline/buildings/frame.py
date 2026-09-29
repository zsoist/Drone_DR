"""Coordinate frames + raster IO for the W4 building pipeline.

Three frames, all metric, all right-handed except the game frame:

  odm    ODM local: x=E, y=N, z=elevation MSL, origin = coords.txt (UTM 18N absolute
         minus origin). geo.obj, cloud.ply and the LAZ live here.
  enu    the SAME axes, re-origined at the DSM centre:  enu_xy = odm_xy - dsm_center_odm.
  game   what web/flightverse uses: x=E, y=elevation - world.elev_min, z=-N,
         origin = DSM centre in x/z (scene_manifest.mesh_offset_game_frame,
         scene.js attach*VisualMesh).

`odm <-> game` is therefore  x_g = x_o - cx,  y_g = z_o - elev_min,  z_g = -(y_o - cy).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

M_PER_DEG_LAT = 111_320.0


@dataclass(frozen=True)
class Frame:
    origin_utm: tuple[float, float]      # ODM local origin (UTM 18N E, N)
    center_odm: tuple[float, float]      # DSM centre in ODM local metres (= game origin)
    elev_min: float                      # world.elev_min used by the web (game y = z - elev_min)
    dsm_shape: tuple[int, int]
    dsm_gt: tuple[float, ...]
    dsm_nodata: float
    # local ODM (E, N) -> DSM (px, py) affine, 3x2:  [E N 1] @ A = [px py]
    affine: tuple[tuple[float, float], ...]

    # --- odm <-> game -------------------------------------------------------
    def odm_to_game(self, xyz):
        a = np.asarray(xyz, dtype=np.float64)
        out = np.empty_like(a)
        out[..., 0] = a[..., 0] - self.center_odm[0]
        out[..., 1] = a[..., 2] - self.elev_min
        out[..., 2] = -(a[..., 1] - self.center_odm[1])
        return out

    def game_to_odm(self, xyz):
        a = np.asarray(xyz, dtype=np.float64)
        out = np.empty_like(a)
        out[..., 0] = a[..., 0] + self.center_odm[0]
        out[..., 1] = -a[..., 2] + self.center_odm[1]
        out[..., 2] = a[..., 1] + self.elev_min
        return out

    # --- odm <-> lon/lat (through the DSM geotransform: exact for the DSM) ----
    def odm_to_lonlat(self, e, n):
        px, py = self.odm_to_px(np.asarray(e, float), np.asarray(n, float))
        gt = self.dsm_gt
        return gt[0] + gt[1] * px, gt[3] + gt[5] * py

    def odm_to_px(self, e, n):
        a = np.asarray(self.affine)
        return e * a[0, 0] + n * a[1, 0] + a[2, 0], e * a[0, 1] + n * a[1, 1] + a[2, 1]


def load_frame(vault: Path, cid: str) -> Frame:
    """Build the frame from meta.json + dsm_lod.json + ODM coords.txt (all in the vault)."""
    import sys
    pipe = str(Path(__file__).resolve().parent.parent)
    if pipe not in sys.path:
        sys.path.insert(0, pipe)
    import scene_aoi                                  # noqa: WPS433 (lazy on purpose)

    mdir = Path(vault) / "models" / cid
    meta = json.loads((mdir / "meta.json").read_text())
    lod = json.loads((mdir / "dsm_lod.json").read_text())
    origin = scene_aoi.parse_odm_coords_origin(
        Path(vault) / "odm" / f"proj_{cid}" / "odm_georeferencing" / "coords.txt")
    h, w = meta["dsm_shape"]
    gt = meta["dsm_gt"]
    ce, cn = scene_aoi.utm18_from_wgs84(lod["center_wgs84"][1], lod["center_wgs84"][0])
    # affine from the 4 DSM corners + centre projected to UTM (linear to <1 mm over 260 m)
    src, dst = [], []
    for px, py in ((0, 0), (w, 0), (0, h), (w, h), (w / 2, h / 2)):
        e, n = scene_aoi.utm18_from_wgs84(gt[3] + gt[5] * py, gt[0] + gt[1] * px)
        src.append([e - origin[0], n - origin[1], 1.0]); dst.append([px, py])
    coef, *_ = np.linalg.lstsq(np.array(src), np.array(dst), rcond=None)
    return Frame(origin_utm=(float(origin[0]), float(origin[1])),
                 center_odm=(float(ce - origin[0]), float(cn - origin[1])),
                 elev_min=float(lod["elev_min"]),
                 dsm_shape=(h, w), dsm_gt=tuple(gt), dsm_nodata=float(meta.get("dsm_nodata", -9999)),
                 affine=tuple(tuple(float(v) for v in row) for row in coef))


@dataclass
class Grid:
    """North-up raster in ENU (x=E, y=N) metres about the DSM centre.  z[row, col];
    row 0 = north.  Cell (r, c) centre = (x0 + (c+.5)*res, y0 - (r+.5)*res)."""
    z: np.ndarray
    res: float
    x0: float
    y0: float

    def xy(self):
        r, c = self.z.shape
        xs = self.x0 + (np.arange(c) + 0.5) * self.res
        ys = self.y0 - (np.arange(r) + 0.5) * self.res
        return np.meshgrid(xs, ys)

    def rc(self, x, y):
        return (self.y0 - np.asarray(y)) / self.res - 0.5, (np.asarray(x) - self.x0) / self.res - 0.5

    def sample(self, x, y, order=1):
        from scipy import ndimage as ndi
        r, c = self.rc(x, y)
        z = np.where(np.isfinite(self.z), self.z, np.nan)
        return ndi.map_coordinates(z, [r, c], order=order, mode="nearest", cval=np.nan)


def dsm_to_grid(frame: Frame, dsm_path: Path, res: float = 0.25, half: float = 135.0) -> Grid:
    """Resample dsm.bin (float32, 4-cm WGS84 pixels) into an ENU grid at `res` m.

    Each cell takes the MEDIAN of the (res/0.04)^2 source pixels it covers, so the
    grid keeps sharp roof edges but ignores single-pixel spikes. Nodata -> NaN."""
    h, w = frame.dsm_shape
    dsm = np.memmap(dsm_path, dtype=np.float32, mode="r", shape=(h, w))
    n = int(round(2 * half / res))
    x0, y0 = frame.center_odm[0] - half, frame.center_odm[1] + half   # ODM coords of grid NW
    # Work in ODM coords for sampling, then report grid in ENU (centre-origin)
    xs = x0 + (np.arange(n) + 0.5) * res
    ys = y0 - (np.arange(n) + 0.5) * res
    E, N = np.meshgrid(xs, ys)
    px, py = frame.odm_to_px(E, N)
    px_step = frame.affine[0][0] * res          # source px per cell (x)
    k = max(1, int(round(abs(px_step))))
    ix = np.round(px - 0.5).astype(int)
    iy = np.round(py - 0.5).astype(int)
    off = np.arange(k) - (k - 1) // 2
    stack = []
    for dy in off:
        for dx in off:
            jy = np.clip(iy + dy, 0, h - 1); jx = np.clip(ix + dx, 0, w - 1)
            v = np.asarray(dsm[jy, jx], dtype=np.float32)
            v[(v <= frame.dsm_nodata + 1) | ~np.isfinite(v)] = np.nan
            stack.append(v)
    stack = np.stack(stack)
    with np.errstate(all="ignore"):
        z = np.nanmedian(stack, axis=0)
    outside = (px < 0) | (py < 0) | (px >= w) | (py >= h)
    z[outside] = np.nan
    return Grid(z.astype(np.float32), res, -half, half)


def ortho_to_grid(frame: Frame, meta: dict, ortho_path: Path, grid: Grid) -> np.ndarray:
    """Sample the ortho (RGB uint8) at the centre of every `grid` cell -> (h, w, 3) uint8.

    The ortho spans meta['corners'] (lon/lat, TL,TR,BR,BL); over 260 m it is linear in
    lon/lat, so a bilinear-in-lonlat lookup is exact enough (< 5 cm)."""
    from PIL import Image
    from scipy import ndimage as ndi
    Image.MAX_IMAGE_PIXELS = None
    im = np.asarray(Image.open(ortho_path).convert("RGB"))
    H, W = im.shape[:2]
    c = meta["corners"]
    lon0, lat0 = c[0]; lon1, lat1 = c[2]
    xs, ys = grid.xy()
    lon, lat = frame.odm_to_lonlat(xs + frame.center_odm[0], ys + frame.center_odm[1])
    u = (lon - lon0) / (lon1 - lon0) * W - 0.5
    v = (lat - lat0) / (lat1 - lat0) * H - 0.5
    out = np.stack([ndi.map_coordinates(im[..., k].astype(np.float32), [v, u], order=1, mode="nearest")
                    for k in range(3)], -1)
    return out.astype(np.uint8)
