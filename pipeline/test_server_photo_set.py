"""Direct photo-set upload (/api/photo_set_upload): raw/<set>/<pass>/<file> layout shared with the
SD ingest, extension + magic-byte check, sanitised names, size caps, 507, atomic publish."""
import http.client
import json
import sys
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server
from test_server_hardening import LOCAL, ServerCase, _DU

JPEG = b"\xff\xd8\xff\xe1" + b"\x00" * 600
DNG = b"II*\x00" + b"\x08\x00\x00\x00" + b"\x00" * 600
PUBLIC = {"CF-Ray": "t-MIA", "CF-Connecting-IP": "203.0.113.55",
          "X-Forwarded-Proto": "https", "Host": "vuelos.metislab.work"}


class PhotoSetCase(ServerCase):
    def up(self, name, payload, set_="Casa A", pass_="nadir", headers=None):
        qs = urllib.parse.urlencode({"name": name, "set": set_, "pass": pass_})
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        h = {**(headers or LOCAL), "Content-Length": str(len(payload))}
        try:
            c.request("POST", f"/api/photo_set_upload?{qs}", body=payload, headers=h)
            r = c.getresponse()
            return r.status, json.loads(r.read() or b"{}")
        finally:
            c.close()

    def raw_files(self):
        raw = self.vault / "raw"
        return sorted(str(p.relative_to(raw)) for p in raw.rglob("*") if p.is_file()) if raw.exists() else []


