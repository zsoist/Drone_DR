"""Regressions from the 2026-09-30 World hunt (pipeline side)."""
import base64
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _png(arr):
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(arr.astype("uint8")).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


class GlbGateBlankFrames(unittest.TestCase):
    def test_two_blank_frames_are_no_longer_a_pass(self):
        import glb_gate
        blank = _png(np.full((64, 64, 3), 200))
        res = glb_gate.compare_shots([blank, blank], [blank, blank])
        self.assertEqual(res["ssim_mean"], 1.0)                 # the vacuous part that used to pass
        self.assertLess(res["frame_std_min"], glb_gate.MIN_FRAME_STD)

    def test_textured_frames_clear_the_non_blank_bar(self):
        import glb_gate
        rng = np.random.default_rng(1)
        img = _png(rng.integers(0, 255, (64, 64, 3)))
        res = glb_gate.compare_shots([img], [img])
        self.assertGreaterEqual(res["frame_std_min"], glb_gate.MIN_FRAME_STD)


class SplatAlignmentSurvivesManifestRebuild(unittest.TestCase):
    def test_persisted_transform_is_consumed_by_scene_manifest_contract(self):
        import scene_manifest
        import splat_align
        matrix = [1.0, 0, 0, 5.0, 0, 1.0, 0, 6.0, 0, 0, 1.0, 7.0, 0, 0, 0, 1.0]
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            self.assertTrue(splat_align.persist_world_transform(
                "cid1", {"status": "aligned", "matrix": matrix, "rmse_m": 0.02}, vault=vault))
            meta = json.loads((vault / "splats" / "cid1.meta.json").read_text())
            contract = scene_manifest.splat_transform_contract(meta)
            self.assertEqual(contract["status"], "aligned")
            self.assertEqual(contract["matrix"], matrix)
            self.assertEqual(contract["rmse_m"], 0.02)

    def test_existing_meta_keys_are_preserved(self):
        import splat_align
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            (vault / "splats").mkdir()
            (vault / "splats" / "c.meta.json").write_text(json.dumps({"splats": 123}))
            splat_align.persist_world_transform("c", {"status": "unaligned", "matrix": None}, vault=vault)
            meta = json.loads((vault / "splats" / "c.meta.json").read_text())
            self.assertEqual(meta["splats"], 123)
            self.assertEqual(scene_manifest_status(meta), "unaligned")


def scene_manifest_status(meta):
    import scene_manifest
    return scene_manifest.splat_transform_contract(meta)["status"]


class AuditWorldGeometry(unittest.TestCase):
    def _dir(self, bounds):
        d = tempfile.mkdtemp()
        (Path(d) / "collision.json").write_text(json.dumps({"bounds": bounds}))
        return Path(d)

    def test_legacy_unverified_offset_frame_fails(self):
        import audit_world
        man = {"transforms": {"mesh_offset": [1, 2, 3], "mesh_offset_frame": None}}
        self.assertEqual(audit_world.frame_failure(man, self._dir(None))["reason"],
                         "mesh_offset_frame_unverified")

    def test_collider_floating_away_from_the_dsm_fails(self):
        import audit_world
        man = {"transforms": {"mesh_offset": [1, 2, 3], "mesh_offset_frame": "dsm_center"},
               "world": {"size_m": [300, 300]}}
        far = self._dir([[400, 0, 400], [900, 30, 900]])
        self.assertEqual(audit_world.frame_failure(man, far)["reason"], "collider_outside_world")
        ok = self._dir([[-140, 0, -140], [150, 30, 150]])
        self.assertIsNone(audit_world.frame_failure(man, ok))

    def test_missing_declarations_do_not_invent_failures(self):
        import audit_world
        self.assertIsNone(audit_world.frame_failure({}, self._dir(None)))


if __name__ == "__main__":
    unittest.main()
