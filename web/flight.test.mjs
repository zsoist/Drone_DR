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

test('real highlights include zero and regular intervals; invalid or synthetic segments do not', () => {
  const context = aiSelectionContext();
  const real = [0, 90, 180, 270].map(start => ({ start, end: start + 46, score: .8 }));
  const result = context.credibleHighlights({ highlight_segments: [...real,
    { start: 1, end: 3, synthetic: true }, { start: -1, end: 3 }, { start: 5, end: 5 }] });
  assert.deepEqual(Array.from(result, h => h.start), [0, 90, 180, 270]);
});

test('cover selection excludes people and signs, including evidence outside the short caption', () => {
  const context = aiSelectionContext();
  for (const caption of ['Un hombre camina en una azotea.', 'Un cartel con texto y teléfonos.', 'Dos personas junto al río.', 'Un lote en venta en una zona rural.']) {
    assert.equal(context.coverEligible({ caption_short: 'Paisaje urbano', caption }), false);
  }
  assert.equal(context.coverEligible({ caption: 'Edificios con tejados verdes y montañas.' }), true);
  assert.equal(context.coverEligible(null), false);
});

test('best cover chooses the brightest usable sample and respects excluded covers', async () => {
  let pixels;
  const values = { 'frame-0': 20, 'frame-2': 120, 'frame-4': 180, 'frame-6': 255 };
  const context = aiSelectionContext({
    frameFor: (_, t) => `frame-${t}`,
    Image: class { set src(url) { this.luma = values[url]; this.onload(); } },
    document: { createElement: () => ({ getContext: () => ({
      drawImage: img => { pixels = new Uint8ClampedArray(48 * 32 * 4).fill(img.luma); },
      getImageData: () => ({ data: pixels }),
    }) }) },
  });
  const flight = { frame_count: 5, duration_s: 10 };
  const insight = { caption: 'Edificios y montañas.', best_frame_times: [0, 2, 4, 6] };
  assert.equal((await context.bestCover(flight, insight)).time, 4);
  assert.equal((await context.bestCover(flight, insight, { exclude: new Set(['frame-4']) })).time, 2);
  assert.equal(await context.bestCover(flight, { ...insight, best_frame_times: [0, 6] }), null);
});

test('filmstrip keeps ten navigable frames across the complete flight', () => {
  const source = fs.readFileSync(new URL('./flight.js', import.meta.url), 'utf8');
  const strip = { innerHTML: '', addEventListener() {} };
  const context = vm.createContext({ meta: { frame_count: 159 }, cid: 'sample', DATA: '/data', fmt: { dur: String }, document: { getElementById: () => strip } });
  const start = source.indexOf('  if (meta.frame_count) {', source.indexOf('// ---- filmstrip'));
  vm.runInContext(source.slice(start, source.indexOf('// ---- charts', start)), context);
  const times = [...strip.innerHTML.matchAll(/data-t="(\d+)"/g)].map(match => Number(match[1]));
  assert.equal(times.length, 10);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 316);
  assert.equal(new Set(times).size, 10);
});
