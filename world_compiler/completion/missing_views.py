"""Prioritize safe data acquisition for the most consequential unknown regions."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

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
    target_position: tuple[float, float, float] | None = None


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
                "target_position_local_m": (
                    list(region.target_position) if region.target_position is not None else None
                ),
                "agl_m": region.agl_m,
                "gimbal_pitch_deg": region.gimbal_pitch_deg,
                "heading_deg": region.heading_deg,
                "pass_radius_m": region.pass_radius_m,
                "safety_legal_note": SAFETY_LEGAL_NOTE,
            }
            for rank, (gain, region) in enumerate(ranked, start=1)
        ],
    }


def derive_missing_views(
    *,
    x_ab_m: np.ndarray,
    z_ab_m: np.ndarray,
    height_ab_m: np.ndarray,
    confidence: np.ndarray,
    visible_count: np.ndarray,
    angular_diversity: np.ndarray,
    vegetation_mask: np.ndarray | None = None,
    limit: int = 5,
    minimum_spacing_m: float = 15.0,
) -> dict:
    """Create deterministic advisory reflights from the weakest measured support cells."""
    arrays = [
        np.asarray(value)
        for value in (x_ab_m, z_ab_m, height_ab_m, confidence, visible_count, angular_diversity)
    ]
    shape = arrays[0].shape
    if len(shape) != 2 or any(value.shape != shape for value in arrays):
        raise ValueError("missing-view evidence rasters must share one 2D shape")
    if any(not np.isfinite(value).all() for value in arrays):
        raise ValueError("missing-view evidence must be finite")
    vegetation = (
        np.zeros(shape, dtype=bool)
        if vegetation_mask is None
        else np.asarray(vegetation_mask, dtype=bool)
    )
    if vegetation.shape != shape:
        raise ValueError("vegetation mask must match missing-view evidence")
    max_visible = max(1.0, float(arrays[4].max()))
    weakness = 0.55 * (1.0 - arrays[4] / max_visible)
    weakness += 0.30 * (1.0 - np.clip(arrays[5], 0.0, 1.0))
    weakness += 0.15 * (1.0 - np.clip(arrays[3], 0.0, 1.0))
    order = np.argsort(-weakness.ravel(), kind="stable")
    selected: list[tuple[int, int]] = []
    for flat_index in order:
        row, col = np.unravel_index(int(flat_index), shape)
        x = float(arrays[0][row, col])
        z = float(arrays[1][row, col])
        if any(math.hypot(x - float(arrays[0][r, c]), z - float(arrays[1][r, c])) < minimum_spacing_m for r, c in selected):
            continue
        selected.append((row, col))
        if len(selected) >= limit:
            break
    regions = []
    center_x = float(np.median(arrays[0]))
    center_z = float(np.median(arrays[1]))
    x_min, x_max = float(arrays[0].min()), float(arrays[0].max())
    z_min, z_max = float(arrays[1].min()), float(arrays[1].max())
    for row, col in selected:
        target_x = float(arrays[0][row, col])
        target_z = float(arrays[1][row, col])
        target_y = float(arrays[2][row, col])
        direction = np.asarray([target_x - center_x, target_z - center_z], dtype=float)
        norm = float(np.linalg.norm(direction))
        if norm < 1e-9:
            direction = np.asarray([1.0, 0.0])
            norm = 1.0
        offset = direction / norm * 12.0
        camera_x = float(np.clip(target_x - offset[0], x_min, x_max))
        camera_z = float(np.clip(target_z - offset[1], z_min, z_max))
        heading = math.degrees(math.atan2(target_x - camera_x, -(target_z - camera_z))) % 360.0
        visible = int(arrays[4][row, col])
        diversity = float(arrays[5][row, col])
        regions.append(MissingRegion(
            f"weak_support_r{row:03d}_c{col:03d}",
            float(np.clip(1.0 - arrays[3][row, col], 0.0, 1.0)),
            0.45 if vegetation[row, col] else 0.9,
            0.5 if vegetation[row, col] else 1.0,
            (camera_x, target_y + 15.0, camera_z),
            15.0,
            -45.0,
            round(heading, 3),
            12.0,
            (
                f"weak measured support: visible_cameras={visible}; "
                f"angular_diversity={diversity:.6f}; heldout_occlusion_calibration=false"
            ),
            (target_x, target_y, target_z),
        ))
    report = rank_missing_views(regions)
    report.update({
        "method": "truth_field_weak_support_nms_v1",
        "coordinate_frame": "aerobrain_local_m",
        "controls_drone": False,
        "heldout_occlusion_calibrated": False,
    })
    return report
