// Flightverse workstream B (?fv=2): weapon table, ballistics/lead, lock, pooling caps,
// shake budget, hit-stop, FX recipes, surface typing and audio fingerprints.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISIL, SWARM_LOCK, WEAPON_FAMILY, WEAPON_FX, WEAPON_PROFILES, WEAPON_UI, WEAPON_UI_KEYS,
  explosionClass, gunSpread, misilProfileKey, usesHeat,
} from '../web/flightverse/weapon-registry.js';
import {
  ballisticStep, bulletDrop, createDwell, createLockTracker,
  createVelocityTracker, evaluateLead, pickLockCandidate, pickSwarmTargets, solveLead,
} from '../web/flightverse/aiming.js';
import { FX_CAPS, SlotPool, fxTierFor } from '../web/flightverse/fx/budget.js';
import { SHAKE_BUDGET, createShake, shakeOffsets } from '../web/flightverse/fx/shake.js';
import { HITSTOP_MS, createHitStop, hitStopFor } from '../web/flightverse/fx/hitstop.js';
import { EXPLOSIONS, crashBurst, explosion, muzzleFlash, surfaceImpact } from '../web/flightverse/fx/recipes.js';
import { surfaceOf } from '../web/flightverse/fx/surface.js';
import {
  BUS_GAINS, CENTROID_TARGET, DUCK, FIRE, createKillStreak, dbToGain, distanceModel,
  engineFromMotors, killPitch, lockBeepRate,
} from '../web/flightverse/audio/recipes.js';
import { renderLayers, spectralCentroid } from '../web/flightverse/audio/render.js';

// ── weapon table ───────────────────────────────────────────────────────────
test('arsenal is 6 player weapons; the 9 registry profiles stay (internal variants)', () => {
  assert.deepEqual([...WEAPON_UI_KEYS], ['mg', 'ac', 'm', 'sw', 'rg', 'tb']);
  assert.deepEqual(Object.keys(WEAPON_PROFILES), ['mg', 's', 'm', 'l', 'ac', 'sw', 'vx', 'rg', 'tb']);
  assert.deepEqual(Object.keys(WEAPON_UI).sort(), [...WEAPON_UI_KEYS].sort());
  for (const key of Object.keys(WEAPON_PROFILES)) assert.ok(WEAPON_FAMILY[key], key);
  assert.deepEqual(['s', 'm', 'l', 'vx'].map(k => WEAPON_FAMILY[k]), ['m', 'm', 'm', 'm']);
  assert.equal(WEAPON_UI.m.label, 'MISIL');
});

test('ammo/cooldown numbers of the spec table are the registry numbers', () => {
  const p = WEAPON_PROFILES;
  assert.equal(p.mg.rate, 0.085); assert.equal(p.mg.max, 120);
  assert.equal(p.ac.rate, 0.16); assert.equal(p.ac.max, 48);
  assert.equal(p.m.cd, 0.9); assert.equal(p.m.max, 8); assert.equal(p.m.speed, 56);
  assert.equal(p.vx.speed, 62); assert.equal(p.vx.turnRate, 1.9);
  assert.equal(p.sw.cd, 3.2); assert.equal(p.sw.count, 8); assert.equal(p.sw.interval, 0.085); assert.equal(p.sw.max, 4);
  assert.equal(p.rg.cd, 1.7); assert.equal(p.rg.max, 10);
  assert.equal(p.tb.cd, 4.8); assert.equal(p.tb.max, 2);
  assert.equal(WEAPON_FX.rg.charge, 0.35);
  assert.equal(WEAPON_FX.tb.charge, 0.6);
});

test('MISIL: tap is unguided M·M, a lock makes it the VIPER-X profile; ammo stays with m', () => {
  assert.equal(misilProfileKey({ guided: false }), 'm');
  assert.equal(misilProfileKey({ guided: true, target: null }), 'm');
  assert.equal(misilProfileKey({ guided: true, target: {} }), 'vx');
  assert.equal(MISIL.lockTime, 0.8);
  assert.equal(SWARM_LOCK.max, 8);
});

