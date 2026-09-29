"""splat_history.py: per-clip history retention and the training quality gate."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import splat_history  # noqa: E402


def _touch(path: Path, mtime: float, size: int = 1):
    path.write_bytes(b"x" * size)
    os.utime(path, (mtime, mtime))


class HistoryFilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.hist = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_dir_is_empty(self):
        self.assertEqual([], splat_history.clip_history_files(self.hist / "nope", "A"))

    def test_neighbour_clip_with_dash_suffix_is_not_captured(self):
        for name in ("A-20260101-101010.splat", "A-2-20260101-101010.splat",
                     "A-20260101-101010.meta.json", "A-20260101-101010.txt", "AA-20260101-101010.splat"):
            (self.hist / name).write_text("x")
        got = sorted(p.name for p in splat_history.clip_history_files(self.hist, "A"))
        self.assertEqual(["A-20260101-101010.meta.json", "A-20260101-101010.splat"], got)
        self.assertEqual(["A-2-20260101-101010.splat"],
                         [p.name for p in splat_history.clip_history_files(self.hist, "A-2")])

    def test_cid_with_regex_metacharacters_is_matched_literally(self):
        (self.hist / "a.b-20260101-101010.splat").write_text("x")
        (self.hist / "aXb-20260101-101010.splat").write_text("x")
        self.assertEqual(["a.b-20260101-101010.splat"],
                         [p.name for p in splat_history.clip_history_files(self.hist, "a.b")])


class PruneTests(unittest.TestCase):
    def test_keeps_latest_version_groups_whole_and_leaves_other_clips(self):
        with tempfile.TemporaryDirectory() as td:
            hist = Path(td)
            for i in range(4):
                stamp = f"2026010{i + 1}-000000"
                for ext in ("splat", "meta.json", "cameras.json"):
                    _touch(hist / f"A-{stamp}.{ext}", 1000 + i)
            _touch(hist / "B-20250101-000000.splat", 1)
            splat_history.prune_splat_history(hist, "A", keep=2)
            left = sorted(p.name for p in hist.iterdir())
            self.assertEqual(7, len(left))
            self.assertIn("B-20250101-000000.splat", left)
            for name in left:
                if name.startswith("A-"):
                    self.assertTrue(name.startswith(("A-20260103", "A-20260104")), name)
            # each surviving version keeps ALL its files (no partial sets)
            self.assertEqual(3, sum(n.startswith("A-20260104") for n in left))
            self.assertEqual(3, sum(n.startswith("A-20260103") for n in left))


class QualityGateTests(unittest.TestCase):
    def _out(self, td, size):
        p = Path(td) / "o.splat"
        p.write_bytes(b"0" * size)
        return p

    def test_healthy_run_passes(self):
        with tempfile.TemporaryDirectory() as td:
            log = "Step 100: 0.30\nStep 1000: 0.12\n"
            q = splat_history.splat_quality(self._out(td, 400_000), log, 20, 1000)
            self.assertTrue(q["passed"], q)
            self.assertEqual("ok", q["reason"])
            self.assertEqual(0.12, q["final_loss"])
            self.assertEqual(1000, q["last_step"])

    def test_nan_loss_incomplete_tiny_few_cameras_and_high_loss_each_fail(self):
        with tempfile.TemporaryDirectory() as td:
            big = self._out(td, 400_000)
            self.assertIn("divergió", splat_history.splat_quality(big, "Step 10: 0.3\nStep 20: nan", 20, 20)["reason"])
            self.assertIn("incompleto", splat_history.splat_quality(big, "Step 100: 0.2", 20, 1000)["reason"])
            self.assertIn("pequeño", splat_history.splat_quality(self._out(td, 10), "Step 1000: 0.1", 20, 1000)["reason"])
            self.assertIn("cámaras", splat_history.splat_quality(big, "Step 1000: 0.1", 3, 1000)["reason"])
            self.assertIn("loss final alto", splat_history.splat_quality(big, "Step 1000: 0.9", 20, 1000)["reason"])

    def test_missing_output_file_counts_as_zero_bytes(self):
        q = splat_history.splat_quality(Path("/nonexistent/x.splat"), "", 20, 0)
        self.assertFalse(q["passed"])
        self.assertEqual(0, q["bytes"])


if __name__ == "__main__":
    unittest.main()
