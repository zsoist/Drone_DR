// Physics v2 — wind field, Dryden turbulence, shelter. node --test pipeline/test_physics_wind.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWind, sampleWind, drydenParams, meanWindSpeed, WIND_HZ } from '../web/flightverse/physics/wind.js';
import { createRng, rngNext, rngGauss } from '../web/flightverse/physics/rng.js';

test('mulberry32: deterministic, uniform in [0,1), gaussian mean/var', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  let same = true, diff = false;
  for (let i = 0; i < 100; i++) { const x = rngNext(a); if (x !== rngNext(b)) same = false; if (x !== rngNext(c)) diff = true; assert.ok(x >= 0 && x < 1); }
  assert.ok(same && diff);
  const g = createRng(7); let s1 = 0, s2 = 0; const n = 200000;
  for (let i = 0; i < n; i++) { const z = rngGauss(g); s1 += z; s2 += z * z; }
  assert.ok(Math.abs(s1 / n) < 0.01 && Math.abs(s2 / n - 1) < 0.02);
});

test('mean profile: power law W20 (h/6)^alpha, urban 0.3 / open 0.14', () => {
  const u = createWind({ w20: 4 }), o = createWind({ w20: 4, terrain: 'open' });
  assert.ok(Math.abs(meanWindSpeed(u, 6) - 4) < 1e-12);
  assert.ok(Math.abs(meanWindSpeed(u, 60) - 4 * Math.pow(10, 0.3)) < 1e-9);
  assert.ok(Math.abs(meanWindSpeed(o, 60) - 4 * Math.pow(10, 0.14)) < 1e-9);
});

test('presets: calm 0.5 / breezy 4 / gusty 7 (sigma x1.4)', () => {
  assert.equal(createWind({ preset: 'calm' }).w20, 0.5);
  assert.equal(createWind({ preset: 'breezy' }).w20, 4);
  const g = createWind({ preset: 'gusty' });
  assert.equal(g.w20, 7); assert.equal(g.sigmaMul, 1.4);
});

test('Dryden scales follow MIL-HDBK-1797 (feet formulas)', () => {
  const w = createWind({ w20: 6 }), out = new Float64Array(5);
  drydenParams(w, 10 * 0.3048 * 1, out);               // h = 3.048 m = 10 ft
  const den = 0.177 + 0.000823 * 10;
  assert.ok(Math.abs(out[2] - 0.6) < 1e-12);                                  // sigma_w = 0.1 W20
  assert.ok(Math.abs(out[0] - 0.6 / Math.pow(den, 0.4)) < 1e-9);              // sigma_u
  assert.ok(Math.abs(out[4] - 10 * 0.3048) < 1e-9);                           // L_w = h
  assert.ok(Math.abs(out[3] - 10 / Math.pow(den, 1.2) * 0.3048) < 1e-9);      // L_u
});

test('Dryden sigma within 5% over a long run (all three axes)', () => {
  for (const preset of ['breezy', 'gusty']) {
    const w = createWind({ preset, seed: 5, veer: 0 });
    const exp = new Float64Array(5);
    const h = 30;
    drydenParams(w, h, exp);
    const out = new Float64Array(3);
    let su = 0, sv = 0, sw = 0, n = 0;
    const steps = 25000 * WIND_HZ;
    for (let i = 0; i < steps; i++) {
      const t = i / WIND_HZ;
      sampleWind(w, t, 0, 100, 0, h, 5, out);
      su += w.tu * w.tu; sv += w.tv * w.tv; sw += w.tw * w.tw; n++;
    }
    const ru = Math.sqrt(su / n) / (exp[0]), rv = Math.sqrt(sv / n) / (exp[1]), rw = Math.sqrt(sw / n) / (exp[2]);
    for (const [nm, r] of [['u', ru], ['v', rv], ['w', rw]]) assert.ok(Math.abs(r - 1) < 0.05, `${preset} sigma_${nm} ratio ${r}`);
  }
});

