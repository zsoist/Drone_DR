import unittest

import numpy as np

from world_compiler.evidence.spatial_truth import build_spatial_truth
from world_compiler.evidence.truth_field import TruthClass


class SpatialTruthTests(unittest.TestCase):
    def test_real_support_is_weak_without_occlusion_and_absent_support_unknown(self):
        result = build_spatial_truth(
            np.array([[4, 1, 0]], dtype=np.uint16),
            np.array([[0.8, 0.1, 0.0]], dtype=np.float32),
            occlusion_validated=False,
        )

        self.assertEqual(TruthClass.OBSERVED_WEAK.value, result.classes[0, 0])
        self.assertEqual(TruthClass.OBSERVED_WEAK.value, result.classes[0, 1])
        self.assertEqual(TruthClass.UNKNOWN.value, result.classes[0, 2])
        self.assertLess(float(result.confidence[0, 0]), 0.55)
        self.assertAlmostEqual(100.0, sum(result.coverage_pct.values()))

    def test_multiview_requires_explicit_occlusion_validation(self):
        unsupported = build_spatial_truth(
            np.array([[5]], dtype=np.uint16), np.array([[0.9]], dtype=np.float32),
            occlusion_validated=False,
        )
        validated = build_spatial_truth(
            np.array([[5]], dtype=np.uint16), np.array([[0.9]], dtype=np.float32),
            occlusion_validated=True,
        )

        self.assertEqual(TruthClass.OBSERVED_WEAK.value, unsupported.classes[0, 0])
        self.assertEqual(TruthClass.OBSERVED_MULTI_VIEW.value, validated.classes[0, 0])


if __name__ == "__main__":
    unittest.main()
