"""Offline contracts for structured insights and read-only visual AI APIs."""
import copy
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

# Set all writable roots before imports. The test runner also supplies these.
_BOX = tempfile.TemporaryDirectory()
os.environ['AEROBRAIN_VAULT'] = _BOX.name
os.environ['AEROBRAIN_JOB_LOG_DIR'] = str(Path(_BOX.name) / 'logs')
os.environ['AEROBRAIN_ERRLOG'] = str(Path(_BOX.name) / 'errors.jsonl')
os.environ['AEROBRAIN_NO_REMOTE'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'ai'))
import insights
import backfill_insights
from insight_schema import validate_insight


def fixture_insight():
    return {'caption': 'Río entre montañas.', 'tags': ['río', 'montañas'], 'subjects': ['río'],
            'shot_type': 'cenital', 'scene_type': 'naturaleza', 'best_frame_times': [2],
            'highlight_segments': [{'start': 1, 'end': 4, 'score': .9, 'reason': 'Río azul.'}],
            'light_notes': 'Luz suave.', 'color_notes': 'Verde natural.',
            'suggested_look': {'preset_id': 'malick', 'exposure_ev': -.3}, 'quality_flags': []}


class VisualAI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        for name in ('manifest', 'ai', 'frames', 'tracks'):
            (self.vault / name).mkdir()
        self.rows = [{'clip_id': 'clip_a', 'duration_s': 6, 'date': '2026-07-01',
                      'stats': {'home': [-74, 4], 'distance_m': 100, 'max_rel_alt_m': 20}},
                     {'clip_id': 'clip_b', 'duration_s': 6, 'date': '2026-07-02',
                      'stats': {'home': [-74.01, 4.01], 'distance_m': 50, 'max_rel_alt_m': 30}}]
        self.write('manifest/flights.json', {'flights': self.rows})
        for f in self.rows:
            cid = f['clip_id']
            self.write(f'manifest/{cid}.json', f)
            (self.vault / 'frames' / cid).mkdir()
            for i in range(1, 4):
                (self.vault / 'frames' / cid / f'f_{i:04d}.jpg').write_bytes(b'image')
        self.vision = patch.object(insights.router, 'gemini_insight', return_value=(json.dumps(fixture_insight()),
                            {'model': 'gemini-2.5-flash', 'input_tokens': 1000, 'output_tokens': 100}))
        self.embed = patch.object(insights.router, 'embed_text', return_value=[1., 0.] + [0.] * 766)
        self.vision_mock = self.vision.start()
        self.embed_mock = self.embed.start()
        self.addCleanup(self.vision.stop)
        self.addCleanup(self.embed.stop)
        self.data = insights.build_record('clip_a', {}, self.vault)
        insights.save_record(self.data, self.vault)

    def write(self, path, value):
        (self.vault / path).write_text(json.dumps(value))

    def test_schema_rejects_missing_unknown_types_nan_and_bounds(self):
        cases = []
        for key in fixture_insight():
            d = fixture_insight(); del d[key]; cases.append(d)
        for key, value in [('tags', 'rio'), ('caption', ''), ('shot_type', 'zoom'),
                           ('quality_flags', ['borroso']), ('extra', 1), ('best_frame_times', [3]),
                           ('suggested_look', {'preset_id': 'fake', 'exposure_ev': 0})]:
            d = fixture_insight(); d[key] = value; cases.append(d)
        for score in [True, float('nan'), float('inf'), -1, 1.1]:
            d = fixture_insight(); d['highlight_segments'][0]['score'] = score; cases.append(d)
        for start, end in [(4, 1), (1, 7), (-1, 2)]:
            d = fixture_insight(); d['highlight_segments'][0].update(start=start, end=end); cases.append(d)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_insight(value, 6, [0, 2, 4])

    def test_failed_generation_and_embedding_preserve_previous_bytes(self):
        target = self.vault / 'ai/clip_a.json'
        before = target.read_bytes()
        for value in ['not JSON', '{}', '{"tags":"bad"}']:
            self.vision_mock.return_value = (value, {})
            with self.assertRaises(ValueError):
                insights.save_record(insights.build_record('clip_a', {}, self.vault), self.vault)
            self.assertEqual(before, target.read_bytes())
        self.vision_mock.return_value = (json.dumps(fixture_insight()), {'input_tokens': 1, 'output_tokens': 1})
        self.embed_mock.side_effect = TimeoutError
        with self.assertRaises(TimeoutError):
            insights.build_record('clip_a', {}, self.vault)
        self.assertEqual(before, target.read_bytes())

    def test_search_cosine_fallback_stale_vectors_and_moment(self):
        b = copy.deepcopy(self.data)
        b['clip_id'] = 'clip_b'
        b['embedding']['vector'] = [0, 1] + [0] * 766
        insights.save_record(b, self.vault)
        result = insights.search('agua', vault=self.vault, embed=lambda q: [1, 0] + [0] * 766)
        self.assertEqual('clip_a', result['results'][0]['clip_id'])
        self.assertEqual(1, result['results'][0]['score'])
        self.assertEqual(1, result['results'][0]['matched_moment']['time_s'])
        result = insights.search('RIO', vault=self.vault, embed=lambda q: (_ for _ in []).throw(TimeoutError()))
        self.assertEqual('tags', result['mode'])
        self.assertEqual(2, len(result['results']))
        b['embedding']['source_hash'] = 'stale'
        self.write('ai/clip_b.json', b)
        self.assertEqual([], insights.search('agua', vault=self.vault, embed=lambda q: [0, 1] + [0] * 766)['results'])

    def test_collections_group_place_month_subject_shot_and_cover(self):
        items = insights.collections(self.vault)['collections']
        self.assertEqual({'place', 'month', 'subject', 'shot_type'}, {x['kind'] for x in items})
        place = next(x for x in items if x['kind'] == 'place')
        self.assertEqual(2, place['count'])
        self.assertEqual('clip_a', place['cover']['clip_id'])
        self.assertTrue(place['cover']['frame_url'].endswith('.jpg'))

    def test_place_collection_keeps_owner_cover(self):
        self.write('manifest/trips_meta.json', {'4.00,-74.00': {'name': 'Mi viaje', 'cover': 'clip_b'}})
        place = next(c for c in insights.collections(self.vault)['collections'] if c['kind'] == 'place')
        self.assertEqual('Mi viaje', place['label'])
        self.assertEqual('clip_b', place['cover']['clip_id'])
        self.assertEqual('owner', place['cover']['selection'])

    def test_summary_cache_invalidation_failure_and_read_only_get(self):
        tid = insights.trip_groups(self.rows)[0]['id']
        for kind, identity in [('flight', 'clip_a'), ('trip', tid)]:
            with patch.object(insights.router, 'summary_text', return_value=(
                    '{"sentences":["El dron recorre el río.","La luz es suave."]}', {'total_tokens': 20})) as api:
                self.assertFalse(insights.cache_summary(kind, identity, {}, self.vault)['cached'])
                self.assertTrue(insights.cache_summary(kind, identity, {}, self.vault)['cached'])
                self.assertEqual(1, api.call_count)
                self.assertEqual('ready', insights.get_summary(kind, identity, self.vault)['status'])
            target = insights.summary_path(kind, identity, self.vault)
            before = target.read_bytes()
            self.rows[0]['stats']['distance_m'] += 1
            self.write('manifest/flights.json', {'flights': self.rows})
            self.assertEqual('pending', insights.get_summary(kind, identity, self.vault)['status'])
            with patch.object(insights.router, 'summary_text', return_value=('{}', {})), self.assertRaises(ValueError):
                insights.cache_summary(kind, identity, {}, self.vault)
            self.assertEqual(before, target.read_bytes())
        self.assertEqual(30, insights.get_summary('trip', tid, self.vault)['max_altitude_m'])
        self.assertLessEqual(len(insights.get_summary('trip', tid, self.vault)['best_frames']), 6)

    def test_dry_run_never_calls_provider_or_writes(self):
        before = {str(p): p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}
        self.vision_mock.reset_mock(); self.embed_mock.reset_mock()
        self.assertEqual(0, backfill_insights.backfill(1, True, self.vault))
        self.vision_mock.assert_not_called(); self.embed_mock.assert_not_called()
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.vault.rglob('*') if p.is_file()})

    def test_no_raw_reads_or_frame_extraction(self):
        self.vision_mock.assert_called_once()
        samples = self.vision_mock.call_args.args[1]
        self.assertEqual(3, len(samples))
        self.assertTrue(all('/frames/' in str(p) for p in samples))
        self.assertEqual([0, 2, 4], self.data['sampled_frame_times'])

    def test_query_vector_memory_cache(self):
        insights._QUERY_CACHE.clear()
        self.embed_mock.reset_mock()
        insights.query_vector('rio', {}); insights.query_vector('rio', {})
        self.embed_mock.assert_called_once_with('rio', {}, 'RETRIEVAL_QUERY')

    def test_packed_summary_keeps_two_sentences_and_decimal_values(self):
        with patch.object(insights.router, 'summary_text', return_value=(
                '{"sentences":["El dron recorrió 327.5 metros. La altura fue 52.4 metros."]}', {})):
            insights.cache_summary('flight', 'clip_a', {}, self.vault)
        summary = insights.get_summary('flight', 'clip_a', self.vault)['summary']
        self.assertEqual('El dron recorrió 327.5 metros. La altura fue 52.4 metros.', summary)

    def test_embedding_repair_reuses_insight_without_vision(self):
        data = copy.deepcopy(self.data)
        data.pop('embedding')
        self.assertFalse(insights.has_embedding(data))
        self.vision_mock.reset_mock()
        data = insights.refresh_embedding(data, {})
        insights.save_record(data, self.vault)
        self.assertTrue(insights.has_embedding(data))
        self.vision_mock.assert_not_called()

    def test_ingest_optional_ai_skips_complete_records_and_preserves_failures(self):
        import process
        from ai import insights as ingest_ai
        with patch.object(process, 'VAULT', self.vault), patch.dict(os.environ, {'AEROBRAIN_NO_REMOTE': '0'}), \
             patch.object(ingest_ai, 'load_keys', return_value={'GEMINI_API_KEY': 'test'}), \
             patch.object(ingest_ai, 'build_record', side_effect=TimeoutError) as build:
            process.analyze_ingested_clip('clip_a')
            build.assert_not_called()
            process.analyze_ingested_clip('clip_b')
            build.assert_called_once()
            self.assertFalse((self.vault / 'ai/clip_b.json').exists())

    def test_looks_exist_in_studio(self):
        from insight_schema import LOOKS
        source = (Path(__file__).resolve().parent.parent / 'web/studio.js').read_text()
        for preset in LOOKS:
            self.assertIn(f'value="{preset}"', source)

    def test_http_contract_auth_and_preview_write_guard(self):
        import aerobrain_server as server
        with patch.object(server, 'VAULT', self.vault), patch.object(server, 'PREVIEW_PORT', 8807), \
             patch.object(server.H, '_auth_context', return_value={'user': 'daniel', 'dev_mode': True}):
            http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.H)
            worker = threading.Thread(target=http.serve_forever, daemon=True); worker.start()
            base = f'http://127.0.0.1:{http.server_port}'
            try:
                for path in ['/api/search?q=rio', '/api/collections', '/api/clip/clip_a/insight',
                             '/api/flight/clip_a/summary', '/api/trip/4.00,-74.00/recap']:
                    with urllib.request.urlopen(base + path) as response:
                        self.assertEqual(200, response.status)
                        self.assertIsInstance(json.load(response), dict)
                for path, status in [('/api/search', 400), ('/api/search?q=a&limit=0', 400),
                                     ('/api/clip/missing/insight', 404), ('/api/clip/%2E%2E/insight', 400)]:
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + path)
                    self.assertEqual(status, error.exception.code)
                with patch.object(server.H, '_auth_context', return_value=None):
                    for path in ['/api/search?q=rio', '/api/collections', '/api/clip/clip_a/insight',
                                 '/api/flight/clip_a/summary', '/api/trip/4.00,-74.00/recap']:
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            urllib.request.urlopen(base + path)
                        self.assertEqual(401, error.exception.code)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(base + '/api/analyze', data=b'{}'))
                self.assertEqual(403, error.exception.code)
            finally:
                http.shutdown(); http.server_close(); worker.join()


if __name__ == '__main__':
    unittest.main()
