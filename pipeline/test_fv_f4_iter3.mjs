// F4 iteration 3: landing assist, integrity regen, respawn fallback, gamepad disconnect, key repeat.
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

const { createWorldCollision } = await import('/flightverse/world-collision.js?v=1');
const { createMutableCollisionWorld } = await import('/flightverse/scene-object-collision.js?v=1');
const { createSim } = await import('/flightverse/physics/index.js?v=1');
const { createGamepad, PAD } = await import('/flightverse/input/gamepad.js?v=1');
const { CONTROL_DEFAULTS } = await import('/flightverse/input/curves.js?v=1');

const STEP = 1 / 120;
const v = (x, y, z) => ({ x, y, z });
const box = (min, max) => ({
  node: { userData: {} }, bounds: { min: v(...min), max: v(...max) },
  broadSphere: { center: v((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 },
  materialClass: 'concrete',
});
const I = (o = {}) => ({ fwd: 0, strafe: 0, lift: 0, yaw: 0, boost: false, brake: false, ...o });
async function world(items = []) {
  const w0 = await createWorldCollision({}, { heightAt: () => 0, boundary: { shape: 'circle', radius: 400 } });
  const w = createMutableCollisionWorld(w0);
  w.setItems(items);
  return w;
}
const mk = (w, o = {}) => createSim({ world: w, altM: 2600, seed: 1, profile: 'sport', windPreset: 'calm',
  spawn: { x: 0, y: 45, z: 0, yaw: 0 }, ...o });

test('sport full-stick descent onto a roof and onto terrain is a landing, not a crash', async () => {
  const w = await world([box([-30, -2, -30], [30, 30, 30])]);
  const sim = mk(w);
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < 120 * 12 && sim.s.p[1] > 31.3; i++) sim.step(STEP, I({ lift: -1 }));
    for (let i = 0; i < 120; i++) sim.step(STEP, I());
    for (let i = 0; i < 360 && sim.s.p[1] < 42; i++) sim.step(STEP, I({ lift: 1 }));
  }
  assert.equal(sim.stats.crashes, 0);
  assert.ok(sim.s.integrity > 0.99, `integrity ${sim.s.integrity}`);
  const g = await world();
  const s2 = mk(g, { spawn: { x: 0, y: 40, z: 0, yaw: 0 } });
  for (let i = 0; i < 120 * 14; i++) s2.step(STEP, I({ lift: -1, boost: true }));
  assert.equal(s2.stats.crashes, 0);
  assert.ok(s2.s.integrity > 0.99);
});

test('real crashes still crash: wall at speed and a steep dive', async () => {
  const w = await world([box([40, 0, -40], [50, 80, 40])]);
  const sim = mk(w, { spawn: { x: 0, y: 30, z: 0, yaw: -Math.PI / 2 } });   // yaw -90 deg: forward = +x
  for (let i = 0; i < 120 * 8 && !sim.stats.crashes; i++) sim.step(STEP, I({ fwd: 1, boost: true }));
  assert.ok(sim.stats.crashes >= 1, 'wall impact must crash');
  const g = await world();
  const s2 = mk(g, { spawn: { x: 0, y: 60, z: 0, yaw: 0 } });
  s2.reseed(0, 6, 0, 0, 0, -16, 0);
  for (let i = 0; i < 120 * 4 && !s2.stats.crashes; i++) s2.step(STEP, I());
  assert.ok(s2.stats.crashes >= 1, 'a 16 m/s dive into the ground must crash');
});

test('integrity regenerates slowly in stable free flight', async () => {
  const sim = mk(await world());
  sim.s.integrity = 0.8;
  for (let i = 0; i < 120 * 12; i++) sim.step(STEP, I());
  assert.ok(sim.s.integrity > 0.83 && sim.s.integrity < 0.9, `integrity ${sim.s.integrity}`);
  for (let i = 0; i < 120 * 60; i++) sim.step(STEP, I());
  assert.equal(sim.s.integrity, 1);
});

test('a second crash right after respawn returns to the respawn point, not world spawn', async () => {
  const sim = mk(await world(), { spawn: { x: 0, y: 40, z: 0, yaw: 0 } });
  for (let i = 0; i < 120 * 10; i++) sim.step(STEP, I({ fwd: 1 }));
  const flownX = sim.s.p[2];
  assert.ok(Math.abs(flownX) > 40, 'flew away from spawn');
  sim.forceRespawn();
  const r1 = [sim.s.p[0], sim.s.p[1], sim.s.p[2]];
  for (let i = 0; i < 40; i++) sim.step(STEP, I({ fwd: 1 }));
  sim.forceRespawn();
  const dist = Math.hypot(sim.s.p[0] - r1[0], sim.s.p[2] - r1[2]);
  assert.ok(dist < 10, `second respawn ${dist} m from the first respawn point`);
  assert.ok(Math.hypot(sim.s.p[0], sim.s.p[2]) > 30, 'not sent back to world spawn');
});

test('gamepad disconnect while firing emits fireUp', () => {
  let pads = [{ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }];
  const g = createGamepad({ getPads: () => pads });
  const ev = [];
  const poll = (t) => { const s = g.poll(CONTROL_DEFAULTS); if (s.edges.fireDown) ev.push(t + ':down'); if (s.edges.fireUp) ev.push(t + ':up'); };
  poll('a');
  pads[0].buttons[PAD.RT] = { pressed: true, value: 1 }; poll('b');
  pads = [null]; poll('c'); poll('d');
  assert.deepEqual(ev, ['b:down', 'c:up']);
});

test('createInput re-arms a key that is still held after clear (auto-repeat keydown)', async () => {
  const L = {};
  globalThis.addEventListener = (t, f) => { (L[t] ||= []).push(f); };
  globalThis.removeEventListener = () => {};
  globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
  const { createInput } = await import('/flightverse/runtime.js?v=1');
  const el = { addEventListener() {}, removeEventListener() {} };
  const inp = createInput(el);
  const fire = (t, e) => (L[t] || []).forEach((f) => f({ target: null, preventDefault() {}, ...e }));
  fire('keydown', { code: 'KeyW', repeat: false });
  assert.equal(inp.sample().fwd, 1);
  fire('blur', {});
  assert.equal(inp.sample().fwd, 0);
  fire('keydown', { code: 'KeyW', repeat: true });
  assert.equal(inp.sample().fwd, 1);
  inp.dispose();
});
