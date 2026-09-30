"""Fast unit tests for the W4b photo-projection geometry (synthetic data, no vault needed):
camera projection, plane homography, facet grouping, atlas layout, DSM visibility,
best-view selection and an end-to-end rectification of a synthetic photo."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from buildings import facets as FA
from buildings import frame as FR
from buildings import photoproj as PP
from buildings.photos import Camera, rodrigues


def look_at(center, target, w=640, h=480, focal=0.9, **kw):
    """Camera at `center` looking at `target`, world up = +y (OpenSfM: +z forward, +y down)."""
    center = np.asarray(center, float)
    fwd = np.asarray(target, float) - center
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R = np.stack([right, down, fwd])
    return Camera("c", R, -R @ center, w, h, focal, **kw)


def box_shell(w=20.0, d=10.0, h=12.0):
    """Closed box (game frame, y up) with outward-wound triangles; surf 1 walls, 0 roof, 2 floor."""
    x0, x1, z0, z1 = 0.0, w, 0.0, -d
    v = np.array([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],
                  [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], float)
    quads = {  # (vertex ids CCW seen from outside, surf)
        "south": ((0, 1, 5, 4), 1),        # z = 0, normal +z
        "east": ((1, 2, 6, 5), 1),         # x = w, normal +x
        "north": ((2, 3, 7, 6), 1),        # z = -d, normal -z
        "west": ((3, 0, 4, 7), 1),         # x = 0, normal -x
        "roof": ((4, 5, 6, 7), 0),
        "floor": ((3, 2, 1, 0), 2),
    }
    tris, surf = [], []
    for q, s in quads.values():
        tris += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
        surf += [s, s]
    return v, np.array(tris), np.array(surf)


class CameraTests(unittest.TestCase):
    def test_rodrigues_is_rotation(self):
        R = rodrigues([0.3, -1.1, 0.7])
        np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-12)
        self.assertAlmostEqual(np.linalg.det(R), 1.0)
        np.testing.assert_allclose(rodrigues([0, 0, np.pi / 2]) @ [1, 0, 0], [0, 1, 0], atol=1e-12)

    def test_look_at_projects_target_to_principal_point(self):
        c = look_at([30, 40, 50], [0, 5, 0], w=3072, h=1728)
        u, v, z = c.project([0, 5, 0])
        self.assertAlmostEqual(float(u), (3072 - 1) / 2, places=6)
        self.assertAlmostEqual(float(v), (1728 - 1) / 2, places=6)
        self.assertGreater(float(z), 0)
        np.testing.assert_allclose(c.center, [30, 40, 50], atol=1e-9)

    def test_point_left_of_axis_lands_left_and_up_lands_up(self):
        c = look_at([0, 0, 50], [0, 0, 0])            # looking down -z, right = +x... check sign
        u0, v0, _ = c.project([0, 0, 0])
        u1, _, _ = c.project([-3, 0, 0])
        _, v2, _ = c.project([0, 3, 0])
        self.assertLess(u1, u0)                        # -x is left when looking along -z with y up
        self.assertLess(v2, v0)                        # up = smaller v

    def test_brown_distortion_matches_formula_and_vanishes_at_axis(self):
        c = look_at([0, 0, 50], [0, 0, 0], k1=0.09, k2=-0.1, p2=-0.002)
        c0 = look_at([0, 0, 50], [0, 0, 0])
        u, v, _ = c.project([0, 0, 0])
        u0, v0, _ = c0.project([0, 0, 0])
        self.assertAlmostEqual(float(u), float(u0), places=6)
        p = np.array([8.0, 5.0, 0.0])
        x, y = 8.0 / 50, -5.0 / 50                     # normalised coords (x right, y down)
        r2 = x * x + y * y
        rad = 1 + 0.09 * r2 - 0.1 * r2 ** 2
        xd = x * rad + (-0.002) * (r2 + 2 * x * x)
        yd = y * rad + 2 * (-0.002) * x * y
        u, v, _ = c.project(p)
        self.assertAlmostEqual(float(u), (0.9 * xd) * 640 + 319.5, places=5)
        self.assertAlmostEqual(float(v), (0.9 * yd) * 640 + 239.5, places=5)

    def test_in_frame_rejects_behind_and_outside(self):
        c = look_at([0, 0, 50], [0, 0, 0])
        pts = np.array([[0, 0, 0], [0, 0, 80], [500, 0, 0]], float)
        u, v, z = c.project(pts)
        np.testing.assert_array_equal(c.in_frame(u, v, z), [True, False, False])

    def test_topo_to_game_pose_conversion_keeps_camera_centre(self):
        # a topocentric camera at (E, N, up) must land at game (E-cx, up-emin, -(N-cy)) after the affine
        from buildings.photos import _cam_from_json
        fr = FR.Frame((0, 0), (10.0, 20.0), 100.0, (1, 1), (0,) * 6, -9999.0, ((1, 0), (0, 1), (0, 0)))
        M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
        o = np.array([3.0 - 10.0, 0.0 - 100.0, -(4.0 - 20.0)])            # dE=3, dN=4, alt=0
        R0 = rodrigues([0.2, 0.1, -0.4])
        Ctopo = np.array([12.0, -7.0, 130.0])
        shot = {"rotation": [0.2, 0.1, -0.4], "translation": list(-R0 @ Ctopo)}
        cam = _cam_from_json("x", shot, {"width": 10, "height": 10, "focal": 1.0}, M, o)
        np.testing.assert_allclose(cam.center, M @ Ctopo + o, atol=1e-9)
        self.assertAlmostEqual(np.linalg.det(cam.R), 1.0)


class FacetTests(unittest.TestCase):
    def test_box_groups_into_4_walls_and_1_roof(self):
        v, t, s = box_shell()
        fs = FA.extract_facets(v, t, s)
        self.assertEqual(sorted(f.kind for f in fs), [0, 1, 1, 1, 1])        # floor (surf 2) skipped
        self.assertAlmostEqual(sum(f.area for f in fs), 2 * (20 + 10) * 12 + 200, places=6)

    def test_wall_frame_is_upright_right_handed_and_outward(self):
        v, t, s = box_shell()
        for f in FA.extract_facets(v, t, s):
            if f.kind != FA.WALL:
                continue
            np.testing.assert_allclose(f.v, [0, 1, 0], atol=1e-9)             # v up
            np.testing.assert_allclose(np.cross(f.u, f.v), f.n, atol=1e-9)    # u x v = n (right-handed)
            centre = np.array([10.0, 6.0, -5.0])
            self.assertGreater(float((f.o - centre) @ f.n), 4.0)              # points away from the box
            self.assertAlmostEqual(f.tmax - f.tmin, 12.0, places=6)

    def test_roof_frame_min_rectangle_axis_aligned_with_edges(self):
        # box rotated 30 deg about y: roof rectangle axes must follow the box, sizes 20 x 10
        v, t, s = box_shell()
        a = np.radians(30)
        Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
        f = [f for f in FA.extract_facets(v @ Ry.T, t, s) if f.kind == FA.ROOF][0]
        self.assertAlmostEqual(sorted(f.size_m)[0], 10.0, places=4)
        self.assertAlmostEqual(sorted(f.size_m)[1], 20.0, places=4)
        self.assertAlmostEqual(abs(f.n[1]), 1.0, places=9)

    def test_non_coplanar_neighbours_split(self):
        # two wall quads sharing an edge, 2 cm offset -> one facet; 30 cm offset -> two facets
        def two(off):
            v = np.array([[0, 0, 0], [5, 0, 0], [5, 3, 0], [0, 3, 0],
                          [5, 0, off], [10, 0, off], [10, 3, off], [5, 3, off]], float)
            t = np.array([[0, 1, 2], [0, 2, 3], [1, 5, 6], [1, 6, 2]])
            return v, t, np.ones(4, int)
        # second quad uses vertices 1(5,0,0)->5(10,0,off)->6->2(5,3,0): tilted by off/5 rad if off != 0
        self.assertEqual(len(FA.group_coplanar(*two(0.0))), 1)
        self.assertEqual(len(FA.group_coplanar(*two(1.5))), 2)

    def test_layout_fits_no_overlap_and_scales_when_too_big(self):
        v, t, s = box_shell(40, 30, 30)
        fs = FA.extract_facets(v, t, s)
        k = FA.layout_atlas(fs, 512, target_density={f.fid: 0.02 for f in fs}, min_density=0.02)
        self.assertGreater(k, 1.0)                          # 2 cm/px cannot fit 512 px -> coarser
        occ = np.zeros((512, 512), int)
        for f in fs:
            x, y = f.at
            self.assertGreaterEqual(x, FA.PAD)
            self.assertLessEqual(x + f.px[0] + FA.PAD, 512)
            self.assertLessEqual(y + f.px[1] + FA.PAD, 512)
            occ[y - FA.PAD:y + f.px[1] + FA.PAD, x - FA.PAD:x + f.px[0] + FA.PAD] += 1
        self.assertEqual(occ.max(), 1)
        fs2 = FA.extract_facets(v, t, s)
        k2 = FA.layout_atlas(fs2, 4096, target_density={f.fid: 0.05 for f in fs2})
        self.assertEqual(k2, 1.0)
        self.assertAlmostEqual(fs2[0].density, 0.05 * (1.0 if fs2[0].kind == FA.WALL else 1.5))

    def test_uv_corners_land_on_facet_rectangle(self):
        v, t, s = box_shell()
        fs = FA.extract_facets(v, t, s)
        FA.layout_atlas(fs, 1024, target_density={f.fid: 0.05 for f in fs})
        for f in fs:
            uv = FA.facet_uv(f, v, t, 1024).reshape(-1, 2) * 1024
            self.assertGreaterEqual(uv[:, 0].min(), f.at[0] - 1e-6)
            self.assertLessEqual(uv[:, 0].max(), f.at[0] + f.px[0] + 1e-6)
            self.assertGreaterEqual(uv[:, 1].min(), f.at[1] - 1e-6)
            self.assertLessEqual(uv[:, 1].max(), f.at[1] + f.px[1] + 1e-6)
            m = FA.facet_mask(f, v, t)
            self.assertGreater(m.mean(), 0.97)               # a rectangle facet is fully covered

    def test_texel_points_lie_on_the_plane(self):
        v, t, s = box_shell()
        fs = FA.extract_facets(v, t, s)
        FA.layout_atlas(fs, 1024, target_density={f.fid: 0.1 for f in fs})
        for f in fs:
            P = FA.texel_points(f)
            self.assertLess(float(np.abs((P - f.o) @ f.n).max()), 1e-9)


class ProjectionTests(unittest.TestCase):
    def test_plane_homography_equals_pinhole_projection(self):
        v, t, s = box_shell()
        f = [f for f in FA.extract_facets(v, t, s) if f.kind == FA.WALL and f.n[2] > 0.9][0]
        cam = look_at([10, 8, 40], [10, 6, 0], w=1280, h=720)
        H = PP.plane_homography(cam, f)
        st = np.array([[0.0, 0.0], [3.0, 2.0], [-4.0, 5.0], [7.5, -1.0]])
        P = f.to_world(st[:, 0], st[:, 1])
        u, v_, _ = cam.project(P)
        q = (H @ np.c_[st, np.ones(len(st))].T).T
        np.testing.assert_allclose(q[:, :2] / q[:, 2:], np.c_[u, v_], atol=1e-6)

    def test_gsd_is_finer_when_closer_and_more_frontal(self):
        cam = look_at([0, 0, 50], [0, 0, 0], w=3072, h=1728, focal=0.73)
        g_near = PP.gsd_on_facet(cam, 40.0, 1.0)
        g_far = PP.gsd_on_facet(cam, 80.0, 1.0)
        g_obl = PP.gsd_on_facet(cam, 40.0, 0.3)
        self.assertLess(g_near, g_far)
        self.assertLess(g_near, g_obl)
        self.assertAlmostEqual(g_near, 40.0 / (0.73 * 3072), places=9)


class VisibilityTests(unittest.TestCase):
    def hf(self):
        n = 200
        h = np.zeros((n, n), np.float32)
        h[95:105, 100:110] = 20.0                           # a 10 m x 10 m, 20 m tall block
        grid = FR.Grid(h + 100.0, 0.5, -50.0, 50.0)         # x in [-50, 50], z_msl = 100 + h
        return PP.HeightField(grid, 100.0)

    def test_block_occludes_behind_but_not_beside_or_above(self):
        hf = self.hf()
        block_x, block_zg = 2.5, -(-0.0)                    # block spans x 0..5, y_enu -2.5..2.5
        P = np.array([[2.5, 1.0, 0.0]] * 3 + [[-20.0, 1.0, 0.0]])
        cams = np.array([[-30.0, 5.0, 0.0],                 # behind the block (block between) -> hidden? no: P inside...
                         [2.5, 60.0, 0.0],                  # far above -> visible
                         [30.0, 1.0, 30.0], [40.0, 5.0, 0.0]])
        # point west of the block, camera east of the block at low height: block in between
        self.assertFalse(bool(self.hf().visible([[-20.0, 1.0, 0.0]], [40.0, 5.0, 0.0], s0=0.5)[0]))
        # same point, camera high above the block line of sight: visible
        self.assertTrue(bool(hf.visible([[-20.0, 1.0, 0.0]], [40.0, 90.0, 0.0], s0=0.5)[0]))
        # camera to the side (z offset): line of sight misses the block
        self.assertTrue(bool(hf.visible([[-20.0, 1.0, 0.0]], [-20.0, 5.0, 40.0], s0=0.5)[0]))

    def test_start_offset_ignores_own_surface(self):
        hf = self.hf()
        # a point on the block's west face, camera to the west: ray leaves the block immediately
        self.assertTrue(bool(hf.visible([[0.3, 10.0, 0.0]], [-40.0, 30.0, 0.0], s0=1.0)[0]))
        # camera east of the block: the block itself hides the west face
        self.assertFalse(bool(hf.visible([[-0.3, 10.0, 0.0]], [40.0, 12.0, 0.0], s0=0.2)[0]))

    def test_start_dist_scales_with_grazing(self):
        s = PP.start_dist(FA.WALL, np.array([1.0, 0.5, 0.05]), 2.0, 0.8)
        np.testing.assert_allclose(s, [2.0, 4.0, 10.0])


class SelectionTests(unittest.TestCase):
    def test_frontal_close_unoccluded_beats_grazing_far(self):
        v, t, s = box_shell()
        f = [f for f in FA.extract_facets(v, t, s) if f.kind == FA.WALL and f.n[2] > 0.9][0]
        f.px = (200, 120)
        mask = FA.facet_mask(f, v, t)
        pts = PP.sample_points(f, mask)
        cams = {"front": look_at([10, 8, 45], [10, 6, 0], w=1280, h=720),
                "far": look_at([10, 8, 150], [10, 6, 0], w=1280, h=720),
                "grazing": look_at([90, 8, 4], [10, 6, 0], w=1280, h=720),
                "behind": look_at([10, 8, -60], [10, 6, 0], w=1280, h=720)}
        rk = PP.rank_cameras(f, pts, cams, None, None, min_cos=0.25)
        names = [c.name for c in rk]
        self.assertEqual(names[0], "front")
        self.assertNotIn("behind", names)
        self.assertNotIn("grazing", names)                    # cos < 0.25 everywhere

    def test_greedy_cover_adds_complementary_views(self):
        a = PP.CamScore("a", 3.0, .8, .04, 1, 1)
        b = PP.CamScore("b", 2.9, .8, .04, 1, 1)           # same coverage as a (redundant)
        c = PP.CamScore("c", 1.0, .5, .05, 1, 1)           # sees the other half
        qs = {"a": np.r_[np.ones(50), np.zeros(50)], "b": np.r_[np.ones(50) * .99, np.zeros(50)],
              "c": np.r_[np.zeros(50), np.ones(50) * .6]}
        order = [x.name for x in PP._greedy_cover([a, b, c], qs)]
        self.assertEqual(order[:2], ["a", "c"])

    def test_exg_flags_green_not_grey_or_brick(self):
        px = np.array([[[60, 150, 50], [120, 120, 120], [170, 80, 60], [200, 210, 190]]], np.uint8)
        np.testing.assert_array_equal(PP.exg_veg(px)[0], [True, False, False, False])

    def test_gain_match_recovers_exposure_and_is_clamped(self):
        rng = np.random.default_rng(0)
        ref = rng.uniform(60, 200, (50, 50, 3)).astype(np.float32)
        img = ref / np.array([1.2, 1.0, 0.9], np.float32)
        g = PP.gain_match(ref, img, np.ones((50, 50), bool))
        np.testing.assert_allclose(g, [1.2, 1.0, 0.9], atol=0.02)
        g2 = PP.gain_match(ref, img * 0.2, np.ones((50, 50), bool))
        self.assertTrue((g2 <= 1.33 + 1e-6).all())
        np.testing.assert_allclose(PP.gain_match(ref, img, np.zeros((50, 50), bool)), [1, 1, 1])

    def test_diffuse_fill_has_no_streaks_and_uses_valid_colours(self):
        img = np.zeros((60, 60, 3), np.float32)
        img[:, :20] = [200, 100, 50]
        good = np.zeros((60, 60), bool)
        good[:, :20] = True
        out = PP.diffuse_fill(img, good, 6.0, tone_px=30)
        self.assertTrue(np.allclose(out[:, :20], img[:, :20]))
        np.testing.assert_allclose(out[30, 59], [200, 100, 50], atol=1.0)      # relaxed to facet tone


class EndToEndRectification(unittest.TestCase):
    def test_bake_recovers_a_procedural_wall_texture(self):
        from PIL import Image
        v, t, s = box_shell()
        f = [f for f in FA.extract_facets(v, t, s) if f.kind == FA.WALL and f.n[2] > 0.9][0]
        FA.layout_atlas([f], 1024, target_density={f.fid: 0.05})

        def tex(S, T):                                      # smooth colour pattern in facet coordinates
            L = 130 + 80 * np.sin(S * 1.3) * np.cos(T * 0.9) + 30 * np.sin(T * 1.7)     # warm grey wall (not green)
            return np.stack([L + 15, L, L - 15], -1)

        cam = look_at([10, 9, 40], [10, 6, 0], w=1280, h=720, focal=0.9)
        # render the "photo" by intersecting every pixel ray with the wall plane
        uu, vv = np.meshgrid(np.arange(1280), np.arange(720))
        S = 1280
        x = (uu - 639.5) / (0.9 * S)
        y = (vv - 359.5) / (0.9 * S)
        d = np.stack([x, y, np.ones_like(x)], -1) @ cam.R                   # world directions
        C = cam.center
        tt = ((f.o - C) @ f.n) / (d @ f.n)
        P = C + tt[..., None] * d
        st = np.stack([(P - f.o) @ f.u, (P - f.o) @ f.v], -1)
        img = np.clip(tex(st[..., 0], st[..., 1]), 0, 255).astype(np.uint8)
        with tempfile.TemporaryDirectory() as td:
            Image.fromarray(img).save(Path(td) / "c.png")
            store = PP.PhotoStore(Path(td))
            mask = FA.facet_mask(f, v, t)
            score = PP.CamScore("c.png", 1.0, .9, .03, 1.0, 1.0)
            rgb, info = PP.bake_facet(f, mask, {"c.png": cam}, store, None, [score], PP.BakeParams(min_cos=0.25))
        W, H = f.size_m
        w, h = f.px
        S_, T_ = np.meshgrid((np.arange(w) + .5) / w * W + f.smin, f.tmax - (np.arange(h) + .5) / h * H)
        truth = np.clip(tex(S_, T_), 0, 255)
        inside = np.zeros((h, w), bool)
        # only texels the camera actually sees (facet is 20 x 12 m at 40 m distance: all of it)
        inside[:] = True
        err = np.abs(rgb.astype(float) - truth)[inside]
        self.assertLess(float(np.median(err)), 2.5)
        self.assertLess(float(np.percentile(err, 99)), 12.0)
        self.assertEqual(info["primary"], "c.png")
        # a green (vegetation) patch in front of the wall is masked out and filled from the wall around it
        img2 = img.copy()
        img2[300:420, 500:700] = [40, 160, 40]
        with tempfile.TemporaryDirectory() as td:
            Image.fromarray(img2).save(Path(td) / "c.png")
            rgb2, info2 = PP.bake_facet(f, mask, {"c.png": cam}, PP.PhotoStore(Path(td)), None, [score], PP.BakeParams())
        self.assertGreater(info2["hole_frac"], 0.02)
        g = rgb2.astype(float)
        self.assertLess(float(((g[..., 1] - 0.5 * (g[..., 0] + g[..., 2])) > 40).mean()), 0.002)
        self.assertLess(info["hole_frac"], 0.02)


if __name__ == "__main__":
    unittest.main()
