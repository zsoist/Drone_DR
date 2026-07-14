import unittest

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


if __name__ == "__main__":
    unittest.main()
