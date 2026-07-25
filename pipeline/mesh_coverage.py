#!/usr/bin/env python3
"""Rasterize structural mesh triangles into the FLIGHTVERSE DSM grid."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

import collision_bake

VAULT = collision_bake.VAULT
VERSION = 1


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _atomic_write(path: Path, data: bytes) -> None:
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _rasterize_triangle(
    mask: np.ndarray,
    triangle: np.ndarray,
    spacing_x: float,
    spacing_z: float,
) -> None:
    rows, cols = mask.shape
    half_width = spacing_x * (cols - 1) / 2
    half_height = spacing_z * (rows - 1) / 2
    grid = np.empty((3, 2), dtype=np.float64)
    grid[:, 0] = (triangle[:, 0] + half_width) / spacing_x
    grid[:, 1] = (triangle[:, 2] + half_height) / spacing_z
    x0 = max(0, int(np.floor(grid[:, 0].min())))
    x1 = min(cols - 1, int(np.ceil(grid[:, 0].max())))
    z0 = max(0, int(np.floor(grid[:, 1].min())))
    z1 = min(rows - 1, int(np.ceil(grid[:, 1].max())))
    if x0 > x1 or z0 > z1:
        return

    a, b, c = grid
    denominator = (b[1] - c[1]) * (a[0] - c[0])
    denominator += (c[0] - b[0]) * (a[1] - c[1])
    if abs(denominator) <= 1e-12:
        return
    xs = np.arange(x0, x1 + 1, dtype=np.float64)
    zs = np.arange(z0, z1 + 1, dtype=np.float64)
    px, pz = np.meshgrid(xs, zs)
    alpha = ((b[1] - c[1]) * (px - c[0])
             + (c[0] - b[0]) * (pz - c[1])) / denominator
    beta = ((c[1] - a[1]) * (px - c[0])
            + (a[0] - c[0]) * (pz - c[1])) / denominator
    gamma = 1.0 - alpha - beta
    inside = (alpha >= -1e-8) & (beta >= -1e-8) & (gamma >= -1e-8)
    mask[z0:z1 + 1, x0:x1 + 1] |= inside.astype(np.uint8)
    if not inside.any():
        centroid_x = int(np.rint(grid[:, 0].mean()))
        centroid_z = int(np.rint(grid[:, 1].mean()))
        if 0 <= centroid_x < cols and 0 <= centroid_z < rows:
            mask[centroid_z, centroid_x] = 1


def _rasterize_triangles(
    mask: np.ndarray,
    triangles: np.ndarray,
    spacing_x: float,
    spacing_z: float,
) -> None:
    """Rasterize small photogrammetry triangles in bounded vectorized batches."""
    rows, cols = mask.shape
    half_width = spacing_x * (cols - 1) / 2
    half_height = spacing_z * (rows - 1) / 2
    batch_size = 100_000
    for start in range(0, len(triangles), batch_size):
        batch = triangles[start:start + batch_size]
        grid = np.empty((len(batch), 3, 2), dtype=np.float64)
        grid[:, :, 0] = (batch[:, :, 0] + half_width) / spacing_x
        grid[:, :, 1] = (batch[:, :, 2] + half_height) / spacing_z
        lower = np.floor(grid.min(axis=1)).astype(np.int64)
        upper = np.ceil(grid.max(axis=1)).astype(np.int64)
        small = ((upper[:, 0] - lower[:, 0]) <= 2) & (
            (upper[:, 1] - lower[:, 1]) <= 2
        )

        small_grid = grid[small]
        small_lower = lower[small]
        if len(small_grid):
            offsets = np.asarray(
                [(x, z) for z in range(3) for x in range(3)],
                dtype=np.int64,
            )
            points = small_lower[:, None, :] + offsets[None, :, :]
            a = small_grid[:, 0, :]
            b = small_grid[:, 1, :]
            c = small_grid[:, 2, :]
            denominator = (
                (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0])
                + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
            )
            safe_denominator = np.where(
                np.abs(denominator) > 1e-12,
                denominator,
                np.nan,
            )
            px = points[:, :, 0]
            pz = points[:, :, 1]
            alpha = (
                (b[:, None, 1] - c[:, None, 1]) * (px - c[:, None, 0])
                + (c[:, None, 0] - b[:, None, 0]) * (pz - c[:, None, 1])
            ) / safe_denominator[:, None]
            beta = (
                (c[:, None, 1] - a[:, None, 1]) * (px - c[:, None, 0])
                + (a[:, None, 0] - c[:, None, 0]) * (pz - c[:, None, 1])
            ) / safe_denominator[:, None]
            gamma = 1.0 - alpha - beta
            inside = (
                (alpha >= -1e-8) & (beta >= -1e-8) & (gamma >= -1e-8)
                & (px >= 0) & (px < cols) & (pz >= 0) & (pz < rows)
            )
            selected_z, selected_x = np.nonzero(inside)
            if len(selected_z):
                mask[pz[selected_z, selected_x], px[selected_z, selected_x]] = 1

            uncovered = ~inside.any(axis=1)
            if uncovered.any():
                centroids = np.rint(small_grid[uncovered].mean(axis=1)).astype(np.int64)
                in_grid = (
                    (centroids[:, 0] >= 0) & (centroids[:, 0] < cols)
                    & (centroids[:, 1] >= 0) & (centroids[:, 1] < rows)
                )
                mask[centroids[in_grid, 1], centroids[in_grid, 0]] = 1

        for triangle in batch[~small]:
            _rasterize_triangle(mask, triangle, spacing_x, spacing_z)


def _dilate_one(mask: np.ndarray) -> np.ndarray:
    padded = np.pad(mask, 1, mode="constant")
    dilated = np.zeros_like(mask)
    for dz in range(3):
        for dx in range(3):
            dilated |= padded[dz:dz + mask.shape[0], dx:dx + mask.shape[1]]
    return dilated


def build(cid: str, *, vault: Path = VAULT) -> dict:
    vault = Path(vault)
    model_dir = vault / "models" / cid
    collider = collision_bake.validate(cid, vault=vault)
    lod = _load_json(model_dir / "dsm_lod.json")
    rows, cols = (int(value) for value in lod["grid"])
    spacing_x, spacing_z = (float(value) for value in lod["spacing_m"])
    raw = (model_dir / "collision.bin").read_bytes()
    positions = np.frombuffer(
        raw[:int(collider["bytes_pos"])],
        dtype="<f4",
    ).reshape(-1, 3)
    indices = np.frombuffer(
        raw[int(collider["bytes_pos"]):],
        dtype="<u4",
    ).reshape(-1, 3)

    mask = np.zeros((rows, cols), dtype=np.uint8)
    _rasterize_triangles(
        mask,
        positions[indices],
        spacing_x,
        spacing_z,
    )
    mask = _dilate_one(mask)
    meta = {
        "version": VERSION,
        "bin": "mesh_coverage.bin",
        "grid": [rows, cols],
        "covered_pct": round(float(mask.mean() * 100), 2),
        "source_fingerprint": collider["source_fingerprint"],
    }
    _atomic_write(model_dir / "mesh_coverage.bin", mask.tobytes())
    _atomic_write(
        model_dir / "mesh_coverage.json",
        json.dumps(meta, sort_keys=True, separators=(",", ":")).encode(),
    )
    return meta


def validate(cid: str, *, vault: Path = VAULT) -> dict:
    vault = Path(vault)
    model_dir = vault / "models" / cid
    collider = collision_bake.validate(cid, vault=vault)
    meta = _load_json(model_dir / "mesh_coverage.json")
    if meta.get("version") != VERSION:
        raise ValueError(f"{cid}: versión de mesh coverage inválida")
    if meta.get("source_fingerprint") != collider.get("source_fingerprint"):
        raise ValueError(f"{cid}: mesh coverage fingerprint stale")
    grid = meta.get("grid")
    if not isinstance(grid, list) or len(grid) != 2:
        raise ValueError(f"{cid}: grid de mesh coverage inválido")
    path = model_dir / str(meta.get("bin") or "")
    expected = int(grid[0]) * int(grid[1])
    if expected <= 0 or not path.exists() or path.stat().st_size != expected:
        raise ValueError(f"{cid}: mesh coverage truncado")
    return meta


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("uso: mesh_coverage.py <clip_id>")
    print(json.dumps(build(sys.argv[1]), indent=1))
