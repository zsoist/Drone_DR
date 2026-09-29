"""Building footprints from a DSM (W4 step 1).

    DSM --(progressive morphological ground filter)--> DTM --> nDSM = DSM - DTM
        --(height > min_h, optional vegetation mask, opening)--> mask
        --(connected components)--> contours --(Douglas-Peucker + orthogonalise)--> polygons

Pure numpy/scipy/skimage/shapely: everything here is unit-tested on synthetic DSMs
(test_buildings_synth.py). Coordinates are metres in whatever ENU frame the Grid uses.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

from .frame import Grid


# ------------------------------------------------------------------ raster helpers
def fill_nan_nearest(z: np.ndarray) -> np.ndarray:
    bad = ~np.isfinite(z)
    if not bad.any():
        return z
    if bad.all():
        raise ValueError("raster has no valid cells")
    idx = ndi.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return z[tuple(idx)]


def block_percentile(z: np.ndarray, k: int, q: float) -> np.ndarray:
    """q-th percentile over k x k blocks (NaN aware); output shape ceil(h/k) x ceil(w/k)."""
    h, w = z.shape
    H, W = -(-h // k), -(-w // k)
    pad = np.full((H * k, W * k), np.nan, dtype=np.float32)
    pad[:h, :w] = z
    blocks = pad.reshape(H, k, W, k).transpose(0, 2, 1, 3).reshape(H, W, k * k)
    with np.errstate(all="ignore"):
        out = np.nanpercentile(blocks, q, axis=2)
    return out.astype(np.float32)


def _grey_open(z: np.ndarray, size: int) -> np.ndarray:
    return ndi.grey_dilation(ndi.grey_erosion(z, size=(size, size), mode="nearest"),
                             size=(size, size), mode="nearest")


# --------------------------------------------------------------------- ground / nDSM
def estimate_ground(z: np.ndarray, res: float, *, cell: float = 1.0, max_window_m: float = 80.0,
                    slope: float = 0.35, dh0: float = 0.4, dhmax: float = 4.0,
                    low_q: float = 5.0) -> np.ndarray:
    """Terrain estimate from a DSM by a Progressive Morphological Filter (Zhang 2003).

    Works on a `cell`-metre grid of low-percentile heights; windows grow 3,5,9,17,... cells
    up to `max_window_m` (must exceed the widest building). A cell is non-ground when the
    opening at window w removes more than dh(w) = slope*(w-w_prev)*cell + dh0 (<= dhmax),
    which protects steep hillsides. Result is bilinearly resampled to the DSM grid.
    NaN input is tolerated (nearest-filled for the filter, output has no NaN)."""
    k = max(1, int(round(cell / res)))
    coarse = block_percentile(z, k, low_q) if k > 1 else z.astype(np.float32).copy()
    coarse = fill_nan_nearest(coarse)
    cur = coarse.copy()
    ground = np.ones(coarse.shape, dtype=bool)
    prev_w = 1
    w = 3
    max_w = max(3, int(max_window_m / cell)) | 1
    while True:
        w = min(w, max_w)
        opened = _grey_open(cur, w)
        dh = min(dhmax, slope * (w - prev_w) * cell + dh0)
        ground &= (cur - opened) <= dh
        cur = opened
        if w >= max_w:
            break
        prev_w, w = w, 2 * w - 1
    # keep the opened surface (it already sits on the terrain); smooth the residual jaggies
    dtm = ndi.gaussian_filter(np.minimum(cur, coarse), 1.0, mode="nearest")
    dtm = np.minimum(dtm, coarse + dh0)
    h, w_ = z.shape
    if k == 1:
        return dtm.astype(np.float32)
    rr = (np.arange(h) + 0.5) / k - 0.5
    cc = (np.arange(w_) + 0.5) / k - 0.5
    R, C = np.meshgrid(rr, cc, indexing="ij")
    return ndi.map_coordinates(dtm, [R, C], order=1, mode="nearest").astype(np.float32)


def ndsm(z: np.ndarray, dtm: np.ndarray) -> np.ndarray:
    out = z.astype(np.float32) - dtm
    return out


# ----------------------------------------------------------------------- segmentation
def building_mask(n: np.ndarray, res: float, *, min_h: float = 2.5, veg: np.ndarray | None = None,
                  open_radius_m: float = 0.75, min_area_m2: float = 40.0,
                  close_radius_m: float = 0.5, fill_hole_m2: float = 25.0) -> np.ndarray:
    """Boolean building mask from nDSM (NaN = unknown = not building)."""
    m = np.nan_to_num(n, nan=0.0) > min_h
    if veg is not None:
        m &= ~veg
    r = max(1, int(round(open_radius_m / res)))
    st = _disk(r)
    m = ndi.binary_opening(m, structure=st)
    rc = max(1, int(round(close_radius_m / res)))
    m = ndi.binary_closing(m, structure=_disk(rc))
    # fill small holes (chimneys, DSM dropouts) but keep courtyards
    holes = ndi.binary_fill_holes(m) & ~m
    lab, k = ndi.label(holes)
    if k:
        sizes = ndi.sum(holes, lab, index=np.arange(1, k + 1))
        for i, s in enumerate(sizes, 1):
            if s * res * res < fill_hole_m2:
                m[lab == i] = True
    lab, k = ndi.label(m)
    if k:
        sizes = ndi.sum(m, lab, index=np.arange(1, k + 1))
        for i, s in enumerate(sizes, 1):
            if s * res * res < min_area_m2:
                m[lab == i] = False
    return m


def _disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


# ---------------------------------------------------------- step-edge segmentation
def smooth_regions(z: np.ndarray, res: float, *, max_slope: float = 1.6, smooth_px: int = 2):
    """Label connected regions of the DSM whose gradient stays below `max_slope` (m/m).

    Walls of photogrammetric buildings blur to a 1-2 px band with gradients >> 3, so every
    roof plane group, tree crown and stretch of terrain becomes its own region."""
    ok = np.isfinite(z)
    zf = fill_nan_nearest(z)
    zs = ndi.median_filter(zf, size=smooth_px * 2 + 1) if smooth_px else zf
    gy, gx = np.gradient(zs, res)
    g = np.hypot(gx, gy)
    smooth = (g < max_slope) & ok
    smooth = ndi.binary_erosion(smooth, structure=ndi.generate_binary_structure(2, 1))
    lab, k = ndi.label(smooth)               # 4-connected: no diagonal leaks through corners
    return lab, k, zs


def classify_regions(z: np.ndarray, lab: np.ndarray, k: int, res: float, *, min_h: float = 2.5,
                     min_area_m2: float = 30.0, ring_m: float = 2.0, min_step_frac: float = 0.55,
                     veg: np.ndarray | None = None, veg_frac: float = 0.45,
                     max_green_mad: float = 0.35, weak_step_frac: float = 0.2,
                     attach_m: float = 2.0):
    """Keep regions that stand `min_h` above what surrounds them (a building-like plateau).

    For each region, boundary pixels are compared with the lowest DSM value within ring_m
    OUTSIDE the region: drop = z_boundary - min_outside. A region is a building when
    >= min_step_frac of its (valid) boundary drops by >= min_h. Boundaries against nodata
    / the AOI edge carry no evidence and are ignored (region flagged `clipped`).
    Returns (mask, info per accepted label)."""
    ok = np.isfinite(z)
    zf = np.where(ok, z, np.inf)
    rp = max(1, int(round(ring_m / res)))
    foot = _disk(rp)
    st4 = ndi.generate_binary_structure(2, 1)
    accepted = np.zeros(lab.shape, dtype=bool)
    info: dict[int, dict] = {}
    weak: list = []
    objs = ndi.find_objects(lab)
    pad = rp + 3
    for i, sl in enumerate(objs, 1):
        if sl is None:
            continue
        r0 = max(0, sl[0].start - pad); r1 = min(lab.shape[0], sl[0].stop + pad)
        c0 = max(0, sl[1].start - pad); c1 = min(lab.shape[1], sl[1].stop + pad)
        sub = lab[r0:r1, c0:c1] == i
        area = sub.sum() * res * res
        if area < min_area_m2:
            continue
        zs = zf[r0:r1, c0:c1]
        outside = np.where(sub, np.inf, zs)
        lm = ndi.minimum_filter(outside, footprint=foot, mode="constant", cval=np.inf)
        bnd = sub & ~ndi.binary_erosion(sub, structure=st4)
        near_nodata = ndi.binary_dilation(~ok[r0:r1, c0:c1], structure=foot) & bnd
        valid = bnd & ~near_nodata & np.isfinite(lm)
        if valid.sum() < 8:
            continue
        drop = zs[valid] - lm[valid]
        frac = float((drop >= min_h).mean())
        rect = _rectangularity(sub, res)
        green = veg is not None and float(veg[r0:r1, c0:c1][sub].mean()) > veg_frac
        mad = _plane_mad(zs, sub, res) if green else 0.0
        # green + lumpy (plane MAD ~0.7 m) = tree crown; green + planar (~0.15 m) = green roof
        green_blob = green and (mad > max_green_mad or rect < 0.6)
        if green_blob:
            continue
        if frac < min_step_frac:
            if frac >= weak_step_frac and rect >= 0.6:
                weak.append((i, r0, r1, c0, c1, sub.copy(), frac, rect, float(area),
                             float(np.percentile(lm[valid], 20)), False))
            continue
        accepted[r0:r1, c0:c1] |= sub
        info[i] = {"area_m2": float(area), "step_frac": frac,
                   "ground_z": float(np.percentile(lm[valid], 20)),
                   "clipped": bool(near_nodata.sum() > 0.1 * bnd.sum()),
                   "rectangularity": rect}
    # pass 2: boxy regions with a partial step that abut an accepted building are annexes /
    # lower roof levels of the same building (green roof next to a terrace, stair core, ...)
    near = ndi.binary_dilation(accepted, structure=_disk(max(1, int(round(attach_m / res)))))
    for (i, r0, r1, c0, c1, sub, frac, rect, area, gz, _) in weak:
        if (near[r0:r1, c0:c1] & sub).sum() * res * res >= 4.0:
            accepted[r0:r1, c0:c1] |= sub
            info[i] = {"area_m2": area, "step_frac": frac, "ground_z": gz, "clipped": False,
                       "rectangularity": rect, "attached": True}
    return accepted, info


def _plane_mad(z: np.ndarray, sub: np.ndarray, res: float) -> float:
    """median |residual| of a least-squares plane through the region (m): roofs ~0.15, crowns ~0.7."""
    rr, cc = np.nonzero(sub)
    zz = z[rr, cc]
    ok = np.isfinite(zz) & np.isfinite(zz)
    if ok.sum() < 6:
        return 9.9
    A = np.c_[cc * res, rr * res, np.ones(len(cc))][ok]
    coef, *_ = np.linalg.lstsq(A, zz[ok], rcond=None)
    return float(np.median(np.abs(zz[ok] - A @ coef)))


def _rectangularity(sub: np.ndarray, res: float) -> float:
    """region area / area of its minimum rotated rectangle (1 = perfect rectangle)."""
    from shapely.geometry import MultiPoint
    rr, cc = np.nonzero(sub & ~ndi.binary_erosion(sub))
    if len(rr) < 4:
        return 0.0
    hull = MultiPoint(np.c_[cc, rr]).convex_hull
    if hull.geom_type != "Polygon" or hull.area < 1.0:
        return 0.0
    rect = hull.minimum_rotated_rectangle
    return float(min(1.0, sub.sum() / max(rect.area, 1.0)))


def exg_vegetation(rgb: np.ndarray, thr: float = 0.06) -> np.ndarray:
    """Excess-green vegetation mask from an RGB uint8 ortho (chromatic coordinates)."""
    c = rgb.astype(np.float32)
    s = c.sum(-1) + 1e-6
    r, g, b = c[..., 0] / s, c[..., 1] / s, c[..., 2] / s
    return (2 * g - r - b) > thr


# --------------------------------------------------------------------- vectorisation
def mask_to_polygon(mask: np.ndarray, grid: Grid) -> MultiPolygon | Polygon:
    """Pixel mask -> shapely polygon(s) in the grid's metric frame (contour at 0.5)."""
    from skimage import measure
    pad = np.pad(mask.astype(np.float32), 1)
    contours = measure.find_contours(pad, 0.5)
    polys = []
    for c in contours:
        if len(c) < 4:
            continue
        r = c[:, 0] - 1.0
        cc = c[:, 1] - 1.0
        x = grid.x0 + (cc + 0.5) * grid.res
        y = grid.y0 - (r + 0.5) * grid.res
        p = Polygon(np.c_[x, y])
        if not p.is_valid:
            p = p.buffer(0)
        if p.area > 0:
            polys.append(p)
    polys.sort(key=lambda p: -p.area)
    result: list = []
    for p in polys:
        depth = sum(1 for q in polys if q is not p and q.area > p.area and q.contains(p.representative_point()))
        result.append((depth, p))
    outer = unary_union([p for d, p in result if d % 2 == 0])
    holes = unary_union([p for d, p in result if d % 2 == 1]) if any(d % 2 for d, _ in result) else None
    return outer.difference(holes) if holes is not None else outer


