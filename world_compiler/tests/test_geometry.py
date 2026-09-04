import unittest

import numpy as np

from world_compiler.evidence.truth_field import TruthClass
from world_compiler.geometry.structuralize import (
    GeometryLayer,
    HallucinationFirewallError,
    structuralize_heightfield,
    validate_layer_separation,
)


class StructuralGeometryTests(unittest.TestCase):
    def test_heightfield_produces_separate_ground_structure_and_collision(self):
        height = np.zeros((6, 6), dtype=np.float32)
        height[2:4, 2:4] = 8.0
        bundle = structuralize_heightfield(height, spacing_m=(1.0, 1.0))

        self.assertGreater(len(bundle.ground.faces), 0)
        self.assertGreater(len(bundle.clean_observed.faces), 0)
        self.assertEqual(TruthClass.OBSERVED_WEAK, bundle.clean_observed.provenance)
        self.assertEqual(0, len(bundle.inferred.faces))
        self.assertEqual(0, len(bundle.generated.faces))
        self.assertGreater(len(bundle.collision.faces), len(bundle.ground.faces))
        self.assertIsNone(bundle.collision.material)

    def test_structuralization_rejects_excluded_canopy_and_roof_outlier(self):
        height = np.zeros((20, 20), dtype=np.float32)
        height[2:8, 2:8] = 8.0
        height[4, 4] = 20.0
        height[12:18, 12:18] = 9.0
        excluded = np.zeros_like(height, dtype=bool)
        excluded[12:18, 12:18] = True

        bundle = structuralize_heightfield(
            height, spacing_m=(1.0, 1.0), exclusion_mask=excluded
        )

        self.assertEqual(8, len(bundle.clean_observed.vertices))
        self.assertAlmostEqual(8.0, bundle.clean_observed.vertices[:, 1].max())
        self.assertLess(bundle.clean_observed.vertices[:, 0].max(), 0.0)

    def test_hallucination_firewall_rejects_generated_overlap(self):
        observed = GeometryLayer.box(
            "clean_observed_structure",
            TruthClass.OBSERVED_MULTI_VIEW,
            minimum=(0.0, 0.0, 0.0),
            maximum=(5.0, 10.0, 5.0),
            confidence=0.9,
        )
        generated = GeometryLayer.box(
            "generated_completion",
            TruthClass.GENERATED_CONSTRAINED,
            minimum=(4.0, 0.0, 4.0),
            maximum=(8.0, 8.0, 8.0),
            confidence=0.8,
        )

        with self.assertRaises(HallucinationFirewallError):
            validate_layer_separation(observed, generated)

    def test_hallucination_firewall_accepts_disjoint_generated_layer(self):
        observed = GeometryLayer.box(
            "clean_observed_structure",
            TruthClass.OBSERVED_MULTI_VIEW,
            minimum=(0.0, 0.0, 0.0),
            maximum=(5.0, 10.0, 5.0),
            confidence=0.9,
        )
        generated = GeometryLayer.box(
            "generated_completion",
            TruthClass.GENERATED_CONSTRAINED,
            minimum=(6.0, 0.0, 6.0),
            maximum=(8.0, 8.0, 8.0),
            confidence=0.8,
        )

        validate_layer_separation(observed, generated)


if __name__ == "__main__":
    unittest.main()
