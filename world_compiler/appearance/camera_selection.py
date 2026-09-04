"""Rank compatible real camera observations per final surface patch."""

from __future__ import annotations

from dataclasses import dataclass

from world_compiler.evidence.visibility import unit


@dataclass(frozen=True)
class CameraObservation:
    camera_id: str
    visible: bool
    sharpness: float
    projected_density: float
    incidence_quality: float
    exposure_quality: float
    geometry_confidence: float
    dynamic_cleanliness: float
    exposure_value: float


@dataclass(frozen=True)
class RankedObservation:
    observation: CameraObservation
    score: float


def _score(observation: CameraObservation) -> float:
    if not observation.visible:
        return 0.0
    factors = (
        unit(observation.sharpness, "sharpness"),
        unit(observation.projected_density, "projected_density"),
        unit(observation.incidence_quality, "incidence_quality"),
        unit(observation.exposure_quality, "exposure_quality"),
        unit(observation.geometry_confidence, "geometry_confidence"),
        unit(observation.dynamic_cleanliness, "dynamic_cleanliness"),
    )
    exposure_value = unit(observation.exposure_value, "exposure_value")
    exposure_neutrality = max(0.0, 1.0 - abs(exposure_value - 0.5) * 2.0)
    score = exposure_neutrality
    for factor in factors:
        score *= factor
    return round(score, 12)


def rank_observations(observations: list[CameraObservation]) -> list[RankedObservation]:
    ranked = [RankedObservation(row, _score(row)) for row in observations]
    return sorted(ranked, key=lambda row: (-row.score, row.observation.camera_id))


def select_compatible_blend(
    ranked: list[RankedObservation],
    *,
    exposure_tolerance: float = 0.2,
    limit: int = 4,
) -> list[RankedObservation]:
    usable = [row for row in ranked if row.score > 0]
    if not usable:
        return []
    base = usable[0].observation.exposure_value
    return [
        row
        for row in usable
        if abs(row.observation.exposure_value - base) <= exposure_tolerance
    ][:limit]
