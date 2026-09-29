"""docker_ondemand.py: OrbStack on demand, leases and idle stop."""
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

import docker_ondemand  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