test('per-weapon FX table follows the spec (tracers, shake tiers, hit-stop)', () => {
  const mg = WEAPON_FX.mg; const ac = WEAPON_FX.ac;
  assert.equal(mg.tracer.every, 3); assert.equal(mg.tracer.length, 1.2); assert.equal(mg.tracer.width, 0.035);
  assert.equal(mg.tracer.core, '#FFF3D6'); assert.equal(mg.tracer.edge, '#FFB25A');
  assert.equal(ac.tracer.every, 1); assert.equal(ac.tracer.length, 2.0); assert.equal(ac.tracer.edge, '#FF8A3D');
  assert.equal(WEAPON_FX.rg.beam.edge, '#8FD3FF'); assert.equal(WEAPON_FX.rg.beam.afterglow, 1.2);
  assert.equal(mg.shake.tier, 'T1'); assert.equal(WEAPON_FX.m.shake.tier, 'T2');
  assert.equal(WEAPON_FX.rg.shake.tier, 'T3'); assert.equal(WEAPON_FX.tb.shake.tier, 'T3');
  assert.equal(WEAPON_FX.sw.shake.cap, 'T2');
  assert.equal(mg.hitstop, null); assert.equal(ac.hitstop, null); assert.equal(WEAPON_FX.sw.hitstop, null);
  assert.equal(WEAPON_FX.m.hitstop.kill, 50); assert.equal(WEAPON_FX.rg.hitstop.any, 70); assert.equal(WEAPON_FX.tb.hitstop.kill, 80);
  assert.ok(usesHeat('mg') && usesHeat('ac') && !usesHeat('m'));
  assert.ok(gunSpread('mg') > gunSpread('ac'));
  assert.equal(WEAPON_UI.mg.spreadPx, 22); assert.equal(WEAPON_UI.ac.spreadPx, 14);
});

test('explosion class from the registry big factor', () => {
  assert.equal(explosionClass(WEAPON_PROFILES.sw.big), 'S');
  assert.equal(explosionClass(WEAPON_PROFILES.s.big), 'S');
  assert.equal(explosionClass(WEAPON_PROFILES.m.big), 'M');
  assert.equal(explosionClass(WEAPON_PROFILES.vx.big), 'M');
  assert.equal(explosionClass(WEAPON_PROFILES.tb.big), 'XL');
});

// ── ballistics and lead ────────────────────────────────────────────────────
test('bullet drop at 200 m matches the spec (MG 3.6 m, AC 5.2 m)', () => {
  assert.ok(Math.abs(bulletDrop(WEAPON_PROFILES.mg.speed, WEAPON_PROFILES.mg.gravity, 200) - 3.6) < 0.1);
  assert.ok(Math.abs(bulletDrop(WEAPON_PROFILES.ac.speed, WEAPON_PROFILES.ac.gravity, 200) - 5.2) < 0.2);
});

test('simulated round drops exactly ½·g·t² (analytic step, step-size independent)', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 240]) {
    const pos = { x: 0, y: 0, z: 0 }; const vel = { x: 0, y: 0, z: -150 };
    const steps = Math.round((200 / 150) / dt);
    for (let i = 0; i < steps; i += 1) ballisticStep(pos, vel, 4, dt);
    const t = steps * dt;
    assert.ok(Math.abs(pos.y + 0.5 * 4 * t * t) < 1e-9);
  }
});

function flyTo(muzzle, aimPoint, speed, gravity, target, targetVel, dt = 1 / 240) {
  const dir = { x: aimPoint.x - muzzle.x, y: aimPoint.y - muzzle.y, z: aimPoint.z - muzzle.z };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const vel = { x: dir.x / len * speed, y: dir.y / len * speed, z: dir.z / len * speed };
  const pos = { ...muzzle };
  let best = Infinity;
  for (let t = 0; t < 3; t += dt) {
    const tp = { x: target.x + targetVel.x * t, y: target.y + targetVel.y * t, z: target.z + targetVel.z * t };
    best = Math.min(best, Math.hypot(pos.x - tp.x, pos.y - tp.y, pos.z - tp.z));
    ballisticStep(pos, vel, gravity, dt);
  }
  return best;
}