def dominant_angle(poly: Polygon) -> float:
    """Length-weighted dominant edge direction (radians, mod 90 deg), from the boundary."""
    # pixel staircases would bias the angle toward 45 deg: use a DP-simplified ring and
    # only its long edges
    ring = LineString(poly.exterior.coords).simplify(0.6, preserve_topology=False)
    coords = np.asarray(ring.coords)
    d = np.diff(coords, axis=0)
    ang = np.arctan2(d[:, 1], d[:, 0])
    ln = np.hypot(d[:, 0], d[:, 1])
    ln = np.where(ln >= 3.0, ln, 0.0) if (ln >= 3.0).any() else ln
    # circular mean on the 4x-angle circle folds the 4 axis directions together
    z = np.sum(ln * np.exp(4j * ang))
    return float(np.angle(z) / 4.0)


def regularize(poly: Polygon, *, dp_tol: float = 0.35, snap_deg: float = 14.0,
               min_edge: float = 2.0, max_area_change: float = 0.15) -> Polygon:
    """Douglas-Peucker + orthogonalisation to the polygon's dominant axes.

    Rotate to the dominant frame, DP-simplify, classify each edge as H / V (within
    snap_deg) or oblique, merge consecutive same-axis edges, and rebuild vertices as the
    intersections of the fitted H/V lines (oblique edges keep their end points). If the
    result is degenerate or its area drifts > max_area_change, fall back to plain DP."""
    def one(ring_poly: Polygon) -> Polygon:
        theta = dominant_angle(ring_poly)
        c, s = math.cos(-theta), math.sin(-theta)
        rot = lambda x, y: (x * c - y * s, x * s + y * c)          # noqa: E731
        ci, si = math.cos(theta), math.sin(theta)
        unrot = lambda x, y: (x * ci - y * si, x * si + y * ci)    # noqa: E731

        def ring(coords):
            pts = np.asarray(coords)[:-1]
            r = np.array([rot(x, y) for x, y in pts])
            simp = LineString(np.vstack([r, r[:1]])).simplify(dp_tol, preserve_topology=False)
            q = np.asarray(simp.coords)[:-1]
            if len(q) < 3:
                q = r
            return _orthogonalize_ring(q, snap_deg, min_edge)

        ext = ring(ring_poly.exterior.coords)
        holes = [ring(h.coords) for h in ring_poly.interiors if Polygon(h).area > 4.0]
        f = lambda pts: [unrot(x, y) for x, y in pts]              # noqa: E731
        out = Polygon(f(ext), [f(h) for h in holes])
        return out if out.is_valid else out.buffer(0)

    if isinstance(poly, MultiPolygon):
        poly = max(poly.geoms, key=lambda p: p.area)
    reg = one(poly)
    if isinstance(reg, MultiPolygon):
        reg = max(reg.geoms, key=lambda p: p.area)
    if reg.is_empty or abs(reg.area - poly.area) / poly.area > max_area_change:
        reg = poly.simplify(dp_tol, preserve_topology=True)
    return reg


