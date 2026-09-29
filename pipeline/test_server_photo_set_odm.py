"""Photo sets as 3D sources: GET /api/photo_sets inventory (counts, GPS coverage, cameras, dates)
and POST /api/odm accepting photo_sets (validated names, real raw/ listing only, recon_<hash>
identity, tokens as sources after the videos). Temp vault, jobs.enqueue mocked: no GPU, no live vault."""
import http.client
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server
from test_odm_photo_set import HAVE_EXIFTOOL, make_jpg
from test_server_hardening import LOCAL, ServerCase

PUBLIC = {"CF-Ray": "t-MIA", "CF-Connecting-IP": "203.0.113.55",
          "X-Forwarded-Proto": "https", "Host": "vuelos.metislab.work"}


class OdmPhotoSetCase(ServerCase):
    def setUp(self):
        if not HAVE_EXIFTOOL:
            self.skipTest("exiftool no disponible")
        super().setUp()
        server._PHOTO_PASS_CACHE.clear()
        self.raw = self.vault / "raw"
        self.enqueued = []
        self._enq = mock.patch.object(server.jobstore, "enqueue",
                                      side_effect=lambda k, l, sp: self.enqueued.append((k, l, sp)) or {"id": "job-1"})
        self._pen = mock.patch.object(server.jobstore, "pending", return_value=False)
        self._enq.start(); self._pen.start()

    def tearDown(self):
        self._enq.stop(); self._pen.stop()
        super().tearDown()

    def fill(self, set_, pass_, n, gps=True, model="FC8582", date="2026:03:15 12:15:28", seed0=0):
        for i in range(n):
            make_jpg(self.raw / set_ / pass_ / f"IMG_{seed0 + i:04d}.JPG",
                     4.65 + i * 1e-4 if gps else None, -74.05, model=model, date=date, seed=seed0 + i)

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=30)
        payload = json.dumps(body).encode() if body is not None else None
        h = {**(headers or LOCAL)}
        if payload is not None:
            h["Content-Length"] = str(len(payload))
            h["Content-Type"] = "application/json"
        try:
            c.request(method, path, body=payload, headers=h)
            r = c.getresponse()
            return r.status, json.loads(r.read() or b"{}")
        finally:
            c.close()

    def clip(self, cid="CLIP1"):
        (self.vault / "manifest").mkdir(exist_ok=True)
        (self.vault / "tracks").mkdir(exist_ok=True)
        (self.vault / "manifest" / f"{cid}.json").write_text(json.dumps({"duration_s": 30}))
        (self.vault / "tracks" / f"{cid}.flight.json").write_text(json.dumps({"points": []}))


