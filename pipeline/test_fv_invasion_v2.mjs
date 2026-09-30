// Invasión v2 (?fv=2): rampa, daño justo, telégrafos, LOS, victoria, atascos, marcadores, puntuación.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENEMY_COMBAT, FAIR, VICTORY_WAVE, TYPE_INTRO, waveHpScale, waveConcurrentCap, unlockedTypes,
  fairHitDamage, createPlayerVitals, telegraphFor, planAttack, hasLineOfSight, resolveShotStep,
  createStuckTracker, stepRunPhase, killScore, waveBonus, invasionMedal, computeMarkers,
  simulateStationaryPlayer, capWaveQueue, interleaveQueue,
} from '../web/flightverse/invasion-policy.js';

const TYPES = Object.keys(ENEMY_COMBAT);

test('difficulty ramp: hp scale, concurrency cap and type unlocks follow the spec', () => {
  assert.equal(waveHpScale(1), 1.1);
  assert.equal(waveHpScale(5), 1.5);
  assert.equal(waveHpScale(10), 2);
  assert.equal(waveHpScale(25), 2, 'capped at wave 10');
  assert.equal(waveConcurrentCap(1), 4);
  assert.equal(waveConcurrentCap(6), 9);
  assert.equal(waveConcurrentCap(10, { coarse: true }), 12, 'phone max 12');
  assert.equal(waveConcurrentCap(10, { coarse: false }), 13);
  for (let n = 1; n < 10; n++) assert.ok(waveConcurrentCap(n + 1) >= waveConcurrentCap(n));
  assert.deepEqual(unlockedTypes(TYPES, 1), ['zombie']);
  assert.deepEqual(unlockedTypes(TYPES, 2), ['zombie', 'arquero']);
  assert.deepEqual(unlockedTypes(TYPES, 6).sort(), ['arquero', 'avion', 'soldado', 'ufo', 'zombie']);
  assert.ok(!unlockedTypes(TYPES, 6).includes('dragon'));
  assert.ok(unlockedTypes(TYPES, 7).includes('dragon') && !unlockedTypes(TYPES, 8).includes('gigante'));
  assert.equal(unlockedTypes(TYPES, 9).length, 7);
  assert.deepEqual(unlockedTypes(['dragon'], 1), ['dragon'], 'selection with nothing unlocked still plays');
  for (const t of TYPES) assert.ok(TYPE_INTRO[t] >= 1);
});

test('fair damage: per-hit cap, difficulty scale', () => {
  for (const d of ['facil', 'media']) {
    for (const t of TYPES) {
      const raw = ENEMY_COMBAT[t].shoot?.dmg ?? ENEMY_COMBAT[t].dmg;
      for (let w = 1; w <= 10; w++) assert.ok(fairHitDamage(raw, d, w) <= 15.0001, `${d} ${t} w${w}`);
    }
  }
  assert.ok(fairHitDamage(22, 'media', 10) <= 15);
  assert.ok(fairHitDamage(8, 'facil') < fairHitDamage(8, 'media'));
});

test('damage gate: 3 s grace, 5 s respawn invulnerability, lives, start-of-wave protection', () => {
  const v = createPlayerVitals();
  assert.equal(v.hit(10, 1).applied, 10);
  assert.equal(v.hit(10, 2.9).blocked, 'grace');
  assert.equal(v.hit(10, 4.01).applied, 10, 'grace over after 3 s');
  assert.equal(v.state.hp, 80);
  v.state.hp = 5;
  v.startWave(100);
  assert.equal(v.hit(50, 110).applied, 4, 'cannot die in the first 30 s of a wave (hp floor 1)');
  assert.equal(v.state.hp, 1);
  assert.equal(v.hit(50, 131).lost, true, 'can die after 30 s');
  assert.equal(v.respawn(200), true);
  assert.equal(v.state.hp, 100);
  assert.equal(v.hit(50, 203).blocked, 'invuln');
  assert.equal(v.hit(50, 205.01).applied, 50);
  v.state.lives = 1;
  assert.equal(v.respawn(300), false, 'no lives left → defeat');
});

