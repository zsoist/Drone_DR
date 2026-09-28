"""PC-only compute policy + on-demand OrbStack (operator decision 2026-09-28)."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import compute_policy  # noqa: E402
import docker_ondemand  # noqa: E402
from splat_presets import normalize_splat_request  # noqa: E402


class ComputePolicyTests(unittest.TestCase):
    def setUp(self):
        self._env = mock.patch.dict(os.environ, {}, clear=False)
        self._env.start()
        os.environ.pop("AEROBRAIN_COMPUTE", None)

    def tearDown(self):
        self._env.stop()

    def test_odm_goes_to_pc_strict_even_for_fast_presets(self):
        spec = compute_policy.route_odm({"preset": "rapido", "then_splat": True,
                                         "splat_backend": "metal"})
        self.assertEqual(spec["backend"], "cuda")
        self.assertEqual(spec["backend_policy"], "strict")   # never falls back to the Mac
        self.assertEqual(spec["splat_backend"], "cuda")

    def test_splat_request_normalizes_to_cuda(self):
        req = normalize_splat_request(compute_policy.route_splat({"preset": "cinematic",
                                                                  "backend": "metal"}))
        self.assertEqual(req["backend"], "cuda")
        self.assertFalse(req["best_available"])

    def test_local_override_keeps_legacy_paths(self):
        os.environ["AEROBRAIN_COMPUTE"] = "local"
        self.assertNotIn("backend", compute_policy.route_odm({"preset": "rapido"}))
        self.assertEqual(compute_policy.route_splat({"backend": "metal"})["backend"], "metal")


class OnDemandDockerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.marker = mock.patch.object(docker_ondemand, "MARKER",
                                        Path(self.tmp.name) / "last-use")
        self.marker.start()
        self.orb = mock.patch.object(docker_ondemand, "_orb", return_value="/usr/local/bin/orb")
        self.orb.start()

    def tearDown(self):
        self.orb.stop()
        self.marker.stop()
        self.tmp.cleanup()

    def _stop(self, *, active=0, age=None, running=True, ps_out=""):
        now = time.time()
        if age is not None:
            docker_ondemand.touch()
            os.utime(docker_ondemand.MARKER, (now - age, now - age))
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            return mock.Mock(returncode=0, stdout=ps_out)
        with mock.patch.object(docker_ondemand, "running", return_value=running), \
                mock.patch.object(docker_ondemand.subprocess, "run", side_effect=fake_run):
            stopped = docker_ondemand.stop_if_idle(active, now=now)
        return stopped, calls

    def test_stops_after_idle_window_with_no_containers(self):
        stopped, calls = self._stop(age=docker_ondemand.IDLE_STOP_S + 5)
        self.assertTrue(stopped)
        self.assertEqual(calls[-1], ["/usr/local/bin/orb", "stop"])

    def test_keeps_running_while_recently_used_or_busy(self):
        self.assertFalse(self._stop(age=30)[0])
        self.assertFalse(self._stop(age=9999, active=1)[0])
        self.assertFalse(self._stop(age=9999, ps_out="abc123\n")[0])   # live container

    def test_never_touches_docker_when_already_stopped(self):
        stopped, calls = self._stop(age=9999, running=False)
        self.assertFalse(stopped)
        self.assertEqual(calls, [])       # a docker call would boot OrbStack again


if __name__ == "__main__":
    unittest.main()
