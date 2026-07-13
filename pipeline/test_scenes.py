import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scenes
import jobs
import aerobrain_server as server
import worker


class SceneStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_dir = scenes.SCENES_DIR
        scenes.SCENES_DIR = Path(self.tmp.name) / "scenes"

    def tearDown(self):
        scenes.SCENES_DIR = self.old_dir
        self.tmp.cleanup()

    def test_adding_capture_creates_version_without_overwriting_active(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A"], [])
        scenes.add_version(scene["id"], "recon_v1", ["A"], [], "ready",
                           merge_label="SINGLE", required_artifacts_ok=True)
        scenes.promote(scene["id"], "recon_v1")
        scenes.add_version(scene["id"], "recon_v2", ["A", "B"], ["p.jpg"], "processing")

        result = scenes.get_scene(scene["id"])

        self.assertEqual("recon_v1", result["active_version"])
        self.assertEqual(["recon_v1", "recon_v2"], [v["id"] for v in result["versions"]])
        self.assertEqual(["A", "B"], result["source_inventory"]["videos"])
        self.assertEqual(["p.jpg"], result["source_inventory"]["photos"])

    def test_partial_version_cannot_be_promoted(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A"], [])
        scenes.add_version(scene["id"], "recon_partial", ["A", "B"], [], "ready",
                           merge_label="PARTIAL", required_artifacts_ok=True)

        with self.assertRaises(ValueError):
            scenes.promote(scene["id"], "recon_partial")

    def test_missing_artifacts_cannot_be_promoted(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A"], [])
        scenes.add_version(scene["id"], "recon_missing", ["A"], [], "ready",
                           merge_label="SINGLE", required_artifacts_ok=False)

        with self.assertRaises(ValueError):
            scenes.promote(scene["id"], "recon_missing")

    def test_version_source_membership_is_immutable(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A"], [])
        scenes.add_version(scene["id"], "recon_v1", ["A"], [], "processing")

        with self.assertRaises(ValueError):
            scenes.add_version(scene["id"], "recon_v1", ["A", "B"], [], "processing")

    def test_prepare_improvement_creates_new_reconstruction_version(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A", "B"], [])
        scenes.add_version(scene["id"], "recon_v1", ["A", "B"], [], "ready",
                           merge_label="FULL", required_artifacts_ok=True)
        scenes.promote(scene["id"], "recon_v1")

        reconstruction_id, spec = server.prepare_scene_version(
            scene["id"], ["A", "B", "C"], ["p.jpg"], "alta", "Casa mejorada",
            then_splat=True, splat_preset="ultra")

        self.assertEqual(jobs.recon_id_for(["A", "B", "C"], ["p.jpg"]), reconstruction_id)
        self.assertEqual(scene["id"], spec["scene_id"])
        self.assertTrue(spec["then_splat"])
        self.assertEqual("ultra", spec["splat_preset"])
        self.assertEqual("recon_v1", scenes.get_scene(scene["id"])["active_version"])
        self.assertEqual("processing", scenes.get_scene(scene["id"])["versions"][-1]["status"])

    def test_first_valid_completion_auto_promotes_but_partial_does_not(self):
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A", "B"], [])
        reconstruction_id, spec = server.prepare_scene_version(
            scene["id"], ["A", "B"], [], "alta", "Casa", False, "cinematic")
        job = {"id": "3d-scene", "spec": spec}

        worker.record_scene_completion(job, {
            "pipeline_mode": "full_3d", "preset": "alta",
            "qa": {"cameras_reconstructed": 40, "cameras_total": 40},
            "reconstruction": {"merge_label": "FULL", "requested_preset": "alta",
                               "effective_preset": "alta"},
        })

        self.assertEqual(reconstruction_id, scenes.get_scene(scene["id"])["active_version"])

    def test_model_metrics_keep_requested_effective_odm_and_latest_splat(self):
        metrics = scenes.model_metrics({
            "pipeline_mode": "ortho_25d_fallback",
            "dense_quality_requested": "high", "dense_quality": "medium",
            "qa": {"cameras_reconstructed": 238, "cameras_total": 238,
                   "sparse_points": 120688, "gsd_cm_px": 4.3},
            "reconstruction": {
                "requested_preset": "alta", "effective_preset": "alta",
                "splat_runs": [{"requested_preset": "ultra", "effective_preset": "medium",
                                "input_scale": 2, "target_iters": 2000, "final_loss": 0.037,
                                "peak_mib": 8991, "backend": "Metal/MPS", "fallback": True}],
            },
        })

        self.assertEqual("alta", metrics["requested_preset"])
        self.assertEqual("medium", metrics["dense_quality"])
        self.assertEqual("ultra", metrics["splat"]["requested_preset"])
        self.assertEqual("medium", metrics["splat"]["effective_preset"])
        self.assertTrue(metrics["splat"]["fallback"])


if __name__ == "__main__":
    unittest.main()
