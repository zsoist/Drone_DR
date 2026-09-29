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
    def test_make_thumb_caps_width_keeps_aspect_and_alpha(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.webp", Path(td) / "ortho_thumb.webp"
            _png(src, 2000, 1000)
            self.assertTrue(tresd_publish.make_ortho_thumb(src, dst))
            with Image.open(dst) as im:
                self.assertEqual((480, 240), im.size)
                self.assertIn("A", im.getbands())
            self.assertLess(dst.stat().st_size, src.stat().st_size)
            small = Path(td) / "s.png"
            _png(small, 100, 50)
            self.assertTrue(tresd_publish.make_ortho_thumb(small, Path(td) / "t2.webp"))
            with Image.open(Path(td) / "t2.webp") as im:
                self.assertEqual((100, 50), im.size)

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
