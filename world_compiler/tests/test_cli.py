import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from world_compiler.builder import BuildRequest, build_world


FIXTURE = Path(__file__).parent / "fixtures" / "vault"


class CompilerCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        shutil.copytree(FIXTURE, self.vault)
        model = self.vault / "models/recon_fixture"
        scene_path = self.vault / "manifest/scenes/scene_fixture.json"
        scene = json.loads(scene_path.read_text())
        version = scene["versions"][0]
        version["effective_sources"] = ["clip_a", "clip_b"]
        version["metrics"] = {
            "cameras_reconstructed": 20,
            "cameras_total": 20,
            "gsd_cm_px": 2.5,
        }
        scene_path.write_text(json.dumps(scene))

        shape = (121, 121)
        height = np.zeros(shape, dtype="<f4")
        height[45:76, 45:76] = 8.0
        valid = np.ones(shape, dtype="u1")
        coverage = np.ones(shape, dtype="u1")
        height.tofile(model / "dsm_lod.bin")
        valid.tofile(model / "dsm_lod.mask.bin")
        coverage.tofile(model / "mesh_coverage.bin")
        (model / "dsm_lod.json").write_text(json.dumps({
            "grid": list(shape), "size_m": [120.0, 120.0],
            "spacing_m": [1.0, 1.0], "elev_min": 0.0, "elev_max": 8.0,
            "bin": "dsm_lod.bin", "mask_bin": "dsm_lod.mask.bin",
        }))
        (model / "mesh_coverage.json").write_text(json.dumps({
            "version": 1, "grid": list(shape), "bin": "mesh_coverage.bin",
        }))
        manifest_path = model / "scene.v2.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["world"].update({"size_m": [120.0, 120.0], "grid": list(shape), "spacing_m": [1.0, 1.0]})
        manifest["world"].update({"center_wgs84": [0.0, 0.0], "elev_min": 0.0})
        manifest["assets"].update({
            "dsm_lod_mask": "data/models/recon_fixture/dsm_lod.mask.bin",
            "mesh_coverage": "data/models/recon_fixture/mesh_coverage.bin",
            "mesh_coverage_meta": "data/models/recon_fixture/mesh_coverage.json",
        })
        manifest_path.write_text(json.dumps(manifest))
        reconstruction = self.vault / "odm/proj_recon_fixture/opensfm/reconstruction.json"
        reconstruction.parent.mkdir(parents=True)
        shots = {}
        for index, x in enumerate((-20.0, 0.0, 20.0)):
            rotation = [math.pi, 0.0, 0.0]
            # t = -R*C for C=(x, 0, 30) in topocentric ENU.
            shots[f"frame_{index}.jpg"] = {
                "camera": "cam", "rotation": rotation, "translation": [-x, 0.0, 30.0],
            }
        reconstruction.write_text(json.dumps([{
            "reference_lla": {"latitude": 0.0, "longitude": 0.0, "altitude": 0.0},
            "cameras": {"cam": {
                "projection_type": "brown", "width": 1000, "height": 1000,
                "focal_x": 0.8, "focal_y": 0.8, "c_x": 0.0, "c_y": 0.0,
            }},
            "shots": shots,
        }]))
        self.request = BuildRequest("scene_fixture", "recon_fixture", 100.0, "auto", "hero-r0")

    def tearDown(self):
        self.temporary.cleanup()

    def test_dry_run_selects_without_writing_worlds(self):
        summary = build_world(self.vault, self.request, dry_run=True)

        self.assertEqual("dry_run", summary["status"])
        self.assertFalse((self.vault / "worlds").exists())
        self.assertNotIn("wgs84", json.dumps(summary).lower())

    def test_build_twice_reuses_identical_content_addressed_world(self):
        first = build_world(self.vault, self.request)
        manifest_path = Path(first["output"]) / "game_scene.v1.json"
        first_bytes = manifest_path.read_bytes()
        second = build_world(self.vault, self.request)

        self.assertEqual("built", first["status"])
        self.assertEqual("existing", second["status"])
        self.assertEqual(first["hero_id"], second["hero_id"])
        self.assertEqual(first_bytes, manifest_path.read_bytes())
        document = json.loads(first_bytes)
        self.assertEqual(6, len(document["geometry"]))
        self.assertEqual("available", document["reference_cameras"]["status"])
        self.assertEqual(3, len(document["reference_cameras"]["cameras"]))
        truth = json.loads((manifest_path.parent / document["truth_field"]).read_text())
        self.assertAlmostEqual(100.0, sum(truth["coverage_pct"].values()))
        self.assertIn("raster", truth)
        cost = json.loads((manifest_path.parent / "cost.json").read_text())
        self.assertGreater(cost["local_compute_seconds"], 0.0)
        self.assertEqual(0.0, cost["external_total"])
        for relative in (
            "source/manifests.json", "source/cameras.json", "source/selected_frames.json",
            "source/aoi.json", "truth/confidence.png", "truth/provenance.png",
            "truth/camera_index.png", "truth/visibility.json", "truth/coverage.json",
            "truth/geometry_coverage.json",
            "semantics/dynamic_objects.json", "materials/lighting_profiles.json",
            "unreal/import_manifest.json",
            "qa/coordinate_validation.json",
            "qa/source_support.json",
            "qa/source_geometry_agreement.json",
            "qa/reference_views.json", "qa/baseline/dsm_hillshade.png",
            "qa/baseline/truth_debug.png",
        ):
            self.assertTrue((manifest_path.parent / relative).is_file(), relative)
        semantics = json.loads((manifest_path.parent / "semantics/masks.json").read_text())
        self.assertEqual("ortho_dsm_conservative_v1", semantics["method"])
        self.assertIn("roof", semantics["rasters"])
        self.assertIn("vegetation", semantics["rasters"])
        for relative in semantics["rasters"].values():
            self.assertTrue((manifest_path.parent / relative).is_file(), relative)
        import_plan = json.loads((manifest_path.parent / "unreal/import_manifest.json").read_text())
        self.assertEqual("F8", import_plan["provenance_debug"]["hotkey"])
        self.assertEqual({"day", "sunset", "night", "rain"}, set(import_plan["lighting_profiles"]))
        coordinate_report = json.loads((manifest_path.parent / "qa/coordinate_validation.json").read_text())
        self.assertLessEqual(coordinate_report["max_roundtrip_error_m"], 1e-9)
        self.assertEqual(3, coordinate_report["source_camera_centers"])
        self.assertEqual("insufficient_source_cameras", coordinate_report["status"])
        visibility = json.loads((manifest_path.parent / "truth/visibility.json").read_text())
        self.assertEqual("dsm_ray_march_v1", visibility["occlusion_method"])
        self.assertFalse(visibility["occlusion_calibrated_with_heldout_views"])
        geometry_coverage = json.loads(
            (manifest_path.parent / "truth/geometry_coverage.json").read_text()
        )
        self.assertAlmostEqual(100.0, sum(geometry_coverage["coverage_pct"].values()))
        self.assertFalse(geometry_coverage["route_visibility_weighted"])
        agreement = json.loads(
            (manifest_path.parent / "qa/source_geometry_agreement.json").read_text()
        )
        self.assertFalse(agreement["independent_ground_truth"])
        self.assertFalse(agreement["acceptance_gate_eligible"])
        selection = json.loads((manifest_path.parent / "selection.json").read_text())
        self.assertGreaterEqual(len(selection["top_candidates"]), 1)
        self.assertLessEqual(len(selection["top_candidates"]), 10)
        self.assertEqual(selection["selected"], selection["top_candidates"][0])
        self.assertIn("components", selection["top_candidates"][0])


if __name__ == "__main__":
    unittest.main()