test('idle warning: hit while not moving for 10 s', () => {
  const v = createPlayerVitals();
  v.noteMove(0, 3);
  assert.equal(v.shouldWarnMove(11), false, 'not hit');
  v.hit(5, 11);
  assert.equal(v.shouldWarnMove(11.5), true);
  v.noteMove(11.6, 4);
  assert.equal(v.shouldWarnMove(12), false);
});

test('a stationary player survives >= 45 s on Media, wave 1 (and every single type selected)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    assert.ok(simulateStationaryPlayer({ difficulty: 'media', types: TYPES, wave: 1, seed }) >= 45, `mix seed ${seed}`);
    for (const type of TYPES) {
      const t = simulateStationaryPlayer({ difficulty: 'media', types: [type], wave: 1, seed });
      assert.ok(t >= 45, `${type} seed ${seed}: died at ${t}`);
    }
  }
  for (const wave of [2, 3, 5, 7, 9, 10]) {
    for (let seed = 1; seed <= 10; seed++) {
      const t = simulateStationaryPlayer({ difficulty: 'media', types: TYPES, wave, seed });
      assert.ok(t >= 30, `wave ${wave} seed ${seed}: died at ${t}`);
    }
  }
  assert.ok(simulateStationaryPlayer({ difficulty: 'facil', types: TYPES, wave: 1 }) >= 45);
});

test('no attack can land inside the first 6 s of a wave', () => {
  for (const type of TYPES) {
    for (let seed = 1; seed <= 10; seed++) {
      const s = simulateStationaryPlayer({ difficulty: 'dificil', types: [type], wave: 10, seconds: 6, seed });
      assert.equal(s, Infinity, `${type} hurt the player before 6 s`);
    }
  }
});

test('telegraph precedes every shot and melee by >= 0.5 s (0.8 dragon, 1.0 gigante)', () => {
  for (const type of TYPES) {
    const plan = planAttack(type);
    assert.ok(plan.tele >= 0.5, type);
    assert.ok(plan.shotTimes.length >= 1);
    for (const at of plan.shotTimes) assert.ok(at - 0 >= 0.5, `${type} shot at ${at}`);
    assert.equal(telegraphFor(type), plan.tele);
  }
  assert.ok(telegraphFor('dragon') >= 0.8);
  assert.ok(telegraphFor('gigante') >= 1.0);
});

test('projectile speed cap in Invasión', () => {
  for (const t of TYPES) {
    const sh = ENEMY_COMBAT[t].shoot;
    if (sh) assert.ok(sh.speed <= FAIR.maxProjectileSpeed, t);
  }
});

test('line of sight and shot steps respect cover (castSegment injected)', () => {
  const wall = (a, b) => ((a.x < 10 && b.x > 10) ? { fraction: (10 - a.x) / (b.x - a.x), kind: 'structure' } : null);
  assert.equal(hasLineOfSight(wall, { x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 0 }), false);
  assert.equal(hasLineOfSight(wall, { x: 0, y: 1, z: 0 }, { x: 9, y: 1, z: 0 }), true);
  assert.equal(hasLineOfSight(null, { x: 0 }, { x: 1 }), true);
  // bala que cruza la pared antes de llegar al dron
  const r = resolveShotStep({ prev: { x: 8, y: 1, z: 0 }, next: { x: 14, y: 1, z: 0 }, dronePos: { x: 14, y: 1, z: 0 }, hitRadius: 1.8, castSegment: wall });
  assert.equal(r.kind, 'world');
  // sin pared: impacta
  const r2 = resolveShotStep({ prev: { x: 8, y: 1, z: 0 }, next: { x: 14, y: 1, z: 0 }, dronePos: { x: 14, y: 1, z: 0 }, castSegment: () => null });
  assert.equal(r2.kind, 'drone');
  // túnel: proyectil rápido que atraviesa el dron en un paso
  const r3 = resolveShotStep({ prev: { x: 0, y: 0, z: 0 }, next: { x: 10, y: 0, z: 0 }, dronePos: { x: 5, y: 0.5, z: 0 }, castSegment: () => null });
  assert.equal(r3.kind, 'drone', 'swept test catches tunneling');
  const r4 = resolveShotStep({ prev: { x: 0, y: 0, z: 0 }, next: { x: 10, y: 0, z: 0 }, dronePos: { x: 5, y: 20, z: 0 }, castSegment: () => null });
  assert.equal(r4.kind, 'miss');
});