test('lead pipper: a round fired at the pipper hits a moving target (MG and AC)', () => {
  for (const key of ['mg', 'ac']) {
    const { speed, gravity } = WEAPON_PROFILES[key];
    const muzzle = { x: 0, y: 50, z: 0 };
    const target = { x: 30, y: 40, z: -180 }; const tv = { x: -9, y: 1.5, z: 4 };
    const lead = solveLead({ muzzle, target, targetVel: tv, speed, gravity });
    assert.ok(lead.aim.y > lead.intercept.y, 'aim is above the intercept by the drop');
    assert.ok(Math.abs(lead.drop - bulletDrop(speed, gravity, lead.range)) < 0.3);
    const miss = flyTo(muzzle, lead.aim, speed, gravity, target, tv);
    assert.ok(miss < 0.35, `${key} miss ${miss}`);
    const naive = flyTo(muzzle, target, speed, gravity, target, tv);
    assert.ok(naive > 3, `${key} naive aim must miss (${naive})`);
  }
});

test('lead pipper is shown only inside 250 m and the 30° front cone', () => {
  const base = { muzzle: { x: 0, y: 0, z: 0 }, cameraPos: { x: 0, y: 0, z: 0 }, cameraDir: { x: 0, y: 0, z: -1 }, speed: 150, gravity: 4, range: 250, cone: Math.PI / 6 };
  assert.ok(evaluateLead({ ...base, target: { x: 0, y: 0, z: -200 } }));
  assert.equal(evaluateLead({ ...base, target: { x: 0, y: 0, z: -300 } }), null);
  assert.equal(evaluateLead({ ...base, target: { x: 200, y: 0, z: -20 } }), null);
  assert.equal(evaluateLead({ ...base, target: null }), null);
});

test('velocity tracker estimates target motion and ignores teleports', () => {
  const tracker = createVelocityTracker({ smoothing: 1 });
  const key = {};
  tracker.update(key, { x: 0, y: 0, z: 0 }, 0.1);
  const v = tracker.update(key, { x: 1, y: 0, z: 0 }, 0.1);
  assert.ok(Math.abs(v.x - 10) < 1e-6);
  const teleport = tracker.update(key, { x: 500, y: 0, z: 0 }, 0.1);
  assert.equal(teleport.x, 0);
});

test('dwell needs 0.2 s inside tolerance', () => {
  const d = createDwell(0.2);
  assert.equal(d.step(0.1, 0.001, 0.006), false);
  assert.equal(d.step(0.11, 0.001, 0.006), true);
  assert.equal(d.step(0.05, 0.05, 0.006), false);
});

// ── lock ───────────────────────────────────────────────────────────────────
test('lock tracker: 0.8 s acquire, grace, lost fade', () => {
  const lock = createLockTracker({ lockTime: 0.8, loseGrace: 0.35, loseFade: 0.15 });
  const target = { id: 't' };
  let r = lock.step({ dt: 0.1, holding: true, candidate: target });
  assert.equal(r.state, 'acquiring');
  for (let i = 0; i < 7; i += 1) r = lock.step({ dt: 0.1, holding: true, candidate: target });
  assert.equal(r.state, 'acquiring');
  r = lock.step({ dt: 0.1, holding: true, candidate: target });
  assert.equal(r.state, 'locked');
  assert.equal(r.target, target);
  r = lock.step({ dt: 0.2, holding: true, candidate: null });
  assert.equal(r.state, 'locked');
  r = lock.step({ dt: 0.2, holding: true, candidate: null });
  assert.equal(r.state, 'lost');
  r = lock.step({ dt: 0.2, holding: true, candidate: null });
  assert.equal(r.state, 'none');
});

