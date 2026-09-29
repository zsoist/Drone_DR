"""worker.py: CUDA best-effort cleanup, scene reconcile, transfer sweep, autoclean tmp name."""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import gpu_lane  # noqa: E402
import jobs  # noqa: E402
import scenes  # noqa: E402
import worker  # noqa: E402


class JobsStoreCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.old_db, self.old_logs = jobs.DB, jobs.JOB_LOG_DIR
        jobs.DB = root / "jobs.db"
        jobs.JOB_LOG_DIR = root / "job_logs"
        jobs.init()

    def tearDown(self):
        jobs.DB, jobs.JOB_LOG_DIR = self.old_db, self.old_logs
        self.tmp.cleanup()


class WorkerCudaBestEffortTests(unittest.TestCase):
    def test_success_cleanup_failure_is_swallowed(self):
        lane = mock.Mock()
        lane.cleanup.side_effect = RuntimeError("ssh caído")
        worker._cleanup_success_best_effort(lane, "job-x")      # must not raise
        lane.cleanup.assert_called_once_with("job-x", success=True)

    def test_timeout_during_training_archives_checkpoint_then_reraises(self):
        with tempfile.TemporaryDirectory() as td:
            proj = Path(td) / "proj"
            (proj / "images").mkdir(parents=True)
            stage = Path(td) / "stage"
            stage.mkdir()
            events = []
            with mock.patch.object(gpu_lane, "probe", return_value={
                    "torch": "t", "gsplat": "g", "vram_total_mb": 8000}), \
                    mock.patch.object(gpu_lane, "image_cache_policy",
                                      return_value={"images": 0, "device": "cpu",
                                                    "decoded_mib": 0}), \
                    mock.patch.object(gpu_lane, "with_image_cache_policy", return_value=[]), \
                    mock.patch.object(gpu_lane, "prep_dataset"), \
                    mock.patch.object(gpu_lane, "install_train_script"), \
                    mock.patch.object(gpu_lane, "train_argv", return_value=["true"]), \
                    mock.patch.object(gpu_lane, "cleanup"), \
                    mock.patch.object(gpu_lane, "archive_latest_checkpoint",
                                      return_value={"step": 123, "bytes": 1, "sha256": "x",
                                                    "path": "p"}) as archive, \
                    mock.patch.object(worker.jobstore, "run_tracked",
                                      side_effect=TimeoutError("timeout tras 14400s")), \
                    mock.patch.object(worker.jobstore, "event",
                                      side_effect=lambda *a, **k: events.append(a[1])), \
                    mock.patch.object(worker.jobstore, "update"), \
                    mock.patch("pc_janitor.sweep_best_effort"):
                with self.assertRaises(gpu_lane.CudaLaneError):
                    worker.run_splat_cuda({"id": "splat-1-abcdef", "spec": {}}, proj, "cid",
                                          stage, stage / "o.splat", 100, 1, reuse_dataset=True)
            archive.assert_called_once()
            self.assertIn("cuda_checkpoint", events)


class WorkerSceneReconcileTests(JobsStoreCase):
    def setUp(self):
        super().setUp()
        self.sdir = tempfile.TemporaryDirectory()
        self.old_dir = scenes.SCENES_DIR
        scenes.SCENES_DIR = Path(self.sdir.name)
        self.old_vault = worker.VAULT
        worker.VAULT = Path(self.sdir.name) / "vault"
        (worker.VAULT / "models").mkdir(parents=True)

    def tearDown(self):
        scenes.SCENES_DIR = self.old_dir
        worker.VAULT = self.old_vault
        self.sdir.cleanup()
        super().tearDown()

    def _scene(self, status="processing", job_id=None):
        sc = scenes.create_scene("Casa", {"lat": 4.7, "lon": -74.0}, ["A"], [])
        scenes.add_version(sc["id"], "recon_x", ["A"], [], status)
        if job_id:
            scenes.update_version(sc["id"], "recon_x", job_id=job_id)
        return sc["id"]

    def test_processing_version_of_cancelled_job_becomes_failed(self):
        job = jobs.enqueue("3d", "recon_x", {})
        sid = self._scene(job_id=job["id"])
        self.assertEqual([], worker.reconcile_scene_versions())      # still queued
        jobs.cancel(job["id"])
        self.assertEqual(["recon_x"], worker.reconcile_scene_versions())
        self.assertEqual("failed", scenes.get_scene(sid)["versions"][0]["status"])

    def test_version_without_job_id_is_left_alone(self):
        sid = self._scene()
        self.assertEqual([], worker.reconcile_scene_versions())
        self.assertEqual("processing", scenes.get_scene(sid)["versions"][0]["status"])

    def test_failed_rerun_keeps_a_ready_version_with_intact_model(self):
        sid = self._scene(status="ready")
        meta = worker.VAULT / "models" / "recon_x" / "meta.json"
        meta.parent.mkdir(parents=True)
        meta.write_text("{}")
        started = time.time() + 5                     # model older than the job start
        j = {"id": "3d-9", "spec": {"scene_id": sid, "version_id": "recon_x", "clip_id": "recon_x"}}
        self.assertEqual("kept_ready", worker.mark_scene_version_failed(j, "ready", started))
        self.assertEqual("ready", scenes.get_scene(sid)["versions"][0]["status"])
        # model rewritten during the job -> not intact -> failed
        self.assertEqual("failed", worker.mark_scene_version_failed(j, "ready", started - 60))
        self.assertEqual("failed", scenes.get_scene(sid)["versions"][0]["status"])

    def test_startup_sweeps_orphan_transfer_staging_dirs(self):
        root = Path(self.sdir.name) / "transfer"
        (root / "odm-cuda-abc").mkdir(parents=True)
        (root / "odm-cuda-abc" / "out.tar").write_bytes(b"x")
        (root / "keep").mkdir()
        self.assertEqual(["odm-cuda-abc"], worker.sweep_transfer_tmp(root))
        self.assertFalse((root / "odm-cuda-abc").exists())
        self.assertTrue((root / "keep").exists())


class AutocleanTmpNameTests(unittest.TestCase):
    def test_tmp_output_keeps_a_splat_extension(self):
        seen = {}

        def fake_run(cmd, **kw):
            seen["tmp"] = cmd[3]
            return mock.Mock(returncode=1, stdout="", stderr="boom")
        with tempfile.TemporaryDirectory() as td:
            sp = Path(td) / "scene.splat"
            sp.write_bytes(b"0" * 64)
            with mock.patch.object(worker.subprocess, "run", side_effect=fake_run):
                self.assertFalse(worker.run_autoclean(sp))
        self.assertTrue(seen["tmp"].endswith(".splat"))
        self.assertNotEqual(seen["tmp"], str(sp))


if __name__ == "__main__":
    unittest.main()
