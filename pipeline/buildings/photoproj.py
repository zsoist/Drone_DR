"""Photo-projected facet texturing (W4b): pick the best drone photos per facet, rectify, blend.

Per facet (planar polygon, see facets.py):
  1. rank all cameras by frame coverage, viewing angle, resolution (m/px on the facet),
     DSM ray-cast visibility (trees, neighbouring buildings) and photo sharpness;
  2. for the best K candidates evaluate every texel: inside frame, front-facing, not occluded
     (coarse ray-cast, upsampled), not vegetation (ExG, walls only);
  3. per-texel weights  cos^2 / dist^2 * sharpness * edge-feather, sharpened (^3) and
     Gaussian-smoothed, so one photo wins locally and seams are feathered;
  4. per-channel gain match of every candidate to the reference (best) photo;
  5. holes (no valid photo) trigger another round of candidates, then nearest-colour fill.
Deterministic; pure numpy/scipy/PIL.  Geometry helpers are unit-tested (test_buildings_photo.py).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

from buildings import facets as FA
from buildings.photos import Camera


# --------------------------------------------------------------------------- geometry
def plane_homography(cam: Camera, f: FA.Facet) -> np.ndarray:
    """3x3 homography H (pinhole part only, no lens distortion) mapping facet coords
    (s, t, 1) -> undistorted pixel (u, v, 1) of `cam`.  X = o + s u + t v;  x_cam = R X + t_c."""
    cols = [cam.R @ f.u, cam.R @ f.v, cam.R @ f.o + cam.t]
    Mx = np.stack(cols, 1)                                # (3,3): camera-space of (s,t,1)
    S = cam.size
    K = np.array([[cam.f_px, 0, (cam.w - 1) / 2 + cam.cx * S],
                  [0, cam.f_px, (cam.h - 1) / 2 + cam.cy * S],
                  [0, 0, 1.0]])
    return K @ Mx


class HeightField:
    """DSM as a game-frame height map:  y_game = z_msl - elev_min,  x_game = E, z_game = -N."""

    def __init__(self, grid, elev_min: float):
        h = (grid.z - elev_min).astype(np.float32)
        h[~np.isfinite(h)] = -1e6
        self.h, self.res, self.x0, self.y0 = h, grid.res, grid.x0, grid.y0

    def height(self, x, z):
        col = (np.asarray(x) - self.x0) / self.res - 0.5
        row = (self.y0 + np.asarray(z)) / self.res - 0.5      # y_enu = -z_game
        return ndi.map_coordinates(self.h, [row, col], order=1, mode="nearest")

    def visible(self, P, C, *, s0=1.0, tol=0.5, step=0.35, max_len=140.0, chunk=20000) -> np.ndarray:
        """True where the straight segment P -> C stays above the surface.  `s0` (scalar or per-ray
        array, metres along the ray) skips the start of each ray: DSM building edges are smeared
        outward by ~1-2 m, so a ray leaving a wall must not be tested against its own building."""
        P = np.asarray(P, dtype=np.float64).reshape(-1, 3)
        d = np.asarray(C, dtype=np.float64) - P
        L = np.linalg.norm(d, axis=1)
        s0 = np.broadcast_to(np.asarray(s0, dtype=np.float64), L.shape)
        out = np.ones(len(P), bool)
        for a in range(0, len(P), chunk):
            sl = slice(a, a + chunk)
            Lc = np.minimum(L[sl], max_len)
            span = Lc - s0[sl]
            nstep = int(np.ceil(span.max() / step)) if len(Lc) else 0
            if nstep <= 0:
                continue
            sd = s0[sl][:, None] + step * (np.arange(nstep)[None, :] + 0.5)      # distances along the ray
            t = sd / L[sl][:, None]
            live = sd < Lc[:, None]
            X = P[sl, None, 0] + t * d[sl, None, 0]
            Y = P[sl, None, 1] + t * d[sl, None, 1]
            Z = P[sl, None, 2] + t * d[sl, None, 2]
            h = self.height(X.ravel(), Z.ravel()).reshape(X.shape)
            out[sl] = ~(((h > Y + tol) & live).any(1))
        return out


def start_dist(kind, cos, wall_skip=2.0, roof_skip=0.8):
    """Ray start offset (metres along the ray) so that it begins `skip` metres off the facet plane."""
    skip = wall_skip if kind == FA.WALL else roof_skip
    return skip / np.maximum(np.asarray(cos, dtype=np.float64), 0.2)


def view_terms(cam: Camera, P: np.ndarray, n: np.ndarray):
    """cos(angle between facet normal and direction to camera), distance, and pixel coords."""
    v = cam.center - P
    dist = np.linalg.norm(v, axis=-1)
    cos = (v @ n) / np.maximum(dist, 1e-9)
    u, vv, z = cam.project(P)
    return cos, dist, u, vv, z


def gsd_on_facet(cam: Camera, dist, cos):
    """Approximate ground-sample distance (m/px) of the photo on the facet."""
    return dist / cam.f_px / np.sqrt(np.maximum(cos, 0.05))


def best_view_order(scores: dict[str, float]) -> list[str]:
    return [k for k, _ in sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))]


def exg_veg(rgb: np.ndarray, thr: float = 0.085, min_abs: float = 30.0) -> np.ndarray:
    """Vegetation mask on (…,3) uint8/float RGB: excess green over chromatic coords, with an
    absolute floor so dark, slightly tinted window glass (noisy ratios) is not flagged."""
    c = rgb.astype(np.float32)
    s = c.sum(-1) + 1e-3
    d = 2 * c[..., 1] - c[..., 0] - c[..., 2]
    return (d / s > thr) & (d > min_abs) & (c[..., 1] > c[..., 0] * 1.02)


def gain_match(ref: np.ndarray, img: np.ndarray, overlap: np.ndarray, *, lo=0.75, hi=1.33, min_px=400):
    """Per-channel multiplicative gain that maps `img` onto `ref` over the overlap mask."""
    if overlap.sum() < min_px:
        return np.ones(3, np.float32)
    a = np.median(ref[overlap], axis=0)
    b = np.median(img[overlap], axis=0)
    return np.clip(a / np.maximum(b, 1.0), lo, hi).astype(np.float32)


def diffuse_fill(rgb: np.ndarray, good: np.ndarray, sigma: float, tone_px: float = 80.0) -> np.ndarray:
    """Fill ~good texels by normalised Gaussian diffusion of the good ones, relaxing to the facet's
    median colour with distance from valid texels (large holes -> calm wall tone, no streaks and
    no tree-coloured smears)."""
    out = rgb.copy()
    if not good.any():
        out[:] = 96
        return out
    m = good.astype(np.float32)
    med = np.median(rgb[good], axis=0)
    dist = ndi.distance_transform_edt(~good)
    num = np.stack([ndi.gaussian_filter(rgb[..., k] * m, sigma, mode="constant") for k in range(3)], -1)
    den = ndi.gaussian_filter(m, sigma, mode="constant")
    diff = np.where((den > 0.02)[..., None], num / np.maximum(den, 1e-6)[..., None], med)
    alpha = np.clip(dist / tone_px, 0, 1)[..., None]
    fill = (1 - alpha) * diff + alpha * med
    out[~good] = fill[~good]
    return out


def bilinear(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """img (H,W,3) uint8, u/v pixel coords (OpenSfM: pixel centre of column i at u = i) -> float32 (...,3)."""
    H, W = img.shape[:2]
    u = np.clip(u, 0, W - 1.001)
    v = np.clip(v, 0, H - 1.001)
    x0 = u.astype(np.int32)
    y0 = v.astype(np.int32)
    fx = (u - x0)[..., None].astype(np.float32)
    fy = (v - y0)[..., None].astype(np.float32)
    a = img[y0, x0].astype(np.float32)
    b = img[y0, x0 + 1].astype(np.float32)
    c = img[y0 + 1, x0].astype(np.float32)
    d = img[y0 + 1, x0 + 1].astype(np.float32)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


# --------------------------------------------------------------------------- photo store
class PhotoStore:
    def __init__(self, img_dir: Path, cache_path: Path | None = None, keep: int = 6):
        self.dir = Path(img_dir)
        self.keep = keep
        self._c: dict = {}
        self.cache_path = cache_path
        self.sharp: dict[str, float] = {}
        if cache_path and Path(cache_path).exists():
            self.sharp = json.loads(Path(cache_path).read_text())

    def load(self, name: str, level: int = 0) -> np.ndarray:
        key = (name, level)
        if key in self._c:
            self._c[key] = self._c.pop(key)
            return self._c[key]
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        im = Image.open(self.dir / name).convert("RGB")
        if level:
            im = im.reduce(2 ** level)
        arr = np.asarray(im)
        self._c[key] = arr
        while len(self._c) > self.keep:
            self._c.pop(next(iter(self._c)))
        return arr

    def measure_sharpness(self, names) -> None:
        """Mean |Laplacian| of the half-res grey image (higher = sharper); cached on disk."""
        from PIL import Image
        todo = [n for n in names if n not in self.sharp]
        for n in todo:
            im = Image.open(self.dir / n)
            im.draft("L", (im.width // 2, im.height // 2))
            g = np.asarray(im.convert("L"), dtype=np.float32)
            lap = np.abs(4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:])
            self.sharp[n] = float(lap.mean() * 2 / max(g.shape[1] / 1536, 1e-3) / 2)
        if todo and self.cache_path:
            Path(self.cache_path).write_text(json.dumps(self.sharp))

    def sharp_rel(self, name: str) -> float:
        if not self.sharp:
            return 1.0
        med = float(np.median(list(self.sharp.values())))
        return float(np.clip(self.sharp.get(name, med) / max(med, 1e-6), 0.6, 1.4))


# --------------------------------------------------------------------------- ranking
@dataclass
class CamScore:
    name: str
    score: float
    cos: float
    gsd: float
    vis: float
    infr: float


def sample_points(f: FA.Facet, mask: np.ndarray, max_pts: int = 300):
    """~uniform world points inside the facet (from its texel mask)."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return np.zeros((0, 3))
    k = max(1, int(math.ceil(len(ys) / max_pts)))
    sel = np.arange(0, len(ys), k)
    W, H = f.size_m
    w, h = f.px
    s = (xs[sel] + 0.5) / w * W + f.smin
    t = f.tmax - (ys[sel] + 0.5) / h * H
    return f.to_world(s, t)