class InventoryTests(OdmPhotoSetCase):
    def test_route_lists_counts_gps_models_dates_per_pass_and_set(self):
        self.fill("Casa A", "nadir", 6)
        self.fill("Casa A", "orbita", 4, gps=False, model="DJI Neo 2", date="2026:03:16 09:00:00", seed0=50)
        (self.raw / "Casa A" / "orbita" / "solo.dng").write_bytes(b"II*\x00" + b"\x00" * 50)
        code, body = self.req("GET", "/api/photo_sets")
        self.assertEqual(200, code)
        self.assertEqual(1000, body["max_images"])
        (a,) = body["sets"]
        self.assertEqual(("Casa A", 10, 6), (a["set"], a["count"], a["gps"]))
        self.assertAlmostEqual(0.6, a["gps_coverage"])
        self.assertEqual({"FC8582": 6, "DJI Neo 2": 4}, a["models"])
        self.assertEqual(("2026-03-15T12:15:28", "2026-03-16T09:00:00"), (a["date_min"], a["date_max"]))
        self.assertEqual(1, a["dng_only"])
        nadir, orbita = a["passes"]
        self.assertEqual(("nadir", "set:Casa A/nadir", 6, 1.0), (nadir["pass"], nadir["token"], nadir["count"], nadir["gps_coverage"]))
        self.assertEqual((4, 0.0), (orbita["count"], orbita["gps_coverage"]))

    def test_skips_reserved_dirs_symlinks_and_video_only_sets(self):
        self.fill("Casa A", "nadir", 2)
        (self.raw / "uploads").mkdir(); (self.raw / "uploads" / "UP_1.mp4").write_bytes(b"x")
        (self.raw / "Solo video" / "p").mkdir(parents=True); (self.raw / "Solo video" / "p" / "a.MP4").write_bytes(b"x")
        (self.raw / "Link").symlink_to(self.raw / "Casa A")
        code, body = self.req("GET", "/api/photo_sets")
        self.assertEqual(["Casa A"], [s["set"] for s in body["sets"]])

    def test_empty_vault_and_auth(self):
        self.assertEqual((200, []), (lambda r: (r[0], r[1]["sets"]))(self.req("GET", "/api/photo_sets")))
        code, _ = self.req("GET", "/api/photo_sets", headers=PUBLIC)
        self.assertIn(code, (401, 403))

    def test_exiftool_only_reruns_when_the_pass_changes(self):
        self.fill("Casa A", "nadir", 3)
        real = subprocess.run
        calls = []
        def spy(cmd, *a, **k):
            if cmd and cmd[0] == "exiftool" and "-json" in cmd:
                calls.append(cmd)
            return real(cmd, *a, **k)
        with mock.patch("odm_prep.subprocess.run", side_effect=spy):
            self.req("GET", "/api/photo_sets"); self.req("GET", "/api/photo_sets")
            self.assertEqual(1, len(calls))
            self.fill("Casa A", "nadir", 1, seed0=90)
            self.req("GET", "/api/photo_sets")
        self.assertEqual(2, len(calls))


