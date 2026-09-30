// Physics v2 — rigid body, controllers, aero. node --test pipeline/test_physics_quad.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeParams, densityRatio, worldDensityRatio, G } from '../web/flightverse/physics/params.js';
import * as Q from '../web/flightverse/physics/quad.js';
import {
  createEnv, groundEffectRatio, ceilingEffectRatio, vrsBump, wallPullFraction, batteryMultiplier,
} from '../web/flightverse/physics/aero.js';

const DT = 1 / 120;
const DEG = 180 / Math.PI;

function fresh(over = {}, alt = 0, y = 200) {
  const P = makeParams(over, alt);
  const s = Q.createQuad(P, 1);
  s.p[1] = y;
  return { P, s, cmd: Q.createCmd(), env: createEnv() };
}
function run(o, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { Q.stepQuad(o.s, o.P, o.cmd, o.env, DT); if (each) each(i); }
}
const speed = (v) => Math.hypot(v[0], v[1], v[2]);

test('ISA density: Bogota 2600 m -> ~0.77, sea level 1', () => {
  assert.equal(densityRatio(0), 1);
  const r = densityRatio(2600);
  assert.ok(Math.abs(r - 0.773) < 0.005, `rho ratio ${r}`);
  assert.ok(Math.abs(worldDensityRatio('bogota') - r) < 1e-12);
});

test('hover equilibrium at rho 1.0 and 0.77: |v| < 1e-4 after 5 s', () => {
  for (const alt of [0, 2600]) {
    const o = fresh({}, alt);
    run(o, 5);
    assert.ok(speed(o.s.v) < 1e-4, `alt ${alt} |v|=${speed(o.s.v)}`);
    assert.ok(Math.abs(o.s.p[1] - 200) < 1e-3);
  }
});

test('terminal velocity, motors off, within 2% of analytic', () => {
  for (const alt of [0, 2600]) {
    const o = fresh({}, alt, 5000);
    o.s.cut = 1;
    run(o, 40);
    const P = o.P;
    const a = 0.5 * P.rho * P.cdaY / P.mass, b = P.k1y;
    const vt = (-b + Math.sqrt(b * b + 4 * a * G)) / (2 * a);
    assert.ok(Math.abs(-o.s.v[1] - vt) / vt < 0.02, `alt ${alt}: ${-o.s.v[1]} vs ${vt}`);
  }
});

test('20 deg pitch step: 10-90% rise 0.12-0.2 s, overshoot < 10%', () => {
  for (const alt of [0, 2600]) {
    const o = fresh({}, alt);
    o.cmd.mode = Q.MODE_ATT; o.cmd.pitchDeg = 20;
    let t10 = -1, t90 = -1, mx = 0;
    run(o, 3, (i) => {
      const a = o.s.tilt * DEG, t = (i + 1) * DT;
      if (t10 < 0 && a >= 2) t10 = t;
      if (t90 < 0 && a >= 18) t90 = t;
      if (a > mx) mx = a;
    });
    const rise = t90 - t10;
    assert.ok(rise >= 0.12 && rise <= 0.2, `alt ${alt} rise ${rise}`);
    assert.ok(mx < 22, `overshoot ${mx}`);
    assert.ok(Math.abs(o.s.tilt * DEG - 20) < 0.05, 'settles at 20 deg');
    // pitch step must not spill into roll/yaw
    assert.ok(Math.abs(o.s.w[1]) < 1e-3 && Math.abs(o.s.q[3]) < 1e-3);
  }
});

test('steady 5 m/s wind: hold tilt ~ atan((k1*5 + k2*25)/g) within 1 deg', () => {
  const o = fresh({}, 0);
  o.env.wx = 5;
  run(o, 60);
  const P = o.P;
  const k2 = 0.5 * P.rho * P.cdaX / P.mass;
  const expected = Math.atan((P.k1x * 5 + k2 * 25) / G) * DEG;
  assert.ok(Math.abs(o.s.tilt * DEG - expected) < 1, `tilt ${o.s.tilt * DEG} vs ${expected}`);
  assert.ok(speed(o.s.v) < 0.02, 'holds position');
  // wind blows toward +x and pushes the drone that way: thrust must lean toward -x (into the wind)
  const bx = 2 * (o.s.q[1] * o.s.q[2] - o.s.q[0] * o.s.q[3]);   // R[1] = body-up x
  assert.ok(bx < 0, 'thrust leans into the wind');
});

