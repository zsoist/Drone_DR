"""LoD shells from footprints + point cloud (W4 step 2).

Two producers, same output contract (`Shell`: ENU/ODM-frame triangle soup grouped by
semantic surface: 0 roof, 1 wall, 2 floor):

  * Roofer (3DBAG, GPLv3) LoD2.2 - prebuilt macOS arm64 binary in
    /Volumes/SSD/_system/tools/roofer/bin/roofer. We only exec it and read its CityJSONSeq
    (no linking, no distribution of the binary).
  * `lod1x`: numpy fallback. Footprint extruded to a robust roof height, roof split into
    stepped parts by per-cell height clustering of the DSM inside the footprint (LoD1.x),
    each part optionally refined with RANSAC-fitted planes (LoD2-lite: gable / mono-pitch).
"""
from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import Polygon
from shapely.geometry import box as sbox

ROOFER = Path("/Volumes/SSD/_system/tools/roofer/bin/roofer")


@dataclass
class Shell:
    verts: np.ndarray                                   # (n,3) float64, same frame as input
    tris: np.ndarray                                    # (m,3) int
    surf: np.ndarray                                    # (m,) 0 roof / 1 wall / 2 floor
    meta: dict = field(default_factory=dict)

    def merged(self, eps: float = 1e-4) -> "Shell":
        """Weld vertices closer than eps and drop degenerate triangles."""
        key = np.round(self.verts / eps).astype(np.int64)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        v = self.verts[first]
        t = inv.reshape(-1)[self.tris]
        good = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
        return Shell(v, t[good], self.surf[good], dict(self.meta))

    def area(self) -> float:
        a, b, c = (self.verts[self.tris[:, i]] for i in range(3))
        return float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())


# ---------------------------------------------------------------------------- geometry
def triangulate_polygon(poly: Polygon) -> list[tuple[np.ndarray, np.ndarray]]:
    """Earcut-free robust triangulation via shapely (Delaunay of vertices, keep inside)."""
    from shapely import delaunay_triangles, constrained_delaunay_triangles
    try:
        tri = constrained_delaunay_triangles(poly)
    except Exception:                                    # older shapely
        tri = delaunay_triangles(poly)
    out = []
    for t in tri.geoms:
        if t.area > 1e-9 and poly.buffer(1e-6).contains(t.representative_point()):
            c = np.asarray(t.exterior.coords)[:3]
            out.append(c)
    return out


def _ccw(poly: Polygon) -> Polygon:
    from shapely.geometry.polygon import orient
    return orient(poly, 1.0)


def extrude_prism(poly: Polygon, z_floor: float, z_roof, *, roof_fn=None) -> Shell:
    """Walls + floor + flat roof (or roof_fn(x,y)->z per vertex) for a polygon.

    Walls follow the exterior and interior rings; roof vertices are lifted with roof_fn."""
    poly = _ccw(poly)
    verts: list = []
    tris: list = []
    surf: list = []

    def vid(p, z):
        verts.append((p[0], p[1], z)); return len(verts) - 1

    rf = roof_fn or (lambda x, y: z_roof)
    for ring_i, ring in enumerate([poly.exterior] + list(poly.interiors)):
        pts = np.asarray(ring.coords)[:-1]
        if ring_i == 0:
            pass
        n = len(pts)
        # exterior CCW -> outward normal on the right of edge; interiors are CW already (orient)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            a0, b0 = vid(a, z_floor), vid(b, z_floor)
            a1, b1 = vid(a, rf(*a)), vid(b, rf(*b))
            tris += [(a0, b0, b1), (a0, b1, a1)]
            surf += [1, 1]
    for t in triangulate_polygon(poly):
        a, b, c = (vid(p, z_floor) for p in t)
        # floor faces down
        cr = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])
        tris.append((a, c, b) if cr > 0 else (a, b, c)); surf.append(2)
    for t in triangulate_polygon(poly):
        ids = [vid(p, rf(*p)) for p in t]
        cr = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])
        tris.append((ids[0], ids[1], ids[2]) if cr > 0 else (ids[0], ids[2], ids[1])); surf.append(0)
    return Shell(np.array(verts, float), np.array(tris, int), np.array(surf, int)).merged()


