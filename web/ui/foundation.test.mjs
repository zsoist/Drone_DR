import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fuzzyScore, registerPaletteSource } from './palette.js';

test('Spanish palette matches accents, subsequences, and missing characters', () => {
  assert.equal(fuzzyScore('guia', 'Guía'), 0);
  assert.equal(fuzzyScore('GUÍA', 'guia'), 0);
  assert.ok(Number.isFinite(fuzzyScore('vjs', 'Viajes')));
  assert.ok(fuzzyScore('vuelo', 'Vuelo del 3 de octubre') < fuzzyScore('vuelo', 'Ir al vuelo del 3 de octubre'));
  assert.equal(fuzzyScore('xyz', 'Viajes'), Infinity);
  assert.equal(fuzzyScore('  ', 'Inicio'), 0);
  const unregister = registerPaletteSource(() => []);
  unregister(); unregister();
});

const themeSource = await readFile(new URL('./theme.js', import.meta.url), 'utf8');
function theme({ path = '/home.html', saved = null, light = false, blocked = false } = {}) {
  const root = { dataset: {} }, media = { matches: light }, handlers = {};
  const storage = new Map(saved ? [['ab_theme', saved]] : []);
  const get = () => { if (blocked) throw new Error('Storage denied'); return storage.get('ab_theme'); };
  const context = { document: { documentElement: root, dispatchEvent() {}, addEventListener() {} },
    location: { pathname: path }, matchMedia: () => media, Event,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    localStorage: { getItem: get, setItem: (k, v) => { get(); storage.set(k, v); }, removeItem: k => { get(); storage.delete(k); } },
  };
  media.addEventListener = (name, fn) => { handlers.media = fn; };
  context.window = context; vm.runInNewContext(themeSource, context);
  return { root, media, handlers, storage, api: context.AeroTheme };
}

test('manual theme wins, system reset follows OS changes, and blocked storage is safe', () => {
  const t = theme({ saved: 'dark', light: true });
  assert.equal(t.root.dataset.theme, 'dark');
  t.api.set('system'); assert.equal(t.root.dataset.theme, 'light');
  assert.equal(t.storage.has('ab_theme'), false);
  t.media.matches = false; t.handlers.media(); assert.equal(t.root.dataset.theme, 'dark');
  t.handlers.storage({ key: 'ab_theme', newValue: 'light' }); assert.equal(t.root.dataset.theme, 'light');
  const locked = theme({ blocked: true }); locked.api.set('light');
  assert.equal(locked.root.dataset.theme, 'light');
});

test('paper pages start light while app pages default to the system', () => {
  for (const path of ['/guia.html', '/ventas.html', '/p.html']) assert.equal(theme({ path }).root.dataset.theme, 'light');
  assert.equal(theme().root.dataset.theme, 'dark');
  assert.equal(theme({ light: true }).root.dataset.theme, 'light');
  assert.equal(theme({ path: '/ventas.html', saved: 'dark' }).root.dataset.theme, 'dark');
});

const transitionSource = await readFile(new URL('./transitions.js', import.meta.url), 'utf8');
test('transitions use back for history and crossfade for 3D or reduced motion', async () => {
  const handlers = {}, media = { matches: false, addEventListener() {} };
  const root = { dataset: {} };
  const element = { dataset: { transitionKey: 'clip-123' }, tagName: 'IMG', style: {} };
  const context = { URL, location: { href: 'https://example.test/home.html' },
    document: { documentElement: root, querySelectorAll: () => [element] },
    matchMedia: () => media, addEventListener: (name, fn) => { handlers[name] = fn; } };
  context.window = context; vm.runInNewContext(transitionSource, context);
  function swap(url, direction = 'push') {
    const types = new Set();
    handlers.pageswap({ viewTransition: { types, finished: Promise.resolve() },
      activation: { navigationType: direction, from: { url: '/home.html', index: 2 }, entry: { url, index: 1 } } });
    return types;
  }
  assert.ok(swap('/trips.html', 'traverse').has('back'));
  assert.equal(element.style.viewTransitionName, 'clip-123');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element.style.viewTransitionName, '');
  assert.ok(swap('/volar.html').has('crossfade'));
  assert.ok(swap('/tresd.html').has('crossfade'));
  media.matches = true;
  assert.ok(swap('/studio.html').has('crossfade'));
  handlers.pagereveal({}); // No View Transition support remains a normal navigation.
});

test('palette highlights Spanish accents and ordered partial matches', async () => {
  const { matchPositions } = await import('./palette.js');
  assert.deepEqual(matchPositions('guia', 'Guía'), [0, 1, 2, 3]);
  assert.deepEqual(matchPositions('vjs', 'Viajes'), [0, 3, 5]);
  assert.deepEqual(matchPositions('xyz', 'Viajes'), []);
  assert.deepEqual(matchPositions(' ', 'Inicio'), []);
});

test('palette recent destinations stay unique, bounded, local, and safe without storage', async () => {
  const { readRecents, rememberVisit } = await import('./palette.js');
  const storage = new Map();
  globalThis.location = { href: 'https://example.test/home.html', origin: 'https://example.test' };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  try {
    for (let i = 0; i < 7; i++) rememberVisit({ id: `trip-${i}`, label: `Viaje ${i}`, href: `trips.html?id=${i}`, group: 'Viajes' });
    assert.deepEqual(readRecents().map(item => item.id), ['trip-6', 'trip-5', 'trip-4', 'trip-3', 'trip-2']);
    rememberVisit({ id: 'alternate', label: 'Viaje 4', href: '/trips.html?id=4' });
    assert.deepEqual(readRecents().map(item => item.id), ['alternate', 'trip-6', 'trip-5', 'trip-3', 'trip-2']);
    rememberVisit({ id: 'external', label: 'External', href: 'https://other.test/' });
    rememberVisit({ id: 'action', label: 'Action', action() {} });
    assert.equal(readRecents()[0].id, 'alternate');
    storage.set('ab_palette_recent', '{broken'); assert.deepEqual(readRecents(), []);
    storage.set('ab_palette_recent', '[null, {"href":"javascript:alert(1)"}]'); assert.deepEqual(readRecents(), []);
    globalThis.localStorage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
    assert.deepEqual(readRecents(), []);
    assert.doesNotThrow(() => rememberVisit({ id: 'home', label: 'Inicio', href: 'home.html' }));
  } finally { delete globalThis.location; delete globalThis.localStorage; }
});
