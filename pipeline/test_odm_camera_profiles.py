"""ODM camera profiles: EXIF Model -> extra ODM args (Neo 2 => Brown lens), recorded in
frames_manifest.json and applied on the CUDA lane; every other camera keeps the default."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import odm_gpu_lane
import odm_prep

BROWN = ["--camera-lens", "brown", "--use-fixed-camera-params"]


def _exif(rows):
    return mock.Mock(stdout=json.dumps(rows), returncode=0)


class ProfileSelectionTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual("djineo2", odm_prep.normalize_camera_model(" DJI Neo-2 "))

    def test_neo2_gets_brown_lens_and_fixed_params(self):
        rec = odm_prep.select_camera_profile({"DJI Neo 2": 120})
        self.assertEqual(BROWN, rec["args"])
        self.assertEqual("djineo2", rec["profile"])
        self.assertFalse(rec["verified"])            # the table entry is not from a real file
        self.assertIn("120/120", rec["reason"])

    def test_other_cameras_keep_default(self):
        for models in ({"FC8582": 58}, {}, {"Hasselblad L2D-20c": 3}):
            rec = odm_prep.select_camera_profile(models)
            self.assertEqual([], rec["args"], models)
            self.assertIsNone(rec["profile"])
            self.assertEqual(models, rec["models"])   # still audited so a new Model string is visible

    def test_majority_rule_on_mixed_sets(self):
        self.assertEqual(BROWN, odm_prep.select_camera_profile({"DJI Neo 2": 60, "FC8582": 40})["args"])
        self.assertEqual([], odm_prep.select_camera_profile({"DJI Neo 2": 10, "FC8582": 90})["args"])

    def test_override_and_unknown_override(self):
        self.assertEqual(BROWN, odm_prep.select_camera_profile({"FC8582": 5}, "neo2")["args"])
        with self.assertRaises(SystemExit):
            odm_prep.select_camera_profile({}, "nope")

    def test_profile_table_shape(self):
        for key, prof in odm_prep.CAMERA_PROFILES.items():
            self.assertEqual(key, odm_prep.normalize_camera_model(key))
            self.assertIn("--camera-lens", prof["args"])
            self.assertIn("verified", prof)


class DetectTests(unittest.TestCase):
    def test_counts_models_from_exiftool(self):
        rows = [{"Model": "DJI Neo 2"}, {"Model": "DJI Neo 2"}, {"Model": "FC8582"}, {"SourceFile": "x"}]
        with mock.patch.object(odm_prep.subprocess, "run", return_value=_exif(rows)):
            self.assertEqual({"DJI Neo 2": 2, "FC8582": 1}, odm_prep.detect_camera_models(Path("/x")))

    def test_exiftool_failure_is_empty_not_fatal(self):
        with mock.patch.object(odm_prep.subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual({}, odm_prep.detect_camera_models(Path("/x")))
        with mock.patch.object(odm_prep.subprocess, "run",
                               return_value=mock.Mock(stdout="garbage", returncode=1)):
            self.assertEqual({}, odm_prep.detect_camera_models(Path("/x")))


class MergeArgsTests(unittest.TestCase):
    def test_appends_missing_flags_only(self):
        self.assertEqual(["--pc-quality", "high", *BROWN],
                         odm_prep.merge_odm_args(["--pc-quality", "high"], BROWN))

    def test_preset_wins_and_no_duplicates(self):
        base = ["--camera-lens", "perspective", "--use-fixed-camera-params"]
        self.assertEqual(base, odm_prep.merge_odm_args(base, BROWN))

    def test_empty_extra_is_identity(self):
        self.assertEqual(["--a", "1"], odm_prep.merge_odm_args(["--a", "1"], []))


class ManifestAndLaneTests(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        self.proj = self.root / "proj_x"
        self.proj.mkdir()
        self._p = mock.patch.object(odm_gpu_lane, "CAMERA_ARGS_DIR", self.root / "camera")
        self._p.start()

    def tearDown(self):
        self._p.stop()
        self._td.cleanup()

    def _manifest(self, camera):
        (self.proj / "frames_manifest.json").write_text(json.dumps({"camera_profile": camera}))

    def test_camera_extra_args_reads_manifest_and_tolerates_absence(self):
        self.assertEqual([], odm_prep.camera_extra_args(self.proj))
        self._manifest(odm_prep.select_camera_profile({"DJI Neo 2": 3}))
        self.assertEqual(BROWN, odm_prep.camera_extra_args(self.proj))
        (self.proj / "frames_manifest.json").write_text("{not json")
        self.assertEqual([], odm_prep.camera_extra_args(self.proj))

    def test_default_argv_unchanged_without_profile(self):
        a = odm_gpu_lane.remote_run_argv("job-1", "c", ["--pc-quality", "high"])
        self.assertNotIn("--camera-lens", a[-1])
        self.assertIn("--pc-quality high", a[-1])

    def test_ship_records_and_run_applies_brown(self):
        self._manifest(odm_prep.select_camera_profile({"DJI Neo 2": 3}))
        (self.proj / "images").mkdir()
        (self.proj / "images" / "a.jpg").write_bytes(b"x")
        with mock.patch.object(odm_gpu_lane, "_run"), mock.patch.object(odm_gpu_lane, "_wsl"):
            odm_gpu_lane.ship_images(self.proj, "job-1")
        rec = json.loads((self.root / "camera" / "job-1.json").read_text())
        self.assertEqual(BROWN, rec["args"])
        inner = odm_gpu_lane.remote_run_argv("job-1", "c", ["--pc-quality", "high"])[-1]
        self.assertIn("--camera-lens brown --use-fixed-camera-params", inner)
        self.assertEqual(1, inner.count("--camera-lens"))
        # resume (ship_images no corre): el registro persistido sigue aplicando
        self.assertIn("--camera-lens brown", odm_gpu_lane.remote_run_argv("job-1", "c", [], rerun_from="opensfm")[-1])

    def test_reship_without_profile_clears_stale_record(self):
        self._manifest(odm_prep.select_camera_profile({"DJI Neo 2": 3}))
        odm_gpu_lane.record_camera_args(self.proj, "job-2")
        self._manifest(odm_prep.select_camera_profile({"FC8582": 3}))
        odm_gpu_lane.record_camera_args(self.proj, "job-2")
        self.assertEqual([], odm_gpu_lane.camera_args_for("job-2"))

    def test_invalid_name_is_rejected_on_record_and_ignored_on_read(self):
        with self.assertRaises(ValueError):
            odm_gpu_lane.record_camera_args(self.proj, "../evil")
        self.assertEqual([], odm_gpu_lane.camera_args_for("../evil"))


if __name__ == "__main__":
    unittest.main()
