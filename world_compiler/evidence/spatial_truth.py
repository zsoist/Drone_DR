"""Conservative raster Truth Field derived from real camera frustum support."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .truth_field import TruthClass


@dataclass(frozen=True)
class SpatialTruth:
    classes: np.ndarray
    confidence: np.ndarray
    coverage_pct: dict[str, float]
    calibration_id: str
    occlusion_validated: bool


def build_spatial_truth(
    visible_count: np.ndarray,
    angular_diversity: np.ndarray,
    *,
    occlusion_validated: bool,
    calibration_id: str = "truth-spatial-r0-v1",
) -> SpatialTruth:
    count = np.asarray(visible_count)
    diversity = np.asarray(angular_diversity, dtype=np.float64)
    if count.shape != diversity.shape or count.ndim != 2:
        raise ValueError("spatial truth inputs must share one 2D shape")
    if (count < 0).any() or not np.isfinite(diversity).all():
        raise ValueError("spatial truth inputs are invalid")
    diversity = np.clip(diversity, 0.0, 1.0)
    support = np.clip(count.astype(np.float64) / 3.0, 0.0, 1.0)
    if occlusion_validated:
        confidence = np.where(count > 0, 0.35 + 0.35 * support + 0.30 * diversity, 0.0)
    else:
        confidence = np.where(count > 0, np.minimum(0.49, 0.20 + 0.20 * support + 0.09 * diversity), 0.0)
    classes = np.full(count.shape, TruthClass.UNKNOWN.value, dtype="<U24")
    classes[count > 0] = TruthClass.OBSERVED_WEAK.value
    if occlusion_validated:
        multi = (count >= 3) & (diversity >= 0.25) & (confidence >= 0.55)
        classes[multi] = TruthClass.OBSERVED_MULTI_VIEW.value
    total = int(classes.size)
    coverage = {
        truth_class.value: round(100.0 * int(np.count_nonzero(classes == truth_class.value)) / total, 8)
        for truth_class in TruthClass
    }
    return SpatialTruth(classes, confidence.astype(np.float32), coverage, calibration_id, occlusion_validated)
