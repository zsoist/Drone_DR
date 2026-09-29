"""tresd_publish.py: republish ordering, DSM purge, model swap, tiles."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import tresd_publish  # noqa: E402


class RepublishOrderTests(unittest.TestCase):
    def test_stale_dsm_purge_happens_right_before_meta_write(self):
        src = (HERE / "tresd_publish.py").read_text()
        body = src[src.index("def main():"):]
        purge = body.index("purge_stale_dsm_derived(out)")
        self.assertGreater(purge, body.index("swap_model_dir(new_model"))
        self.assertGreater(purge, body.index("sidecars .gz"))
        self.assertLess(purge, body.index('meta = {\n        "clip_id"'))
        self.assertLess(purge, body.index('atomic_write_json(out / "meta.json"'))


class TresdPublishTests(unittest.TestCase):
    def test_purge_removes_stale_dsm_derivatives_only(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            for n in ("dsm_lod.json", "dsm_lod256.bin", "dsm_lod512.mask.bin", "scene.v2.json",
                      "site.lod.json", "meta.json", "ortho.webp", "collision.bin"):
                (out / n).write_text("x")
            removed = tresd_publish.purge_stale_dsm_derived(out)
            self.assertEqual({"dsm_lod.json", "dsm_lod256.bin", "dsm_lod512.mask.bin",
                              "scene.v2.json", "site.lod.json"}, set(removed))
            self.assertTrue((out / "meta.json").exists())
            self.assertTrue((out / "collision.bin").exists())

    def test_model_swap_keeps_old_model_until_new_is_ready(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "model").mkdir()
            (out / "model" / "old.jpg").write_text("old")
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            # before the swap the previous model is untouched
            self.assertTrue((out / "model" / "old.jpg").exists())
            tresd_publish.swap_model_dir(new, out / "model")
            self.assertEqual(["new.jpg"], [p.name for p in (out / "model").iterdir()])
            self.assertFalse((out / ".model.old").exists())

    def test_model_swap_recovers_when_only_the_old_copy_survived(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            old = out / ".model.old"
            old.mkdir()
            (old / "good.jpg").write_text("good")      # crash entre rename(final→old) y rename(new→final)
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            with mock.patch.object(Path, "rename", autospec=True,
                                   side_effect=lambda self, tgt, _r=Path.rename:
                                   (_ for _ in ()).throw(OSError("boom")) if self.name == ".model.new"
                                   else _r(self, tgt)):
                with self.assertRaises(OSError):
                    tresd_publish.swap_model_dir(new, out / "model")
            # la única copia buena NO se borró: quedó restaurada como model/
            self.assertEqual("good", (out / "model" / "good.jpg").read_text())

    def test_model_swap_rolls_back_when_the_new_rename_fails(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "model").mkdir()
            (out / "model" / "old.jpg").write_text("old")
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            with mock.patch.object(Path, "rename", autospec=True,
                                   side_effect=lambda self, tgt, _r=Path.rename:
                                   (_ for _ in ()).throw(OSError("boom")) if self.name == ".model.new"
                                   else _r(self, tgt)):
                with self.assertRaises(OSError):
                    tresd_publish.swap_model_dir(new, out / "model")
            self.assertEqual(["old.jpg"], [p.name for p in (out / "model").iterdir()])

    def test_tiles_timeout_does_not_abort_publish(self):
        with tempfile.TemporaryDirectory() as td:
            proj, out = Path(td) / "proj", Path(td) / "out"
            proj.mkdir()
            (out / "tiles").mkdir(parents=True)
            (out / "tiles" / "stale.png").write_text("x")   # tiles de la corrida anterior
            for exc in (subprocess.TimeoutExpired("docker", 1800), RuntimeError("gdal2tiles"),
                        OSError("disk")):
                with mock.patch.object(tresd_publish, "sh_in_odm", side_effect=exc):
                    self.assertEqual({}, tresd_publish.build_tiles(proj, out))
            self.assertFalse((out / "tiles").exists())      # obsoletos fuera


if __name__ == "__main__":
    unittest.main()
