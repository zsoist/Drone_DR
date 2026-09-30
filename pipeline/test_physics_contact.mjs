// Physics v2 — contact solver. node --test pipeline/test_physics_contact.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeParams, G } from '../web/flightverse/physics/params.js';
import * as Q from '../web/flightverse/physics/quad.js';
import { createEnv } from '../web/flightverse/physics/aero.js';
import { createRng, rngNext } from '../web/flightverse/physics/rng.js';
import * as C from '../web/flightverse/physics/contact.js';

const DT = 1 / 120;
const ke = (s, P) => 0.5 * P.mass * (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2)
  + 0.5 * (P.Ix * s.w[0] ** 2 + P.Iy * s.w[1] ** 2 + P.Iz * s.w[2] ** 2);

const wallHit = (nx, ny, nz, kind = C.KIND_CONCRETE) => ({ nx, ny, nz, px: 0, py: 0, pz: 0, kind });

test('drop from 1 m onto concrete, e=0.3: rebound height ~ e^2 h, energy never increases', () => {
  const P = makeParams({ k1x: 0, k1y: 0, k1z: 0, cdaX: 0, cdaY: 0, cdaZ: 0 });
  const s = Q.createQuad(P, 1);
  s.cut = 1; s.m.fill(0);
  const ext = C.supportExtent(s, P, 0, 1, 0);
  assert.ok(Math.abs(ext - 0.045) < 1e-12, 'box half height 0.045 m');
  s.p[1] = ext + 1;
  const env = createEnv(), cmd = Q.createCmd(), out = C.createContactOut();
  let contacts = 0, peak = 0, tPeakStart = false, impactV = 0;
  let prevE = Infinity;
  for (let i = 0; i < 600; i++) {
    Q.stepQuad(s, P, cmd, env, DT);
    s.thr.fill(0);
    const vBefore = s.v[1];
    const cls = C.resolvePlane(s, P, 0, C.KIND_CONCRETE, out);
    if (cls !== C.CLS_NONE) { contacts++; if (contacts === 1) { impactV = -vBefore; tPeakStart = true; } }
    if (contacts >= 1 && tPeakStart) peak = Math.max(peak, s.p[1] - ext);
    if (contacts >= 2) break;
    if (contacts === 1) { /* after first contact: track rebound apex until it falls back */ }
    // mechanical energy, ignore discretisation ripple by comparing at contact only
    const E = ke(s, P) + P.mass * G * (s.p[1] - ext);
    if (cls !== C.CLS_NONE) { assert.ok(E <= prevE + 1e-6, `energy rose at contact: ${E} > ${prevE}`); }
    prevE = E;
  }
  const h = 1;
  assert.ok(Math.abs(impactV - Math.sqrt(2 * G * h)) < 0.08, `impact speed ${impactV}`);
  assert.ok(Math.abs(peak - 0.09 * h) < 0.008, `rebound apex ${peak} vs e^2 h = ${0.09 * h}`);
  assert.ok(Math.abs(s.p[0]) < 1e-9 && Math.abs(s.w[0]) < 1e-9, 'flat drop stays flat');
});

test('resting on the ground is stable (no sinking, no jitter energy)', () => {
  const P = makeParams();
  const s = Q.createQuad(P, 1); s.cut = 1; s.m.fill(0);
  const ext = C.supportExtent(s, P, 0, 1, 0);
  s.p[1] = ext + 0.001;
  const env = createEnv(), cmd = Q.createCmd(), out = C.createContactOut();
  for (let i = 0; i < 600; i++) { Q.stepQuad(s, P, cmd, env, DT); C.resolvePlane(s, P, 0, C.KIND_TERRAIN, out); }
  assert.ok(Math.abs(s.p[1] - ext) < 1e-6, `rest height ${s.p[1] - ext}`);
  assert.ok(Math.hypot(s.v[0], s.v[1], s.v[2]) < 1e-2);
});