test('lock candidate: nearest to the aim ray, range and cone limited, occluders respected', () => {
  const mk = (x, z, r = 1) => ({ enemy: true, center: { x, y: 0, z }, radius: r, g: { userData: {} } });
  const near = mk(2, -100); const off = mk(40, -100); const far = mk(0, -900);
  const pick = pickLockCandidate({
    origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, candidates: [off, far, near], cone: MISIL.lockCone, range: MISIL.lockRange,
  });
  assert.equal(pick, near);
  const blocked = pickLockCandidate({
    origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, candidates: [near], cone: MISIL.lockCone, range: 400,
    castSegment: () => ({ fraction: 0.5, kind: 'structure' }),
  });
  assert.equal(blocked, null);
  const many = Array.from({ length: 12 }, (_, i) => mk(i - 6, -80 - i));
  assert.equal(pickSwarmTargets({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, candidates: many, cone: SWARM_LOCK.cone, range: 300, max: 8 }).length, 8);
});

// ── pooling caps ───────────────────────────────────────────────────────────
test('tier caps match the spec', () => {
  assert.deepEqual([FX_CAPS.low.sprites, FX_CAPS.low.debris, FX_CAPS.low.decals, FX_CAPS.low.lights], [64, 24, 16, 2]);
  assert.deepEqual([FX_CAPS.mid.sprites, FX_CAPS.mid.debris, FX_CAPS.mid.decals, FX_CAPS.mid.lights], [160, 48, 32, 3]);
  assert.deepEqual([FX_CAPS.high.sprites, FX_CAPS.high.debris, FX_CAPS.high.decals, FX_CAPS.high.lights], [320, 96, 64, 4]);
  assert.equal(FX_CAPS.high.haze, true); assert.equal(FX_CAPS.low.haze, false);
  assert.equal(fxTierFor({ coarse: true, width: 430, height: 932 }), 'low');
  assert.equal(fxTierFor({ coarse: true, width: 1024, height: 768 }), 'mid');
  assert.equal(fxTierFor({ coarse: false, width: 1440, height: 900 }), 'high');
});

test('500 spawn events never exceed the cap; the oldest entry is reused', () => {
  for (const tier of ['low', 'mid', 'high']) {
    const pool = new SlotPool(FX_CAPS[tier].sprites);
    const owner = new Map();
    for (let i = 0; i < 500; i += 1) {
      const { index, stolen } = pool.acquire();
      if (stolen) assert.ok(owner.has(index));
      owner.set(index, i);
      assert.ok(pool.live <= pool.capacity);
    }
    assert.equal(pool.live, pool.capacity);
    assert.equal(pool.spawned, 500);
    assert.equal(pool.stolen, 500 - pool.capacity);
    // the survivors are the newest `capacity` events
    assert.equal(Math.min(...owner.values()), 500 - pool.capacity);
  }
});

test('a full pool reuses the oldest slot, releasing frees slots', () => {
  const pool = new SlotPool(3);
  const a = pool.acquire().index; pool.acquire(); pool.acquire();
  assert.equal(pool.acquire().index, a);
  pool.release(1);
  assert.equal(pool.live, 2);
  assert.equal(pool.acquire().stolen, false);
});

// a sink that counts what the recipes emit and obeys a pool cap like the real system
function countingSink(cap) {
  const pool = new SlotPool(cap);
  const c = { sprite: 0, streak: 0, ring: 0, debris: 0, decal: 0, light: 0, flash: 0, screen: 0, maxLive: 0 };
  const grab = () => { pool.acquire(); c.maxLive = Math.max(c.maxLive, pool.live); };
  return {
    c,
    sprite: s => { c.sprite += 1; if (s.kind === 'flash') c.flash += 1; grab(); },
    streak: () => { c.streak += 1; grab(); },
    ring: () => { c.ring += 1; grab(); },
    debris: () => { c.debris += 1; },
    decal: () => { c.decal += 1; },
    light: () => { c.light += 1; },
    screenFlash: () => { c.screen += 1; },
  };
}