test('turbulence is temporally correlated (L/V ~ seconds), not white', () => {
  const w = createWind({ preset: 'breezy', seed: 3, veer: 0 });
  const out = new Float64Array(3);
  let prev = 0, num = 0, den = 0;
  for (let i = 0; i < 60000; i++) {
    sampleWind(w, i / WIND_HZ, 0, 100, 0, 30, 5, out);
    num += w.tw * prev; den += w.tw * w.tw; prev = w.tw;
  }
  assert.ok(num / den > 0.95, `lag-1 autocorr ${num / den}`);
});

test('30 Hz cache: same vector between updates, new vector on the next tick', () => {
  const w = createWind({ preset: 'gusty', seed: 9 });
  const a = new Float64Array(3), b = new Float64Array(3), c = new Float64Array(3);
  sampleWind(w, 0, 0, 50, 0, 50, 5, a);
  sampleWind(w, 0.01, 0, 50, 0, 50, 5, b);
  assert.deepEqual(Array.from(a), Array.from(b));
  sampleWind(w, 0.034, 0, 50, 0, 50, 5, c);
  assert.notDeepEqual(Array.from(a), Array.from(c));
});

test('deterministic per seed, different across seeds', () => {
  const run = (seed) => { const w = createWind({ preset: 'gusty', seed }), o = new Float64Array(3), acc = []; for (let i = 0; i < 300; i++) { sampleWind(w, i / 30, 1, 20, 2, 20, 5, o); acc.push(o[0], o[1], o[2]); } return acc; };
  assert.deepEqual(run(1), run(1));
  assert.notDeepEqual(run(1), run(2));
});

test('urban shelter: tall building upwind cuts mean wind, raises sigma, may recirculate', () => {
  // wind blows toward +x; a 40 m wall occupies x in [-30,-10] (upwind of the drone at x=0)
  const heightAt = (x) => (x > -30 && x < -10 ? 40 : 0);
  const open = createWind({ w20: 6, seed: 1, veer: 0, dirRad: 0 });
  const shel = createWind({ w20: 6, seed: 1, veer: 0, dirRad: 0, heightAt });
  const o1 = new Float64Array(3), o2 = new Float64Array(3);
  sampleWind(open, 0, 0, 12, 0, 12, 5, o1);
  sampleWind(shel, 0, 0, 12, 0, 12, 5, o2);
  assert.ok(shel.shelter > 0.9, `shelter ${shel.shelter}`);
  assert.ok(shel.meanSpeed < 0.3 * open.meanSpeed, `mean ${shel.meanSpeed} vs ${open.meanSpeed}`);
  assert.ok(shel.sigW > 2 * open.sigW);
  // downwind of the wall in the open: no shelter
  const clear = createWind({ w20: 6, seed: 1, veer: 0, dirRad: 0, heightAt });
  sampleWind(clear, 0, -200, 12, 0, 12, 5, o1);
  assert.equal(clear.shelter, 0);
});

test('street canyon speeds the flow up; windward face gives an updraft', () => {
  const canyon = (x, z) => (Math.abs(z) > 8 && Math.abs(z) < 60 ? 40 : 0);
  const base = createWind({ w20: 6, veer: 0, dirRad: 0 });
  const can = createWind({ w20: 6, veer: 0, dirRad: 0, heightAt: canyon });
  const o = new Float64Array(3);
  sampleWind(base, 0, 0, 15, 0, 15, 5, o); const b = o[0];
  sampleWind(can, 0, 0, 15, 0, 15, 5, o);
  assert.ok(can.meanSpeed / base.meanSpeed > 1.2 && can.meanSpeed / base.meanSpeed <= 1.4, `${can.meanSpeed / base.meanSpeed}`);
  const face = (x) => (x > 8 && x < 30 ? 40 : 0);          // building just downwind
  const w = createWind({ w20: 6, veer: 0, dirRad: 0, heightAt: face, seed: 4 });
  let up = 0;
  for (let i = 0; i < 3000; i++) { sampleWind(w, i / 30, 0, 12, 0, 12, 5, o); up += o[1]; }
  assert.ok(up / 3000 > 0.3, `mean updraft ${up / 3000}`);
  assert.ok(b > 0);
});
