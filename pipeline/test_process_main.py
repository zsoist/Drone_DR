"""process.py CLI exit codes."""
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))


class ProcessExitCodeTests(unittest.TestCase):
    def test_failed_clip_yields_nonzero_exit_but_processes_the_rest(self):
        import process
        seen = []

        def fake(p):
            seen.append(p.name)
            if p.name == "bad.mp4":
                raise subprocess.CalledProcessError(1, "ffmpeg")
        with mock.patch.object(process, "process_clip", side_effect=fake), \
                mock.patch.object(sys, "argv", ["process.py", "/x/bad.mp4", "/x/ok.mp4"]):
            self.assertEqual(1, process.main())
        self.assertEqual(["bad.mp4", "ok.mp4"], seen)
        with mock.patch.object(process, "process_clip"), \
                mock.patch.object(sys, "argv", ["process.py", "/x/ok.mp4"]):
            self.assertEqual(0, process.main())


if __name__ == "__main__":
    unittest.main()
