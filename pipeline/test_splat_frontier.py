import sys
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


if __name__ == "__main__":
    unittest.main()
