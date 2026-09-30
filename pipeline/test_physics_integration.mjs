// Physics v2 wired into the real runtime + real world-collision (WS C).
// Runs runtime.js createDrone + physics/sim.js against createWorldCollision with a synthetic
// DSM (heightAt) and box buildings. Root-absolute browser imports are remapped to web/.
import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const WEB = new URL('../web', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('/flightverse/') || spec.startsWith('/vendor/')) {
    return { url: ${JSON.stringify(WEB)} + spec.split('?')[0], shortCircuit: true };
  }
  return next(spec, ctx);
}`));

const THREE = await import('/flightverse/three.js?v=1');
const { createWorldCollision } = await import('/flightverse/world-collision.js?v=1');
const { createMutableCollisionWorld } = await import('/flightverse/scene-object-collision.js?v=1');
const { createDrone, STEP } = await import('/flightverse/runtime.js?v=1');
const { createSim, RESPAWN_DELAY, INVULN_TIME, CLS_CRASH } = await import('/flightverse/physics/index.js?v=1');
const { buildVegetationField } = await import('/flightverse/physics/vegetation-field.js');

const v = (x, y, z) => ({ x, y, z });
const box = (min, max, materialClass = 'concrete') => ({
  node: { userData: {} },
  bounds: { min: v(...min), max: v(...max) },
  broadSphere: {
    center: v((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  },
  materialClass,
});
const IDLE = { fwd: 0, strafe: 0, yaw: 0, lift: 0, boost: false, brake: false, mouseDX: 0, mouseDY: 0 };
const inp = (o) => ({ ...IDLE, ...o });

async function makeWorld(items = [], heightAt = () => 0) {
  const w0 = await createWorldCollision({}, { heightAt, boundary: { shape: 'circle', radius: 400 } });
  const w = createMutableCollisionWorld(w0);
  w.setItems(items);
  return w;
}

function makeDrone(world, { x = 0, y = 40, z = 0, yaw = 0, profile = 'normal', wind = 'calm', seed = 7, hooks = {}, vegetation = null } = {}) {
  const d = createDrone({ world, spawn: { position_m: [x, y, z] } });
  d.yaw = yaw;
  const sim = createSim({
    world, altM: 2600, seed, profile, windPreset: wind,
    spawn: { x, y, z, yaw }, hooks, vegetation,
    radii: { structure: d.collisionRadius, boundary: d.collisionRadius },
  });
  d.attachV2(sim);
  return { d, sim };
}
const run = (d, n, input) => {
  for (let i = 0; i < n; i++) d.step(STEP, typeof input === 'function' ? input(i) : input, 'asistido');
};
const finite = (d) => [d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z].every(Number.isFinite);

test('hover in-world: flat DSM + buildings, calm air, sticks released -> stays put', async () => {
  const w = await makeWorld([box([40, 0, -20], [60, 50, 20])], () => 0);
  const { d, sim } = makeDrone(w, { y: 30 });
  run(d, 120 * 12, IDLE);
  assert.ok(finite(d));
  assert.ok(Math.hypot(d.pos.x, d.pos.z) < 0.35, `drifted ${Math.hypot(d.pos.x, d.pos.z)} m`);
  assert.ok(Math.abs(d.pos.y - 30) < 0.12, `altitude moved ${d.pos.y - 30}`);
  assert.ok(d.vel.length() < 0.08, `speed ${d.vel.length()}`);
  assert.equal(sim.stats.crashes, 0);
  assert.equal(sim.stats.nonFinite, 0);
  assert.ok(sim.att.tilt < 0.06, 'level in calm air');
});

test('wind hold: breezy and gusty air, sticks released -> position hold within a few metres, leaning into the wind', async () => {
  for (const [preset, bound] of [['breezy', 3], ['gusty', 6]]) {
    const w = await makeWorld([], () => 0);
    const { d, sim } = makeDrone(w, { y: 40, wind: preset, yaw: 0 });
    run(d, 120 * 6, IDLE);                       // let the integrators settle
    const p0 = d.pos.clone();
    let maxDev = 0, meanTilt = 0, n = 0;
    for (let i = 0; i < 120 * 30; i++) {
      d.step(STEP, IDLE, 'asistido');
      maxDev = Math.max(maxDev, d.pos.distanceTo(p0));
      meanTilt += sim.att.tilt; n++;
    }
    assert.ok(finite(d));
    assert.ok(maxDev < bound, `${preset}: wandered ${maxDev.toFixed(2)} m`);
    assert.ok(meanTilt / n > 0.02, `${preset}: does not lean into the wind (mean tilt ${(meanTilt / n).toFixed(3)} rad)`);
    assert.ok(sim.windInfo.speed > 0.3, 'wind is actually blowing');
  }
});

test('forward flight banks and pitches the body; lerpPose exposes the attitude', async () => {
  const w = await makeWorld([], () => 0);
  const { d } = makeDrone(w, { y: 60, wind: 'calm', yaw: 0 });
  run(d, 120 * 2, IDLE);
  run(d, 120 * 2, inp({ fwd: 1 }));
  const p = new THREE.Vector3();
  const o = d.lerpPose(0.5, p);
  assert.equal(o.v2, true);
  assert.ok(o.bodyPitch < -0.3, `nose-down pitch ${o.bodyPitch}`);             // 30 deg limit in normal
  run(d, 120, inp({ fwd: 0.3, strafe: 1, yaw: 0 }));
  const o2 = d.lerpPose(1, p);
  assert.ok(o2.roll > 0.1, `bank right ${o2.roll}`);
  assert.ok(Number.isFinite(o2.yaw) && o2.quat instanceof THREE.Quaternion);
});

test('profiles: cine < normal < sport top speed, sport tilts further', async () => {
  const speeds = {};
  for (const profile of ['cine', 'normal', 'sport']) {
    const w = await makeWorld([], () => 0);
    const { d, sim } = makeDrone(w, { y: 80, profile, wind: 'calm' });
    run(d, 120 * 10, inp({ fwd: 1 }));
    speeds[profile] = Math.hypot(d.vel.x, d.vel.z);
    assert.ok(sim.att.tilt <= (profile === 'cine' ? 0.33 : profile === 'normal' ? 0.54 : 0.75) + 0.02);
  }
  assert.ok(speeds.cine < speeds.normal && speeds.normal < speeds.sport, JSON.stringify(speeds));
  assert.ok(speeds.cine > 5 && speeds.sport > 11, JSON.stringify(speeds));
});

test('crash -> tumble -> respawn in under 1 s with 1.5-2 s of invulnerability', async () => {
  const events = [];
  const w = await makeWorld([box([60, 0, -30], [80, 60, 30])], () => 0);
  const { d, sim } = makeDrone(w, {
    x: 0, y: 30, z: 0, yaw: -Math.PI / 2, profile: 'sport', wind: 'calm',
    hooks: {
      onImpact: (e) => events.push(['impact', e.energyClass, sim.s.t]),
      onCrash: () => events.push(['crash', sim.s.t]),
      onRespawn: (e) => events.push(['respawn', sim.s.t, e.invulnerable]),
    },
  });
  run(d, 120 * 3, IDLE);                          // establish a safe snapshot at hover
  const before = d.pos.clone();
  let crashedAt = -1, respawnedAt = -1;
  for (let i = 0; i < 120 * 12 && respawnedAt < 0; i++) {
    d.step(STEP, inp({ fwd: 1, boost: true }), 'asistido');
    if (crashedAt < 0 && sim.crash.active) crashedAt = sim.s.t;
    if (crashedAt >= 0 && !sim.crash.active && sim.stats.respawns > 0) respawnedAt = sim.s.t;
    assert.ok(finite(d), 'NaN during the crash');
  }
  assert.ok(crashedAt > 0, 'flying into a wall at sport speed must crash: ' + JSON.stringify(events.slice(0, 4)));
  assert.ok(respawnedAt > 0, 'must respawn');
  assert.ok(respawnedAt - crashedAt <= 1.0, `respawn took ${(respawnedAt - crashedAt).toFixed(3)} s`);
  assert.ok(respawnedAt - crashedAt >= RESPAWN_DELAY - 0.02);
  assert.ok(sim.invuln > INVULN_TIME - 0.1 && sim.invuln <= INVULN_TIME);
  assert.ok(INVULN_TIME >= 1.5 && INVULN_TIME <= 2);
  assert.equal(sim.s.cut, 0);
  assert.equal(sim.s.integrity, 1);
  assert.ok(d.pos.x < 50, 'restored on the near side of the wall');
  assert.ok(d.pos.distanceTo(before) < 120);
  // invulnerable: flying straight back into the wall has no consequences
  const hits0 = sim.stats.crashes;
  run(d, 120, inp({ fwd: 1, boost: true }));
  assert.equal(sim.stats.crashes, hits0, 'no second crash while invulnerable');
  // and the cycle can repeat
  run(d, 120 * 4, IDLE);
  run(d, 120 * 8, inp({ fwd: 1, boost: true }));
  assert.ok(sim.stats.crashes >= 1 && sim.stats.respawns >= 1);
  assert.ok(events.some(e => e[0] === 'respawn'));
});

test('bump vs crash: a slow touch wobbles, a fast hit crashes', async () => {
  const outcomes = {};
  for (const [name, fwd, boost] of [['slow', 0.18, false], ['fast', 1, true]]) {
    const classes = [];
    const w = await makeWorld([box([30, 0, -30], [50, 60, 30])], () => 0);
    const { d, sim } = makeDrone(w, {
      x: 0, y: 30, z: 0, yaw: -Math.PI / 2, profile: 'normal', wind: 'calm',
      hooks: { onImpact: (e) => classes.push(e.energyClass) },
    });
    run(d, 120 * 3, IDLE);
    run(d, 120 * 14, inp({ fwd, boost }));
    outcomes[name] = { classes, crashes: sim.stats.crashes, integrity: sim.s.integrity };
  }
  assert.equal(outcomes.slow.crashes, 0, JSON.stringify(outcomes.slow));
  assert.ok(outcomes.slow.integrity > 0.8);
  assert.ok(outcomes.fast.crashes >= 1, JSON.stringify(outcomes.fast));
});

test('no tunnelling: 120 fast runs at a 0.3 m wall at random angles never get through', async () => {
  const wall = box([50, 0, -40], [50.3, 80, 40]);
  let rng = 12345;
  const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; };
  let crossings = 0, crashes = 0;
  for (let k = 0; k < 120; k++) {
    const w = await makeWorld([wall], () => 0);
    const yaw = -Math.PI / 2 + (rand() - 0.5) * 1.6;
    const { d, sim } = makeDrone(w, {
      x: 10 + rand() * 10, y: 20 + rand() * 40, z: (rand() - 0.5) * 30, yaw,
      profile: rand() < 0.5 ? 'sport' : 'normal', wind: 'gusty', seed: k + 1,
    });
    for (let i = 0; i < 120 * 9; i++) {
      d.step(STEP, inp({ fwd: 1, strafe: (rand() - 0.5) * 0.4, boost: true }), 'asistido');
      if (d.pos.x > 50.3 && d.pos.x < 52 && Math.abs(d.pos.z) < 40) { crossings++; break; }
      if (!finite(d)) assert.fail('NaN');
    }
    crashes += sim.stats.crashes;
  }
  assert.equal(crossings, 0, `${crossings} tunnelling events`);
  assert.ok(crashes > 10, 'runs did hit the wall');
});

test('leaning on a wall with the stick forward is stable: bounded tilt, no bleeding integrity', async () => {
  const w = await makeWorld([box([30, 0, -30], [50, 60, 30])], () => 0);
  const { d, sim } = makeDrone(w, { x: 0, y: 30, z: 0, yaw: -Math.PI / 2, profile: 'normal', wind: 'calm' });
  run(d, 120 * 3, IDLE);
  let maxTilt = 0;
  for (let i = 0; i < 120 * 34; i++) {          // slow approach (2.5 m/s), then 14 s of pushing on the wall
    d.step(STEP, inp({ fwd: 0.18 }), 'asistido');
    maxTilt = Math.max(maxTilt, sim.att.tilt);
  }
  assert.ok(d.pos.x > 28, 'reached the wall');
  assert.ok(maxTilt < 0.62, `tilted ${maxTilt} rad against the wall`);
  assert.ok(sim.s.integrity > 0.9, `integrity ${sim.s.integrity}`);
  assert.equal(sim.stats.crashes, 0);
});

test('a vertical 4 m/s landing is a bump, not a crash (Normal descend rate)', async () => {
  const w = await makeWorld([], () => 10);
  const { d, sim } = makeDrone(w, { y: 40, profile: 'normal', wind: 'calm' });
  run(d, 120 * 14, inp({ lift: -1 }));
  assert.equal(sim.stats.crashes, 0);
  assert.ok(sim.s.integrity > 0.9);
  assert.ok(d.pos.y < 11.6);
});

test('no stuck: sliding along a wall and a corner keeps moving', async () => {
  const w = await makeWorld([box([20, 0, -60], [24, 60, 60]), box([20, 0, 60], [80, 60, 64])], () => 0);
  const { d, sim } = makeDrone(w, { x: 10, y: 30, z: 0, yaw: -Math.PI / 4, profile: 'normal', wind: 'calm' });
  run(d, 120 * 2, IDLE);
  const z0 = d.pos.z;
  run(d, 120 * 6, inp({ fwd: 0.35, strafe: 0.25 }));      // glance along the wall
  assert.ok(finite(d));
  assert.ok(Math.abs(d.pos.z - z0) > 4 || sim.stats.crashes > 0, `did not slide: dz=${d.pos.z - z0}`);
  assert.equal(sim.stats.collisionFailures, 0);
});

test('terrain: lands on the DSM floor without sinking, taking little damage; never below MIN_AGL', async () => {
  const hills = (x, z) => 10 + 6 * Math.sin(x * 0.05) * Math.cos(z * 0.04);
  const w = await makeWorld([], hills);
  const { d, sim } = makeDrone(w, { x: 0, y: 40, z: 0, profile: 'normal', wind: 'calm' });
  run(d, 120 * 10, inp({ lift: -1 }));
  const g = hills(d.pos.x, d.pos.z);
  assert.ok(d.pos.y - g >= 1.19, `below the floor: ${d.pos.y - g}`);
  assert.ok(d.pos.y - g < 1.6, `did not settle on the floor: ${d.pos.y - g}`);
  assert.ok(sim.s.integrity > 0.9, `landing cost ${(1 - sim.s.integrity).toFixed(2)}`);
  assert.equal(sim.stats.crashes, 0);
  // stay put on the ground for 20 s without bleeding integrity (resting contact is free)
  const i0 = sim.s.integrity;
  run(d, 120 * 20, IDLE);
  assert.equal(sim.s.integrity, i0, 'resting contact must not damage');
  assert.ok(sim.stats.nonFinite === 0);
});

test('determinism across frame pacing: identical bits at the same step count', async () => {
  const script = (i) => inp({
    fwd: Math.sin(i * 0.011), strafe: Math.cos(i * 0.007) * 0.6, yaw: Math.sin(i * 0.004) * 0.5,
    lift: i % 900 < 450 ? 0.2 : -0.2, boost: i % 700 < 100,
  });
  const STEPS = 120 * 20;
  const results = [];
  for (const pacing of [[1 / 60], [1 / 30], [1 / 144, 1 / 50, 1 / 21], [0.05, 0.004]]) {
    const w = await makeWorld([box([55, 0, -10], [65, 50, 10])], () => 0);
    const { d, sim } = makeDrone(w, { x: 0, y: 35, z: 0, yaw: -Math.PI / 2, wind: 'gusty', seed: 99 });
    // the real loop: fixed-step accumulator (runtime.js createLoop semantics)
    let acc = 0, step = 0, k = 0;
    while (step < STEPS) {
      acc += pacing[k++ % pacing.length];
      while (acc >= STEP - 1e-9 && step < STEPS) { d.step(STEP, script(step), 'asistido'); acc -= STEP; step++; }
    }
    const s = sim.s;
    results.push(JSON.stringify([...s.p, ...s.v, ...s.q, ...s.w, ...s.m, s.integrity, sim.stats.crashes, sim.stats.respawns, sim.stats.steps]));
  }
  for (const r of results) assert.equal(r, results[0], 'state diverged between frame pacings');
});

test('external teleport (Gate Rush / autopilot) re-seeds the sim; Dios and Arcade keep the legacy integrator', async () => {
  const w = await makeWorld([], () => 0);
  const { d, sim } = makeDrone(w, { y: 40, wind: 'calm' });
  run(d, 120, inp({ fwd: 1 }));
  d.pos.set(100, 60, 50); d.prev.pos.copy(d.pos); d.vel.set(0, 0, 0); d.yaw = 1.0;
  d.step(STEP, IDLE, 'asistido');
  assert.ok(Math.abs(sim.s.p[0] - 100) < 0.05 && Math.abs(sim.s.p[2] - 50) < 0.05, 'sim followed the teleport');
  assert.ok(Math.abs(sim.att.yaw - 1.0) < 0.02);
  // Dios = noclip, legacy model: passes through terrain, sim untouched
  const steps0 = sim.stats.steps;
  for (let i = 0; i < 120; i++) d.step(STEP, inp({ lift: -1, boost: true }), 'dios');
  assert.equal(sim.stats.steps, steps0, 'dios does not step the sim');
  assert.ok(d.pos.y < 60 - 10, 'dios moved with the legacy integrator');
  // back to Normal: re-seeded from the drone
  d.step(STEP, IDLE, 'asistido');
  assert.ok(Math.abs(sim.s.p[1] - d.pos.y) < 0.05);
});

test('step cost: 7200 steps (60 s) well under the frame budget', async () => {
  const w = await makeWorld([box([40, 0, -20], [60, 50, 20])], (x, z) => 5 + Math.sin(x * 0.1));
  const { d } = makeDrone(w, { y: 40, wind: 'gusty' });
  const t0 = performance.now();
  run(d, 7200, (i) => inp({ fwd: Math.sin(i * 0.01), strafe: 0.3 }));
  const ms = performance.now() - t0;
  assert.ok(ms / 7200 < 0.25, `${(ms / 7200 * 1000).toFixed(1)} us/step`);
});

test('vegetation field: soft drag only inside a canopy, none above it', () => {
  const doc = { version: 1, types: ['tree_round', 'bush'], instances: [[10, 10, 0, 8, 0, 0, 0x335533], [50, 50, 0, 1.5, 0, 1, 0x335533]] };
  const f = buildVegetationField(doc, 100, () => 0);
  assert.ok(f && f.count === 2);
  assert.ok(f.densityAt(10, 4, 10) > 0.9, 'trunk centre');
  assert.ok(f.densityAt(10 + 5, 4, 10) > 0 && f.densityAt(10 + 5, 4, 10) < 0.6, 'soft edge');
  assert.equal(f.densityAt(10, 12, 10), 0, 'above the canopy');
  assert.equal(f.densityAt(30, 4, 30), 0);
  assert.equal(buildVegetationField({ version: 2 }, 10, () => 0), null);
});

test('vegetation drag slows the drone inside a canopy and leaves open air alone', async () => {
  const w = await makeWorld([], () => 0);
  const field = buildVegetationField({ version: 1, types: ['tree_round'], instances: [[30, 0, 0, 20, 0, 0, 0]] }, 10, () => 0);
  const vegetation = { densityAt: (x, y, z) => field.densityAt(x, y, z) };
  const a = makeDrone(w, { x: 0, y: 6, z: 0, yaw: -Math.PI / 2, wind: 'calm' });
  const b = makeDrone(w, { x: 0, y: 6, z: 0, yaw: -Math.PI / 2, wind: 'calm', vegetation });
  run(a.d, 120 * 5, inp({ fwd: 1 }));
  run(b.d, 120 * 5, inp({ fwd: 1 }));
  assert.ok(a.d.pos.x > 25, 'free flight reaches the tree position');
  assert.ok(b.d.pos.x < a.d.pos.x - 2, `canopy did not slow the drone (${b.d.pos.x} vs ${a.d.pos.x})`);
  assert.ok(b.sim.stats.crashes === 0 && b.sim.s.integrity === 1, 'soft drag never damages');
});

test('bogota air: thinner air means lower thrust margin but the hover still holds', async () => {
  const w = await makeWorld([], () => 0);
  const { sim } = makeDrone(w, { y: 40, wind: 'calm' });
  assert.ok(sim.rhoR > 0.7 && sim.rhoR < 0.78, `rho ratio ${sim.rhoR}`);
  assert.equal(CLS_CRASH, 4);
});
