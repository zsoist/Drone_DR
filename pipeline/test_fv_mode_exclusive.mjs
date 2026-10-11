// Invasión y Gate Rush no pueden correr a la vez (modes/exclusive.js + ruta de entrada única).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeArbiter, setTourChrome, tourActiveFrom, TOUR_HIDDEN_IDS } from '../web/flightverse/modes/exclusive.js';
import { addRecord, formatRecordRows, dateText } from '../web/flightverse/modes/rules.js';

function world() {
  const w = { inv: false, gr: false, log: [] };
  const arb = createModeArbiter({
    invasion: () => { const was = w.inv; w.inv = false; w.log.push('stop-inv'); return was; },
    gaterush: () => { const was = w.gr; w.gr = false; w.log.push('stop-gr'); return was; },
  });
  // puntos de entrada tal como los cablea modes/index.js: todos pasan por arb.enter
  w.startInvasion = () => { arb.enter('invasion'); w.inv = true; };
  w.startReto = () => { arb.enter('gaterush'); w.gr = true; };
  w.arb = arb;
  return w;
}

test('iniciar Invasión detiene Gate Rush y viceversa', () => {
  const w = world();
  w.startReto();
  assert.deepEqual([w.gr, w.inv], [true, false]);
  w.startInvasion();
  assert.deepEqual([w.gr, w.inv], [false, true]);
  assert.equal(w.arb.current, 'invasion');
  w.startReto();
  assert.deepEqual([w.gr, w.inv], [true, false]);
  assert.equal(w.arb.current, 'gaterush');
});

test('llamadas heredadas repetidas nunca dejan dos modos activos', () => {
  const w = world();
  for (let i = 0; i < 6; i++) { (i % 2 ? w.startReto : w.startInvasion)(); assert.ok(!(w.gr && w.inv)); }
});

test('un stopper que lanza no impide parar el resto', () => {
  let stopped = false;
  const arb = createModeArbiter({ a: () => { throw new Error('x'); }, b: () => { stopped = true; } });
  arb.enter('invasion');
  assert.ok(stopped);
});

test('leave() vuelve a explorar y para todo', () => {
  const w = world(); w.startInvasion(); w.arb.leave();
  assert.equal(w.arb.current, 'explorar'); assert.equal(w.inv, false);
});

test('una derrota con 0 puntos no se registra ni es #1', () => {
  const mem = new Map();
  const st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const r = addRecord(st, { world: 'w', mode: 'invasion', difficulty: 'media', score: 0, medal: null });
  assert.equal(r.rank, null); assert.equal(r.list.length, 0); assert.equal(r.isBest, false);
  const ok = addRecord(st, { world: 'w', mode: 'invasion', difficulty: 'media', score: 450 });
  assert.equal(ok.rank, 1);
  const again = addRecord(st, { world: 'w', mode: 'invasion', difficulty: 'media', score: 0 });
  assert.equal(again.rank, null); assert.equal(again.list.length, 1);
});

test('filas de récords con formato humano', () => {
  assert.equal(dateText('2026-09-30'), '30 sep 2026');
  const rows = formatRecordRows([{ score: 1234, date: '2026-09-30', medal: 'gold', time: 65.2 }], 'gr');
  assert.deepEqual([rows[0].rank, rows[0].value, rows[0].date, rows[0].medalLabel], [1, '1:05.2', '30 sep 2026', 'Oro']);
  assert.match(formatRecordRows([{ score: 1500, date: '2026-01-02' }], 'inv')[0].value, /1.?500/);
});

test('el Tour oculta los chips Viento / Dron caído y los restaura', () => {
  const els = Object.fromEntries(TOUR_HIDDEN_IDS.map(id => {
    const st = new Map();
    return [id, { style: { setProperty: (k, v, pr) => st.set(k, [v, pr]), removeProperty: k => st.delete(k) }, st }];
  }));
  const doc = { getElementById: id => els[id] || null };
  assert.equal(setTourChrome(doc, true), TOUR_HIDDEN_IDS.length);
  for (const id of TOUR_HIDDEN_IDS) assert.deepEqual(els[id].st.get('display'), ['none', 'important']);
  setTourChrome(doc, false);
  for (const id of TOUR_HIDDEN_IDS) assert.equal(els[id].st.has('display'), false);
  assert.equal(setTourChrome(null, true), 0);
  assert.deepEqual(['start', 'poi', 'loop', 'stop', undefined].map(tourActiveFrom), [true, true, true, false, false]);
});
