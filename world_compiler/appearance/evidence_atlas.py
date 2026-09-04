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
