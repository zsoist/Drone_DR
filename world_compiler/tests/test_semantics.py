import unittest

import numpy as np

from world_compiler.semantics.masks import SemanticClass, compose_static_mask


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


if __name__ == "__main__":
    unittest.main()
