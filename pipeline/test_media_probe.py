"""media_probe.py: ffprobe wrappers."""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import media_probe  # noqa: E402


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