def _orthogonalize_ring(q: np.ndarray, snap_deg: float, min_edge: float) -> np.ndarray:
    n = len(q)
    if n < 4:
        return q
    kinds = []
    for i in range(n):
        a, b = q[i], q[(i + 1) % n]
        d = b - a
        ang = math.degrees(math.atan2(d[1], d[0])) % 180.0
        if min(ang, 180 - ang) <= snap_deg:
            kinds.append("H")
        elif abs(ang - 90) <= snap_deg:
            kinds.append("V")
        else:
            kinds.append("O")
    # drop very short edges first by merging kinds is unsafe; just group runs
    runs = []                                    # (kind, [edge indices])
    for i, k in enumerate(kinds):
        if runs and runs[-1][0] == k and k != "O":
            runs[-1][1].append(i)
        else:
            runs.append([k, [i]])
    if len(runs) > 1 and runs[0][0] == runs[-1][0] and runs[0][0] != "O":
        runs[0][1] = runs[-1][1] + runs[0][1]
        runs.pop()
    lines = []                                   # (kind, value|None, edge idx list)
    for k, idxs in runs:
        if k == "O":
            lines.append((k, None, idxs))
            continue
        pts = np.array([q[i] for i in idxs] + [q[(idxs[-1] + 1) % n]])
        wts = np.array([np.hypot(*(q[(i + 1) % n] - q[i])) for i in idxs])
        mid = np.array([(q[i] + q[(i + 1) % n]) / 2 for i in idxs])
        if k == "H":
            lines.append((k, float(np.average(mid[:, 1], weights=wts + 1e-9)), idxs))
        else:
            lines.append((k, float(np.average(mid[:, 0], weights=wts + 1e-9)), idxs))
    m = len(lines)
    out = []
    for i in range(m):
        k0, v0, e0 = lines[i - 1]
        k1, v1, e1 = lines[i]
        # vertex between line i-1 and line i
        if k0 == "H" and k1 == "V":
            out.append((v1, v0))
        elif k0 == "V" and k1 == "H":
            out.append((v0, v1))
        elif k0 == "O" or k1 == "O":
            # keep the original vertex that joins the two runs; project onto the H/V line if any
            vx, vy = q[e1[0]]
            if k1 == "H":
                vy = v1
            elif k1 == "V":
                vx = v1
            if k0 == "H":
                vy = v0
            elif k0 == "V":
                vx = v0
            out.append((vx, vy))
        else:
            # two parallel consecutive lines (H,H / V,V after a skipped edge): keep the join vertex
            out.append(tuple(q[e1[0]]))
    pts = np.array(out)
    # remove collinear / duplicate vertices
    keep = []
    L = len(pts)
    for i in range(L):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % L]
        if np.hypot(*(b - a)) < 1e-6:
            continue
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) < 1e-6:
            continue
        keep.append(b)
    pts = np.array(keep) if len(keep) >= 3 else pts
    # collapse edges shorter than min_edge (notches) by dropping the later vertex
    changed = True
    while changed and len(pts) > 4:
        changed = False
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            if np.hypot(*(pts[j] - pts[i])) < min_edge:
                pts = np.delete(pts, j, axis=0)
                changed = True
                break
    return pts


