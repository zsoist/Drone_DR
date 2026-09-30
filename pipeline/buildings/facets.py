"""Planar facets of a shell + atlas layout for photo-projected texturing (W4b).

A facet is a set of edge-connected shell triangles that are coplanar within a tolerance.
Each facet gets its own metric 2D frame (origin o, axes u, v, normal n; game frame, y up):

  wall  : n horizontal (outward), u = right when looking at the wall from outside, v = up
  roof  : n ~ up, (u, v) aligned with the minimum-area rectangle of the facet outline

so a texel at facet coordinates (s, t) is the 3D point  o + s*u + t*v  - i.e. the texture
rectification is exactly the plane->image homography of every candidate photo.
Pure numpy/shapely; unit-tested on synthetic boxes.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

WALL, ROOF = 1, 0            # shell.surf codes (2 = floor, never textured)


@dataclass
class Facet:
    fid: int
    kind: int                 # WALL / ROOF
    tris: np.ndarray          # (k,) triangle indices into the shell
    o: np.ndarray             # (3,) origin
    u: np.ndarray
    v: np.ndarray
    n: np.ndarray             # outward normal
    smin: float
    smax: float
    tmin: float
    tmax: float
    area: float               # true 3D area of the facet triangles
    # filled by the layout step
    density: float = 0.0      # metres per texel
    px: tuple = (0, 0)        # texel size (w, h)
    at: tuple = (0, 0)        # atlas offset (x, y) of the rectangle's top-left texel
    meta: dict = field(default_factory=dict)

    @property
    def size_m(self):
        return self.smax - self.smin, self.tmax - self.tmin

    def to_world(self, s, t):
        s = np.asarray(s)[..., None]
        t = np.asarray(t)[..., None]
        return self.o + s * self.u + t * self.v

    def to_st(self, P):
        d = np.asarray(P) - self.o
        return d @ self.u, d @ self.v


def _adjacency(tris: np.ndarray) -> list[list[int]]:
    edges: dict = {}
    for i, t in enumerate(tris):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edges.setdefault((min(a, b), max(a, b)), []).append(i)
    adj = [[] for _ in range(len(tris))]
    for tl in edges.values():
        for i in tl:
            for j in tl:
                if i != j:
                    adj[i].append(j)
    return adj


def tri_normals(verts, tris):
    a, b, c = (verts[tris[:, i]] for i in range(3))
    n = np.cross(b - a, c - a)
    ar = np.linalg.norm(n, axis=1)
    return n / np.maximum(ar, 1e-12)[:, None], ar / 2


def group_coplanar(verts, tris, surf, *, wall_ang=2.0, wall_dist=0.04, roof_ang=4.0, roof_dist=0.08):
    """Region-grow triangles into planar groups (same surf code, edge-connected, normal within
    `ang` degrees of the seed and every vertex within `dist` m of the seed plane).
    Returns list of index arrays, largest first."""
    nrm, area = tri_normals(verts, tris)
    adj = _adjacency(tris)
    seen = np.zeros(len(tris), bool)
    groups = []
    for seed in np.argsort(-area):
        if seen[seed] or surf[seed] == 2:
            continue
        kind = surf[seed]
        ang, dist = (wall_ang, wall_dist) if kind == WALL else (roof_ang, roof_dist)
        cosang = np.cos(np.radians(ang))
        n0 = nrm[seed]
        d0 = float(n0 @ verts[tris[seed]].mean(0))
        grp, stack = [], [seed]
        seen[seed] = True
        while stack:
            i = stack.pop()
            grp.append(i)
            for j in adj[i]:
                if seen[j] or surf[j] != kind:
                    continue
                if nrm[j] @ n0 < cosang:
                    continue
                if np.abs(verts[tris[j]] @ n0 - d0).max() > dist:
                    continue
                seen[j] = True
                stack.append(j)
        groups.append(np.array(sorted(grp)))
    groups.sort(key=lambda g: -area[g].sum())
    return groups


def build_facet(fid, kind, idx, verts, tris) -> Facet:
    nrm, area = tri_normals(verts, tris[idx])
    pts = verts[tris[idx]].reshape(-1, 3)
    n_avg = (nrm * area[:, None]).sum(0)
    n_avg /= np.linalg.norm(n_avg)
    c = pts.mean(0)
    if kind == WALL:
        n = np.array([n_avg[0], 0.0, n_avg[2]])
        n /= np.linalg.norm(n)
        up = np.array([0.0, 1.0, 0.0])
        u = np.cross(up, n)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
    else:
        # least-squares plane through the vertices, oriented like the triangles
        _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
        n = vt[2]
        if n @ n_avg < 0:
            n = -n
        # in-plane axes from the min-area rectangle of the outline
        ref = np.array([1.0, 0.0, 0.0]) if abs(n[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
        u0 = ref - (ref @ n) * n
        u0 /= np.linalg.norm(u0)
        v0 = np.cross(n, u0)
        xy = np.c_[(pts - c) @ u0, (pts - c) @ v0]
        ang = _min_rect_angle(xy)
        u = np.cos(ang) * u0 + np.sin(ang) * v0
        v = np.cross(n, u)
    s = (pts - c) @ u
    t = (pts - c) @ v
    return Facet(fid, int(kind), np.asarray(idx), c, u, v, n,
                 float(s.min()), float(s.max()), float(t.min()), float(t.max()), float(area.sum()))


def _min_rect_angle(xy: np.ndarray) -> float:
    from scipy.spatial import ConvexHull
    try:
        h = xy[ConvexHull(xy).vertices]
    except Exception:
        return 0.0
    best, ang_best = np.inf, 0.0
    for i in range(len(h)):
        e = h[(i + 1) % len(h)] - h[i]
        L = np.linalg.norm(e)
        if L < 1e-6:
            continue
        a = np.arctan2(e[1], e[0])
        c, s = np.cos(a), np.sin(a)
        p = xy @ np.array([[c, -s], [s, c]])          # rotate by -a
        A = np.ptp(p[:, 0]) * np.ptp(p[:, 1])
        if A < best - 1e-9:
            best, ang_best = A, a
    return float(ang_best)


def extract_facets(verts, tris, surf, **kw) -> list[Facet]:
    return [build_facet(k, int(surf[g[0]]), g, verts, tris) for k, g in enumerate(group_coplanar(verts, tris, surf, **kw))]


# ------------------------------------------------------------------------- atlas layout
PAD = 4


def _shelf_pack(sizes, atlas):
    """sizes: list of (w, h) incl. padding.  Returns list of (x, y) or None if it does not fit."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    pos = [None] * len(sizes)
    x = y = shelf_h = 0
    for i in order:
        w, h = sizes[i]
        if w > atlas or h > atlas:
            return None
        if x + w > atlas:
            x, y, shelf_h = 0, y + shelf_h, 0
        if y + h > atlas:
            return None
        pos[i] = (x, y)
        x += w
        shelf_h = max(shelf_h, h)
    return pos


