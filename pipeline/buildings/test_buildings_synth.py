"""Fast unit tests for pipeline/buildings on synthetic DSMs (no vault data needed)."""
import unittest

import numpy as np
from shapely.geometry import Polygon

from buildings import footprints as F
from buildings import frame as FR
from buildings import shell as SH


def synth(res=0.25, n=400, slope=0.08):
    """Sloped terrain (8 %), a 20x12 m flat-roof block 9 m high rotated 25 deg, a gabled 10x8 m
    house, and a lumpy 'tree' blob. Returns Grid, truth polygon of the block."""
    x0, y0 = -n * res / 2, n * res / 2
    xs = x0 + (np.arange(n) + .5) * res
    ys = y0 - (np.arange(n) + .5) * res
    X, Y = np.meshgrid(xs, ys)
    z = 100 + slope * X
    th = np.radians(25)
    u = (X - 5) * np.cos(th) + (Y - 0) * np.sin(th)
    v = -(X - 5) * np.sin(th) + (Y - 0) * np.cos(th)
    block = (abs(u) <= 10) & (abs(v) <= 6)
    z = np.where(block, z + 9.0, z)
    house = (abs(X + 25) <= 5) & (abs(Y - 15) <= 4)
    z = np.where(house, 100 + slope * X + 4 + 2.5 * (1 - abs(Y - 15) / 4), z)      # gable, 2.5 m ridge
    rng = np.random.default_rng(1)
    tree = ((X - 30) ** 2 + (Y + 20) ** 2) < 16
    z = np.where(tree, z + 7 + rng.normal(0, .6, z.shape), z)
    c = np.array([(10, 6), (-10, 6), (-10, -6), (10, -6)])
    R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    truth = Polygon((c @ R.T) + [5, 0])
    return FR.Grid(z.astype(np.float32), res, x0, y0), truth, tree


class FootprintTests(unittest.TestCase):
    def test_steps_finds_block_and_house_not_tree_or_slope(self):
        g, truth, tree = synth()
        veg = np.zeros(g.z.shape, bool)
        veg[tree] = True
        fps, dbg = F.extract_footprints(g, veg=veg, min_area_m2=30)
        big = max(fps, key=lambda f: f.area_m2)
        iou = big.polygon.intersection(truth).area / big.polygon.union(truth).area
        self.assertGreater(iou, 0.9)
        self.assertEqual(len(fps), 2)            # block + house; terrain slope and tree rejected
        self.assertAlmostEqual(big.theta_deg % 90, 25, delta=3)
        self.assertLess(len(big.polygon.exterior.coords), 8)     # orthogonalised, not a staircase

    def test_ndsm_method_on_flat_ground(self):
        g, truth, tree = synth(slope=0.0)
        fps, _ = F.extract_footprints(g, method="ndsm", min_area_m2=30)
        self.assertTrue(any(f.polygon.intersection(truth).area / truth.area > 0.9 for f in fps))

    def test_ground_filter_follows_slope(self):
        g, _, _ = synth()
        dtm = F.estimate_ground(g.z, g.res, max_window_m=40)
        xs, _ = g.xy()
        far = (abs(xs) > 40)
        err = np.abs(dtm - (100 + 0.08 * xs))[far]
        self.assertLess(float(np.median(err)), 0.6)

    def test_select_main_filters(self):
        g, _, _ = synth()
        fps, _ = F.extract_footprints(g, min_area_m2=30)
        main = F.select_main(fps, min_area_m2=100, min_height_m=5)
        self.assertEqual(len(main), 1)

    def test_regularize_snaps_noisy_rectangle(self):
        rng = np.random.default_rng(0)
        pts = []
        for a, b in (((0, 0), (20, 0)), ((20, 0), (20, 10)), ((20, 10), (0, 10)), ((0, 10), (0, 0))):
            for t in np.linspace(0, 1, 40, endpoint=False):
                pts.append((a[0] + (b[0] - a[0]) * t + rng.normal(0, .08), a[1] + (b[1] - a[1]) * t + rng.normal(0, .08)))
        r = F.regularize(Polygon(pts))
        self.assertEqual(len(r.exterior.coords) - 1, 4)
        self.assertAlmostEqual(r.area, 200, delta=6)


class ShellTests(unittest.TestCase):
    def test_prism_is_closed_and_has_right_volume(self):
        import trimesh
        p = Polygon([(0, 0), (10, 0), (10, 5), (4, 5), (4, 9), (0, 9)])
        sh = SH.extrude_prism(p, 0.0, 6.0)
        m = trimesh.Trimesh(sh.verts, sh.tris, process=False)
        self.assertTrue(m.is_watertight)
        self.assertAlmostEqual(m.volume, p.area * 6, places=3)

    def test_lod1x_recovers_gable_and_block_heights(self):
        g, truth, _ = synth(slope=0.0)
        block = SH.lod1x_shell(truth.buffer(0.2), g.z, g, 100.0)
        res = SH.roof_residuals(block, truth.buffer(0.2), g)
        self.assertLess(res["mae_m"], 0.15)
        house = Polygon([(-30, 11), (-20, 11), (-20, 19), (-30, 19)])
        sh = SH.lod1x_shell(house, g.z, g, 100.0)
        res = SH.roof_residuals(sh, house, g)
        self.assertLess(res["mae_m"], 0.3)
        self.assertTrue(sh.meta["planes"])

    def test_ransac_plane(self):
        rng = np.random.default_rng(3)
        xy = rng.uniform(0, 10, (400, 2))
        z = 0.3 * xy[:, 0] - 0.1 * xy[:, 1] + 5 + rng.normal(0, .02, 400)
        pts = np.c_[xy, z]
        pts[:80, 2] += rng.uniform(1, 4, 80)          # outliers
        c, inl = SH.ransac_plane(pts)
        self.assertAlmostEqual(c[0], 0.3, delta=0.02)
        self.assertGreater(inl.sum(), 300)


class FrameTests(unittest.TestCase):
    def test_odm_game_roundtrip_and_axes(self):
        fr = FR.Frame((605458., 516502.), (-22.98, -47.44), 2586.79, (10, 10), (0, 1, 0, 0, 0, -1), -9999., ((1, 0), (0, 1), (0, 0)))
        p = np.array([[-22.98 + 3, -47.44 + 5, 2586.79 + 7.0]])       # 3 m east, 5 m north, 7 m up
        g = fr.odm_to_game(p)
        np.testing.assert_allclose(g, [[3, 7, -5]], atol=1e-9)         # x=E, y=up, z=-N
        np.testing.assert_allclose(fr.game_to_odm(g), p, atol=1e-9)


if __name__ == "__main__":
    unittest.main()
