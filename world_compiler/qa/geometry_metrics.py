"""Geometry accuracy summaries against independent reference samples."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from world_compiler.aerobrain.cameras import dsm_line_of_sight


def route_visibility_weighted_coverage(
    layers: list[tuple[str, np.ndarray, np.ndarray]],
    route_points_ab_m: np.ndarray,
    *,
    heightfield: np.ndarray,
    world_size_m: tuple[float, float],
    valid_mask: np.ndarray,
    provenance_classes: tuple[str, ...] = (),
) -> dict:
    """Weight provenance by route-visible projected triangle area potential.

    The proxy uses two-sided triangle orientation, inverse-square distance, and
    DSM line of sight. The route contract has no camera orientation, so it does
    not claim a camera-frustum or structure-occlusion measurement.
    """
    route = np.asarray(route_points_ab_m, dtype=np.float64)
    if route.ndim != 2 or route.shape[1:] != (3,) or not len(route) or not np.isfinite(route).all():
        raise ValueError("route points must be a non-empty finite Nx3 array")
    weighted: dict[str, float] = {name: 0.0 for name in provenance_classes}
    triangle_count: dict[str, int] = {name: 0 for name in provenance_classes}
    visible_triangle_count: dict[str, int] = {name: 0 for name in provenance_classes}
    for provenance, raw_vertices, raw_faces in layers:
        vertices = np.asarray(raw_vertices, dtype=np.float64)
        faces = np.asarray(raw_faces, dtype=np.int64)
        if not len(faces):
            weighted.setdefault(provenance, 0.0)
            triangle_count.setdefault(provenance, 0)
            visible_triangle_count.setdefault(provenance, 0)
            continue
        if (
            vertices.ndim != 2
            or vertices.shape[1:] != (3,)
            or faces.ndim != 2
            or faces.shape[1:] != (3,)
            or int(faces.min()) < 0
            or int(faces.max()) >= len(vertices)
            or not np.isfinite(vertices).all()
        ):
            raise ValueError("route coverage mesh is invalid")
        triangles = vertices[faces]
        edges_a = triangles[:, 1] - triangles[:, 0]
        edges_b = triangles[:, 2] - triangles[:, 0]
        cross = np.cross(edges_a, edges_b)
        double_area = np.linalg.norm(cross, axis=1)
        normals = np.divide(
            cross,
            double_area[:, None],
            out=np.zeros_like(cross),
            where=double_area[:, None] > 1e-12,
        )
        centroids = triangles.mean(axis=1)
        best = np.zeros(len(triangles), dtype=np.float64)
        for point in route:
            camera_to_surface = centroids - point
            distance = np.linalg.norm(camera_to_surface, axis=1)
            direction = np.divide(
                camera_to_surface,
                distance[:, None],
                out=np.zeros_like(camera_to_surface),
                where=distance[:, None] > 1e-9,
            )
            facing = np.abs(np.einsum("ij,ij->i", normals, direction))
            line_of_sight = dsm_line_of_sight(
                tuple(float(value) for value in point),
                centroids[:, 0],
                centroids[:, 1],
                centroids[:, 2],
                heightfield,
                world_size_m,
                valid_mask,
            )
            projected = np.divide(
                0.5 * double_area * facing,
                np.maximum(distance * distance, 1e-6),
            )
            best = np.maximum(best, np.where(line_of_sight, projected, 0.0))
        weighted[provenance] = weighted.get(provenance, 0.0) + float(best.sum())
        triangle_count[provenance] = triangle_count.get(provenance, 0) + int(len(faces))
        visible_triangle_count[provenance] = (
            visible_triangle_count.get(provenance, 0) + int((best > 0).sum())
        )
    total = sum(weighted.values())
    if total <= 0:
        raise ValueError("route has no DSM-visible projected triangle area")
    return {
        "version": 1,
        "route_visibility_weighted": True,
        "method": "max_two_sided_projected_area_inverse_square_dsm_los_v1",
        "route_sample_count": int(len(route)),
        "camera_frustum_applied": False,
        "structure_occlusion_applied": False,
        "triangle_count": dict(sorted(triangle_count.items())),
        "visible_triangle_count": dict(sorted(visible_triangle_count.items())),
        "projected_weight": {
            key: round(value, 12) for key, value in sorted(weighted.items())
        },
        "coverage_pct": {
            key: round(100.0 * value / total, 8) for key, value in sorted(weighted.items())
        },
        "limitations": [
            "route contract has positions and camera modes but no camera orientation or FOV",
            "DSM ray marching does not model self-occlusion by canonical structures",
            "weights measure maximum potential screen-space contribution, not captured Unreal pixels",
        ],
    }


def summarize_errors(errors_m: list[float]) -> dict:
    values = np.asarray(errors_m, dtype=np.float64)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("geometry errors must be a non-empty finite non-negative vector")
    median = float(np.median(values))
    p95 = float(np.percentile(values, 95))
    return {
        "sample_count": int(len(values)),
        "median_m": round(median, 9),
        "p95_m": round(p95, 9),
        "passes_median": median <= 0.15,
        "passes_p95": p95 <= 0.40,
    }


def load_collision_mesh(binary_path: Path, metadata_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Load the published v3 collider with validated vertices and triangle indices."""
    metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    vertices = int(metadata.get("verts") or 0)
    position_bytes = int(metadata.get("bytes_pos") or 0)
    if metadata.get("version") != 3 or vertices < 3 or position_bytes != vertices * 12:
        raise ValueError("collision metadata is invalid")
    raw = Path(binary_path).read_bytes()
    if len(raw) != position_bytes + int(metadata.get("bytes_idx") or -1):
        raise ValueError("collision binary length is inconsistent")
    points = np.frombuffer(raw, dtype="<f4", count=vertices * 3).reshape(-1, 3)
    if not np.isfinite(points).all():
        raise ValueError("collision vertices must be finite")
    indices = np.frombuffer(raw, dtype="<u4", offset=position_bytes)
    if len(indices) % 3 or not len(indices) or int(indices.max()) >= vertices:
        raise ValueError("collision triangle indices are invalid")
    return points.astype(np.float64), indices.reshape(-1, 3).astype(np.uint32)


