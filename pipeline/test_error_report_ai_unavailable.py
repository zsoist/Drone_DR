import json
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import error_report


class AiUnavailableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        now = time.time()
        conn = sqlite3.connect(root / "jobs.db")
        conn.execute("CREATE TABLE jobs (id TEXT, kind TEXT, label TEXT, status TEXT, "
                     "detail TEXT, started REAL, finished REAL, spec TEXT, artifact TEXT)")
        conn.execute("CREATE TABLE job_events (job_id TEXT, ts REAL, level TEXT, "
                     "event TEXT, message TEXT, data TEXT)")
        conn.executemany("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)", [
            ("j1", "splat", "clip-null-started", "done", "ok", None, now, '{"preset":"x"}', ""),
            ("j2", "3d", "clip-ok", "done", "ok", now - 60, now, '{"preset":"x"}', ""),
        ])
        conn.commit()
        conn.close()
        (root / "errors.jsonl").write_text("")
        (root / "watch.log").write_text("")
        self.patches = [
            mock.patch.object(error_report, "JOBS_DB", root / "jobs.db"),
            mock.patch.object(error_report, "ERRLOG", root / "errors.jsonl"),
            mock.patch.object(error_report, "WATCHLOG", root / "watch.log"),
            mock.patch.object(error_report, "REPORTS", root / "reports"),
        ]
        for p in self.patches:
            p.start()
        self.reports = root / "reports"

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_main(self, side_effect):
        with mock.patch.object(error_report, "deepseek", side_effect=side_effect), \
                mock.patch.object(sys, "argv", ["error_report.py", "--days", "1"]):
            error_report.main()
        latest = json.loads((self.reports / "latest.json").read_text())
        return latest, (self.reports / latest["file"]).read_text()

    def test_null_started_does_not_crash_summary(self):
        js = error_report.jobs_summary(1)
        durs = {r["clip"]: r["dur_min"] for r in js["recent_done"]}
        self.assertIsNone(durs["clip-null-started"])
        self.assertEqual(durs["clip-ok"], 1)
        wl = {w["label"]: w["dur_min"] for w in js["latest_workloads"]}
        self.assertIsNone(wl["clip-null-started"])

    def test_deepseek_failure_is_not_reported_as_approved(self):
        latest, text = self.run_main(RuntimeError("HTTP 500"))
        self.assertFalse(latest["ai_valid"])
        self.assertTrue(latest["ai_unavailable"])
        self.assertFalse(latest["ai"])
        self.assertNotIn("APROBADA", text)
        self.assertIn("NO DISPONIBLE", text)
        self.assertIn("AI guardrails=UNAVAILABLE", text)

    def test_success_still_approved(self):
        latest, text = self.run_main(lambda prompt: "Análisis sin contradicciones.")
        self.assertTrue(latest["ai_valid"])
        self.assertFalse(latest["ai_unavailable"])
        self.assertIn("APROBADA", text)


if __name__ == "__main__":
    unittest.main()
