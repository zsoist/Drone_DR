"""Preview mode: a read-only second server for git worktrees (AEROBRAIN_PREVIEW_PORT)."""
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

SERVER = Path(__file__).with_name("aerobrain_server.py")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class PreviewServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        env = dict(os.environ, AEROBRAIN_PREVIEW_PORT=str(cls.port))
        cls.proc = subprocess.Popen([sys.executable, str(SERVER)], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                urllib.request.urlopen(cls.base + "/api/healthz", timeout=1)
                return
            except OSError:
                time.sleep(0.2)
        cls.proc.kill()
        raise RuntimeError("preview server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()                  # by PID: never pkill by pattern (prod has the same path)
        cls.proc.wait(timeout=10)

    def test_get_works_with_local_dev_access(self):
        with urllib.request.urlopen(self.base + "/api/whoami", timeout=5) as r:
            self.assertIn(b'"dev_mode": true', r.read())

    def test_post_is_refused(self):
        req = urllib.request.Request(self.base + "/api/jobs", data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