def load_collision_vertices(binary_path: Path, metadata_path: Path) -> np.ndarray:
    """Backward-compatible vertex-only reader."""
    return load_collision_mesh(binary_path, metadata_path)[0]


def source_vertex_agreement(
    candidate_vertices: np.ndarray,
    source_vertices: np.ndarray,
    *,
    center_ab_m: tuple[float, float],
    size_m: float,
    chunk_size: int = 256,
) -> dict:
    """Measure a conservative vertex proxy, explicitly ineligible as independent truth."""
    candidate = np.asarray(candidate_vertices, dtype=np.float64)
    source = np.asarray(source_vertices, dtype=np.float64)
    if candidate.ndim != 2 or candidate.shape[1:] != (3,) or not len(candidate):
        raise ValueError("candidate vertices must be a non-empty Nx3 array")
    if source.ndim != 2 or source.shape[1:] != (3,) or not len(source):
        raise ValueError("source vertices must be a non-empty Nx3 array")
    if not np.isfinite(candidate).all() or not np.isfinite(source).all():
        raise ValueError("agreement vertices must be finite")
    half = float(size_m) / 2.0
    center_x, center_z = center_ab_m
    inside = (
        (source[:, 0] >= center_x - half)
        & (source[:, 0] <= center_x + half)
        & (source[:, 2] >= center_z - half)
        & (source[:, 2] <= center_z + half)
    )
    cropped = source[inside]
    if not len(cropped):
        raise ValueError("source collider has no vertices inside the Hero Cell")
    distances = []
    for start in range(0, len(candidate), chunk_size):
        delta = candidate[start:start + chunk_size, None, :] - cropped[None, :, :]
        distances.extend(np.sqrt(np.min(np.einsum("ijk,ijk->ij", delta, delta), axis=1)))
    summary = summarize_errors([float(value) for value in distances])
    return {
        "version": 1,
        "status": "measured_source_vertex_proxy",
        "reference": "published structural collider from the same reconstruction",
        "independent_ground_truth": False,
        "acceptance_gate_eligible": False,
        "direction": "clean_structure_vertices_to_nearest_source_collider_vertex",
        "source_vertex_count_in_aoi": int(len(cropped)),
        "candidate_vertex_count": int(len(candidate)),
        "proxy": summary,
        "note": "Useful regression evidence; it cannot prove the independent geometry gate.",
    }


