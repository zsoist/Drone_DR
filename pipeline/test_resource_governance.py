import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker


class ResourceGovernanceTests(unittest.TestCase):
    @staticmethod
    def _ok_result():
        return mock.Mock(returncode=0, stdout="", stderr="")

    def test_opensplat_priority_changes_only_when_mode_changes(self):
        policy = worker.adaptive_priority()
        with (mock.patch.object(worker, "viewer_active",
                                side_effect=[False, True, True, False]),
              mock.patch.object(worker.subprocess, "run",
                                return_value=self._ok_result()) as run):
            for _ in range(4):
                policy(1234)

        self.assertEqual([c.args[0] for c in run.call_args_list], [
            ["/usr/sbin/taskpolicy", "-B", "-p", "1234"],
            ["/usr/sbin/taskpolicy", "-b", "-p", "1234"],
            ["/usr/sbin/taskpolicy", "-B", "-p", "1234"],
        ])

    def test_odm_reserves_three_cores_while_streaming(self):
        policy = worker.adaptive_priority("odm-job")
        with (mock.patch.object(worker, "FULL_CPUS", 10),
              mock.patch.object(worker, "STREAM_CPUS", 7),
              mock.patch.object(worker, "viewer_active", side_effect=[False, True]),
              mock.patch.object(worker.subprocess, "run",
                                return_value=self._ok_result()) as run):
            policy(1234)
            policy(1234)

        self.assertEqual([c.args[0] for c in run.call_args_list], [
            [worker.DOCKER, "update", "--cpus", "10", "odm-job"],
            [worker.DOCKER, "update", "--cpus", "7", "odm-job"],
        ])

    def test_failed_adjustment_is_retried(self):
        policy = worker.adaptive_priority()
        failed = mock.Mock(returncode=1, stdout="", stderr="gone")
        with (mock.patch.object(worker, "viewer_active", return_value=True),
              mock.patch.object(worker.subprocess, "run",
                                side_effect=[failed, self._ok_result()]) as run):
            with self.assertRaises(RuntimeError):
                policy(1234)
            policy(1234)

        self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
