"""Regression tests for the 2026-09-28 hardening batch (jobs/worker/lanes/scenes/publish)."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import compute_policy  # noqa: E402
import docker_ondemand  # noqa: E402
import gpu_lane  # noqa: E402
import jobs  # noqa: E402
import pc_janitor  # noqa: E402
import perf  # noqa: E402
import scenes  # noqa: E402
import tresd_publish  # noqa: E402
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


class RunTrackedTests(JobsStoreCase):
    def test_invalid_utf8_output_does_not_stall_the_child(self):
        job = jobs.add("analyze", "utf8")
        # 200 KB of invalid bytes (> pipe buffer) and then a normal line: a dead reader
        # would leave the child blocked on write until the timeout.
        script = ("import sys;"
                  "sys.stdout.buffer.write((b'\\xff\\xfe bad\\n') * 20000);"
                  "sys.stdout.buffer.flush();print('fin ok')")
        t0 = time.time()
        rc = jobs.run_tracked(job["id"], [sys.executable, "-c", script], timeout=60)
        self.assertEqual(0, rc)
        self.assertLess(time.time() - t0, 30)
        self.assertIn("fin ok", jobs.log_path(job["id"]).read_text(errors="replace"))


class KillContainerTests(JobsStoreCase):
    def test_remote_container_goes_over_ssh_and_never_touches_local_docker(self):
        with mock.patch.object(jobs.subprocess, "run",
                               return_value=mock.Mock(returncode=0, stderr="")) as run, \
                mock.patch.object(docker_ondemand, "running") as running:
            ok, note = jobs.kill_container("odm-gpu-3d-1", None)
        self.assertTrue(ok)
        cmd = run.call_args[0][0]
        self.assertEqual("ssh", cmd[0])
        self.assertIn("docker kill odm-gpu-3d-1", cmd[-1])
        running.assert_not_called()

    def test_cuda_backend_is_remote_even_without_prefix(self):
        with mock.patch.object(jobs.subprocess, "run",
                               return_value=mock.Mock(returncode=0, stderr="")) as run:
            jobs.kill_container("weird", "NVIDIA CUDA")
        self.assertEqual("ssh", run.call_args[0][0][0])

    def test_local_container_skipped_when_orbstack_is_off(self):
        with mock.patch.object(jobs.subprocess, "run") as run, \
                mock.patch.object(docker_ondemand, "running", return_value=False):
            ok, _ = jobs.kill_container("odm-local", "metal")
        self.assertTrue(ok)
        run.assert_not_called()

    def test_local_container_killed_when_orbstack_is_up(self):
        with mock.patch.object(jobs.subprocess, "run",
                               return_value=mock.Mock(returncode=0, stderr="")) as run, \
                mock.patch.object(docker_ondemand, "running", return_value=True):
            jobs.kill_container("odm-local", None)
        self.assertEqual([docker_ondemand.DOCKER, "kill", "odm-local"], run.call_args[0][0])

    def test_orphan_sweep_uses_remote_kill_for_odm_gpu(self):
        j = jobs.enqueue("3d", "x", {})
        with jobs._conn() as c:
            c.execute("UPDATE jobs SET status='running', pid=NULL, container=? WHERE id=?",
                      ("odm-gpu-abc", j["id"]))
        with mock.patch.object(jobs, "kill_container") as kill:
            jobs.init(orphan_kinds=("3d",))
        kill.assert_called_once()
        self.assertEqual("odm-gpu-abc", kill.call_args[0][0])

    def test_proc_recognizer_accepts_our_remote_ssh_but_not_interactive_ssh(self):
        self.assertTrue(jobs._cmd_is_ours("ssh pc wsl -d Ubuntu -- bash -lc docker run"))
        self.assertTrue(jobs._cmd_is_ours("ssh -o ConnectTimeout=5 pc wsl -d Ubuntu -- bash"))
        self.assertFalse(jobs._cmd_is_ours("ssh user@server"))
        self.assertFalse(jobs._cmd_is_ours("/usr/bin/vim notes.txt"))


class PerfTests(unittest.TestCase):
    def test_remote_containers_do_not_trigger_docker_stats(self):
        class Store:
            def recent(self, n):
                return [{"id": "a", "status": "running", "container": "odm-gpu-x", "kind": "3d"}]
        sampler = perf.PerfSampler(Store())
        with mock.patch.object(perf, "cpu_gpu_snapshot", return_value=(0, 0, [])), \
                mock.patch.object(perf, "mem_swap", return_value=(1, 2, 0, 0)), \
                mock.patch.object(perf, "thermal", return_value=None), \
                mock.patch.object(perf, "docker_stats") as stats:
            sampler._sample()
        stats.assert_not_called()

    def test_local_container_skips_docker_stats_when_vm_is_off(self):
        class Store:
            def recent(self, n):
                return [{"id": "a", "status": "running", "container": "odm-a", "kind": "3d"}]
        sampler = perf.PerfSampler(Store())
        with mock.patch.object(perf, "cpu_gpu_snapshot", return_value=(0, 0, [])), \
                mock.patch.object(perf, "mem_swap", return_value=(1, 2, 0, 0)), \
                mock.patch.object(perf, "thermal", return_value=None), \
                mock.patch.object(perf, "docker_vm_running", return_value=False), \
                mock.patch.object(perf, "docker_stats") as stats:
            sampler._sample()
        stats.assert_not_called()


class DockerOnDemandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.m = mock.patch.object(docker_ondemand, "MARKER", Path(self.tmp.name) / "m")
        self.m.start()
        self.o = mock.patch.object(docker_ondemand, "_orb", return_value="/usr/local/bin/orb")
        self.o.start()

    def tearDown(self):
        self.o.stop()
        self.m.stop()
        self.tmp.cleanup()

    def test_ensure_up_survives_docker_info_timeout(self):
        calls = {"n": 0}

        def fake(cmd, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise subprocess.TimeoutExpired(cmd, 30)
            return mock.Mock(returncode=0, stdout="27.0")
        with mock.patch.object(docker_ondemand, "running", return_value=True), \
                mock.patch.object(docker_ondemand.time, "sleep"), \
                mock.patch.object(docker_ondemand.subprocess, "run", side_effect=fake):
            docker_ondemand.ensure_up(timeout_s=60)
        self.assertEqual(2, calls["n"])

    def test_stop_if_idle_aborts_when_used_during_docker_ps(self):
        docker_ondemand.touch()
        old = time.time() - docker_ondemand.IDLE_STOP_S - 50
        os.utime(docker_ondemand.MARKER, (old, old))
        calls = []

        def fake(cmd, **kw):
            calls.append(cmd)
            if cmd[:2] == [docker_ondemand.DOCKER, "ps"]:
                docker_ondemand.touch()           # a server thread called ensure_up meanwhile
            return mock.Mock(returncode=0, stdout="")
        with mock.patch.object(docker_ondemand, "running", return_value=True), \
                mock.patch.object(docker_ondemand.subprocess, "run", side_effect=fake):
            self.assertFalse(docker_ondemand.stop_if_idle(0))
        self.assertNotIn(["/usr/local/bin/orb", "stop"], calls)

    def test_release_stops_immediately_when_no_container_and_mark_unchanged(self):
        docker_ondemand.touch()
        mark = docker_ondemand.last_use()
        calls = []

        def fake(cmd, **kw):
            calls.append(cmd)
            return mock.Mock(returncode=0, stdout="")
        with mock.patch.object(docker_ondemand, "running", side_effect=[True, False]), \
                mock.patch.object(docker_ondemand.subprocess, "run", side_effect=fake):
            self.assertTrue(docker_ondemand.release(expected_mark=mark))
        self.assertIn(["/usr/local/bin/orb", "stop"], calls)

    def test_lease_blocks_stop_and_release_until_session_ends(self):
        old = time.time() - docker_ondemand.IDLE_STOP_S - 50
        docker_ondemand.touch()
        os.utime(docker_ondemand.MARKER, (old, old))
        calls = []
        with mock.patch.object(docker_ondemand, "ensure_up"), \
                mock.patch.object(docker_ondemand, "running", return_value=True), \
                mock.patch.object(docker_ondemand.subprocess, "run",
                                  side_effect=lambda cmd, **kw: calls.append(cmd) or
                                  mock.Mock(returncode=0, stdout="")):
            with docker_ondemand.session():
                self.assertEqual(1, len(docker_ondemand.active_leases()))
                os.utime(docker_ondemand.MARKER, (old, old))   # marca vieja: sin lease pararía
                self.assertFalse(docker_ondemand.stop_if_idle(0))
                self.assertFalse(docker_ondemand.release())
            self.assertEqual([], docker_ondemand.active_leases())
            self.assertNotIn(["/usr/local/bin/orb", "stop"], calls)

    def test_lease_removed_even_when_the_step_fails(self):
        with mock.patch.object(docker_ondemand, "ensure_up"):
            with self.assertRaises(RuntimeError):
                with docker_ondemand.session():
                    raise RuntimeError("docker step failed")
        self.assertEqual([], docker_ondemand.active_leases())

    def test_stale_and_dead_pid_leases_are_ignored(self):
        d = docker_ondemand.MARKER.parent
        stale = d / f"docker-lease-{os.getpid()}-old"
        stale.touch()
        os.utime(stale, (time.time() - docker_ondemand.LEASE_MAX_AGE_S - 60,) * 2)
        dead = d / "docker-lease-999999999-dead"
        dead.touch()
        self.assertEqual([], docker_ondemand.active_leases())
        live = d / f"docker-lease-{os.getpid()}-live"
        live.touch()
        self.assertEqual([live], docker_ondemand.active_leases())

    def test_release_respects_a_container_or_a_foreign_touch(self):
        docker_ondemand.touch()
        mark = docker_ondemand.last_use()
        with mock.patch.object(docker_ondemand, "running", return_value=True), \
                mock.patch.object(docker_ondemand.subprocess, "run",
                                  return_value=mock.Mock(returncode=0, stdout="abc123\n")) as run:
            self.assertFalse(docker_ondemand.release(expected_mark=mark))
        self.assertNotIn(["/usr/local/bin/orb", "stop"], [c[0][0] for c in run.call_args_list])
        os.utime(docker_ondemand.MARKER, (mark + 5, mark + 5))
        with mock.patch.object(docker_ondemand, "running", return_value=True), \
                mock.patch.object(docker_ondemand.subprocess, "run") as run:
            self.assertFalse(docker_ondemand.release(expected_mark=mark))
        run.assert_not_called()


class PcJanitorProtectTests(unittest.TestCase):
    NOW = 2_000_000_000.0

    def test_resume_inputs_of_an_old_terminal_job_are_protected(self):
        ckpt = pc_janitor.Entry("/root/gpu-jobs/checkpoints/splat-1-abcdef", self.NOW - 90 * 86400)
        odm = pc_janitor.Entry("/root/gpu-jobs/odm/3d-2-bbbbbb", self.NOW - 90 * 86400)
        other = pc_janitor.Entry("/root/gpu-jobs/odm/3d-3-cccccc", self.NOW - 90 * 86400)
        statuses = {"splat-1-abcdef": "error", "3d-2-bbbbbb": "error", "3d-3-cccccc": "error"}
        self.assertEqual(3, len(pc_janitor.plan([ckpt, odm, other], statuses, self.NOW)))
        got = pc_janitor.plan(
            [ckpt, odm, other], statuses, self.NOW,
            protect=["/root/gpu-jobs/checkpoints/splat-1-abcdef/step-000012000.ckpt",
                     "/root/gpu-jobs/odm/3d-2-bbbbbb"])
        self.assertEqual(["/root/gpu-jobs/odm/3d-3-cccccc"], [e.path for e, _ in got])

    def test_sweep_passes_protect_through(self):
        with mock.patch.object(pc_janitor, "remote_entries", return_value=[]), \
                mock.patch.object(pc_janitor, "mac_statuses", return_value={}), \
                mock.patch.object(pc_janitor, "plan", return_value=[]) as plan:
            pc_janitor.sweep(apply=False, protect=["/x"])
        self.assertEqual(["/x"], plan.call_args.kwargs["protect"])

    def test_worker_collects_protect_paths_from_spec(self):
        spec = {"resume_checkpoint": "/root/gpu-jobs/checkpoints/A/step-000000100.ckpt",
                "resume_config": "/root/gpu-jobs/checkpoints/A/config.yml",
                "odm_remote_resume": "3d-old-1"}
        paths = worker.resume_protect_paths(spec)
        self.assertIn("/root/gpu-jobs/checkpoints/A/config.yml", paths)
        self.assertIn("/root/gpu-jobs/odm/3d-old-1", paths)
        self.assertEqual([], worker.resume_protect_paths({}))


class ComputePolicyNestedSplatTests(unittest.TestCase):
    def test_nested_splat_dict_is_forced_to_strict_cuda(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AEROBRAIN_COMPUTE", None)
            spec = compute_policy.route_odm({
                "preset": "alta",
                "splat": {"clip_id": "c", "backend": "metal", "best_available": True}})
        self.assertEqual("cuda", spec["splat"]["backend"])
        self.assertEqual("strict", spec["splat"]["backend_policy"])
        self.assertFalse(spec["splat"]["best_available"])
        followup = worker.phased_splat_job_spec(spec, "c")
        self.assertEqual("cuda", followup["backend"])

    def test_run_splat_routes_spec_through_policy(self):
        j = {"id": "s1", "spec": {"clip_id": "nope", "backend": "metal"}}
        returned = []
        real = compute_policy.route_splat

        def spy(raw):
            returned.append(real(raw))
            return returned[-1]
        with mock.patch.object(worker, "VAULT", Path(tempfile.mkdtemp())), \
                mock.patch.object(compute_policy, "route_splat", side_effect=spy) as route:
            with self.assertRaisesRegex(RuntimeError, "primero procesa el vuelo en 3D"):
                worker.run_splat(j)
        route.assert_called_once()
        routed = returned[0]
        self.assertEqual("cuda", routed["backend"])
        self.assertEqual("strict", routed["backend_policy"])
        self.assertFalse(routed["best_available"])
        self.assertEqual("nope", routed["clip_id"])
        self.assertIs(routed, j["spec"])           # el spec que sigue usando el job ES el ruteado


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


class ScenesConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = scenes.SCENES_DIR
        scenes.SCENES_DIR = Path(self.tmp.name)

    def tearDown(self):
        scenes.SCENES_DIR = self.old
        self.tmp.cleanup()

    def test_same_source_set_in_another_order_is_the_same_version(self):
        sc = scenes.create_scene("Casa", {"lat": 1, "lon": 2}, ["A", "B"], [])
        first = scenes.add_version(sc["id"], "recon_1", ["A", "B"], ["p1", "p2"])
        again = scenes.add_version(sc["id"], "recon_1", ["B", "A"], ["p2", "p1"])
        self.assertEqual(first["id"], again["id"])
        with self.assertRaises(ValueError):
            scenes.add_version(sc["id"], "recon_1", ["A"], [])

    def test_write_uses_unique_tmp_and_leaves_no_debris(self):
        sc = scenes.create_scene("Casa", {"lat": 1, "lon": 2}, ["A"], [])
        names = {p.name for p in Path(self.tmp.name).iterdir()}
        self.assertEqual({f"{sc['id']}.json", ".scenes.lock"}, names)

    def test_lock_is_reentrant_and_serializes_processes(self):
        with scenes._LOCK:
            with scenes._LOCK:
                pass
        code = ("import sys, fcntl, os;"
                "fd=os.open(sys.argv[1], os.O_RDWR);"
                "\ntry:\n fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB); print('free')\n"
                "except BlockingIOError:\n print('held')")
        lock = str(Path(self.tmp.name) / ".scenes.lock")
        with scenes._LOCK:
            held = subprocess.run([sys.executable, "-c", code, lock],
                                  capture_output=True, text=True).stdout.strip()
        free = subprocess.run([sys.executable, "-c", code, lock],
                              capture_output=True, text=True).stdout.strip()
        self.assertEqual(("held", "free"), (held, free))


class GpuLaneTests(unittest.TestCase):
    def test_rc137_is_oom_class_unless_cancelled(self):
        self.assertEqual("oom", gpu_lane.classify_cuda_failure(137, "Killed"))
        self.assertEqual("oom", gpu_lane.classify_cuda_failure(
            137, "Out of memory: Killed process 123 (python)"))
        self.assertEqual("oom", gpu_lane.classify_cuda_failure(137, "oom-kill:constraint=..."))
        # sin evidencia: kill manual / WSL shutdown / kill_container → no reintentable
        self.assertEqual("killed", gpu_lane.classify_cuda_failure(137, ""))
        self.assertEqual("killed", gpu_lane.classify_cuda_failure(137, "step 300/4000"))
        self.assertFalse(gpu_lane.should_retry_cuda("killed", "auto", 1))
        self.assertEqual("cancelled", gpu_lane.classify_cuda_failure(137, "cancelled by user"))
        self.assertTrue(gpu_lane.should_retry_cuda("oom", "auto", 1))

    def test_ensure_awake_resends_wol_and_uses_longer_window(self):
        clock = {"t": 1000.0}
        wakes = []

        def fake_run(cmd, **kw):
            wakes.append(clock["t"])
            return mock.Mock(returncode=0)

        def sleep(s):
            clock["t"] += s
        awake_at = 1000.0 + 47
        with mock.patch.object(gpu_lane.time, "time", side_effect=lambda: clock["t"]), \
                mock.patch.object(gpu_lane.time, "sleep", side_effect=sleep), \
                mock.patch.object(gpu_lane, "node_awake",
                                  side_effect=lambda *a, **k: clock["t"] >= awake_at), \
                mock.patch.object(gpu_lane, "PC_WAKE", mock.Mock(exists=lambda: True)), \
                mock.patch.object(gpu_lane.subprocess, "run", side_effect=fake_run):
            gpu_lane.ensure_awake()
        self.assertGreaterEqual(len(wakes), 3)          # t=0, ~20, ~40
        import inspect
        self.assertGreaterEqual(inspect.signature(gpu_lane.ensure_awake).parameters[
            "max_wait_s"].default, 180)

    def test_fetch_reads_only_the_header(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)

            def fake_run(cmd, timeout, label):
                (out / "job.ply").write_bytes(b"ply\nformat binary" + b"\0" * 1000)
            with mock.patch.object(gpu_lane, "_run", side_effect=fake_run), \
                    mock.patch.object(gpu_lane, "_wsl"), \
                    mock.patch.object(gpu_lane.subprocess, "run"), \
                    mock.patch.object(Path, "read_bytes",
                                      side_effect=AssertionError("read_bytes loads the whole PLY")):
                dest = gpu_lane.fetch("job", out)
            self.assertTrue(dest.exists())


class ProcessExitCodeTests(unittest.TestCase):
    def test_failed_clip_yields_nonzero_exit_but_processes_the_rest(self):
        import process
        seen = []

        def fake(p):
            seen.append(p.name)
            if p.name == "bad.mp4":
                raise subprocess.CalledProcessError(1, "ffmpeg")
        with mock.patch.object(process, "process_clip", side_effect=fake), \
                mock.patch.object(sys, "argv", ["process.py", "/x/bad.mp4", "/x/ok.mp4"]):
            self.assertEqual(1, process.main())
        self.assertEqual(["bad.mp4", "ok.mp4"], seen)
        with mock.patch.object(process, "process_clip"), \
                mock.patch.object(sys, "argv", ["process.py", "/x/ok.mp4"]):
            self.assertEqual(0, process.main())


class AnalyzeSamplingTests(unittest.TestCase):
    def test_sample_covers_the_whole_clip(self):
        import analyze
        frames = list(range(100))
        sample, spacing = analyze.sample_frames(frames, 8)
        self.assertEqual(8, len(sample))
        self.assertEqual(0, sample[0])
        self.assertEqual(99, sample[-1])
        self.assertEqual(sorted(set(sample)), sample)
        self.assertEqual(28, spacing)                    # ~ (99/7) frames * 2 s
        short, sp = analyze.sample_frames([1, 2, 3], 8)
        self.assertEqual(([1, 2, 3], 2), (short, sp))

    def test_all_flag_skips_every_analysed_clip_except_trips_index(self):
        import analyze
        with tempfile.TemporaryDirectory() as td:
            v = Path(td)
            (v / "ai").mkdir()
            for n in ("DJI_1.json", "UP_2.json", "trips.json"):
                (v / "ai" / n).write_text("{}")
            for cid in ("DJI_1", "UP_2", "UP_3", "trips"):
                (v / "frames" / cid).mkdir(parents=True)
            done_calls = []
            with mock.patch.object(analyze, "VAULT", v), \
                    mock.patch.object(analyze, "load_keys", return_value={}), \
                    mock.patch.object(analyze, "analyze_clip",
                                      side_effect=lambda cid, keys: done_calls.append(cid)), \
                    mock.patch.object(sys, "argv", ["analyze.py", "--all"]):
                analyze.main()
        self.assertEqual(["UP_3", "trips"], done_calls)


class TresdPublishTests(unittest.TestCase):
    def test_purge_removes_stale_dsm_derivatives_only(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            for n in ("dsm_lod.json", "dsm_lod256.bin", "dsm_lod512.mask.bin", "scene.v2.json",
                      "site.lod.json", "meta.json", "ortho.webp", "collision.bin"):
                (out / n).write_text("x")
            removed = tresd_publish.purge_stale_dsm_derived(out)
            self.assertEqual({"dsm_lod.json", "dsm_lod256.bin", "dsm_lod512.mask.bin",
                              "scene.v2.json", "site.lod.json"}, set(removed))
            self.assertTrue((out / "meta.json").exists())
            self.assertTrue((out / "collision.bin").exists())

    def test_model_swap_keeps_old_model_until_new_is_ready(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "model").mkdir()
            (out / "model" / "old.jpg").write_text("old")
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            # before the swap the previous model is untouched
            self.assertTrue((out / "model" / "old.jpg").exists())
            tresd_publish.swap_model_dir(new, out / "model")
            self.assertEqual(["new.jpg"], [p.name for p in (out / "model").iterdir()])
            self.assertFalse((out / ".model.old").exists())

    def test_model_swap_recovers_when_only_the_old_copy_survived(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            old = out / ".model.old"
            old.mkdir()
            (old / "good.jpg").write_text("good")      # crash entre rename(final→old) y rename(new→final)
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            with mock.patch.object(Path, "rename", autospec=True,
                                   side_effect=lambda self, tgt, _r=Path.rename:
                                   (_ for _ in ()).throw(OSError("boom")) if self.name == ".model.new"
                                   else _r(self, tgt)):
                with self.assertRaises(OSError):
                    tresd_publish.swap_model_dir(new, out / "model")
            # la única copia buena NO se borró: quedó restaurada como model/
            self.assertEqual("good", (out / "model" / "good.jpg").read_text())

    def test_model_swap_rolls_back_when_the_new_rename_fails(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "model").mkdir()
            (out / "model" / "old.jpg").write_text("old")
            new = out / ".model.new"
            new.mkdir()
            (new / "new.jpg").write_text("new")
            with mock.patch.object(Path, "rename", autospec=True,
                                   side_effect=lambda self, tgt, _r=Path.rename:
                                   (_ for _ in ()).throw(OSError("boom")) if self.name == ".model.new"
                                   else _r(self, tgt)):
                with self.assertRaises(OSError):
                    tresd_publish.swap_model_dir(new, out / "model")
            self.assertEqual(["old.jpg"], [p.name for p in (out / "model").iterdir()])

    def test_tiles_timeout_does_not_abort_publish(self):
        with tempfile.TemporaryDirectory() as td:
            proj, out = Path(td) / "proj", Path(td) / "out"
            proj.mkdir()
            (out / "tiles").mkdir(parents=True)
            (out / "tiles" / "stale.png").write_text("x")   # tiles de la corrida anterior
            for exc in (subprocess.TimeoutExpired("docker", 1800), RuntimeError("gdal2tiles"),
                        OSError("disk")):
                with mock.patch.object(tresd_publish, "sh_in_odm", side_effect=exc):
                    self.assertEqual({}, tresd_publish.build_tiles(proj, out))
            self.assertFalse((out / "tiles").exists())      # obsoletos fuera


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