def source_surface_agreement(
    candidate_vertices: np.ndarray,
    source_vertices: np.ndarray,
    source_faces: np.ndarray,
    *,
    center_ab_m: tuple[float, float],
    size_m: float,
    nearest_triangles: int = 64,
) -> dict:
    """Approximate point-to-surface distance using nearby source triangle centroids."""
    candidate, distances, _, triangle_count = source_surface_distances(
        candidate_vertices,
        source_vertices,
        source_faces,
        center_ab_m=center_ab_m,
        size_m=size_m,
        nearest_triangles=nearest_triangles,
    )
    summary = summarize_errors(distances.tolist())
    return {
        "version": 1,
        "status": "measured_source_surface_proxy",
        "reference": "published structural collider from the same reconstruction",
        "independent_ground_truth": False,
        "acceptance_gate_eligible": False,
        "direction": "unique_clean_structure_vertices_to_nearby_source_triangles",
        "method": "triangle_centroid_kdtree_then_exact_point_triangle",
        "nearest_triangles_per_sample": min(max(1, int(nearest_triangles)), triangle_count),
        "source_triangle_count_in_aoi": triangle_count,
        "candidate_vertex_count": int(len(candidate)),
        "proxy": summary,
        "note": "Useful regression evidence; it cannot prove the independent geometry gate.",
    }


def source_surface_distances(
    candidate_vertices: np.ndarray,
    source_vertices: np.ndarray,
    source_faces: np.ndarray,
    *,
    center_ab_m: tuple[float, float],
    size_m: float,
    nearest_triangles: int = 64,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """Return unique candidates, distances, inverse indices, and AOI triangle count."""
    try:
        from scipy.spatial import cKDTree
        from trimesh.triangles import closest_point
    except ImportError as error:  # pragma: no cover - exercised by build fallback
        raise ValueError("surface agreement dependencies are unavailable") from error
    candidate, inverse = np.unique(
        np.round(np.asarray(candidate_vertices, dtype=np.float64), 9),
        axis=0,
        return_inverse=True,
    )
    source = np.asarray(source_vertices, dtype=np.float64)
    faces = np.asarray(source_faces, dtype=np.uint32)
    if candidate.ndim != 2 or candidate.shape[1:] != (3,) or not len(candidate):
        raise ValueError("candidate vertices must be a non-empty Nx3 array")
    if source.ndim != 2 or source.shape[1:] != (3,) or not len(source):
        raise ValueError("source vertices must be a non-empty Nx3 array")
    if faces.ndim != 2 or faces.shape[1:] != (3,) or not len(faces):
        raise ValueError("source faces must be a non-empty Mx3 array")
    if int(faces.max()) >= len(source) or not np.isfinite(candidate).all() or not np.isfinite(source).all():
        raise ValueError("surface agreement mesh is invalid")
    half = float(size_m) / 2.0
    center_x, center_z = center_ab_m
    triangles = source[faces]
    triangle_min = triangles.min(axis=1)
    triangle_max = triangles.max(axis=1)
    inside = (
        (triangle_max[:, 0] >= center_x - half)
        & (triangle_min[:, 0] <= center_x + half)
        & (triangle_max[:, 2] >= center_z - half)
        & (triangle_min[:, 2] <= center_z + half)
    )
    triangles = triangles[inside]
    if not len(triangles):
        raise ValueError("source collider has no triangles inside the Hero Cell")
    centroids = triangles.mean(axis=1)
    count = min(max(1, int(nearest_triangles)), len(triangles))
    _, triangle_ids = cKDTree(centroids).query(candidate, k=count)
    triangle_ids = np.asarray(triangle_ids).reshape(len(candidate), count)
    distances = []
    for point, ids in zip(candidate, triangle_ids):
        nearby = triangles[ids]
        projected = closest_point(nearby, np.repeat(point[None, :], len(nearby), axis=0))
        distances.append(float(np.sqrt(np.min(np.sum((projected - point) ** 2, axis=1)))))
    return candidate, np.asarray(distances, dtype=np.float64), inverse, int(len(triangles))
