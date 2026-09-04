import unittest

import numpy as np

from world_compiler.aerobrain.coordinates import CoordinateContract


class CoordinateContractTests(unittest.TestCase):
    def test_maps_aerobrain_axes_to_unreal_centimeters(self):
        contract = CoordinateContract((0.0, 0.0))

        actual = contract.ab_to_ue(np.array([[1.0, 2.0, 3.0]]))

        np.testing.assert_allclose([[100.0, 300.0, 200.0]], actual)
        self.assertEqual("left-handed", contract.metadata["handedness"])
        self.assertLess(contract.metadata["determinant"], 0)

    def test_round_trips_aoi_corners_cameras_and_axes(self):
        contract = CoordinateContract((125.0, -80.0))
        points = np.array(
            [
                [75.0, 0.0, -130.0],
                [175.0, 0.0, -130.0],
                [75.0, 0.0, -30.0],
                [175.0, 0.0, -30.0],
                [100.0, 15.0, -100.0],
                [140.0, 25.0, -65.0],
                [126.0, 0.0, -80.0],
                [125.0, 1.0, -80.0],
                [125.0, 0.0, -79.0],
            ]
        )

        round_trip = contract.ue_to_ab(contract.ab_to_ue(points))

        np.testing.assert_allclose(points, round_trip, atol=1e-9)
        np.testing.assert_allclose(
            np.eye(4), np.asarray(contract.inverse) @ np.asarray(contract.matrix), atol=1e-12
        )

    def test_flips_triangle_winding_exactly_once(self):
        contract = CoordinateContract((0.0, 0.0))

        flipped = contract.flip_winding(np.array([0, 1, 2, 3, 4, 5]))

        np.testing.assert_array_equal([0, 2, 1, 3, 5, 4], flipped)

    def test_rejects_non_finite_or_malformed_points(self):
        contract = CoordinateContract((0.0, 0.0))
        with self.assertRaises(ValueError):
            contract.ab_to_ue(np.array([[1.0, np.nan, 3.0]]))
        with self.assertRaises(ValueError):
            contract.ab_to_ue(np.array([1.0, 2.0]))


if __name__ == "__main__":
    unittest.main()
