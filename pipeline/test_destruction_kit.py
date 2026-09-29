"""Destruction kit + HD drone generators: geometry orientation and fail-closed gates."""
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

PIPELINE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE))

import generate_destruction_kit as kit
import generate_drone_hd as drone

SHIPPED = PIPELINE.parent / "web" / "assets" / "destruction" / "models"


class KitGeometryTests(unittest.TestCase):
    def test_tapered_cylinder_faces_outward(self):
        mesh = kit.tapered_cylinder_y(0.3, 0.2, 1.0)
        self.assertTrue(mesh.is_watertight and mesh.is_winding_consistent)
        self.assertGreater(mesh.volume, 0)

    def test_barrel_sector_is_closed_consistent_and_outward(self):
        for a0, a1 in ((0.0, 0.6), (1.0, 2.1), (0.0, 2 * math.pi / 12)):
            mesh = kit.barrel_sector(a0, a1, 0.3, 0.9)
            self.assertTrue(mesh.is_watertight)
            self.assertTrue(mesh.is_winding_consistent)
            self.assertGreater(mesh.volume, 0)

    def test_crater_surface_faces_up(self):
        mesh = kit.make_crater()
        areas = mesh.area_faces
        self.assertGreater(float((mesh.face_normals[:, 1] * areas).sum() / areas.sum()), 0.5)

    def test_brick_rows_span_the_collider_width(self):
        builder, manifest = kit.build_brick_wall(kit.make_flat_materials(), 5)
        half = manifest["intactColliders"][0]["halfExtents"][0]
        scene = builder.scene
        even_row_x = []
        for node in scene.graph.nodes_geometry:
            if not node.startswith("brick_"):
                continue
            matrix, geom = scene.graph[node]
            bounds = scene.geometry[geom].bounds + matrix[:3, 3]
            if abs(matrix[1, 3] - 0.5 * 2.45 / 7) < 1e-6:  # first row
                even_row_x += [bounds[0][0], bounds[1][0]]
        self.assertAlmostEqual(min(even_row_x), -half, delta=0.12)
        self.assertAlmostEqual(max(even_row_x), half, delta=0.12)

    def test_crown_and_branches_have_pivot_transforms(self):
        builder, _ = kit.build_tree(kit.make_flat_materials(), 5)
        scene = builder.scene
        for name in ("crown_00", "crown_03", "branches_00", "branches_03"):
            matrix, geom = scene.graph[name]
            self.assertGreater(float(np.abs(matrix[:3, 3]).max()), 0.1, name)
            centre = scene.geometry[geom].bounds.mean(axis=0)
            if name.startswith("crown"):
                self.assertLess(float(np.abs(centre).max()), 0.05, name)

    def test_set_root_rebinds_outputs(self):
        original = kit.ROOT
        try:
            with tempfile.TemporaryDirectory() as folder:
                kit.set_root(Path(folder))
                self.assertEqual(kit.MODELS, Path(folder) / "threejs_destruction_kit" / "models")
        finally:
            kit.set_root(original)
        self.assertNotEqual(kit.ROOT, Path("/mnt/data"))


class KitValidationTests(unittest.TestCase):
    def test_shipped_models_have_no_winding_issues(self):
        for path in sorted(SHIPPED.glob("*.glb")):
            scene = trimesh.load(path, force="scene", process=False)
            self.assertEqual(kit.winding_issues(scene), [], path.name)

    def test_winding_check_catches_inverted_and_mixed_meshes(self):
        scene = trimesh.Scene()
        good = trimesh.creation.box()
        bad = good.copy()
        bad.invert()
        scene.add_geometry(good, node_name="good", geom_name="g1")
        scene.add_geometry(bad, node_name="bad", geom_name="g2")
        issues = kit.winding_issues(scene)
        self.assertEqual(len(issues), 1)
        self.assertIn("bad", issues[0])
        mixed = trimesh.creation.box()
        mixed.faces[0] = mixed.faces[0][::-1]
        scene2 = trimesh.Scene()
        scene2.add_geometry(mixed, node_name="mixed", geom_name="g3")
        self.assertTrue(kit.winding_issues(scene2))

    def _ok(self):
        return ([{"file": "models/a.glb", "trimeshReload": True, "windingIssues": []}],
                {"available": True, "allZeroErrorsWarnings": True},
                {"available": True, "allLoadable": True})

    def test_gate_passes_only_when_everything_ran_and_passed(self):
        structural, validator, loader = self._ok()
        self.assertEqual(kit.validation_failures(structural, validator, loader), [])

    def test_missing_validators_fail_unless_explicitly_allowed(self):
        structural, _, _ = self._ok()
        missing = {"available": False, "reason": "not found"}
        self.assertEqual(len(kit.validation_failures(structural, missing, missing)), 2)
        self.assertEqual(kit.validation_failures(structural, missing, missing, allow_missing=True), [])

    def test_failed_validator_loader_reload_and_winding_all_fail(self):
        structural, validator, loader = self._ok()
        self.assertTrue(kit.validation_failures(structural, {"available": True, "allZeroErrorsWarnings": False}, loader))
        self.assertTrue(kit.validation_failures(structural, validator, {"available": True, "allLoadable": False}))
        self.assertTrue(kit.validation_failures(structural, validator, {"available": True, "processError": "boom"}))
        self.assertTrue(kit.validation_failures([{**structural[0], "trimeshReload": False}], validator, loader))
        self.assertTrue(kit.validation_failures([{**structural[0], "windingIssues": ["x: inward"]}], validator, loader))
        # an allowed-missing flag never masks a validator that ran and failed
        self.assertTrue(kit.validation_failures(structural, {"available": True, "allZeroErrorsWarnings": False},
                                                loader, allow_missing=True))


class DroneGateTests(unittest.TestCase):
    def _report(self, **over):
        base = {"triangle_budget_ok": True, "material_budget_ok": True, "propeller_nodes_present": True,
                "x_span_error_m": 0.0, "textures": 0, "images": 0, "animations": 0, "cameras": 0}
        base.update(over)
        return base

    def test_gate_passes_clean_report(self):
        self.assertEqual(drone.gate_failures(self._report()), [])

    def test_gate_reports_each_violation(self):
        for over in ({"triangle_budget_ok": False}, {"material_budget_ok": False},
                     {"propeller_nodes_present": False}, {"x_span_error_m": 0.05},
                     {"textures": 1}, {"animations": 1}):
            self.assertEqual(len(drone.gate_failures(self._report(**over))), 1, over)

    def test_material_budget_matches_header(self):
        self.assertEqual(drone.MATERIAL_BUDGET, 3)
        self.assertIn("<= 3 PBR materials", drone.__doc__)


if __name__ == "__main__":
    unittest.main()