def rank_cameras(f: FA.Facet, pts: np.ndarray, cams: dict[str, Camera], hf: HeightField | None, store: PhotoStore | None,
                 *, top_pre: int = 160, min_cos: float = 0.25) -> list[CamScore]:
    """Score every camera for facet `f` at sample points `pts` (deterministic order)."""
    pre = []
    for name, cam in cams.items():
        cos, dist, u, v, z = view_terms(cam, pts, f.n)
        ok = FA_in_frame(cam, u, v, z, 24) & (cos > min_cos)
        infr = float(ok.mean())
        if infr < 0.5:
            continue
        cm = float(np.clip(cos, 0, 1)[ok].mean())
        gsd = float(np.median(gsd_on_facet(cam, dist, cos)[ok]))
        pre.append((infr * cm ** 1.5 / gsd, name, cm, gsd, infr, cos))
    pre.sort(key=lambda r: (-r[0], r[1]))
    out, qs = [], {}
    for _, name, cm, gsd, infr, cos in pre[:top_pre]:
        cam = cams[name]
        good = cos > min_cos
        vis_pt = hf.visible(pts, cam.center, s0=start_dist(f.kind, cos)) if hf is not None else np.ones(len(pts), bool)
        _, dist, u, v, z = view_terms(cam, pts, f.n)
        val = vis_pt & good & cam.in_frame(u, v, z, margin=24)
        vis = float(val.sum() / max(good.sum(), 1))
        sharp = store.sharp_rel(name) if store else 1.0
        qs[name] = np.where(val, np.clip(cos, 0, 1) ** 2 / np.maximum(dist, 1.0) ** 2 * sharp, 0.0)
        out.append(CamScore(name, vis ** 2 * infr * cm ** 1.5 / gsd * sharp, cm, gsd, vis, infr))
    out.sort(key=lambda c: (-c.score, c.name))
    return _greedy_cover(out, qs)


