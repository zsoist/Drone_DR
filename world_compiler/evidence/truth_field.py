"""Truth Field classes remain independent from visual plausibility/confidence."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .visibility import observed_confidence, unit


class TruthClass(str, Enum):
    OBSERVED_MULTI_VIEW = "OBSERVED_MULTI_VIEW"
    OBSERVED_WEAK = "OBSERVED_WEAK"
    GEOMETRICALLY_INFERRED = "GEOMETRICALLY_INFERRED"
    GENERATED_CONSTRAINED = "GENERATED_CONSTRAINED"
    UNKNOWN = "UNKNOWN"


LEGEND = {
    TruthClass.OBSERVED_MULTI_VIEW.value: "#00a651",
    TruthClass.OBSERVED_WEAK.value: "#ffd400",
    TruthClass.GEOMETRICALLY_INFERRED.value: "#ffd400",
    TruthClass.GENERATED_CONSTRAINED.value: "#e31b23",
    TruthClass.UNKNOWN.value: "#000000",
}


@dataclass(frozen=True)
class Calibration:
    calibration_id: str = "truth-r0-v1"
    multi_view_min_cameras: int = 3
    multi_view_min_angular_diversity: float = 0.25
    multi_view_min_confidence: float = 0.55


@dataclass(frozen=True)
class SurfaceEvidence:
    provenance_hint: str
    source_camera_ids: tuple[str, ...] = ()
    angular_diversity: float = 0.0
    sharpness: float = 0.0
    projected_density: float = 0.0
    exposure_consistency: float = 0.0
    reprojection_quality: float = 0.0
    occlusion_confidence: float = 0.0
    geometry_agreement: float = 0.0
    dynamic_cleanliness: float = 0.0
    boundary_support: float = 0.0
    confidence_inputs: float = 0.0
    method: str | None = None

    @classmethod
    def observed(cls, *, camera_ids: tuple[str, ...], **values: float) -> "SurfaceEvidence":
        return cls("observed", source_camera_ids=tuple(camera_ids), **values)

    @classmethod
    def inferred(cls, confidence_inputs: float, method: str) -> "SurfaceEvidence":
        return cls("inferred", confidence_inputs=confidence_inputs, method=method)

    @classmethod
    def generated(cls, confidence_inputs: float, method: str) -> "SurfaceEvidence":
        return cls("generated", confidence_inputs=confidence_inputs, method=method)

    @classmethod
    def unknown(cls) -> "SurfaceEvidence":
        return cls("unknown")


@dataclass(frozen=True)
class TruthSample:
    truth_class: TruthClass
    confidence: float
    source_camera_ids: tuple[str, ...]
    method: str | None

    def as_dict(self) -> dict:
        return {
            "class": self.truth_class.value,
            "confidence": self.confidence,
            "source_camera_ids": list(self.source_camera_ids),
            "method": self.method,
        }


def classify_surface(evidence: SurfaceEvidence, calibration: Calibration) -> TruthSample:
    hint = evidence.provenance_hint
    if hint == "unknown":
        return TruthSample(TruthClass.UNKNOWN, 0.0, (), None)
    if hint == "generated":
        return TruthSample(
            TruthClass.GENERATED_CONSTRAINED,
            round(unit(evidence.confidence_inputs, "confidence_inputs"), 6),
            (),
            evidence.method,
        )
    if hint == "inferred":
        return TruthSample(
            TruthClass.GEOMETRICALLY_INFERRED,
            round(unit(evidence.confidence_inputs, "confidence_inputs"), 6),
            (),
            evidence.method,
        )
    if hint != "observed":
        raise ValueError(f"unsupported provenance hint: {hint}")
    cameras = tuple(dict.fromkeys(str(value) for value in evidence.source_camera_ids if value))
    if not cameras:
        return TruthSample(TruthClass.UNKNOWN, 0.0, (), None)
    values = {
        "angular_diversity": evidence.angular_diversity,
        "sharpness": evidence.sharpness,
        "projected_density": evidence.projected_density,
        "exposure_consistency": evidence.exposure_consistency,
        "reprojection_quality": evidence.reprojection_quality,
        "occlusion_confidence": evidence.occlusion_confidence,
        "geometry_agreement": evidence.geometry_agreement,
        "dynamic_cleanliness": evidence.dynamic_cleanliness,
        "boundary_support": evidence.boundary_support,
    }
    confidence = observed_confidence(values, len(cameras))
    multi_view = (
        len(cameras) >= calibration.multi_view_min_cameras
        and evidence.angular_diversity >= calibration.multi_view_min_angular_diversity
        and confidence >= calibration.multi_view_min_confidence
    )
    truth_class = TruthClass.OBSERVED_MULTI_VIEW if multi_view else TruthClass.OBSERVED_WEAK
    return TruthSample(truth_class, confidence, cameras, "camera-evidence-v1")


def build_truth_field(
    evidence_rows: list[SurfaceEvidence], calibration: Calibration
) -> dict:
    samples = [classify_surface(row, calibration) for row in evidence_rows]
    counts = {truth_class.value: 0 for truth_class in TruthClass}
    for sample in samples:
        counts[sample.truth_class.value] += 1
    total = len(samples)
    coverage = {
        name: round(100.0 * count / total, 8) if total else 0.0
        for name, count in counts.items()
    }
    return {
        "version": 1,
        "calibration_id": calibration.calibration_id,
        "sample_count": total,
        "classes": [truth_class.value for truth_class in TruthClass],
        "legend": dict(LEGEND),
        "coverage_pct": coverage,
        "samples": [sample.as_dict() for sample in samples],
    }


def validate_truth_field_document(document: dict) -> None:
    if document.get("version") != 1:
        raise ValueError("unsupported truth field version")
    samples = document.get("samples")
    if not isinstance(samples, list) or document.get("sample_count") != len(samples):
        raise ValueError("truth field sample count mismatch")
    valid_classes = {truth_class.value for truth_class in TruthClass}
    coverage = document.get("coverage_pct")
    if not isinstance(coverage, dict) or set(coverage) != valid_classes:
        raise ValueError("truth coverage must include every class")
    try:
        coverage_total = sum(float(coverage[name]) for name in valid_classes)
    except (TypeError, ValueError) as error:
        raise ValueError("truth coverage is invalid") from error
    raster = document.get("raster")
    if raster is not None:
        required_rasters = {"confidence", "provenance", "dominant_camera_index"}
        shape = document.get("shape")
        if (
            not isinstance(raster, dict)
            or set(raster) != required_rasters
            or not all(isinstance(value, str) and value for value in raster.values())
            or not isinstance(shape, list)
            or len(shape) != 2
            or any(not isinstance(value, int) or value <= 0 for value in shape)
        ):
            raise ValueError("spatial truth raster contract is incomplete")
    if (samples or raster is not None) and abs(coverage_total - 100.0) > 1e-5:
        raise ValueError("truth coverage must sum to 100")
    for sample in samples:
        if sample.get("class") not in valid_classes:
            raise ValueError("invalid truth class")
        unit(sample.get("confidence"), "confidence")
        cameras = sample.get("source_camera_ids")
        if not isinstance(cameras, list):
            raise ValueError("source_camera_ids must be a list")
        if sample["class"] in (
            TruthClass.OBSERVED_MULTI_VIEW.value,
            TruthClass.OBSERVED_WEAK.value,
        ) and not cameras:
            raise ValueError("observed sample requires cameras")
        if sample["class"] == TruthClass.UNKNOWN.value and cameras:
            raise ValueError("unknown sample cannot reference cameras")
