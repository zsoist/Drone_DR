import io
import json
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
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


class LatestProxyUrlsTests(unittest.TestCase):
    def test_missing_manifest_returns_pair_so_callers_can_unpack(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(ops_watchdog, "VAULT", Path(tmp)):
                local, public = ops_watchdog.latest_proxy_urls()
        self.assertIsNone(local)
        self.assertIsNone(public)

    def test_corrupt_manifest_returns_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "manifest").mkdir()
            (Path(tmp) / "manifest" / "flights.json").write_text("{nope")
            with mock.patch.object(ops_watchdog, "VAULT", Path(tmp)):
                self.assertEqual(ops_watchdog.latest_proxy_urls(), (None, None))


class MainResilienceTests(unittest.TestCase):
    def _run_main(self, tmp, state, **patches):
        log_dir = Path(tmp)
        stack = mock.patch.multiple(
            ops_watchdog,
            LOG_DIR=log_dir, STATE=log_dir / "state.json", LOG=log_dir / "watchdog.log",
            ALERT=log_dir / "ALERT", LOGS_TO_ROTATE=(),
            load_state=mock.Mock(return_value=state),
            launch_state=mock.Mock(return_value="running"),
            **patches)
        with stack, mock.patch.object(ops_watchdog, "_notify") as notify:
            ops_watchdog.main()
        return notify

    def test_state_saved_and_later_steps_run_when_a_step_raises(self):
        state = {}
        with tempfile.TemporaryDirectory() as tmp:
            saved = mock.Mock()
            boundary = mock.Mock(return_value=(True, "401 cache= edge=private-data-v1", 1))
            self._run_main(
                tmp, state,
                save_state=saved,
                probe_and_heal=mock.Mock(side_effect=RuntimeError("boom")),
                latest_proxy_urls=mock.Mock(return_value=("http://l/x.mp4", "https://p/x.mp4")),
                auth_boundary_probe=boundary,
                auth_bridge_probe=mock.Mock(return_value=(True, "ok", 1)),
            )
        saved.assert_called_once_with(state)
        boundary.assert_called_once()

    def test_no_proxy_video_does_not_abort_main(self):
        state = {}
        with tempfile.TemporaryDirectory() as tmp:
            saved = mock.Mock()
            self._run_main(tmp, state, save_state=saved,
                           probe_and_heal=mock.Mock(return_value=True),
                           latest_proxy_urls=mock.Mock(return_value=(None, None)))
        saved.assert_called_once_with(state)
        self.assertIn("last_stream_probe", state)

    def test_kick_swallows_timeout(self):
        with (mock.patch.object(ops_watchdog, "log") as log,
              mock.patch.object(ops_watchdog.subprocess, "run",
                                side_effect=subprocess.TimeoutExpired("launchctl", 15))):
            ops_watchdog.kick("com.aerobrain.web", "test")
        self.assertEqual(log.call_args_list[-1].args[0], "kickstart_timeout")

    def test_boundary_leak_writes_alert_and_notifies_once_per_hour(self):
        state = {}
        with tempfile.TemporaryDirectory() as tmp:
            common = dict(
                save_state=mock.Mock(),
                probe_and_heal=mock.Mock(return_value=True),
                latest_proxy_urls=mock.Mock(return_value=("http://l/x.mp4", "https://p/x.mp4")),
                auth_boundary_probe=mock.Mock(return_value=(False, "LEAK 206 cache=HIT", 1)),
                auth_bridge_probe=mock.Mock(return_value=(True, "ok", 1)),
            )
            notify = self._run_main(tmp, state, **common)
            alert = (Path(tmp) / "ALERT").read_text()
            self.assertIn("auth_boundary_probe: LEAK 206", alert)
            notify.assert_called_once()
            # second run inside the hour: file kept, no second notification
            state["last_stream_probe"] = 0
            notify2 = self._run_main(tmp, state, **common)
            notify2.assert_not_called()
            self.assertTrue((Path(tmp) / "ALERT").exists())
            # recovery clears the alert file
            state["last_stream_probe"] = 0
            common["auth_boundary_probe"] = mock.Mock(return_value=(True, "401", 1))
            self._run_main(tmp, state, **common)
            self.assertFalse((Path(tmp) / "ALERT").exists())

    def test_local_probe_failure_raises_alert(self):
        state = {"last_public_probe": 9e12, "last_stream_probe": 9e12}
        with tempfile.TemporaryDirectory() as tmp:
            notify = self._run_main(tmp, state, save_state=mock.Mock(),
                                    probe_and_heal=mock.Mock(return_value=False))
            self.assertIn("local_probe", (Path(tmp) / "ALERT").read_text())
        notify.assert_called_once()


if __name__ == "__main__":
    unittest.main()
