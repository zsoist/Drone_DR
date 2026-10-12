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
    api: () => new Promise(resolve => { resolveSearch = resolve; }),
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
