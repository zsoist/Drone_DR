"""Deterministic local-only baseline views for compiler QA."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from world_compiler.aerobrain.cameras import CameraPose, CameraSet


def render_mesh_silhouette(
    camera: CameraPose,
    cameras: CameraSet,
    vertices_ab_m: np.ndarray,
    faces: np.ndarray,
    *,
    output_size: tuple[int, int] = (256, 144),
) -> np.ndarray:
    """Rasterize a binary mesh silhouette with the compiler's OpenSfM pinhole model."""
    vertices = np.asarray(vertices_ab_m, dtype=np.float64)
    triangles = np.asarray(faces, dtype=np.int64)
    width, height = (int(value) for value in output_size)
    if vertices.ndim != 2 or vertices.shape[1:] != (3,) or not len(vertices):
        raise ValueError("silhouette vertices must be a non-empty Nx3 array")
    if triangles.ndim != 2 or triangles.shape[1:] != (3,) or not len(triangles):
        raise ValueError("silhouette faces must be a non-empty Mx3 array")
    if width < 2 or height < 2 or int(triangles.min()) < 0 or int(triangles.max()) >= len(vertices):
        raise ValueError("silhouette raster configuration is invalid")
    topo = np.stack(
        (
            vertices[:, 0] - cameras.east_offset_m,
            -vertices[:, 2] - cameras.north_offset_m,
            vertices[:, 1] + cameras.elevation_origin_m,
        ),
        axis=-1,
    )
    projected = topo @ np.asarray(camera.rotation_topocentric_to_camera).T
    projected += np.asarray(camera.translation)
    depth = projected[:, 2]
    safe_depth = np.where(depth > 1e-9, depth, 1.0)
    normalized_x = projected[:, 0] / safe_depth
    normalized_y = projected[:, 1] / safe_depth
    pixels = np.stack(
        (
            (normalized_x - camera.principal_x) * camera.focal_x * width + width / 2.0,
            (normalized_y - camera.principal_y) * camera.focal_y * width + height / 2.0,
        ),
        axis=-1,
    )
    image = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(image)
    for face in triangles:
        if np.all(depth[face] > 1e-6):
            draw.polygon([tuple(point) for point in pixels[face]], fill=1)
    return np.asarray(image, dtype=bool)


def compare_mesh_silhouettes(
    cameras: CameraSet,
    reference_vertices: np.ndarray,
    reference_faces: np.ndarray,
    candidate_vertices: np.ndarray,
    candidate_faces: np.ndarray,
    *,
    output_size: tuple[int, int] = (256, 144),
    output_dir: Path | None = None,
) -> dict:
    """Compare two meshes in source-camera image space and optionally write overlays."""
    rows = []
    if output_dir is not None:
        Path(output_dir).mkdir(parents=True, exist_ok=True)
    for camera in cameras.poses:
        reference = render_mesh_silhouette(
            camera, cameras, reference_vertices, reference_faces, output_size=output_size
        )
        candidate = render_mesh_silhouette(
            camera, cameras, candidate_vertices, candidate_faces, output_size=output_size
        )
        union = reference | candidate
        if not union.any():
            continue
        intersection = reference & candidate
        iou = float(intersection.sum() / union.sum())
        row = {
            "camera_id": camera.camera_id,
            "iou": round(iou, 9),
            "reference_pixels": int(reference.sum()),
            "candidate_pixels": int(candidate.sum()),
            "union_pixels": int(union.sum()),
        }
        if output_dir is not None:
            overlay = np.zeros((*reference.shape, 3), dtype=np.uint8)
            overlay[reference] = (255, 68, 68)
            overlay[candidate] = np.maximum(overlay[candidate], (0, 210, 255))
            overlay[intersection] = (255, 255, 255)
            relative = f"silhouette_{len(rows):02d}.png"
            Image.fromarray(overlay).save(Path(output_dir) / relative)
            row["overlay"] = relative
        rows.append(row)
    if not rows:
        raise ValueError("selected cameras contain no rasterized mesh silhouettes")
    values = np.asarray([row["iou"] for row in rows], dtype=np.float64)
    return {
        "camera_count": len(rows),
        "median_iou": round(float(np.median(values)), 9),
        "min_iou": round(float(values.min()), 9),
        "max_iou": round(float(values.max()), 9),
        "cameras": rows,
    }


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
