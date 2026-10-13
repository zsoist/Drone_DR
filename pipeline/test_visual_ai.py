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
    return {'caption': 'Río azul entre montañas.', 'caption_short': 'Río azul entre montañas',
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
                from PIL import Image
                Image.new('RGB', (16, 16), (120, 120, 120)).save(
                    self.vault / 'frames' / cid / f'f_{i:04d}.jpg')
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

    def test_search_retains_private_archive_matches_with_quality(self):
        from PIL import Image
        data = copy.deepcopy(self.data)
        data['insight']['caption'] = 'Río junto a un cartel con teléfono.'
        self.write('ai/clip_a.json', data)
        self.assertEqual('rejected', insights.search('río', vault=self.vault)['results'][0]['matched_moment']['quality']['status'])
        self.write('ai/clip_a.json', self.data)
        for frame in (self.vault / 'frames/clip_a').glob('*.jpg'):
            Image.new('RGB', (16, 16), (5,) * 3).save(frame)
        self.assertEqual('rejected', insights.search('río', vault=self.vault)['results'][0]['matched_moment']['quality']['status'])

    def test_uniform_sample_grid_is_not_a_real_highlight(self):
        data = insights.public_record('clip_a', self.vault)
        self.assertEqual([], data['highlights'])
        self.assertTrue(data['synthetic'])
        self.assertEqual([], data['insight']['highlight_segments'])

    def peak_fixture(self, reasons):
        from PIL import Image
        data = copy.deepcopy(self.data)
        data['duration_s'] = 80
        data['sampled_frame_times'] = [0, 10, 30, 50, 70]
        data['insight']['best_frame_times'] = [10, 30, 50, 70]
        data['insight']['subjects'] = ['río', 'fachada de ladrillo']
        data['insight']['highlight_segments'] = [
            {'start': t - 4, 'end': t + 6, 'score': .9, 'reason': reason}
            for t, reason in zip((10, 30, 50, 70), reasons)]
        # One isolated jump, one broad peak, then another isolated jump.
        levels = {10: 210, 28: 180, 30: 120, 32: 90, 50: 210, 70: 100}
        level = 100
        for t in range(0, 80, 2):
            level = levels.get(t, level)
            Image.new('RGB', (16, 16), (level,) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{t // 2 + 1:04d}.jpg')
        self.write('ai/clip_a.json', data)
        return data

    def test_peak_labels_use_only_matching_temporal_evidence(self):
        self.peak_fixture(['Paso sobre la fachada de ladrillo', 'Giro junto al río azul',
                           'Cambio de escena en el recorrido.', 'Giro junto al río azul'])
        result = insights.public_record('clip_a', self.vault)
        labels = [h.get('label') for h in result['highlights']]
        self.assertEqual(['Paso sobre la fachada de ladrillo', 'Giro junto al río azul', None, None], labels)
        self.assertTrue(all(len(label) <= 40 for label in labels if label))

    def test_peak_width_controls_duration(self):
        self.peak_fixture(['Paso sobre el río azul'] * 4)
        spans = insights.public_record('clip_a', self.vault)['highlights']
        self.assertEqual([3, 6, 3, 3], [round(h['end'] - h['start'], 3) for h in spans])
        for h in spans:
            self.assertLessEqual(h['start'], h['evidence']['peak_time_s'])
            self.assertGreater(h['end'], h['evidence']['peak_time_s'])

    def test_caption_fields_do_not_use_highlight_labels(self):
        data = self.peak_fixture(['Paso sobre la fachada de ladrillo', 'Giro junto al río azul'])
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        self.vision_mock.reset_mock(); self.embed_mock.reset_mock()
        public = insights.public_record('clip_a', self.vault)
        summary = insights.get_summary('flight', 'clip_a', self.vault)
        detail = insights.get_insight('clip_a', self.vault)
        tid = insights.trip_groups(self.rows)[0]['id']
        recap = insights.get_summary('trip', tid, self.vault)
        for item in [public, summary['cover'], summary['best_moment'], *recap['best_frames'], *detail['frames']]:
            self.assertEqual('Río azul entre montañas.', item.get('caption'))
            self.assertEqual('Río azul entre montañas', item.get('caption_short'))
        frame = insights.moment('clip_a', data, vault=self.vault)
        self.assertEqual('Río azul entre montañas', frame['label'])
        self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())
        self.vision_mock.assert_not_called(); self.embed_mock.assert_not_called()

    def test_peak_label_omits_static_generic_or_out_of_time_text(self):
        data = self.peak_fixture(['Fachada de ladrillo junto al río', 'Vuelo sobre el paisaje',
                                  'Paso sobre la fachada de ladrillo junto al parque', 'Giro junto al río azul'])
        # A reason after the peak cannot label an earlier frame.
        data['insight']['highlight_segments'][-1]['start'] = 71
        self.write('ai/clip_a.json', data)
        labels = [h.get('label') for h in insights.public_record('clip_a', self.vault)['highlights']]
        self.assertEqual([None, None, 'Paso sobre la fachada de ladrillo', None], labels)

    def test_trimming_does_not_leave_an_action_without_its_subject(self):
        self.peak_fixture(['Movimiento de transición que revela nuevos edificios y zonas verdes.'])
        self.assertTrue(all('label' not in h for h in insights.public_record('clip_a', self.vault)['highlights']))

    def test_wide_peak_and_clip_edges_bound_duration(self):
        from PIL import Image
        data = self.peak_fixture(['Paso sobre la fachada de ladrillo'] * 4)
        data['insight']['best_frame_times'] = [0, 10, 30, 50, 70]
        data['insight']['highlight_segments'] = [
            {'start': 0, 'end': 80, 'score': .9, 'reason': 'Paso sobre la fachada de ladrillo'}]
        # A 16-second pulse, with a taller center, exceeds the 12-second limit.
        levels = {2: 160, 22: 120, 24: 160, 26: 120, 28: 160,
                  30: 90, 32: 130, 34: 90, 36: 130, 78: 210}
        level = 100
        for t in range(0, 80, 2):
            level = levels.get(t, level)
            Image.new('RGB', (16, 16), (level,) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{t // 2 + 1:04d}.jpg')
        self.write('ai/clip_a.json', data)
        spans = insights.public_record('clip_a', self.vault)['highlights']
        self.assertEqual([3, 12, 3], [s['end'] - s['start'] for s in spans])
        for s in spans:
            self.assertTrue(0 <= s['start'] <= s['evidence']['peak_time_s'] < s['end'] <= 80)
        data['duration_s'] = 2.9
        self.assertEqual([], insights.highlight_peaks.derive(data, self.vault)['segments'])

    def test_reel_keeps_the_full_measured_peak_span(self):
        import reel
        data = self.peak_fixture(['Paso sobre la fachada de ladrillo', 'Giro junto al río azul'])
        data['clip_id'] = 'DJI_a'
        self.write('ai/DJI_a.json', data)
        (self.vault / 'frames/clip_a').rename(self.vault / 'frames/DJI_a')
        (self.vault / 'proxies').mkdir()
        (self.vault / 'proxies/DJI_a.mp4').write_bytes(b'proxy')
        with patch.object(reel, 'VAULT', self.vault):
            spans = reel.collect(None)
        self.assertEqual([3, 3, 3, 6], sorted(s['duration_s'] for s in spans))

    def test_property_copy_has_no_observation_stutter(self):
        import property_copy
        text = property_copy.template({}, [{'caption': 'Valle montañoso con casas y una calle.', 'tags': []}])
        self.assertNotRegex(text.lower(), r'se observ[ae]n?')

    def test_legacy_flight_summary_is_one_factual_sentence_block(self):
        data = copy.deepcopy(self.data)
        data['summary'] = 'Se observa un río.\nSe observan montañas.'
        self.write('ai/clip_a.json', data)
        summary = insights.public_record('clip_a', self.vault)['summary']
        self.assertNotIn('\n', summary)
        self.assertNotRegex(summary.lower(), r'se observ[ae]n?')
        self.assertIn('100 m', summary)
        self.assertTrue(summary.endswith('.'))
        self.assertEqual(2, summary.count('.'))

    def test_gallery_spacing_and_quality(self):
        from PIL import Image
        data = copy.deepcopy(self.data)
        data['duration_s'] = 130
        data['sampled_frame_times'] = list(range(0, 121, 10))
        data['insight']['best_frame_times'] = [0, 10, 20, 30, 40, 50]
        self.write('ai/clip_a.json', data)
        for t in range(0, 121, 2):
            Image.new('RGB', (16, 16), (120,) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{t // 2 + 1:04d}.jpg')
        gallery = insights.property_media({'clip': 'clip_a'}, self.vault)['gallery']
        self.assertGreaterEqual(len(gallery), 4)
        self.assertLessEqual(len(gallery), 6)
        for i, frame in enumerate(gallery):
            self.assertEqual('ok', frame['quality']['status'])
            for other in gallery[i + 1:]:
                self.assertGreaterEqual(abs(frame['frame_time_s'] - other['frame_time_s']), 20)

    def test_local_highlight_tracks_a_scene_change_not_the_sampling_grid(self):
        from PIL import Image
        data = copy.deepcopy(self.data)
        data['duration_s'] = 70
        data['sampled_frame_times'] = [0, 10, 20, 30, 40, 50, 60]
        data['insight']['best_frame_times'] = [30]
        data['insight']['highlight_segments'] = [
            {'start': t, 'end': t + 10, 'score': .8, 'reason': 'Río entre montañas.'}
            for t in (0, 20, 40, 60)]
        self.write('ai/clip_a.json', data)
        for t in range(0, 70, 2):
            Image.new('RGB', (16, 16), ((100 if t < 26 else 210),) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{t // 2 + 1:04d}.jpg')
        result = insights.public_record('clip_a', self.vault)
        self.assertEqual(1, len(result['highlights']))
        h = result['highlights'][0]
        self.assertLessEqual(h['start'], 26)
        self.assertGreater(h['end'], 26)
        self.assertTrue(3 <= h['end'] - h['start'] <= 12)
        self.assertNotIn(h['start'], [0, 20, 40, 60])
        self.assertFalse(h['synthetic'])
        self.assertEqual('keyframe_difference', h['evidence']['method'])
        # A new image sequence must invalidate cached peaks, even with the same vision scores.
        for t in range(0, 70, 2):
            Image.new('RGB', (16, 16), ((100 if t < 46 else 210),) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{t // 2 + 1:04d}.jpg')
        moved = insights.public_record('clip_a', self.vault)['highlights']
        self.assertEqual(1, len(moved))
        self.assertEqual(46, moved[0]['evidence']['peak_time_s'])
        self.assertEqual((43.5, 46.5), (moved[0]['start'], moved[0]['end']))

    def test_json_projection_covers_nested_cards_and_never_trusts_cached_quality(self):
        from ai.frame_api import project
        data = copy.deepcopy(self.data)
        data['insight']['caption'] = 'Río junto a un cartel de venta.'
        self.write('ai/clip_a.json', data)
        frame = {'clip_id': 'clip_a', 'frame_url': '/data/frames/clip_a/f_0001.jpg',
                 'quality': {'status': 'ok', 'eligible': True}}
        payload = {'unrelated': [None, 1], 'gallery': [frame], 'recent': [{'thumb': '/data/thumbs/clip_a.jpg'}],
                   'journal': [frame], 'assets': {'poster': 'data/thumbs/clip_a.jpg'}}
        result = project(payload, self.vault)
        self.assertEqual([], result['gallery'])
        self.assertEqual([], result['journal'])
        self.assertIsNone(result['recent'][0]['thumb'])
        self.assertEqual('rejected', result['recent'][0]['thumb_quality']['status'])
        self.assertIsNone(result['assets']['poster'])
        self.assertEqual('text_or_sign', result['assets']['poster_quality']['reason'])
        self.assertEqual('ok', payload['gallery'][0]['quality']['status'])
        self.assertEqual([None, 1], result['unrelated'])

    def test_local_backfill_is_bounded_free_backed_up_and_idempotent(self):
        import backfill_frame_quality
        (self.vault / 'properties').mkdir()
        prop = {'clip': 'clip_a', 'descripcion_source': 'ai_template'}
        self.write('properties/demo.json', prop)
        before = {p: p.read_bytes() for p in self.vault.rglob('*.json')}
        backup = self.vault / 'backup'
        dry = backfill_frame_quality.backfill(1, backup, self.vault, True)
        self.assertEqual(0, dry['provider_calls'])
        self.assertEqual(before, {p: p.read_bytes() for p in self.vault.rglob('*.json')})
        report = backfill_frame_quality.backfill(1, backup, self.vault)
        self.assertEqual(1, report['clips_written'])
        self.assertEqual(1, report['properties_written'])
        self.assertEqual(0, report['estimated_usd'])
        self.assertEqual(before[self.vault / 'ai/clip_a.json'], (backup / 'ai/clip_a.json').read_bytes())
        self.assertEqual([], insights.read(self.vault / 'ai/clip_a.json')['highlights'])
        self.assertEqual(1, len(insights.read(self.vault / 'properties/demo.json')['gallery']))
        again = backfill_frame_quality.backfill(1, backup, self.vault)
        self.assertEqual((0, 0, 0), tuple(again[k] for k in
                                        ('clips_written', 'properties_written', 'summaries_written')))

    def test_mundo_uses_filtered_source_frames_when_poster_is_missing(self):
        from ai.frame_api import project
        (self.vault / 'models/recon_test').mkdir(parents=True)
        self.write('models/recon_test/meta.json', {'sources': ['clip_a']})
        result = project({'clip_id': 'recon_test', 'assets': {}}, self.vault)
        self.assertEqual('/data/frames/clip_a/f_0002.jpg', result['assets']['poster'])
        self.assertEqual('ok', result['assets']['poster_quality']['status'])
        data = copy.deepcopy(self.data)
        data['insight']['caption'] = 'Un cartel de venta.'
        self.write('ai/clip_a.json', data)
        rejected = project({'clip_id': 'recon_test', 'assets': {'poster': '/old.jpg'}}, self.vault)
        self.assertIsNone(rejected['assets']['poster'])

    def test_shared_cover_filter_rejects_private_dark_and_unreadable_frames(self):
        from PIL import Image
        for cid in ('clip_a', 'clip_b'):
            for i, brightness in [(1, 5), (2, 100), (3, 200)]:
                Image.new('RGB', (16, 16), (brightness,) * 3).save(
                    self.vault / 'frames' / cid / f'f_{i:04d}.jpg')
        data = copy.deepcopy(self.data)
        data['insight']['best_frame_times'] = [0, 2, 4]
        self.write('ai/clip_a.json', data)
        cover = insights.public_record('clip_a', self.vault)['cover']
        self.assertEqual(4, cover['frame_time_s'])
        self.assertTrue(cover['quality']['eligible'])
        self.assertGreater(cover['quality']['mean_luminance'], 190)
        for text in ['SE VENDE ESTE LOTE', 'Un número en la fachada', 'Un teléfono',
                     'Un cartel', 'Un letrero', 'Texto en la pared', 'Hombre en primer plano',
                     'Una pareja sentada', 'Jóvenes en primer plano', 'Gente en un patio']:
            data['insight']['caption'] = text
            self.write('ai/clip_a.json', data)
            with self.subTest(text=text):
                self.assertIsNone(insights.public_record('clip_a', self.vault)['cover'])
                recap, _ = insights.summary_source('trip', '4.00,-74.00', self.vault)
                self.assertNotIn('clip_a', [m['clip_id'] for m in recap['best_frames']])
                self.assertFalse(insights.collections(self.vault, True)['collections'])
        data['insight']['caption'] = 'Río entre montañas.'
        self.write('ai/clip_a.json', data)
        for frame in (self.vault / 'frames/clip_a').glob('*.jpg'):
            frame.write_bytes(b'broken')
        self.assertIsNone(insights.public_record('clip_a', self.vault)['cover'])

    def test_best_frames_precede_brighter_samples(self):
        from PIL import Image
        for i, level in [(1, 250), (2, 100), (3, 240)]:
            Image.new('RGB', (16, 16), (level,) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{i:04d}.jpg')
        cover = insights.public_record('clip_a', self.vault)['cover']
        self.assertEqual(2, cover['frame_time_s'])
        self.assertTrue(cover['is_best_frame'])
        recap, _ = insights.summary_source('trip', '4.00,-74.00', self.vault)
        self.assertEqual(2, recap['best_frames'][0]['frame_time_s'])

    def test_caption_depth_and_full_caption_repair(self):
        from insight_schema import valid_short
        for bad in ['Edificios', 'Edificios urbanos', 'Río entre montañas',
                    'Uno dos tres cuatro cinco seis siete ocho nueve diez']:
            self.assertFalse(valid_short(bad), bad)
        data = copy.deepcopy(self.data)
        data['insight']['caption'] = 'Edificios de ladrillo junto a cerros bajo cielo nublado.'
        data['insight']['caption_short'] = 'Edificios urbanos'
        self.write('ai/clip_a.json', data)
        short = insights.record('clip_a', self.vault)['insight']['caption_short']
        self.assertTrue(valid_short(short), short)
        self.assertIn('ladrillo', short)
        self.assertIn('cerros', short)

    def test_summary_exposes_all_real_highlights_with_labels(self):
        from PIL import Image
        for i in (2, 3):
            Image.new('RGB', (16, 16), (220,) * 3).save(
                self.vault / 'frames/clip_a' / f'f_{i:04d}.jpg')
        data = copy.deepcopy(self.data)
        data['insight']['highlight_segments'][0]['reason'] = 'Paso sobre el río azul'
        data['insight']['highlight_segments'].append(
            {'start': 4, 'end': 6, 'score': .7, 'reason': 'Montañas al fondo.'})
        self.write('ai/clip_a.json', data)
        result = insights.get_summary('flight', 'clip_a', self.vault)
        self.assertEqual(1, len(result['highlights']))
        self.assertEqual(2, result['highlights'][0]['evidence']['peak_time_s'])
        self.assertEqual((0, 3), tuple(result['highlights'][0][k] for k in ('start', 'end')))
        self.assertTrue(result['best_moment']['label'])

    def test_property_copy_uses_visual_facts_without_access_claims(self):
        import property_copy
        evidence = [{'caption': 'Un pueblo en un valle montañoso con vegetación tropical. '
                                'Una calle pasa junto a casas y palmeras.', 'tags': ['valle', 'calle']}]
        prop = {'titulo': 'Lote', 'ubicacion': 'Guaduas', 'area': '1200'}
        text = property_copy.template(prop, evidence)
        self.assertTrue(property_copy.validate_copy(text, evidence), text)
        self.assertIn('valle', text)
        self.assertIn('calle', text)
        self.assertNotIn('acceso', text)
        self.assertFalse(property_copy.validate_copy('Lote en Guaduas. Área: 1200 m².'))
        self.assertFalse(property_copy.validate_copy('El lote tiene acceso pavimentado. Tiene servicios públicos.', evidence))

    def test_caption_regeneration_limits_calls_and_reports_measured_cost(self):
        import backfill_output_contract
        for cid in ('clip_a', 'clip_b'):
            stored = copy.deepcopy(self.data)
            stored['clip_id'] = cid
            stored['insight']['caption_short'] = 'Río'
            self.write(f'ai/{cid}.json', stored)
        def provider(*args):
            usage = {'prompt_tokens': 100, 'completion_tokens': 10}
            insights.router.note_usage(usage)
            return '{"caption_short":"Río azul entre las montañas."}', usage
        with patch.object(insights.router, 'short_caption', side_effect=provider) as api:
            report = backfill_output_contract.backfill(
                1, [], self.vault / 'backup', True, self.vault, {}, refresh_captions=True)
            api.assert_not_called()
            self.assertEqual(1, report['caption_calls_planned'])
            report = backfill_output_contract.backfill(
                1, [], self.vault / 'backup', False, self.vault, {}, refresh_captions=True)
            self.assertEqual(1, api.call_count)
            self.assertEqual(1, report['captions_written'])
            self.assertEqual(0, report['text_calls_without_usage'])
            self.assertAlmostEqual(.000042, report['estimated_total_usd'])
            self.assertEqual('Río azul entre las montañas', insights.record('clip_a', self.vault)['caption_short'])

    def test_cover_owner_choice_cannot_bypass_privacy_policy(self):
        data = copy.deepcopy(self.data)
        data['clip_id'] = 'clip_b'
        data['insight']['caption'] = 'Un cartel de venta.'
        self.write('ai/clip_b.json', data)
        self.write('manifest/trips_meta.json', {'4.00,-74.00': {'cover': 'clip_b'}})
        result = insights.collections(self.vault, True)
        self.assertTrue(all(c['cover']['clip_id'] == 'clip_a' for c in result['collections']))
        self.assertEqual('clip_b', insights.read(self.vault / 'manifest/trips_meta.json')['4.00,-74.00']['cover'])

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

    def test_empty_evidence_has_no_best_moment_or_generated_highlights(self):
        self.write('ai/clip_b.json', {'clip_id': 'clip_b', 'best_thumbnail_t': 0,
                                    'highlights': [{'t': 0}, {'t': 90}]})
        result, _ = insights.summary_source('flight', 'clip_b', self.vault)
        self.assertIsNone(result['best_moment'])
        value = fixture_insight()
        value['highlight_segments'] = []
        self.vision_mock.return_value = (json.dumps(value), {'input_tokens': 1, 'output_tokens': 1})
        data = insights.build_record('clip_b', {}, self.vault)
        self.assertEqual([], data['highlights'])
        self.assertEqual(0, data['travel_score'])

    def test_provider_scores_alone_do_not_establish_a_best_moment(self):
        value = copy.deepcopy(self.data)
        value['insight']['best_frame_times'] = [0, 2]
        value['insight']['highlight_segments'] = [
            {'start': 0, 'end': 1, 'score': .8, 'reason': 'Río.'},
            {'start': 3, 'end': 5, 'score': .9, 'reason': 'Montañas.'}]
        self.write('ai/clip_a.json', value)
        result, _ = insights.summary_source('flight', 'clip_a', self.vault)
        self.assertIsNone(result['best_moment'])
        value['insight']['highlight_segments'][0]['score'] = .9
        self.write('ai/clip_a.json', value)
        self.assertIsNone(insights.summary_source('flight', 'clip_a', self.vault)[0]['best_moment'])
        value['insight']['highlight_segments'][0]['score'] = 1
        self.write('ai/clip_a.json', value)
        self.assertIsNone(insights.summary_source('flight', 'clip_a', self.vault)[0]['best_moment'])
        value['insight']['highlight_segments'][0]['end'] = 3
        self.write('ai/clip_a.json', value)
        self.assertIsNone(insights.summary_source('flight', 'clip_a', self.vault)[0]['best_moment'])

    def test_tags_normalize_on_generation_and_read_without_writes(self):
        value = fixture_insight()
        value['tags'] = ['drone', 'Dron', 'vista aérea', 'river', 'RÍO', 'sunset', 'buildings']
        self.vision_mock.return_value = (json.dumps(value), {'input_tokens': 1, 'output_tokens': 1})
        self.assertEqual(['río', 'atardecer', 'edificios'],
                         insights.build_record('clip_b', {}, self.vault)['tags'])
        stored = copy.deepcopy(self.data)
        stored['insight'] = value
        self.write('ai/clip_a.json', stored)
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        self.assertEqual(['río', 'atardecer', 'edificios'], insights.get_insight('clip_a', self.vault)['insight']['tags'])
        self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())

    def test_tag_glossary_covers_stored_english_and_generic_variants(self):
        from insight_schema import normalize_tags
        self.assertEqual(['pantalones de mezclilla', 'río'], normalize_tags([
            'drone shot', 'vista_aerea', 'vistas aereas', 'jeans', 'river', 'RÍO']))

    def test_short_caption_has_subject_and_no_dangling_phrase(self):
        from insight_schema import trim_caption, valid_short
        for bad in ['Dron muestra edificios', 'Vista aérea de un río', 'Dron vuela sobre casas',
                    'Edificios con tejado verde y un área', 'Edificios y', 'Casas con un', 'Edificios…']:
            with self.subTest(bad=bad):
                self.assertFalse(valid_short(bad))
                short = trim_caption(bad)
                self.assertFalse(short.endswith((' y', ' con', ' de')))
        self.assertEqual('Edificios con tejado verde', trim_caption('Edificios con tejado verde y un área'))
        self.assertEqual('Edificios', trim_caption('Dron muestra edificios'))
        self.assertEqual('Un río', trim_caption('Vista aérea de un río'))
        self.assertEqual('Escena del vuelo', trim_caption('x' * 70))

    def test_collections_keep_exact_duration_and_group_rank(self):
        self.rows[0]['duration_s'] = 4543.4
        self.rows[1]['duration_s'] = 16.5
        self.write('manifest/flights.json', {'flights': self.rows})
        items = insights.collections(self.vault, True)['collections']
        place = next(c for c in items if c['kind'] == 'place')
        self.assertAlmostEqual(4559.9, place['duration_s'])
        self.assertIn('75 min 59 s', place['subtitle'])
        self.assertEqual(['place', 'month', 'shot'], [c['kind'] for c in items])
        self.assertEqual([1, 2, 3], [c['rank'] for c in items])

    def test_legacy_api_projects_segments_and_keeps_owner_marks_separate(self):
        stored = copy.deepcopy(self.data)
        stored['highlights'] = [{'t': 0, 'reason': 'Placeholder'},
                                {'t': 2, 'reason': 'Mi marca', 'type': 'manual'}]
        self.write('ai/clip_a.json', stored)
        data = insights.public_record('clip_a', self.vault)
        self.assertEqual([], data['highlights'])
        self.assertTrue(data['synthetic'])
        self.assertEqual('Mi marca', data['owner_highlights'][0]['reason'])
        self.write('ai/clip_b.json', {'clip_id': 'clip_b', 'highlights': [{'t': 0}]})
        self.assertEqual([], insights.public_record('clip_b', self.vault)['highlights'])
        self.assertTrue(insights.public_record('clip_b', self.vault)['synthetic'])

    def test_reel_uses_scored_segment_bounds_without_legacy_spacing(self):
        import reel
        from PIL import Image
        (self.vault / 'proxies').mkdir()
        for cid in ['DJI_a', 'DJI_b']:
            (self.vault / 'proxies' / f'{cid}.mp4').write_bytes(b'proxy')
        data = copy.deepcopy(self.data)
        data['clip_id'] = 'DJI_a'
        data['highlights'] = [{'t': 0}, {'t': 90}]
        self.write('ai/DJI_a.json', data)
        (self.vault / 'frames/DJI_a').mkdir()
        for i in range(1, 4):
            Image.new('RGB', (16, 16), ((120 if i == 1 else 220),) * 3).save(
                self.vault / 'frames/DJI_a' / f'f_{i:04d}.jpg')
        self.write('ai/DJI_b.json', {'clip_id': 'DJI_b', 'highlights': [{'t': 0}], 'travel_score': 10})
        with patch.object(reel, 'VAULT', self.vault):
            moments = reel.collect(None)
        self.assertEqual(1, len(moments))
        self.assertEqual((0, 3), (moments[0]['t'], moments[0]['duration_s']))
        self.assertGreater(moments[0]['score'], .8)

    def test_property_copy_rejects_praise_and_excludes_old_copy_from_prompt(self):
        import property_copy
        prop = {'titulo': 'Lote', 'ubicacion': 'Guaduas', 'area': '1200',
                'precio': '$320.000.000 COP', 'descripcion': 'Old untrusted copy', 'whatsapp': 'secret'}
        for praise in ['oportunidad única', 'belleza escénica', 'ubicación privilegiada', 'plusvalía']:
            result = property_copy.generate(prop, lambda prompt: f'Una {praise}.')
            self.assertEqual(property_copy.template(prop), result)
            self.assertEqual('', result)
            self.assertNotIn(praise, result)
        prompts = []
        def provider(prompt):
            prompts.append(prompt)
            return 'El lote está en Guaduas.'
        evidence = [{'caption': 'Casas en un valle montañoso.', 'tags': []}]
        self.assertEqual(property_copy.template(prop, evidence), property_copy.generate(prop, provider, evidence))
        self.assertNotIn('Old untrusted copy', prompts[0])
        self.assertNotIn('secret', prompts[0])
        self.assertEqual(property_copy.template(prop), property_copy.generate(prop, lambda p: 1 / 0))

    def test_contract_backfill_is_bounded_backed_up_and_idempotent(self):
        import backfill_output_contract
        original = copy.deepcopy(self.data)
        original['insight']['tags'] = ['river', 'drone']
        original['insight']['caption_short'] = 'Dron muestra un río'
        original['highlights'].append({'t': 2, 'type': 'manual', 'reason': 'Mi marca'})
        self.write('ai/clip_a.json', original)
        (self.vault / 'properties').mkdir()
        prop = {'titulo': 'Lote', 'clip': 'clip_a', 'area': '1200', 'descripcion': 'Una oportunidad única.'}
        self.write('properties/demo.json', prop)
        backup = self.vault / 'backup'
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        report = backfill_output_contract.backfill(1, ['demo'], backup, True, self.vault, {})
        self.assertEqual(1, report['clips_selected'])
        self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())
        self.assertFalse(backup.exists())
        report = backfill_output_contract.backfill(1, ['demo'], backup, False, self.vault, {})
        self.assertEqual(1, report['clips_written'])
        self.assertEqual(1, report['properties_written'])
        self.assertEqual(before, (backup / 'ai/clip_a.json').read_bytes())
        data = insights.record('clip_a', self.vault)
        self.assertTrue(insights.has_embedding(data))
        self.assertEqual(['río'], data['insight']['tags'])
        self.assertEqual('Mi marca', data['owner_highlights'][0]['reason'])
        self.assertNotIn('oportunidad', json.loads((self.vault / 'properties/demo.json').read_text())['descripcion'])
        target = insights.summary_path('flight', 'clip_a', self.vault)
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps({'source_hash': 'old', 'summary': 'Old copy.'}))
        again = backfill_output_contract.backfill(1, ['demo'], backup, False, self.vault, {})
        self.assertEqual(0, again['clips_written'])
        self.assertEqual(0, again['properties_written'])
        self.assertEqual(1, again['summaries_written'])

    def test_contract_backfill_provider_failure_preserves_source(self):
        import backfill_output_contract
        original = copy.deepcopy(self.data)
        original['insight']['tags'] = ['river']
        self.write('ai/clip_a.json', original)
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        self.embed_mock.side_effect = TimeoutError
        report = backfill_output_contract.backfill(1, [], self.vault / 'backup', False, self.vault, {})
        self.assertEqual(1, len(report['failures']))
        self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())

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
        self.assertEqual(2, result['results'][0]['matched_moment']['time_s'])
        self.assertTrue(result['results'][0]['matched_moment']['synthetic'])
        result = insights.search('RIO', vault=self.vault, embed=lambda q: (_ for _ in []).throw(TimeoutError()))
        self.assertEqual('tags', result['mode'])
        self.assertEqual(2, len(result['results']))
        b['embedding']['source_hash'] = 'stale'
        self.write('ai/clip_b.json', b)
        self.assertEqual([], insights.search('agua', vault=self.vault, embed=lambda q: [0, 1] + [0] * 766)['results'])

    def test_collections_group_place_month_subject_shot_and_cover(self):
        self.write('ai/clip_b.json', {'clip_id': 'clip_b', 'summary': 'Río azul entre montañas.'})
        items = insights.collections(self.vault, all_items=True)['collections']
        self.assertEqual({'place', 'month', 'subject', 'shot'}, {x['kind'] for x in items})
        place = next(x for x in items if x['kind'] == 'place')
        self.assertEqual(2, place['count'])
        self.assertEqual('clip_a', place['cover']['clip_id'])
        self.assertTrue(place['cover']['frame_url'].endswith('.jpg'))

    def test_place_collection_keeps_owner_cover(self):
        self.write('ai/clip_b.json', {'clip_id': 'clip_b', 'summary': 'Río azul entre montañas.'})
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
            folder = self.vault / 'frames' / cid
            folder.mkdir()
            (folder / 'f_0002.jpg').write_bytes((self.vault / 'frames/clip_a/f_0002.jpg').read_bytes())
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
        self.assertEqual({'place', 'month', 'subject', 'shot'}, {c['kind'] for c in curated})
        self.assertEqual(sorted(curated, key=lambda c: (('place', 'month', 'subject', 'shot').index(c['kind']), -c['count'], -int(c['latest_date'].replace('-', '')))), curated)
        self.assertTrue(all(c['subtitle'] == f"{c['count']} clips · {c['count'] * 2} min 00 s" for c in curated))
        self.assertTrue(all(c['caption_short'] == 'Río azul entre montañas' for c in curated))
        self.assertIn('Agosto 2025', [c['label'] for c in curated])
        self.assertIn('Tomas cenitales', [c['label'] for c in curated])
        self.assertIn('Ascensos', [c['label'] for c in curated])

    def test_place_shift_keeps_metadata_and_nearest_label_never_coordinates(self):
        self.write('ai/clip_b.json', {'clip_id': 'clip_b', 'summary': 'Río azul entre montañas.'})
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
        self.assertEqual('Una toma cenital de un área urbana',
                         trim_caption('Una toma cenital de un área urbana mostrando edificios con techos rojos.'))

    def test_new_vision_prompt_and_caption_remove_praise(self):
        value = fixture_insight()
        value['caption'] = 'Un majestuoso río entre impresionantes montañas.'
        self.vision_mock.return_value = (json.dumps(value), {'input_tokens': 1, 'output_tokens': 1})
        data = insights.build_record('clip_b', {}, self.vault)
        self.assertEqual('Un río entre montañas.', data['insight']['caption'])
        self.assertIn('sin elogios', self.vision_mock.call_args.args[0])
        self.assertIn('100 caracteres', self.vision_mock.call_args.args[0])

    def test_v1_read_only_upgrade_and_rollout_compatible_storage(self):
        stored = json.loads((self.vault / 'ai/clip_a.json').read_text())
        self.assertNotIn('caption_short', stored['insight'])
        stored.pop('caption_short')
        stored['schema_version'] = 1
        self.write('ai/clip_a.json', stored)
        before = (self.vault / 'ai/clip_a.json').read_bytes()
        self.assertEqual('Río azul entre montañas', insights.get_insight('clip_a', self.vault)['insight']['caption_short'])
        result = insights.search('rio', vault=self.vault, embed=lambda q: [1, 0] + [0] * 766)
        self.assertEqual('Río azul entre montañas', result['results'][0]['caption_short'])
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
        with patch.object(insights.cover_quality, 'assess', return_value={
                'eligible': True, 'mean_luminance': 100}), patch.object(insights, 'moment', return_value={
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
        trip_index = {'2026-07-01': {'summary': 'Un río entre montañas.'}}
        self.write('ai/trips.json', trip_index)
        with patch.object(server, 'VAULT', self.vault), patch.object(server, 'PREVIEW_PORT', 8807), \
             patch.object(server.H, '_auth_context', return_value={'user': 'daniel', 'dev_mode': True}):
            http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.H)
            worker = threading.Thread(target=http.serve_forever, daemon=True); worker.start()
            base = f'http://127.0.0.1:{http.server_port}'
            try:
                with urllib.request.urlopen(base + '/data/ai/trips.json') as response:
                    self.assertEqual(trip_index, json.load(response))
                for path in ['/api/search?q=rio', '/api/collections', '/api/clip/clip_a/insight',
                             '/api/flight/clip_a/summary', '/api/trip/4.00,-74.00/recap']:
                    with urllib.request.urlopen(base + path) as response:
                        self.assertEqual(200, response.status)
                        self.assertIsInstance(json.load(response), dict)
                with urllib.request.urlopen(base + '/api/flight/clip_a/summary') as response:
                    summary = json.load(response)
                    self.assertEqual([], summary['highlights'])
                    self.assertTrue(summary['cover']['quality']['eligible'])
                with urllib.request.urlopen(base + '/api/collections') as response:
                    self.assertEqual([], json.load(response)['collections'])
                with urllib.request.urlopen(base + '/api/collections?all=1') as response:
                    items = json.load(response)['collections']
                    self.assertGreater(len(items), 0)
                    self.assertIn('caption_short', items[0])
                    self.assertIn('subtitle', items[0])
                with urllib.request.urlopen(base + '/api/clip/clip_a/insight') as response:
                    self.assertEqual('Río azul entre montañas', json.load(response)['insight']['caption_short'])
                before = (self.vault / 'ai/clip_a.json').read_bytes()
                with urllib.request.urlopen(base + '/data/ai/clip_a.json') as response:
                    detail = json.load(response)
                    self.assertEqual([], detail['highlights'])
                    self.assertTrue(detail['synthetic'])
                with urllib.request.urlopen(base + '/data/manifest/flights.json') as response:
                    embedded = json.load(response)['flights'][0]['ai']
                    self.assertEqual(detail['highlights'], embedded['highlights'])
                    self.assertEqual(detail['caption_short'], embedded['caption_short'])
                self.assertEqual(before, (self.vault / 'ai/clip_a.json').read_bytes())
                (self.vault / 'properties').mkdir()
                self.write('properties/demo.json', {'clip': 'clip_a', 'gallery_n': 8,
                    'gallery': [{'clip_id': 'clip_a', 'frame_url': '/data/frames/clip_a/f_0002.jpg',
                                 'quality': {'status': 'ok'}}]})
                private = copy.deepcopy(self.data)
                private['insight']['caption'] = 'Un cartel de venta con teléfono.'
                self.write('ai/clip_a.json', private)
                with urllib.request.urlopen(base + '/data/properties/demo.json') as response:
                    prop = json.load(response)
                    self.assertEqual([], prop['gallery'])
                    self.assertIsNone(prop['cover'])
                with urllib.request.urlopen(base + '/data/manifest/flights.json') as response:
                    flight = json.load(response)['flights'][0]
                    self.assertIsNone(flight['thumbnail'])
                    self.assertTrue(flight['thumbnail_url'].startswith('/data/frames/clip_a/'))
                    self.assertEqual(flight['thumbnail_url'], flight['thumb_url'])
                for path in ['/data/thumbs/clip_a.jpg', '/data/frames/clip_a/f_0002.jpg']:
                    with urllib.request.urlopen(base + path) as response:
                        self.assertEqual('image/jpeg', response.headers['Content-Type'])
                        self.assertTrue(response.read().startswith(b'\xff\xd8'))
                for path, status in [('/api/search', 400), ('/api/search?q=a&limit=0', 400),
                                     ('/api/clip/missing/insight', 404), ('/api/clip/%2E%2E/insight', 400)]:
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + path)
                    self.assertEqual(status, error.exception.code)
                with patch.object(server.H, '_auth_context', return_value=None):
                    for path in ['/api/search?q=rio', '/api/collections', '/api/clip/clip_a/insight',
                                 '/api/flight/clip_a/summary', '/api/trip/4.00,-74.00/recap',
                                 '/data/ai/clip_a.json', '/data/manifest/flights.json']:
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