# --------------------------------------------------------------------- LoD1.x fallback
def height_parts(z: np.ndarray, inside: np.ndarray, res: float, *, step_m: float = 1.5,
                 min_part_m2: float = 12.0) -> np.ndarray:
    """Label roof parts of one footprint by clustering DSM heights (1-D, gap > step_m splits)
    and connectivity. Returns int labels (0 = background) on the same grid."""
    vals = z[inside & np.isfinite(z)]
    if vals.size == 0:
        return np.zeros(z.shape, int)
    hist_lo, hist_hi = float(vals.min()), float(vals.max())
    bins = np.arange(hist_lo, max(hist_hi, hist_lo + 0.5) + 0.25, 0.25)
    h, _ = np.histogram(vals, bins)
    # find dominant modes by smoothing the histogram and cutting at valleys deeper than 30 %
    hs = ndi.gaussian_filter1d(h.astype(float), 2.0)
    peaks = [i for i in range(1, len(hs) - 1) if hs[i] >= hs[i - 1] and hs[i] > hs[i + 1] and hs[i] > 0.04 * hs.max()]
    if not peaks:
        peaks = [int(hs.argmax())]
    centers = [bins[p] + 0.125 for p in peaks]
    merged = [centers[0]]
    for c in centers[1:]:
        if c - merged[-1] < step_m:
            continue
        merged.append(c)
    merged = np.array(merged)
    lab = np.zeros(z.shape, int)
    zz = np.where(np.isfinite(z), z, merged[0])
    assign = np.abs(zz[..., None] - merged[None]).argmin(-1) + 1
    lab[inside] = assign[inside]
    # median filter to kill speckle, then drop tiny parts
    lab = ndi.median_filter(lab, size=5) * inside
    out = np.zeros_like(lab)
    k = 0
    for m in range(1, len(merged) + 1):
        cc, n = ndi.label(lab == m)
        for j in range(1, n + 1):
            if (cc == j).sum() * res * res >= min_part_m2:
                k += 1
                out[cc == j] = k
    # give orphaned inside pixels to the nearest labelled part
    if k and (inside & (out == 0)).any():
        idx = ndi.distance_transform_edt(out == 0, return_distances=False, return_indices=True)
        out = np.where(inside, out[tuple(idx)], 0)
    return out


def ransac_plane(pts: np.ndarray, *, iters: int = 400, tol: float = 0.15, rng=None):
    """Plane z = a*x + b*y + c through (n,3) points by RANSAC; returns (coef, inlier mask)."""
    rng = rng or np.random.default_rng(0)
    n = len(pts)
    if n < 6:
        return None, np.zeros(n, bool)
    best, best_in = None, None
    for _ in range(iters):
        s = pts[rng.choice(n, 3, replace=False)]
        A = np.c_[s[:, 0], s[:, 1], np.ones(3)]
        try:
            coef = np.linalg.solve(A, s[:, 2])
        except np.linalg.LinAlgError:
            continue
        if np.hypot(coef[0], coef[1]) > 1.2:      # > 50 deg: not a roof
            continue
        r = np.abs(pts[:, 0] * coef[0] + pts[:, 1] * coef[1] + coef[2] - pts[:, 2])
        inl = r < tol
        if best_in is None or inl.sum() > best_in.sum():
            best, best_in = coef, inl
    if best is None:
        return None, np.zeros(n, bool)
    A = np.c_[pts[best_in, 0], pts[best_in, 1], np.ones(best_in.sum())]
    coef, *_ = np.linalg.lstsq(A, pts[best_in, 2], rcond=None)      # refit on inliers
    r = np.abs(pts[:, 0] * coef[0] + pts[:, 1] * coef[1] + coef[2] - pts[:, 2])
    return coef, r < tol


