"""odm_prep photo-set source: raw/<set>/<pass> JPGs keep their own EXIF GPS (no re-geotag), exact
duplicates are dropped, DNG without a JPG twin is skipped with a message, the 1000-image cap and
the GPS rules fail fast, and photo passes mix with video sources under the s<N>_ prefix scheme.
Synthetic JPEGs + exiftool; no ffmpeg, no GPU, no live vault."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import odm_prep
from PIL import Image

HAVE_EXIFTOOL = shutil.which("exiftool") is not None


def make_jpg(path: Path, lat=None, lon=None, model="FC8582", date="2026:03:15 12:15:28",
             seed=0, alt=80.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 48), (seed % 256, (seed * 7) % 256, (seed * 13) % 256)).save(path, "JPEG")
    args = ["exiftool", "-q", "-overwrite_original", f"-Model={model}", f"-DateTimeOriginal={date}"]
    if lat is not None:
        args += [f"-GPSLatitude={abs(lat)}", f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
                 f"-GPSLongitude={abs(lon)}", f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
                 f"-GPSAltitude={alt}", "-GPSAltitudeRef=0"]
    subprocess.run(args + [str(path)], check=True, capture_output=True)


def gps_of(path: Path):
    out = subprocess.run(["exiftool", "-json", "-n", "-GPSLatitude", "-GPSLongitude", str(path)],
                         capture_output=True, text=True, check=True)
    row = json.loads(out.stdout)[0]
    return row.get("GPSLatitude"), row.get("GPSLongitude")


class Base(unittest.TestCase):
    def setUp(self):
        if not HAVE_EXIFTOOL:
            self.skipTest("exiftool no disponible")
        self._td = tempfile.TemporaryDirectory()
        self.vault = Path(self._td.name)
        self._p = mock.patch.object(odm_prep, "VAULT", self.vault)
        self._p.start()
        self.raw = self.vault / "raw"

    def tearDown(self):
        self._p.stop()
        self._td.cleanup()

    def run_main(self, *args):
        with mock.patch.object(sys, "argv", ["odm_prep.py", *args]):
            odm_prep.main()

    def proj(self, pid="recon_test"):
        return self.vault / "odm" / f"proj_{pid}"

    def manifest(self, pid="recon_test"):
        return json.loads((self.proj(pid) / "frames_manifest.json").read_text())

    def fill(self, set_, pass_, n, lat0=4.65, lon0=-74.05, seed0=0, **kw):
        for i in range(n):
            make_jpg(self.raw / set_ / pass_ / f"DJI_20260315121{i % 10}{i:02d}_{i:04d}_D.JPG",
                     lat0 + i * 1e-4, lon0, seed=seed0 + i, **kw)


class RefParsingTests(unittest.TestCase):
    def test_accepts_token_raw_path_and_bare_set(self):
        self.assertEqual(("Casa A", "nadir"), odm_prep.parse_photo_set_ref("set:Casa A/nadir"))
        self.assertEqual(("Casa A", "nadir"), odm_prep.parse_photo_set_ref("raw/Casa A/nadir"))
        self.assertEqual(("Casa A", None), odm_prep.parse_photo_set_ref("Casa A"))

    def test_rejects_traversal_and_bad_names(self):
        for bad in ("set:../etc/x", "set:a/../b", "raw/a/b/c", "set:", "set:a/.", "set:..",
                    "set:uploads/x", "set:a/Uploads", "set: a/b", "set:a\\b/c", "set:a;b/c"):
            with self.assertRaises(SystemExit, msg=bad):
                odm_prep.parse_photo_set_ref(bad)

    def test_validator_matches_the_upload_route_alphabet(self):
        # server.photo_set_label is the upload-side sanitiser: whatever it can produce, we accept
        import aerobrain_server as server
        for raw in ("Casa A", "Edificio 3 — norte", "ñandú-2", "x" * 90, "a.b/c", "uploads", ""):
            label = server.photo_set_label(raw, "")
            self.assertEqual(bool(label), odm_prep.valid_photo_label(label), raw)


class PhotoSetPrepTests(Base):
    def test_photo_only_keeps_exif_gps_and_writes_provenance(self):
        self.fill("Casa A", "nadir", 6)
        self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test", "--profile", "balanced")
        images = sorted(p.name for p in (self.proj() / "images").iterdir())
        self.assertEqual(6, len(images))
        self.assertTrue(all(n.startswith("s0_f_") and n.endswith(".jpg") for n in images), images)
        src = sorted((self.raw / "Casa A" / "nadir").iterdir())[0]
        dst = sorted((self.proj() / "images").iterdir())[0]
        self.assertEqual(gps_of(src), gps_of(dst))                 # EXIF intacto, sin re-geotag
        self.assertIsNotNone(gps_of(dst)[0])
        self.assertFalse((self.proj() / ".geotag.args").read_text().strip())   # nada que geotaggear
        m = self.manifest()
        self.assertEqual(6, m["total_frames"])
        row = m["sources"][0]
        self.assertEqual({"cid": "set:Casa A/nadir", "prefix": "s0_", "frames": 6, "kind": "photo_set"},
                         {k: row[k] for k in ("cid", "prefix", "frames", "kind")})
        self.assertEqual(1.0, row["gps_coverage"])
        self.assertEqual({"FC8582": 6}, row["models"])
        ps = m["photo_sets"][0]
        self.assertEqual("Casa A/nadir/" + src.name, ps["images"][0]["src"])
        self.assertTrue(all(i["gps"] for i in ps["images"]))
        self.assertEqual("2026-03-15T12:15:28", ps["date_min"])

    def test_source_files_are_never_modified(self):
        self.fill("Casa A", "nadir", 3)
        before = {p.name: (p.stat().st_size, p.stat().st_mtime_ns) for p in (self.raw / "Casa A" / "nadir").iterdir()}
        self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        after = {p.name: (p.stat().st_size, p.stat().st_mtime_ns) for p in (self.raw / "Casa A" / "nadir").iterdir()}
        self.assertEqual(before, after)

    def test_whole_set_expands_to_one_source_per_pass(self):
        self.fill("Casa A", "nadir", 5)
        self.fill("Casa A", "orbita", 5, lat0=4.7, seed0=100)
        self.run_main("--photo-set", "raw/Casa A", "--proj-id", "recon_test")
        m = self.manifest()
        self.assertEqual([("set:Casa A/nadir", "s0_"), ("set:Casa A/orbita", "s1_")],
                         [(s["cid"], s["prefix"]) for s in m["sources"]])
        names = [p.name for p in (self.proj() / "images").iterdir()]
        self.assertEqual(5, sum(n.startswith("s0_f_") for n in names))
        self.assertEqual(5, sum(n.startswith("s1_f_") for n in names))

    def test_exact_duplicates_across_passes_dropped_near_neighbours_kept(self):
        self.fill("Casa A", "nadir", 5)
        # misma foto copiada a otra pasada = duplicado exacto
        (self.raw / "Casa A" / "orbita").mkdir(parents=True)
        shutil.copy2(sorted((self.raw / "Casa A" / "nadir").iterdir())[0],
                     self.raw / "Casa A" / "orbita" / "copy.JPG")
        self.fill("Casa A", "orbita", 4, seed0=200)
        self.run_main("--sources", "set:Casa A/nadir,set:Casa A/orbita", "--proj-id", "recon_test")
        m = self.manifest()
        self.assertEqual(9, m["total_frames"])                     # 5 + (4 nuevas + 1 copia - 1 dup)
        dup = m["photo_sets"][1]["duplicates"]
        self.assertEqual(1, len(dup))
        self.assertTrue(dup[0]["same_as"].startswith("Casa A/nadir/"))

    def test_dng_with_jpg_twin_uses_jpg_dng_only_is_skipped_with_message(self):
        self.fill("Casa A", "nadir", 5)
        d = self.raw / "Casa A" / "nadir"
        first = sorted(d.glob("*.JPG"))[0]
        (d / (first.stem + ".dng")).write_bytes(b"II*\x00" + b"\x00" * 100)      # gemelo
        (d / "SOLO_RAW.dng").write_bytes(b"II*\x00" + b"\x00" * 100)              # sin JPG
        with mock.patch("builtins.print") as pr:
            self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertIn("DNG sin JPG gemelo", " ".join(str(c.args[0]) for c in pr.call_args_list))
        ps = self.manifest()["photo_sets"][0]
        self.assertEqual(["SOLO_RAW.dng"], ps["dng_only_skipped"])
        self.assertEqual([first.stem + ".dng"], ps["dng_paired"])
        self.assertEqual(5, self.manifest()["total_frames"])

    def test_dng_only_pass_fails_clearly(self):
        d = self.raw / "Casa A" / "nadir"
        d.mkdir(parents=True)
        (d / "a.dng").write_bytes(b"II*\x00" + b"\x00" * 100)
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertIn("DNG sin JPG gemelo", str(cm.exception))
        self.assertFalse(self.proj().exists() and (self.proj() / "images.new").exists())

    def test_pass_without_any_gps_fails_partial_gps_warns_and_keeps(self):
        d = self.raw / "Casa A" / "nadir"
        for i in range(4):
            make_jpg(d / f"a{i}.JPG", seed=i)                      # sin GPS
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertIn("sin GPS", str(cm.exception))
        for i in range(4, 6):
            make_jpg(d / f"a{i}.JPG", 4.6, -74.0, seed=i)          # 2/6 con GPS = 33%
        with mock.patch("builtins.print") as pr:
            self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertIn("2/6", " ".join(str(c.args[0]) for c in pr.call_args_list))
        row = self.manifest()["sources"][0]
        self.assertEqual((6, 2), (row["count"], row["gps"]))
        self.assertAlmostEqual(0.333, row["gps_coverage"], places=3)

    def test_cap_is_a_clear_error_before_anything_is_written(self):
        self.fill("Casa A", "nadir", 4)
        with mock.patch.object(odm_prep, "PHOTO_SET_MAX_IMAGES", 3):
            with self.assertRaises(SystemExit) as cm:
                self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertIn("máximo 3", str(cm.exception))
        self.assertFalse(self.proj().exists())

    def test_corrupt_jpg_is_skipped_missing_set_and_traversal_fail(self):
        self.fill("Casa A", "nadir", 4)
        (self.raw / "Casa A" / "nadir" / "bad.jpg").write_bytes(b"NOTAJPEG")
        self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        m = self.manifest()
        self.assertEqual(4, m["total_frames"])
        self.assertEqual(["bad.jpg"], m["photo_sets"][0]["invalid_skipped"])
        for bad in ("set:Nope/nadir", "set:../x/y"):
            with self.assertRaises(SystemExit, msg=bad):
                self.run_main("--sources", bad, "--proj-id", "recon_test2")

    def test_symlinked_set_and_symlinked_photo_are_ignored(self):
        self.fill("Real", "nadir", 4)
        (self.raw / "Link").symlink_to(self.raw / "Real")
        with self.assertRaises(SystemExit):
            self.run_main("--sources", "set:Link/nadir", "--proj-id", "recon_test")
        outside = self.vault / "outside.JPG"
        make_jpg(outside, 4.6, -74.0)
        (self.raw / "Real" / "nadir" / "evil.JPG").symlink_to(outside)
        self.run_main("--sources", "set:Real/nadir", "--proj-id", "recon_test")
        self.assertEqual(4, self.manifest()["total_frames"])

    def test_photo_only_job_needs_proj_id(self):
        self.fill("Casa A", "nadir", 3)
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--sources", "set:Casa A/nadir")
        self.assertIn("--proj-id", str(cm.exception))

    def test_neo2_photos_select_brown_camera_profile(self):
        self.fill("Casa A", "nadir", 4, model="DJI Neo 2")
        self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        cam = self.manifest()["camera_profile"]
        self.assertIn(cam["profile"], ("neo2", "djineo2"))
        self.assertEqual(["--camera-lens", "brown", "--use-fixed-camera-params"], cam["args"])
        self.assertEqual(["--camera-lens", "brown", "--use-fixed-camera-params"],
                         odm_prep.camera_extra_args(self.proj()))

    def test_flight_camera_photos_get_default_odm(self):
        self.fill("Casa A", "nadir", 4)                            # FC8582 = Flip
        self.run_main("--sources", "set:Casa A/nadir", "--proj-id", "recon_test")
        self.assertEqual([], self.manifest()["camera_profile"]["args"])


class MixedSourceTests(Base):
    def fake_extract(self, tmp_dir, images, src_cid, prefix, profile, fps, width):
        n, args = 6, []
        for i in range(n):
            name = f"{prefix}f_{i + 1:04d}.jpg"
            make_jpg(tmp_dir / name, seed=i + 50)
            args += odm_prep._geotag(images / name, {"lat": 4.6, "lon": -74.0, "abs_alt": 90})
        return args, n

    def test_video_then_photo_pass_share_prefix_scheme(self):
        self.fill("Casa A", "nadir", 5)
        with mock.patch.object(odm_prep, "_extract_source", side_effect=self.fake_extract):
            self.run_main("--sources", "CLIP1,set:Casa A/nadir", "--proj-id", "recon_test",
                          "--profile", "balanced")
        m = self.manifest()
        self.assertEqual([("CLIP1", "s0_"), ("set:Casa A/nadir", "s1_")],
                         [(s["cid"], s["prefix"]) for s in m["sources"]])
        self.assertEqual(11, m["total_frames"])
        names = sorted(p.name for p in (self.proj() / "images").iterdir())
        self.assertEqual(6, sum(n.startswith("s0_f_") for n in names))
        self.assertEqual(5, sum(n.startswith("s1_f_") for n in names))

    def test_photo_set_flag_after_video_sources_continues_the_prefix_index(self):
        self.fill("Casa A", "nadir", 5)
        with mock.patch.object(odm_prep, "_extract_source", side_effect=self.fake_extract):
            self.run_main("--sources", "CLIP1", "--photo-set", "raw/Casa A/nadir",
                          "--proj-id", "recon_test")
        self.assertEqual(["s0_", "s1_"], [s["prefix"] for s in self.manifest()["sources"]])

    def test_worker_preflight_counts_photo_pass_frames_per_source(self):
        # el contrato del worker no se toca: odm_frame_preflight lee prefix del manifest
        import worker
        self.fill("Casa A", "nadir", 6)
        with mock.patch.object(odm_prep, "_extract_source", side_effect=self.fake_extract):
            self.run_main("--sources", "CLIP1,set:Casa A/nadir", "--proj-id", "recon_test")
        pf = worker.odm_frame_preflight(self.proj(), ["CLIP1", "set:Casa A/nadir"])
        self.assertEqual([], pf["sparse_sources"])
        self.assertEqual(6 + 6, pf["total_frames"])

    def test_positional_single_video_compat_still_unprefixed(self):
        with mock.patch.object(odm_prep, "_extract_source", side_effect=self.fake_extract):
            self.run_main("CLIP1", "--profile", "balanced")
        m = json.loads((self.proj("CLIP1") / "frames_manifest.json").read_text())
        self.assertIsNone(m["sources"][0]["prefix"])
        self.assertNotIn("photo_sets", m)


if __name__ == "__main__":
    unittest.main()
