import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

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
        ortho = np.zeros((*shape, 3), dtype=np.uint8)
        ortho[..., 0] = np.linspace(60, 210, shape[1], dtype=np.uint8)
        ortho[..., 1] = 120
        ortho[..., 2] = 80
        Image.fromarray(ortho).save(model / "ortho.png")
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
            "ortho_full": "data/models/recon_fixture/ortho.png",
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
            "qa/source_silhouette_agreement.json",
            "qa/metrics.json", "qa/acceptance.md",
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
        missing_views = json.loads((manifest_path.parent / "missing_views.json").read_text())
        self.assertFalse(missing_views["controls_drone"])
        self.assertEqual("truth_field_weak_support_nms_v1", missing_views["method"])
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
        atlas = json.loads((manifest_path.parent / "materials/evidence_atlas.json").read_text())
        self.assertFalse(atlas["per_texel_camera_weights_available"])
        recipes = json.loads((manifest_path.parent / "materials/recipes.json").read_text())
        self.assertEqual("generated_proxy_maps", recipes["allocation_status"])
        for relative in recipes["map_availability"].values():
            self.assertTrue((manifest_path.parent / relative).is_file(), relative)
        self.assertLess(
            recipes["generation_metrics"]["low_frequency_luma_std_after"],
            recipes["generation_metrics"]["low_frequency_luma_std_before"],
        )
        geometry_coverage = json.loads(
            (manifest_path.parent / "truth/geometry_coverage.json").read_text()
        )
        self.assertAlmostEqual(100.0, sum(geometry_coverage["coverage_pct"].values()))
        self.assertTrue(geometry_coverage["route_visibility_weighted"])
        self.assertEqual(31, geometry_coverage["route_sample_count"])
        self.assertFalse(geometry_coverage["camera_frustum_applied"])
        agreement = json.loads(
            (manifest_path.parent / "qa/source_geometry_agreement.json").read_text()
        )
        self.assertFalse(agreement["independent_ground_truth"])
        self.assertFalse(agreement["acceptance_gate_eligible"])
        silhouette = json.loads(
            (manifest_path.parent / "qa/source_silhouette_agreement.json").read_text()
        )
        self.assertFalse(silhouette["independent_ground_truth"])
        self.assertFalse(silhouette["acceptance_gate_eligible"])
        self.assertEqual("opensfm_source_camera_mesh_silhouette_iou_v1", silhouette["method"])
        metrics = json.loads((manifest_path.parent / "qa/metrics.json").read_text())
        self.assertEqual("partially accepted", metrics["verdict"])
        self.assertEqual("not_run", metrics["unreal_status"])
        self.assertIsNone(metrics["geometry"]["median_m"])
        self.assertFalse(metrics["geometry"]["independent_ground_truth"])
        self.assertEqual(5, len(metrics["provenance"]["route_coverage_pct"]))
        acceptance_text = (manifest_path.parent / "qa/acceptance.md").read_text()
        self.assertIn(first["hero_id"], acceptance_text)
        self.assertIn("OBSERVED_WEAK", acceptance_text)
        self.assertIn("unreal_import_not_run", acceptance_text)
        selection = json.loads((manifest_path.parent / "selection.json").read_text())
        self.assertGreaterEqual(len(selection["top_candidates"]), 1)
        self.assertLessEqual(len(selection["top_candidates"]), 10)
        self.assertEqual(selection["selected"], selection["top_candidates"][0])
        self.assertIn("components", selection["top_candidates"][0])


if __name__ == "__main__":
    unittest.main()
