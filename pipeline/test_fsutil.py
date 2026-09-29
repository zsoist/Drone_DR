"""fsutil.py: crash-safe writes."""
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fsutil  # noqa: E402


class AtomicWriteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_file_mode_is_0644_not_mkstemp_0600(self):
        target = self.dir / "a.json"
        fsutil.atomic_write_json(target, {"a": 1})
        self.assertEqual(0o644, stat.S_IMODE(target.stat().st_mode))
        fsutil.atomic_write_bytes(self.dir / "b.bin", b"x", mode=0o600)
        self.assertEqual(0o600, stat.S_IMODE((self.dir / "b.bin").stat().st_mode))

    def test_roundtrip_json_text_and_bytes(self):
        fsutil.atomic_write_json(self.dir / "a.json", {"ñ": [1, 2]}, indent=1)
        self.assertEqual({"ñ": [1, 2]}, json.loads((self.dir / "a.json").read_text(encoding="utf-8")))
        fsutil.atomic_write_text(self.dir / "t.txt", "hola")
        self.assertEqual("hola", (self.dir / "t.txt").read_text())
        fsutil.atomic_write_bytes(self.dir / "b.bin", b"\x00\x01", fsync=True)
        self.assertEqual(b"\x00\x01", (self.dir / "b.bin").read_bytes())

    def test_failure_keeps_previous_content_and_removes_tmp(self):
        target = self.dir / "a.json"
        fsutil.atomic_write_json(target, {"v": "old"})
        with self.assertRaises(TypeError):
            fsutil.atomic_write_json(target, {"v": object()})       # serialization fails
        self.assertEqual({"v": "old"}, json.loads(target.read_text()))
        self.assertEqual(["a.json"], sorted(p.name for p in self.dir.iterdir()))

    def test_replace_failure_cleans_tmp_and_leaves_no_partial_target(self):
        target = self.dir / "new.json"
        with mock.patch.object(fsutil.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                fsutil.atomic_write_text(target, "data")
        self.assertFalse(target.exists())
        self.assertEqual([], list(self.dir.iterdir()))

    def test_target_is_never_observed_partially_written(self):
        target = self.dir / "big.txt"
        fsutil.atomic_write_text(target, "A" * 10)
        seen = []
        real_replace = os.replace

        def spy(src, dst):
            seen.append(Path(dst).read_text())            # before the swap: still the old content
            return real_replace(src, dst)
        with mock.patch.object(fsutil.os, "replace", side_effect=spy):
            fsutil.atomic_write_text(target, "B" * 1_000_000)
        self.assertEqual(["A" * 10], seen)
        self.assertEqual(1_000_000, len(target.read_text()))

    def test_tmp_names_are_unique_per_write(self):
        names = []
        real = fsutil.tempfile.mkstemp

        def spy(*a, **k):
            fd, name = real(*a, **k)
            names.append(name)
            return fd, name
        with mock.patch.object(fsutil.tempfile, "mkstemp", side_effect=spy):
            fsutil.atomic_write_text(self.dir / "x", "1")
            fsutil.atomic_write_text(self.dir / "x", "2")
        self.assertEqual(2, len(set(names)))

    def test_read_json_defaults_on_missing_or_corrupt(self):
        self.assertEqual({}, fsutil.read_json(self.dir / "nope.json", {}))
        (self.dir / "bad.json").write_text("{not json")
        self.assertIsNone(fsutil.read_json(self.dir / "bad.json"))
        (self.dir / "ok.json").write_text('{"a": 1}')
        self.assertEqual({"a": 1}, fsutil.read_json(self.dir / "ok.json", {}))


if __name__ == "__main__":
    unittest.main()
