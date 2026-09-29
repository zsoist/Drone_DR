"""Ortho thumbnails: generation, backfill and manifest/index wiring."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import backfill_thumbs  # noqa: E402
import build_index  # noqa: E402
import tresd_publish  # noqa: E402


def _png(path, w, h, alpha=True):
    from PIL import Image
    im = Image.new("RGBA" if alpha else "RGB", (w, h), (10, 120, 30, 200) if alpha else (10, 120, 30))
    im.save(path)


class ThumbTests(unittest.TestCase):
    def test_make_thumb_caps_width_and_keeps_aspect_without_voids(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.webp", Path(td) / "ortho_thumb.webp"
            _png(src, 2000, 1000)
            self.assertTrue(tresd_publish.make_ortho_thumb(src, dst))
            with Image.open(dst) as im:
                self.assertEqual((480, 240), im.size)
                self.assertNotIn("A", im.getbands())      # opaque: voids are cropped/filled, never shipped
            self.assertLess(dst.stat().st_size, src.stat().st_size)
            small = Path(td) / "s.png"
            _png(small, 100, 50)
            self.assertTrue(tresd_publish.make_ortho_thumb(small, Path(td) / "t2.webp"))
            with Image.open(Path(td) / "t2.webp") as im:
                self.assertEqual((100, 50), im.size)

    @staticmethod
    def _rotated_ortho(path, w=1200, h=900):
        """Ortho-like RGBA: a rotated valid diamond-ish polygon with transparent nodata around
        it plus a transparent hole and an opaque-black hole inside the valid area."""
        import numpy as np
        from PIL import Image
        yy, xx = np.mgrid[0:h, 0:w]
        inside = (abs(xx - w / 2) / (w * 0.5) + abs(yy - h / 2) / (h * 0.62)) < 1.0
        rng = np.random.default_rng(3)
        rgb = np.stack([90 + 40 * np.sin(xx / 50.0), 130 + 30 * np.cos(yy / 40.0), 70 + 0 * xx], -1)
        rgb = np.clip(rgb + rng.normal(0, 4, rgb.shape), 30, 255).astype(np.uint8)
        a = np.where(inside, 255, 0).astype(np.uint8)
        a[400:420, 560:640] = 0                        # small transparent hole in the middle
        rgb[500:512, 500:560] = 0                      # opaque-black hole
        Image.fromarray(np.dstack([rgb, a]), "RGBA").save(path)

    def test_thumb_crops_nodata_and_fills_inner_voids(self):
        import numpy as np
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.png", Path(td) / "ortho_thumb.webp"
            self._rotated_ortho(src)
            with Image.open(src) as im:
                before = tresd_publish._void_mask(im).mean()
            self.assertGreater(before, 0.25)
            self.assertTrue(tresd_publish.make_ortho_thumb(src, dst))
            with Image.open(dst) as im:
                self.assertEqual("RGB", im.mode)
                self.assertLessEqual(im.width, 480)
                self.assertAlmostEqual(16 / 10, im.width / im.height, delta=0.06)
                a = np.asarray(im)
                self.assertLess((a.max(-1) < 12).mean(), 0.002)       # no black holes left
                self.assertGreater(im.width, 200)                     # a real crop, not a sliver

    def test_best_window_is_void_free_centred_and_aspected(self):
        import numpy as np
        void = np.ones((100, 200), bool)
        void[10:90, 30:170] = False                  # valid block, centred
        x, y, w, h = tresd_publish._best_window(void)
        self.assertFalse(void[y:y + h, x:x + w].any())
        self.assertAlmostEqual(w / h, 1.6, delta=0.1)
        self.assertEqual(80, h)                      # limited by the 80-row block
        self.assertLessEqual(abs((x + w / 2) - 100), 1)

    def test_fill_voids_uses_neighbours_and_survives_all_void(self):
        import numpy as np
        rgb = np.full((20, 20, 3), 200, np.uint8)
        void = np.zeros((20, 20), bool)
        void[5:15, 5:15] = True
        rgb[void] = 0
        out = tresd_publish._fill_voids(rgb, void)
        self.assertTrue((out == 200).all())
        allv = np.ones((6, 6), bool)
        self.assertEqual((6, 6, 3), tresd_publish._fill_voids(np.zeros((6, 6, 3), np.uint8), allv).shape)

    def test_corrupt_source_leaves_no_partial_thumb(self):
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.webp", Path(td) / "ortho_thumb.webp"
            src.write_bytes(b"not an image")
            self.assertFalse(tresd_publish.make_ortho_thumb(src, dst))
            self.assertEqual([src.name], [p.name for p in Path(td).iterdir()])

    def test_refresh_removes_a_stale_thumb_when_regeneration_fails(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "ortho.webp").write_bytes(b"broken")
            (out / "ortho_thumb.webp").write_bytes(b"old thumb from another run")
            self.assertFalse(tresd_publish.refresh_ortho_thumb(out))
            self.assertFalse((out / "ortho_thumb.webp").exists())

    def test_backfill_is_idempotent_and_skips_fresh_thumbs(self):
        with tempfile.TemporaryDirectory() as td:
            models = Path(td) / "models"
            for name in ("A", "B"):
                (models / name).mkdir(parents=True)
                (models / name / "meta.json").write_text("{}")
                _png(models / name / "ortho.webp", 1200, 800)
            (models / "C").mkdir()
            (models / "C" / "meta.json").write_text("{}")          # sin ortho
            first = backfill_thumbs.backfill(models)
            self.assertEqual(["A", "B"], first["created"])
            self.assertEqual(["C"], first["no_ortho"])
            second = backfill_thumbs.backfill(models)
            self.assertEqual([], second["created"])
            self.assertEqual(["A", "B"], second["skipped"])
            os.utime(models / "A" / "ortho.webp", (2e9, 2e9))      # ortho más nueva → regenera
            third = backfill_thumbs.backfill(models)
            self.assertEqual(["A"], third["created"])

    def test_build_index_exposes_thumb_only_when_present(self):
        with tempfile.TemporaryDirectory() as td:
            models = Path(td)
            for name in ("A", "B"):
                (models / name).mkdir()
                (models / name / "meta.json").write_text(json.dumps({"clip_id": name}))
            (models / "A" / "ortho_thumb.webp").write_bytes(b"x")
            by = {m["clip_id"]: m for m in build_index.load_models(models)}
        self.assertEqual("data/models/A/ortho_thumb.webp", by["A"]["thumb"])
        self.assertNotIn("thumb", by["B"])

    def test_scene_manifest_prefers_thumb_poster_with_ortho_fallback(self):
        src = (HERE / "scene_manifest.py").read_text()
        self.assertIn('ortho_thumb.webp").exists()', src)
        self.assertIn("meta['ortho_asset']", src)


if __name__ == "__main__":
    unittest.main()
