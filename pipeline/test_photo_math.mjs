// Modo foto (WS E): focal <-> FOV y parámetros del DOF; bruma interior del void guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_LIMITS, focalToVFov, focalToDiagFov, dofParams } from '../web/flightverse/tour/photo-math.js';
import { VOID, mistFromDistance, mistFromEnclosure } from '../web/flightverse/tour/void-math.js';

test('focal 18-85 mm <-> FOV diagonal (~100° a 18 mm, ~29° a 85 mm)', () => {
  assert.ok(Math.abs(focalToDiagFov(18) - 100.4) < 0.5);
  assert.ok(Math.abs(focalToDiagFov(85) - 28.6) < 0.5);
  assert.ok(focalToDiagFov(24) > focalToDiagFov(50));
  let prev = Infinity;
  for (let f = 18; f <= 85; f += 1) {
    const v = focalToVFov(f, 16 / 9);
    assert.ok(v < prev, 'FOV baja al subir la focal'); prev = v;
  }
});

test('FOV vertical depende del aspecto (retrato > paisaje) y se conserva la diagonal', () => {
  const land = focalToVFov(35, 16 / 9), port = focalToVFov(35, 9 / 16);
  assert.ok(port > land);
  // diagonal reconstruida desde vertical+aspecto = diagonal del sensor
  for (const a of [0.46, 1, 1.6]) {
    const v = focalToVFov(35, a) * Math.PI / 180;
    const diag = 2 * Math.atan(Math.tan(v / 2) * Math.sqrt(1 + a * a)) * 180 / Math.PI;
    assert.ok(Math.abs(diag - focalToDiagFov(35)) < 1e-9);
  }
});

test('DOF: más apertura y más focal = más desenfoque; rango crece con f-number; límites respetados', () => {
  const a = dofParams(50, 1.8, 40), b = dofParams(50, 8, 40), c = dofParams(50, 16, 40);
  assert.ok(a.bokehScale > b.bokehScale && b.bokehScale > c.bokehScale);
  assert.ok(a.focusRange < b.focusRange && b.focusRange < c.focusRange);
  assert.ok(dofParams(85, 2.8, 40).bokehScale > dofParams(24, 2.8, 40).bokehScale);
  for (const f of [0.5, 1.8, 16, 40]) {
    const p = dofParams(85, f, 0.1);
    assert.ok(p.bokehScale >= 0.15 && p.bokehScale <= 9);
    assert.ok(p.focusDistance >= 0.5 && p.focusRange >= 3);
  }
  assert.ok(PHOTO_LIMITS.maxLongSide === 2560 && PHOTO_LIMITS.evMin === -2 && PHOTO_LIMITS.evMax === 2);
});

test('bruma interior: 0 lejos de la superficie, sube al acercarse, tope < 1, monótona', () => {
  assert.equal(mistFromDistance(2), 0);
  assert.equal(mistFromDistance(null), 0);
  assert.equal(mistFromDistance(VOID.wall0), 0);
  assert.ok(mistFromDistance(0.2) > 0);
  assert.ok(Math.abs(mistFromDistance(0) - VOID.maxMist) < 1e-9);
  assert.ok(mistFromDistance(0) < 1, 'nunca opaco del todo');
  let prev = -1;
  for (let d = 0.4; d >= 0; d -= 0.02) { const m = mistFromDistance(d); assert.ok(m >= prev - 1e-12); prev = m; }
});

test('bruma por encierro: 0-3 rayos = cielo abierto, 4 = parcial, 5-6 = dentro de un volumen', () => {
  assert.equal(mistFromEnclosure(0), 0);
  assert.equal(mistFromEnclosure(3), 0);
  assert.ok(mistFromEnclosure(4) > 0 && mistFromEnclosure(4) < mistFromEnclosure(5));
  assert.ok(mistFromEnclosure(5) < mistFromEnclosure(6));
  assert.equal(mistFromEnclosure(6), VOID.maxMist);
});
