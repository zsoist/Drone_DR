"""Geometry accuracy summaries against independent reference samples."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


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


def load_collision_vertices(binary_path: Path, metadata_path: Path) -> np.ndarray:
    """Load the published v3 collider without interpreting its triangle payload."""
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
    return points.astype(np.float64)


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