class PostOdmPhotoSetTests(OdmPhotoSetCase):
    def test_photo_only_job_gets_recon_identity_and_token_sources(self):
        self.fill("Casa A", "nadir", 6); self.fill("Casa A", "orbita", 5, seed0=40)
        code, body = self.req("POST", "/api/odm", {"photo_sets": ["Casa A"], "preset": "alta"})
        self.assertEqual(200, code, body)
        (kind, label, spec), = self.enqueued
        self.assertEqual("3d", kind)
        self.assertRegex(label, r"^recon_[0-9a-f]{10}$")
        self.assertEqual(label, spec["clip_id"])
        self.assertIsNone(spec["primary_cid"])
        self.assertEqual(["set:Casa A/nadir", "set:Casa A/orbita"], spec["sources"])
        self.assertEqual(spec["sources"], spec["photo_sets"])
        self.assertEqual("Casa A", spec["title"])
        self.assertEqual(2, body["photo_sets"])

    def test_single_pass_is_still_a_recon_not_a_bare_id(self):
        self.fill("Casa A", "nadir", 5)
        code, body = self.req("POST", "/api/odm", {"photo_sets": [{"set": "Casa A", "pass": "nadir"}]})
        self.assertEqual(200, code, body)
        self.assertTrue(body["reconstruction"].startswith("recon_"))

    def test_identity_is_deterministic_and_order_independent(self):
        self.fill("A", "p", 5); self.fill("B", "p", 5, seed0=30)
        ids = []
        for order in (["A", "B"], ["B", "A"]):
            _, body = self.req("POST", "/api/odm", {"photo_sets": order})
            ids.append(body["reconstruction"])
        self.assertEqual(ids[0], ids[1])

    def test_mixes_with_video_sources_videos_first_then_tokens(self):
        self.clip("CLIP1"); self.clip("CLIP2"); self.fill("Casa A", "nadir", 5)
        code, body = self.req("POST", "/api/odm", {"clip_id": "CLIP1", "sources": ["CLIP1", "CLIP2"],
                                                    "photo_sets": ["Casa A/nadir"]})
        self.assertEqual(200, code, body)
        spec = self.enqueued[0][2]
        self.assertEqual(["CLIP1", "CLIP2", "set:Casa A/nadir"], spec["sources"])
        self.assertEqual("CLIP1", spec["primary_cid"])
        self.assertTrue(spec["clip_id"].startswith("recon_"))

    def test_video_and_one_photo_pass_is_recon_even_with_single_video(self):
        self.clip("CLIP1"); self.fill("Casa A", "nadir", 5)
        _, body = self.req("POST", "/api/odm", {"clip_id": "CLIP1", "photo_sets": ["Casa A/nadir"]})
        self.assertTrue(body["reconstruction"].startswith("recon_"))

    def test_plain_video_job_unchanged(self):
        self.clip("CLIP1")
        code, body = self.req("POST", "/api/odm", {"clip_id": "CLIP1"})
        self.assertEqual(200, code, body)
        spec = self.enqueued[0][2]
        self.assertEqual(("CLIP1", ["CLIP1"]), (spec["clip_id"], spec["sources"]))
        self.assertNotIn("photo_sets", spec)
        self.assertEqual((404, "clip no encontrado en el vault"),
                         (lambda r: (r[0], r[1]["error"]))(self.req("POST", "/api/odm", {"clip_id": "NOPE"})))

    def test_invalid_traversal_and_missing_sets_are_400_and_enqueue_nothing(self):
        self.fill("Casa A", "nadir", 5)
        for bad in (["../etc"], ["Casa A/../.."], ["set:../x/y"], ["uploads"], ["Nope"],
                    ["Casa A/nope"], ["raw/Casa A/nadir/extra"], [""], [{"set": "A;B"}], [12]):
            code, body = self.req("POST", "/api/odm", {"photo_sets": bad})
            self.assertEqual(400, code, (bad, body))
        self.assertEqual([], self.enqueued)

    def test_set_without_gps_or_dng_only_or_over_cap_is_rejected(self):
        self.fill("Sin GPS", "p", 4, gps=False)
        code, body = self.req("POST", "/api/odm", {"photo_sets": ["Sin GPS"]})
        self.assertEqual(400, code); self.assertIn("sin GPS", body["error"])
        (self.raw / "Solo raw" / "p").mkdir(parents=True)
        (self.raw / "Solo raw" / "p" / "a.dng").write_bytes(b"II*\x00" + b"\x00" * 50)
        code, body = self.req("POST", "/api/odm", {"photo_sets": ["Solo raw"]})
        self.assertEqual(400, code); self.assertIn("DNG", body["error"])
        self.fill("Casa A", "nadir", 4)
        with mock.patch("odm_prep.PHOTO_SET_MAX_IMAGES", 3):
            code, body = self.req("POST", "/api/odm", {"photo_sets": ["Casa A"]})
        self.assertEqual(400, code); self.assertIn("máximo 3", body["error"])
        self.assertEqual([], self.enqueued)

    def test_duplicate_pending_recon_is_409(self):
        self.fill("Casa A", "nadir", 5)
        with mock.patch.object(server.jobstore, "pending", return_value=True):
            code, _ = self.req("POST", "/api/odm", {"photo_sets": ["Casa A"]})
        self.assertEqual(409, code)

    def test_unauthenticated_post_is_rejected(self):
        self.fill("Casa A", "nadir", 5)
        code, _ = self.req("POST", "/api/odm", {"photo_sets": ["Casa A"]}, headers=PUBLIC)
        self.assertIn(code, (401, 403)); self.assertEqual([], self.enqueued)

    def test_token_sources_are_accepted_by_odm_prep_unchanged(self):
        # el mismo token que el server encola es el que odm_prep entiende
        import odm_prep
        self.fill("Casa A", "nadir", 5)
        self.req("POST", "/api/odm", {"photo_sets": ["Casa A"]})
        token = self.enqueued[0][2]["sources"][0]
        self.assertEqual(("Casa A", "nadir"), odm_prep.parse_photo_set_ref(token))


if __name__ == "__main__":
    unittest.main()
