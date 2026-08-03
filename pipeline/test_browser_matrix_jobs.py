import unittest
import json
import tempfile
from pathlib import Path

import browser_matrix


class JobsMatrixRoutingTests(unittest.TestCase):
    def test_jobs_only_matrix_does_not_require_a_published_splat(self):
        self.assertFalse(browser_matrix.requires_splat_asset(["jobs"]))
        self.assertTrue(browser_matrix.requires_splat_asset(["share"]))
        self.assertTrue(browser_matrix.requires_splat_asset(["workspace", "jobs"]))

    def test_job_target_is_selected_by_api_label_not_visible_card_text(self):
        rows = [
            {"id": "other", "kind": "splat", "label": "other-scene"},
            {"id": "frontier", "kind": "splat", "label": "recon_full",
             "status": "running", "requested_iterations": 30000},
        ]

        self.assertEqual(
            "frontier",
            browser_matrix.select_job_target(rows, "recon_full")["id"],
        )

    def test_job_target_rejects_non_splat_rows_with_same_label(self):
        rows = [{"id": "odm", "kind": "3d", "label": "recon_full"}]

        with self.assertRaisesRegex(RuntimeError, "no splat jobs"):
            browser_matrix.select_job_target(rows, "recon_full")

    def test_derived_scene_uses_its_source_training_job_without_inventing_a_duplicate(self):
        with tempfile.TemporaryDirectory() as td:
            previous = browser_matrix.VAULT
            browser_matrix.VAULT = Path(td)
            model = browser_matrix.VAULT / "models" / "recon_crop"
            model.mkdir(parents=True)
            (model / "meta.json").write_text(json.dumps({"derived_from": "recon_full"}))
            try:
                self.assertEqual("recon_full", browser_matrix.job_provenance_cid("recon_crop"))
            finally:
                browser_matrix.VAULT = previous

    def test_normal_scene_keeps_its_own_job_identity(self):
        self.assertEqual("recon_full", browser_matrix.job_provenance_cid("recon_full"))

    def test_clean_job_does_not_inherit_retry_contracts_from_other_cards(self):
        clean = {
            "requested_preset": "grandmaster",
            "attempts": [{"attempt": 1, "d": 1, "rc": 0}],
        }

        self.assertEqual([], browser_matrix.log_contracts_for_job(clean))

    def test_retried_job_requires_its_own_failed_attempt_and_effective_scale(self):
        retried = {
            "requested_preset": "ultra20",
            "attempts": [
                {"attempt": 1, "d": 1, "rc": 1, "failure": "oom"},
                {"attempt": 2, "d": 2, "rc": 0},
            ],
        }

        self.assertEqual(
            ["splat_attempt_failed", "Ultra+ 20K -d 2"],
            browser_matrix.log_contracts_for_job(retried),
        )


if __name__ == "__main__":
    unittest.main()
