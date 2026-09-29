"""jobs.py run_tracked / container kill / orphan sweep, and perf sampling of containers."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import docker_ondemand  # noqa: E402
import jobs  # noqa: E402
import perf  # noqa: E402


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


class OrphanKillOutsideTransactionTests(unittest.TestCase):
    def test_kill_container_runs_after_the_db_commit(self):
        with tempfile.TemporaryDirectory() as td:
            old = jobs.DB, jobs.JOB_LOG_DIR
            jobs.DB, jobs.JOB_LOG_DIR = Path(td) / "j.db", Path(td) / "logs"
            try:
                jobs.init()
                j = jobs.enqueue("3d", "x", {})
                with jobs._conn() as c:
                    c.execute("UPDATE jobs SET status='running', pid=NULL, container='odm-gpu-z' "
                              "WHERE id=?", (j["id"],))
                seen = {}

                def fake_kill(name, backend=None):
                    # otra conexión debe poder ESCRIBIR: la transacción de init ya cerró
                    with jobs._conn() as c2:
                        c2.execute("UPDATE jobs SET label='free' WHERE id=?", (j["id"],))
                    seen["ok"] = True
                    return True, ""
                with mock.patch.object(jobs, "kill_container", side_effect=fake_kill):
                    jobs.init(orphan_kinds=("3d",))
                self.assertTrue(seen.get("ok"))
                self.assertEqual("error", jobs.get(j["id"])["status"])
            finally:
                jobs.DB, jobs.JOB_LOG_DIR = old


if __name__ == "__main__":
    unittest.main()
