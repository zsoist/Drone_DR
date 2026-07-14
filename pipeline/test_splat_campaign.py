import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server


class SplatCampaignTests(unittest.TestCase):
    def _model(self, vault: Path, cid: str, *, cameras=20, runs=None):
        mdir = vault / "models" / cid
        mdir.mkdir(parents=True)
        (mdir / "meta.json").write_text(json.dumps({
            "clip_id": cid,
            "qa": {"cameras_reconstructed": cameras},
            "reconstruction": {"splat_runs": runs or []},
        }))
        project = vault / "odm" / f"proj_{cid}" / "opensfm"
        project.mkdir(parents=True)
        (project / "reconstruction.json").write_text("[{}]")
        (project / "image_list.txt").write_text("/datasets/code/images/f1.jpg\n")

    def test_campaign_selects_registered_models_without_target_tier(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            self._model(vault, "A", runs=[{"backend": "NVIDIA CUDA", "target_iters": 15000}])
            self._model(vault, "B", runs=[{"backend": "NVIDIA CUDA", "target_iters": 40000}])
            self._model(vault, "C", cameras=0)

            plan = server.splat_campaign_inventory(
                vault, "grandmaster", pending_fn=lambda kind, cid: cid == "D")

        self.assertEqual(["A"], [row["clip_id"] for row in plan["eligible"]])
        skipped = {row["clip_id"]: row["reason"] for row in plan["skipped"]}
        self.assertEqual("already_at_or_above_target", skipped["B"])
        self.assertEqual("no_registered_cameras", skipped["C"])

    def test_active_site_scope_excludes_non_active_versions_but_keeps_unversioned_models(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            self._model(vault, "ACTIVE")
            self._model(vault, "OLD")
            self._model(vault, "LOOSE")
            sdir = vault / "manifest" / "scenes"
            sdir.mkdir(parents=True)
            (sdir / "scene_fixture.json").write_text(json.dumps({
                "active_version": "ACTIVE",
                "versions": [{"id": "ACTIVE"}, {"id": "OLD"}],
            }))

            plan = server.splat_campaign_inventory(
                vault, "frontier", scope="active_sites", pending_fn=lambda *_: False)

        self.assertEqual(["ACTIVE", "LOOSE"], [row["clip_id"] for row in plan["eligible"]])
        self.assertEqual("inactive_site_version", plan["skipped"][0]["reason"])

    def test_campaign_does_not_retrain_active_asset_while_site_improvement_is_processing(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            self._model(vault, "ACTIVE")
            sdir = vault / "manifest" / "scenes"
            sdir.mkdir(parents=True)
            (sdir / "scene_fixture.json").write_text(json.dumps({
                "active_version": "ACTIVE",
                "versions": [{"id": "ACTIVE", "status": "ready"},
                             {"id": "NEXT", "status": "processing"}],
            }))

            plan = server.splat_campaign_inventory(
                vault, "grandmaster", scope="active_sites", pending_fn=lambda *_: False)

        self.assertEqual([], plan["eligible"])
        self.assertEqual("scene_improvement_in_progress", plan["skipped"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