def layout_atlas(facets: list[Facet], atlas: int = 4096, *, target_density: dict | None = None,
                 min_density: float = 0.02, max_density: float = 0.12, roof_scale: float = 1.5):
    """Give every facet a texel size and atlas rectangle.

    Each facet starts at its `target_density` (metres/texel; typically the native photo GSD,
    clamped to [min_density, max_density]); roofs are `roof_scale` coarser.  If everything does
    not fit the atlas, all densities are scaled by a common factor found by bisection.
    Returns the common scale (>= 1 means coarser than requested)."""
    base = {f.fid: float(np.clip((target_density or {}).get(f.fid, min_density), min_density, max_density)) *
            (roof_scale if f.kind == ROOF else 1.0) for f in facets}

    def attempt(k):
        sizes, dens = [], []
        for f in facets:
            d = base[f.fid] * k
            W, H = f.size_m
            w, h = max(4, int(np.ceil(W / d))), max(4, int(np.ceil(H / d)))
            sizes.append((w + 2 * PAD, h + 2 * PAD))
            dens.append((d, w, h))
        return _shelf_pack(sizes, atlas), dens

    lo, hi = 1.0, 1.0
    pos, dens = attempt(1.0)
    if pos is None:
        hi = 1.5
        while attempt(hi)[0] is None:
            hi *= 1.5
        lo = 1.0
        for _ in range(24):
            mid = 0.5 * (lo + hi)
            if attempt(mid)[0] is None:
                lo = mid
            else:
                hi = mid
        pos, dens = attempt(hi)
        k = hi
    else:
        k = 1.0
    for f, p, (d, w, h) in zip(facets, pos, dens):
        f.density, f.px, f.at = d, (w, h), (p[0] + PAD, p[1] + PAD)
    return k


def facet_uv(f: Facet, verts, tris, atlas: int):
    """Per-corner UV (k,3,2) of the facet's triangles, glTF convention (v down = image rows)."""
    W, H = f.size_m
    P = verts[tris[f.tris]]                                   # (k,3,3)
    s, t = f.to_st(P)
    x = f.at[0] + (s - f.smin) / W * f.px[0]
    y = f.at[1] + (f.tmax - t) / H * f.px[1]
    return np.stack([x / atlas, y / atlas], -1)


def facet_mask(f: Facet, verts, tris) -> np.ndarray:
    """Boolean (h, w) mask of texels inside the facet's triangles (inclusive edges, 1 px grown)."""
    from PIL import Image, ImageDraw
    W, H = f.size_m
    w, h = f.px
    P = verts[tris[f.tris]]
    s, t = f.to_st(P)
    x = (s - f.smin) / W * w
    y = (f.tmax - t) / H * h
    im = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(im)
    for k in range(len(P)):
        pts = [(float(x[k, i]), float(y[k, i])) for i in range(3)]
        dr.polygon(pts, fill=255, outline=255)
    return np.asarray(im) > 0


def texel_points(f: Facet, step: int = 1):
    """World positions of texel centres (rows, cols subsampled by `step`) -> (h', w', 3)."""
    W, H = f.size_m
    w, h = f.px
    xs = (np.arange(0, w, step) + 0.5) / w * W + f.smin
    ys = f.tmax - (np.arange(0, h, step) + 0.5) / h * H
    S, T = np.meshgrid(xs, ys)
    return f.to_world(S, T)
