import unittest

import numpy as np

from world_compiler.semantics.masks import (
    SemanticClass,
    compose_static_mask,
    conservative_semantic_masks,
)


class SemanticMaskTests(unittest.TestCase):
    def test_transient_classes_are_removed_without_erasing_adjacent_wall(self):
        wall = np.array([[1, 1, 1], [1, 1, 1]], dtype=bool)
        vehicle = np.array([[0, 1, 0], [0, 0, 0]], dtype=bool)
        person = np.array([[0, 0, 0], [0, 0, 1]], dtype=bool)

        result = compose_static_mask(
            {
                SemanticClass.WALL: wall,
                SemanticClass.VEHICLE: vehicle,
                SemanticClass.PERSON: person,
            }
        )

        np.testing.assert_array_equal([[1, 0, 1], [1, 1, 0]], result.static)
        np.testing.assert_array_equal([[0, 1, 0], [0, 0, 1]], result.replacement)

    def test_absent_detector_evidence_returns_explicit_empty_masks(self):
        result = compose_static_mask({}, shape=(2, 3))

        self.assertFalse(result.static.any())
        self.assertFalse(result.replacement.any())
        self.assertEqual("no_semantic_evidence", result.method)

    def test_conservative_masks_separate_roof_vegetation_ground_and_nodata(self):
        height = np.zeros((4, 4), dtype=float)
        height[0:2, 0:2] = 8.0
        valid = np.ones((4, 4), dtype=bool)
        valid[3, 3] = False
        vegetation = np.zeros((4, 4), dtype=bool)
        vegetation[0, 0] = True

        masks = conservative_semantic_masks(height, valid, vegetation)

        self.assertTrue(masks[SemanticClass.ROOF][1, 1])
        self.assertFalse(masks[SemanticClass.ROOF][0, 0])
        self.assertTrue(masks[SemanticClass.VEGETATION][0, 0])
        self.assertTrue(masks[SemanticClass.GROUND_SURFACE][2, 2])
        self.assertTrue(masks[SemanticClass.SKY_NO_DATA][3, 3])


if __name__ == "__main__":
    unittest.main()
