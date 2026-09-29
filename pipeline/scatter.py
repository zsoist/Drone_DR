#!/usr/bin/env python3
"""W5 (docs/WORLD_UPGRADE_PLAN.md): vegetation scatter for the FLIGHTVERSE terrain.

Builds ``models/<cid>/scatter.json``: tree / shrub instance points placed on the bare,
DSM-only terrain (the photogrammetry mesh already carries its own trees and buildings, so
everything under ``mesh_coverage`` - plus a safety margin - is excluded).

Pipeline, all on the game DSM grid (``dsm_lod.json``: origin = DSM centre, +x east, +z south,
row 0 = north; the ortho covers exactly the same extents, UV (0,0)..(1,1) = NW..SE):

1. ExG greenness from the ortho, chromatic coordinates: ``ExG = 2g' - r' - b'``.
2. nDSM = DSM - morphological opening of the DSM (a DTM proxy: no DTM exists for these
   sites). Height class: tree >= TREE_MIN_M, shrub >= SHRUB_MIN_M, lower is grass (skipped:
   the ortho already reads as grass and blades at drone altitude are pure overdraw).
3. Mask = green & valid DSM & not under the mesh (dilated) ; speckle removed by opening.
4. Blue-noise placement (dart throwing with a crown-sized radius) with a seed derived from
   the clip id, so the result is reproducible byte for byte.

Instance row: ``[x, z, g, h, yaw, type, tint]``
    x, z   metres in the game frame (same as ``heightAt``)
    g      metres the base sits BELOW the DSM surface (DSM already contains the canopy top,
           so the crown must rest on it instead of being buried in it)
    h      instance height in metres
    yaw    radians
    type   index into ``types``
    tint   0xRRGGBB mean ortho colour under the instance (the runtime tints the foliage)

The list is shuffled, so any prefix is a uniform thinning: the runtime keeps the first N for
its device tier. Vegetation is purely visual - no collision.

    python3 pipeline/scatter.py <clip_id> [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from fsutil import atomic_write_json, read_json
from paths import VAULT

VERSION = 1
TYPES = ["tree_round", "tree_conifer", "tree_oak", "bush"]
TREE_TYPES = (0, 1, 2)
BUSH_TYPE = 3
TYPE_WEIGHTS = (0.38, 0.32, 0.30)          # round / conifer / oak among trees

UPSAMPLE = 2                                # work grid = DSM grid x2 (about 0.5 m at 1 m DSM)
EXG_THRESHOLD = 0.045                       # chromatic ExG; measured on both live ortho sets
MIN_BRIGHTNESS = 0.10                       # 0..1 mean of rgb; blocks black no-data / deep shadow
TREE_MIN_M = 2.5
SHRUB_MIN_M = 0.6
OPENING_RADIUS_M = 14.0                     # bigger than a typical crown so the DTM proxy sits on the ground
MESH_MARGIN_M = 1.2                         # keep this far from the mesh coverage (seam blend zone)
EDGE_MARGIN_M = 1.0                         # keep this far from the DSM validity outline
SINK_FRAC = 0.42                            # crown rests on the DSM surface: base = surface - SINK_FRAC*h
TREE_H_RANGE = (3.5, 26.0)
SHRUB_H_RANGE = (0.9, 2.6)
MAX_CANDIDATES = 90_000
CAP_TOTAL = 9000                            # file cap; the runtime applies a per-device cap below this


class ScatterError(ValueError):
    pass


def _seed(cid: str) -> int:
    return int.from_bytes(hashlib.sha256(f"scatter:{cid}".encode()).digest()[:8], "little")


def exg_map(rgb: np.ndarray) -> np.ndarray:
    """Excess-green on chromatic coordinates; rgb float 0..1, shape (h, w, 3)."""
    s = rgb.sum(axis=2) + 1e-6
    return (2.0 * rgb[..., 1] - rgb[..., 0] - rgb[..., 2]) / s


def ndsm_from_dsm(hf: np.ndarray, spacing_m: float, radius_m: float = OPENING_RADIUS_M) -> np.ndarray:
    """Height above a DTM proxy (grey opening of the DSM), >= 0."""
    size = max(3, int(round(2 * radius_m / max(spacing_m, 1e-3))) | 1)
    ground = ndimage.grey_opening(hf, size=(size, size), mode="nearest")
    ground = ndimage.uniform_filter(ground, size=3, mode="nearest")
    return np.clip(hf - ground, 0.0, None)


def _resize(arr: np.ndarray, shape: tuple[int, int], order: int = 1) -> np.ndarray:
    if arr.shape == shape:
        return arr
    zy, zx = shape[0] / arr.shape[0], shape[1] / arr.shape[1]
    out = ndimage.zoom(arr, (zy, zx) + (1,) * (arr.ndim - 2), order=order, mode="nearest")
    return out[: shape[0], : shape[1]]


FOLIAGE = np.array([0.22, 0.40, 0.13])


def _foliage_tint(rgb: np.ndarray) -> int:
    """Ortho colour pulled towards a foliage green: keeps the local brightness / warmth of the
    photo but never lets a teal pool or a blue roof pixel that slipped through ExG tint a tree."""
    c = np.clip(np.asarray(rgb, dtype=np.float64), 0, 1)
    lum = float(np.clip(c.mean() / 0.30, 0.5, 1.6))
    out = np.clip(0.45 * c + 0.55 * FOLIAGE * lum, 0, 1)
    return (int(out[0] * 255) << 16) | (int(out[1] * 255) << 8) | int(out[2] * 255)


def compute_scatter(
    rgb: np.ndarray,
    hf: np.ndarray,
    valid: np.ndarray,
    mesh_cov: np.ndarray | None,
    spacing_m: tuple[float, float],
    seed: int,
    *,
    cap: int = CAP_TOTAL,
    exg_threshold: float = EXG_THRESHOLD,
) -> dict:
    """Pure function: arrays in, instances + stats out.

    rgb        (H, W, 3) float 0..1, covering the DSM extents exactly
    hf         (rows, cols) DSM metres
    valid      (rows, cols) bool, True where the DSM is real data
    mesh_cov   (rows, cols) bool or None, True where the photogrammetry mesh draws
    spacing_m  (sx, sz) DSM grid spacing
    """
    rows, cols = hf.shape
    sx, sz = float(spacing_m[0]), float(spacing_m[1])
    if valid.shape != hf.shape or (mesh_cov is not None and mesh_cov.shape != hf.shape):
        raise ScatterError("valid / mesh_cov must match the DSM grid")
    k = UPSAMPLE
    fr, fc = rows * k, cols * k
    fine_sx, fine_sz = sx * (cols - 1) / (fc - 1), sz * (rows - 1) / (fr - 1)

    rgb_f = _resize(rgb, (fr, fc), order=1)
    exg = exg_map(rgb_f)
    bright = rgb_f.mean(axis=2)
    ndsm = _resize(ndsm_from_dsm(hf, (sx + sz) / 2), (fr, fc), order=1)
    valid_f = _resize(valid.astype(np.float32), (fr, fc), order=0) > 0.5

    # keep away from the DSM outline (nodata skirt) and from the mesh (+ blend margin)
    valid_in = ndimage.binary_erosion(valid_f, iterations=max(1, int(round(EDGE_MARGIN_M / fine_sx))))
    allowed = valid_in
    excluded_mesh_pct = 0.0
    if mesh_cov is not None:
        cov_f = _resize(mesh_cov.astype(np.float32), (fr, fc), order=0) > 0.5
        cov_d = ndimage.binary_dilation(cov_f, iterations=max(1, int(round(MESH_MARGIN_M / fine_sx))))
        allowed = allowed & ~cov_d
        excluded_mesh_pct = float(cov_d[valid_f].mean() * 100) if valid_f.any() else 0.0

    green = (exg > exg_threshold) & (bright > MIN_BRIGHTNESS) & allowed
    green = ndimage.binary_opening(green, structure=np.ones((3, 3), bool))
    tree_m = green & (ndsm >= TREE_MIN_M)
    shrub_m = green & (ndsm >= SHRUB_MIN_M) & (ndsm < TREE_MIN_M)

    rng = np.random.default_rng(seed)
    # 3x3 mean colour for the tint (cheap, avoids single-pixel noise)
    rgb_s = np.stack([ndimage.uniform_filter(rgb_f[..., c], size=3) for c in range(3)], axis=2)
    nd_s = ndimage.uniform_filter(ndsm, size=3)

    def place(mask: np.ndarray, is_tree: bool) -> list[list]:
        ys, xs = np.nonzero(mask)
        if ys.size == 0:
            return []
        if ys.size > MAX_CANDIDATES:
            keep = rng.choice(ys.size, MAX_CANDIDATES, replace=False)
            ys, xs = ys[keep], xs[keep]
        order = rng.permutation(ys.size)
        ys, xs = ys[order], xs[order]
        cell = 6.0                                        # spatial hash pitch (m), > max radius
        grid: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
        out: list[list] = []
        jitter = rng.random((ys.size, 2))
        for i in range(ys.size):
            y, x = int(ys[i]), int(xs[i])
            px = (x + jitter[i, 0] - 0.5) * fine_sx - sx * (cols - 1) / 2
            pz = (y + jitter[i, 1] - 0.5) * fine_sz - sz * (rows - 1) / 2
            nd = float(nd_s[y, x])
            if is_tree:
                h = float(np.clip(nd, *TREE_H_RANGE))
                r = float(np.clip(0.30 * h, 1.7, 5.5))
            else:
                h = float(np.clip(nd + 0.5, *SHRUB_H_RANGE))
                r = 1.3
            gx, gz = int(px // cell), int(pz // cell)
            clash = False
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for (ox, oz, orad) in grid.get((gx + dx, gz + dz), ()):
                        if (ox - px) ** 2 + (oz - pz) ** 2 < (max(r, orad) * 0.9) ** 2:
                            clash = True
                            break
                    if clash:
                        break
                if clash:
                    break
            if clash:
                continue
            grid.setdefault((gx, gz), []).append((px, pz, r))
            yaw = float(rng.random() * 2 * math.pi)
            if is_tree:
                t = int(rng.choice(TREE_TYPES, p=TYPE_WEIGHTS))
                if h > 14 and rng.random() < 0.5:
                    t = 1                                   # tall stems read as conifers / eucalyptus
                g = SINK_FRAC * h
            else:
                t, g = BUSH_TYPE, 0.1 * h
            tint = _foliage_tint(rgb_s[y, x])
            out.append([round(px, 1), round(pz, 1), round(g, 2), round(h, 1), round(yaw, 2), t, tint])
        return out

    trees = place(tree_m, True)
    shrubs = place(shrub_m, False)
    rows_out = trees + shrubs
    perm = rng.permutation(len(rows_out))
    rows_out = [rows_out[i] for i in perm][: max(0, int(cap))]
    return {
        "instances": rows_out,
        "counts": {"tree": sum(1 for r in rows_out if r[5] != BUSH_TYPE),
                   "shrub": sum(1 for r in rows_out if r[5] == BUSH_TYPE),
                   "candidates_tree": len(trees), "candidates_shrub": len(shrubs)},
        "mask": {
            "green_pct": round(float(green.sum() / max(1, valid_f.sum()) * 100), 2),
            "tree_pct": round(float(tree_m.sum() / max(1, valid_f.sum()) * 100), 2),
            "shrub_pct": round(float(shrub_m.sum() / max(1, valid_f.sum()) * 100), 2),
            "excluded_mesh_pct": round(excluded_mesh_pct, 2),
        },
    }


# ------------------------------------------------------------------ vault I/O
def _paths(cid: str, vault: Path) -> dict[str, Path]:
    d = Path(vault) / "models" / cid
    lod = read_json(d / "dsm_lod.json", {}) or {}
    meta = read_json(d / "meta.json", {}) or {}
    return {
        "dir": d,
        "lod": d / "dsm_lod.json",
        "bin": d / str(lod.get("bin") or ""),
        "mask": d / str(lod.get("mask_bin") or "__none__"),
        "cov": d / "mesh_coverage.bin",
        "ortho": d / str(meta.get("ortho_asset") or "ortho.webp"),
        "out": d / "scatter.json",
    }


def fingerprint(cid: str, vault: Path = VAULT) -> str:
    """Hash of the inputs (+ generator version): a scatter is stale when it changes."""
    p = _paths(cid, vault)
    h = hashlib.sha256(f"v{VERSION}|{sorted(vars_for_hash())}".encode())
    for key in ("lod", "bin", "mask", "cov", "ortho"):
        f = p[key]
        if f.is_file():
            if key == "ortho":
                st = f.stat()
                h.update(f"{key}:{st.st_size}".encode())         # size only: the ortho is large
            else:
                h.update(f.read_bytes())
        else:
            h.update(f"{key}:missing".encode())
    return h.hexdigest()


def vars_for_hash():
    return [("exg", EXG_THRESHOLD), ("tree", TREE_MIN_M), ("shrub", SHRUB_MIN_M), ("sink", SINK_FRAC),
            ("margin", MESH_MARGIN_M), ("cap", CAP_TOTAL), ("open", OPENING_RADIUS_M), ("algo", 2)]


def validate(cid: str, vault: Path = VAULT) -> dict:
    """Return the scatter metadata when scatter.json exists and is fresh, else raise ValueError."""
    p = _paths(cid, vault)
    doc = read_json(p["out"], None)
    if not isinstance(doc, dict) or doc.get("version") != VERSION:
        raise ScatterError(f"{cid}: scatter.json missing or wrong version")
    if doc.get("source_fingerprint") != fingerprint(cid, vault):
        raise ScatterError(f"{cid}: scatter.json is stale")
    return doc


def build(cid: str, vault: Path = VAULT, *, force: bool = False) -> dict:
    p = _paths(cid, vault)
    lod = read_json(p["lod"], None)
    if not lod or not p["bin"].is_file():
        raise ScatterError(f"{cid}: no terrain (dsm_lod)")
    if not p["ortho"].is_file():
        raise ScatterError(f"{cid}: no ortho")
    if not force:
        try:
            return validate(cid, vault)
        except ScatterError:
            pass
    rows, cols = lod["grid"]
    hf = np.fromfile(p["bin"], dtype=np.float32)
    if hf.size != rows * cols:
        raise ScatterError(f"{cid}: dsm bin {hf.size} != grid {rows}x{cols}")
    hf = hf.reshape(rows, cols)
    if p["mask"].is_file() and p["mask"].stat().st_size == rows * cols:
        valid = np.fromfile(p["mask"], dtype=np.uint8).reshape(rows, cols) > 0
    else:
        valid = np.ones((rows, cols), bool)
    cov = None
    if p["cov"].is_file() and p["cov"].stat().st_size == rows * cols:
        cov = np.fromfile(p["cov"], dtype=np.uint8).reshape(rows, cols) > 0
    with Image.open(p["ortho"]) as im:
        im = im.convert("RGB")
        # bound the work: the ortho only needs ~2x the DSM resolution
        im.thumbnail((cols * UPSAMPLE, rows * UPSAMPLE), Image.BILINEAR)
        rgb = np.asarray(im, dtype=np.float32) / 255.0
    res = compute_scatter(rgb, hf, valid, cov, tuple(lod["spacing_m"]), _seed(cid))
    doc = {
        "version": VERSION,
        "clip_id": cid,
        "frame": {"origin": "dsm_center", "axes": "x=east,z=south,y=up",
                  "grid": lod["grid"], "spacing_m": lod["spacing_m"], "size_m": lod["size_m"],
                  "elev_min": lod["elev_min"]},
        "source_fingerprint": fingerprint(cid, vault),
        "params": dict((k, v) for k, v in vars_for_hash()),
        "types": TYPES,
        "counts": res["counts"],
        "mask": res["mask"],
        "row": ["x", "z", "g", "h", "yaw", "type", "tint"],
        "instances": res["instances"],
    }
    atomic_write_json(p["out"], doc, separators=(",", ":"))
    return doc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("clip_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--vault", default=str(VAULT))
    a = ap.parse_args()
    doc = build(a.clip_id, Path(a.vault), force=a.force)
    print(f"{a.clip_id}: {doc['counts']} mask={doc['mask']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
