"""Serializable per-patch provenance for source color and microdetail."""

from __future__ import annotations

from .camera_selection import CameraObservation, rank_observations, select_compatible_blend


def build_evidence_atlas(
    observations_by_patch: dict[str, list[CameraObservation]],
    *,
    generated_patches: set[str] | None = None,
) -> dict:
    generated_patches = generated_patches or set()
    patches = {}
    for patch_id in sorted(observations_by_patch):
        ranked = rank_observations(observations_by_patch[patch_id])
        blend = select_compatible_blend(ranked)
        total = sum(row.score for row in blend)
        weights = (
            {row.observation.camera_id: row.score / total for row in blend}
            if total > 0
            else {}
        )
        generated = patch_id in generated_patches
        patches[patch_id] = {
            "dominant_camera": blend[0].observation.camera_id if blend else None,
            "weights": weights,
            "confidence": min(1.0, total) if blend else 0.0,
            "generated_mask": generated,
            "repair_mask": generated or not bool(blend),
            "seam_mask": len(blend) > 1,
        }
    return {"version": 1, "patches": patches}


def build_raster_evidence_atlas(
    *,
    shape: tuple[int, int],
    source_color: str | None,
    confidence: str | None,
    dominant_camera_index: str | None,
    generated_or_repair_mask: str | None,
) -> dict:
    """Describe measured raster evidence without inventing per-camera blend weights."""
    if len(shape) != 2 or min(shape) <= 0:
        raise ValueError("evidence atlas shape must be positive and 2D")
    return {
        "version": 1,
        "status": "measured_orthomosaic_proxy" if source_color else "source_color_unavailable",
        "shape": list(shape),
        "rasters": {
            "source_color": source_color,
            "confidence": confidence,
            "dominant_camera_index": dominant_camera_index,
            "generated_or_repair_mask": generated_or_repair_mask,
        },
        "lineage": {
            "source_color": "cropped published ODM orthomosaic" if source_color else None,
            "camera_support": "OpenSfM frustum plus uncalibrated DSM occlusion proxy",
        },
        "per_texel_camera_weights_available": False,
        "source_sharpness_available": False,
        "exposure_consistency_available": False,
        "seam_mask_available": False,
        "limitations": [
            "orthomosaic color contains capture illumination",
            "dominant camera index is a support proxy, not exact ODM texel lineage",
            "no de-lighted basecolor, normal, roughness, AO, or seam repair was generated",
        ],
    }
