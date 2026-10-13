import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipSearchSource } from './clip-search.js';

const query = (source, text, controller = new AbortController()) => source({ query: text, signal: controller.signal });
const fixture = { results: [{ clip_id: 'DJI_test', caption: 'Full caption stays out of the result.', caption_short: 'Río entre montañas', matched_moment: { time_s: 10.5, frame_url: '/data/frames/DJI_test/f_0001.jpg' } }] };

test('clip search waits for two characters and cancels the debounce', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, json: async () => fixture }; });
  const source = createClipSearchSource({ loadContext: async () => [] });
  assert.deepEqual(await query(source, ' a '), []);
  const controller = new AbortController();
  const pending = query(source, 'atardecer', controller);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 0);
  controller.abort(); await rejected;
  assert.equal(calls, 0);
});

test('server matches retain short captions, moment URLs, order, and an in-memory cache', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, '/api/search?q=atardecer&limit=12');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => fixture };
  });
  const source = createClipSearchSource({ loadContext: async () => [] });
  const items = await query(source, 'atardecer');
  assert.equal(items[0].label, 'Río entre montañas');
  assert.equal(items[0].queryMatch, true);
  assert.equal(items[0].hint, 'a los 0:10');
  assert.equal(items[0].href, 'flight.html?id=DJI_test&t=10.5');
  assert.equal(items[0].thumbnail, fixture.results[0].matched_moment.frame_url);
  assert.deepEqual(await query(source, ' ATARDECER '), items);
  assert.equal(calls, 1);
});

test('failed queries can retry and never enter the cache', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: ++calls > 1, json: async () => fixture }));
  const source = createClipSearchSource({ loadContext: async () => [] });
  await assert.rejects(query(source, 'edificios'), /unavailable/);
  assert.equal((await query(source, 'edificios')).length, 1);
  assert.equal(calls, 2);
});

test('cancellation reaches an active request', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    started();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const pending = query(createClipSearchSource({ loadContext: async () => [] }), 'río', controller);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready; controller.abort(); await rejected;
});


test('search explains tags, captions and honest semantic matches with date/place context', async t => {
  const { matchEvidence } = await import('./clip-search.js');
  assert.equal(matchEvidence({ tags: ['Atardecer', 'Bosque'] }, 'atardecer'), 'Etiqueta: Atardecer');
  assert.equal(matchEvidence({ caption: 'Árboles junto al río' }, 'rio'), 'Árboles junto al río');
  assert.equal(matchEvidence({ caption: 'Árboles' }, 'puesta del sol'), 'Contenido relacionado');
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ results: [{ ...fixture.results[0], tags: ['Atardecer'], matched_moment: null }] }) }));
  const source = createClipSearchSource({ loadContext: async () => [{ clip_id: 'DJI_test', date: '2026-07-24', place: 'Bogotá' }] });
  const [item] = await query(source, 'atardecer');
  assert.equal(item.hint, 'Bogotá · 24 jul 2026');
  assert.equal(item.matchText, 'Etiqueta: Atardecer');
  assert.ok(!item.hint.includes('0:00'));
});