class PhotoSetUploadTests(PhotoSetCase):
    def test_route_is_registered(self):
        self.assertEqual("_post_photo_set_upload", server.H._POST_ROUTES["/api/photo_set_upload"])

    def test_jpg_and_dng_land_in_sd_layout_and_are_listed(self):
        code, body = self.up("DJI_20260315121528_0097_D.JPG", JPEG)
        self.assertEqual(200, code, body)
        self.assertEqual("Casa A/nadir/DJI_20260315121528_0097_D.JPG", body["rel"])
        self.assertFalse(body["duplicate"])
        code, body = self.up("DJI_20251128174216_0008_D.dng", DNG)
        self.assertEqual(200, code, body)
        self.assertEqual(["Casa A/nadir/DJI_20251128174216_0008_D.dng",
                          "Casa A/nadir/DJI_20260315121528_0097_D.JPG"], self.raw_files())
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        c.request("GET", "/api/drone_photos", headers=LOCAL)
        r = c.getresponse()
        listed = {p["rel"]: p["kind"] for p in json.loads(r.read())["photos"]}
        c.close()
        self.assertEqual({"Casa A/nadir/DJI_20260315121528_0097_D.JPG": "JPG",
                          "Casa A/nadir/DJI_20251128174216_0008_D.dng": "DNG"}, listed)

    def test_defaults_when_set_and_pass_missing(self):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        c.request("POST", "/api/photo_set_upload?name=a.jpg", body=JPEG,
                  headers={**LOCAL, "Content-Length": str(len(JPEG))})
        self.assertEqual(200, c.getresponse().status)
        c.close()
        self.assertEqual(["Subida directa/fotos/a.jpg"], self.raw_files())

    def test_unauthenticated_is_rejected_and_writes_nothing(self):
        code, _ = self.up("a.jpg", JPEG, headers=PUBLIC)
        self.assertIn(code, (401, 403))
        self.assertEqual([], self.raw_files())

    def test_bad_extension_is_400(self):
        for n in ("a.png", "a.mp4", "a.jpg.exe", "noext", ".jpg"):
            code, body = self.up(n, JPEG)
            self.assertEqual(400, code, n)
        self.assertEqual([], self.raw_files())

    def test_bad_magic_is_400_and_leaves_nothing(self):
        for n, payload in (("a.jpg", b"NOTAJPEG" * 100), ("b.dng", JPEG), ("c.jpeg", DNG),
                           ("d.jpg", b"GIF89a" + b"\x00" * 100)):
            code, body = self.up(n, payload)
            self.assertEqual(400, code, n)
            self.assertIn("válido", body["error"])
        self.assertEqual([], self.raw_files())
        self.assertEqual([], [p.name for p in (self.vault / "raw").rglob("*.part")])

    def test_empty_body_is_400(self):
        code, _ = self.up("a.jpg", b"")
        self.assertEqual(400, code)

    def test_traversal_in_name_set_and_pass_stays_inside_raw(self):
        code, body = self.up("../../../etc/evil.jpg", JPEG, set_="../../../tmp/x", pass_="..\\..\\y")
        self.assertEqual(200, code, body)
        files = self.raw_files()
        self.assertEqual(1, len(files), files)
        self.assertEqual("evil.jpg", Path(files[0]).name)
        self.assertNotIn("..", files[0])
        resolved = (self.vault / "raw" / files[0]).resolve()
        resolved.relative_to((self.vault / "raw").resolve())
        self.assertFalse((self.vault.parent / "etc").exists())
        # nombres sólo-puntos / vacíos no producen un archivo oculto ni un dir raro
        self.assertEqual(400, self.up("....jpg", JPEG)[0])      # sólo puntos → sin extensión
        code, _ = self.up("...a.jpg", JPEG, set_="..", pass_=".")
        self.assertEqual(200, code)
        for f in self.raw_files():
            self.assertFalse(any(seg.startswith(".") for seg in Path(f).parts), f)

    def test_windows_separators_and_weird_chars_are_sanitised(self):
        code, body = self.up("nadir\\IMG 01;rm -rf.JPG", JPEG)
        self.assertEqual(200, code, body)
        self.assertRegex(body["name"], r"^[\w.\-]+$")

    def test_reserved_set_name_falls_back_to_default(self):
        code, body = self.up("a.jpg", JPEG, set_="Uploads")
        self.assertEqual(200, code)
        self.assertEqual("Subida directa", body["set"])
        self.assertFalse((self.vault / "raw" / "uploads").exists())

    def test_oversize_file_is_413_before_writing(self):
        with mock.patch.object(server, "PHOTO_SET_FILE_MAX", 500):
            code, body = self.up("big.jpg", JPEG)
        self.assertEqual(413, code)
        self.assertEqual([], self.raw_files())

    def test_set_total_cap_is_413(self):
        with mock.patch.object(server, "PHOTO_SET_TOTAL_MAX", len(JPEG) + 100):
            self.assertEqual(200, self.up("a.jpg", JPEG)[0])
            code, body = self.up("b.jpg", JPEG)
        self.assertEqual(413, code)
        self.assertIn("superaría", body["error"])
        self.assertEqual(["Casa A/nadir/a.jpg"], self.raw_files())

    def test_set_file_count_cap_is_413(self):
        with mock.patch.object(server, "PHOTO_SET_MAX_FILES", 1):
            self.assertEqual(200, self.up("a.jpg", JPEG)[0])
            self.assertEqual(413, self.up("b.jpg", JPEG)[0])

    def test_low_disk_space_is_507_and_writes_nothing(self):
        free = _DU(100, 99, 10 * 1024**2)
        with mock.patch.object(server.shutil, "disk_usage", return_value=free):
            code, body = self.up("a.jpg", JPEG)
        self.assertEqual(507, code)
        self.assertIn("espacio", body["error"])
        self.assertEqual([], self.raw_files())

    def test_same_name_same_size_is_idempotent_duplicate(self):
        self.assertEqual(200, self.up("a.jpg", JPEG)[0])
        code, body = self.up("a.jpg", JPEG)
        self.assertEqual(200, code)
        self.assertTrue(body["duplicate"])
        self.assertEqual(["Casa A/nadir/a.jpg"], self.raw_files())

    def test_same_name_different_content_never_overwrites(self):
        self.assertEqual(200, self.up("a.jpg", JPEG)[0])
        other = JPEG + b"\x01" * 10
        code, body = self.up("a.jpg", other)
        self.assertEqual(200, code, body)
        self.assertNotEqual("a.jpg", body["name"])
        self.assertEqual(2, len(self.raw_files()))
        self.assertEqual(JPEG, (self.vault / "raw" / "Casa A" / "nadir" / "a.jpg").read_bytes())

    def test_no_temp_files_left_after_success(self):
        self.up("a.jpg", JPEG)
        self.assertEqual([], [p.name for p in (self.vault / "raw").rglob("*") if p.name.endswith(".part")])


class PhotoSetHelperTests(unittest.TestCase):
    def test_filename(self):
        self.assertEqual("DJI_0001.JPG", server.photo_set_filename("DJI_0001.JPG"))
        self.assertEqual("x.jpg", server.photo_set_filename("../../x.jpg"))
        self.assertEqual("", server.photo_set_filename("..."))
        self.assertLessEqual(len(server.photo_set_filename("a" * 500 + ".jpg")), 110)

    def test_label(self):
        self.assertEqual("Casa A", server.photo_set_label("Casa A", "d"))
        self.assertEqual("d", server.photo_set_label("../..", "d"))
        self.assertEqual("d", server.photo_set_label("UPLOADS", "d"))
        self.assertEqual(60, len(server.photo_set_label("x" * 200, "d")))


if __name__ == "__main__":
    unittest.main()