def lod1x_shell(poly: Polygon, z_grid: np.ndarray, grid, ground_z: float, *,
                planes: bool = True, cell_m: float = 1.0) -> Shell:
    """Footprint -> stepped-roof prism (LoD1.x) with optional per-part RANSAC planes.

    z_grid/grid: DSM raster (Grid) in the SAME frame as `poly`. Roof height per part is the
    part's median (flat) or its fitted plane when >=70 % of the part's cells are inliers."""
    res = grid.res
    xs, ys = grid.xy()
    minx, miny, maxx, maxy = poly.buffer(1.0).bounds
    rr0, cc0 = grid.rc(minx, maxy)
    rr1, cc1 = grid.rc(maxx, miny)
    r0i, r1i = max(0, int(math.floor(rr0))), min(z_grid.shape[0], int(math.ceil(rr1)) + 1)
    c0i, c1i = max(0, int(math.floor(cc0))), min(z_grid.shape[1], int(math.ceil(cc1)) + 1)
    sub = z_grid[r0i:r1i, c0i:c1i]
    X, Y = xs[r0i:r1i, c0i:c1i], ys[r0i:r1i, c0i:c1i]
    from shapely import contains_xy
    inside = contains_xy(poly.buffer(-0.3), X, Y)
    parts = height_parts(sub, inside, res)
    npart = int(parts.max())
    if npart == 0:
        return extrude_prism(poly, ground_z, float(np.nanmedian(sub[inside])))
    meta = {"parts": npart, "planes": []}
    part_polys: list[tuple[Polygon, object]] = []
    from shapely.ops import unary_union
    def planes_for(m):
        """Split a part's cells into <=3 RANSAC planes (gable = 2); flat parts stay one flat item."""
        pts = np.c_[X[m], Y[m], sub[m]]
        ok = np.isfinite(pts[:, 2])
        idx = np.nonzero(m.ravel())[0][ok]
        pts = pts[ok]
        if not planes or len(pts) < 50:
            return [(idx, None)]
        found, left = [], np.arange(len(pts))
        for _ in range(3):
            if len(left) < max(30, 0.15 * len(pts)):
                break
            c, inl = ransac_plane(pts[left][::max(1, len(left) // 3000)] if len(left) > 3000 else pts[left])
            if c is None:
                break
            res_all = np.abs(pts[left, 0] * c[0] + pts[left, 1] * c[1] + c[2] - pts[left, 2])
            take = res_all < 0.15
            if take.sum() < max(30, 0.15 * len(pts)):
                break
            found.append(c)
            left = left[~take]
        if not found:
            return [(idx, None)]
        resid = np.stack([np.abs(pts[:, 0] * c[0] + pts[:, 1] * c[1] + c[2] - pts[:, 2]) for c in found])
        best = resid.argmin(0)
        keep = resid.min(0) < 0.3
        if keep.mean() < 0.7:                       # planes do not explain the part: stay LoD1.x
            return [(idx, None)]
        out = []
        for a, c in enumerate(found):
            sel = (best == a)
            if sel.sum() < 20:
                continue
            flat = math.hypot(c[0], c[1]) < 0.05
            out.append((idx[sel], None if flat else c))
        # cells not explained by any plane go to the nearest-plane group by construction
        return out or [(idx, None)]

    flat_idx_shape = X.shape
    for k in range(1, npart + 1):
        m = parts == k
        for cells_idx, coef in planes_for(m):
            mm = np.zeros(X.size, bool); mm[cells_idx] = True; mm = mm.reshape(flat_idx_shape)
            cells = [sbox(X[i, j] - res / 2, Y[i, j] - res / 2, X[i, j] + res / 2, Y[i, j] + res / 2)
                     for i, j in zip(*np.nonzero(mm))]
            poly_k = unary_union(cells).buffer(res * 0.55).buffer(-res * 0.55).intersection(poly)
            if poly_k.is_empty:
                continue
            med = float(np.nanmedian(sub[mm]))
            meta["planes"].append({"part": k, "z_med": round(med, 3),
                                   "plane": None if coef is None else [round(float(v), 4) for v in coef],
                                   "area_m2": round(float(poly_k.area), 2)})
            part_polys.append((poly_k, coef if coef is not None else med))
    # Build: one prism per part, walls only on the OUTER boundary + where parts differ in height.
    sh = None
    outer = poly
    for pk, roof in part_polys:
        geoms = list(pk.geoms) if pk.geom_type == "MultiPolygon" else [pk]
        for g in geoms:
            if g.geom_type != "Polygon" or g.area < 1.0:
                continue
            fn = None
            if not np.isscalar(roof):
                a, b, c = roof
                fn = (lambda a, b, c: (lambda x, y: a * x + b * y + c))(a, b, c)
                one = extrude_prism(g.simplify(0.1), ground_z, 0.0, roof_fn=fn)
            else:
                one = extrude_prism(g.simplify(0.1), ground_z, roof)
            sh = one if sh is None else Shell(np.vstack([sh.verts, one.verts]),
                                              np.vstack([sh.tris, one.tris + len(sh.verts)]),
                                              np.concatenate([sh.surf, one.surf]))
    sh.meta.update(meta)
    return sh


# ------------------------------------------------------------------------------ Roofer
def roofer_prep_pointcloud(laz: Path, footprints_utm: list[Polygon], ground_z: list[float],
                           out_las: Path, *, ring_m: float = 8.0, cell_m: float = 2.0) -> dict:
    """Crop the ODM cloud to the footprints (+ring) and reclassify for Roofer:
    6 = inside footprint, 2 = lowest points of the surrounding ring, 1 = everything else.
    (ODM's own class 6 marks ~45 % of the scene - roofs, walls, canopies - so it is not usable.)"""
    import laspy
    from shapely import contains_xy
    from shapely.ops import unary_union
    las = laspy.read(str(laz))
    x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    u = unary_union(footprints_utm)
    minx, miny, maxx, maxy = u.buffer(ring_m).bounds
    m = (x >= minx) & (x <= maxx) & (y >= miny) & (y <= maxy)
    idx = np.nonzero(m)[0]
    xs, ys, zs = x[idx], y[idx], z[idx]
    inside = contains_xy(unary_union([p.buffer(0.2) for p in footprints_utm]), xs, ys)
    ring = contains_xy(u.buffer(ring_m), xs, ys) & ~contains_xy(u.buffer(1.5), xs, ys)
    cls = np.ones(len(idx), np.uint8)
    cls[inside] = 6
    # ground = points within 0.35 m of the lowest point in their 2 m cell, in the ring only
    ci = ((xs - minx) / cell_m).astype(int); cj = ((ys - miny) / cell_m).astype(int)
    key = ci * 100003 + cj
    order = np.argsort(key)
    ks = key[order]
    starts = np.r_[0, np.nonzero(np.diff(ks))[0] + 1]
    mins = np.minimum.reduceat(zs[order], starts)
    cellmin = np.empty(len(idx)); cellmin[order] = np.repeat(mins, np.diff(np.r_[starts, len(ks)]))
    g = ring & (zs <= cellmin + 0.35)
    cls[g] = 2
    new = laspy.LasData(laspy.LasHeader(point_format=6, version="1.4"))
    new.header.offsets = np.array([np.floor(xs.min()), np.floor(ys.min()), np.floor(zs.min())])
    new.header.scales = np.array([0.001, 0.001, 0.001])
    new.x, new.y, new.z = xs, ys, zs
    new.classification = cls
    out_las.parent.mkdir(parents=True, exist_ok=True)
    new.write(str(out_las))
    return {"points": int(len(idx)), "building": int((cls == 6).sum()), "ground": int((cls == 2).sum()),
            "file": str(out_las)}


def run_roofer(pointcloud: Path, footprints_geojson: Path, out_dir: Path, *, srs: str = "EPSG:32618",
               id_attr: str = "id", timeout: int = 900, extra: list[str] | None = None) -> subprocess.CompletedProcess:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [str(ROOFER), "--srs", srs, "--id-attribute", id_attr, "--lod12", "--lod22",
           "--split-cjseq", "--bld-class", "6", "--grnd-class", "2", "-j", "4"]
    cmd += extra or []
    cmd += [str(pointcloud), str(footprints_geojson), str(out_dir)]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def read_roofer_output(out_dir: Path, lod: str = "2.2") -> dict[str, dict]:
    """Roofer output dir -> {building id (str): {verts (n,3) UTM, tris, surf, attrs}}.

    Each objects/N/reconstruct/N.city.jsonl holds one CityJSONFeature with int vertices;
    the global scale/translate is in metadata.json."""
    out_dir = Path(out_dir)
    md = json.loads((out_dir / "metadata.json").read_text())
    sc = np.array(md["transform"]["scale"]); tr = np.array(md["transform"]["translate"])
    res: dict[str, dict] = {}
    for f in sorted(out_dir.glob("objects/*/reconstruct/*.city.jsonl")):
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            feat = json.loads(line)
            v = np.array(feat["vertices"], float) * sc + tr
            attrs, tris, surf = {}, [], []
            for cid, obj in feat["CityObjects"].items():
                if obj["type"] == "Building":
                    attrs = obj.get("attributes", {})
                    continue
                for geom in obj.get("geometry", []):
                    if str(geom.get("lod")) != lod:
                        continue
                    sem = geom.get("semantics", {})
                    types = [x["type"] for x in sem.get("surfaces", [])]
                    faces = geom["boundaries"][0] if geom["type"] == "Solid" else geom["boundaries"]
                    vals = sem.get("values", [])
                    vals = vals[0] if geom["type"] == "Solid" and vals else vals
                    for fi, face in enumerate(faces):
                        st = types[vals[fi]] if fi < len(vals) and vals[fi] is not None else "WallSurface"
                        code = {"RoofSurface": 0, "GroundSurface": 2}.get(st, 1)
                        tt = _tri_face(v, face[0], face[1:])
                        tris += tt
                        surf += [code] * len(tt)
            bid = str(attrs.get("id", feat.get("id")))
            res[bid] = {"verts": v, "tris": np.array(tris, int), "surf": np.array(surf, int), "attrs": attrs}
    return res


def _tri_face(v: np.ndarray, ring: list[int], holes: list[list[int]]) -> list[tuple[int, int, int]]:
    """Triangulate a planar 3D face (with holes) by projecting on its dominant axis and using
    shapely's constrained Delaunay."""
    from shapely import constrained_delaunay_triangles
    pts = v[ring]
    n = np.cross(pts[1] - pts[0], pts[2] - pts[0]) if len(pts) >= 3 else np.array([0, 0, 1.0])
    # Newell normal for robustness
    nn = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nn += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
    ax = int(np.abs(nn).argmax())
    keep = [i for i in range(3) if i != ax]
    sign = 1.0 if nn[ax] >= 0 else -1.0
    def proj(idx):
        p = v[idx][:, keep]
        if ax == 1:
            p = p[:, ::-1]
        return p
    outer = Polygon(proj(ring))
    hs = [proj(h) for h in holes]
    poly = Polygon(outer.exterior.coords, [h for h in hs if len(h) >= 3])
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        return []
    # index lookup by projected coord
    lookup = {}
    for idx in ring + [i for h in holes for i in h]:
        q = proj([idx])[0]
        lookup[(round(q[0], 6), round(q[1], 6))] = idx
    res = []
    geoms = constrained_delaunay_triangles(poly).geoms
    for t in geoms:
        if not poly.buffer(1e-7).contains(t.representative_point()):
            continue
        c = np.asarray(t.exterior.coords)[:3]
        ids = []
        for q in c:
            k = (round(q[0], 6), round(q[1], 6))
            if k not in lookup:
                break
            ids.append(lookup[k])
        if len(ids) == 3:
            tri = ids
            # orient with the face normal
            a, b, c3 = v[tri[0]], v[tri[1]], v[tri[2]]
            if np.dot(np.cross(b - a, c3 - a), nn) < 0:
                tri = [tri[0], tri[2], tri[1]]
            res.append(tuple(tri))
    return res


# ------------------------------------------------------------------------- residuals
def roof_residuals(sh: Shell, poly: Polygon, grid, *, inset_m: float = 0.75) -> dict:
    """Shell roof height vs DSM inside the footprint (positive = shell above DSM).

    Rasterises every roof triangle onto the DSM grid (highest wins) and compares at cells
    at least `inset_m` inside the footprint (walls are blurred in the DSM)."""
    from shapely import contains_xy
    z = grid.z
    xs, ys = grid.xy()
    top = np.full(z.shape, -np.inf)
    v = sh.verts
    for t in sh.tris[sh.surf == 0]:
        a, b, c = v[t[0]], v[t[1]], v[t[2]]
        minx, maxx = min(a[0], b[0], c[0]), max(a[0], b[0], c[0])
        miny, maxy = min(a[1], b[1], c[1]), max(a[1], b[1], c[1])
        r0, c0 = grid.rc(minx, maxy); r1, c1 = grid.rc(maxx, miny)
        r0, r1 = max(0, int(math.floor(r0))), min(z.shape[0], int(math.ceil(r1)) + 1)
        c0, c1 = max(0, int(math.floor(c0))), min(z.shape[1], int(math.ceil(c1)) + 1)
        if r1 <= r0 or c1 <= c0:
            continue
        X, Y = xs[r0:r1, c0:c1], ys[r0:r1, c0:c1]
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        zz = l1 * a[2] + l2 * b[2] + l3 * c[2]
        sub = top[r0:r1, c0:c1]
        sub[m] = np.maximum(sub[m], zz[m])
    inner = poly.buffer(-inset_m)
    sel = contains_xy(inner, xs, ys) & np.isfinite(z) & np.isfinite(top)
    if sel.sum() == 0:
        return {"cells": 0}
    d = top[sel] - z[sel]
    return {"cells": int(sel.sum()), "median_m": round(float(np.median(d)), 3),
            "mae_m": round(float(np.mean(np.abs(d))), 3),
            "p90_abs_m": round(float(np.percentile(np.abs(d), 90)), 3),
            "rmse_m": round(float(np.sqrt(np.mean(d ** 2))), 3),
            "covered_frac": round(float(sel.sum() / max(1, (contains_xy(inner, xs, ys) & np.isfinite(z)).sum())), 3)}
