"""Regression tests for R0 job ownership, cancellation, and queue findings."""
import os
import tempfile
from pathlib import Path

_BOX = tempfile.TemporaryDirectory()
os.environ['AEROBRAIN_VAULT'] = _BOX.name
os.environ['AEROBRAIN_JOB_LOG_DIR'] = str(Path(_BOX.name) / 'logs')
os.environ['AEROBRAIN_ERRLOG'] = str(Path(_BOX.name) / 'errors.jsonl')
import unittest
from unittest import mock
import jobs


class JobStoreCase(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        p = mock.patch.object(jobs, 'DB', Path(self.box.name) / 'jobs.db')
        p.start()
        self.addCleanup(p.stop)
        jobs.init()


class JobRegressions(JobStoreCase):
    def test_srv01_orphan_generic_python_is_not_owned(self):
        job = jobs.add('splat', 'clip')
        jobs.update(job['id'], pid=12345)
        with mock.patch.object(jobs.subprocess, 'run', return_value=mock.Mock(stdout='python3 other-project.py')), \
                mock.patch.object(jobs, '_kill_pg') as kill, \
                mock.patch.object(jobs, '_proc_gone', return_value=True):
            jobs.init(orphan_kinds=('splat',))
        kill.assert_not_called()

    def test_srv01_cancel_never_signals_unverified_pid(self):
        job = jobs.add('splat', 'clip')
        jobs.update(job['id'], pid=12345)
        with mock.patch.object(jobs, '_kill_pg') as kill, \
                mock.patch.object(jobs, '_proc_gone', return_value=False), \
                mock.patch.object(jobs.time, 'sleep'):
            self.assertFalse(jobs.cancel(job['id']))
        kill.assert_not_called()

    def test_srv03_container_failure_is_not_cancelled(self):
        job = jobs.add('3d', 'clip', container='odm-gpu-owned')
        with mock.patch.object(jobs, 'kill_container', return_value=(False, 'SSH unavailable')):
            self.assertFalse(jobs.cancel(job['id']))
        self.assertEqual('cancel_failed', jobs.get(job['id'])['status'])

    def test_srv04_cancelled_job_cannot_finish_or_restart(self):
        job = jobs.add('edit', 'clip')
        self.assertTrue(jobs.cancel(job['id']))
        jobs.end(job['id'], 'done', 'export done')
        jobs.update(job['id'], status='running')
        self.assertEqual('cancelled', jobs.get(job['id'])['status'])

    def test_srv05_enqueue_reuses_active_job(self):
        first = jobs.enqueue('splat', 'clip', {'preset': 'medium'})
        second = jobs.enqueue('splat', 'clip', {'preset': 'medium'})
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(1, len(jobs.recent()))

    def test_srv10_recent_always_includes_active_jobs(self):
        active = jobs.add('splat', 'long')
        for i in range(35):
            job = jobs.add('upload', str(i))
            jobs.end(job['id'], 'done')
        rows = jobs.recent(30)
        self.assertIn(active['id'], [row['id'] for row in rows])
        self.assertEqual(31, len(rows))

class TrackedCancellation(JobStoreCase):
    def test_srv04_export_process_stops_on_cancel(self):
        import sys
        import threading
        import time
        import aerobrain_server as server
        job = jobs.add('edit', 'clip')
        errors = []
        def run():
            try:
                server._ff([sys.executable, '-c', 'import time; time.sleep(20)'], jid=job['id'])
            except Exception as exc:
                errors.append(exc)
        t = threading.Thread(target=run)
        t.start()
        deadline = time.monotonic() + 3
        while t.is_alive() and not jobs.get(job['id'])['pid'] and time.monotonic() < deadline:
            time.sleep(.02)
        try:
            self.assertIsNotNone(jobs.get(job['id'])['pid'])
            self.assertTrue(jobs.cancel(job['id']))
        finally:
            t.join(5)
        self.assertFalse(t.is_alive())
        self.assertTrue(errors)
        self.assertEqual('cancelled', jobs.get(job['id'])['status'])

    def test_pipe04_tracked_transfer_is_interruptible(self):
        import sys
        import threading
        import time
        import gpu_lane
        job = jobs.add('splat', 'transfer')
        errors = []
        def transfer():
            try:
                gpu_lane._run([sys.executable, '-c', 'import time; time.sleep(20)'], 30,
                              'test transfer', jid=job['id'])
            except Exception as exc:
                errors.append(exc)
        with mock.patch.object(gpu_lane, '_no_remote_guard'):
            t = threading.Thread(target=transfer)
            t.start()
            deadline = time.monotonic() + 3
            while t.is_alive() and not jobs.get(job['id'])['pid'] and time.monotonic() < deadline:
                time.sleep(.02)
            try:
                self.assertIsNotNone(jobs.get(job['id'])['pid'])
                self.assertTrue(jobs.cancel(job['id']))
            finally:
                t.join(5)
        self.assertFalse(t.is_alive())
        self.assertTrue(errors)

    def test_srv01_real_child_identity_survives_store_recovery(self):
        import subprocess
        import sys
        proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)'],
                                env=dict(os.environ, AEROBRAIN_JOB_ID='owned-test'),
                                start_new_session=True)
        try:
            identity = jobs._process_identity(proc.pid)
            self.assertTrue(jobs._proc_ours(proc.pid, identity, 'owned-test'))
            self.assertFalse(jobs._proc_ours(proc.pid, identity, 'other-job'))
        finally:
            proc.terminate()
            proc.wait(timeout=5)

    def test_srv04_cancel_before_reel_activation_keeps_existing_reel(self):
        import aerobrain_server as server
        root = Path(self.box.name)
        (root / 'proxies').mkdir()
        (root / 'proxies' / 'clip.mp4').write_bytes(b'proxy')
        (root / 'reels').mkdir()
        target = root / 'reels' / 'existing.mp4'
        target.write_bytes(b'previous')
        job = jobs.add('edit', 'reel')
        calls = []
        def ff(cmd, jid=None):
            Path(cmd[-1]).write_bytes(b'new')
            calls.append(cmd)
            if len(calls) == 2:
                jobs.cancel(jid)
        with mock.patch.object(server, 'VAULT', root), \
                mock.patch.object(server, '_ff', side_effect=ff), \
                mock.patch.object(server, '_reel_poster'), \
                mock.patch.object(server, 'rebuild_index'):
            server.run_edit({'clip_id': 'clip', 'segments': [{'a': 0, 'b': 2}],
                             'replace': 'existing.mp4'}, job)
        self.assertEqual(2, len(calls))
        self.assertEqual(b'previous', target.read_bytes())
        self.assertEqual('cancelled', jobs.get(job['id'])['status'])
        self.assertEqual([target], list((root / 'reels').iterdir()))