test('fuzz: impulse never adds energy, never pulls the drone into the surface', () => {
  const P = makeParams();
  const rng = createRng(2024), out = C.createContactOut();
  let hits = 0;
  for (let k = 0; k < 4000; k++) {
    const s = Q.createQuad(P, 1);
    s.cut = 1;
    // random attitude
    let a = rngNext(rng) * 2 - 1, b = rngNext(rng) * 2 - 1, c = rngNext(rng) * 2 - 1, d = rngNext(rng) * 2 - 1;
    const n = Math.hypot(a, b, c, d) || 1; s.q.set([a / n, b / n, c / n, d / n]);
    for (let i = 0; i < 3; i++) { s.v[i] = (rngNext(rng) * 2 - 1) * 8; s.w[i] = (rngNext(rng) * 2 - 1) * 15; }
    let nx = rngNext(rng) * 2 - 1, ny = rngNext(rng) * 2 - 1, nz = rngNext(rng) * 2 - 1;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const before = ke(s, P);
    const kind = k % 3;
    const cls = C.resolveContact(s, P, wallHit(nx, ny, nz, kind), out);
    const after = ke(s, P);
    assert.ok(after <= before + 1e-9, `energy ${before} -> ${after}`);
    if (cls !== C.CLS_NONE) hits++;
    assert.ok(Number.isFinite(after));
  }
  assert.ok(hits > 500, 'fuzz exercised real impacts');
});

test('foliage absorbs (e=0), concrete bounces more than terrain', () => {
  const reb = (kind) => {
    const P = makeParams(); const s = Q.createQuad(P, 1); s.cut = 1;
    s.v[1] = -3; const out = C.createContactOut();
    C.resolveContact(s, P, wallHit(0, 1, 0, kind), out);
    return s.v[1];
  };
  assert.ok(Math.abs(reb(C.KIND_FOLIAGE)) < 1e-9);
  assert.ok(Math.abs(reb(C.KIND_CONCRETE) - 0.9) < 1e-9);
  assert.ok(Math.abs(reb(C.KIND_TERRAIN) - 0.75) < 1e-9);
});

test('e = 0 below 0.3 m/s normal speed (no micro-bouncing)', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1); s.cut = 1; s.v[1] = -0.25;
  C.resolveContact(s, P, wallHit(0, 1, 0), C.createContactOut());
  assert.ok(Math.abs(s.v[1]) < 1e-9);
});

test('Coulomb friction: sliding contact loses tangential speed, bounded by mu*j', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1); s.cut = 1;
  s.v[0] = 5; s.v[1] = -2;
  const out = C.createContactOut();
  C.resolveContact(s, P, wallHit(0, 1, 0, C.KIND_TERRAIN), out);
  const dvx = 5 - s.v[0];
  assert.ok(dvx > 0);
  assert.ok(Math.abs(dvx * P.mass - P.mu * out.impulse) < 1e-9, 'friction impulse = mu * normal impulse');
});

test('energy classes: <0.15 scrape, 0.15-1 wobble, 1-3 prop strike, >3 crash', () => {
  const P = makeParams();
  const cls = (E) => {
    const s = Q.createQuad(P, 1);
    s.v[0] = -Math.sqrt(2 * E / P.mass);
    const out = C.createContactOut();
    const c = C.resolveContact(s, P, wallHit(1, 0, 0), out);
    assert.ok(Math.abs(out.energy - E) < 1e-9);
    return { c, s, out };
  };
  assert.equal(cls(0.14).c, C.CLS_SCRAPE);
  assert.equal(cls(0.16).c, C.CLS_WOBBLE);
  assert.equal(cls(0.99).c, C.CLS_WOBBLE);
  assert.equal(cls(1.01).c, C.CLS_PROP);
  assert.equal(cls(2.99).c, C.CLS_PROP);
  assert.equal(cls(3.01).c, C.CLS_CRASH);
  assert.equal(cls(0.14).s.cut, 0);
  assert.equal(cls(2.9).s.cut, 0);
  assert.equal(cls(3.5).s.cut, 1, 'crash cuts the motors');
});

