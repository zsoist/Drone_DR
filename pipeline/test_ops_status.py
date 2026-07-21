import datetime
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from pipeline import ops_status


class OpsStatusTests(unittest.TestCase):
    @staticmethod
    def _ps(with_workload=True):
        rows = [
            "PID %CPU %MEM RSS COMMAND",
            "10 0.2 0.1 10000 python pipeline/aerobrain_server.py",
            "11 0.0 0.1 9000 python pipeline/worker.py",
            "12 0.3 0.1 12000 cloudflared tunnel --config /Users/x/metislab-work.yml run",
            "13 9.0 0.1 15000 cloudflared tunnel --config /Users/x/other.yml run",
        ]
        if with_workload:
            rows.append("14 80.0 4.0 500000 /repo/splat/OpenSplat/build/opensplat /vault/odm")
        return "\n".join(rows)

    def _check_output(self, with_workload=True):
        def run(cmd, **_kwargs):
            if cmd[0] == "ps":
                return self._ps(with_workload)
            return ""
        return run

    def test_idle_fails_on_orphan_workload_and_excludes_other_tunnel(self):
        with mock.patch.object(ops_status.subprocess, "check_output",
                               side_effect=self._check_output(True)):
            report = ops_status.resource_status(active_jobs=0)
        self.assertFalse(report["ok"])
        self.assertTrue(report["orphan_workload"])
        self.assertEqual(report["total_cpu"], 0.5)
        self.assertEqual(len(report["processes"]), 3)

    def test_workload_is_allowed_only_with_active_job(self):
        with mock.patch.object(ops_status.subprocess, "check_output",
                               side_effect=self._check_output(True)):
            report = ops_status.resource_status(active_jobs=1)
        self.assertTrue(report["ok"])
        self.assertEqual(report["mode"], "working")
        self.assertEqual(len(report["workload_processes"]), 1)

    def test_power_gate_requires_no_sleep_and_auto_restart(self):
        pmset = """AC Power:
 sleep 0
 disksleep 0
 autorestart 1
"""
        with mock.patch.object(ops_status.subprocess, "check_output", return_value=pmset):
            self.assertTrue(ops_status.power_status()["ok"])

    def test_reliability_gate_proves_full_day_without_gaps(self):
        now = 1_800_000_000
        tz = datetime.timezone(datetime.timedelta(hours=-5))
        with tempfile.TemporaryDirectory() as td:
            log = Path(td) / "watchdog.log"
            rows = []
            for t in range(int(now - 24 * 3600), int(now) + 1, 60):
                stamp = datetime.datetime.fromtimestamp(t, tz).strftime("%Y-%m-%dT%H:%M:%S%z")
                rows.append(json.dumps({"ts": stamp, "event": "local_probe", "ok": True, "ms": 10}))
            log.write_text("\n".join(rows))
            with (mock.patch.object(ops_status, "WATCHDOG_LOG", log),
                  mock.patch.object(ops_status.time, "time", return_value=now)):
                report = ops_status.reliability_status()
        self.assertTrue(report["ok"])
        self.assertEqual(report["failed_probes"], 0)
        self.assertEqual(report["max_gap_s"], 60)

    def test_auth_boundary_accepts_unauthorized_media(self):
        error = urllib.error.HTTPError(
            "https://vuelos.metislab.work/data/proxies/test.mp4",
            401,
            "Unauthorized",
            {"CF-Cache-Status": "DYNAMIC", "X-AeroBrain-Edge": "private-data-v1"},
            io.BytesIO(b'{"error":"authentication required"}'),
        )
        with mock.patch.object(ops_status.urllib.request, "urlopen", side_effect=error):
            report = ops_status.auth_boundary_probe(error.url)
        self.assertTrue(report["ok"])
        self.assertEqual(report["status"], 401)

    def test_auth_boundary_rejects_401_without_private_data_worker(self):
        error = urllib.error.HTTPError(
            "https://vuelos.metislab.work/data/proxies/test.mp4",
            401,
            "Unauthorized",
            {"CF-Cache-Status": "DYNAMIC"},
            io.BytesIO(b'{}'),
        )
        with mock.patch.object(ops_status.urllib.request, "urlopen", side_effect=error):
            report = ops_status.auth_boundary_probe(error.url)
        self.assertFalse(report["ok"])
        self.assertEqual(report["detail"], "private data edge worker missing")

    def test_auth_boundary_rejects_cached_media_hit(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 206
        response.headers = {"CF-Cache-Status": "HIT"}
        with mock.patch.object(ops_status.urllib.request, "urlopen", return_value=response):
            report = ops_status.auth_boundary_probe(
                "https://vuelos.metislab.work/data/proxies/test.mp4")
        self.assertFalse(report["ok"])
        self.assertEqual(report["detail"], "protected media leaked")


if __name__ == "__main__":
    unittest.main()
