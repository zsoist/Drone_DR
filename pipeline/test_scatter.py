"""Unit tests for scatter.py (W5 vegetation scatter) on synthetic ortho / DSM / coverage."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

import scatter

R = C = 80
SP = (1.0, 1.0)


def _world():
    """80x80 m flat world; green 20x20 tree block (12 m high) at rows/cols 10..30,
    green flat meadow at 50..70, grey roof block (10 m high) at 10..30 x 50..70."""
    rgb = np.full((R, C, 3), 0.45, np.float32)              # grey ground
    hf = np.zeros((R, C), np.float32)
    rgb[10:30, 10:30] = (0.15, 0.45, 0.12); hf[10:30, 10:30] = 12.0     # tree canopy
    rgb[50:70, 50:70] = (0.20, 0.50, 0.15); hf[50:70, 50:70] = 1.4      # shrubs
    rgb[50:70, 10:30] = (0.5, 0.5, 0.5); hf[50:70, 10:30] = 10.0        # grey building
    valid = np.ones((R, C), bool)
    return rgb, hf, valid


class ComputeScatterTests(unittest.TestCase):
    def run_it(self, cov=None, seed=7, **kw):
        rgb, hf, valid = _world()
        return scatter.compute_scatter(rgb, hf, valid, cov, SP, seed, **kw)

    def _pos(self, res):
        # rows are [x, z, g, h, yaw, type, tint]; game frame origin = centre, +z south
        return [(r[0] + (C - 1) / 2, r[1] + (R - 1) / 2, r) for r in res["instances"]]

    def test_trees_on_canopy_shrubs_on_meadow_nothing_on_roof(self):
        res = self.run_it()
        self.assertGreater(res["counts"]["tree"], 3)
        self.assertGreater(res["counts"]["shrub"], 5)
        for col, row, r in self._pos(res):                    # col = x index, row = z index
            in_canopy = 10 <= col <= 30 and 10 <= row <= 30
            in_meadow = 48 <= col <= 72 and 48 <= row <= 72   # incl. the bilinear ramp at the edge
            near_canopy = 8 <= col <= 32 and 8 <= row <= 32       # bilinear nDSM ramp at the crown edge
            self.assertTrue(in_canopy or in_meadow or near_canopy, r)
            if in_canopy and r[5] != scatter.BUSH_TYPE:
                self.assertGreaterEqual(r[3], scatter.TREE_H_RANGE[0])
                self.assertAlmostEqual(r[2], scatter.SINK_FRAC * r[3], places=1)
            elif 52 <= col <= 68 and 52 <= row <= 68:
                self.assertEqual(r[5], scatter.BUSH_TYPE)
                self.assertLessEqual(r[3], scatter.SHRUB_H_RANGE[1])

    def test_mesh_coverage_is_excluded_with_margin(self):
        cov = np.zeros((R, C), bool); cov[:, :40] = True      # mesh covers the left half (incl. canopy)
        res = self.run_it(cov=cov)
        self.assertEqual(res["counts"]["tree"], 0)
        for col, _, r in self._pos(res):
            self.assertGreater(col, 40 + scatter.MESH_MARGIN_M - 1.5, r)
        self.assertGreater(res["mask"]["excluded_mesh_pct"], 40)

    def test_invalid_dsm_cells_are_skipped(self):
        rgb, hf, valid = _world()
        valid[:, :40] = False
        res = scatter.compute_scatter(rgb, hf, valid, None, SP, 3)
        for r in res["instances"]:
            self.assertGreater(r[0] + (C - 1) / 2, 39)

    def test_deterministic_and_seed_sensitive(self):
        a, b, c = self.run_it(seed=1), self.run_it(seed=1), self.run_it(seed=2)
        self.assertEqual(a["instances"], b["instances"])
        self.assertNotEqual(a["instances"], c["instances"])

    def test_cap_keeps_prefix_of_shuffled_list(self):
        full = self.run_it()
        capped = self.run_it(cap=10)
        self.assertEqual(len(capped["instances"]), 10)
        self.assertEqual(capped["instances"], full["instances"][:10])

    def test_min_spacing_between_trees(self):
        res = self.run_it()
        trees = [r for r in res["instances"] if r[5] != scatter.BUSH_TYPE]
        for i, a in enumerate(trees):
            for b in trees[i + 1:]:
                self.assertGreater(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** .5, 1.4)

    def test_tint_is_always_foliage_green(self):
        rgb, hf, valid = _world()
        rgb[10:30, 10:30] = (0.05, 0.30, 0.45)                # teal "pond": passes ExG only weakly
        res = scatter.compute_scatter(rgb, hf, valid, None, SP, 5, exg_threshold=0.0)
        for r in res["instances"]:
            t = r[6]; red, green, blue = (t >> 16) & 255, (t >> 8) & 255, t & 255
            self.assertGreater(green, blue)

    def test_shape_mismatch_raises(self):
        rgb, hf, valid = _world()
        with self.assertRaises(scatter.ScatterError):
            scatter.compute_scatter(rgb, hf, valid[:-1], None, SP, 1)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory(); self.addCleanup(self.td.cleanup)
        self.vault = Path(self.td.name)
        d = self.vault / "models" / "c1"; d.mkdir(parents=True)
        rgb, hf, valid = _world()
        hf.astype(np.float32).tofile(d / "dsm_lod256.bin")
        (valid.astype(np.uint8) * 255).tofile(d / "dsm_lod256.mask.bin")
        np.zeros((R, C), np.uint8).tofile(d / "mesh_coverage.bin")
        img = Image.fromarray((rgb * 255).astype(np.uint8)).resize((400, 400), Image.NEAREST)
        img.save(d / "ortho.webp")
        (d / "dsm_lod.json").write_text(json.dumps({
            "grid": [R, C], "spacing_m": list(SP), "size_m": [C - 1, R - 1], "elev_min": 100.0,
            "bin": "dsm_lod256.bin", "mask_bin": "dsm_lod256.mask.bin"}))
        (d / "meta.json").write_text(json.dumps({"ortho_asset": "ortho.webp"}))

    def test_build_validate_and_staleness(self):
        doc = scatter.build("c1", self.vault)
        self.assertEqual(doc["version"], scatter.VERSION)
        self.assertGreater(doc["counts"]["tree"] + doc["counts"]["shrub"], 5)
        self.assertEqual(doc["row"], ["x", "z", "g", "h", "yaw", "type", "tint"])
        self.assertEqual(scatter.validate("c1", self.vault)["source_fingerprint"], doc["source_fingerprint"])
        again = scatter.build("c1", self.vault)               # fresh -> kept as is
        self.assertEqual(again["instances"], doc["instances"])
        np.ones((R, C), np.uint8).tofile(self.vault / "models" / "c1" / "mesh_coverage.bin")
        with self.assertRaises(scatter.ScatterError):
            scatter.validate("c1", self.vault)                # coverage changed -> stale
        rebuilt = scatter.build("c1", self.vault)
        self.assertEqual(rebuilt["counts"]["tree"], 0)        # everything now under the mesh

    def test_missing_ortho_raises(self):
        (self.vault / "models" / "c1" / "ortho.webp").unlink()
        with self.assertRaises(scatter.ScatterError):
            scatter.build("c1", self.vault)


if __name__ == "__main__":
    unittest.main()