test('prop strike: 20-60% damage on the motors next to a mostly horizontal contact only', () => {
  const P = makeParams();
  const strike = (E, nx, ny) => {
    const s = Q.createQuad(P, 1);
    s.v[0] = -Math.sqrt(2 * E / P.mass) * 1;
    const out = C.createContactOut();
    C.resolveContact(s, P, wallHit(nx, ny, 0), out);
    return { s, out };
  };
  const lo = strike(1.01, 1, 0), hi = strike(2.99, 1, 0);
  // wall on the drone's -x side is hit by the left-side motors (index 2,3)
  assert.equal(lo.out.motorsHit, 0b1100);
  assert.ok(Math.abs(lo.s.dmg[2] - 0.2) < 0.01 && Math.abs(hi.s.dmg[3] - 0.6) < 0.01);
  assert.equal(lo.s.dmg[0], 0); assert.equal(lo.s.dmg[1], 0);
  // floor-like contact (normal mostly vertical) does not damage props
  const s = Q.createQuad(P, 1); s.v[1] = -Math.sqrt(2 * 2 / P.mass);
  const out = C.createContactOut(); C.resolveContact(s, P, wallHit(0, 1, 0), out);
  assert.equal(out.cls, C.CLS_PROP); assert.equal(out.motorsHit, 0);
});

test('off-centre hit produces angular impulse (tumble)', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1); s.cut = 1;
  s.q.set([Math.cos(0.3), 0, 0, Math.sin(0.3)]);       // rolled: lands on a corner
  s.v[1] = -3;
  C.resolveContact(s, P, wallHit(0, 1, 0), C.createContactOut());
  assert.ok(Math.hypot(s.w[0], s.w[1], s.w[2]) > 1);
});

test('separating velocity: no impulse', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1); s.v[1] = 2;
  const out = C.createContactOut();
  assert.equal(C.resolveContact(s, P, wallHit(0, 1, 0), out), C.CLS_NONE);
  assert.equal(s.v[1], 2);
});

test('lastSafe snapshot: restore levels the drone, keeps yaw, clears motion/damage', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1);
  Q.setYaw(s, 1.1); s.p.set([3, 50, -4]);
  const snap = C.createSafeSnapshot();
  assert.equal(C.restoreSafe(s, P, snap), false);
  C.recordSafe(snap, s);
  s.p.set([9, 1, 9]); s.q.set([0.5, 0.5, 0.5, 0.5]); s.v.fill(4); s.w.fill(3); s.dmg.fill(0.5); s.cut = 1; s.integrity = 0.1;
  assert.ok(C.restoreSafe(s, P, snap));
  assert.deepEqual(Array.from(s.p), [3, 50, -4]);
  assert.ok(Math.abs(s.q[0] - Math.cos(0.55)) < 1e-12 && Math.abs(s.q[2] - Math.sin(0.55)) < 1e-12);
  assert.equal(s.cut, 0); assert.equal(s.integrity, 1); assert.equal(s.dmg[0], 0); assert.equal(s.v[0], 0);
  const o = { s, P, cmd: Q.createCmd(), env: createEnv() };
  for (let i = 0; i < 600; i++) Q.stepQuad(s, P, o.cmd, o.env, DT);
  assert.ok(Math.hypot(...s.v) < 1e-3, 'flies again after respawn');
});

test('vegetation soft drag damps velocity smoothly and adds nothing', () => {
  const P = makeParams(); const s = Q.createQuad(P, 1); s.v[0] = 10;
  const f = C.vegetationDrag(s, P, 1, DT);
  assert.ok(f < 1 && f > 0.9 && Math.abs(s.v[0] - 10 * f) < 1e-12);
  const s2 = Q.createQuad(P, 1); s2.v[0] = 10;
  C.vegetationDrag(s2, P, 0, DT);
  assert.equal(s2.v[0], 10);
});
