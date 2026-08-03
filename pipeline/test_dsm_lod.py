import unittest

import numpy as np

from pipeline import dsm_lod


class DsmLodSurfaceTests(unittest.TestCase):
    def test_nodata_is_extended_from_nearest_terrain_not_a_global_floor(self):
        source = np.full((9, 9), -9999.0, dtype=np.float32)
        source[3:6, 3:6] = 120.0
        source[4, 4] = 121.0
        invalid = source < -1000

        filled = dsm_lod.fill_nodata(source, invalid)

        self.assertTrue(np.isfinite(filled).all())
        self.assertGreater(float(filled.min()), 119.0)
        self.assertLess(float(filled.max()), 122.0)

    def test_ground_filter_removes_reconstruction_spikes_without_wrapping_edges(self):
        surface = np.full((25, 25), 100.0, dtype=np.float32)
        surface[:, 12:] += 3.0
        surface[12, 12] = 900.0
        surface[0, 0] = 80.0

        filtered = dsm_lod.smooth_ground(surface)

        self.assertLess(float(filtered.max()), 110.0)
        self.assertLess(float(filtered[-1, -1]), 105.0)
        self.assertLess(float(np.max(np.abs(np.diff(filtered, axis=0)))), 8.0)
        self.assertLess(float(np.max(np.abs(np.diff(filtered, axis=1)))), 8.0)

    def test_sparse_reconstruction_uses_a_conservative_playable_elevation_band(self):
        surface = np.linspace(100, 300, 2500, dtype=np.float32).reshape(50, 50)

        filtered = dsm_lod.smooth_ground(surface, conservative=True)

        self.assertLess(float(filtered.max()), 285.0)
        self.assertGreater(float(filtered.min()), 100.0)


if __name__ == "__main__":
    unittest.main()
