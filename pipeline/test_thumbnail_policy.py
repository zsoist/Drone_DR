"""Private archive thumbnails and strict featured images have separate policies."""
import json
import os
import tempfile
import unittest
from pathlib import Path

_BOX = tempfile.TemporaryDirectory()
os.environ['AEROBRAIN_VAULT'] = _BOX.name
os.environ['AEROBRAIN_JOB_LOG_DIR'] = str(Path(_BOX.name) / 'logs')
os.environ['AEROBRAIN_ERRLOG'] = str(Path(_BOX.name) / 'errors.jsonl')
from ai import frame_api, insights
from PIL import Image


class ThumbnailPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        for folder in ('frames/clip', 'thumbs', 'ai', 'manifest'):
            (self.vault / folder).mkdir(parents=True)
        for n in (1, 2, 3):
            Image.new('RGB', (8, 8), (120,) * 3).save(self.vault / f'frames/clip/f_{n:04d}.jpg')
        Image.new('RGB', (8, 8), (120,) * 3).save(self.vault / 'thumbs/clip.jpg')
        (self.vault / 'manifest/flights.json').write_text(json.dumps({'flights': [{'clip_id': 'clip'}]}))

    def test_missing_evidence_keeps_thumbnail_but_no_featured_cover(self):
        result = frame_api.project({'clip_id': 'clip', 'cover': None}, self.vault)
        self.assertEqual('/data/thumbs/clip.jpg', result.get('thumbnail_url'))
        self.assertIsNone(result['cover'])

    def test_approved_same_clip_frame_precedes_normal_thumbnail(self):
        (self.vault / 'ai/clip.json').write_text(json.dumps({'summary': 'Montañas verdes.', 'best_thumbnail_t': 2}))
        result = frame_api.project({'clip_id': 'clip'}, self.vault)
        self.assertEqual('/data/frames/clip/f_0002.jpg', result.get('thumbnail_url'))

    def test_rejected_featured_cover_keeps_normal_private_thumbnail(self):
        (self.vault / 'ai/clip.json').write_text(json.dumps({'summary': 'Un cartel con teléfono.', 'duration_s': 8}))
        result = frame_api.project({'clip_id': 'clip'}, self.vault)
        self.assertEqual('/data/thumbs/clip.jpg', result.get('thumbnail_url'))
        self.assertEqual([], insights.property_media({'clip': 'clip'}, self.vault)['gallery'])

    def test_archive_frames_keep_quality_while_featured_gallery_fails_closed(self):
        frame = {'clip_id': 'clip', 'frame_url': '/data/frames/clip/f_0001.jpg'}
        result = frame_api.project({'clip_id': 'clip', 'frames': [frame], 'gallery': [frame]}, self.vault)
        self.assertEqual(1, len(result['frames']))
        self.assertEqual(frame['frame_url'], result['frames'][0]['frame_url'])
        self.assertEqual('rejected', result['frames'][0]['quality']['status'])
        self.assertEqual([], result['gallery'])

    def test_scene_keeps_existing_ortho_poster(self):
        result = frame_api.project({'clip_id': 'clip', 'assets': {'poster': '/data/models/clip/ortho.webp'}}, self.vault)
        self.assertEqual('/data/models/clip/ortho.webp', result['assets']['poster'])

    def test_search_keeps_matching_clip_without_approved_frame(self):
        (self.vault / 'ai/clip.json').write_text(json.dumps({'summary': 'Edificios con un cartel.'}))
        result = frame_api.project(insights.search('edificios', vault=self.vault), self.vault)
        self.assertEqual(['clip'], [row['clip_id'] for row in result['results']])
        self.assertEqual('/data/thumbs/clip.jpg', result['results'][0]['thumbnail_url'])


if __name__ == '__main__':
    unittest.main()
