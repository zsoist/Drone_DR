"""Validation for the canonical game_scene.v1 consumer contract."""

from __future__ import annotations

import re
from pathlib import Path

from world_compiler.evidence.truth_field import TruthClass


REQUIRED_GEOMETRY_ROLES = (
    "observed_reference_geometry",
    "ground",
    "clean_observed_structure",
    "geometrically_inferred_structure",
    "generated_completion",
    "collision_geometry",
)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _asset(root: Path, raw: object) -> Path:
    relative = Path(str(raw or ""))
    if not str(raw or "") or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("asset path escapes world root")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("asset path escapes world root")
    if not resolved.is_file():
        raise ValueError(f"referenced asset is missing: {relative.as_posix()}")
    return resolved


def _matrix(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(row, list) and len(row) == 4 for row in value)
    )


def validate_game_scene_document(document: dict, root: Path) -> None:
    if document.get("version") != 1:
        raise ValueError("unsupported game scene version")
    if not re.fullmatch(r"hero_[0-9a-f]{16}", str(document.get("hero_id") or "")):
        raise ValueError("invalid hero id")
    coordinates = document.get("coordinates") or {}
    if not _matrix(coordinates.get("matrix_ab_m_to_ue_cm")) or not _matrix(
        coordinates.get("matrix_ue_cm_to_ab_m")
    ):
        raise ValueError("coordinate matrices must both be 4x4")
    geometry = document.get("geometry")
    if not isinstance(geometry, list):
        raise ValueError("geometry layers are required")
    roles = [row.get("role") for row in geometry if isinstance(row, dict)]
    if len(roles) != len(set(roles)) or set(roles) != set(REQUIRED_GEOMETRY_ROLES):
        raise ValueError("exactly six distinct geometry roles are required")
    valid_provenance = {value.value for value in TruthClass}
    for row in geometry:
        if row.get("provenance") not in valid_provenance:
            raise ValueError("geometry provenance is invalid")
        if not _SHA256.fullmatch(str(row.get("sha256") or "")):
            raise ValueError("geometry hash is invalid")
        _asset(root, row.get("asset"))
    for key in ("truth_field", "materials", "missing_views"):
        _asset(root, document.get(key))
    records = document.get("records") or {}
    for key in ("request", "run", "cost"):
        _asset(root, records.get(key))
    source_hashes = document.get("source_hashes") or {}
    if not source_hashes or any(not _SHA256.fullmatch(str(value)) for value in source_hashes.values()):
        raise ValueError("source hashes are required")
    if not isinstance(document.get("dependency_hashes"), dict):
        raise ValueError("dependency hashes are required")
    references = document.get("reference_cameras") or {}
    if references.get("status") not in ("available", "unavailable") or not isinstance(
        references.get("cameras"), list
    ):
        raise ValueError("reference camera status is required")
