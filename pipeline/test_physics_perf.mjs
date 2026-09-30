// Physics v2 — determinism, no-allocation hygiene, performance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeParams } from '../web/flightverse/physics/params.js';
import * as Q from '../web/flightverse/physics/quad.js';
import { createEnv, probeEnvironment } from '../web/flightverse/physics/aero.js';
import { createWind, sampleWind } from '../web/flightverse/physics/wind.js';

const DT = 1 / 120;
const dir = new URL('../web/flightverse/physics/', import.meta.url);
const src = (f) => readFileSync(new URL(f, dir), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// A scripted 20 s flight touching every subsystem (wind, VRS noise, sticks, modes).
function scripted(seed, chunk) {
  const P = makeParams({ profile: 'sport', battery: 1 }, 2600);
  const s = Q.createQuad(P, seed);
  s.p.set([0, 60, 0]);
  const wind = createWind({ preset: 'gusty', seed, heightAt: (x, z) => (Math.abs(x) < 30 && z > 20 ? 25 : 0) });
  const cmd = Q.createCmd(), env = createEnv(), wv = new Float64Array(3);
  const stepper = Q.createStepper(DT, 1000);
  const totalFrames = Math.round(20 / chunk);
  for (let f = 0; f < totalFrames; f++) {
    const tt = f * chunk;
    cmd.fwd = Math.sin(tt * 0.7); cmd.right = Math.cos(tt * 0.4) * 0.5; cmd.yaw = Math.sin(tt * 0.3);
    cmd.climb = tt > 10 ? -1 : 0;
    sampleWind(wind, s.t, s.p[0], s.p[1], s.p[2], s.p[1], 8, wv);
    env.wx = wv[0]; env.wy = wv[1]; env.wz = wv[2];
    Q.advanceQuad(s, P, cmd, env, stepper, chunk);
  }
  return { s, steps: stepper.steps };
}

// Chunk independence is tested with inputs that are a pure function of the
// step index (the scripted run above samples once per frame).
function chunked(chunks) {
  const P = makeParams({ profile: 'normal' });
  const s = Q.createQuad(P, 11);
  s.p.set([0, 40, 0]);
  const wind = createWind({ preset: 'breezy', seed: 11 });
  const cmd = Q.createCmd(), env = createEnv(), wv = new Float64Array(3);
  const stepper = Q.createStepper(DT, 1000);
  let k = 0;
  const frames = [];
  let acc = 0; while (acc < 4 - 1e-12) { const c = Math.min(chunks[k++ % chunks.length], 4 - acc); frames.push(c); acc += c; }
  for (const c of frames) {
    stepper.acc += c;
    while (stepper.acc >= DT - 1e-9) {
      const i = stepper.steps;
      cmd.fwd = Math.sin(i * 0.01); cmd.right = Math.cos(i * 0.007) * 0.6; cmd.yaw = Math.sin(i * 0.004);
      sampleWind(wind, s.t, s.p[0], s.p[1], s.p[2], s.p[1], 5, wv);
      env.wx = wv[0]; env.wy = wv[1]; env.wz = wv[2];
      Q.stepQuad(s, P, cmd, env, DT);
      stepper.acc -= DT; stepper.steps++;
    }
  }
  return { s, steps: stepper.steps };
}

const bits = (s) => Buffer.concat([s.p, s.v, s.q, s.w, s.m, s.iv].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))).toString('hex');

test('determinism: same seed -> bit-identical state, different seed -> different', () => {
  const a = scripted(5, 1 / 60), b = scripted(5, 1 / 60), c = scripted(6, 1 / 60);
  assert.equal(bits(a.s), bits(b.s));
  assert.notEqual(bits(a.s), bits(c.s));
  assert.equal(a.steps, 2400);
});

test('determinism: result independent of how frame time accumulates', () => {
  const ref = chunked([1 / 120]);
  for (const pattern of [[1 / 60], [1 / 30], [0.05], [0.0083, 0.0251, 0.0166, 0.0071], [0.2]]) {
    const r = chunked(pattern);
    assert.equal(r.steps, 480, `steps for ${pattern}`);
    assert.equal(bits(r.s), bits(ref.s), `pattern ${pattern}`);
  }
});

