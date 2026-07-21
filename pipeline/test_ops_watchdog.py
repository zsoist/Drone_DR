import io
import json
import unittest
import urllib.error
from unittest import mock

from pipeline import ops_watchdog


class ProbeAndHealTests(unittest.TestCase):
    def test_healthy_probe_does_not_restart(self):
        probe = mock.Mock(return_value=(True, "200 ok", 12))
        with (mock.patch.object(ops_watchdog, "kick") as kick,
              mock.patch.object(ops_watchdog, "log") as log,
              mock.patch.object(ops_watchdog.time, "sleep") as sleep):
            self.assertTrue(ops_watchdog.probe_and_heal(
                "local_probe", "web", probe, "local", url="health"))

        kick.assert_not_called()
        sleep.assert_not_called()
        log.assert_called_once_with(
            "local_probe", ok=True, detail="200 ok", ms=12, url="health")

    def test_transient_failure_recovers_without_restart(self):
        probe = mock.Mock(side_effect=[
            (False, "TimeoutError", 4001),
            (True, "200 ok", 18),
        ])
        with (mock.patch.object(ops_watchdog, "kick") as kick,
              mock.patch.object(ops_watchdog, "log") as log,
              mock.patch.object(ops_watchdog.time, "sleep") as sleep):
            self.assertTrue(ops_watchdog.probe_and_heal(
                "local_probe", "web", probe, "local", retry_delay=0))

        kick.assert_not_called()
        sleep.assert_called_once_with(0)
        log.assert_called_once_with(
            "local_probe", ok=True, detail="200 ok", ms=18, recovered="retry")

    def test_two_failures_restart_then_verify(self):
        probe = mock.Mock(side_effect=[
            (False, "TimeoutError", 4001),
            (False, "TimeoutError", 4002),
            (True, "200 ok", 20),
        ])
        with (mock.patch.object(ops_watchdog, "kick") as kick,
              mock.patch.object(ops_watchdog, "log") as log,
              mock.patch.object(ops_watchdog.time, "sleep") as sleep):
            self.assertTrue(ops_watchdog.probe_and_heal(
                "public_probe", "tunnel", probe, "public",
                retry_delay=0, restart_delay=0))

        kick.assert_called_once_with("tunnel", "public failed twice: TimeoutError")
        self.assertEqual(sleep.call_args_list, [mock.call(0), mock.call(0)])
        log.assert_called_once_with(
            "public_probe", ok=True, detail="200 ok", ms=20,
            recovered="restart")

    def test_auth_boundary_accepts_401_without_restart_semantics(self):
        error = urllib.error.HTTPError(
            "https://vuelos.metislab.work/data/proxies/test.mp4",
            401,
            "Unauthorized",
            {"CF-Cache-Status": "DYNAMIC", "X-AeroBrain-Edge": "private-data-v1"},
            io.BytesIO(b"{}"),
        )
        with mock.patch.object(ops_watchdog.urllib.request, "urlopen", side_effect=error):
            ok, detail, _ = ops_watchdog.auth_boundary_probe(error.url, 1)
        self.assertTrue(ok)
        self.assertEqual(detail, "401 cache=DYNAMIC edge=private-data-v1")

    def test_auth_boundary_rejects_401_without_private_data_worker(self):
        error = urllib.error.HTTPError(
            "https://vuelos.metislab.work/data/proxies/test.mp4",
            401,
            "Unauthorized",
            {"CF-Cache-Status": "DYNAMIC"},
            io.BytesIO(b"{}"),
        )
        with mock.patch.object(ops_watchdog.urllib.request, "urlopen", side_effect=error):
            ok, detail, _ = ops_watchdog.auth_boundary_probe(error.url, 1)
        self.assertFalse(ok)
        self.assertEqual(detail, "401 cache=DYNAMIC edge=missing")

    def test_auth_boundary_detects_cached_206(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 206
        response.headers = {"CF-Cache-Status": "HIT"}
        with mock.patch.object(ops_watchdog.urllib.request, "urlopen", return_value=response):
            ok, detail, _ = ops_watchdog.auth_boundary_probe(
                "https://vuelos.metislab.work/data/proxies/test.mp4", 1)
        self.assertFalse(ok)
        self.assertEqual(detail, "LEAK 206 cache=HIT")

    def test_auth_bridge_accepts_daniel_and_always_revokes_probe_session(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.headers = {"X-AeroBrain-Edge": "private-data-v1"}
        response.read.return_value = json.dumps({
            "ok": True,
            "user": {"id": "daniel"},
            "dev_mode": False,
            "expires_in_seconds": 60,
        }).encode()
        with (mock.patch.object(ops_watchdog.jobstore, "session_create", return_value="probe-token") as create,
              mock.patch.object(ops_watchdog.jobstore, "session_delete") as delete,
              mock.patch.object(ops_watchdog.urllib.request, "urlopen", return_value=response)):
            ok, detail, _ = ops_watchdog.auth_bridge_probe(
                "https://vuelos.metislab.work/api/whoami", 1)
        self.assertTrue(ok)
        self.assertEqual(detail, "200 user=daniel edge=private-data-v1")
        create.assert_called_once_with(ttl_seconds=60)
        delete.assert_called_once_with("probe-token")

    def test_auth_bridge_revokes_probe_session_when_request_fails(self):
        with (mock.patch.object(ops_watchdog.jobstore, "session_create", return_value="probe-token"),
              mock.patch.object(ops_watchdog.jobstore, "session_delete") as delete,
              mock.patch.object(ops_watchdog.urllib.request, "urlopen", side_effect=TimeoutError)):
            ok, detail, _ = ops_watchdog.auth_bridge_probe(
                "https://vuelos.metislab.work/api/whoami", 1)
        self.assertFalse(ok)
        self.assertEqual(detail, "TimeoutError")
        delete.assert_called_once_with("probe-token")


if __name__ == "__main__":
    unittest.main()