# ------------------------------------------------------------------------ orchestration
@dataclass
class Footprint:
    id: int
    polygon: Polygon                       # regularised, in grid (ENU) metres
    raw: Polygon                           # pixel-contour polygon before simplification
    area_m2: float
    ground_z: float                        # median DTM under the footprint (MSL)
    roof_p50: float                        # DSM percentiles inside (MSL)
    roof_p90: float
    roof_max: float
    height_p90: float                      # roof_p90 - ground_z
    centroid: tuple[float, float]
    dist_center: float
    theta_deg: float
    stats: dict = field(default_factory=dict)


def extract_footprints(grid: Grid, *, method: str = "steps", dtm: np.ndarray | None = None,
                       veg: np.ndarray | None = None, min_h: float = 2.5,
                       min_area_m2: float = 40.0, dp_tol: float = 0.5, snap_deg: float = 14.0,
                       wall_grow_m: float = 0.5, close_m: float = 2.0, min_step_frac: float = 0.55,
                       ) -> tuple[list[Footprint], dict]:
    """DSM grid -> list[Footprint] (largest first) + debug rasters.

    method="steps"  (default) needs no terrain model: regions bounded by height steps of at
                    least min_h (see classify_regions). Robust on hillside city blocks where
                    a morphological ground filter mistakes big roofs / slopes for terrain.
    method="ndsm"   classic DSM - DTM > min_h (DTM given, else estimate_ground()): right for
                    flat sites with buildings narrower than the filter window."""
    z = grid.z
    zf = fill_nan_nearest(z)
    dbg: dict = {}
    region_info: dict = {}
    if method == "ndsm":
        if dtm is None:
            dtm = estimate_ground(zf, grid.res)
        n = np.where(np.isfinite(z), z - dtm, np.nan)
        mask = building_mask(n, grid.res, min_h=min_h, veg=veg, min_area_m2=min_area_m2)
        dbg.update(dtm=dtm, ndsm=n)
    elif method == "steps":
        lab, k, _ = smooth_regions(z, grid.res)
        acc, region_info = classify_regions(z, lab, k, grid.res, min_h=min_h,
                                            min_area_m2=min_area_m2 * 0.5, veg=veg,
                                            min_step_frac=min_step_frac)
        r = max(1, int(round(wall_grow_m / grid.res)))
        mask = ndi.binary_dilation(acc, structure=_disk(r))
        mask = ndi.binary_closing(mask, structure=_disk(max(1, int(round(close_m / grid.res)))))
        mask &= np.isfinite(z) | ndi.binary_dilation(np.isfinite(z), iterations=2)
        mask = building_mask(np.where(mask, 99.0, 0.0), grid.res, min_h=1.0, open_radius_m=0.5,
                             min_area_m2=min_area_m2)
        dbg.update(labels=lab, accepted=acc, regions=region_info)
    else:
        raise ValueError(f"unknown method {method!r}")
    dbg["mask"] = mask
    lab2, k2 = ndi.label(mask)
    out: list[Footprint] = []
    for i in range(1, k2 + 1):
        comp = lab2 == i
        raw = mask_to_polygon(comp, grid)
        if raw.is_empty:
            continue
        rawp = max(raw.geoms, key=lambda p: p.area) if isinstance(raw, MultiPolygon) else raw
        reg = regularize(rawp, dp_tol=dp_tol, snap_deg=snap_deg)
        inside = comp & np.isfinite(z)
        vals = z[inside]
        if method == "steps":
            gz = [v["ground_z"] for kk, v in region_info.items()
                  if (lab[..., ] == kk)[comp].any()]
            gz = float(np.median(gz)) if gz else float(np.percentile(vals, 2))
        else:
            gz = float(np.median(dtm[comp]))
        cx, cy = reg.centroid.x, reg.centroid.y
        clipped = bool(ndi.binary_dilation(comp, iterations=6)[~np.isfinite(z)].any())
        out.append(Footprint(
            id=0, polygon=reg, raw=rawp, area_m2=float(reg.area), ground_z=gz,
            roof_p50=float(np.percentile(vals, 50)), roof_p90=float(np.percentile(vals, 90)),
            roof_max=float(vals.max()), height_p90=float(np.percentile(vals, 90) - gz),
            centroid=(cx, cy), dist_center=float(math.hypot(cx, cy)),
            theta_deg=math.degrees(dominant_angle(rawp)),
            stats={"nan_frac": float(1 - inside.sum() / comp.sum()), "px": int(comp.sum()),
                   "clipped_by_aoi": clipped}))
    out.sort(key=lambda f: -f.area_m2)
    for j, f in enumerate(out, 1):
        f.id = j
    return out, dbg


