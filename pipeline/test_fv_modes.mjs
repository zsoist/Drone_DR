// Gate Rush / modos (?fv=2): medallas, par, récords top-10, fantasma, validación de inicio, onboarding.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parTime, gateRushMedal, nextMedalTarget, gateRushScore, courseLength, paceDelta, timeText,
  addRecord, getTop, bestMedal, readRecords, RECORDS_KEY, TOP_N, encodeGhost, ghostPoseAt, saveGhostIfBest,
  loadGhost, ghostKey, findClearStart, START_CLEARANCE_M, onboardStepAt, sanitizeGateCenters,
} from '../web/flightverse/modes/rules.js';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('par: world JSON override, otherwise course length / target speed + per-gate margin', () => {
  assert.equal(parTime({ worldPar: 52.5 }), 52.5);
  const p = parTime({ pathLength: 600, gates: 10, difficulty: 'media' });
  assert.equal(p, +(600 / 9.5 + 3.5).toFixed(1));
  assert.ok(parTime({ pathLength: 600, gates: 10, difficulty: 'dificil' }) < p);
  assert.ok(parTime({ pathLength: 1, gates: 1 }) >= 8, 'floor');
  assert.equal(courseLength([{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }]), 5);
});

test('medals: bronze = finish, silver <= 1.25x par, gold <= par with 0 misses', () => {
  const par = 60;
  assert.equal(gateRushMedal({ time: 59, par, misses: 0 }), 'gold');
  assert.equal(gateRushMedal({ time: 60, par, misses: 0 }), 'gold');
  assert.equal(gateRushMedal({ time: 59, par, misses: 1 }), 'silver', 'a miss blocks gold');
  assert.equal(gateRushMedal({ time: 75, par, misses: 3 }), 'silver');
  assert.equal(gateRushMedal({ time: 75.01, par, misses: 0 }), 'bronze');
  assert.equal(gateRushMedal({ time: 300, par, misses: 0 }), 'bronze');
  assert.equal(gateRushMedal({ time: 50, par, misses: 0, finished: false }), null);
  assert.equal(gateRushMedal({ time: NaN, par }), null);
  assert.deepEqual(nextMedalTarget({ par, medal: 'bronze' }), { medal: 'silver', time: 75 });
  assert.deepEqual(nextMedalTarget({ par, medal: 'silver' }), { medal: 'gold', time: 60 });
  assert.equal(nextMedalTarget({ par, medal: 'gold' }), null);
  assert.ok(gateRushScore({ time: 50, par: 60 }) > gateRushScore({ time: 70, par: 60 }));
  assert.ok(gateRushScore({ time: 50, par: 60, misses: 2 }) < gateRushScore({ time: 50, par: 60 }));
});

test('HUD data helpers', () => {
  assert.equal(timeText(65.43), '01:05.4');
  assert.equal(timeText(null), '--:--.-');
  assert.equal(paceDelta({ t: 30, idx: 5, total: 10, par: 60 }), 0);
  assert.ok(paceDelta({ t: 35, idx: 5, total: 10, par: 60 }) > 0);
  assert.equal(paceDelta({ t: 3, idx: 0, total: 10, par: 60 }), 0);
});

test('records: top-10 per (world, mode, difficulty), persisted, Dios separate, survives reload', () => {
  const st = mem();
  for (let i = 0; i < 14; i++) addRecord(st, { world: 'w1', mode: 'gaterush', difficulty: 'media', score: 100 + i * 10, medal: 'bronze', time: 70 - i });
  const top = getTop(st, 'w1', 'gaterush', 'media');
  assert.equal(top.length, TOP_N);
  assert.equal(top[0].score, 230);
  assert.ok(top.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  const a = addRecord(st, { world: 'w1', mode: 'gaterush', difficulty: 'media', score: 500, medal: 'gold', time: 40 });
  assert.equal(a.rank, 1); assert.equal(a.isBest, true); assert.equal(a.prevBest, 230);
  const low = addRecord(st, { world: 'w1', mode: 'gaterush', difficulty: 'media', score: 1, medal: null });
  assert.equal(low.rank, null, 'too low to enter the top-10');
  assert.equal(getTop(st, 'w1', 'gaterush.dios', 'media').length, 0, 'Dios has its own list');
  assert.equal(getTop(st, 'w1', 'gaterush', 'facil').length, 0);
  assert.equal(getTop(st, 'w2', 'gaterush', 'media').length, 0);
  assert.equal(bestMedal(getTop(st, 'w1', 'gaterush', 'media')), 'gold');
  // "recarga": otra lectura del mismo storage
  assert.equal(readRecords(st).version, 1);
  assert.ok(st.getItem(RECORDS_KEY));
  // storage roto no lanza
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); } };
  assert.doesNotThrow(() => addRecord(broken, { world: 'w', mode: 'invasion', difficulty: 'media', score: 10 }));
});

