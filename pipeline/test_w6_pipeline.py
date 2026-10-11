"""Regression tests for the R0 pipeline audit."""
import os
import tempfile
from pathlib import Path
_BOX = tempfile.TemporaryDirectory()
os.environ['AEROBRAIN_VAULT'] = _BOX.name
os.environ['AEROBRAIN_JOB_LOG_DIR'] = str(Path(_BOX.name) / 'logs')
os.environ['AEROBRAIN_ERRLOG'] = str(Path(_BOX.name) / 'errors.jsonl')
os.environ['AEROBRAIN_NO_REMOTE'] = '1'
import json
import sys
import time
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'ai'))
import analyze
import glb_export
import jobs
import pc_janitor
import worker


class PipelineRegressions(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name)
        for obj, name, value in ((jobs, 'DB', self.root / 'jobs.db'),
                                 (analyze, 'VAULT', self.root),
                                 (worker, 'VAULT', self.root),
                                 (pc_janitor, 'JOBS_DB', self.root / 'jobs.db')):
            p = mock.patch.object(obj, name, value)
            p.start()
            self.addCleanup(p.stop)
        jobs.init()

    def test_pipe01_retraining_archives_raw_splat(self):
        sdir = self.root / 'splats'
        stage = sdir / '.training' / 'test'
        stage.mkdir(parents=True)
        (sdir / 'clip.raw.splat').write_bytes(b'previous raw')
        (sdir / 'clip.splat').write_bytes(b'previous clean')
        (stage / 'clip.splat').write_bytes(b'new raw')
        worker.publish_splat_stage(stage, 'clip', {'passed': True}, sdir)
        history = list((sdir / 'history').glob('*.raw.splat'))
        self.assertEqual(1, len(history))
        self.assertEqual(b'previous raw', history[0].read_bytes())

    def test_pipe02_queued_recovery_protects_expired_checkpoint(self):
        old = jobs.add('splat', 'old')
        jobs.end(old['id'], 'error')
        path = f"/root/gpu-jobs/checkpoints/{old['id']}/step-1.ckpt"
        jobs.enqueue('splat', 'recovery', {'resume_checkpoint': path})
        entry = pc_janitor.Entry(str(Path(path).parent), time.time() - 40 * 86400)
        with mock.patch.object(pc_janitor, 'remote_entries', return_value=[entry]), \
                mock.patch.object(pc_janitor, 'mac_statuses', return_value={old['id']: 'error'}):
            result = pc_janitor.sweep()
        self.assertEqual(0, result['count'])

    def test_pipe06_auto_resume_starts_at_checkpoint_resolution(self):
        plan = worker.splat_attempt_plan({'preset': 'frontier', 'backend': 'cuda',
            'resolution': 'auto', 'resume_checkpoint': '/checkpoint', 'resume_downscale': 2})
        self.assertEqual([2], [row['d'] for row in plan])

    def test_pipe09_invalid_ai_output_preserves_previous_analysis(self):
        fdir = self.root / 'frames' / 'clip'
        fdir.mkdir(parents=True)
        (fdir / 'f_0001.jpg').write_bytes(b'frame')
        target = self.root / 'ai' / 'clip.json'
        target.parent.mkdir()
        target.write_text('{"summary": "previous"}')
        invalid = {'summary': 'new', 'tags': 'paisaje', 'travel_score': 99}
        with mock.patch.object(analyze, 'gemini_vision', return_value=json.dumps(invalid)):
            with self.assertRaises(ValueError):
                analyze.analyze_clip('clip', {})
        self.assertEqual({'summary': 'previous'}, json.loads(target.read_text()))

    def test_pipe10_failed_extraction_does_not_cache_partial_frames(self):
        (self.root / 'proxies').mkdir()
        (self.root / 'proxies' / 'clip.mp4').write_bytes(b'proxy')
        fdir = self.root / 'frames' / 'clip'
        def failed(cmd, **kwargs):
            dest = Path(cmd[-1]).parent
            dest.mkdir(parents=True, exist_ok=True)
            (dest / 'f_0001.jpg').write_bytes(b'partial')
            return mock.Mock(returncode=1, stderr=b'bad file')
        with mock.patch.object(analyze.subprocess, 'run', side_effect=failed):
            with self.assertRaises((RuntimeError, analyze.subprocess.CalledProcessError)):
                analyze.extract_frames_from_proxy('clip', fdir)
        self.assertEqual([], list(fdir.glob('*.jpg')))

    def test_pipe11_failed_director_preserves_previous_complete_report(self):
        fdir = self.root / 'frames' / 'clip'
        fdir.mkdir(parents=True)
        (fdir / 'f_0001.jpg').write_bytes(b'frame')
        target = self.root / 'ai' / 'clip.json'
        target.parent.mkdir()
        old = {'summary': 'old', 'deep': True, 'director_notes': ['complete']}
        target.write_text(json.dumps(old))
        with mock.patch.object(analyze, 'gemini_vision', return_value='{"summary":"new","tags":[]}'), \
                mock.patch.object(analyze, 'director_report', side_effect=TimeoutError('director')):
            with self.assertRaises(TimeoutError):
                analyze.analyze_clip('clip', {}, deep=True)
        self.assertEqual(old, json.loads(target.read_text()))

    def test_pipe12_texture_content_invalidates_glb_fingerprint(self):
        obj = self.root / 'model.obj'
        mtl = self.root / 'model.mtl'
        texture = self.root / 'texture.jpg'
        obj.write_text('v 0 0 0')
        mtl.write_text('map_Kd texture.jpg')
        texture.write_bytes(b'aaaa')
        before = glb_export.source_fingerprint(obj, {'high': mtl})
        texture.write_bytes(b'bbbb')
        self.assertNotEqual(before, glb_export.source_fingerprint(obj, {'high': mtl}))

    def test_pipe07_checkpoint_failure_preserves_cuda_oom(self):
        import gpu_lane
        proj = self.root / 'proj'
        (proj / 'images').mkdir(parents=True)
        stage = self.root / 'stage'
        stage.mkdir()
        job = jobs.add('splat', 'clip')
        jobs.update(job['id'], log='CUDA out of memory')
        job['spec'] = {}
        with mock.patch.object(gpu_lane, 'probe', return_value={'torch': 't', 'gsplat': 'g'}), \
                mock.patch.object(gpu_lane, 'image_cache_policy', return_value={'images': 0, 'device': 'cpu', 'decoded_mib': 0}), \
                mock.patch.object(gpu_lane, 'with_image_cache_policy', return_value=[]), \
                mock.patch.object(gpu_lane, 'prep_dataset'), \
                mock.patch.object(gpu_lane, 'install_train_script'), \
                mock.patch.object(gpu_lane, 'train_argv', return_value=['true']), \
                mock.patch.object(gpu_lane, 'cleanup'), \
                mock.patch.object(gpu_lane, 'archive_latest_checkpoint', side_effect=OSError('disk full')), \
                mock.patch.object(jobs, 'run_tracked', return_value=1), \
                mock.patch.object(pc_janitor, 'sweep_best_effort'):
            with self.assertRaises(gpu_lane.CudaLaneError) as error:
                worker.run_splat_cuda(job, proj, 'clip', stage, stage / 'out.splat', 100, 1, reuse_dataset=True)
        self.assertEqual('oom', error.exception.kind, str(error.exception))
        self.assertEqual(1, error.exception.rc)

    def test_pipe05_cancel_endpoint_reconciles_queued_scene(self):
        import aerobrain_server as server
        import scenes
        with mock.patch.object(scenes, 'SCENES_DIR', self.root / 'scenes'):
            sc = scenes.create_scene('Casa', {'lat': 4.7, 'lon': -74}, ['A'], [])
            jobspec = {'scene_id': sc['id'], 'clip_id': 'recon_x', 'version_id': 'recon_x'}
            job = jobs.enqueue('3d', 'recon_x', jobspec)
            scenes.add_version(sc['id'], 'recon_x', ['A'], [], 'processing')
            scenes.update_version(sc['id'], 'recon_x', job_id=job['id'])
            h = object.__new__(server.H)
            h.auth = lambda *a: True
            h.read_json = lambda *a: {'id': job['id']}
            h.send_json = mock.Mock()
            h._post_job_cancel(None, {})
            self.assertEqual('failed', scenes.get_scene(sc['id'])['versions'][0]['status'])

    def test_pipe08_geotag_failure_preserves_images_and_poses(self):
        import odm_prep
        proj = self.root / 'odm' / 'proj_clip'
        (proj / 'images').mkdir(parents=True)
        (proj / 'opensfm').mkdir()
        (proj / 'images' / 'old.jpg').write_bytes(b'old')
        (proj / 'opensfm' / 'image_list.txt').write_text('old.jpg')
        def extract(stage, images, *args):
            (stage / 'new.jpg').write_bytes(b'new')
            return ['-GPSLatitude=1', str(images / 'new.jpg'), '-execute'], 1
        with mock.patch.object(odm_prep, 'VAULT', self.root), \
                mock.patch.object(sys, 'argv', ['odm_prep.py', 'clip']), \
                mock.patch.object(odm_prep, '_extract_source', side_effect=extract), \
                mock.patch.object(odm_prep.subprocess, 'run', side_effect=OSError('exif failed')):
            with self.assertRaises(OSError):
                odm_prep.main()
        self.assertEqual([b'old'], [p.read_bytes() for p in (proj / 'images').iterdir()])
        self.assertEqual('old.jpg', (proj / 'opensfm' / 'image_list.txt').read_text())

    def test_pipe04_cancelled_splat_cannot_activate(self):
        stage = self.root / 'splats' / '.training' / 'job'
        stage.mkdir(parents=True)
        (stage / 'clip.splat').write_bytes(b'new')
        (self.root / 'splats' / 'clip.splat').write_bytes(b'old')
        job = jobs.add('splat', 'clip')
        jobs.cancel(job['id'])
        with self.assertRaises(RuntimeError):
            worker.publish_splat_stage(stage, 'clip', {'passed': True, 'job_id': job['id']}, self.root / 'splats')
        self.assertEqual(b'old', (self.root / 'splats' / 'clip.splat').read_bytes())

    @unittest.expectedFailure
    def test_pipe03_interrupted_publication_preserves_current_pair(self):
        # Deferred: multi-file activation still needs a version-reference migration.
        sdir = self.root / 'splats'
        stage = sdir / '.training' / 'test'
        stage.mkdir(parents=True)
        (sdir / 'clip.splat').write_bytes(b'old')
        (sdir / 'clip.meta.json').write_text('{"version":"old"}')
        (stage / 'clip.splat').write_bytes(b'new')
        replace = os.replace
        def fail_master(src, dst):
            if Path(dst) == sdir / 'clip.splat':
                raise OSError('interrupted activation')
            return replace(src, dst)
        with mock.patch.object(worker.os, 'replace', side_effect=fail_master):
            with self.assertRaises(OSError):
                worker.publish_splat_stage(stage, 'clip', {'passed': True}, sdir)
        self.assertEqual({'version': 'old'}, json.loads((sdir / 'clip.meta.json').read_text()))
