"""Render-to-refute checks for generated completion hypotheses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from world_compiler.evidence.visibility import unit

if TYPE_CHECKING:
    from .hypotheses import CompletionHypothesis


@dataclass(frozen=True)
class ObservationCheck:
    camera_id: str
    silhouette_iou: float
    corner_error_m: float
    occlusion_ok: bool
    plausibility: float = 0.5


@dataclass(frozen=True)
class RefutationReport:
    hypothesis_id: str
    rejected: bool
    reasons: tuple[str, ...]
    score: float
    checks: tuple[ObservationCheck, ...]

    def as_dict(self) -> dict:
        return {
            "hypothesis_id": self.hypothesis_id,
            "rejected": self.rejected,
            "reasons": list(self.reasons),
            "score": self.score,
            "checks": [
                {
                    "camera_id": check.camera_id,
                    "silhouette_iou": check.silhouette_iou,
                    "corner_error_m": check.corner_error_m,
                    "occlusion_ok": check.occlusion_ok,
                    "plausibility": check.plausibility,
                }
                for check in self.checks
            ],
        }


def validate_hypothesis(
    hypothesis: CompletionHypothesis,
    checks: list[ObservationCheck],
    *,
    silhouette_min_iou: float = 0.9,
    corner_max_error_m: float = 0.15,
) -> RefutationReport:
    """Reject any hypothesis contradicted by a real observation."""
    ordered_checks = tuple(sorted(checks, key=lambda check: check.camera_id))
    reasons: list[str] = []
    if any(check.silhouette_iou < silhouette_min_iou for check in ordered_checks):
        reasons.append("silhouette_mismatch")
    if any(check.corner_error_m > corner_max_error_m for check in ordered_checks):
        reasons.append("corner_mismatch")
    if any(not check.occlusion_ok for check in ordered_checks):
        reasons.append("occlusion_contradiction")

    if not ordered_checks:
        score = 0.0
    else:
        check_scores = []
        for check in ordered_checks:
            silhouette = unit(check.silhouette_iou, "silhouette_iou")
            corner_quality = max(0.0, 1.0 - check.corner_error_m / corner_max_error_m)
            plausibility = unit(check.plausibility, "plausibility")
            occlusion = 1.0 if check.occlusion_ok else 0.0
            check_scores.append((silhouette + corner_quality + plausibility + occlusion) / 4.0)
        score = round(sum(check_scores) / len(check_scores), 12)
    return RefutationReport(
        hypothesis.hypothesis_id,
        bool(reasons),
        tuple(reasons),
        score,
        ordered_checks,
    )
