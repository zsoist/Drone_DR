"""Server hardening: upload write failures (507), stalled-client timeout, healthz cache,
login limiter ceiling, untrusted-media whitelist, error scrubbing, manifest locks."""
import errno
import http.client
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import time
import unittest
from collections import namedtuple
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server

LOCAL = {"Host": "127.0.0.1:8790", "Sec-Fetch-Site": "same-origin"}
_DU = namedtuple("usage", "total used free")


class ServerCase(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.vault = Path(self._td.name)
        self._patch = mock.patch.object(server, "VAULT", self.vault)
        self._patch.start()
        self.httpd = server.QuietThreadingHTTPServer(("127.0.0.1", 0), server.H)
        self.t = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.t.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.t.join(timeout=2)
        self._patch.stop()
        self._td.cleanup()

    def post_raw(self, path, payload, extra=None):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        h = {**LOCAL, "Content-Length": str(len(payload)), **(extra or {})}
        try:
            c.request("POST", path, body=payload, headers=h)
            r = c.getresponse()
            return r.status, json.loads(r.read() or b"{}")
        finally:
            c.close()


class UploadFailureTests(ServerCase):
    def test_handler_has_inactivity_timeout(self):
        self.assertEqual(60, server.H.timeout)

    def test_low_disk_space_is_507_before_writing(self):
        free = _DU(100, 99, 10 * 1024**2)
        with mock.patch.object(server.shutil, "disk_usage", return_value=free):
            code, body = self.post_raw("/api/audio_upload?name=a.mp3", b"x" * 1024)
        self.assertEqual(507, code)
        self.assertIn("espacio", body["error"])
        self.assertEqual([], list((self.vault / "audio").glob("*.mp3")))

    def test_enospc_mid_write_removes_partial_and_returns_507(self):
        real_open = open
        calls = {"n": 0}

        class Flaky:
            def __init__(self, f):
                self.f = f

            def __enter__(self):
                self.f.__enter__()
                return self

            def __exit__(self, *a):
                return self.f.__exit__(*a)

            def write(self, b):
                calls["n"] += 1
                if calls["n"] > 1:
                    raise OSError(errno.ENOSPC, "No space left on device")
                return self.f.write(b)

        def fake_open(p, mode="r", *a, **k):
            f = real_open(p, mode, *a, **k)
            return Flaky(f) if "w" in mode and "audio" in str(p) else f

        payload = b"x" * (600 * 1024)   # > un chunk de 256 KB → 3 writes
        with mock.patch.object(server, "open", fake_open, create=True):
            code, body = self.post_raw("/api/audio_upload?name=b.mp3", payload)
        self.assertEqual(507, code)
        self.assertNotIn(str(self.vault), json.dumps(body))
        self.assertEqual([], list((self.vault / "audio").glob("*")))

    def test_stalled_client_gets_408_and_partial_removed(self):
        with mock.patch.object(server.H, "timeout", 0.5):
            s = socket.create_connection(("127.0.0.1", self.httpd.server_port), timeout=10)
            try:
                s.sendall(b"POST /api/audio_upload?name=c.mp3 HTTP/1.1\r\nHost: 127.0.0.1:8790\r\n"
                          b"Sec-Fetch-Site: same-origin\r\nContent-Length: 1000000\r\n\r\n" + b"x" * 1000)
                data = s.recv(4096)
            finally:
                s.close()
        self.assertIn(b" 408 ", data.split(b"\r\n")[0])
        self.assertEqual([], list((self.vault / "audio").glob("*")))


class PhotoThumbInputTests(ServerCase):
    def test_bad_width_is_400(self):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        c.request("GET", "/api/photo_thumb?rel=a.jpg&w=abc", headers=LOCAL)
        self.assertEqual(400, c.getresponse().status)
        c.close()


class HealthCacheTests(unittest.TestCase):
    def test_health_status_is_cached_for_ttl(self):
        server._HEALTH_CACHE.update(key=None, at=0.0, value=None)
        with mock.patch.object(server, "_compute_health_status",
                               return_value=({"ok": True, "checks": {}, "ts": "t"}, 200)) as m:
            a = server.health_status()
            b = server.health_status()
            self.assertEqual(a, b)
            self.assertEqual(1, m.call_count)
            server._HEALTH_CACHE["at"] -= server.HEALTH_CACHE_TTL_S + 1
            server.health_status()
            self.assertEqual(2, m.call_count)
        server._HEALTH_CACHE.update(key=None, at=0.0, value=None)


class LimiterTests(unittest.TestCase):
    def test_global_ceiling_does_not_lock_operator_but_per_ip_still_does(self):
        lim = server.LoginRateLimiter()
        for i in range(300):
            lim.failure(f"203.0.113.{i % 250}", now=1000)
        self.assertEqual(0, lim.retry_after("198.51.100.9", now=1001))
        for _ in range(5):
            lim.failure("198.51.100.77", now=1000)
        self.assertGreater(lim.retry_after("198.51.100.77", now=1001), 0)


class MediaWhitelistTests(unittest.TestCase):
    def test_format_names(self):
        ok = server.media_format_allowed
        self.assertTrue(ok("mov,mp4,m4a,3gp,3g2,mj2"))
        self.assertTrue(ok("matroska,webm"))
        self.assertTrue(ok("mp3"))
        self.assertFalse(ok("hls"))
        self.assertFalse(ok("concat"))
        self.assertFalse(ok(""))
        self.assertFalse(ok("mov,mp4,hls"))

    def test_ffmpeg_inputs_restrict_protocols(self):
        src = (Path(__file__).parent / "aerobrain_server.py").read_text()
        for line in src.splitlines():
            if '"-i", str(' in line and "FF_PROTOCOLS" not in line and "lavfi" not in line:
                self.fail(f"ffmpeg input without protocol whitelist: {line.strip()}")

    def test_strict_duration_raises_on_zero(self):
        with mock.patch.object(server, "_probe_dur", return_value=0.0):
            with self.assertRaises(RuntimeError):
                server._probe_dur_strict(Path("x.mp4"))
        with mock.patch.object(server, "_probe_dur", return_value=3.2):
            self.assertEqual(3.2, server._probe_dur_strict(Path("x.mp4")))


class MiscHardeningTests(unittest.TestCase):
    def test_scrub_strips_vault_paths(self):
        msg = server._scrub(f"fail {server.VAULT}/raw/x.mp4 and {server.PIPE}/a.py")
        self.assertNotIn(str(server.VAULT), msg)
        self.assertNotIn(str(server.PIPE), msg)
        self.assertIn("vault/raw/x.mp4", msg)

    def test_manifest_lock_is_per_clip_and_stable(self):
        self.assertIs(server._manifest_lock("a"), server._manifest_lock("a"))
        self.assertIsNot(server._manifest_lock("a"), server._manifest_lock("b"))

    def test_token_file_is_created_0600_without_window(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / ".token"
            server._atomic_write_text(p, "secret", mode=0o600)
            self.assertEqual(0o600, stat.S_IMODE(os.stat(p).st_mode))


if __name__ == "__main__":
    unittest.main()
