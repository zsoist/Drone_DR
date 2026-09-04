"""End-to-end deterministic Hero Cell build orchestration."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from world_compiler.aerobrain.coordinates import CoordinateContract
from world_compiler.aerobrain.manifests import hash_file, load_object
from world_compiler.aerobrain.repository import SceneVersion, WorldRepository
from world_compiler.appearance.evidence_atlas import build_evidence_atlas
from world_compiler.appearance.pbr import SurfacePriority, allocate_materials
from world_compiler.completion.missing_views import MissingRegion, rank_missing_views
from world_compiler.evidence.truth_field import (
    Calibration,
    SurfaceEvidence,
    build_truth_field,
    validate_truth_field_document,
)
from world_compiler.export.manifest import validate_game_scene_document
from world_compiler.export.obj import write_obj
from world_compiler.geometry.structuralize import GeometryBundle, structuralize_heightfield
from world_compiler.ids import canonical_json, hero_id
from world_compiler.selection.hero_cell import (
    _raster_window,
    enumerate_grid,
    raster_candidate_evidence,
    select_hero_cell,
)
from world_compiler.semantics.masks import compose_static_mask
from world_compiler.semantics.scene_graph import SceneGraph, SceneNode
from world_compiler.storage import WorldPaths, atomic_world_build


COMPILER_CONTRACT = "world-compiler-r0-v1"


@dataclass(frozen=True)
class BuildRequest:
    scene_id: str
    version_id: str | None = None
    size_m: float = 100.0
    center: str | tuple[float, float] = "auto"
    profile: str = "hero-r0"

    def as_dict(self) -> dict:
        center = self.center if isinstance(self.center, str) else list(self.center)
        return {
            "scene_id": self.scene_id,
            "version_id": self.version_id,
            "size_m": float(self.size_m),
            "center": center,
            "profile": self.profile,
        }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(value) + b"\n")


def _read_rasters(scene: SceneVersion) -> tuple[dict, np.ndarray, np.ndarray, np.ndarray]:
    for required in ("dsm_lod_mask", "mesh_coverage", "mesh_coverage_meta"):
        if required not in scene.assets:
            raise ValueError(f"Hero Cell build requires asset: {required}")
    meta = load_object(scene.assets["dsm_lod_meta"])
    rows, cols = (int(value) for value in meta.get("grid") or ())
    if rows < 2 or cols < 2:
        raise ValueError("DSM grid is invalid")
    height = np.fromfile(scene.assets["dsm_lod_bin"], dtype="<f4")
    valid = np.fromfile(scene.assets["dsm_lod_mask"], dtype="u1")
    coverage = np.fromfile(scene.assets["mesh_coverage"], dtype="u1")
    expected = rows * cols
    if len(height) != expected or len(valid) != expected or len(coverage) != expected:
        raise ValueError("selection raster byte size does not match grid")
    height = height.reshape(rows, cols).astype(np.float64)
    if not np.isfinite(height).all():
        raise ValueError("DSM contains non-finite values")
    return meta, height, valid.reshape(rows, cols), coverage.reshape(rows, cols)


def _global_metrics(scene: SceneVersion) -> dict:
    metrics = scene.version.get("metrics") or {}
    sources = scene.version.get("effective_sources") or scene.version.get("sources") or []
    cameras = int(metrics.get("cameras_reconstructed") or 0)
    total = int(metrics.get("cameras_total") or 0)
    gsd = metrics.get("gsd_cm_px")
    return {
        "multi_view_coverage": {
            "value": min(1.0, len(sources) / 5.0) * (cameras / total if total else 0.0),
            "source": "scene version effective sources and reconstructed camera ratio",
        },
        "low_GSD_detail": {
            "value": min(1.0, 5.0 / float(gsd)) if gsd and float(gsd) > 0 else None,
            "source": "scene version measured gsd_cm_px" if gsd else None,
            "reason": None if gsd else "gsd unavailable",
        },
        "angular_diversity": {"value": None, "reason": "per-surface camera poses unavailable"},
        "source_sharpness": {"value": None, "reason": "source sharpness not measured"},
        "semantic_richness": {"value": None, "reason": "no validated semantic detector"},
    }


def _select(scene: SceneVersion, request: BuildRequest, height: np.ndarray, valid: np.ndarray, coverage: np.ndarray):
    if request.center == "auto":
        centers = enumerate_grid(scene.world_size_m, request.size_m, 10.0)
    else:
        if not isinstance(request.center, tuple) or len(request.center) != 2:
            raise ValueError("center must be auto or an (x,z) tuple")
        centers = [tuple(float(value) for value in request.center)]
    evidence = raster_candidate_evidence(
        centers=centers,
        world_size_m=scene.world_size_m,
        size_m=request.size_m,
        valid_mask=valid,
        mesh_coverage=coverage,
        heightfield=height,
        global_metrics=_global_metrics(scene),
    )
    return select_hero_cell(scene, evidence, request.size_m)


def _selection_dict(report) -> dict:
    selected = report.selected
    return {
        "size_m": report.size_m,
        "selected": {
            "center_ab_m": list(selected.center_ab_m),
            "score": selected.score.total,
            "valid_fraction": selected.valid_fraction,
            "components": {
                name: asdict(component) for name, component in selected.score.components.items()
            },
        },
        "candidate_counts": {"eligible": len(report.eligible), "rejected": len(report.rejected)},
    }


def _translate_bundle(bundle: GeometryBundle, center: tuple[float, float]) -> list:
    layers = [
        bundle.observed_reference,
        bundle.ground,
        bundle.clean_observed,
        bundle.inferred,
        bundle.generated,
        bundle.collision,
    ]
    translated = []
    for layer in layers:
        vertices = layer.vertices.copy()
        if len(vertices):
            vertices[:, 0] += center[0]
            vertices[:, 2] += center[1]
        translated.append((layer, vertices))
    return translated


def _validate_staging(root: Path) -> bool:
    try:
        document = load_object(root / "game_scene.v1.json")
        validate_game_scene_document(document, root)
        truth = load_object(root / document["truth_field"])
        validate_truth_field_document(truth)
    except (OSError, ValueError, KeyError):
        return False
    return True


def build_world(vault: Path, request: BuildRequest, *, dry_run: bool = False) -> dict:
    vault = Path(vault).resolve()
    scene = WorldRepository(vault).resolve_scene(request.scene_id, request.version_id)
    meta, height, valid, coverage = _read_rasters(scene)
    selection = _select(scene, request, height, valid, coverage)
    center = selection.selected.center_ab_m
    identity_request = request.as_dict() | {"version_id": scene.version_id, "selected_center_ab_m": list(center)}
    identity = hero_id(identity_request, scene.source_hashes, {"compiler_contract": COMPILER_CONTRACT})
    paths = WorldPaths(vault, scene.scene_id, identity)
    summary = {
        "status": "dry_run" if dry_run else "built",
        "hero_id": identity,
        "scene_id": scene.scene_id,
        "version_id": scene.version_id,
        "center_ab_m": list(center),
        "size_m": float(request.size_m),
        "selection_score": selection.selected.score.total,
        "candidates": {"eligible": len(selection.eligible), "rejected": len(selection.rejected)},
    }
    if dry_run:
        return summary
    if paths.target.exists():
        if not _validate_staging(paths.target):
            raise ValueError("existing content-addressed world is invalid")
        return summary | {"status": "existing", "output": str(paths.target)}

    row_slice, col_slice = _raster_window(center, scene.world_size_m, request.size_m, height.shape)
    patch = height[row_slice, col_slice].copy()
    patch_valid = valid[row_slice, col_slice] > 0
    if not patch_valid.any():
        raise ValueError("selected Hero Cell has no valid DSM samples")
    patch[~patch_valid] = float(np.median(patch[patch_valid]))
    patch -= float(meta.get("elev_min", patch.min()))
    spacing = tuple(float(value) for value in meta.get("spacing_m") or ())
    if len(spacing) != 2 or min(spacing) <= 0:
        raise ValueError("DSM spacing is invalid")
    bundle = structuralize_heightfield(patch, spacing_m=spacing)
    coordinate = CoordinateContract(center)

    with atomic_world_build(paths, validator=_validate_staging) as staging:
        _write_json(staging / "request.json", identity_request)
        _write_json(staging / "run.json", {
            "version": 1, "compiler_contract": COMPILER_CONTRACT,
            "deterministic": True, "external_network_calls": 0,
            "source_mode": "read_only", "timestamps_excluded_for_reproducibility": True,
        })
        _write_json(staging / "cost.json", {
            "version": 1, "currency": "USD", "external_total": 0.0,
            "cloud": 0.0, "api": 0.0, "paid_assets": 0.0,
            "local_compute_seconds": None, "electricity_estimate": None,
        })
        _write_json(staging / "selection.json", _selection_dict(selection))

        geometry_rows = []
        for layer, vertices in _translate_bundle(bundle, center):
            relative = Path("geometry") / f"{layer.role}.obj"
            target = staging / relative
            write_obj(target, vertices, layer.faces, role=layer.role)
            geometry_rows.append({
                "role": layer.role,
                "asset": relative.as_posix(),
                "provenance": layer.provenance.value,
                "provenance_basis": "published DSM transformed by deterministic structuralization",
                "confidence": layer.confidence,
                "vertices": int(len(vertices)),
                "triangles": int(len(layer.faces)),
                "sha256": hash_file(target),
            })

        evidence_rows = [
            SurfaceEvidence.inferred(layer.confidence, "dsm-structuralization-v1")
            for layer, _ in _translate_bundle(bundle, center)
            if len(layer.faces) and layer.role != "collision_geometry"
        ]
        evidence_rows.append(SurfaceEvidence.unknown())
        truth = build_truth_field(evidence_rows, Calibration())
        validate_truth_field_document(truth)
        _write_json(staging / "truth/truth_field.v1.json", truth)

        mask = compose_static_mask({}, shape=patch.shape)
        _write_json(staging / "semantics/masks.json", {
            "version": 1, "method": mask.method, "evidence_classes": list(mask.evidence_classes),
            "shape": list(patch.shape), "static_true": int(mask.static.sum()),
            "replacement_true": int(mask.replacement.sum()),
        })
        graph = SceneGraph(1, (
            SceneNode("ground", "unknown", "ground"),
            SceneNode("structure", "unknown", "clean_observed_structure"),
        ))
        _write_json(staging / "semantics/scene_graph.json", graph.as_dict())

        recipes = allocate_materials([
            SurfacePriority("ground", 0.8, 5.0, 1.0, 1.0, "ground"),
            SurfacePriority("structure", 0.5, 8.0, 0.8, 0.8, "generic_structure"),
        ], resident_budget_bytes=256 * 1024 * 1024, max_4k=1)
        _write_json(staging / "materials/recipes.json", {
            "version": 1, "resident_budget_bytes": 256 * 1024 * 1024,
            "recipes": [asdict(recipe) for recipe in recipes],
        })
        _write_json(staging / "materials/evidence_atlas.json", build_evidence_atlas({
            "ground": [], "structure": []
        }))
        _write_json(staging / "completion/decisions.json", {
            "version": 1, "status": "not_attempted", "hypotheses": [],
            "reason": "no completion may run without per-surface observation sidecar",
        })
        missing = rank_missing_views([MissingRegion(
            "surface_visibility_gap", 1.0, 1.0, 1.0, (0.0, 15.0, 0.0),
            15.0, -45.0, 0.0, 55.0, "per-surface camera visibility unavailable",
        )])
        _write_json(staging / "missing_views.json", missing)

        manifest = {
            "version": 1,
            "hero_id": identity,
            "scene_id": scene.scene_id,
            "version_id": scene.version_id,
            "profile": request.profile,
            "aoi": {"center_ab_m": list(center), "size_m": float(request.size_m)},
            "coordinates": {
                "matrix_ab_m_to_ue_cm": [list(row) for row in coordinate.matrix],
                "matrix_ue_cm_to_ab_m": [list(row) for row in coordinate.inverse],
                "metadata": coordinate.metadata,
                "winding_flip_required": True,
            },
            "geometry": geometry_rows,
            "truth_field": "truth/truth_field.v1.json",
            "materials": "materials/recipes.json",
            "evidence_atlas": "materials/evidence_atlas.json",
            "semantics": "semantics/scene_graph.json",
            "completion": "completion/decisions.json",
            "reference_cameras": {
                "status": "unavailable", "cameras": [],
                "reason": "no public per-surface camera sidecar in selected version",
            },
            "missing_views": "missing_views.json",
            "source_hashes": dict(sorted(scene.source_hashes.items())),
            "dependency_hashes": {"compiler_contract": COMPILER_CONTRACT},
            "records": {"request": "request.json", "run": "run.json", "cost": "cost.json"},
        }
        _write_json(staging / "game_scene.v1.json", manifest)
    return summary | {"output": str(paths.target)}
