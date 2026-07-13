import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import error_report


class ErrorReportCollectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.errlog = root / "errors.jsonl"
        self.watchlog = root / "watchdog.log"
        self.db = root / "jobs.db"
        now = __import__("time").time()
        stamp = __import__("time").strftime("%Y-%m-%dT%H:%M:%S%z")
        rows = [
            {"ts": stamp, "source": "job:3d", "msg": "ODM failed",
             "ctx": {"job": "job-prod", "label": "real-flight"}},
            {"ts": stamp, "source": "job:splat", "msg": "timeout tras 2s",
             "ctx": {"job": "job-smoke", "label": "timeout-test"}},
        ]
        self.errlog.write_text("\n".join(json.dumps(row) for row in rows))
        self.watchlog.write_text("")
        conn = sqlite3.connect(self.db)
        try:
            conn.execute("CREATE TABLE jobs (id TEXT, kind TEXT, label TEXT, status TEXT, "
                         "detail TEXT, started REAL, finished REAL, spec TEXT, artifact TEXT)")
            conn.execute("CREATE TABLE job_events (job_id TEXT, ts REAL, level TEXT, "
                         "event TEXT, message TEXT, data TEXT)")
            conn.executemany("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)", [
                ("job-prod", "3d", "real-flight", "error", "ODM failed", now - 10, now,
                 '{"preset":"alta"}', ""),
                ("job-smoke", "splat", "timeout-test", "error", "timeout tras 2s", now - 2, now,
                 '{"preset":"medium"}', ""),
                ("job-db-only", "3d", "other-flight", "error", "publish failed", now - 5, now,
                 '{"preset":"alta"}', ""),
                ("job-retry-ok", "3d", "other-flight", "done", "published", now, now + 1,
                 '{"preset":"alta"}', ""),
            ])
            conn.commit()
        finally:
            conn.close()
        self.old = error_report.ERRLOG, error_report.WATCHLOG, error_report.JOBS_DB
        error_report.ERRLOG = self.errlog
        error_report.WATCHLOG = self.watchlog
        error_report.JOBS_DB = self.db

    def tearDown(self):
        error_report.ERRLOG, error_report.WATCHLOG, error_report.JOBS_DB = self.old
        self.tmp.cleanup()

    def test_collect_deduplicates_jobstore_errors_and_excludes_smoke_jobs(self):
        items = error_report.collect(1)
        self.assertEqual(["ODM failed", "publish failed"], [item["msg"] for item in items])

    def test_signature_ignores_trailing_punctuation(self):
        self.assertEqual(error_report.signature("client failed."),
                         error_report.signature("client failed"))

    def test_jobs_summary_excludes_smoke_jobs(self):
        summary = error_report.jobs_summary(1)
        self.assertEqual(2, summary["by_kind"]["3d"]["error"]["n"])
        self.assertNotIn("splat", summary["by_kind"])

    def test_jobs_summary_reports_latest_outcome_per_workload(self):
        summary = error_report.jobs_summary(1)
        self.assertEqual({"error": 1, "done": 1}, summary["latest_by_workload"]["3d"])

    def test_efficiency_baseline_matches_verified_mps_medium_runtime(self):
        self.assertIn("medium~2-3min", error_report.EXPECTED_BASELINES)

    def test_ai_rules_forbid_attempt_rate_as_operational_reliability(self):
        self.assertIn("EXCLUSIVAMENTE", error_report.AI_ANALYSIS_RULES)
        self.assertIn("PROHIBIDO", error_report.AI_ANALYSIS_RULES)
        self.assertIn("intentos de tuning", error_report.AI_ANALYSIS_RULES)

    def test_requested_presets_are_distinct_workloads(self):
        now = __import__("time").time()
        conn = sqlite3.connect(self.db)
        try:
            conn.executemany("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)", [
                ("splat-medium", "splat", "same-flight", "done", "Medium listo",
                 now - 20, now - 10, '{"preset":"medium"}', ""),
                ("splat-ultra", "splat", "same-flight", "error", "Ultra OOM",
                 now - 8, now - 2, '{"preset":"ultra"}', ""),
            ])
            conn.commit()
        finally:
            conn.close()
        summary = error_report.jobs_summary(1)
        self.assertEqual({"done": 1, "error": 1}, summary["latest_by_workload"]["splat"])

    def test_legacy_correction_is_separate_from_historical_error(self):
        original, resolution = error_report.split_resolution(
            "browser gate falló · CORRECCIÓN 11-jul: flake del gate; publicación válida")
        self.assertEqual("browser gate falló", original)
        self.assertEqual("11-jul: flake del gate; publicación válida", resolution)

    def test_resolved_historical_error_is_not_counted_as_active_error(self):
        now = __import__("time").time()
        conn = sqlite3.connect(self.db)
        try:
            conn.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)", (
                "resolved-gate", "3d", "resolved-flight", "error",
                "gate falló · CORRECCIÓN hoy: artefacto válido", now - 4, now,
                '{"preset":"estandar"}', ""))
            conn.commit()
        finally:
            conn.close()
        summary = error_report.jobs_summary(1)
        self.assertEqual(1, summary["latest_by_workload"]["3d"]["resolved"])
        self.assertEqual(1, len(summary["resolved_historical_errors"]))

    def test_ai_rules_protect_measured_medium_and_contextualize_large_odm(self):
        self.assertIn("Medium es la línea base medida", error_report.AI_ANALYSIS_RULES)
        self.assertIn("cámaras", error_report.AI_ANALYSIS_RULES)
        self.assertIn("fallback", error_report.AI_ANALYSIS_RULES)
        self.assertIn("label completo", error_report.AI_ANALYSIS_RULES)
        self.assertIn("Wxx", error_report.AI_ANALYSIS_RULES)
        self.assertIn("NO demuestra que el preset solicitado terminó", error_report.AI_ANALYSIS_RULES)
        self.assertIn("RECUPERACIÓN EXITOSA", error_report.AI_ANALYSIS_RULES)
        self.assertIn("PROHIBIDO llamarlo fallo terminal", error_report.AI_ANALYSIS_RULES)
        self.assertIn("Ultra grande en -d2", error_report.CURRENT_POLICY_FACTS)
        self.assertIn("evidencia histórica", error_report.CURRENT_POLICY_FACTS)

    def test_colliding_clip_suffixes_are_explicitly_distinguished(self):
        self.assertEqual("_0101_D", error_report.label_suffix("DJI_20260706133809_0101_D"))
        self.assertEqual("_0101_D", error_report.label_suffix("DJI_20260709145011_0101_D"))

    def test_legacy_iterations_resolve_to_truthful_requested_preset(self):
        self.assertEqual("ultra", error_report.requested_preset({"iters": 15000}))
        self.assertEqual("cinematic", error_report.requested_preset({"iters": 7000}))
        self.assertIsNone(error_report.requested_preset({"iters": 4321}))

    def test_collision_context_names_full_labels_and_refs(self):
        context = error_report.collision_context({
            "label_suffix_collisions": {"_0101_D": ["A_0101_D", "B_0101_D"]},
            "latest_workloads": [
                {"label": "A_0101_D", "workload_ref": "W06"},
                {"label": "B_0101_D", "workload_ref": "W09"},
            ],
        })
        self.assertIn("A_0101_D=W06", context)
        self.assertIn("B_0101_D=W09", context)

    def test_done_fallback_context_cannot_be_misread_as_terminal_failure(self):
        context = error_report.recovered_fallback_context({"latest_workloads": [{
            "workload_ref": "W01", "status": "done",
            "facts": {"requested_preset": "ultra", "effective_preset": "medium",
                      "fallback": True, "attempts": [{"preset": "ultra", "rc": -9},
                                                       {"preset": "medium", "rc": 0}]},
        }]})
        self.assertIn("W01 TERMINAL=done", context)
        self.assertIn("RECUPERACIÓN EXITOSA", context)

    def test_validator_rejects_collision_conflation_and_recovered_failure_claim(self):
        summary = {
            "label_suffix_collisions": {"_0101_D": ["A_0101_D", "B_0101_D"]},
            "latest_workloads": [{"workload_ref": "W01", "status": "done",
                                  "facts": {"fallback": True}}],
        }
        warnings = error_report.validate_ai_analysis(
            "Los tres corresponden al mismo clip `_0101_D`. W01 es un incidente activo.",
            summary)
        self.assertTrue(any("colisión" in warning for warning in warnings))
        self.assertTrue(any("recuperado" in warning for warning in warnings))

    def test_validator_accepts_truthful_recovery_language(self):
        summary = {
            "label_suffix_collisions": {"_0101_D": ["A_0101_D", "B_0101_D"]},
            "latest_workloads": [{"workload_ref": "W01", "status": "done",
                                  "facts": {"fallback": True}}],
        }
        warnings = error_report.validate_ai_analysis(
            "A_0101_D y B_0101_D son vuelos distintos. W01 fue una recuperación exitosa.",
            summary)
        self.assertEqual([], warnings)

    def test_validator_allows_same_full_label_without_treating_suffix_as_collision(self):
        summary = {
            "label_suffix_collisions": {
                "_0101_D": ["DJI_20260706133809_0101_D", "DJI_20260709145011_0101_D"]},
            "latest_workloads": [],
        }
        warnings = error_report.validate_ai_analysis(
            "W10 y W11 son intentos sobre el mismo label `DJI_20260709145011_0101_D`.",
            summary)
        self.assertEqual([], warnings)

    def test_validator_rejects_workload_label_mismatch(self):
        summary = {
            "label_suffix_collisions": {},
            "latest_workloads": [
                {"workload_ref": "W01", "label": "DJI_20260712135736_0117_D",
                 "status": "done", "facts": {"fallback": True}},
                {"workload_ref": "W07", "label": "DJI_20260706133809_0101_D",
                 "status": "error", "facts": {}},
            ],
        }
        warnings = error_report.validate_ai_analysis(
            "| W01 | DJI_20260706133809_0101_D | Ultra → Medium |", summary)
        self.assertTrue(any("label incorrecto" in warning for warning in warnings))

    def test_validator_rejects_multi_ref_label_mismatch_and_same_clip_claim(self):
        summary = {
            "label_suffix_collisions": {},
            "latest_workloads": [
                {"workload_ref": "W01", "label": "A_0117_D", "status": "done",
                 "facts": {"fallback": True}},
                {"workload_ref": "W15", "label": "B_0101_D", "status": "done", "facts": {}},
            ],
        }
        warnings = error_report.validate_ai_analysis(
            "W01 es el mismo clip que W15. Eventos de A_0117_D (W01, W15).", summary)
        self.assertTrue(any("vuelos distintos" in warning for warning in warnings))
        self.assertTrue(any("W15 tiene label incorrecto" in warning for warning in warnings))

    def test_validator_accepts_explicit_negation_of_regression(self):
        summary = {"label_suffix_collisions": {}, "latest_workloads": [
            {"workload_ref": "W01", "label": "A", "status": "done",
             "facts": {"fallback": True}},
        ]}
        warnings = error_report.validate_ai_analysis(
            "W01 no es regresión. W01 no fue un fallo terminal. "
            "Los OOM de W01 no son regresión.", summary)
        self.assertEqual([], warnings)


if __name__ == "__main__":
    unittest.main()
