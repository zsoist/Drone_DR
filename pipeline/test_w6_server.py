"""Regression tests for staged uploads and HTTP response framing."""
import os
import tempfile
from pathlib import Path
_BOX = tempfile.TemporaryDirectory()
os.environ['AEROBRAIN_VAULT'] = _BOX.name
os.environ['AEROBRAIN_JOB_LOG_DIR'] = str(Path(_BOX.name) / 'logs')
os.environ['AEROBRAIN_ERRLOG'] = str(Path(_BOX.name) / 'errors.jsonl')
import io
import json
import unittest
from unittest import mock
import aerobrain_server as server


class ServerRegressions(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name)
        p = mock.patch.object(server, 'VAULT', self.root)
        p.start()
        self.addCleanup(p.stop)
        self.h = object.__new__(server.H)
        self.h.auth = lambda *args: True
        self.h._require_read_access = lambda: True
        self.h.path = '/test'
        self.h.send_json = mock.Mock()
        self.h.headers = {}
        self.h.rfile = io.BytesIO()
        self.h.wfile = io.BytesIO()
        self.h.send_response = mock.Mock()
        self.h.send_header = mock.Mock()
        self.h.end_headers = mock.Mock()

    def test_srv02_receive_never_overwrites_existing_destination(self):
        dest = self.root / 'photo.jpg'
        dest.write_bytes(b'original')
        self.h.rfile = io.BytesIO(b'new')
        self.h._receive_upload(dest, 3, 1024)
        self.assertEqual(b'original', dest.read_bytes())
        self.assertEqual(409, self.h.send_json.call_args.args[1])

    def test_srv02_partial_upload_is_never_published(self):
        dest = self.root / 'photo.jpg'
        self.h.rfile = io.BytesIO(b'partial')
        self.assertEqual(7, self.h._receive_upload(dest, 20, 1024))
        self.assertFalse(dest.exists())
        self.assertEqual([], list(self.root.iterdir()))

    def test_srv06_library_lists_supported_browser_photos(self):
        photos = self.root / 'photos'
        photos.mkdir()
        for name in ('a.jpg', 'b.jpeg', 'c.png', 'd.webp'):
            (photos / name).write_bytes(b'photo')
        self.h.path = '/api/studio_media'
        self.h.do_GET()
        self.assertEqual(4, len(self.h.send_json.call_args.args[0]['photos']))

    def test_srv06_failed_photo_conversion_is_not_success(self):
        self.h.rfile = io.BytesIO(b'heic')
        self.h.headers = {'Content-Length': '4'}
        with mock.patch.object(server.subprocess, 'run', side_effect=OSError('conversion failed')):
            self.h._post_photo_upload(None, {'name': ['photo.heic']})
        self.assertEqual(400, (self.h.send_json.call_args.args + (200,))[1])
        self.assertEqual([], list((self.root / 'photos').iterdir()))

    def test_srv07_invalid_splat_keeps_current_assets(self):
        sdir = self.root / 'splats'
        sdir.mkdir()
        (sdir / 'clip.splat').write_bytes(b'working')
        self.h.rfile = io.BytesIO(b'garbage')
        self.h.headers = {'Content-Length': '7'}
        with mock.patch.object(server.jobstore, 'pending', return_value=False), \
                mock.patch.object(server.jobstore, 'retarget_splat_artifacts'), \
                mock.patch.object(server, 'rebuild_index'), \
                mock.patch.object(server, 'rebuild_scene_manifest'), \
                mock.patch.object(server.subprocess, 'run', return_value=mock.Mock(returncode=1, stderr='invalid')):
            self.h._post_splat_upload(None, {'cid': ['clip'], 'name': ['model.splat']})
        self.assertEqual(b'working', (sdir / 'clip.splat').read_bytes())
        self.assertEqual(400, (self.h.send_json.call_args.args + (200,))[1])

    def test_srv08_failed_clean_conversion_keeps_master(self):
        sdir = self.root / 'splats'
        sdir.mkdir()
        (sdir / 'clip.splat').write_bytes(b'working')
        (sdir / 'clip.clean.sog').write_bytes(b'viewer')
        def run(cmd, **kw):
            if 'autoclean.mjs' in str(cmd[1]):
                Path(cmd[3]).write_bytes(b'clean')
                return mock.Mock(returncode=0, stdout='{}', stderr='')
            Path(cmd[3]).write_bytes(b'partial')
            return mock.Mock(returncode=1, stdout='', stderr='bad conversion')
        with mock.patch.object(server.jobstore, 'pending', return_value=False), \
                mock.patch.object(server.subprocess, 'run', side_effect=run):
            self.h._post_splat_autoclean(None, {'cid': ['clip']})
        self.assertEqual(b'working', (sdir / 'clip.splat').read_bytes())
        self.assertEqual(b'viewer', (sdir / 'clip.clean.sog').read_bytes())

    def test_srv09_unsatisfiable_range_has_empty_body_length(self):
        path = self.root / 'x.mp4'
        path.write_bytes(b'video')
        self.h.path = '/data/x.mp4'
        self.h.headers = {'Range': 'bytes=100-200'}
        self.h.resolve = lambda: path
        self.h.do_GET()
        self.h.send_response.assert_called_with(416)
        self.assertIn(mock.call('Content-Length', '0'), self.h.send_header.call_args_list)
