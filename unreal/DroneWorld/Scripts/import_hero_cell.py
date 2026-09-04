"""Validate, transform, and import one game_scene.v1 into Unreal.

Outside Unreal this emits a truthful ``blocked_external`` report and performs no
geometry conversion. Inside Unreal it converts absolute AeroBrain-meter OBJ files
to centered Unreal-centimeter OBJ files before handing them to AssetTools.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from world_compiler.export.manifest import validate_game_scene_document
from world_compiler.ids import canonical_json


REQUIRED_PROFILES = {"day", "sunset", "night", "rain"}


def _default_import_plan(document: dict) -> dict:
    return {
        "version": 1,
        "level_path": f"/Game/Generated/{document['hero_id']}/HeroCellMap",
        "layers": [
            {
                "role": row["role"], "asset": row["asset"],
                "provenance": row["provenance"],
            }
            for row in document["geometry"]
        ],
        "lighting_profiles": {name: {} for name in sorted(REQUIRED_PROFILES)},
        "provenance_debug": {"hotkey": "F8", "texture": None},
        "reference_cameras": document["reference_cameras"]["cameras"],
    }


def validate_import_plan(plan: dict, document: dict) -> dict:
    if plan.get("version") != 1 or not str(plan.get("level_path") or "").startswith("/Game/Generated/"):
        raise ValueError("invalid Unreal import plan")
    layers = plan.get("layers")
    expected = {
        row["role"]: (row["asset"], row["provenance"])
        for row in document["geometry"]
    }
    if (
        not isinstance(layers, list)
        or len(layers) != len(expected)
        or {row.get("role") for row in layers} != set(expected)
        or any((row.get("asset"), row.get("provenance")) != expected[row.get("role")] for row in layers)
    ):
        raise ValueError("Unreal import layers do not match game scene")
    if set(plan.get("lighting_profiles") or {}) != REQUIRED_PROFILES:
        raise ValueError("Unreal import plan requires day, sunset, night, and rain")
    provenance = plan.get("provenance_debug") or {}
    if provenance.get("hotkey") != "F8":
        raise ValueError("Unreal provenance debug hotkey must be F8")
    references = plan.get("reference_cameras")
    if not isinstance(references, list):
        raise ValueError("Unreal reference cameras are required")
    if document["reference_cameras"]["status"] == "available" and not references:
        raise ValueError("available reference cameras cannot be omitted")
    return plan


def _load_import_plan(root: Path, document: dict) -> dict:
    relative = document.get("unreal_import")
    if relative:
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Unreal import plan escapes or is missing")
        plan = json.loads(path.read_text(encoding="utf-8"))
    else:
        plan = _default_import_plan(document)
    return validate_import_plan(plan, document)


def _transform(point, matrix):
    x, y, z = point
    values = (x, y, z, 1.0)
    return tuple(sum(float(matrix[row][col]) * values[col] for col in range(4)) for row in range(3))


def convert_obj_to_ue(source: Path, target: Path, matrix: list, *, flip_winding: bool) -> dict:
    """Convert positions and triangle winding while preserving OBJ comments/groups."""
    target.parent.mkdir(parents=True, exist_ok=True)
    output = []
    vertices = 0
    triangles = 0
    for raw_line in source.read_text(encoding="utf-8").splitlines():
        parts = raw_line.split()
        if parts[:1] == ["v"] and len(parts) >= 4:
            transformed = _transform(tuple(float(value) for value in parts[1:4]), matrix)
            output.append("v {:.9f} {:.9f} {:.9f}".format(*transformed))
            vertices += 1
        elif parts[:1] == ["f"] and len(parts) == 4:
            face = parts[1:]
            if flip_winding:
                face[1], face[2] = face[2], face[1]
            output.append("f " + " ".join(face))
            triangles += 1
        else:
            output.append(raw_line)
    target.write_text("\n".join(output) + "\n", encoding="utf-8")
    return {"vertices": vertices, "triangles": triangles, "path": str(target)}


def _write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(report) + b"\n")


def _transform_vector(vector, matrix):
    return tuple(sum(float(matrix[row][col]) * float(vector[col]) for col in range(3)) for row in range(3))


def load_material_recipe(root: Path, relative: str) -> tuple[dict, dict[str, Path]]:
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("material recipes escape or are missing")
    document = json.loads(path.read_text(encoding="utf-8"))
    resolved = {}
    for name, map_relative in (document.get("map_availability") or {}).items():
        if not map_relative:
            continue
        map_path = (root / map_relative).resolve()
        if not map_path.is_relative_to(root) or not map_path.is_file():
            raise ValueError(f"material map escapes or is missing: {name}")
        resolved[str(name)] = map_path
    return document, resolved


def _provenance_materials(unreal, destination: str, legend: dict) -> dict:
    materials = {}
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    for truth_class, color_hex in sorted(legend.items()):
        name = f"M_Provenance_{truth_class}"
        package = f"{destination}/Debug"
        existing = unreal.EditorAssetLibrary.load_asset(f"{package}/{name}")
        material = existing or asset_tools.create_asset(name, package, unreal.Material, unreal.MaterialFactoryNew())
        if material and not existing:
            color = tuple(int(color_hex[index:index + 2], 16) / 255.0 for index in (1, 3, 5))
            expression = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector
            )
            expression.constant = unreal.LinearColor(color[0], color[1], color[2], 1.0)
            unreal.MaterialEditingLibrary.connect_material_property(
                expression, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR
            )
            unreal.MaterialEditingLibrary.recompile_material(material)
            unreal.EditorAssetLibrary.save_loaded_asset(material)
        materials[truth_class] = f"{package}/{name}"
    return materials


def _pbr_materials(unreal, destination: str, root: Path, plan: dict) -> dict:
    relative = plan.get("materials")
    if not relative:
        return {}
    recipe_document, map_paths = load_material_recipe(root, relative)
    recipes = recipe_document.get("recipes") or []
    colors = {
        "ground": (0.18, 0.16, 0.13),
        "generic_structure": (0.42, 0.40, 0.36),
    }
    roughness = {"ground": 0.82, "generic_structure": 0.68}
    materials = {}
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    texture_assets = {}
    texture_package = f"{destination}/Materials/Textures"
    texture_tasks = []
    texture_names = []
    for map_name, map_path in sorted(map_paths.items()):
        task = unreal.AssetImportTask()
        task.filename = str(map_path)
        task.destination_path = texture_package
        task.destination_name = f"T_{map_name}"
        task.automated = True
        task.replace_existing = True
        task.save = True
        texture_tasks.append(task)
        texture_names.append(map_name)
    if texture_tasks:
        asset_tools.import_asset_tasks(texture_tasks)
    for map_name, task in zip(texture_names, texture_tasks):
        if not task.imported_object_paths:
            continue
        texture = unreal.EditorAssetLibrary.load_asset(task.imported_object_paths[0])
        if texture and map_name == "normal":
            texture.set_editor_property(
                "compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP
            )
            texture.set_editor_property("srgb", False)
        elif texture and map_name in {"roughness", "ambient_occlusion", "microdetail"}:
            texture.set_editor_property("srgb", False)
        if texture:
            unreal.EditorAssetLibrary.save_loaded_asset(texture)
            texture_assets[map_name] = texture

    def texture_sample(material, map_name, parameter_name, material_property, output="RGB"):
        texture = texture_assets.get(map_name)
        if not texture:
            return False
        sample = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionTextureSampleParameter2D
        )
        sample.set_editor_property("parameter_name", parameter_name)
        sample.set_editor_property("texture", texture)
        unreal.MaterialEditingLibrary.connect_material_property(
            sample, output, material_property
        )
        return True

    for recipe in recipes:
        material_class = str(recipe["material_class"])
        if material_class in materials:
            continue
        name = f"M_PBR_{material_class}"
        package = f"{destination}/Materials"
        asset_path = f"{package}/{name}"
        material = unreal.EditorAssetLibrary.load_asset(asset_path)
        if not material:
            material = asset_tools.create_asset(name, package, unreal.Material, unreal.MaterialFactoryNew())
            if not texture_sample(
                material, "delighted_basecolor", "AeroBrainBaseColor",
                unreal.MaterialProperty.MP_BASE_COLOR,
            ):
                base = unreal.MaterialEditingLibrary.create_material_expression(
                    material, unreal.MaterialExpressionConstant3Vector
                )
                color = colors.get(material_class, (0.35, 0.35, 0.35))
                base.constant = unreal.LinearColor(*color, 1.0)
                unreal.MaterialEditingLibrary.connect_material_property(
                    base, "", unreal.MaterialProperty.MP_BASE_COLOR
                )
            if not texture_sample(
                material, "roughness", "AeroBrainRoughness",
                unreal.MaterialProperty.MP_ROUGHNESS, "R",
            ):
                rough = unreal.MaterialEditingLibrary.create_material_expression(
                    material, unreal.MaterialExpressionConstant
                )
                rough.r = roughness.get(material_class, 0.7)
                unreal.MaterialEditingLibrary.connect_material_property(
                    rough, "", unreal.MaterialProperty.MP_ROUGHNESS
                )
            texture_sample(
                material, "normal", "AeroBrainNormal", unreal.MaterialProperty.MP_NORMAL
            )
            texture_sample(
                material, "ambient_occlusion", "AeroBrainAO",
                unreal.MaterialProperty.MP_AMBIENT_OCCLUSION, "R",
            )
            unreal.MaterialEditingLibrary.recompile_material(material)
            unreal.EditorAssetLibrary.save_loaded_asset(material)
        materials[material_class] = asset_path
    return materials


def _spawn_lighting_profiles(unreal, plan: dict) -> list:
    actors = []
    default = plan.get("default_lighting_profile", "day")
    for name, profile in sorted(plan["lighting_profiles"].items()):
        rotation_values = profile.get("sun_rotation_deg", [-45.0, 0.0, 0.0])
        rotation = unreal.Rotator(*rotation_values)
        sun = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 5000.0), rotation
        )
        sun.set_actor_label(f"Lighting_{name}_Sun")
        sun.tags = [f"lighting_profile:{name}", f"wetness:{profile.get('wetness', 0.0)}"]
        sun.set_actor_hidden_in_game(name != default)
        component = sun.get_component_by_class(unreal.DirectionalLightComponent)
        component.set_editor_property("intensity", float(profile.get("directional_lux", 0.0)))
        component.set_editor_property("use_temperature", True)
        component.set_editor_property("temperature", float(profile.get("temperature_k", 6500.0)))
        sky = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.SkyLight, unreal.Vector(0.0, 0.0, 1000.0)
        )
        sky.set_actor_label(f"Lighting_{name}_Sky")
        sky.tags = [f"lighting_profile:{name}"]
        sky.set_actor_hidden_in_game(name != default)
        sky_component = sky.get_component_by_class(unreal.SkyLightComponent)
        sky_component.set_editor_property("intensity", float(profile.get("sky_intensity", 1.0)))
        actors.extend((sun.get_path_name(), sky.get_path_name()))
    return actors


def _spawn_reference_cameras(unreal, cameras: list, matrix: list) -> list:
    spawned = []
    for camera in cameras:
        location = _transform(camera["center_ab_m"], matrix)
        forward = _transform_vector(camera["forward_ab"], matrix)
        horizontal = math.hypot(forward[0], forward[1])
        rotation = unreal.Rotator(
            math.degrees(math.atan2(forward[2], horizontal)),
            math.degrees(math.atan2(forward[1], forward[0])),
            0.0,
        )
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.CineCameraActor, unreal.Vector(*location), rotation
        )
        actor.set_actor_label(f"Reference_{camera['camera_id']}")
        actor.tags = ["HeroCellReferenceCamera", camera["camera_id"]]
        spawned.append(actor.get_path_name())
    return spawned


def run_import(manifest_path: Path, report_path: Path) -> dict:
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_game_scene_document(document, root)
    plan = _load_import_plan(root, document)
    try:
        import unreal
        editor_api_available = all(
            hasattr(unreal, name)
            for name in ("AssetImportTask", "AssetToolsHelpers", "SystemLibrary", "Paths")
        )
    except ImportError:
        editor_api_available = False
    if not editor_api_available:
        report = {
            "version": 1,
            "status": "blocked_external",
            "blocker": "unreal_python_module_unavailable",
            "hero_id": document["hero_id"],
            "imported_assets": [],
            "converted_layers": [],
            "level_path": plan["level_path"],
            "lighting_profiles": sorted(plan["lighting_profiles"]),
            "provenance_hotkey": plan["provenance_debug"]["hotkey"],
            "reference_camera_count": len(plan["reference_cameras"]),
            "errors": [],
        }
        _write_report(report_path, report)
        return report

    converted_root = Path(report_path).parent / "converted"
    converted = []
    import_tasks = []
    matrix = document["coordinates"]["matrix_ab_m_to_ue_cm"]
    flip = bool(document["coordinates"].get("winding_flip_required"))
    destination = f"/Game/Generated/{document['hero_id']}"
    unreal.EditorLevelLibrary.new_level(plan["level_path"])
    active_layers = [layer for layer in plan["layers"] if int(layer.get("triangles", 1)) > 0]
    skipped_layers = [layer["role"] for layer in plan["layers"] if int(layer.get("triangles", 1)) == 0]
    for layer in active_layers:
        source = root / layer["asset"]
        target = converted_root / f"{layer['role']}.obj"
        converted.append({"role": layer["role"]} | convert_obj_to_ue(source, target, matrix, flip_winding=flip))
        task = unreal.AssetImportTask()
        task.filename = str(target)
        task.destination_path = destination
        task.destination_name = layer["role"]
        task.automated = True
        task.replace_existing = True
        task.save = True
        import_tasks.append(task)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(import_tasks)
    imported = [path for task in import_tasks for path in task.imported_object_paths]
    errors = [layer["role"] for layer, task in zip(active_layers, import_tasks) if not task.imported_object_paths]
    legend = plan["provenance_debug"].get("legend") or {
        "OBSERVED_MULTI_VIEW": "#00a651", "OBSERVED_WEAK": "#ffd400",
        "GEOMETRICALLY_INFERRED": "#ffd400", "GENERATED_CONSTRAINED": "#e31b23",
        "UNKNOWN": "#000000",
    }
    provenance_materials = _provenance_materials(unreal, destination, legend)
    pbr_materials = _pbr_materials(unreal, destination, root, plan)
    actors = []
    for layer, task in zip(active_layers, import_tasks):
        if not task.imported_object_paths:
            continue
        asset = unreal.EditorAssetLibrary.load_asset(task.imported_object_paths[0])
        actor = unreal.EditorLevelLibrary.spawn_actor_from_object(asset, unreal.Vector(0.0, 0.0, 0.0))
        actor.set_actor_label(layer["role"])
        actor.tags = [f"provenance:{layer['provenance']}", f"role:{layer['role']}"]
        material_class = (plan.get("role_materials") or {}).get(layer["role"])
        material_path = pbr_materials.get(material_class)
        if material_path:
            material = unreal.EditorAssetLibrary.load_asset(material_path)
            component = actor.static_mesh_component
            for slot in range(max(1, component.get_num_materials())):
                component.set_material(slot, material)
        if layer.get("collision"):
            actor.set_actor_hidden_in_game(True)
            component = actor.static_mesh_component
            component.set_collision_profile_name("BlockAll")
        actors.append(actor.get_path_name())
    reference_cameras = _spawn_reference_cameras(
        unreal, plan["reference_cameras"], document["coordinates"]["matrix_ab_m_to_ue_cm"]
    )
    lighting_actors = _spawn_lighting_profiles(unreal, plan)
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    report = {
        "version": 1,
        "status": "imported" if not errors else "failed",
        "blocker": None,
        "hero_id": document["hero_id"],
        "engine_version": str(unreal.SystemLibrary.get_engine_version()),
        "project": str(unreal.Paths.get_project_file_path()),
        "imported_assets": imported,
        "spawned_actors": actors,
        "converted_layers": converted,
        "skipped_empty_layers": skipped_layers,
        "reference_camera_count": len(reference_cameras),
        "reference_cameras": reference_cameras,
        "level_path": plan["level_path"],
        "lighting_profiles": sorted(plan["lighting_profiles"]),
        "provenance_materials": provenance_materials,
        "pbr_materials": pbr_materials,
        "lighting_actors": lighting_actors,
        "provenance_hotkey": plan["provenance_debug"]["hotkey"],
        "shader_status": "materials_recompiled",
        "errors": errors,
    }
    _write_report(report_path, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    report = args.report or args.manifest.parent / "unreal/import_report.json"
    result = run_import(args.manifest, report)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "imported" else 2


if __name__ == "__main__":
    raise SystemExit(main())
