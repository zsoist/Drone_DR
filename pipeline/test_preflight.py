import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import preflight


class PreflightTruthTests(unittest.TestCase):
    def test_ultra_does_not_invent_peak_or_claim_machine_incapable(self):
        result = preflight.splat_preflight(232, 3072, "ultra")

        self.assertEqual("UNVERIFIED_HIGH_RISK", result["verdict"])
        self.assertEqual("ultra", result["preset"])
        self.assertEqual(232, result["n_images"])
        self.assertEqual(3072, result["width"])
        self.assertEqual("unverified", result["confidence"])
        self.assertNotIn("projected_peak_mib", result)
        self.assertNotIn("pct", result)
        self.assertEqual(2, result["recommended_d"])
        self.assertGreater(result["input_floor_mib"], result["cap_mib"])
        self.assertLess(result["d2_input_floor_mib"], result["cap_mib"])

    def test_historically_successful_ultra_shape_is_not_rejected(self):
        result = preflight.splat_preflight(214, 3072, "ultra")

        self.assertNotEqual("REJECTED", result["verdict"])
        self.assertEqual(2, result["recommended_d"])

    def test_large_medium_uses_calibrated_d2(self):
        result = preflight.splat_preflight(214, 3072, "medium")

        self.assertEqual("LIKELY_OOM", result["verdict"])
        self.assertEqual("medium", result["preset"])
        self.assertEqual("calibrated", result["confidence"])
        self.assertEqual(2, result["recommended_d"])
        self.assertEqual(8800, result["d2_projected_peak_mib"])

    def test_small_medium_keeps_measured_safe_classification(self):
        result = preflight.splat_preflight(22, 3072, "medium")

        self.assertEqual("SAFE", result["verdict"])
        self.assertEqual(1, result["recommended_d"])
        self.assertEqual("calibrated", result["confidence"])

    def test_unknown_preset_is_rejected_as_input_error(self):
        with self.assertRaises(ValueError):
            preflight.splat_preflight(22, 3072, "impossible")


if __name__ == "__main__":
    unittest.main()
