import unittest

import numpy as np

from world_compiler.evidence.truth_field import TruthClass
from world_compiler.geometry.structuralize import (
    GeometryLayer,
    HallucinationFirewallError,
    split_by_source_support,
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

        self.assertGreater(len(bundle.clean_observed.vertices), 8)
        self.assertAlmostEqual(8.0, bundle.clean_observed.vertices[:, 1].max())
        self.assertLess(bundle.clean_observed.vertices[:, 0].max(), 0.0)

    def test_irregular_footprint_does_not_fill_its_bounding_box(self):
        height = np.zeros((8, 8), dtype=np.float32)
        height[2:6, 2] = 7.0
        height[5, 2:6] = 7.0

        bundle = structuralize_heightfield(height, spacing_m=(1.0, 1.0))
        roof_faces = bundle.clean_observed.faces[
            np.all(
                np.isclose(
                    bundle.clean_observed.vertices[bundle.clean_observed.faces, 1], 7.0
                ),
                axis=1,
            )
        ]

        self.assertEqual(14, len(roof_faces))

    def test_unsupported_faces_move_to_inferred_layer(self):
        layer = GeometryLayer(
            "clean_observed_structure",
            TruthClass.OBSERVED_WEAK,
            np.asarray([[0, 0, 0], [1, 0, 0], [0, 0, 1], [2, 0, 0]], dtype=float),
            np.asarray([[0, 1, 2], [1, 3, 2]], dtype=np.uint32),
            0.6,
        )

        observed, inferred, report = split_by_source_support(
            layer,
            np.asarray([0.1, 0.2, 0.3, 2.0]),
            tolerance_m=0.5,
        )

        self.assertEqual(1, len(observed.faces))
        self.assertEqual(1, len(inferred.faces))
        self.assertEqual(TruthClass.GEOMETRICALLY_INFERRED, inferred.provenance)
        self.assertEqual(50.0, report["observed_pct"])

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
