import sys
import tempfile
import unittest
import json
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
import audit_splats  # noqa: E402
import build_index  # noqa: E402
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
            "grandmaster": (40_000, "Grandmaster 40K"),
        }

        for key, (iters, label) in expected.items():
            with self.subTest(key=key):
                spec = resolve_splat_spec({"preset": key})
                self.assertEqual(iters, spec["iters"])
                self.assertEqual(label, spec["label"])

    def test_backend_compatibility_is_explicit(self):
        self.assertEqual(("metal", "cpu", "cuda"),
                         SPLAT_PRESETS["fast"]["supported_backends"])
        self.assertEqual(("metal", "cpu", "cuda"),
                         SPLAT_PRESETS["medium"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["cinematic"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["ultra"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["ultra20"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["frontier"]["supported_backends"])
        self.assertEqual(("cuda",), SPLAT_PRESETS["grandmaster"]["supported_backends"])

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

        self.assertEqual(["metal", "cpu", "cuda"], by_key["medium"]["supported_backends"])
        self.assertEqual(["cuda"], by_key["cinematic"]["supported_backends"])
        self.assertEqual(["cuda"], by_key["ultra"]["supported_backends"])
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
        self.assertEqual("grandmaster", resolve_splat_spec({"iters": 40_000})["key"])
        self.assertEqual("grandmaster", resolve_splat_spec({"preset": "40k"})["key"])


class SplatFrontierApiContractTests(unittest.TestCase):
    def test_profile_etas_use_measured_cuda_history_and_label_projections(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            model = vault / "models" / "fixture"
            model.mkdir(parents=True)
            (model / "meta.json").write_text(json.dumps({
                "reconstruction": {"splat_runs": [
                    {"requested_preset": "ultra", "effective_preset": "ultra",
                     "target_iters": 15000, "duration_s": 900, "cameras": 240,
                     "attempts": [{"rc": 0, "preset": "ultra", "duration_s": 750}],
                     "effective_resolution": "half", "effective_backend": "NVIDIA CUDA",
                     "remote_gpu": "RTX 4060 Ti", "fallback": False},
                    {"requested_preset": "ultra", "effective_preset": "medium",
                     "target_iters": 2000, "duration_s": 100, "backend": "Metal/MPS",
                     "fallback": True},
                ]},
            }))

            profiles = server.splat_profiles_with_history(vault)

        by_key = {item["key"]: item for item in profiles}
        measured = by_key["ultra"]["eta"]
        projected = by_key["frontier"]["eta"]
        self.assertEqual("measured", measured["source"])
        self.assertEqual(900, measured["seconds"])
        self.assertEqual(240, measured["cameras"])
        self.assertEqual("half", measured["resolution"])
        self.assertEqual("RTX 4060 Ti", measured["gpu"])
        self.assertEqual(750, measured["training_seconds"])
        self.assertEqual(20.0, measured["iterations_per_second"])
        self.assertEqual(50.0, measured["iteration_time_ms"])
        self.assertEqual("projected_from_measured", projected["source"])
        self.assertEqual(1650, projected["seconds"])
        self.assertEqual(1500, projected["training_seconds"])
        self.assertEqual(150, projected["fixed_overhead_s"])
        self.assertEqual(20.0, projected["iterations_per_second"])
        self.assertEqual("ultra", projected["baseline_profile"])

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

    def test_published_run_record_keeps_complete_cuda_provenance(self):
        quality = {
            "preset": "frontier", "requested_preset": "frontier",
            "effective_preset": "frontier", "requested_iterations": 30000,
            "target_iters": 30000, "requested_backend": "cuda",
            "effective_backend": "NVIDIA CUDA", "backend": "NVIDIA CUDA",
            "backend_policy": "strict", "resolution": "auto",
            "requested_downscale": 1, "effective_downscale": 2,
            "effective_resolution": "half", "attempts": [{"d": 1}, {"d": 2}],
            "remote_peak_vram_mib": 7900, "peak_mib": 7900,
            "remote_gpu": "RTX 4060 Ti", "remote_driver": "610.74",
            "trainer": "nerfstudio-splatfacto", "trainer_args": ["--sh-degree", "0"],
            "params_hash": "abc123", "stage_timings": {"train": 900.0},
            "bytes": 32000000, "cameras": 238, "duration_s": 1000.0,
        }

        record = worker.splat_run_record("splat-frontier-fixture", quality)

        for key in ("requested_preset", "effective_preset", "requested_iterations",
                    "target_iters", "requested_backend", "effective_backend",
                    "backend_policy", "resolution", "requested_downscale",
                    "effective_downscale", "effective_resolution", "attempts",
                    "remote_peak_vram_mib", "remote_gpu", "remote_driver", "trainer",
                    "trainer_args", "params_hash", "stage_timings"):
            with self.subTest(key=key):
                self.assertEqual(quality[key], record[key])

    def test_index_and_audit_recognize_ultra_plus_and_frontier(self):
        self.assertEqual(("ultra20", "Ultra+ 20K"),
                         build_index.SPLAT_PRESET_BY_ITERS[20000])
        self.assertEqual(("frontier", "Frontier 30K"),
                         build_index.SPLAT_PRESET_BY_ITERS[30000])
        self.assertTrue({"ultra", "ultra20", "frontier", "grandmaster"}
                        <= audit_splats.REQUIRED_PRESETS)
        self.assertEqual("ultra20", audit_splats.PRESET_BY_ITERS[20000])
        self.assertEqual("frontier", audit_splats.PRESET_BY_ITERS[30000])
        self.assertEqual("grandmaster", audit_splats.PRESET_BY_ITERS[40000])


if __name__ == "__main__":
    unittest.main()