test('explosion recipes follow the spec counts at full quality', () => {
  const seq = (() => { let i = 0; return () => ((i++ * 0.37) % 1); })();
  const run = kind => { const sink = countingSink(9999); const counts = explosion(kind, sink, { pos: { x: 0, y: 0, z: 0 }, rnd: seq, q: 1 }); return { counts, sink }; };
  const S = run('S'); const M = run('M'); const XL = run('XL');
  assert.deepEqual([S.counts.flash, S.counts.fireball, S.counts.smoke, S.counts.debris, S.counts.light], [1, 6, 6, 8, 1]);
  assert.deepEqual([M.counts.flash, M.counts.fireball, M.counts.smoke, M.counts.ring, M.counts.debris, M.counts.sparks, M.counts.decal], [1, 10, 12, 1, 16, 12, 1]);
  assert.equal(XL.counts.fireball, 16); assert.equal(XL.counts.smoke, 20); assert.equal(XL.counts.debris, 32);
  assert.equal(XL.counts.screen, 1); assert.equal(S.counts.screen, 0);
  assert.equal(EXPLOSIONS.XL.screen.alpha, 0.15);
  assert.equal(EXPLOSIONS.M.ring.r1, 6); assert.equal(EXPLOSIONS.XL.ring.r1, 18);
});

test('explosion never skips the flash, even at the lowest quality or a full pool', () => {
  const sink = countingSink(4);      // absurdly small pool: still gets its flash (oldest is reused)
  const counts = explosion('M', sink, { pos: { x: 0, y: 0, z: 0 }, q: 0.05 });
  assert.equal(counts.flash, 1);
  assert.ok(counts.light === 1);
  assert.ok(sink.c.maxLive <= 4);
});

test('stress: 500 explosions on the phone tier keep live sprites <= 64', () => {
  const sink = countingSink(FX_CAPS.low.sprites);
  for (let i = 0; i < 500; i += 1) explosion(i % 7 === 0 ? 'XL' : i % 2 ? 'M' : 'S', sink, { pos: { x: i, y: 0, z: 0 }, q: FX_CAPS.low.quality });
  assert.ok(sink.c.maxLive <= FX_CAPS.low.sprites);
  assert.ok(sink.c.flash >= 500);
});

test('surface impacts: concrete dust+sparks, foliage 4 leaf cards, metal 8 sparks, ground dirt', () => {
  const seq = (() => { let i = 0; return () => ((i++ * 0.61) % 1); })();
  const run = (type, extra = {}) => {
    const kinds = [];
    const sink = { sprite: s => kinds.push(['sprite', s.kind, s.cell]), streak: () => kinds.push(['streak']), debris: () => kinds.push(['debris']), ring() {}, decal() {}, light() {} };
    const n = surfaceImpact(type, sink, { pos: { x: 0, y: 0, z: 0 }, rnd: seq, q: 1, ...extra });
    return { n, kinds };
  };
  const conc = run('concrete');
  assert.ok(conc.kinds.some(k => k[0] === 'sprite' && k[1] === 'dust') && conc.kinds.some(k => k[0] === 'streak'));
  assert.ok(conc.n <= 8);
  const fol = run('foliage');
  assert.equal(fol.kinds.filter(k => k[2] === 'leaf').length, 4);
  const met = run('metal', { heavy: false });
  assert.equal(met.kinds.filter(k => k[0] === 'streak').length, 8);
  const grd = run('ground');
  assert.ok(grd.kinds.some(k => k[0] === 'debris') && grd.kinds.some(k => k[1] === 'dust'));
});

test('crash burst: dust, 10 debris shards and 4 propeller fragments', () => {
  const debris = [];
  const counts = crashBurst({ sprite() {}, debris: d => debris.push(d) }, { pos: { x: 0, y: 0, z: 0 }, q: 1 });
  assert.equal(counts.debris, 10); assert.equal(counts.props, 4);
  assert.equal(debris.filter(d => d.prop).length, 4);
});

test('muzzle flash: billboard + two crossed quads (+ smoke wisp / casing when asked)', () => {
  const log = [];
  muzzleFlash({ sprite: s => log.push(s.kind), streak: () => log.push('cross'), ring: () => log.push('ring') },
    { pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, size: 0.7, life: 0.085, smoke: true });
  assert.deepEqual(log, ['muzzle', 'cross', 'cross', 'smoke']);
});