test('ghost: 20 Hz encoding is small, interpolates, and only the faster run is kept', () => {
  const rec = [];
  for (let i = 0; i < 3600; i++) rec.push([i * 0.1, 10, -i * 0.05, (i % 628) / 100]);   // 60 s a 60 Hz
  const g = encodeGhost(rec);
  assert.equal(g.hz, 20);
  assert.equal(g.n, 1200);
  assert.ok(JSON.stringify(g).length < 60000, 'fits comfortably in localStorage');
  const p = ghostPoseAt(g, 30);
  assert.ok(Math.abs(p.x - 30 * 6) < 0.6, `x≈180 got ${p.x}`);
  assert.equal(ghostPoseAt(g, 1e6).done, true);
  assert.equal(ghostPoseAt(null, 1), null);
  const st = mem(); const k = ghostKey('w1', 'media');
  assert.equal(saveGhostIfBest(st, k, g, 62), true);
  assert.equal(saveGhostIfBest(st, k, g, 70), false, 'slower run does not replace the ghost');
  assert.equal(saveGhostIfBest(st, k, g, 55), true);
  assert.equal(loadGhost(st, k).time, 55);
  assert.equal(loadGhost(st, ghostKey('w1', 'media', 'dios')), null, 'Dios ghost separate');
});

test('spawn validation: slides back along the entry axis until 12 m from any wall', () => {
  const approach = { x: 0, y: 20, z: 0 }, axis = { x: 0, y: 0, z: -1 };
  // muro cerca: todo punto con z > -30 a menos de 12 m de un "muro" en z=+5…
  const wallAt = p => Math.hypot(p.x - 0, p.z - 5) < START_CLEARANCE_M + 25;    // despejado solo si z > 42 o < -32
  const res = findClearStart({ approach, axis, clearAt: p => !wallAt(p), rayClear: () => true });
  assert.equal(res.ok, true);
  assert.equal(res.moved, true);
  assert.ok(!wallAt(res.point));
  // punto nominal ya libre → no se mueve
  const free = findClearStart({ approach, axis, clearAt: () => true, rayClear: () => true });
  assert.equal(free.moved, false); assert.equal(free.attempts, 1);
  // mirando a un muro/árbol: el rayo de 30 m lo rechaza y busca otro
  const facing = findClearStart({ approach, axis, clearAt: () => true, rayClear: (p) => p.y >= 26 });
  assert.equal(facing.ok, true);
  assert.ok(facing.point.y >= 26);
  // nada válido: ok=false pero devuelve un punto
  const none = findClearStart({ approach, axis, clearAt: () => false, rayClear: () => false });
  assert.equal(none.ok, false); assert.ok(none.point);
});

test('onboarding steps follow the 20 s script', () => {
  assert.equal(onboardStepAt(0).id, 'tap');
  assert.equal(onboardStepAt(3).id, 'takeoff');
  assert.equal(onboardStepAt(8).id, 'gate');
  assert.equal(onboardStepAt(14).id, 'shoot');
  assert.equal(onboardStepAt(19.9).id, 'shoot');
});

test('gate sanitation: gates on the playable boundary move inward, gates in walls climb or are dropped', () => {
  const half = 100;
  const clampFn = (p, r) => (Math.abs(p.z) > half - r ? { x: 0, y: 0, z: (half - r) * Math.sign(p.z) - p.z } : null);
  const wall = p => (p.x > 50 && p.x < 60 && p.y < 110 ? 0 : Infinity);             // columna de pared hasta y=110
  const tall = p => (p.x > 200 ? 0 : Infinity);                                      // siempre bloqueado
  const gates = [{ x: 0, y: 90, z: -117 }, { x: 55, y: 95, z: 0 }, { x: 250, y: 50, z: 0 }, { x: 0, y: 80, z: 40 }];
  const res = sanitizeGateCenters(gates, { radius: 6.5, nearest: p => Math.min(wall(p), tall(p)), clampFn });
  assert.equal(res.centers.length, 3);
  assert.ok(Math.abs(res.centers[0].z) <= half - 6.5 - 6 + 0.5, `inside boundary: ${res.centers[0].z}`);
  assert.ok(res.centers[1].y >= 110, 'raised above the wall');
  assert.deepEqual(res.report, { shifted: 1, raised: 1, dropped: 1 });
  assert.deepEqual(res.centers[2], { x: 0, y: 80, z: 40 });
});
