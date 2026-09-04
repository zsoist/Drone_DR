"""Deterministic local-only baseline views for compiler QA."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def crop_source_ortho(
    source: Path,
    center_ab_m: tuple[float, float],
    world_size_m: tuple[float, float],
    size_m: float,
) -> Image.Image:
    image = Image.open(source).convert("RGB")
    width_m, depth_m = (float(value) for value in world_size_m)
    cx, cz = center_ab_m
    half = float(size_m) / 2.0
    left = round((cx - half + width_m / 2.0) / width_m * image.width)
    right = round((cx + half + width_m / 2.0) / width_m * image.width)
    top = round((cz - half + depth_m / 2.0) / depth_m * image.height)
    bottom = round((cz + half + depth_m / 2.0) / depth_m * image.height)
    box = (
        max(0, min(image.width, left)),
        max(0, min(image.height, top)),
        max(0, min(image.width, right)),
        max(0, min(image.height, bottom)),
    )
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("AOI does not overlap source ortho")
    return image.crop(box)


def render_dsm_hillshade(
    heightfield: np.ndarray,
    spacing_m: tuple[float, float],
    *,
    output_size: int = 1024,
) -> Image.Image:
    height = np.asarray(heightfield, dtype=np.float64)
    if height.ndim != 2 or min(height.shape) < 2 or not np.isfinite(height).all():
        raise ValueError("hillshade heightfield is invalid")
    sx, sz = (float(value) for value in spacing_m)
    dz, dx = np.gradient(height, sz, sx)
    normals = np.stack((-dx, np.ones_like(height), -dz), axis=-1)
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 1e-9)
    light = np.asarray([-0.45, 0.72, -0.53], dtype=np.float64)
    light /= np.linalg.norm(light)
    shade = np.clip(np.einsum("...i,i->...", normals, light), 0.0, 1.0)
    shade = np.rint((0.18 + 0.82 * shade) * 255.0).astype(np.uint8)
    return Image.fromarray(shade).resize((output_size, output_size), Image.Resampling.BILINEAR)


def render_truth_debug(
    provenance_rgb: np.ndarray,
    confidence_u8: np.ndarray,
    *,
    output_size: int = 1024,
) -> Image.Image:
    provenance = np.asarray(provenance_rgb, dtype=np.uint8)
    confidence = np.asarray(confidence_u8, dtype=np.uint8)
    if provenance.shape != (*confidence.shape, 3) or confidence.ndim != 2:
        raise ValueError("truth debug arrays are incompatible")
    provenance_image = Image.fromarray(provenance).resize(
        (output_size, output_size), Image.Resampling.NEAREST
    )
    confidence_image = Image.fromarray(confidence).convert("RGB").resize(
        (output_size, output_size), Image.Resampling.NEAREST
    )
    output = Image.new("RGB", (output_size * 2, output_size))
    output.paste(provenance_image, (0, 0))
    output.paste(confidence_image, (output_size, 0))
    return output
