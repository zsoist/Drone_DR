import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from splat_presets import (  # noqa: E402
    SPLAT_PRESETS,
    normalize_splat_request,
    public_splat_profiles,
    resolve_splat_spec,
    validate_splat_backend,
)
import aerobrain_server as server  # noqa: E402
import jobs  # noqa: E402
import preflight  # noqa: E402
import scenes  # noqa: E402
import worker  # noqa: E402


class SplatFrontierContractTests(unittest.TestCase):
    def test_premium_iteration_contract_is_exact(self):
        expected = {
            "ultra": (15_000, "Ultra 15K"),
            "ultra20": (20_000, "Ultra+ 20K"),
            "frontier": (30_000, "Frontier 30K"),
        }

        for key, (iters, label) in expected.items():
            with self.subTest(key=key):
                spec = resolve_splat_spec({"preset": key})
                self.assertEqual(iters, spec["iters"])
                self.assertEqual(label, spec["label"])

    def test_backend_compatibility_is_explicit(self):
        self.assertEqual(("metal", "cpu", "cuda"),
                         SPLAT_PRESETS["ultra"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["ultra20"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["frontier"]["supported_backends"])

        self.assertEqual("cuda", validate_splat_backend("frontier", "cuda"))
        with self.assertRaisesRegex(ValueError, "requiere NVIDIA CUDA"):
            validate_splat_backend("ultra20", "metal")
        with self.assertRaisesRegex(ValueError, "backend de splat inválido"):
            validate_splat_backend("ultra", "tpu")

    def test_cuda_request_is_strict_and_full_first_by_default(self):
        request = normalize_splat_request({"preset": "frontier", "backend": "cuda"})

        self.assertEqual("frontier", request["preset"])
        self.assertEqual(30_000, request["iters"])
        self.assertEqual("cuda", request["backend"])
        self.assertEqual("strict", request["backend_policy"])
        self.assertEqual("auto", request["resolution"])
        self.assertEqual(1, request["requested_downscale"])
        self.assertFalse(request["best_available"])

    def test_resolution_contract_is_normalized(self):
        full = normalize_splat_request({
            "preset": "ultra20", "backend": "cuda", "resolution": "full",
        })
        half = normalize_splat_request({
            "preset": "ultra20", "backend": "cuda", "resolution": "half",
        })

        self.assertEqual(1, full["requested_downscale"])
        self.assertEqual(2, half["requested_downscale"])
        with self.assertRaisesRegex(ValueError, "resolución de splat inválida"):
            normalize_splat_request({
                "preset": "frontier", "backend": "cuda", "resolution": "quarter",
            })

    def test_public_profiles_are_json_safe_and_complete(self):
        profiles = public_splat_profiles()
        by_key = {profile["key"]: profile for profile in profiles}

        self.assertEqual(["metal", "cpu", "cuda"], by_key["ultra"]["supported_backends"])
        self.assertEqual(["cuda"], by_key["ultra20"]["supported_backends"])
        self.assertTrue(by_key["frontier"]["cuda"]["strict"])
        self.assertEqual("auto", by_key["frontier"]["cuda"]["resolution"])
        self.assertNotIn("train_args", by_key["frontier"])
        self.assertNotIn("timeout", by_key["frontier"])

    def test_aliases_and_exact_iteration_inference_remain_deterministic(self):
        self.assertEqual("ultra20", resolve_splat_spec({"iters": 20_000})["key"])
        self.assertEqual("frontier", resolve_splat_spec({"iters": 30_000})["key"])
        self.assertEqual("ultra20", resolve_splat_spec({"preset": "ultra+"})["key"])
        self.assertEqual("frontier", resolve_splat_spec({"preset": "30k"})["key"])


class SplatFrontierApiContractTests(unittest.TestCase):
    def test_direct_job_spec_preserves_immutable_cuda_request(self):
        spec = server.build_splat_job_spec("recon_fixture", {
            "preset": "frontier",
            "backend": "cuda",
            "resolution": "full",
            "auto_model": True,
            "model_preset": "alta",
            "title": "Frontier fixture",
        })

        self.assertEqual("recon_fixture", spec["clip_id"])
        self.assertEqual("frontier", spec["preset"])
        self.assertEqual(30_000, spec["iters"])
        self.assertEqual("cuda", spec["backend"])
        self.assertEqual("strict", spec["backend_policy"])
        self.assertEqual("full", spec["resolution"])
        self.assertEqual(1, spec["requested_downscale"])
        self.assertFalse(spec["best_available"])
        self.assertTrue(spec["auto_model"])
        self.assertEqual("alta", spec["model_preset"])

    def test_cuda_does_not_require_a_local_opensplat_binary(self):
        self.assertFalse(server.requires_local_splat_binary("cuda"))
        self.assertTrue(server.requires_local_splat_binary("metal"))
        self.assertTrue(server.requires_local_splat_binary("cpu"))

    def test_scene_followup_keeps_same_nested_cuda_contract(self):
        with tempfile.TemporaryDirectory() as td:
            previous = scenes.SCENES_DIR
            scenes.SCENES_DIR = Path(td) / "scenes"
            try:
                scene = scenes.create_scene("Fixture", {}, ["A"], [])
                _, job_spec = server.prepare_scene_version(
                    scene["id"], ["A"], [], "alta", "Fixture",
                    then_splat=True, splat_preset="frontier",
                    splat_backend="cuda", splat_resolution="auto",
                    best_available=False,
                )
            finally:
                scenes.SCENES_DIR = previous

        self.assertEqual("frontier", job_spec["splat"]["preset"])
        self.assertEqual(30_000, job_spec["splat"]["iters"])
        self.assertEqual("cuda", job_spec["splat"]["backend"])
        self.assertEqual("strict", job_spec["splat"]["backend_policy"])
        self.assertEqual("auto", job_spec["splat"]["resolution"])
        self.assertEqual(1, job_spec["splat"]["requested_downscale"])

    def test_direct_odm_scene_and_worker_share_the_same_cuda_payload(self):
        direct = server.build_splat_job_spec("recon_fixture", {
            "preset": "ultra20", "backend": "cuda", "resolution": "auto",
        })
        phased = server.build_followup_splat_spec("recon_fixture", {
            "splat_preset": "ultra20", "splat_backend": "cuda",
            "splat_resolution": "auto",
        })
        claimed = worker.phased_splat_job_spec({"splat": phased}, "recon_fixture")
        immutable = ("preset", "iters", "backend", "backend_policy", "resolution",
                     "requested_downscale", "best_available")

        self.assertEqual({key: direct[key] for key in immutable},
                         {key: phased[key] for key in immutable})
        self.assertEqual({key: direct[key] for key in immutable},
                         {key: claimed[key] for key in immutable})

    def test_cuda_preflight_is_not_the_mac_memory_model(self):
        result = preflight.splat_preflight_for_backend(
            238, 3072, "frontier", "cuda",
            node={"status": "awake", "gpu": "RTX 4060 Ti",
                  "driver": "610.74", "vram_total_mb": 8188,
                  "environment_verified": True},
            project_bytes=339 * 1024 * 1024,
            wsl_free_bytes=900 * 1024**3,
            bridge_free_bytes=29 * 1024**3,
        )

        self.assertEqual("UNVERIFIED_FULL_RES", result["verdict"])
        self.assertEqual("cuda", result["backend"])
        self.assertEqual("RTX 4060 Ti", result["gpu"])
        self.assertTrue(result["environment_verified"])
        self.assertNotIn("cap_mib", result)
        self.assertNotIn("projected_peak_mib", result)

    def test_queue_ids_are_collision_safe(self):
        ids = {jobs.new_job_id("splat") for _ in range(200)}

        self.assertEqual(200, len(ids))
        self.assertTrue(all(value.startswith("splat-") for value in ids))


if __name__ == "__main__":
    unittest.main()
