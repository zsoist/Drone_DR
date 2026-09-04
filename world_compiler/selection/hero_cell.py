"""Deterministic 100×100 m selection from measured local-frame evidence."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .view_scoring import normalized


SCORE_WEIGHTS = {
    "multi_view_coverage": 0.25,
    "angular_diversity": 0.18,
    "source_sharpness": 0.14,
    "geometry_completeness": 0.12,
    "low_GSD_detail": 0.10,
    "semantic_richness": 0.08,
    "roof_and_vertical_surface_mix": 0.06,
    "route_playability": 0.04,
    "clean_AOI_boundary": 0.03,
}


@dataclass(frozen=True)
class MetricComponent:
    raw: float | None
    normalized: float
    available: bool
    weighted: float
    source: str | None
    reason: str | None


@dataclass(frozen=True)
class CandidateScore:
    total: float
    components: dict[str, MetricComponent]


@dataclass(frozen=True)
class CandidateEvidence:
    center_ab_m: tuple[float, float]
    metrics: dict[str, Any]
    valid_fraction: float


@dataclass(frozen=True)
class CandidateResult:
    center_ab_m: tuple[float, float]
    score: CandidateScore
    valid_fraction: float
    rejection_reason: str | None = None


@dataclass(frozen=True)
class SelectionReport:
    size_m: float
    selected: CandidateResult
    eligible: tuple[CandidateResult, ...]
    rejected: tuple[CandidateResult, ...]


def score_candidate(metrics: dict[str, Any]) -> CandidateScore:
    components: dict[str, MetricComponent] = {}
    total = 0.0
    for name, weight in SCORE_WEIGHTS.items():
        raw = metrics.get(name)
        source = None
        reason = None
        if isinstance(raw, dict):
            source = str(raw.get("source")) if raw.get("source") is not None else None
            reason = str(raw.get("reason")) if raw.get("reason") is not None else None
            raw = raw.get("value")
        if raw is None:
            component = MetricComponent(None, 0.0, False, 0.0, source, reason)
        else:
            value = normalized(raw)
            weighted = value * weight
            component = MetricComponent(float(raw), value, True, weighted, source, reason)
            total += weighted
        components[name] = component
    return CandidateScore(round(total, 12), components)


def enumerate_grid(
    extent_size_m: tuple[float, float], size_m: float = 100.0, step_m: float = 10.0
) -> list[tuple[float, float]]:
    width, height = (float(value) for value in extent_size_m)
    size_m = float(size_m)
    step_m = float(step_m)
    if size_m <= 0 or step_m <= 0:
        raise ValueError("size and step must be positive")
    if width < size_m or height < size_m:
        return []

    def axis(extent: float) -> list[float]:
        count = math.floor(((extent - size_m) / 2.0 + 1e-9) / step_m)
        return [round(index * step_m, 6) for index in range(-count, count + 1)]

    return [(x, z) for x in axis(width) for z in axis(height)]


def _contained(
    center: tuple[float, float], extent: tuple[float, float], size_m: float
) -> bool:
    x, z = center
    width, height = extent
    half = size_m / 2.0
    return abs(x) + half <= width / 2.0 + 1e-9 and abs(z) + half <= height / 2.0 + 1e-9


def select_hero_cell(
    scene: Any,
    evidence: list[CandidateEvidence],
    size_m: float = 100.0,
    *,
    min_valid_fraction: float = 0.85,
) -> SelectionReport:
    extent = tuple(float(value) for value in scene.world_size_m)
    eligible: list[CandidateResult] = []
    rejected: list[CandidateResult] = []
    for row in evidence:
        score = score_candidate(row.metrics)
        reason = None
        if not _contained(row.center_ab_m, extent, size_m):
            reason = "outside_verified_square_extent"
        elif normalized(row.valid_fraction) < min_valid_fraction:
            reason = "excessive_nodata"
        result = CandidateResult(
            tuple(float(value) for value in row.center_ab_m),
            score,
            normalized(row.valid_fraction),
            reason,
        )
        (rejected if reason else eligible).append(result)
    if not eligible:
        raise ValueError("no eligible Hero Cell candidate")
    eligible.sort(key=lambda row: (-row.score.total, row.center_ab_m[0], row.center_ab_m[1]))
    rejected.sort(key=lambda row: (row.center_ab_m[0], row.center_ab_m[1]))
    return SelectionReport(size_m, eligible[0], tuple(eligible), tuple(rejected))


def _raster_window(
    center: tuple[float, float],
    world_size_m: tuple[float, float],
    size_m: float,
    shape: tuple[int, int],
) -> tuple[slice, slice]:
    rows, cols = shape
    width, height = world_size_m
    x, z = center
    x0 = (x - size_m / 2 + width / 2) / width * cols
    x1 = (x + size_m / 2 + width / 2) / width * cols
    z0 = (z - size_m / 2 + height / 2) / height * rows
    z1 = (z + size_m / 2 + height / 2) / height * rows
    col0, col1 = max(0, math.floor(x0)), min(cols, math.ceil(x1))
    row0, row1 = max(0, math.floor(z0)), min(rows, math.ceil(z1))
    return slice(row0, row1), slice(col0, col1)


def raster_candidate_evidence(
    *,
    centers: list[tuple[float, float]],
    world_size_m: tuple[float, float],
    size_m: float,
    valid_mask: np.ndarray,
    mesh_coverage: np.ndarray,
    heightfield: np.ndarray,
    global_metrics: dict[str, Any] | None = None,
) -> list[CandidateEvidence]:
    valid = np.asarray(valid_mask)
    mesh = np.asarray(mesh_coverage)
    height = np.asarray(heightfield, dtype=np.float64)
    if valid.ndim != 2 or mesh.shape != valid.shape or height.shape != valid.shape:
        raise ValueError("selection rasters must share one 2D shape")
    if not np.isfinite(height).all():
        raise ValueError("heightfield must be finite")
    width, world_height = (float(value) for value in world_size_m)
    out: list[CandidateEvidence] = []
    for center in centers:
        row_slice, col_slice = _raster_window(center, (width, world_height), size_m, valid.shape)
        valid_patch = valid[row_slice, col_slice] > 0
        mesh_patch = mesh[row_slice, col_slice]
        height_patch = height[row_slice, col_slice]
        valid_fraction = float(valid_patch.mean()) if valid_patch.size else 0.0
        mesh_fraction = float((mesh_patch > 0).mean()) if mesh_patch.size else 0.0
        if height_patch.size:
            vertical_range = float(np.percentile(height_patch, 95) - np.percentile(height_patch, 5))
        else:
            vertical_range = 0.0
        x, z = center
        clearance = min(
            width / 2 - abs(x) - size_m / 2,
            world_height / 2 - abs(z) - size_m / 2,
        )
        metrics = dict(global_metrics or {})
        metrics.update(
            {
                "geometry_completeness": {
                    "value": mesh_fraction,
                    "source": "mesh_coverage raster",
                },
                "roof_and_vertical_surface_mix": {
                    "value": min(1.0, vertical_range / 20.0),
                    "source": "heightfield p95-p05",
                },
                "route_playability": {
                    "value": valid_fraction,
                    "source": "valid terrain mask",
                },
                "clean_AOI_boundary": {
                    "value": max(0.0, min(1.0, clearance / max(size_m / 2, 1.0))),
                    "source": "verified square extent",
                },
            }
        )
        out.append(CandidateEvidence(center, metrics, valid_fraction))
    return out
