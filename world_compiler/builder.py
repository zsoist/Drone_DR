"""End-to-end deterministic Hero Cell build orchestration."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from world_compiler.aerobrain.cameras import CameraSet, camera_support_grid, load_opensfm_cameras
from world_compiler.aerobrain.coordinates import CoordinateContract
from world_compiler.aerobrain.manifests import hash_file, load_object
from world_compiler.aerobrain.repository import SceneVersion, WorldRepository
from world_compiler.appearance.evidence_atlas import build_raster_evidence_atlas
from world_compiler.appearance.pbr import (
    SurfacePriority,
    allocate_materials,
    generate_reality_sandwich_maps,
)
from world_compiler.completion.missing_views import (
    MissingRegion,
    derive_missing_views,
    rank_missing_views,
)
from world_compiler.evidence.truth_field import (
    Calibration,
    LEGEND,
    SurfaceEvidence,
    TruthClass,
    build_truth_field,
    validate_truth_field_document,
)
from world_compiler.evidence.spatial_truth import build_spatial_truth
from world_compiler.export.manifest import validate_game_scene_document
from world_compiler.export.obj import write_obj
from world_compiler.geometry.structuralize import (
    GeometryBundle,
    split_by_source_support,
    structuralize_heightfield,
)
from world_compiler.ids import canonical_json, hero_id, tree_hash
from world_compiler.qa.reference_views import (
    compare_mesh_silhouettes,
    crop_source_ortho,
    render_dsm_hillshade,
    render_truth_debug,
)
from world_compiler.qa.geometry_metrics import (
    load_collision_mesh,
    route_visibility_weighted_coverage,
    source_surface_agreement,
    source_surface_distances,
)
from world_compiler.selection.hero_cell import (
    _raster_window,
    enumerate_grid,
    raster_candidate_evidence,
    select_hero_cell,
)
from world_compiler.semantics.masks import (
    SemanticClass,
    compose_static_mask,
    conservative_semantic_masks,
)
from world_compiler.semantics.scene_graph import SceneGraph, SceneNode
from world_compiler.storage import WorldPaths, atomic_world_build


COMPILER_CONTRACT = "world-compiler-r0-v3-unreal-import-plan"


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


def _vegetation_proxy(scene: SceneVersion, shape: tuple[int, int]) -> np.ndarray | None:
    ortho_path = scene.assets.get("ortho_full") or scene.assets.get("ortho")
    if ortho_path is None:
        return None
    rows, cols = shape
    rgb = np.asarray(
        Image.open(ortho_path).convert("RGB").resize((cols, rows), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maximum = rgb.max(axis=-1)
    minimum = rgb.min(axis=-1)
    saturation = np.divide(maximum - minimum, np.maximum(maximum, 1.0))
    return (
        (green > 45.0)
        & (green > red * 1.06)
        & (green > blue * 1.10)
        & (saturation > 0.12)
    )


def _select(
    scene: SceneVersion,
    request: BuildRequest,
    height: np.ndarray,
    valid: np.ndarray,
    coverage: np.ndarray,
    vegetation: np.ndarray | None,
):
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
        vegetation_mask=vegetation,
        global_metrics=_global_metrics(scene),
    )
    return select_hero_cell(scene, evidence, request.size_m)


def _selection_dict(report) -> dict:
    selected = report.selected
    def candidate_dict(candidate) -> dict:
        return {
            "center_ab_m": list(candidate.center_ab_m),
            "score": candidate.score.total,
            "valid_fraction": candidate.valid_fraction,
            "rejection_reason": candidate.rejection_reason,
            "components": {
                name: asdict(component)
                for name, component in candidate.score.components.items()
            },
        }

    return {
        "size_m": report.size_m,
        "selected": candidate_dict(selected),
        "top_candidates": [candidate_dict(candidate) for candidate in report.eligible[:10]],
        "rejected_candidates": [candidate_dict(candidate) for candidate in report.rejected[:10]],
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


def _coordinate_validation_report(
    coordinate: CoordinateContract,
    center: tuple[float, float],
    size_m: float,
    patch: np.ndarray,
    spacing: tuple[float, float],
    reference_cameras: list,
) -> dict:
    half = size_m / 2.0
    low, high = float(np.min(patch)), float(np.max(patch))
    corners = np.asarray(
        [
            [center[0] + dx, elevation, center[1] + dz]
            for elevation in (low, high)
            for dx in (-half, half)
            for dz in (-half, half)
        ],
        dtype=np.float64,
    )
    rows, cols = patch.shape
    terrain = []
    for row, col in ((0, 0), (0, cols - 1), (rows - 1, 0), (rows - 1, cols - 1)):
        terrain.append(
            [
                center[0] + (col - (cols - 1) / 2.0) * spacing[0],
                float(patch[row, col]),
                center[1] + (row - (rows - 1) / 2.0) * spacing[1],
            ]
        )
    roof_row, roof_col = np.unravel_index(int(np.argmax(patch)), patch.shape)
    roof = np.asarray(
        [[
            center[0] + (roof_col - (cols - 1) / 2.0) * spacing[0],
            float(patch[roof_row, roof_col]),
            center[1] + (roof_row - (rows - 1) / 2.0) * spacing[1],
        ]],
        dtype=np.float64,
    )
    origin = np.asarray([center[0], high + 5.0, center[1]], dtype=np.float64)
    axes = np.asarray([origin, origin + [1, 0, 0], origin + [0, 1, 0], origin + [0, 0, 1]])
    camera_points = np.asarray([pose.center_ab_m for pose in reference_cameras], dtype=np.float64).reshape(-1, 3)
    groups = [corners, np.asarray(terrain), roof, axes]
    if len(camera_points):
        groups.append(camera_points)
    points = np.concatenate(groups)
    roundtrip = coordinate.ue_to_ab(coordinate.ab_to_ue(points))
    maximum_error = float(np.max(np.abs(roundtrip - points)))
    return {
        "version": 1,
        "status": "passed" if len(camera_points) >= 8 and maximum_error <= 1e-9 else "insufficient_source_cameras",
        "max_roundtrip_error_m": round(maximum_error, 15),
        "aoi_corners": len(corners),
        "source_camera_centers": len(camera_points),
        "terrain_control_points": len(terrain),
        "roof_control_points": len(roof),
        "drone_axis_points": len(axes),
        "winding_flip_required": True,
        "determinant": coordinate.metadata["determinant"],
    }


def _validate_staging(root: Path) -> bool:
    try:
        document = load_object(root / "game_scene.v1.json")
        validate_game_scene_document(document, root)
        truth = load_object(root / document["truth_field"])
        validate_truth_field_document(truth)
        for relative in (truth.get("raster") or {}).values():
            if not (root / relative).is_file():
                raise ValueError("truth raster is missing")
        if document.get("unreal_import") and not (root / document["unreal_import"]).is_file():
            raise ValueError("Unreal import plan is missing")
    except (OSError, ValueError, KeyError):
        return False
    return True


def _acceptance_route_points(path: Path, center_ab_m: tuple[float, float]) -> np.ndarray:
    """Interpolate the versioned Unreal route at one-second intervals in absolute AB space."""
    document = load_object(path)
    samples = document.get("samples") or []
    if len(samples) < 2 or float(document.get("duration_s") or -1) != 30.0:
        raise ValueError("acceptance route must contain a 30-second sampled path")
    times = np.asarray([row["time_s"] for row in samples], dtype=np.float64)
    positions = np.asarray([row["position_ab_local_m"] for row in samples], dtype=np.float64)
    if (
        positions.shape != (len(samples), 3)
        or not np.isfinite(positions).all()
        or not np.isfinite(times).all()
        or np.any(np.diff(times) <= 0)
        or times[0] != 0.0
        or times[-1] != 30.0
    ):
        raise ValueError("acceptance route samples are invalid")
    dense_times = np.arange(31, dtype=np.float64)
    dense = np.column_stack(
        [np.interp(dense_times, times, positions[:, axis]) for axis in range(3)]
    )
    dense[:, 0] += center_ab_m[0]
    dense[:, 2] += center_ab_m[1]
    return dense


def build_world(vault: Path, request: BuildRequest, *, dry_run: bool = False) -> dict:
    started = time.perf_counter()
    vault = Path(vault).resolve()
    scene = WorldRepository(vault).resolve_scene(request.scene_id, request.version_id)
    meta, height, valid, coverage = _read_rasters(scene)
    vegetation = _vegetation_proxy(scene, height.shape)
    selection = _select(scene, request, height, valid, coverage, vegetation)
    center = selection.selected.center_ab_m
    identity_request = request.as_dict() | {"version_id": scene.version_id, "selected_center_ab_m": list(center)}
    package_root = Path(__file__).resolve().parent
    repository_root = package_root.parent
    dependency_hashes = {
        "compiler_contract": COMPILER_CONTRACT,
        "world_compiler_source": tree_hash(package_root),
        "unreal_project_source": tree_hash(repository_root / "unreal" / "DroneWorld"),
    }
    identity = hero_id(identity_request, scene.source_hashes, dependency_hashes)
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
    vegetation_patch = (
        vegetation[row_slice, col_slice]
        if vegetation is not None
        else None
    )
    bundle = structuralize_heightfield(
        patch,
        spacing_m=spacing,
        exclusion_mask=vegetation_patch,
    )
    source_vertices = None
    source_faces = None
    source_support = {
        "version": 1,
        "status": "unavailable",
        "reason": "source surface support was not measured",
    }
    try:
        source_vertices, source_faces = load_collision_mesh(
            scene.assets["collision_bin"], scene.assets["collision_meta"]
        )
        clean_world_vertices = bundle.clean_observed.vertices.copy()
        clean_world_vertices[:, 0] += center[0]
        clean_world_vertices[:, 2] += center[1]
        _, unique_distances, inverse, _ = source_surface_distances(
            clean_world_vertices,
            source_vertices,
            source_faces,
            center_ab_m=center,
            size_m=request.size_m,
        )
        tolerance_m = max(0.4, 0.75 * float(np.hypot(*spacing)))
        observed, inferred, source_support = split_by_source_support(
            bundle.clean_observed,
            unique_distances[inverse],
            tolerance_m=tolerance_m,
        )
        source_support["status"] = "measured"
        source_support["basis"] = "0.75 DSM cell diagonal, never below 0.40 m"
        bundle = GeometryBundle(
            bundle.observed_reference,
            bundle.ground,
            observed,
            inferred,
            bundle.generated,
            bundle.collision,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        source_support["reason"] = str(error)
    coordinate = CoordinateContract(center)
    cameras = (
        load_opensfm_cameras(scene.camera_reconstruction_path, scene.world_manifest["world"])
        if scene.camera_reconstruction_path is not None
        else None
    )
    support = None
    spatial_truth = None
    selected_camera_poses = []
    reference_camera_poses = []
    if cameras is not None:
        rows, cols = patch.shape
        x_values = center[0] + (np.arange(cols) - (cols - 1) / 2.0) * spacing[0]
        z_values = center[1] + (np.arange(rows) - (rows - 1) / 2.0) * spacing[1]
        x_grid, z_grid = np.meshgrid(x_values, z_values)
        support = camera_support_grid(
            cameras,
            x_ab_m=x_grid,
            y_ab_m=patch,
            z_ab_m=z_grid,
            occlusion_heightfield=height - float(meta.get("elev_min", height.min())),
            occlusion_world_size_m=scene.world_size_m,
            occlusion_valid_mask=valid > 0,
        )
        spatial_truth = build_spatial_truth(
            support.visible_count,
            support.angular_diversity,
            occlusion_validated=False,
        )
        radius = max(request.size_m, 1.0)
        selected_camera_poses = [
            pose
            for pose in cameras.poses
            if np.hypot(pose.center_ab_m[0] - center[0], pose.center_ab_m[2] - center[1])
            <= 2.0 * radius
        ]
        target_y = float(np.median(patch))
        reference_camera_poses = sorted(
            selected_camera_poses,
            key=lambda pose: (
                float(np.linalg.norm(np.asarray(pose.center_ab_m) - np.asarray([center[0], target_y, center[1]]))),
                pose.camera_id,
            ),
        )[:8]

    with atomic_world_build(paths, validator=_validate_staging) as staging:
        _write_json(staging / "request.json", identity_request)
        _write_json(staging / "run.json", {
            "version": 1, "compiler_contract": COMPILER_CONTRACT,
            "deterministic": True, "external_network_calls": 0,
            "source_mode": "read_only", "timestamps_excluded_for_reproducibility": True,
        })
        _write_json(staging / "selection.json", _selection_dict(selection))
        _write_json(staging / "source/manifests.json", {
            "version": 1,
            "scene_id": scene.scene_id,
            "version_id": scene.version_id,
            "source_hashes": dict(sorted(scene.source_hashes.items())),
            "source_paths_redacted": True,
        })
        _write_json(staging / "source/aoi.json", {
            "version": 1,
            "frame": "aerobrain_local_m",
            "center_ab_m": list(center),
            "size_m": float(request.size_m),
            "geographic_coordinates_included": False,
        })
        _write_json(staging / "source/cameras.json", {
            "version": 1,
            "frame": "aerobrain_local_m",
            "projection_method": cameras.projection_method if cameras else None,
            "camera_count": len(selected_camera_poses),
            "cameras": [pose.as_dict() for pose in selected_camera_poses],
        })
        _write_json(staging / "source/selected_frames.json", {
            "version": 1,
            "selection_method": "camera centers within two AOI widths; local poses only",
            "camera_ids": [pose.camera_id for pose in selected_camera_poses],
            "source_images_copied": False,
        })
        _write_json(staging / "qa/source_support.json", source_support)

        geometry_rows = []
        translated_layers = _translate_bundle(bundle, center)
        half_size = float(request.size_m) / 2.0
        uv_bounds = (
            center[0] - half_size,
            center[1] - half_size,
            center[0] + half_size,
            center[1] + half_size,
        )
        for layer, vertices in translated_layers:
            relative = Path("geometry") / f"{layer.role}.obj"
            target = staging / relative
            write_obj(target, vertices, layer.faces, role=layer.role, uv_bounds=uv_bounds)
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
        canonical_roles = {
            "ground",
            "clean_observed_structure",
            "geometrically_inferred_structure",
            "generated_completion",
        }
        provenance_triangles = {truth_class.value: 0 for truth_class in TruthClass}
        for row in geometry_rows:
            if row["role"] in canonical_roles:
                provenance_triangles[row["provenance"]] += row["triangles"]
        canonical_triangles = sum(provenance_triangles.values())
        triangle_count_coverage_pct = {
            name: round(100.0 * count / canonical_triangles, 8)
            if canonical_triangles
            else 0.0
            for name, count in provenance_triangles.items()
        }
        route_points = _acceptance_route_points(
            repository_root / "unreal/DroneWorld/Config/AcceptanceRoute.json", center
        )
        route_layers = [
            (layer.provenance.value, vertices, layer.faces)
            for layer, vertices in translated_layers
            if layer.role in canonical_roles
        ]
        route_coverage = route_visibility_weighted_coverage(
            route_layers,
            route_points,
            heightfield=height - float(meta.get("elev_min", height.min())),
            world_size_m=scene.world_size_m,
            valid_mask=valid > 0,
            provenance_classes=tuple(truth_class.value for truth_class in TruthClass),
        )
        geometry_coverage = route_coverage | {
            "version": 1,
            "basis": "route-visible projected triangle area potential; excludes source reference and collision",
            "unweighted_basis": "canonical render triangle count",
            "canonical_triangles": canonical_triangles,
            "triangle_count": provenance_triangles,
            "triangle_count_coverage_pct": triangle_count_coverage_pct,
        }
        _write_json(staging / "truth/geometry_coverage.json", geometry_coverage)
        silhouette_report = {
            "version": 1,
            "status": "unavailable",
            "method": "opensfm_source_camera_mesh_silhouette_iou_v1",
            "reference": "published structural collider from the same reconstruction",
            "independent_ground_truth": False,
            "acceptance_gate_eligible": False,
            "reason": "source cameras or structural meshes were unavailable",
        }
        try:
            if source_vertices is None or source_faces is None:
                source_vertices, source_faces = load_collision_mesh(
                    scene.assets["collision_bin"], scene.assets["collision_meta"]
                )
            if not reference_camera_poses:
                raise ValueError("no source reference cameras selected")
            half = float(request.size_m) / 2.0
            source_triangles = source_vertices[source_faces]
            source_min = source_triangles.min(axis=1)
            source_max = source_triangles.max(axis=1)
            structure_floor = float(np.percentile(patch, 60)) + 2.0
            source_structure_mask = (
                (source_max[:, 0] >= center[0] - half)
                & (source_min[:, 0] <= center[0] + half)
                & (source_max[:, 2] >= center[1] - half)
                & (source_min[:, 2] <= center[1] + half)
                & (source_max[:, 1] >= structure_floor)
            )
            source_structure_faces = source_faces[source_structure_mask]
            if not len(source_structure_faces):
                raise ValueError("source collider has no elevated structure triangles in the Hero Cell")
            candidate_vertices_parts = []
            candidate_faces_parts = []
            vertex_offset = 0
            for layer, vertices in translated_layers:
                if layer.role not in {"clean_observed_structure", "geometrically_inferred_structure"}:
                    continue
                if len(layer.faces):
                    candidate_vertices_parts.append(vertices)
                    candidate_faces_parts.append(layer.faces.astype(np.uint32) + vertex_offset)
                    vertex_offset += len(vertices)
            if not candidate_faces_parts:
                raise ValueError("canonical build has no structural triangles")
            source_camera_set = CameraSet(
                tuple(reference_camera_poses),
                cameras.east_offset_m,
                cameras.north_offset_m,
                cameras.elevation_origin_m,
                cameras.projection_method,
            )
            comparison = compare_mesh_silhouettes(
                source_camera_set,
                source_vertices,
                source_structure_faces,
                np.concatenate(candidate_vertices_parts),
                np.concatenate(candidate_faces_parts),
                output_dir=staging / "qa/baseline/silhouettes",
            )
            for row in comparison["cameras"]:
                row["overlay"] = f"qa/baseline/silhouettes/{row['overlay']}"
            silhouette_report = silhouette_report | comparison | {
                "status": "measured_same_reconstruction_proxy",
                "reason": None,
                "source_structure_triangle_count": int(len(source_structure_faces)),
                "candidate_structure_triangle_count": int(
                    sum(len(faces) for faces in candidate_faces_parts)
                ),
                "structure_floor_ab_m": round(structure_floor, 9),
                "target_iou": 0.90,
                "passes_proxy_target": comparison["median_iou"] >= 0.90,
                "note": "Regression proxy only; source collider and candidate share reconstruction evidence.",
            }
        except (OSError, ValueError, json.JSONDecodeError) as error:
            silhouette_report["reason"] = str(error)
        _write_json(staging / "qa/source_silhouette_agreement.json", silhouette_report)
        clean_vertices = next(
            vertices
            for layer, vertices in translated_layers
            if layer.role == "clean_observed_structure"
        )
        if len(clean_vertices):
            try:
                if source_vertices is None or source_faces is None:
                    source_vertices, source_faces = load_collision_mesh(
                        scene.assets["collision_bin"], scene.assets["collision_meta"]
                    )
                agreement = source_surface_agreement(
                    clean_vertices,
                    source_vertices,
                    source_faces,
                    center_ab_m=center,
                    size_m=request.size_m,
                )
            except (OSError, ValueError, json.JSONDecodeError) as error:
                agreement = {
                    "version": 1,
                    "status": "unavailable",
                    "reason": str(error),
                    "independent_ground_truth": False,
                    "acceptance_gate_eligible": False,
                }
            _write_json(
                staging / "qa/source_geometry_agreement.json",
                agreement,
            )

        confidence_u8 = None
        class_rgb = None
        if spatial_truth is None:
            evidence_rows = [
                SurfaceEvidence.inferred(layer.confidence, "dsm-structuralization-v1")
                for layer, _ in _translate_bundle(bundle, center)
                if len(layer.faces) and layer.role != "collision_geometry"
            ]
            evidence_rows.append(SurfaceEvidence.unknown())
            truth = build_truth_field(evidence_rows, Calibration())
        else:
            (staging / "truth").mkdir(parents=True, exist_ok=True)
            confidence_u8 = np.rint(np.clip(spatial_truth.confidence, 0.0, 1.0) * 255.0).astype(np.uint8)
            class_rgb = np.zeros((*spatial_truth.classes.shape, 3), dtype=np.uint8)
            class_rgb[spatial_truth.classes == "OBSERVED_MULTI_VIEW"] = (0, 166, 81)
            class_rgb[spatial_truth.classes == "OBSERVED_WEAK"] = (255, 212, 0)
            class_rgb[spatial_truth.classes == "GEOMETRICALLY_INFERRED"] = (255, 212, 0)
            class_rgb[spatial_truth.classes == "GENERATED_CONSTRAINED"] = (227, 27, 35)
            camera_index_u16 = (support.dominant_camera_index.astype(np.int64) + 1).astype(np.uint16)
            Image.fromarray(confidence_u8).save(staging / "truth/confidence.png")
            Image.fromarray(class_rgb).save(staging / "truth/provenance.png")
            Image.fromarray(camera_index_u16).save(staging / "truth/camera_index.png")
            truth = {
                "version": 1,
                "calibration_id": spatial_truth.calibration_id,
                "sample_count": 0,
                "classes": [truth_class.value for truth_class in TruthClass],
                "legend": dict(LEGEND),
                "coverage_pct": spatial_truth.coverage_pct,
                "samples": [],
                "raster": {
                    "confidence": "truth/confidence.png",
                    "provenance": "truth/provenance.png",
                    "dominant_camera_index": "truth/camera_index.png",
                },
                "shape": list(spatial_truth.classes.shape),
                "camera_count": len(cameras.poses),
                "occlusion_validated": False,
                "confidence_cap": 0.49,
            }
            _write_json(staging / "truth/visibility.json", {
                "version": 1,
                "method": support.method,
                "projection_method": cameras.projection_method,
                "occlusion_method": support.occlusion_method,
                "occlusion_calibrated_with_heldout_views": False,
                "shape": list(support.visible_count.shape),
                "camera_count": len(cameras.poses),
                "visible_count_min": int(support.visible_count.min()),
                "visible_count_max": int(support.visible_count.max()),
                "visible_count_mean": round(float(support.visible_count.mean()), 8),
            })
            _write_json(staging / "truth/coverage.json", {
                "version": 1,
                "coverage_pct": spatial_truth.coverage_pct,
                "occlusion_validated": False,
                "unmeasured_factors": [
                    "heldout_occlusion_calibration", "source_sharpness", "exposure_consistency",
                    "reprojection_residual", "dynamic_contamination",
                ],
            })
        validate_truth_field_document(truth)
        _write_json(staging / "truth/truth_field.v1.json", truth)
        baseline_dir = staging / "qa/baseline"
        baseline_dir.mkdir(parents=True, exist_ok=True)
        hillshade_path = baseline_dir / "dsm_hillshade.png"
        render_dsm_hillshade(patch, spacing).save(hillshade_path)
        reference_views = {
            "version": 1,
            "status": "compiler_baseline_only",
            "dsm_hillshade": "qa/baseline/dsm_hillshade.png",
            "source_ortho": None,
            "truth_debug": None,
            "unreal_final": [],
            "note": "These are compiler QA views, not Unreal acceptance captures.",
        }
        ortho_path = scene.assets.get("ortho_full") or scene.assets.get("ortho")
        if ortho_path is not None:
            ortho = crop_source_ortho(
                ortho_path, center, scene.world_size_m, request.size_m
            )
            ortho.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            ortho.save(baseline_dir / "source_ortho.png")
            reference_views["source_ortho"] = "qa/baseline/source_ortho.png"
        if confidence_u8 is not None and class_rgb is not None:
            render_truth_debug(class_rgb, confidence_u8).save(
                baseline_dir / "truth_debug.png"
            )
            reference_views["truth_debug"] = "qa/baseline/truth_debug.png"
        _write_json(staging / "qa/reference_views.json", reference_views)

        semantic_masks = conservative_semantic_masks(
            patch,
            patch_valid,
            vegetation_patch,
        )
        mask = compose_static_mask(semantic_masks)
        semantic_rasters = {}
        for semantic_class, semantic_mask in semantic_masks.items():
            relative = Path("semantics/masks") / f"{semantic_class.value}.png"
            (staging / relative).parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(semantic_mask.astype(np.uint8) * 255).save(staging / relative)
            semantic_rasters[semantic_class.value] = relative.as_posix()
        for name, semantic_mask in (("static", mask.static), ("replacement", mask.replacement)):
            relative = Path("semantics/masks") / f"{name}.png"
            Image.fromarray(semantic_mask.astype(np.uint8) * 255).save(staging / relative)
            semantic_rasters[name] = relative.as_posix()
        _write_json(staging / "semantics/masks.json", {
            "version": 1,
            "method": "ortho_dsm_conservative_v1",
            "evidence_classes": list(mask.evidence_classes),
            "shape": list(patch.shape), "static_true": int(mask.static.sum()),
            "replacement_true": int(mask.replacement.sum()),
            "rasters": semantic_rasters,
            "class_pixel_count": {
                semantic_class.value: int(semantic_mask.sum())
                for semantic_class, semantic_mask in semantic_masks.items()
            },
            "unmeasured_classes": [
                "wall", "road", "sidewalk", "soil", "vehicle", "motorcycle",
                "person", "pole", "cable", "sign", "glass", "water",
            ],
            "limitations": [
                "vegetation is a green-dominance color proxy, not instance segmentation",
                "roof is elevated non-vegetation DSM support, not facade classification",
                "ground_surface is intentionally not split into road/sidewalk/soil",
            ],
        })
        graph = SceneGraph(1, (
            SceneNode("ground", "ground_surface", "ground"),
            SceneNode("observed_roof_structure", "roof", "clean_observed_structure"),
            SceneNode("inferred_roof_structure", "roof", "geometrically_inferred_structure"),
            SceneNode("vegetation_replacement", "vegetation", "generated_completion"),
        ))
        _write_json(staging / "semantics/scene_graph.json", graph.as_dict())
        _write_json(staging / "semantics/dynamic_objects.json", {
            "version": 1,
            "detector_status": "unavailable",
            "removed_instances": [],
            "replacement_instances": [],
            "class_level_removal": {
                "semantic_class": "vegetation",
                "mask": semantic_rasters["vegetation"],
                "pixel_count": int(semantic_masks[SemanticClass.VEGETATION].sum()),
                "replacement_policy": "editable Unreal foliage instances pending",
            },
            "reason": "no validated instance detector; no vehicle/person/object identity inferred",
        })

        recipes = allocate_materials([
            SurfacePriority("ground", 0.8, 5.0, 1.0, 1.0, "ground"),
            SurfacePriority("structure", 0.5, 8.0, 0.8, 0.8, "generic_structure"),
        ], resident_budget_bytes=256 * 1024 * 1024, max_4k=1)
        source_color_relative = None
        generated_map_paths = {}
        generation_metrics = None
        source_ortho_path = scene.assets.get("ortho_full") or scene.assets.get("ortho")
        if source_ortho_path is not None:
            source_color = crop_source_ortho(
                source_ortho_path, center, scene.world_size_m, request.size_m
            ).resize((patch.shape[1], patch.shape[0]), Image.Resampling.LANCZOS)
            source_color_relative = "materials/source_color_ortho_proxy.png"
            (staging / source_color_relative).parent.mkdir(parents=True, exist_ok=True)
            source_color.save(staging / source_color_relative)
            generated_maps, generation_metrics = generate_reality_sandwich_maps(
                np.asarray(source_color),
                patch,
                spacing_m=spacing,
                semantic_masks={
                    semantic_class.value: semantic_mask
                    for semantic_class, semantic_mask in semantic_masks.items()
                },
            )
            for name, pixels in generated_maps.items():
                relative = f"materials/{name}.png"
                Image.fromarray(pixels).save(staging / relative)
                generated_map_paths[name] = relative
        generated_texture_paths = (
            [source_color_relative] if source_color_relative else []
        ) + list(generated_map_paths.values())
        _write_json(staging / "materials/recipes.json", {
            "version": 1,
            "allocation_status": (
                "generated_proxy_maps" if generated_map_paths else "planned_not_generated"
            ),
            "resident_budget_bytes": 256 * 1024 * 1024,
            "planned_resident_bytes": sum(recipe.resident_bytes for recipe in recipes),
            "actual_generated_texture_bytes": sum(
                (staging / relative).stat().st_size for relative in generated_texture_paths
            ),
            "recipes": [asdict(recipe) for recipe in recipes],
            "layer_status": {
                "physical_base": "generated_proxy" if generated_map_paths else "parameter_recipe_only",
                "source_microdetail": "generated_proxy" if generated_map_paths else "unavailable",
                "procedural_variation": "parameter_recipe_only",
                "decals_wetness": "parameter_recipe_only",
            },
            "map_availability": {
                "source_color_orthomosaic_proxy": source_color_relative,
                "delighted_basecolor": generated_map_paths.get("delighted_basecolor"),
                "normal": generated_map_paths.get("normal"),
                "roughness": generated_map_paths.get("roughness"),
                "ambient_occlusion": generated_map_paths.get("ambient_occlusion"),
                "microdetail": generated_map_paths.get("microdetail"),
            },
            "generation_metrics": generation_metrics,
            "validation_status": "generated_proxy_maps_unreal_relighting_required",
        })
        _write_json(
            staging / "materials/evidence_atlas.json",
            build_raster_evidence_atlas(
                shape=patch.shape,
                source_color=source_color_relative,
                confidence="truth/confidence.png" if confidence_u8 is not None else None,
                dominant_camera_index=(
                    "truth/camera_index.png" if confidence_u8 is not None else None
                ),
                generated_or_repair_mask=semantic_rasters["replacement"],
            ),
        )
        lighting_profiles = {
            "day": {
                "directional_lux": 80000.0, "temperature_k": 6500.0,
                "sky_intensity": 1.0, "wetness": 0.0, "exposure_ev100": 14.0,
                "sun_rotation_deg": [-45.0, -35.0, 0.0],
            },
            "sunset": {
                "directional_lux": 20000.0, "temperature_k": 3500.0,
                "sky_intensity": 0.45, "wetness": 0.0, "exposure_ev100": 11.0,
                "sun_rotation_deg": [-10.0, -70.0, 0.0],
            },
            "night": {
                "directional_lux": 0.2, "temperature_k": 9000.0,
                "sky_intensity": 0.08, "wetness": 0.0, "exposure_ev100": 4.0,
                "sun_rotation_deg": [-25.0, 120.0, 0.0],
            },
            "rain": {
                "directional_lux": 30000.0, "temperature_k": 7000.0,
                "sky_intensity": 0.65, "wetness": 1.0, "exposure_ev100": 11.5,
                "sun_rotation_deg": [-55.0, -20.0, 0.0],
            },
        }
        _write_json(staging / "materials/lighting_profiles.json", {
            "version": 1,
            "profiles": lighting_profiles,
            "capture_lighting_baked_into_materials": False,
        })
        _write_json(staging / "completion/decisions.json", {
            "version": 1, "status": "not_attempted", "hypotheses": [],
            "reason": "no completion may run without held-out-calibrated per-surface evidence",
        })
        if support is not None and spatial_truth is not None:
            missing = derive_missing_views(
                x_ab_m=x_grid,
                z_ab_m=z_grid,
                height_ab_m=patch,
                confidence=spatial_truth.confidence,
                visible_count=support.visible_count,
                angular_diversity=support.angular_diversity,
                vegetation_mask=vegetation_patch,
            )
        else:
            missing = rank_missing_views([MissingRegion(
                "surface_visibility_gap", 1.0, 1.0, 1.0, (center[0], 15.0, center[1]),
                15.0, -45.0, 0.0, 55.0, "camera support evidence unavailable",
            )])
            missing.update({
                "method": "fallback_no_camera_support",
                "coordinate_frame": "aerobrain_local_m",
                "controls_drone": False,
                "heldout_occlusion_calibrated": False,
            })
        _write_json(staging / "missing_views.json", missing)
        import_plan = {
            "version": 1,
            "hero_id": identity,
            "level_path": f"/Game/Generated/{identity}/HeroCellMap",
            "layers": [
                {
                    "role": row["role"],
                    "asset": row["asset"],
                    "provenance": row["provenance"],
                    "nanite": row["role"] != "collision_geometry" and row["triangles"] > 0,
                    "visible": row["role"] != "collision_geometry" and row["triangles"] > 0,
                    "collision": row["role"] == "collision_geometry",
                    "triangles": row["triangles"],
                }
                for row in geometry_rows
            ],
            "lighting_profiles": lighting_profiles,
            "default_lighting_profile": "day",
            "provenance_debug": {
                "hotkey": "F8",
                "texture": "truth/provenance.png" if spatial_truth is not None else None,
                "legend": dict(LEGEND),
            },
            "reference_cameras": [pose.as_dict() for pose in reference_camera_poses],
            "spawn_ab_m": [center[0], float(np.max(patch) + 5.0), center[1]],
            "materials": "materials/recipes.json",
            "role_materials": {
                "observed_reference_geometry": "generic_structure",
                "ground": "ground",
                "clean_observed_structure": "generic_structure",
                "geometrically_inferred_structure": "generic_structure",
                "generated_completion": "generic_structure",
            },
            "dynamic_objects": "semantics/dynamic_objects.json",
            "generated_content_policy": "rebuild_only_do_not_commit",
        }
        _write_json(staging / "unreal/import_manifest.json", import_plan)
        _write_json(
            staging / "qa/coordinate_validation.json",
            _coordinate_validation_report(
                coordinate, center, request.size_m, patch, spacing, reference_camera_poses
            ),
        )
        local_compute_seconds = round(time.perf_counter() - started, 6)
        _write_json(staging / "cost.json", {
            "version": 1,
            "currency": "USD",
            "external_total": 0.0,
            "cloud": 0.0,
            "api": 0.0,
            "paid_assets": 0.0,
            "local_compute_seconds": local_compute_seconds,
            "local_compute_hours": round(local_compute_seconds / 3600.0, 12),
            "electricity_estimate": None,
            "electricity_note": "not estimated",
        })

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
            "geometry_truth_coverage": "truth/geometry_coverage.json",
            "materials": "materials/recipes.json",
            "evidence_atlas": "materials/evidence_atlas.json",
            "semantics": "semantics/scene_graph.json",
            "completion": "completion/decisions.json",
            "unreal_import": "unreal/import_manifest.json",
            "reference_cameras": {
                "status": "available" if reference_camera_poses else "unavailable",
                "cameras": [pose.as_dict() for pose in reference_camera_poses],
                "reason": None if reference_camera_poses else "no OpenSfM reconstruction available",
            },
            "source": {
                "manifests": "source/manifests.json",
                "cameras": "source/cameras.json",
                "selected_frames": "source/selected_frames.json",
                "aoi": "source/aoi.json",
            },
            "missing_views": "missing_views.json",
            "source_hashes": dict(sorted(scene.source_hashes.items())),
            "dependency_hashes": dependency_hashes,
            "records": {"request": "request.json", "run": "run.json", "cost": "cost.json"},
            "qa": {
                "coordinate_validation": "qa/coordinate_validation.json",
                "source_support": "qa/source_support.json",
                "source_geometry_agreement": "qa/source_geometry_agreement.json",
                "source_silhouette_agreement": "qa/source_silhouette_agreement.json",
                "reference_views": "qa/reference_views.json",
            },
        }
        _write_json(staging / "game_scene.v1.json", manifest)
    return summary | {"output": str(paths.target)}