def _greedy_cover(scored: list[CamScore], qs: dict[str, np.ndarray], max_pick: int = 14) -> list[CamScore]:
    """Order cameras by marginal quality gain over the facet sample points: the first picks are
    the best views, the next ones the views that add coverage (occluded / out-of-frame areas)."""
    if not scored:
        return []
    best = np.zeros(len(next(iter(qs.values()))))
    rest = list(scored)
    order = []
    ref = max(float(q.max()) for q in qs.values()) or 1.0
    while rest and len(order) < max_pick:
        gains = [(float(np.maximum(qs[c.name] - best, 0).sum()), -i) for i, c in enumerate(rest)]
        g, i = max(gains)
        if g < 0.004 * ref * len(best):
            break
        c = rest.pop(-i)
        order.append(c)
        best = np.maximum(best, qs[c.name])
    return order + rest


def FA_in_frame(cam: Camera, u, v, z, margin):
    return cam.in_frame(u, v, z, margin=margin)


# --------------------------------------------------------------------------- bake
@dataclass
class BakeParams:
    k_first: int = 5              # candidates per round
    max_rounds: int = 3
    weight_pow: float = 5.0
    smooth_px: float = 4.0
    feather_px: float = 60.0
    vis_step: int = 6             # visibility is evaluated on every Nth texel
    wall_skip_m: float = 2.0      # normal distance from a wall before occluders count (DSM edge smear)
    roof_skip_m: float = 0.8
    vis_tol: float = 0.5
    min_cos: float = 0.25          # grazing views (> 75 deg) stretch the texture: treat as holes
    fill_sigma_px: float = 24.0
    veg_penalty: float = 0.0
    hole_frac_ok: float = 0.012