// ── shake budget ───────────────────────────────────────────────────────────
test('shake: total trauma is clamped at 0.35 and decays', () => {
  const shake = createShake();
  for (let i = 0; i < 50; i += 1) shake.add('T2', 0.1);
  assert.ok(shake.trauma <= SHAKE_BUDGET + 1e-9);
  assert.ok(Math.abs(shake.trauma - SHAKE_BUDGET) < 1e-9);
  const before = shake.trauma;
  shake.step(0.5);
  assert.ok(shake.trauma < before * 0.3);
  for (let i = 0; i < 40; i += 1) shake.step(0.1);
  assert.equal(shake.trauma, 0);
});

test('shake: at most one T3 per 1.5 s, the next is downgraded to T2', () => {
  const shake = createShake();
  shake.add('T3', 0.22); shake.step(0.05);
  shake.add('T3', 0.22);
  assert.equal(shake.stats().downgraded, 1);
  assert.ok(shake.trauma <= 0.22 + 0.10 + 1e-9);
  shake.step(1.6);
  const s2 = shake.stats().downgraded;
  shake.add('T3', 0.22);
  assert.equal(shake.stats().downgraded, s2);
});

test('shake: tier ranges are clamped and reduced motion removes the shake', () => {
  const shake = createShake();
  assert.ok(shake.add('T1', 0.5) <= 0.05 + 1e-9);
  assert.ok(shake.add('T2', 0.0) >= 0.06 - 1e-9 || shake.trauma >= 0.06);
  let reduced = true;
  const r = createShake({ reduced: () => reduced });
  assert.equal(r.add('T3', 0.22), 0);
  assert.equal(r.trauma, 0);
  reduced = false;
  assert.ok(r.add('T3', 0.22) > 0);
  const swarm = createShake();
  for (let i = 0; i < 8; i += 1) swarm.add('T1', 0.04, { ceiling: 0.10 });
  assert.ok(swarm.trauma <= 0.10 + 1e-9, '8 swarm hits cap at T2');
  assert.deepEqual(shakeOffsets(0, 1), { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 });
  assert.ok(Math.abs(shakeOffsets(0.35, 0.3).roll) > 0);
});

// ── hit-stop ───────────────────────────────────────────────────────────────
test('hit-stop: 40/60/80 ms on kills / big blasts only', () => {
  assert.deepEqual([HITSTOP_MS.S, HITSTOP_MS.M, HITSTOP_MS.XL], [40, 60, 80]);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.mg, hit: true }), 0);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.ac, hit: true }), 0);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.sw, size: 'S', hit: true }), 0);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.mg, kill: true }), 40);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.m, kill: true }), 50);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.m, size: 'M', hit: false }), 0, 'a blast that hits nothing does not stop time');
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.m, size: 'M', damaged: true, hit: true }), 60);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.rg, hit: true }), 70);
  assert.equal(hitStopFor({ weaponFx: WEAPON_FX.tb, size: 'XL' }), 80);
});

test('hit-stop window: scale 0.05 during the window, reduced motion skips, cooldown prevents chains', () => {
  const hs = createHitStop();
  assert.equal(hs.scale(), 1);
  assert.equal(hs.request(60), true);
  assert.ok(hs.scale() < 1 && hs.scale() > 0.05, 'eased: the window starts decelerating, not snapping');
  hs.step(0.02); assert.ok(Math.abs(hs.scale() - 0.05) < 0.02, 'plateau reaches ~0.05');
  hs.step(0.001); assert.ok(Math.abs(hs.scale() - 0.05) < 0.02);
  hs.step(0.05); assert.equal(hs.scale(), 1);
  assert.equal(hs.request(40), false, 'chained stops are rejected');
  hs.step(0.3);
  assert.equal(hs.request(40), true);
  const r = createHitStop({ reduced: () => true });
  assert.equal(r.request(80), false);
  assert.equal(r.scale(), 1);
});