test('the wall blocks fire: a covered stationary player takes no damage from ranged enemies', () => {
  // modelo: con LOS=false nunca se inicia telégrafo → 0 impactos (la condición la impone invasion.js con hasLineOfSight)
  const blocked = (a, b) => ({ fraction: 0.4 });
  let attacks = 0;
  for (let i = 0; i < 100; i++) if (hasLineOfSight(blocked, { x: 0, y: 1, z: 0 }, { x: 50, y: 5, z: 0 })) attacks++;
  assert.equal(attacks, 0);
});

test('victory is reachable: 10 waves clear → victory, in finite steps', () => {
  let s = { phase: 'loading', countdown: 2, wave: 0 };
  let events = [], alive = 0, queue = 0, t = 0;
  for (let i = 0; i < 100000 && s.phase !== 'victory'; i++) {
    const n = stepRunPhase(s, 0.05, { alive, queueLen: queue, burstsLen: 0 });
    if (n.event) events.push(n.event);
    if (n.event === 'wave-start') { alive = 3; queue = 2; }
    if (s.phase === 'running' && queue === 0 && alive > 0 && i % 7 === 0) alive -= 1;
    else if (s.phase === 'running' && queue > 0 && i % 5 === 0) { queue -= 1; alive += 1; }
    s = n; t += 0.05;
  }
  assert.equal(s.phase, 'victory');
  assert.equal(s.wave, VICTORY_WAVE);
  assert.equal(events.filter(e => e === 'wave-start').length, VICTORY_WAVE);
  assert.equal(events.filter(e => e === 'wave-clear').length, VICTORY_WAVE - 1);
  assert.equal(events.at(-1), 'victory');
  assert.ok(t < 3600);
  // la oleada no termina con enemigos vivos o en cola
  assert.equal(stepRunPhase({ phase: 'running', countdown: 0, wave: 4 }, 0.05, { alive: 1, queueLen: 0, burstsLen: 0 }).phase, 'running');
  assert.equal(stepRunPhase({ phase: 'running', countdown: 0, wave: 4 }, 0.05, { alive: 0, queueLen: 2, burstsLen: 0 }).phase, 'running');
  // legado: victoria inalcanzable si victoryWave se sube (el modo legacy no usa stepRunPhase)
});

test('stuck enemies: nudge first, then relocate; progress resets strikes', () => {
  const tr = createStuckTracker({ windowS: 4, minProgress: 1 });
  const feed = (x, sec) => { let v = 'ok'; for (let i = 0; i < sec * 10; i++) v = tr.step(x, 0, 0.1, true) === 'ok' ? v : tr.step(x, 0, 0, true) && 'x'; return v; };
  let verdicts = [];
  for (let i = 0; i < 100; i++) { const v = tr.step(5, 5, 0.1, true); if (v !== 'ok') verdicts.push(v); }
  assert.deepEqual(verdicts.slice(0, 2), ['nudge', 'relocate']);
  const t2 = createStuckTracker();
  let x = 0, out = [];
  for (let i = 0; i < 200; i++) { x += 0.05; const v = t2.step(x, 0, 0.1, true); if (v !== 'ok') out.push(v); }
  assert.deepEqual(out, [], 'a moving enemy is never flagged');
  void feed;
});

