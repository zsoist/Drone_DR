"""Validate, transform, and import one game_scene.v1 into Unreal.

Outside Unreal this emits a truthful ``blocked_external`` report and performs no
geometry conversion. Inside Unreal it converts absolute AeroBrain-meter OBJ files
to centered Unreal-centimeter OBJ files before handing them to AssetTools.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from world_compiler.export.manifest import validate_game_scene_document
from world_compiler.ids import canonical_json


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


def run_import(manifest_path: Path, report_path: Path) -> dict:
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_game_scene_document(document, root)
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
    for layer in document["geometry"]:
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
    errors = [layer["role"] for layer, task in zip(document["geometry"], import_tasks) if not task.imported_object_paths]
    report = {
        "version": 1,
        "status": "imported" if not errors else "failed",
        "blocker": None,
        "hero_id": document["hero_id"],
        "engine_version": str(unreal.SystemLibrary.get_engine_version()),
        "project": str(unreal.Paths.get_project_file_path()),
        "imported_assets": imported,
        "converted_layers": converted,
        "reference_camera_count": len(document["reference_cameras"]["cameras"]),
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