// ── surface typing ─────────────────────────────────────────────────────────
test('surface typing from collision hits', () => {
  assert.equal(surfaceOf({ kind: 'terrain' }), 'ground');
  assert.equal(surfaceOf({ kind: 'structure' }), 'concrete');
  assert.equal(surfaceOf({ kind: 'target', target: { enemy: true, blood: true } }), 'body');
  assert.equal(surfaceOf({ kind: 'target', target: { enemy: true, blood: false } }), 'energy');
  assert.equal(surfaceOf({ kind: 'item', node: { name: 'metal_barrel', parent: null } }), 'metal');
  assert.equal(surfaceOf({ kind: 'item', node: { name: 'arbol_01', parent: null } }), 'foliage');
  assert.equal(surfaceOf({ kind: 'structure', surface: 'metal' }), 'metal');
  assert.equal(surfaceOf(null), 'ground');
});

// ── audio ──────────────────────────────────────────────────────────────────
test('fire sounds: spectral centroid per weapon within ±15% of the spec and in table order', () => {
  const measured = {};
  for (const [key, recipe] of Object.entries(FIRE)) {
    const values = [1, 2, 3].map(seed => spectralCentroid(renderLayers(recipe.layers, { seed })));
    measured[key] = values.reduce((a, b) => a + b, 0) / values.length;
    const target = CENTROID_TARGET[key];
    assert.ok(Math.abs(measured[key] - target) / target <= 0.15, `${key}: ${measured[key].toFixed(0)} Hz vs ${target}`);
  }
  const order = Object.keys(measured).sort((a, b) => measured[a] - measured[b]);
  assert.deepEqual(order, ['nova', 'misil', 'ac', 'swarm', 'mg', 'rail']);
});

test('kill confirm: two tones, +1 semitone per consecutive kill up to +6, reset after 3 s', () => {
  const streak = createKillStreak();
  assert.equal(streak.hit(0).pitch, 1);
  assert.ok(Math.abs(streak.hit(1).pitch - 2 ** (1 / 12)) < 1e-9);
  for (let i = 0; i < 10; i += 1) streak.hit(1.5 + i * 0.1);
  assert.ok(Math.abs(streak.hit(3).pitch - 2 ** (6 / 12)) < 1e-9, 'capped at +6');
  assert.equal(streak.hit(7).pitch, 1, 'reset after 3 s without kills');
  assert.equal(killPitch(1), 1);
});

test('mix: default gains, ducking, distance delay, lock beeps', () => {
  assert.deepEqual({ ...BUS_GAINS }, { master: 0.85, engine: 0.5, sfx: 0.8, ui: 0.7, music: 0.35, amb: 0.3 });
  assert.deepEqual([...DUCK.targets].sort(), ['amb', 'engine', 'music']);
  assert.equal(DUCK.attack, 0.02); assert.equal(DUCK.release, 0.6);
  assert.ok(Math.abs(dbToGain(6) - 0.501) < 0.01); assert.ok(Math.abs(dbToGain(9) - 0.355) < 0.01);
  assert.ok(Math.abs(distanceModel(343).delay - 1) < 1e-9);
  assert.equal(distanceModel(3430).delay, 1, 'delay capped at 1 s');
  assert.equal(distanceModel(0).delay, 0);
  assert.equal(lockBeepRate(0), 3); assert.equal(lockBeepRate(1), 12);
});

test('engine follows motor speeds and airspeed, with a fallback', () => {
  const idle = engineFromMotors([0.3, 0.3, 0.3, 0.3], 0);
  const push = engineFromMotors([0.9, 0.8, 0.9, 0.8], 14);
  assert.ok(push.freqs[0] > idle.freqs[0]);
  assert.ok(push.load > idle.load);
  assert.ok(push.wind > idle.wind);
  const uneven = engineFromMotors([0.5, 0.4, 0.5, 0.6], 0);
  assert.notEqual(uneven.freqs[1], uneven.freqs[3], 'each rotor follows its own motor');
  assert.ok(engineFromMotors([0.5, 0.5, 0.5, 0.5], 0, 0, 0.1).stutter > 0);
  assert.equal(engineFromMotors(null, 0).freqs.length, 4);
});