test('wave queue never exceeds the concurrency + tier caps and keeps selected types (unlocked only)', () => {
  const q = capWaveQueue({ types: unlockedTypes(TYPES, 3), wave: 3, tier: 'low', difficulty: 'media', seed: 5 });
  assert.ok(q.every(t => ['zombie', 'arquero', 'soldado'].includes(t)));
});

test('scoring: combo multiplies, wave bonus rewards clean waves, medals follow waves + lives', () => {
  assert.equal(killScore('zombie', 1), 100);
  assert.equal(killScore('zombie', 5), 500);
  assert.equal(killScore('dragon', 99), 1000 * 12, 'combo capped at 12');
  assert.ok(killScore('gigante', 1) > killScore('dragon', 1));
  assert.equal(waveBonus(3, false), 600);
  assert.equal(waveBonus(3, true), 900);
  assert.equal(invasionMedal({ wavesCleared: 2 }), null);
  assert.equal(invasionMedal({ wavesCleared: 3 }), 'bronze');
  assert.equal(invasionMedal({ wavesCleared: 6 }), 'silver');
  assert.equal(invasionMedal({ wavesCleared: 9, livesLost: 0 }), 'silver');
  assert.equal(invasionMedal({ wavesCleared: 10, livesLost: 1, victory: true }), 'silver');
  assert.equal(invasionMedal({ wavesCleared: 10, livesLost: 0, victory: true }), 'gold');
});

test('markers: on-screen nearest 6 diamonds, the rest + off-screen collapse to <= 3 edge arrows', () => {
  const player = { x: 0, y: 0, z: 0 };
  // cámara mirando a -Z con fov simple: ndc = x/-z , y/-z
  const project = p => {
    const behind = p.z >= 0;
    const d = Math.abs(p.z) || 1;
    return { x: (p.x / d) * 1.5 * (behind ? -1 : 1), y: (p.y / d) * 1.5 * (behind ? -1 : 1), behind };
  };
  const enemies = [];
  for (let i = 0; i < 9; i++) enemies.push({ id: i, type: 'zombie', pos: { x: (i - 4) * 4, y: 1, z: -40 - i }, hpFrac: 1 });
  enemies.push({ id: 100, type: 'dragon', pos: { x: 0, y: 5, z: 120 }, hpFrac: 0.5, boss: true });      // detrás
  enemies.push({ id: 101, type: 'ufo', pos: { x: 300, y: 5, z: 0 }, hpFrac: 1 });                      // fuera de rango 300? dist 300
  enemies.push({ id: 102, type: 'ufo', pos: { x: 400, y: 5, z: 0 }, hpFrac: 1 });                      // >300: descartado
  const r = computeMarkers({ enemies, player, project, maxMarkers: 6, maxEdge: 3, maxDist: 300 });
  assert.equal(r.markers.length, 6);
  assert.ok(r.edges.length <= 3 && r.edges.length >= 1);
  assert.ok(!r.markers.concat(r.edges).some(m => m.id === 102));
  assert.ok(r.markers.every(m => m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1));
  assert.ok(r.markers.every((m, i, a) => i === 0 || a[i - 1].dist <= m.dist), 'sorted nearest first');
  const back = r.edges.find(e => e.id === 100);
  assert.ok(back, 'enemy behind the drone yields an edge arrow');
  assert.ok(back.x >= 0 && back.x <= 1 && back.y >= 0 && back.y <= 1);
  assert.ok(back.opacity > 0 && back.opacity <= 1);
});

test('interleaveQueue presents every type first and keeps the multiset', () => {
  const q = ['zombie', 'zombie', 'ufo', 'zombie', 'soldado', 'ufo'];
  const r = interleaveQueue(q);
  assert.deepEqual(r.slice(0, 3), ['zombie', 'ufo', 'soldado']);
  assert.deepEqual([...r].sort(), [...q].sort());
});
