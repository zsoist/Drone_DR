import json
import inspect
import sys
import tempfile
import time
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

    def test_run_tracked_accepts_a_line_progress_observer(self):
        self.assertIn("line_progress", inspect.signature(jobs.run_tracked).parameters)

    def test_run_tracked_persists_progress_reported_by_line_observer(self):
        cmd = [sys.executable, "-c", "print('FEATURE_DONE')"]

        rc = jobs.run_tracked(
            self.job["id"], cmd, timeout=10,
            line_progress=lambda line: 0.42 if line == "FEATURE_DONE" else None,
        )

        self.assertEqual(0, rc)
        self.assertEqual(0.42, jobs.get(self.job["id"])["progress"])

    def test_remote_odm_live_phase_reports_tracks_and_reconstruction_truthfully(self):
        tracks = server.odm_live_phase(
            'running "opensfm" create_tracks "/datasets/code/opensfm"\n'
            'Good tracks: 503571', 0.35)
        reconstruct = server.odm_live_phase(
            'Good tracks: 503571\n'
            'running "opensfm" reconstruct "/datasets/code/opensfm"', 0.35)
        reconstruct_after_tail_rotation = server.odm_live_phase(
            'Reconstruction 0: 424 images, 430976 points\n'
            'Attempting merge\nMerging reconstruction 1\n'
            'running opensfm export_geocoords --reconstruction', 0.35)

        self.assertEqual("odm-tracks", tracks["stage"])
        self.assertEqual("construyendo tracks", tracks["label"])
        self.assertGreaterEqual(tracks["progress"], 0.40)
        self.assertEqual("odm-reconstruct", reconstruct["stage"])
        self.assertEqual("reconstruyendo cámaras", reconstruct["label"])
        self.assertGreater(reconstruct["progress"], tracks["progress"])
        self.assertEqual("odm-reconstruct", reconstruct_after_tail_rotation["stage"])
        self.assertEqual("reconstruyendo cámaras",
                         reconstruct_after_tail_rotation["label"])

    def test_remote_odm_live_phase_never_regresses_progress(self):
        phase = server.odm_live_phase("Matching s0_f_0001.jpg and s0_f_0002.jpg", 0.63)

        self.assertEqual(0.63, phase["progress"])

    def test_live_phase_preserves_exact_worker_feature_count(self):
        row = {
            "id": "3d-feature-count", "kind": "3d", "label": "recon_live",
            "status": "running", "stage": "odm-features", "progress": 0.2276,
            "backend": "NVIDIA CUDA",
            "detail": "2/3 ODM ultra en NVIDIA CUDA · extrayendo features 95/1019",
            "started": time.time() - 300,
            "spec": json.dumps({"clip_id": "recon_live", "preset": "ultra",
                                "backend": "cuda"}),
            "log": "Found 10000 points in 11.2s",
        }

        live = server.refresh_running_job(row)

        self.assertEqual("odm-features", live["stage"])
        self.assertEqual(
            "2/3 ODM ultra en NVIDIA CUDA · extrayendo features 95/1019",
            live["detail"],
        )

    def test_depthmap_path_does_not_regress_live_label_to_undistort(self):
        phase = server.odm_live_phase(
            'Finished opensfm stage\nRunning openmvs stage\n'
            'Depthmap resolution set to: 3072px\n'
            'running DensifyPointCloud '
            '/datasets/code/opensfm/undistorted/openmvs/scene.mvs '
            '--cuda-device -1', 0.58)

        self.assertEqual("odm-depthmaps", phase["stage"])
        self.assertEqual("calculando profundidad CUDA", phase["label"])

    def test_splat_live_iteration_telemetry_uses_trainer_columns(self):
        live = server.splat_live_telemetry(
            "Step (% Done)       Train Iter (time)    ETA (time)\n"
            "0 (0.00%)           14 s, 338.214 ms     2 d, 11 h, 44 m, 33 s\n"
            "12340 (41.13%)      52.000 ms            15 m, 18 s", 30000)

        self.assertEqual(12340, live["current_iteration"])
        self.assertEqual(30000, live["target_iterations"])
        self.assertAlmostEqual(41.13, live["iteration_pct"], places=2)
        self.assertAlmostEqual(52.0, live["iteration_time_ms"], places=2)
        self.assertAlmostEqual(19.23, live["iterations_per_second"], places=2)
        self.assertEqual(918, live["eta_remaining_s"])
        self.assertEqual("trainer_live", live["eta_source"])

    def test_running_splat_summary_exposes_exact_step_rate_and_eta(self):
        jid = "splat-live-frontier"
        spec = {"clip_id": "recon_live", "preset": "frontier", "iters": 30000,
                "backend": "cuda", "backend_policy": "strict"}
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,stage,progress,started,spec,log) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (jid, "splat", "recon_live", "running", "entrenando", "train",
                          0.3, time.time() - 60, json.dumps(spec),
                          "12340 (41.13%)      52.000 ms            15 m, 18 s"))

        row = server.refresh_running_job(jobs.get(jid))
        summary = server.normalize_job_summary(row)

        self.assertEqual(12340, summary["current_iteration"])
        self.assertEqual(30000, summary["target_iterations"])
        self.assertAlmostEqual(19.23, summary["iterations_per_second"], places=2)
        self.assertEqual(918, summary["eta_remaining_s"])
        self.assertIn("12,340/30,000", summary["detail"])

    def test_perf_now_uses_same_live_odm_phase_as_jobs_api(self):
        jid = "3d-live-perf-fixture"
        spec = {"clip_id": "recon_live", "preset": "ultra", "backend": "cuda"}
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,stage,progress,started,spec,log) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (jid, "3d", "recon_live", "running",
                          "2/3 ODM ultra en NVIDIA CUDA · comparando imágenes",
                          "odm", 0.35, time.time() - 60, json.dumps(spec),
                          'Good tracks: 503571\n'
                          'running "opensfm" reconstruct "/datasets/code/opensfm"'))
        payload = {
            "now": {"jobs": [{"id": jid, "stage": "odm", "progress": 0.35,
                                "detail": "comparando imágenes", "cpu_pct": 12.0}]},
            "history": [{"jobs": [{"id": jid, "stage": "odm-matching"}]}],
        }

        live = server.live_perf_payload(payload)

        row = live["now"]["jobs"][0]
        self.assertEqual("odm-reconstruct", row["stage"])
        self.assertEqual(0.43, row["progress"])
        self.assertIn("reconstruyendo cámaras", row["detail"])
        self.assertEqual(12.0, row["cpu_pct"])
        self.assertEqual("odm-matching", live["history"][0]["jobs"][0]["stage"])

    def test_future_queue_priority_timestamp_never_reports_negative_elapsed(self):
        jid = "queued-future-fixture"
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,spec) "
                         "VALUES (?,?,?,?,?,?,?)",
                         (jid, "splat", "future", "queued", "en cola",
                          time.time() + 86400, json.dumps({"clip_id": "future"})))

        summary = server.normalize_job_summary(jobs.get(jid))

        self.assertEqual(0.0, summary["elapsed_s"])

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

    def test_splat_summary_keeps_requested_and_effective_cuda_truth_separate(self):
        jid = "splat-frontier-fixture"
        spec = {
            "clip_id": "recon_frontier", "preset": "frontier", "iters": 30000,
            "backend": "cuda", "backend_policy": "strict",
            "resolution": "auto", "requested_downscale": 1,
        }
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,finished,spec,backend) "
                         "VALUES (?,?,?,?,?,?,?,?,?)",
                         (jid, "splat", "recon_frontier", "done", "listo", 1, 2,
                          json.dumps(spec), "NVIDIA CUDA"))
        model = server.VAULT / "models" / "recon_frontier"
        model.mkdir(parents=True)
        (model / "meta.json").write_text(json.dumps({
            "reconstruction": {"splat_runs": [{
                "job_id": jid,
                "requested_preset": "frontier", "effective_preset": "frontier",
                "requested_iterations": 30000, "target_iters": 30000,
                "requested_backend": "cuda", "effective_backend": "NVIDIA CUDA",
                "backend_policy": "strict", "resolution": "auto",
                "requested_downscale": 1, "effective_downscale": 2,
                "effective_resolution": "half", "peak_mib": 7900,
                "image_cache_device": "cpu", "decoded_image_cache_mib": 6409.1,
                "gpu_cache_budget_mib": 818.8,
            }]},
        }))

        summary = server.normalize_job_summary(jobs.get(jid))

        self.assertEqual("frontier", summary["requested_preset"])
        self.assertEqual("frontier", summary["effective_preset"])
        self.assertEqual(30000, summary["requested_iterations"])
        self.assertEqual(30000, summary["iterations"])
        self.assertEqual("cuda", summary["requested_backend"])
        self.assertEqual("NVIDIA CUDA", summary["effective_backend"])
        self.assertEqual("auto", summary["requested_resolution"])
        self.assertEqual(1, summary["requested_downscale"])
        self.assertEqual("half", summary["effective_resolution"])
        self.assertEqual(2, summary["effective_downscale"])
        self.assertEqual("cpu", summary["image_cache_device"])
        self.assertEqual(6409.1, summary["decoded_image_cache_mib"])
        self.assertEqual(818.8, summary["gpu_cache_budget_mib"])

    def test_splat_summary_exposes_recovery_checkpoint_without_remote_path(self):
        jid = "splat-checkpoint-fixture"
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,spec) "
                         "VALUES (?,?,?,?,?,?,?)",
                         (jid, "splat", "recon_checkpoint", "running", "entrenando", 1,
                          json.dumps({"clip_id": "recon_checkpoint", "preset": "frontier"})))
        jobs.event(jid, "cuda_checkpoint", "checkpoint 4000 preservado", data={
            "path": "/root/gpu-jobs/checkpoints/private/step-000004000.ckpt",
            "step": 4000, "bytes": 156211090, "sha256": "abc123",
        })

        summary = server.normalize_job_summary(jobs.get(jid))

        self.assertTrue(summary["resume_available"])
        self.assertEqual(4000, summary["checkpoint_step"])
        self.assertEqual(156211090, summary["checkpoint_bytes"])
        self.assertNotIn("checkpoint_path", summary)
        self.assertNotIn("/root/", json.dumps(summary))

    def test_recovered_done_job_ends_with_recovery_not_historical_traceback(self):
        jid = "splat-recovered-fixture"
        with jobs._LOCK, jobs._conn() as conn:
            conn.execute("INSERT INTO jobs (id,kind,label,status,detail,started,finished,spec,log) "
                         "VALUES (?,?,?,?,?,?,?,?,?)",
                         (jid, "splat", "recon_recovered", "done", "asset listo", 1, 2,
                          json.dumps({"clip_id": "recon_recovered", "preset": "ultra"}),
                          "Traceback: browser gate failed"))
        jobs.event(jid, "error", "browser gate failed", level="error")
        jobs.event(jid, "browser_qa_recovered", "Gate reparado y revalidado")
        jobs.event(jid, "completed", "Ultra 15K CUDA listo", data={"recovered": True})

        summary = server.normalize_job_summary(jobs.get(jid))

        self.assertEqual("Ultra 15K CUDA listo", summary["log_tail"])
        self.assertEqual("completed", summary["last_event"])
        self.assertTrue(summary["recovered"])


if __name__ == "__main__":
    unittest.main()