test('top speed emerges from tilt: cine ~6.5, normal ~10, sport ~14 m/s at sea level', () => {
  const want = { cine: [5.5, 7.5], normal: [9.5, 11.5], sport: [13, 15.5] };
  for (const [prof, [lo, hi]] of Object.entries(want)) {
    const o = fresh({ profile: prof }, 0);
    o.cmd.fwd = 1;
    run(o, 40);
    const v = Math.hypot(o.s.v[0], o.s.v[2]);
    assert.ok(v >= lo && v <= hi, `${prof} top speed ${v}`);
    assert.ok(Math.abs(o.s.tilt * DEG - o.P.tiltMax * DEG) < 0.5, `${prof} sits at tilt limit`);
    assert.ok(Math.abs(o.s.v[1]) < 0.5, `${prof} holds altitude`);
  }
});

test('Bogota density: lower climb, sport cannot hold altitude, normal still flies', () => {
  const climb = (alt) => {
    const o = fresh({}, alt, 3000);
    o.cmd.mode = Q.MODE_RATE; o.cmd.thr = 1;
    run(o, 5);
    return o.s.v[1];
  };
  const c0 = climb(0), c1 = climb(2600);
  assert.ok(c1 < c0 * 0.9, `climb sea ${c0} vs bogota ${c1}`);
  const sinkRate = (alt) => {
    const o = fresh({ profile: 'sport' }, alt);
    o.cmd.fwd = 1; run(o, 25);
    return { vy: o.s.v[1], m: o.s.m[0] };
  };
  const a = sinkRate(0), b = sinkRate(2600);
  assert.ok(b.m > 0.999 && a.m < 0.99, `motors saturate only at altitude: ${a.m} vs ${b.m}`);
  assert.ok(b.vy < a.vy - 0.5, `sport sinks at altitude: ${a.vy} vs ${b.vy}`);
  const o = fresh({ profile: 'normal' }, 2600); o.cmd.fwd = 1; run(o, 30);
  assert.ok(Math.hypot(o.s.v[0], o.s.v[2]) > 9);
});

test('angle mode: level stick returns to a stop; braking emerges from tilt', () => {
  const o = fresh({ profile: 'normal' });
  o.cmd.fwd = 1; run(o, 8);
  const v0 = Math.hypot(o.s.v[0], o.s.v[2]);
  assert.ok(v0 > 9);
  o.cmd.fwd = 0;
  let maxBrakeTilt = 0;
  run(o, 6, () => { maxBrakeTilt = Math.max(maxBrakeTilt, o.s.tilt); });
  assert.ok(Math.hypot(o.s.v[0], o.s.v[2]) < 0.05, 'stopped');
  assert.ok(maxBrakeTilt > 20 / DEG, 'pitched back to brake');
});

test('yaw stick rotates about world up without changing altitude', () => {
  const o = fresh();
  o.cmd.yaw = 1; run(o, 2);
  assert.ok(o.s.w[1] < -1, 'right stick = clockwise from above = negative yaw rate');
  assert.ok(Math.abs(o.s.p[1] - 200) < 0.05, "thrust bump from asymmetric motor lag stays small");
  assert.ok(o.s.tilt < 0.01);
});

test('acro mode: roll rate follows stick with expo; throttle 0.5 hovers', () => {
  const o = fresh();
  o.cmd.mode = Q.MODE_RATE; o.cmd.thr = 0.5; o.cmd.right = 0.5;
  run(o, 0.3);
  const P = o.P;
  const expected = P.rateMax * ((1 - P.rateExpo) * 0.5 + P.rateExpo * 0.125);
  assert.ok(Math.abs(o.s.w[2] - expected) / expected < 0.05, `roll rate ${o.s.w[2]} vs ${expected}`);
  const h = fresh(); h.cmd.mode = Q.MODE_RATE; h.cmd.thr = 0.5;
  run(h, 5);
  assert.ok(speed(h.s.v) < 1e-4);
});

test('motor lag is first-order with tau_up 30 ms / tau_down 50 ms (exact)', () => {
  const o = fresh();
  o.s.cut = 1; o.s.m.fill(1);
  run(o, 0.05);                       // down: exp(-1) after tau_down
  assert.ok(Math.abs(o.s.m[0] - Math.exp(-1)) < 1e-9, `${o.s.m[0]}`);
});

test('mixer desaturation keeps collective and never commands negative thrust', () => {
  const o = fresh();
  o.cmd.mode = Q.MODE_RATE; o.cmd.thr = 0.5; o.cmd.right = 1; o.cmd.fwd = 1; o.cmd.yaw = 1;
  let minM = 1;
  run(o, 2, () => { for (let i = 0; i < 4; i++) minM = Math.min(minM, o.s.m[i]); });
  assert.ok(minM >= 0 && Number.isFinite(o.s.p[1]) && Math.abs(o.s.q[0]) <= 1);
});

