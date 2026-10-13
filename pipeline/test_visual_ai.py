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
import backfill_summaries
from insight_schema import validate_insight


def fixture_insight():
    return {'caption': 'Río entre montañas.', 'caption_short': 'Río entre montañas',
            'tags': ['río', 'montañas'], 'subjects': ['río'],
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
        items = insights.collections(self.vault, all_items=True)['collections']
        self.assertEqual({'place', 'month', 'subject', 'shot_type'}, {x['kind'] for x in items})
        place = next(x for x in items if x['kind'] == 'place')
        self.assertEqual(2, place['count'])
        self.assertEqual('clip_a', place['cover']['clip_id'])
        self.assertTrue(place['cover']['frame_url'].endswith('.jpg'))

    def test_place_collection_keeps_owner_cover(self):
        self.write('manifest/trips_meta.json', {'4.00,-74.00': {'name': 'Mi viaje', 'cover': 'clip_b'}})
        place = next(c for c in insights.collections(self.vault, all_items=True)['collections'] if c['kind'] == 'place')
        self.assertEqual('Mi viaje', place['label'])
        self.assertEqual('clip_b', place['cover']['clip_id'])
        self.assertEqual('owner', place['cover']['selection'])

    def test_curation_minimum_limit_diversity_size_and_recency(self):
        self.assertEqual([], insights.collections(self.vault)['collections'])
        rows = []
        for i in range(24):
            cid = f'curated_{i}'
            rows.append({'clip_id': cid, 'duration_s': 120, 'date': f'2025-{i // 3 + 1:02d}-01',
                         'stats': {'home': [-74.05, 4.67]}})
            data = copy.deepcopy(self.data)
            data['clip_id'] = cid
            data['insight']['subjects'] = ['río', 'bosque', 'montañas', f'grupo {i // 3}']
            data['insight']['shot_type'] = ['cenital', 'ascenso', 'órbita'][i % 3]
            insights.save_record(data, self.vault)
        self.write('manifest/flights.json', {'flights': rows})
        all_items = insights.collections(self.vault, all_items=True)['collections']
        curated = insights.collections(self.vault)['collections']
        self.assertGreater(len(all_items), 12)
        self.assertEqual(12, len(curated))
        self.assertTrue(all(c['count'] >= 3 for c in curated))
        self.assertEqual({'place', 'month', 'subject', 'shot_type'}, {c['kind'] for c in curated})
        self.assertEqual(sorted(curated, key=lambda c: (-c['count'], -int(c['latest_date'].replace('-', '')))), curated)
        self.assertTrue(all(c['subtitle'] == f"{c['count']} clips · {c['count'] * 2} min" for c in curated))
        self.assertTrue(all(c['caption_short'] == 'Río entre montañas' for c in curated))
        self.assertIn('Agosto 2025', [c['label'] for c in curated])
        self.assertIn('Tomas cenitales', [c['label'] for c in curated])
        self.assertIn('Ascensos', [c['label'] for c in curated])

    def test_place_shift_keeps_metadata_and_nearest_label_never_coordinates(self):
        self.write('manifest/trips_meta.json', {'4.01,-74.01': {'name': 'Mi viaje', 'cover': 'clip_b'}})
        places = [c for c in insights.collections(self.vault, True)['collections'] if c['kind'] == 'place']
        self.assertEqual('Mi viaje', places[0]['label'])
        self.assertEqual('clip_b', places[0]['cover']['clip_id'])
        self.write('manifest/trips_meta.json', {})
        label = insights.collections(self.vault, True)['collections'][0]['label']
        self.assertNotIn('Zona', label)
        self.assertNotIn('-74', label)
        self.assertEqual('Bogotá', insights.place_title({'home': [-74.05, 4.67]}, {}, {}))
        self.assertTrue(insights.place_title({'home': [0, 0]}, {}, {}).startswith('Cerca de '))

    def test_caption_migration_fallback_and_no_praise(self):
        from insight_schema import PRAISE, trim_caption
        data = copy.deepcopy(self.data)
        data['insight']['caption'] = 'Un majestuoso río cruza el impresionante bosque. Una vista excelente.'
        for response in ['{"caption_short":"Río entre árboles"}', '{"caption_short":"Excelente río"}', '{}',
                         json.dumps({'caption_short': 'x' * 61})]:
            with patch.object(insights.router, 'short_caption', return_value=(response, {})):
                upgraded = insights.upgrade_caption(data, {})
                short = upgraded['insight']['caption_short']
                self.assertLessEqual(len(short), 60)
                self.assertFalse(PRAISE.search(short))
        with patch.object(insights.router, 'short_caption', side_effect=TimeoutError):
            self.assertEqual('trim', insights.upgrade_caption(data, {})['caption_short_source'])
        self.assertEqual('Un río cruza el bosque', trim_caption(data['insight']['caption']))
        for praise in ['excelente', 'impresionante', 'majestuoso', 'MAJESTUOSAS', 'hermoso', 'espectacular']:
            value = fixture_insight()
            value['caption_short'] = f'Río {praise}'
            with self.assertRaises(ValueError):
                validate_insight(value, 6, [0, 2, 4])
        self.assertLessEqual(len(trim_caption('Río ' * 30)), 60)
        self.assertEqual('Una toma cenital de un área urbana mostrando edificios',
                         trim_caption('Una toma cenital de un área urbana mostrando edificios con techos rojos.'))

    def test_new_vision_prompt_and_caption_remove_praise(self):
        value = fixture_insight()
        value['caption'] = 'Un majestuoso río entre impresionantes montañas.'
        self.vision_mock.return_value = (json.dumps(value), {'input_tokens': 1, 'output_tokens': 1})
        data = insights.build_record('clip_b', {}, self.vault)
        self.assertEqual('Un río entre montañas.', data['insight']['caption'])
        self.assertIn('sin elogios', self.vision_mock.call_args.args[0])
        self.assertIn('60 caracteres', self.vision_mock.call_args.args[0])

    def test_v1_read_only_upgrade_and_rollout_compatible_storage(self):
        stored = json.loads((self.vault / 'ai/clip_a.json').read_text())
        self.assertNotIn('caption_short', stored['insight'])
        stored.pop('caption_short')
        stored['schema_version'] = 1
        self.write('ai/clip_a.json', stored)
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        self.assertEqual('Río entre montañas', insights.get_insight('clip_a', self.vault)['insight']['caption_short'])
        result = insights.search('rio', vault=self.vault, embed=lambda q: [1, 0] + [0] * 766)
        self.assertEqual('Río entre montañas', result['results'][0]['caption_short'])
        self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())

    def test_backfill_skips_valid_records_force_and_bounded_retry(self):
        self.vision_mock.reset_mock(); self.embed_mock.reset_mock()
        with patch.object(insights, 'cache_summary', return_value={'cached': True}), \
             patch.object(insights.router, 'short_caption') as text_api:
            self.assertEqual(0, backfill_insights.backfill(1, vault=self.vault, keys={}, clip_ids=['clip_a']))
            self.vision_mock.assert_not_called(); self.embed_mock.assert_not_called(); text_api.assert_not_called()
            self.assertEqual(0, backfill_insights.backfill(1, vault=self.vault, keys={}, force=True, clip_ids=['clip_a']))
            self.vision_mock.assert_called_once()
            self.vision_mock.reset_mock()
            self.vision_mock.side_effect = TimeoutError
            self.assertEqual(1, backfill_insights.backfill(1, vault=self.vault, keys={}, attempts=2, clip_ids=['clip_b']))
            self.assertEqual(2, self.vision_mock.call_count)

    def test_backfill_migrates_once_without_vision_or_embedding(self):
        stored = json.loads((self.vault / 'ai/clip_a.json').read_text())
        stored.pop('caption_short')
        self.write('ai/clip_a.json', stored)
        self.vision_mock.reset_mock(); self.embed_mock.reset_mock()
        with patch.object(insights.router, 'short_caption', return_value=('{"caption_short":"Río entre montañas"}', {})) as api, \
             patch.object(insights, 'cache_summary', return_value={'cached': True}):
            for _ in range(2):
                self.assertEqual(0, backfill_insights.backfill(1, vault=self.vault, keys={}, clip_ids=['clip_a']))
            api.assert_called_once()
            self.vision_mock.assert_not_called(); self.embed_mock.assert_not_called()

    def test_short_caption_provider_is_bounded_and_records_usage(self):
        usage = {'prompt_tokens': 100, 'completion_tokens': 12}
        with patch.object(insights.router, '_post', return_value={
                'choices': [{'message': {'content': '{"caption_short":"Río entre árboles"}'}}],
                'usage': usage, 'model': 'deepseek-flash'}) as api:
            ledger = []
            token = insights.router.USAGE.set(ledger)
            try:
                raw, measured = insights.router.short_caption('Un río entre árboles.', {'DEEPSEEK_API_KEY': 'test'})
            finally:
                insights.router.USAGE.reset(token)
            self.assertEqual('Río entre árboles', json.loads(raw)['caption_short'])
            self.assertEqual([measured], ledger)
            self.assertEqual(100, api.call_args.args[1]['max_tokens'])
            self.assertEqual(30, api.call_args.kwargs['timeout'])

    def test_summary_cache_invalidation_failure_and_read_only_get(self):
        tid = insights.trip_groups(self.rows)[0]['id']
        for kind, identity in [('flight', 'clip_a'), ('trip', tid)]:
            distance = '100 m' if kind == 'flight' else '151 m'
            with patch.object(insights.router, 'summary_text', return_value=(
                    json.dumps({'sentences': [f'El recorrido suma {distance}.', 'El río se ve con luz suave.']}),
                    {'total_tokens': 20})) as api:
                self.assertFalse(insights.cache_summary(kind, identity, {}, self.vault)['cached'])
                self.assertTrue(insights.cache_summary(kind, identity, {}, self.vault)['cached'])
                self.assertEqual(1, api.call_count)
                self.assertEqual('ready', insights.get_summary(kind, identity, self.vault)['status'])
                stored = json.loads(insights.summary_path(kind, identity, self.vault).read_text())
                result, source = insights.summary_source(kind, identity, self.vault)
                old_evidence = [{'clip_id': f['clip_id'], 'caption': insights.record(f['clip_id'], self.vault).get('summary', ''),
                                 'stats': f['stats']} for f in self.rows if f['clip_id'] in result['clip_ids']]
                self.assertEqual(insights.digest({'data': result, 'evidence': old_evidence}), stored['source_hash'])
                self.assertEqual(insights.digest(source), stored['summary_hash'])
            target = insights.summary_path(kind, identity, self.vault)
            before = target.read_bytes()
            self.rows[0]['stats']['distance_m'] += 1
            self.write('manifest/flights.json', {'flights': self.rows})
            self.assertEqual('pending', insights.get_summary(kind, identity, self.vault)['status'])
            with patch.object(insights.router, 'summary_text', return_value=('{}', {})):
                insights.cache_summary(kind, identity, {}, self.vault)
            self.assertNotEqual(before, target.read_bytes())
            self.assertEqual('template', json.loads(target.read_text())['origin'])
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

    def test_summary_validation_and_deterministic_fallback(self):
        bad = ['DJI_20260704160159_0103_D', 'clip_a', 'score 0.9', 'puntuación 1',
               'selección de IA', 'viaje sugerido', 'paisaje impresionante', '10.880,5 metros',
               'calidad 9/10', '52 vuelos', '1000 metros']
        for phrase in bad:
            with self.subTest(phrase=phrase):
                target = insights.summary_path('flight', 'clip_a', self.vault)
                target.unlink(missing_ok=True)
                raw = json.dumps({'sentences': ['El recorrido suma 100 m.', f'Se ve {phrase}.']})
                with patch.object(insights.router, 'summary_text', return_value=(raw, {'total_tokens': 20})):
                    outcome = insights.cache_summary('flight', 'clip_a', {}, self.vault)
                self.assertEqual('template', outcome['origin'])
                self.assertEqual(20, outcome['usage']['total_tokens'])
                text = insights.get_summary('flight', 'clip_a', self.vault)['summary']
                self.assertIn('100 m.', text)
                self.assertIn('río', text)
                self.assertIn('luz suave', text)
        for raw in ['{}', 'not json', '{"sentences": [null, 2]}',
                    '{"sentences": ["Uno. Dos.", "Tres."]}']:
            target.unlink()
            with patch.object(insights.router, 'summary_text', return_value=(raw, {})):
                self.assertEqual('template', insights.cache_summary('flight', 'clip_a', {}, self.vault)['origin'])
        target.unlink()
        with patch.object(insights.router, 'summary_text', side_effect=TimeoutError):
            self.assertEqual('template', insights.cache_summary('flight', 'clip_a', {}, self.vault)['origin'])
        _, source = insights.summary_source('flight', 'clip_a', self.vault)
        self.assertFalse(insights.valid_summary('El río se ve a 100 m. La luz es suave.', source))

    def test_distance_format_and_valid_model_summary(self):
        for distance, expected in [(None, ''), (327.5, '328 m'), (999, '999 m'),
                                    (1000, '1,0 km'), (10880.5, '10,9 km')]:
            self.assertEqual(expected, insights.format_distance(distance))
        self.rows[0]['stats']['distance_m'] = 10880.5
        self.write('manifest/flights.json', {'flights': self.rows})
        text = 'El recorrido suma 10,9 km entre montañas. El río se ve con luz suave.'
        with patch.object(insights.router, 'summary_text', return_value=(
                json.dumps({'sentences': ['El recorrido suma 10,9 km entre montañas.',
                                           'El río se ve con luz suave.']}), {})):
            result = insights.cache_summary('flight', 'clip_a', {}, self.vault)
        self.assertEqual('deepseek', result['origin'])
        self.assertEqual(text, insights.get_summary('flight', 'clip_a', self.vault)['summary'])

    def test_summary_prompt_has_visual_evidence_without_telemetry(self):
        _, source = insights.summary_source('flight', 'clip_a', self.vault)
        response = {'choices': [{'message': {'content': '{}'}}], 'usage': {}}
        with patch.object(insights.router, '_post', return_value=response) as api:
            insights.router.summary_text(source, {'DEEPSEEK_API_KEY': 'test'})
        prompt = api.call_args.args[1]['messages'][0]['content'].split('Datos: ')[1]
        for internal in ['clip_a', 'best_moment', 'suggested', 'score', 'max_altitude']:
            self.assertNotIn(internal, prompt)
        for field in ['río', 'Luz suave', '100 m']:
            self.assertIn(field, prompt)

    def test_summary_only_backfill_bounds_cache_version_and_no_vision(self):
        tid = insights.trip_groups(self.rows)[0]['id']
        for kind, identity in [('flight', 'clip_a'), ('trip', tid)]:
            target = insights.summary_path(kind, identity, self.vault)
            target.parent.mkdir(exist_ok=True)
            target.write_text(json.dumps({'source_hash': 'old', 'summary': 'El viaje sugerido.'}))
        before = {p: p.read_bytes() for p in self.vault.rglob('*.json')}
        self.vision_mock.reset_mock(); self.embed_mock.reset_mock()
        with patch.object(insights.router, 'summary_text', return_value=('{}', {})) as api:
            self.assertEqual(1, backfill_summaries.backfill(1, True, self.vault)['selected'])
            api.assert_not_called()
            self.assertEqual(before, {p: p.read_bytes() for p in self.vault.rglob('*.json')})
            self.assertEqual(1, backfill_summaries.backfill(1, vault=self.vault, keys={})['calls'])
            self.assertEqual(1, api.call_count)
            self.assertEqual(1, backfill_summaries.backfill(10, vault=self.vault, deterministic=True)['templates'])
            self.assertEqual(0, backfill_summaries.backfill(10, vault=self.vault, keys={})['selected'])
        self.vision_mock.assert_not_called(); self.embed_mock.assert_not_called()

    def test_collection_covers_are_unique_clean_and_best_frames(self):
        b = copy.deepcopy(self.data)
        b['clip_id'] = 'clip_b'
        b['insight']['highlight_segments'][0]['score'] = 1
        b['insight']['caption'] = 'Un letrero SE VENDE con teléfono.'
        self.write('ai/clip_b.json', b)
        result = insights.collections(self.vault, True)['collections']
        place = next(c for c in result if c['kind'] == 'place')
        self.assertEqual('clip_a', place['cover']['clip_id'])
        self.assertEqual(2, place['cover']['frame_time_s'])
        urls = [c['cover']['frame_url'] for c in result]
        self.assertEqual(len(urls), len(set(urls)))
        for field, value in [('caption', 'Texto sobre el edificio.'), ('tags', ['cartel']),
                             ('caption', 'Un lote en venta.')]:
            b['insight'] = fixture_insight()
            b['insight'][field] = value
            b['insight']['highlight_segments'][0]['score'] = 1
            self.write('ai/clip_b.json', b)
            place = next(c for c in insights.collections(self.vault, True)['collections'] if c['kind'] == 'place')
            self.assertEqual('clip_a', place['cover']['clip_id'])
        b['insight'] = fixture_insight()
        b['insight']['highlight_segments'][0]['score'] = 1
        b['insight']['quality_flags'] = ['sobreexpuesto']
        self.write('ai/clip_b.json', b)
        place = next(c for c in insights.collections(self.vault, True)['collections'] if c['kind'] == 'place')
        self.assertEqual('clip_a', place['cover']['clip_id'])
        b['insight']['quality_flags'] = []
        b['insight']['highlight_segments'][0]['reason'] = 'Un letrero SE VENDE.'
        self.write('ai/clip_b.json', b)
        place = next(c for c in insights.collections(self.vault, True)['collections'] if c['kind'] == 'place')
        self.assertEqual('clip_a', place['cover']['clip_id'])

    def test_exhausted_covers_do_not_repeat_and_get_does_not_write(self):
        before = {p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}
        with patch.object(insights, 'moment', return_value={
                'clip_id': 'clip_a', 'frame_url': '/same.jpg', 'score': 1, 'selection': 'ai'}):
            self.assertEqual(1, len(insights.collections(self.vault, True)['collections']))
        self.assertEqual(before, {p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()})

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
                with urllib.request.urlopen(base + '/api/collections') as response:
                    self.assertEqual([], json.load(response)['collections'])
                with urllib.request.urlopen(base + '/api/collections?all=1') as response:
                    items = json.load(response)['collections']
                    self.assertGreater(len(items), 0)
                    self.assertIn('caption_short', items[0])
                    self.assertIn('subtitle', items[0])
                with urllib.request.urlopen(base + '/api/clip/clip_a/insight') as response:
                    self.assertEqual('Río entre montañas', json.load(response)['insight']['caption_short'])
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
