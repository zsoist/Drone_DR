import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipSearchSource } from './clip-search.js';

const query = (source, text, controller = new AbortController()) => source({ query: text, signal: controller.signal });
const fixture = { results: [{ clip_id: 'DJI_test', caption: 'Full caption stays out of the result.', caption_short: 'Río entre montañas', matched_moment: { time_s: 10.5, frame_url: '/data/frames/DJI_test/f_0001.jpg' } }] };

test('clip search waits for two characters and cancels the debounce', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, json: async () => fixture }; });
  const source = createClipSearchSource();
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
  const source = createClipSearchSource();
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
  const source = createClipSearchSource();
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
  const pending = query(createClipSearchSource(), 'río', controller);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready; controller.abort(); await rejected;
});
