import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jobs as jobstore
import worker


class SceneFramePreflightTests(unittest.TestCase):
    @staticmethod
    def _cuda_job():
        return {"id": "3d-policy-fixture", "spec": {
            "clip_id": "fixture", "preset": "ultra", "backend": "cuda",
            "sources": ["fixture"],
        }}

    def test_exact_post_selection_counts_split_viable_and_sparse_sources(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            images = project / "images"
            images.mkdir()
            sources = ["A", "B", "C"]
            for prefix, count in (("s0_", 8), ("s1_", 4), ("s2_", 5)):
                for index in range(count):
                    (images / f"{prefix}f_{index:04d}.jpg").touch()
            (project / "frames_manifest.json").write_text(json.dumps({
                "sources": [
                    {"cid": "A", "prefix": "s0_"},
                    {"cid": "B", "prefix": "s1_"},
                    {"cid": "C", "prefix": "s2_"},
                ]
            }))

            result = worker.odm_frame_preflight(project, sources)

        self.assertEqual(["A", "C"], result["viable_sources"])
        self.assertEqual(["B"], result["sparse_sources"])
        self.assertEqual(4, result["by_source"]["B"]["submitted"])
        self.assertIn("4/5", result["by_source"]["B"]["reason"])

    def test_recovery_spec_retargets_scene_and_nested_splat_to_viable_identity(self):
        parent = {
            "clip_id": "recon_old",
            "version_id": "recon_old",
            "primary_cid": "A",
            "scene_id": "scene_fixture",
            "sources": ["A", "B", "C"],
            "photos": ["photo.jpg"],
            "preset": "ultra",
            "backend": "cuda",
            "then_splat": True,
            "splat": {
                "clip_id": "recon_old",
                "version_id": "recon_old",
                "scene_id": "scene_fixture",
                "preset": "frontier",
                "backend": "cuda",
                "resolution": "auto",
            },
        }

        recovery = worker.frame_viable_recovery_spec(parent, ["A", "C"])
        expected_id = jobstore.recon_id_for(["A", "C"], ["photo.jpg"])

        self.assertEqual(expected_id, recovery["clip_id"])
        self.assertEqual(expected_id, recovery["version_id"])
        self.assertEqual(["A", "C"], recovery["sources"])
        self.assertEqual("A", recovery["primary_cid"])
        self.assertEqual(expected_id, recovery["splat"]["clip_id"])
        self.assertEqual(expected_id, recovery["splat"]["version_id"])
        self.assertEqual("frontier", recovery["splat"]["preset"])

    def test_large_cuda_ultra_scene_preflights_to_memory_safe_dense_quality(self):
        preflight = {"total_frames": 423}

        selected, evidence = worker.odm_cuda_dense_preflight(
            "ultra", worker.PRESETS["ultra"], preflight)

        args = selected["args"]
        self.assertEqual("medium", args[args.index("--pc-quality") + 1])
        self.assertEqual("ultra", args[args.index("--feature-quality") + 1])
        self.assertEqual("2", args[args.index("--orthophoto-resolution") + 1])
        self.assertEqual("800000", args[args.index("--mesh-size") + 1])
        self.assertTrue(evidence["adjusted"])
        self.assertEqual("ultra", evidence["requested_dense_quality"])
        self.assertEqual("medium", evidence["effective_dense_quality"])

    def test_small_cuda_ultra_scene_keeps_full_dense_quality(self):
        selected, evidence = worker.odm_cuda_dense_preflight(
            "ultra", worker.PRESETS["ultra"], {"total_frames": 238})

        args = selected["args"]
        self.assertEqual("ultra", args[args.index("--pc-quality") + 1])
        self.assertFalse(evidence["adjusted"])

    def test_high_cuda_odm_is_strict_remote_while_light_tiers_can_fallback(self):
        self.assertTrue(worker.odm_cuda_is_strict({"backend": "cuda"}, "ultra"))
        self.assertTrue(worker.odm_cuda_is_strict(
            {"backend": "cuda", "backend_policy": "strict"}, "estandar"))
        self.assertFalse(worker.odm_cuda_is_strict({"backend": "cuda"}, "estandar"))
        self.assertFalse(worker.odm_cuda_is_strict({"backend": "local"}, "ultra"))

    def test_cancelled_cuda_odm_never_starts_local_or_25d_fallback(self):
        with (
                tempfile.TemporaryDirectory() as td,
                mock.patch.object(worker, "VAULT", Path(td)),
                mock.patch.object(worker.jobstore, "run_tracked", return_value=0),
                mock.patch.object(worker.jobstore, "update"),
                mock.patch.object(worker.jobstore, "event"),
                mock.patch.object(worker, "odm_frame_preflight",
                                  return_value={"total_frames": 238, "by_source": {},
                                                "viable_sources": ["fixture"],
                                                "sparse_sources": []}),
                mock.patch.object(worker, "clean_odm_outputs", return_value=[]),
                mock.patch.object(worker, "run_odm_cuda", return_value=137),
                mock.patch.object(worker, "_cancelled", return_value=True),
                mock.patch.object(worker, "run_odm_step") as local,
                mock.patch.object(worker, "run_fast_ortho_fallback") as ortho,
        ):
            with self.assertRaisesRegex(RuntimeError, "cancelado"):
                worker.build_3d_assets(self._cuda_job(), "fixture", "ultra")

        local.assert_not_called()
        ortho.assert_not_called()

    def test_strict_cuda_odm_failure_never_starts_local_fallback(self):
        with (
                tempfile.TemporaryDirectory() as td,
                mock.patch.object(worker, "VAULT", Path(td)),
                mock.patch.object(worker.jobstore, "run_tracked", return_value=0),
                mock.patch.object(worker.jobstore, "update"),
                mock.patch.object(worker.jobstore, "event"),
                mock.patch.object(worker, "odm_frame_preflight",
                                  return_value={"total_frames": 238, "by_source": {},
                                                "viable_sources": ["fixture"],
                                                "sparse_sources": []}),
                mock.patch.object(worker, "clean_odm_outputs", return_value=[]),
                mock.patch.object(worker, "run_odm_cuda", return_value=137),
                mock.patch.object(worker, "_cancelled", return_value=False),
                mock.patch.object(worker, "run_odm_step") as local,
                mock.patch.object(worker, "run_fast_ortho_fallback") as ortho,
        ):
            with self.assertRaisesRegex(RuntimeError, "CUDA estricto"):
                worker.build_3d_assets(self._cuda_job(), "fixture", "ultra")

        local.assert_not_called()
        ortho.assert_not_called()


if __name__ == "__main__":
    unittest.main()
