import sys
import tempfile
import unittest
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scenes
import jobs
import aerobrain_server as server
import worker
import scene_manifest


class SceneStoreTests(unittest.TestCase):
    def test_capture_altitude_bands_are_stable_and_distinct_from_coverage(self):
        expected = {40: 100, 121: 100, 151: 200, 299: 200, 301: 400,
                    520: 600, 850: 1000, 1400: 1000}
        for altitude, band in expected.items():
            with self.subTest(altitude=altitude):
                self.assertEqual(band, scenes.altitude_band(altitude))

    def test_source_evidence_and_version_band_membership_remain_traceable(self):
        evidence = [
            {"clip_id": "A", "altitude_m": 121, "capture_at": "2026-07-12T13:57:36",
             "coverage_bbox": [-74.1, 4.7, -74.0, 4.8], "status": "eligible"},
            {"clip_id": "B", "altitude_m": 410, "status": "eligible"},
        ]
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A", "B"], [],
                                    source_evidence=evidence)
        version = scenes.add_version(scene["id"], "recon_alt", ["A", "B"], [],
                                     source_evidence=evidence)

        stored = scenes.get_scene(scene["id"])
        self.assertEqual([100, 400], version["altitude_bands_m"])
        self.assertEqual(["A", "B"], [row["clip_id"] for row in stored["source_evidence"]])
        self.assertEqual(100, stored["source_evidence"][0]["altitude_band_m"])

    def test_registration_updates_per_video_contribution_without_erasing_failures(self):
        evidence = [{"clip_id": "A", "altitude_m": 100, "status": "eligible"},
                    {"clip_id": "B", "altitude_m": 400, "status": "eligible"}]
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A", "B"], [],
                                    source_evidence=evidence)
        scenes.add_version(scene["id"], "recon_reg", ["A", "B"], [],
                           source_evidence=evidence)

        scenes.record_contributions(scene["id"], "recon_reg", [
            {"clip_id": "A", "submitted": 20, "registered": 18, "merged": True},
            {"clip_id": "B", "submitted": 20, "registered": 0, "merged": False,
             "reason": "no shared component"},
        ])

        stored = scenes.get_scene(scene["id"])
        version = stored["versions"][0]
        by_id = {row["clip_id"]: row for row in stored["source_evidence"]}
        self.assertEqual(["A"], version["effective_sources"])
        self.assertEqual(["B"], version["dropped_sources"])
        self.assertEqual("integrated", by_id["A"]["status"])
        self.assertEqual("registration_failed", by_id["B"]["status"])
        self.assertEqual("no shared component", by_id["B"]["reason"])

    def test_server_builds_evidence_from_measured_track_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            (vault / "manifest").mkdir()
            (vault / "tracks").mkdir()
            payload = {"clip_id": "A", "stats": {"max_rel_alt_m": 121.2,
                       "start": "2026-07-12 13:57:36",
                       "bbox": [-74.1, 4.7, -74.0, 4.8], "distance_m": 1600}}
            (vault / "manifest" / "A.json").write_text(json.dumps(payload))
            (vault / "tracks" / "A.flight.json").write_text(json.dumps(payload))

            row = server.source_evidence("A", vault)

        self.assertEqual(121.2, row["altitude_m"])
        self.assertEqual(100, row["altitude_band_m"])
        self.assertEqual("2026-07-12 13:57:36", row["capture_at"])
        self.assertEqual("eligible", row["status"])

    def test_site_lod_contract_exposes_all_five_coverage_diameters_and_real_assets_only(self):
        scene = {"id": "scene_fixture", "active_version": "recon_v1",
                 "source_evidence": [{"clip_id": "A", "altitude_band_m": 100,
                                      "status": "integrated"}]}
        manifest = {"clip_id": "recon_v1", "assets": {
            "splat": "data/splats/recon_v1.sog", "mesh_viewer": "data/model.obj",
            "dsm_lod_bin": "data/dsm.bin", "ortho": "data/ortho.webp"}}

        products = scene_manifest.coverage_products(scene, manifest)

        self.assertEqual([100, 200, 400, 600, 1000], [p["diameter_m"] for p in products])
        self.assertEqual("circle", products[0]["shape"])
        self.assertAlmostEqual(7854, products[0]["area_m2"], delta=1)
        self.assertEqual("splat", products[0]["preferred_renderer"])
        self.assertEqual("terrain", products[-1]["preferred_renderer"])
        self.assertEqual("data/splats/recon_v1.sog", products[-1]["products"]["splat"])
        self.assertEqual(1, products[0]["integrated_sources"])
        self.assertEqual(1, products[-1]["integrated_sources"])
        self.assertEqual(0, products[-1]["capture_band_sources"])

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
            then_splat=True, splat_preset="ultra", splat_backend="cuda")

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

    def test_scene_completion_persists_actual_odm_source_contributions(self):
        evidence = [{"clip_id": "A", "altitude_m": 100},
                    {"clip_id": "B", "altitude_m": 400}]
        scene = scenes.create_scene("Casa", {"lat": 4.75, "lon": -74.06},
                                    ["A", "B"], [], source_evidence=evidence)
        scenes.add_version(scene["id"], "recon_sources", ["A", "B"], [],
                           source_evidence=evidence)
        job = {"id": "3d-sources", "spec": {"scene_id": scene["id"],
               "version_id": "recon_sources", "preset": "alta"}}

        worker.record_scene_completion(job, {
            "pipeline_mode": "full_3d", "preset": "alta",
            "qa": {"cameras_reconstructed": 18, "cameras_total": 40},
            "reconstruction": {"merge_label": "PARTIAL", "sources": [
                {"clip_id": "A", "submitted": 20, "registered": 18, "merged": True},
                {"clip_id": "B", "submitted": 20, "registered": 0, "merged": False},
            ]},
        })

        stored = scenes.get_scene(scene["id"])
        version = stored["versions"][0]
        self.assertEqual(["A"], version["effective_sources"])
        self.assertEqual(["B"], version["dropped_sources"])
        self.assertEqual("registration_failed",
                         next(row for row in stored["source_evidence"]
                              if row["clip_id"] == "B")["status"])

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
