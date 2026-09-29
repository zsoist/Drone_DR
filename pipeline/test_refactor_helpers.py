"""Unit tests for the small shared helpers extracted from aerobrain_server."""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import subprocess
from unittest import mock

import media_probe
import util_ids

HOSTILE = [
    "", "clip_0104", "a-b_c", "../../etc/passwd", "..\\..\\x", "a\x00b", "a/b.mp4",
    "my file.mp3", "  lead trail  ", "...", ".hidden", "ñandú día.mp3", "日本語-01",
    "a;rm -rf /", "tab\tnew\nline", "emoji\U0001F681x", "a" * 300, 123, None, 4.5, ["x", "y"],
]


class UtilIdsTests(unittest.TestCase):
    def check(self, fn, pattern, repl):
        for s in HOSTILE:
            with self.subTest(fn=fn.__name__, s=s):
                self.assertEqual(fn(s), re.sub(pattern, repl, str(s)))

    def test_safe_id(self):
        self.check(util_ids.safe_id, r"[^\w-]", "")

    def test_safe_name(self):
        self.check(util_ids.safe_name, r"[^\w.\- ]", "")

    def test_safe_upload_name(self):
        self.check(util_ids.safe_upload_name, r"[^\w.\-]", "_")

    def test_safe_upload_name_spaces(self):
        self.check(util_ids.safe_upload_name_spaces, r"[^\w.\- ]", "_")

    def test_no_path_separators_survive(self):
        for fn in (util_ids.safe_id, util_ids.safe_name, util_ids.safe_upload_name):
            out = fn("../../a/b\\c\x00")
            self.assertNotIn("/", out)
            self.assertNotIn("\\", out)
            self.assertNotIn("\x00", out)


class MediaProbeTests(unittest.TestCase):
    def fake(self, stdout="", rc=0):
        return mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], rc, stdout, ""))

    def test_duration_parses_and_defaults_to_zero(self):
        with self.fake("12.5\n"):
            self.assertEqual(12.5, media_probe.probe_duration("x.mp4"))
        with self.fake(""):
            self.assertEqual(0.0, media_probe.probe_duration("x.mp4"))
        with mock.patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("ffprobe", 60)):
            self.assertEqual(0.0, media_probe.probe_duration("x.mp4"))
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual(0.0, media_probe.probe_duration("x.mp4"))

    def test_duration_passes_timeout(self):
        with self.fake("1") as run:
            media_probe.probe_duration("x.mp4", timeout=7)
        self.assertEqual(7, run.call_args.kwargs["timeout"])

    def test_has_audio(self):
        with self.fake("1\n"):
            self.assertTrue(media_probe.has_audio("x.mp4"))
        with self.fake("\n"):
            self.assertFalse(media_probe.has_audio("x.mp4"))
        with mock.patch.object(subprocess, "run", side_effect=RuntimeError):
            self.assertFalse(media_probe.has_audio("x.mp4"))

    def test_probe_streams_json(self):
        with self.fake('{"streams": [], "format": {}}'):
            self.assertEqual({"streams": [], "format": {}}, media_probe.probe_streams_json("x"))
        with self.fake("not json"):
            self.assertIsNone(media_probe.probe_streams_json("x"))
        with mock.patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("ffprobe", 30)):
            self.assertIsNone(media_probe.probe_streams_json("x"))

    def test_ffprobe_text_check_raises(self):
        with mock.patch.object(subprocess, "run", side_effect=subprocess.CalledProcessError(1, "ffprobe")):
            with self.assertRaises(subprocess.CalledProcessError):
                media_probe.ffprobe_text(["-of", "json"], "x", check=True)


if __name__ == "__main__":
    unittest.main()