// ---- aero -----------------------------------------------------------------------
test('ground effect: 1.0667 at z=R, monotonic, ->1 far, finite at the clamp', () => {
  const R = 0.25;
  assert.ok(Math.abs(groundEffectRatio(R, R, 1) - 1.0666666666) < 1e-6);
  let prev = Infinity;
  for (let z = 0.5 * R; z < 20; z *= 1.15) {
    const r = groundEffectRatio(z, R, 1);
    assert.ok(r <= prev + 1e-12 && r >= 1 && Number.isFinite(r));
    prev = r;
  }
  assert.ok(groundEffectRatio(50, R, 1) - 1 < 1e-4);
  assert.equal(groundEffectRatio(Infinity, R, 1), 1);
  assert.equal(groundEffectRatio(0, R, 1), groundEffectRatio(0.5 * R, R, 1));
});

test('ground effect in step: thrust near ground higher than in free air', () => {
  const a = fresh(), b = fresh();
  b.env.agl = 0.25;
  Q.stepQuad(a.s, a.P, a.cmd, a.env, DT); Q.stepQuad(b.s, b.P, b.cmd, b.env, DT);
  assert.ok(Math.abs(b.s.thrustSum / a.s.thrustSum - groundEffectRatio(0.25, 0.25, 1)) < 1e-9);
});

test('ceiling and wall effects: bounded, zero when far', () => {
  assert.ok(ceilingEffectRatio(0.3, 0.25, 1.5, 1.5) <= 1.5);
  assert.ok(ceilingEffectRatio(0.3, 0.25, 1.5, 1.5) > 1);
  assert.equal(ceilingEffectRatio(Infinity, 0.25, 1.5, 1.5), 1);
  assert.equal(wallPullFraction(10, 0.5, 0.04), 0);
  assert.ok(wallPullFraction(0.4, 0.5, 0.04) > wallPullFraction(1.2, 0.5, 0.04));
  const o = fresh(); o.env.wallDist = 0.4; o.env.wnx = 1;
  run(o, 0.1);
  assert.ok(o.s.v[0] > 0, 'pulled toward the wall');
});

test('VRS bump only in r in [0.3,1.6] and vanishes with horizontal speed', () => {
  for (const r of [-1, 0, 0.1, 0.3, 1.6, 2, 5]) assert.equal(vrsBump(r), 0);
  assert.ok(Math.abs(vrsBump(0.95) - 1) < 1e-12);
  const thrustWith = (vy, vx, depth) => {
    const o = fresh({ vrsDepth: depth });
    o.s.v[1] = vy; o.s.v[0] = vx;
    Q.stepQuad(o.s, o.P, o.cmd, o.env, DT);
    return { T: o.s.thrustSum, vrs: o.s.vrs, vh: o.P.vh };
  };
  const vh = makeParams().vh;
  const on = thrustWith(-0.95 * vh, 0, 0.25), off = thrustWith(-0.95 * vh, 0, 0);
  assert.ok(on.vrs > 0.95);
  assert.ok(Math.abs(on.T / off.T - (1 - 0.25 * on.vrs)) < 1e-9, 'thrust drop = 25% * B');
  for (const vy of [-0.1 * vh, -2 * vh, 0.5 * vh]) assert.equal(thrustWith(vy, 0, 0.25).vrs, 0);
  assert.equal(thrustWith(-0.95 * vh, 0.8 * vh, 0.25).vrs, 0, 'horizontal speed kills VRS');
  assert.ok(thrustWith(-0.95 * vh, 0.2 * vh, 0.25).vrs < on.vrs);
});

test('battery sag 1 -> 0.85, SoC drains at the calibrated hover rate', () => {
  assert.equal(batteryMultiplier(1, 0.35, 0.15), 1);
  assert.ok(Math.abs(batteryMultiplier(0, 0.35, 0.15) - 0.85) < 1e-12);
  const o = fresh({ battery: 1, hoverSeconds: 100 });
  run(o, 10);
  assert.ok(Math.abs(o.s.soc - 0.9) < 0.005, `soc ${o.s.soc}`);
});

test('damaged motor loses thrust (per-motor damage) and disturbs attitude', () => {
  const o = fresh(); o.s.dmg[0] = 0.5;
  run(o, 0.5);
  assert.ok(o.s.tilt > 0.02 || Math.abs(o.s.w[1]) > 0.01);
});