def to_geojson(fps: list[Footprint], *, transform=None, crs_name: str | None = None,
               extra: dict | None = None) -> dict:
    """FeatureCollection; `transform(x, y) -> (x', y')` maps grid metres to the output CRS."""
    def ring(coords):
        pts = [(float(x), float(y)) for x, y in coords]
        if transform:
            xs, ys = transform(np.array([p[0] for p in pts]), np.array([p[1] for p in pts]))
            pts = [(float(a), float(b)) for a, b in zip(xs, ys)]
        return [list(p) for p in pts]

    feats = []
    for f in fps:
        p = f.polygon
        geom = {"type": "Polygon", "coordinates": [ring(p.exterior.coords)] + [ring(h.coords) for h in p.interiors]}
        props = {"id": f.id, "area_m2": round(f.area_m2, 2), "ground_z": round(f.ground_z, 3),
                 "roof_p50": round(f.roof_p50, 3), "roof_p90": round(f.roof_p90, 3),
                 "roof_max": round(f.roof_max, 3), "height_p90": round(f.height_p90, 3),
                 "dist_center_m": round(f.dist_center, 2), "theta_deg": round(f.theta_deg, 2)}
        props.update(f.stats)
        feats.append({"type": "Feature", "properties": props, "geometry": geom})
    fc = {"type": "FeatureCollection", "features": feats}
    if crs_name:
        fc["crs"] = {"type": "name", "properties": {"name": crs_name}}
    if extra:
        fc.update(extra)
    return fc


def select_main(fps: list[Footprint], *, max_dist_m: float = 70.0, min_area_m2: float = 150.0,
                min_height_m: float = 12.0) -> list[Footprint]:
    """Buildings of interest: big, tall, near the scene centre and not cut by the AOI edge.
    Returned tallest roof first; callers name them b01, b02, ..."""
    keep = [f for f in fps if f.dist_center <= max_dist_m and f.area_m2 >= min_area_m2
            and f.height_p90 >= min_height_m and not f.stats.get("clipped_by_aoi")]
    keep.sort(key=lambda f: -f.roof_p90)
    return keep
