import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

import audit_vault


class AuditVaultFixTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self._tmp.name)
        (self.vault / "models").mkdir()
        (self.vault / "manifest").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _orphan(self, cid, age_s):
        d = self.vault / "models" / cid
        d.mkdir()
        f = d / "partial.tif"
        f.write_text("x")
        t = time.time() - age_s
        for p in (f, d):
            os.utime(p, (t, t))
        return d

    def _jobs(self, rows):
        with sqlite3.connect(self.vault / "manifest" / "jobs.db") as c:
            c.execute("CREATE TABLE jobs (id TEXT, kind TEXT, label TEXT, status TEXT, detail TEXT,"
                      " started REAL, finished REAL, pid INTEGER, container TEXT, artifact TEXT, log TEXT, spec TEXT)")
            for r in rows:
                c.execute("INSERT INTO jobs (id, label, status, artifact, detail, spec) VALUES (?,?,?,?,?,?)", r)

    def _run(self, fix=True):
        return audit_vault.audit(self.vault, fix=fix, rebuild_index=lambda: None)

    def test_old_orphan_is_moved_to_trash_not_deleted(self):
        d = self._orphan("old", 3 * 3600)
        problems, fixed, remaining = self._run()
        self.assertFalse(d.exists())
        self.assertEqual(remaining, [])
        moved = list((self.vault / "trash").glob("audit-*/models/old/partial.tif"))
        self.assertEqual(len(moved), 1)
        self.assertEqual(moved[0].read_text(), "x")

    def test_young_orphan_is_kept_and_reported_as_remaining(self):
        d = self._orphan("young", 60)
        _, fixed, remaining = self._run()
        self.assertTrue(d.exists())
        self.assertEqual(fixed, [])
        self.assertEqual(len(remaining), 1)
        self.assertIn("saltado", remaining[0])

    def test_orphan_with_active_job_is_kept(self):
        d = self._orphan("busy", 5 * 3600)
        self._jobs([("j1", "busy", "running", "", "", "")])
        _, fixed, remaining = self._run()
        self.assertTrue(d.exists())
        self.assertEqual(len(remaining), 1)

    def test_orphan_referenced_only_by_spec_of_queued_job_is_kept(self):
        d = self._orphan("spec_ref", 5 * 3600)
        self._jobs([("j1", "other", "queued", "", "", json.dumps({"clip_id": "spec_ref"}))])
        self._run()
        self.assertTrue(d.exists())

    def test_unreadable_jobs_db_is_treated_as_possibly_active(self):
        d = self._orphan("mystery", 5 * 3600)
        (self.vault / "manifest" / "jobs.db").write_text("not sqlite")
        _, _, remaining = self._run()
        self.assertTrue(d.exists())
        self.assertTrue(remaining)

    def test_without_fix_nothing_moves_and_problems_remain(self):
        d = self._orphan("old", 3 * 3600)
        problems, fixed, remaining = self._run(fix=False)
        self.assertTrue(d.exists())
        self.assertEqual((len(problems), fixed, len(remaining)), (1, [], 1))

    def test_clean_vault_returns_zero_and_unfixable_small_splat_returns_nonzero(self):
        self.assertEqual(audit_vault.main(["--vault", str(self.vault)]), 0)
        (self.vault / "splats").mkdir()
        (self.vault / "splats" / "tiny.splat").write_bytes(b"0" * 10)
        self.assertEqual(audit_vault.main(["--vault", str(self.vault), "--fix"]), 1)

    def test_readonly_audit_leaves_jobs_db_untouched(self):
        self._jobs([("j1", "c", "done", "models/gone/x", "", "")])
        before = (self.vault / "manifest" / "jobs.db").read_bytes()
        problems, _, _ = self._run(fix=False)
        self.assertEqual(len(problems), 1)
        self.assertEqual((self.vault / "manifest" / "jobs.db").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