def _upsample(a: np.ndarray, shape, step):
    z = ndi.zoom(a.astype(np.float32), step, order=1)
    out = np.zeros(shape, np.float32)
    h, w = min(shape[0], z.shape[0]), min(shape[1], z.shape[1])
    out[:h, :w] = z[:h, :w]
    if h < shape[0]:
        out[h:, :w] = z[h - 1:h, :w]
    if w < shape[1]:
        out[:, w:] = out[:, w - 1:w]
    return out


def bake_facet(f: FA.Facet, mask: np.ndarray, cams: dict[str, Camera], store: PhotoStore, hf: HeightField | None,
               ranked: list[CamScore], prm: BakeParams = BakeParams()):
    """Returns (rgb uint8 (h,w,3), info dict).  `mask` = texels inside the facet."""
    w, h = f.px
    P = FA.texel_points(f)                                        # (h,w,3)
    step = prm.vis_step
    Pc = P[::step, ::step]
    yy, xx = np.mgrid[0:h, 0:w]
    wall = f.kind == FA.WALL
    acc = np.zeros((h, w, 3), np.float32)
    accw = np.zeros((h, w), np.float32)
    used = []
    per_cam = {}
    ref_img = None
    ref_w = None
    ptr = 0
    for rnd in range(prm.max_rounds):
        batch = ranked[ptr:ptr + prm.k_first]
        ptr += prm.k_first
        if not batch:
            break
        for cs in batch:
            cam = cams[cs.name]
            cos, dist, u, v, z = view_terms(cam, P, f.n)
            valid = cam.in_frame(u, v, z, margin=6) & (cos > prm.min_cos) & mask
            if not valid.any():
                continue
            if hf is not None:
                cos_c = view_terms(cam, Pc, f.n)[0]
                vis_c = hf.visible(Pc.reshape(-1, 3), cam.center, s0=start_dist(f.kind, cos_c.ravel(), prm.wall_skip_m, prm.roof_skip_m),
                                   tol=prm.vis_tol).reshape(Pc.shape[:2])
                vis = _upsample(vis_c, (h, w), step) > 0.5
                valid &= vis
            if not valid.any():
                continue
            gsd = float(np.median(gsd_on_facet(cam, dist, cos)[valid]))
            ratio = f.density / max(gsd, 1e-6)
            lvl = 0 if ratio < 1.7 else (1 if ratio < 3.4 else 2)
            img = store.load(cs.name, lvl)
            sc = 2 ** lvl
            col = bilinear(img, u / sc, v / sc)
            if wall:
                veg = ndi.gaussian_filter(exg_veg(col).astype(np.float32), 1.5) > 0.4
            else:
                veg = np.zeros((h, w), bool)
            edge = np.minimum(np.minimum(u, v), np.minimum(cam.w - 1 - u, cam.h - 1 - v))
            feather = np.clip(edge / prm.feather_px, 0, 1)
            wt = (np.clip(cos, 0, 1) ** 2 / np.maximum(dist, 1.0) ** 2) * store.sharp_rel(cs.name) * feather
            wt = np.where(valid, wt, 0) * np.where(veg, prm.veg_penalty, 1.0)
            wt = wt.astype(np.float32)
            per_cam[cs.name] = (col, wt, veg, float(np.mean(cos[valid])), gsd)
        # combine everything gathered so far
        names = list(per_cam)
        if not names:
            continue
        wmax = max(float(pc[1].max()) for pc in per_cam.values()) or 1.0
        # smooth the sharpened weights (feathered seams) but never let a photo count where it was invalid
        Ws = {n: ndi.gaussian_filter((per_cam[n][1] / wmax) ** prm.weight_pow, prm.smooth_px) * (per_cam[n][1] > 0)
              for n in names}
        tot = {n: float(Ws[n].sum()) for n in names}
        ref = max(names, key=lambda n: (tot[n], n))
        acc[:] = 0
        accw[:] = 0
        gains = {}
        for n in names:
            col, wt, veg, cmean, gsd = per_cam[n]
            if n == ref:
                g = np.ones(3, np.float32)
            else:
                ov = (per_cam[ref][1] > 0) & (wt > 0) & ~veg & ~per_cam[ref][2]
                g = gain_match(per_cam[ref][0], col, ov)
            gains[n] = g
            acc += (col * g) * Ws[n][..., None]
            accw += Ws[n]
        cov = accw > 1e-12
        hole = mask & ~cov
        if hole.sum() / max(mask.sum(), 1) <= prm.hole_frac_ok:
            break
    if not per_cam:
        return np.full((h, w, 3), 96, np.uint8), {"photos": [], "hole_frac": 1.0, "empty": True, "primary": None}
    rgb = np.where(cov[..., None], acc / np.maximum(accw, 1e-30)[..., None], 0)
    hole = mask & ~cov
    # fill: diffuse the covered colours into holes / gutters (no streaks), flat facet tone as last resort
    good = cov
    if not good.all():
        rgb = diffuse_fill(rgb, good, prm.fill_sigma_px)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    used_info = []
    for n in names:
        share = float((Ws[n] / np.maximum(accw, 1e-30))[mask & cov].mean()) if (mask & cov).any() else 0.0
        col, wt, veg, cmean, gsd = per_cam[n]
        cs = next(c for c in ranked if c.name == n)
        used_info.append({"photo": n, "share": round(share, 3), "cos": round(cmean, 3),
                          "gsd_m": round(gsd, 4), "vis_rank": round(cs.vis, 2), "gain": [round(float(x), 3) for x in gains[n]]})
    used_info.sort(key=lambda d: -d["share"])
    info = {"photos": used_info[:6], "primary": used_info[0]["photo"] if used_info else None,
            "hole_frac": round(float(hole.sum() / max(mask.sum(), 1)), 4),
            "veg_frac": round(float(np.mean([per_cam[n][2][mask].mean() for n in names])), 4) if wall else 0.0}
    return rgb, info
