import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sampleTimes, sampleAt, acceptsShortcut } from './flight-clock.js';

test('flight clock uses elapsed telemetry time, including gaps and seek boundaries', () => {
  const times = sampleTimes([{ t: '2026-07-24 16:24:23' }, { t: '2026-07-24 16:24:25' }, { t: '2026-07-24 16:24:28' }]);
  assert.deepEqual(times, [0, 2, 5]);
  assert.equal(sampleAt(times, -1), 0);
  assert.equal(sampleAt(times, 1), 0);
  assert.equal(sampleAt(times, 4.9), 1);
  assert.equal(sampleAt(times, 99), 2);
  assert.deepEqual(sampleTimes([{ t: 10 }, { t: 12 }]), [0, 2]);
});
test('interactive targets and prevented events retain keyboard control', () => {
  assert.equal(acceptsShortcut({ target: { closest: () => ({}) } }), false);
  assert.equal(acceptsShortcut({ defaultPrevented: true, target: { closest: () => null } }), false);
  assert.equal(acceptsShortcut({ target: { closest: () => null } }), true);
});
test('semantic membership intersects every selected library filter', () => {
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function matches('), source.indexOf('const SORTS'));
  const state = { semantic: true, tier: 'all', spot: null, has: new Set(), scene: null, q: 'forest' };
  const context = { state, semRank: new Map([['clip', 1]]), models: new Set(), ai: { clip: { scene_type: 'bosque' } }, spotKey: () => 'here' };
  vm.createContext(context); vm.runInContext(fn, context);
  const clip = { clip_id: 'clip', has_proxy: true, stats: {}, tier: 'full' };
  assert.equal(context.matches(clip), true);
  state.has.add('model'); assert.equal(context.matches(clip), false);
  state.has.clear(); state.tier = 'archived'; assert.equal(context.matches(clip), false);
  assert.equal(context.matches({ ...clip, archived: true }), true);
  state.tier = 'all'; state.spot = 'elsewhere'; assert.equal(context.matches(clip), false);
  state.spot = null; state.scene = 'ciudad'; assert.equal(context.matches(clip), false);
  state.scene = null; state.has.add('video'); assert.equal(context.matches({ ...clip, has_proxy: false }), false);
});

test('editing a semantic query invalidates its pending response', async () => {
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const handlers = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      addEventListener: (event, fn) => handlers.set(`${id}:${event}`, fn),
      blur() {}, focus() {}, setAttribute() {}, classList: { toggle() {} },
    });
    return elements.get(id);
  };
  let resolveSearch;
  const state = { semantic: true, q: 'bosque' };
  const context = {
    state, semRank: null,
    document: { getElementById: element },
    readAI: () => new Promise(resolve => { resolveSearch = resolve; }),
    render: () => { element('count').textContent = state.q; },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("const qEl ="), source.indexOf("document.querySelectorAll('[data-qf]').forEach(b => b.addEventListener")), context);
  const pending = handlers.get('q:keydown')({ key: 'Enter' });
  handlers.get('q:input')({ target: { value: 'montaña' } });
  resolveSearch({ results: [{ clip_id: 'old-result' }] });
  await pending;
  assert.equal(context.semRank, null);
  assert.equal(element('count').textContent, 'montaña');
  const toggled = handlers.get('q:keydown')({ key: 'Enter' });
  handlers.get('sem-toggle:click')({ preventDefault() {} });
  resolveSearch({ results: [{ clip_id: 'old-result' }] });
  await toggled;
  assert.equal(context.semRank, null);
  assert.equal(state.semantic, false);
});

