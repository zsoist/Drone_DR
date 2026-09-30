// Contratos de los módulos puros del HUD v2 (WS A): preferencias, estante de medallas, formato de tiempo,
// clase de retícula por arma y esquema del bus. (Las rutas absolutas '/flightverse/...' de hud2/menu2 no
// se importan en node: su marcado se verifica en test_fv2_hud_contract.py.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrefs, loadPrefs, sanitizePref, resolveReducedMotion, PREF_DEFAULTS, PREFS_KEY } from '../web/flightverse/ui/prefs.js';
import { createMedalShelf, isOnboarded, setOnboarded, formatTime } from '../web/flightverse/ui/records.js';
import { reticleKindFor, HC } from '../web/flightverse/ui/reticle.js';
import { BUS_EVENTS, createBus } from '../web/flightverse/bus.js';

const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('prefs: defaults, clamps, enums and persistence', () => {
  const st = memStore();
  const bus = createBus();
  const seen = [];
  bus.on('prefs', d => seen.push(d));
  const p = createPrefs({ storage: st, bus, systemReduced: () => false });
  assert.equal(p.get('textScale'), 100);
  assert.equal(p.set('textScale', 115), 115);
  assert.equal(p.set('textScale', 999), PREF_DEFAULTS.textScale);      // fuera de enum → default
  assert.equal(p.set('lookSens', 9), 2);                               // clamp
  assert.equal(p.set('lookSens', 0.01), 0.5);
  assert.equal(p.set('leftHanded', 'sí'), false);                      // tipo inválido → default
  p.set('leftHanded', true);
  assert.ok(seen.some(d => d.key === 'leftHanded' && d.value === true));
  const again = loadPrefs(st);
  assert.equal(again.leftHanded, true);
  assert.equal(again.textScale, 100);
  assert.ok(JSON.parse(st.getItem(PREFS_KEY)));
});

test('prefs: corrupt storage falls back to defaults; unknown keys ignored', () => {
  const st = memStore(); st.setItem(PREFS_KEY, '{oops');
  assert.deepEqual(loadPrefs(st), { ...PREF_DEFAULTS });
  assert.equal(sanitizePref('nope', 1), undefined);
});

test('reduced motion: explicit pref wins over the system', () => {
  assert.equal(resolveReducedMotion('auto', true), true);
  assert.equal(resolveReducedMotion('auto', false), false);
  assert.equal(resolveReducedMotion('on', false), true);
  assert.equal(resolveReducedMotion('off', true), false);
  const p = createPrefs({ storage: memStore(), systemReduced: () => true });
  assert.equal(p.reducedMotion(), true);
  p.set('reducedMotion', 'off');
  assert.equal(p.reducedMotion(), false);
});

test('onboarding flag and medal shelf only ever improve', () => {
  const st = memStore();
  assert.equal(isOnboarded(st), false);
  setOnboarded(st);
  assert.equal(isOnboarded(st), true);
  const shelf = createMedalShelf({ storage: st });
  assert.equal(shelf.award('primer-vuelo', 'bronze'), true);
  assert.equal(shelf.award('primer-vuelo', 'bronze'), false);
  assert.equal(shelf.award('primer-vuelo', 'gold'), true);
  assert.equal(shelf.award('primer-vuelo', 'silver'), false);
  assert.equal(shelf.all()['primer-vuelo'], 'gold');
});

test('formatTime mm:ss.d', () => {
  assert.equal(formatTime(3.67), '00:03.7');
  assert.equal(formatTime(61.2), '01:01.2');
  assert.equal(formatTime(NaN), '--:--.-');
});

test('reticle class per weapon kind (spec 3)', () => {
  assert.equal(reticleKindFor({ kind: 'bullet' }), 'gun');
  assert.equal(reticleKindFor({ kind: 'missile' }), 'missile');
  assert.equal(reticleKindFor({ kind: 'guided' }), 'missile');
  assert.equal(reticleKindFor({ kind: 'swarm' }), 'swarm');
  assert.equal(reticleKindFor({ kind: 'rail' }), 'rail');
  assert.equal(reticleKindFor({ kind: 'bomb' }), 'nova');
  assert.equal(reticleKindFor(null), 'gun');
});

test('HUD palette: red is reserved for hostile and distinct from candidate/friend', () => {
  assert.equal(HC.hostile, '#D96A6A');
  assert.equal(HC.cand, '#E0A458');
  assert.equal(HC.friend, '#45A0E6');
  assert.notEqual(HC.hostile, HC.cand);
});

test('bus schema carries the A-owned events', () => {
  for (const ev of ['prefs', 'medal', 'onboarding', 'pause', 'damage', 'hit']) assert.ok(ev in BUS_EVENTS, ev);
});
