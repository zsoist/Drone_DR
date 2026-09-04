import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from world_compiler.ids import canonical_json
from world_compiler.tests.test_manifest import valid_document


SCRIPT = Path(__file__).parents[2] / "unreal/DroneWorld/Scripts/import_hero_cell.py"
SPEC = importlib.util.spec_from_file_location("hero_unreal_importer", SCRIPT)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class UnrealImporterContractTests(unittest.TestCase):
    def test_obj_conversion_applies_manifest_matrix_and_winding_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.obj"
            target = root / "converted.obj"
            source.write_text("v 1 2 3\nv 2 2 3\nv 1 4 3\nf 1 2 3\n")
            matrix = [[100, 0, 0, 0], [0, 0, 100, 0], [0, 100, 0, 0], [0, 0, 0, 1]]

            result = IMPORTER.convert_obj_to_ue(source, target, matrix, flip_winding=True)

            lines = target.read_text().splitlines()
            self.assertIn("v 100.000000000 300.000000000 200.000000000", lines)
            self.assertIn("f 1 3 2", lines)
            self.assertEqual(3, result["vertices"])
            self.assertEqual(1, result["triangles"])

    def test_outside_editor_writes_structured_blocker_not_false_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document = valid_document()
            for row in document["geometry"]:
                path = root / row["asset"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("v 0 0 0\n")
            for relative in (
                document["truth_field"], document["materials"], document["missing_views"],
                *document["records"].values(),
            ):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}\n")
            manifest = root / "game_scene.v1.json"
            manifest.write_bytes(canonical_json(document) + b"\n")
            report_path = root / "unreal/import_report.json"

            report = IMPORTER.run_import(manifest, report_path)

            self.assertEqual("blocked_external", report["status"])
            self.assertEqual("unreal_python_module_unavailable", report["blocker"])
            self.assertEqual(report, json.loads(report_path.read_text()))
            self.assertFalse((root / "unreal/converted").exists())


if __name__ == "__main__":
    unittest.main()
