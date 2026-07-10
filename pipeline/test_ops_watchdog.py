import unittest
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


if __name__ == "__main__":
    unittest.main()
