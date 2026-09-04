"""Prioritize safe data acquisition for the most consequential unknown regions."""

from __future__ import annotations

from dataclasses import dataclass

from world_compiler.evidence.visibility import unit


SAFETY_LEGAL_NOTE = (
    "Recommendation only: a qualified operator must approve airspace, privacy, "
    "weather, line-of-sight, and local flight limits before capture."
)


@dataclass(frozen=True)
class MissingRegion:
    region_id: str
    uncertainty: float
    expected_visibility: float
    gameplay_relevance: float
    recommended_camera_position: tuple[float, float, float]
    agl_m: float
    gimbal_pitch_deg: float
    heading_deg: float
    pass_radius_m: float
    reason: str


def rank_missing_views(regions: list[MissingRegion]) -> dict:
    ranked: list[tuple[float, MissingRegion]] = []
    for region in regions:
        gain = (
            unit(region.uncertainty, "uncertainty")
            * unit(region.expected_visibility, "expected_visibility")
            * unit(region.gameplay_relevance, "gameplay_relevance")
        )
        ranked.append((round(gain, 12), region))
    ranked.sort(key=lambda item: (-item[0], item[1].region_id))
    return {
        "version": 1,
        "requests": [
            {
                "rank": rank,
                "target_region": region.region_id,
                "reason": region.reason,
                "expected_information_gain": gain,
                "camera_position_local_m": list(region.recommended_camera_position),
                "agl_m": region.agl_m,
                "gimbal_pitch_deg": region.gimbal_pitch_deg,
                "heading_deg": region.heading_deg,
                "pass_radius_m": region.pass_radius_m,
                "safety_legal_note": SAFETY_LEGAL_NOTE,
            }
            for rank, (gain, region) in enumerate(ranked, start=1)
        ],
    }
