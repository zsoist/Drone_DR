"""Server media/library fixes: reel claim, photo_thumb streaming, sidecar/order atomicity,
trip_meta migration, atomic writes, probe timeout."""
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server


class Base(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.vault = Path(self._td.name)
        self._patch = mock.patch.object(server, "VAULT", self.vault)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._td.cleanup()

    def http(self, method, path, body=None):
        httpd = server.QuietThreadingHTTPServer(("127.0.0.1", 0), server.H)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=10)
            h = {"Host": "127.0.0.1:8790", "Sec-Fetch-Site": "same-origin"}
            data = None
            if body is not None:
                data = json.dumps(body).encode()
                h["Content-Type"] = "application/json"
                h["Content-Length"] = str(len(data))
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            raw = r.read()
            hdrs = dict(r.getheaders())
            c.close()
            return r.status, hdrs, raw
        finally:
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=2)


class ReelClaimTests(Base):
    def test_claim_creates_hidden_claim_not_zero_byte_reel(self):
        out = server._claim_edit_out(False)
        rdir = self.vault / "reels"
        self.assertFalse(out.exists())
        self.assertTrue((rdir / f".claim-{out.name}").exists())
        out2 = server._claim_edit_out(False)
        self.assertNotEqual(out, out2)
        server._release_edit_claim(out)
        server._release_edit_claim(out2)
        self.assertEqual([], list(rdir.glob(".claim-*")))

    def test_claim_skips_existing_reel_name(self):
        rdir = self.vault / "reels"
        rdir.mkdir(parents=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        with mock.patch.object(server.time, "strftime", return_value=stamp):
            (rdir / f"edit-{stamp}.mp4").write_bytes(b"x")
            out = server._claim_edit_out(False)
        self.assertEqual(f"edit-{stamp}-2.mp4", out.name)

    def test_startup_cleanup_removes_only_stale(self):
        rdir = self.vault / "reels"
        rdir.mkdir(parents=True)
        old = time.time() - 7200
        stale_claim = rdir / ".claim-edit-a.mp4"; stale_claim.write_bytes(b"")
        fresh_claim = rdir / ".claim-edit-b.mp4"; fresh_claim.write_bytes(b"")
        stale_zero = rdir / "edit-a.mp4"; stale_zero.write_bytes(b"")
        fresh_zero = rdir / "edit-b.mp4"; fresh_zero.write_bytes(b"")
        real_old = rdir / "edit-c.mp4"; real_old.write_bytes(b"data")
        for f in (stale_claim, stale_zero, real_old):
            os.utime(f, (old, old))
        server._cleanup_stale_reel_claims()
        self.assertFalse(stale_claim.exists())
        self.assertFalse(stale_zero.exists())
        self.assertTrue(fresh_claim.exists())
        self.assertTrue(fresh_zero.exists())
        self.assertTrue(real_old.exists())

    def test_studio_media_skips_zero_byte_reels(self):
        rdir = self.vault / "reels"
        rdir.mkdir(parents=True)
        (rdir / "edit-zero.mp4").write_bytes(b"")
        (rdir / "edit-ok.mp4").write_bytes(b"abc")
        with mock.patch.object(server, "_reel_meta", return_value={}):
            code, _, raw = self.http("GET", "/api/studio_media")
        self.assertEqual(200, code)
        self.assertEqual(["edit-ok.mp4"], [r["name"] for r in json.loads(raw)["reels"]])


class PhotoThumbTests(Base):
    def test_original_streams_image_and_rejects_non_image(self):
        raw = self.vault / "raw"
        raw.mkdir(parents=True)
        payload = os.urandom(3 * (1 << 20) + 17)
        (raw / "a.dng").write_bytes(payload)
        (raw / "clip.mov").write_bytes(b"0" * 100)
        with mock.patch.object(Path, "read_bytes", side_effect=AssertionError("read_bytes")):
            code, hdrs, body = self.http("GET", "/api/photo_thumb?rel=a.dng&w=0")
            code2, _, _ = self.http("GET", "/api/photo_thumb?rel=clip.mov&w=0")
        self.assertEqual(200, code)
        self.assertEqual(payload, body)
        self.assertEqual("image/x-adobe-dng", hdrs["Content-Type"])
        self.assertEqual(415, code2)


class SidecarOrderTests(Base):
    def test_order_update_and_write_are_atomic_and_locked(self):
        (self.vault / "reels").mkdir(parents=True)
        server._reel_order_write({"a.mp4": 0, "b.mp4": 1})
        server._reel_order_update("a.mp4", "c.mp4")
        of = self.vault / "reels" / ".order.json"
        self.assertEqual({"b.mp4": 1, "c.mp4": 0}, json.loads(of.read_text()))
        self.assertEqual([], [p.name for p in (self.vault / "reels").iterdir() if p.name.endswith(".tmp")])

        def worker(i):
            for k in range(20):
                server._reel_order_write({f"{i}-{k}.mp4": k})
        ts = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertIsInstance(json.loads(of.read_text()), dict)

    def test_reel_order_endpoint_writes_via_helper(self):
        (self.vault / "reels").mkdir(parents=True)
        code, _, _ = self.http("POST", "/api/reel_order", {"names": ["x.mp4", "y.mp4"]})
        self.assertEqual(200, code)
        self.assertEqual({"x.mp4": 0, "y.mp4": 1},
                         json.loads((self.vault / "reels" / ".order.json").read_text()))


class TripMetaTests(Base):
    def _tm(self):
        return json.loads((self.vault / "manifest" / "trips_meta.json").read_text())

    def test_migrate_moves_old_key_and_is_backward_compatible(self):
        (self.vault / "manifest").mkdir(parents=True)
        code, _, raw = self.http("POST", "/api/trip_meta", {"key": "4.70,-74.10", "name": "Casa", "cover": "abc"})
        self.assertEqual(200, code)
        code, _, raw = self.http("POST", "/api/trip_meta",
                                 {"key": "4.71,-74.10", "migrate_from": "4.70,-74.10"})
        self.assertEqual(200, code)
        self.assertEqual({"name": "Casa", "cover": "abc"}, json.loads(raw)["meta"])
        self.assertEqual({"4.71,-74.10": {"name": "Casa", "cover": "abc"}}, self._tm())

    def test_migrate_does_not_overwrite_existing_target_but_drops_old(self):
        (self.vault / "manifest").mkdir(parents=True)
        self.http("POST", "/api/trip_meta", {"key": "1.00,2.00", "name": "Old"})
        self.http("POST", "/api/trip_meta", {"key": "3.00,4.00", "name": "New"})
        code, _, raw = self.http("POST", "/api/trip_meta", {"key": "3.00,4.00", "migrate_from": "1.00,2.00"})
        self.assertEqual({"name": "New"}, json.loads(raw)["meta"])
        self.assertEqual({"3.00,4.00": {"name": "New"}}, self._tm())

    def test_migrate_validates_keys(self):
        (self.vault / "manifest").mkdir(parents=True)
        code, _, _ = self.http("POST", "/api/trip_meta", {"key": "1.00,2.00", "migrate_from": "bad"})
        self.assertEqual(400, code)


class MiscTests(Base):
    def test_atomic_write_text_unique_tmp_and_mode(self):
        p = self.vault / "x.json"
        server._atomic_write_text(p, "hola")
        self.assertEqual("hola", p.read_text())
        self.assertEqual(0o644, p.stat().st_mode & 0o777)
        self.assertEqual(["x.json"], [f.name for f in self.vault.iterdir()])

    def test_probe_dur_timeout_is_zero(self):
        with mock.patch.object(server.subprocess, "run",
                               side_effect=subprocess.TimeoutExpired("ffprobe", 60)):
            self.assertEqual(0.0, server._probe_dur("x.mp4"))


if __name__ == "__main__":
    unittest.main()