test('hot paths contain no allocations (no new / literals / closures)', () => {
  const q = src('quad.js');
  const region = (text, from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined);
  const hot = [
    ['quad.js', region(q, 'function rotFromQ', 'export function createStepper')],
    ['contact.js', region(src('contact.js'), 'export function resolveContact', 'export function createSafeSnapshot') + region(src('contact.js'), 'export function vegetationDrag')],
    ['wind.js', region(src('wind.js'), 'function marchMaxAngle')],
    ['aero.js', region(src('aero.js'), 'export function groundEffectRatio', 'export function createEnv') + region(src('aero.js'), 'export function probeEnvironment')],
  ];
  for (const [name, text] of hot) {
    assert.ok(text.length > 200, `${name} region found`);
    for (const [re, what] of [[/\bnew\s/, 'new'], [/=\s*\[/, 'array literal'], [/\(\s*\[/, 'array arg literal'], [/=>/, 'arrow fn'], [/\bfunction\s*\(/, 'closure'], [/\.\.\./, 'spread'], [/=\s*\{/, 'object literal'], [/\.(map|filter|slice|concat|forEach)\(/, 'alloc method'], [/`/, 'template string']]) {
      assert.ok(!re.test(text), `${name}: hot path contains ${what}`);
    }
  }
});

test('hot loop allocates ~nothing at runtime (heap growth bounded)', () => {
  const P = makeParams({ battery: 1 });
  const s = Q.createQuad(P, 1); s.p[1] = 100;
  const cmd = Q.createCmd(), env = createEnv();
  const wind = createWind({ preset: 'gusty', seed: 1, heightAt: () => 10 }), wv = new Float64Array(3);
  const one = (i) => { cmd.fwd = Math.sin(i * 0.01); sampleWind(wind, s.t, s.p[0], s.p[1], s.p[2], 50, 6, wv); env.wx = wv[0]; env.wy = wv[1]; env.wz = wv[2]; Q.stepQuad(s, P, cmd, env, DT); };
  for (let i = 0; i < 30000; i++) one(i);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 300000; i++) one(i);
  const grown = process.memoryUsage().heapUsed - before;
  // 300k steps: even a single 16-byte allocation per step would be 4.8 MB
  assert.ok(grown < 2.5e6, `heap grew ${grown} bytes`);
});

test('probeEnvironment uses only the injected ray function', () => {
  const env = createEnv();
  let calls = 0;
  probeEnvironment((ox, oy, oz, dx, dy, dz) => { calls++; return dy === -1 ? 1.5 : (dx === 1 ? 0.7 : Infinity); }, 0, 5, 0, 0.25, env);
  assert.equal(calls, 6);
  assert.equal(env.agl, 1.5); assert.equal(env.ceil, Infinity);
  assert.equal(env.wallDist, 0.7); assert.equal(env.wnx, 1);
});

test('performance: 120 Hz x 60 s (7200 steps) with wind + controller', () => {
  const P = makeParams({ profile: 'normal', battery: 1 });
  const s = Q.createQuad(P, 1); s.p[1] = 100;
  const cmd = Q.createCmd(), env = createEnv();
  const wind = createWind({ preset: 'gusty', seed: 1, heightAt: (x, z) => (x > 5 ? 20 : 0) }), wv = new Float64Array(3);
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      cmd.fwd = Math.sin(i * 0.004); cmd.right = Math.cos(i * 0.003); cmd.yaw = 0.3 * Math.sin(i * 0.002);
      sampleWind(wind, s.t, s.p[0], s.p[1], s.p[2], 50, 6, wv);
      env.wx = wv[0]; env.wy = wv[1]; env.wz = wv[2];
      Q.stepQuad(s, P, cmd, env, DT);
    }
  };
  run(30000);                                    // JIT warm-up
  const t0 = process.hrtime.bigint();
  run(7200);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perStep = ms / 7200;
  console.log(`# perf: 7200 steps in ${ms.toFixed(2)} ms -> ${(perStep * 1000).toFixed(2)} us/step (${perStep.toFixed(5)} ms)`);
  assert.ok(Number.isFinite(s.p[1]));
  assert.ok(perStep < 0.02, `${perStep} ms/step exceeds 0.02 ms target`);
});