test('accepted suggestions keep content; dismissed suggestions omit it', () => {
  const source = fs.readFileSync(new URL('./home-shared.js', import.meta.url), 'utf8');
  let saved = null;
  const context = { localStorage: { getItem: () => JSON.stringify(saved) }, esc: value => String(value) };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('export function decision'), source.indexOf('export function wireSuggestions')).replaceAll('export ', ''), context);
  const render = () => context.suggestion('test', 'Resumen', '', '<div>Selected frames</div>');
  assert.match(render(), /Sugerido/);
  assert.match(render(), /data-decision="accepted"/);
  saved = 'accepted';
  assert.match(render(), /Selected frames/);
  assert.doesNotMatch(render(), /data-decision=/);
  saved = 'dismissed';
  assert.doesNotMatch(render(), /Selected frames|Resumen/);
});

test('flight summary keeps at most two complete Spanish sentences', () => {
  const source = fs.readFileSync(new URL('./home-shared.js', import.meta.url), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('export function summaryExcerpt')).replace('export ', ''), context);
  assert.equal(context.summaryExcerpt('Sube sobre los tejados. Mira hacia los cerros. Regresa al parque.'), 'Sube sobre los tejados. Mira hacia los cerros.');
  assert.equal(context.summaryExcerpt('Una sola frase.'), 'Una sola frase.');
  assert.equal(context.summaryExcerpt(null), '');
});

