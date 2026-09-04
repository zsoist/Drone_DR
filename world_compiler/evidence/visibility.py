"""Calibrated visibility support used by Truth Field classification."""

from __future__ import annotations

import math


OBSERVED_WEIGHTS = {
    "angular_diversity": 0.15,
    "sharpness": 0.12,
    "projected_density": 0.14,
    "exposure_consistency": 0.08,
    "reprojection_quality": 0.15,
    "occlusion_confidence": 0.16,
    "geometry_agreement": 0.12,
    "dynamic_cleanliness": 0.05,
    "boundary_support": 0.03,
}


def unit(value: object, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be numeric") from error
    if not math.isfinite(number) or number < 0 or number > 1:
        raise ValueError(f"{label} must be finite within [0,1]")
    return number


def observed_confidence(values: dict[str, float], camera_count: int) -> float:
    """Combine image/geometry support while strongly penalizing occlusion."""
    if camera_count <= 0:
        return 0.0
    normalized = {name: unit(values[name], name) for name in OBSERVED_WEIGHTS}
    base = sum(normalized[name] * weight for name, weight in OBSERVED_WEIGHTS.items())
    camera_factor = 0.55 + 0.45 * min(1.0, camera_count / 3.0)
    visibility_factor = 0.35 + 0.65 * normalized["occlusion_confidence"]
    return round(max(0.0, min(1.0, base * camera_factor * visibility_factor)), 6)
