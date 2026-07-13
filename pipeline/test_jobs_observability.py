import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jobs
import aerobrain_server as server


class JobObservabilityStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.old_db = jobs.DB
        self.old_logs = jobs.JOB_LOG_DIR if hasattr(jobs, "JOB_LOG_DIR") else None
        self.old_vault = server.VAULT
        jobs.DB = root / "jobs.db"
        jobs.JOB_LOG_DIR = root / "job_logs"
        server.VAULT = root / "vault"
        jobs.init()
        self.job = jobs.add("analyze", "fixture")

    def tearDown(self):
        jobs.DB = self.old_db
        if self.old_logs is not None:
            jobs.JOB_LOG_DIR = self.old_logs
        server.VAULT = self.old_vault
        self.tmp.cleanup()

    def test_event_round_trip_and_order(self):
        jobs.event(self.job["id"], "attempt", "Ultra -d2",
                   data={"preset": "ultra", "d": 2})
        jobs.event(self.job["id"], "fallback", "Cinematic -d2", level="warning")

        rows = jobs.events(self.job["id"])
        self.assertEqual(["started", "attempt", "fallback"], [row["event"] for row in rows])
        self.assertEqual(2, rows[1]["data"]["d"])
        self.assertEqual("warning", rows[2]["level"])

    def test_log_chunk_is_bounded_and_cursor_based(self):
        path = jobs.log_path(self.job["id"])
        path.write_text("a\nb\nc\n")

        chunk = jobs.log_chunk(self.job["id"], after=1, limit=1)

        self.assertEqual(["b"], chunk["lines"])
        self.assertEqual(2, chunk["next"])
        self.assertFalse(chunk["eof"])

    def test_log_path_rejects_traversal(self):
        with self.assertRaises(ValueError):
            jobs.log_path("../../manifest/jobs.db")

    def test_run_tracked_keeps_full_log_but_small_sqlite_tail(self):
        cmd = [sys.executable, "-c", "[print(f'line-{i}') for i in range(20)]"]

        rc = jobs.run_tracked(self.job["id"], cmd, timeout=10, tail=3)

        self.assertEqual(0, rc)
        self.assertEqual(3, len((jobs.get(self.job["id"])["log"] or "").splitlines()))
        full = jobs.log_path(self.job["id"]).read_text()
        self.assertIn("line-0", full)
        self.assertIn("line-19", full)
        self.assertGreaterEqual(len(full.splitlines()), 20)

    def test_job_summary_exposes_requested_and_effective_without_raw_spec(self):
        jid = "3d-truth-fixture"
        spec = {"clip_id": "recon_fixture", "preset": "alta",
                "sources": ["A", "B"], "photos": ["p.jpg"]}
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,finished,spec,log) "
                         "VALUES (?,?,?,?,?,?,?,?,?)",
                         (jid, "3d", "recon_fixture", "done", "listo", 1, 2,
                          json.dumps(spec), "full tail"))
        model = server.VAULT / "models" / "recon_fixture"
        model.mkdir(parents=True)
        (model / "meta.json").write_text(json.dumps({
            "preset": "alta",
            "dense_quality_requested": "high",
            "dense_quality": "medium",
            "dense_fallback": True,
            "pipeline_mode": "ortho_25d_fallback",
            "qa": {"cameras_reconstructed": 238, "cameras_total": 238},
            "reconstruction": {"requested_preset": "alta", "effective_preset": "alta",
                               "merge_label": "FULL"},
        }))

        summary = server.normalize_job_summary(jobs.get(jid))

        self.assertNotIn("spec", summary)
        self.assertNotIn("log", summary)
        self.assertEqual("alta", summary["requested_preset"])
        self.assertEqual("alta", summary["effective_preset"])
        self.assertEqual("high", summary["dense_quality_requested"])
        self.assertEqual("medium", summary["dense_quality"])
        self.assertEqual("completed_with_fallback", summary["outcome"])
        self.assertEqual(2, summary["source_count"])
        self.assertEqual(238, summary["cameras_registered"])

    def test_old_job_does_not_inherit_newer_mutable_model_metadata(self):
        for jid, preset, started in (("3d-old", "extra", 1), ("3d-new", "alta", 3)):
            with jobs._LOCK, jobs._conn() as conn:
                conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,finished,spec) "
                             "VALUES (?,?,?,?,?,?,?,?)",
                             (jid, "3d", "shared-model", "done", "listo", started, started + 1,
                              json.dumps({"clip_id": "shared-model", "preset": preset})))
        model = server.VAULT / "models" / "shared-model"
        model.mkdir(parents=True)
        (model / "meta.json").write_text(json.dumps({
            "preset": "alta", "pipeline_mode": "ortho_25d_fallback",
            "qa": {"cameras_reconstructed": 200, "cameras_total": 200},
            "reconstruction": {"requested_preset": "alta", "effective_preset": "alta"},
        }))

        latest = jobs.latest_done_ids(("3d",))
        old = server.normalize_job_summary(jobs.get("3d-old"), latest)
        new = server.normalize_job_summary(jobs.get("3d-new"), latest)

        self.assertEqual("extra", old["requested_preset"])
        self.assertIsNone(old["effective_preset"])
        self.assertIsNone(old["cameras_registered"])
        self.assertEqual("alta", new["effective_preset"])
        self.assertEqual(200, new["cameras_registered"])


if __name__ == "__main__":
    unittest.main()