test('collection membership and exact AI filters intersect the library', () => {
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const state = { tier: 'all', has: new Set(), collection: new Set(['inside']), tag: 'río', flag: 'horizonte' };
  const context = { state, ai: { inside: { tags: ['río'], quality_flags: ['horizonte'] } }, models: new Set() };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function matches('), source.indexOf('const SORTS')), context);
  assert.equal(context.matches({ clip_id: 'outside' }), false);
  assert.equal(context.matches({ clip_id: 'inside' }), true);
  state.tag = 'montañas';
  assert.equal(context.matches({ clip_id: 'inside' }), false);
  state.tag = null; state.flag = 'inestable';
  assert.equal(context.matches({ clip_id: 'inside' }), false);
});

test('explicit synthetic moments stay hidden without rejecting valid timestamps', async () => {
  const { credibleHighlights } = await import('./home.ai.js');
  const legacy = { highlight_segments: [0, 90, 180, 270].map(start => ({ start, end: start + 46, score: .8, synthetic: true })) };
  assert.deepEqual(credibleHighlights(legacy), []);
  const observed = { start: 17, end: 26, score: .8, reason: 'Un vehículo cruza la calle.' };
  const opening = { start: 0, end: 8 };
  assert.deepEqual(credibleHighlights({ highlight_segments: [opening, observed] }), [opening, observed]);
  assert.deepEqual(credibleHighlights(null), []);
});

function aiSelectionContext(extra = {}) {
  const source = fs.readFileSync(new URL('./home.ai.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
  const context = vm.createContext({ ...extra });
  vm.runInContext(source, context);
  return context;
}

test('sampling-grid moments stay hidden even when the backend calls them real', () => {
  const context = aiSelectionContext();
  const samples = [0, 46, 90, 136, 180, 226, 270, 316];
  const grid = [0, 90, 180, 270].map(start => ({ start, end: start + 46, score: .8, synthetic: false }));
  assert.equal(context.credibleHighlights({ highlight_segments: grid }, samples).length, 0);
  assert.equal(context.credibleHighlights({ highlight_segments: grid, best_frame_times: samples.slice(0, 6) }).length, 0);
  const observed = { start: 17, end: 26, score: .8 };
  assert.deepEqual(Array.from(context.credibleHighlights({ highlight_segments: [observed] }, samples), h => h.start), [17]);
});

test('automatic frames require an explicit backend quality approval and a local frame URL', () => {
  const context = aiSelectionContext();
  const frame = { frame_url: '/data/frames/sample/f_0001.jpg' };
  assert.equal(context.eligibleFrame(frame), false);
  assert.equal(context.eligibleFrame({ ...frame, quality: { eligible: false, reasons: ['person'] } }), false);
  assert.equal(context.eligibleFrame({ ...frame, quality: { eligible: true } }), true);
  assert.equal(context.eligibleFrame({ frame_url: 'https://example.com/image.jpg', quality: { eligible: true } }), false);
});

test('cover selection preserves frame times and uses the clip caption, never a moment label', async () => {
  const context = aiSelectionContext();
  const cover = { clip_id: 'sample', frame_url: '/data/frames/sample/f_0008.jpg', frame_time_s: 14,
    quality: { eligible: true } };
  const other = { ...cover, frame_url: '/data/frames/sample/f_0020.jpg', frame_time_s: 38 };
  const flight = { clip_id: 'sample' };
  const insight = { caption_short: 'Edificios y montañas', cover, frames: [other],
    highlight_segments: [{ start: 8, end: 14, reason: 'Mountains on the horizon.' }] };
  const result = await context.bestCover(flight, insight);
  assert.equal(result.time, 14);
  assert.equal(result.url, cover.frame_url);
  assert.equal(result.caption, 'Edificios y montañas');
  assert.equal((await context.bestCover(flight, insight, { exclude: new Set(['data/frames/sample/f_0008.jpg']) })).time, 38);
  assert.equal(await context.bestCover(flight, { best_frame_times: [14] }), null);
  assert.equal(await context.bestCover({ clip_id: 'different' }, insight), null);
});

test('filmstrip spans the clip with approved frames and keeps backend timestamps', async () => {
  const { thumbnailURL } = await import('./ui/thumbnail.js');
  const source = fs.readFileSync(new URL('./flight.js', import.meta.url), 'utf8');
  const strip = { innerHTML: '' };
  const frames = Array.from({ length: 160 }, (_, i) => ({
    clip_id: 'sample', frame_url: `/data/frames/sample/f_${String(i + 1).padStart(4, '0')}.jpg`,
    frame_time_s: i * 2 + .5, quality: { eligible: true },
  }));
  frames[0].quality = { eligible: false };
  frames[159].quality = undefined;
  const context = aiSelectionContext({ detail: { clip_id: 'sample', thumbnail_url: frames[1].frame_url, frames },
    meta: { duration_s: 320 }, syncClock() {}, thumbnailURL, video: {}, fmt: { clock: String }, esc: String,
    document: { getElementById: () => strip } });
  const start = source.indexOf('      const frames = (detail.frames');
  const render = () => vm.runInContext(`{${source.slice(start, source.indexOf('      const analysisBody', start))}}`, context);
  render();
  const times = [...strip.innerHTML.matchAll(/data-t="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.equal(times.length, 10);
  assert.equal(times[0], 2.5);
  assert.equal(times.at(-1), 316.5);
  assert.ok(times.slice(1).every((t, i) => t - times[i] >= 32));
  assert.doesNotMatch(strip.innerHTML, /f_0001|f_0160/);
  assert.equal(context.video.poster, frames[1].frame_url);
  context.detail.frames = [frames[20]];
  render();
  assert.match(strip.innerHTML, /data-t="40.5"/);
  context.detail.frames = [];
  render();
  assert.match(strip.innerHTML, /No hay fotogramas seleccionados/);
});

test('flight titles preserve owner text, then captions, then place and time', async () => {
  const { fmt } = await import('./ui/format.js');
  const { flightFallback } = await import('./ui/display-name.js');
  const context = aiSelectionContext({ fmt, flightFallback });
  const flight = { place: 'Bogotá', clip_id: 'sample', date: '2026-07-24', time: '16:24', duration_s: 10 };
  const insight = { caption_short: 'Ventanas reflectantes', highlight_segments: [{ reason: 'Cambio de escena' }] };
  assert.equal(context.flightCaption({ ...flight, label: 'Mi toma' }, insight), 'Mi toma');
  assert.equal(context.flightCaption(flight, insight), 'Ventanas reflectantes');
  assert.equal(context.flightCaption(flight, null), 'Bogotá · 16:24');
});
