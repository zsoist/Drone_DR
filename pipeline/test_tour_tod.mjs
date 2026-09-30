// Hora del día (WS E): presets, continuo por elevación, noche usable y dirección del sol.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todParams, elevationOf, resolveTodKey, nearestTodKey, sunDirection, sunAzimuthDeg, gradeGain,
  TOD_ELEVATION, TOD_KEYFRAMES, ELEV_MIN, ELEV_MAX,
} from '../web/flightverse/tour/tod.js';

test('presets y alias: dia, dorada (golden), atardecer, noche', () => {
  assert.equal(resolveTodKey('golden'), 'dorada');
  assert.equal(resolveTodKey('night'), 'noche');
  assert.equal(resolveTodKey('marte'), null);
  assert.equal(elevationOf('dorada'), 8);       // spec: golden hour = sol a 8°
  assert.equal(elevationOf(30), 30);
  assert.equal(elevationOf('???'), null);
  assert.equal(nearestTodKey(6), 'dorada');
  assert.equal(nearestTodKey(-28), 'noche');
  assert.equal(nearestTodKey(60), 'dia');
});

test('el slider -5..70 cubre el continuo sin saltos y mantiene colores en rango', () => {
  assert.equal(ELEV_MIN, -5); assert.equal(ELEV_MAX, 70);
  let prev = null;
  for (let e = ELEV_MIN; e <= ELEV_MAX; e += 1) {
    const p = todParams(e);
    for (const c of [p.top, p.mid, p.horizon, p.tint]) for (const v of c) assert.ok(v >= 0 && v <= 1.3, `color ${e}`);
    assert.ok(Number.isFinite(p.ambient) && p.ambient > 0.4, `ambiente ${e}`);
    if (prev) {
      assert.ok(Math.abs(p.ev - prev.ev) < 0.15, `ev sin saltos en ${e}`);
      assert.ok(Math.abs(p.ambient - prev.ambient) < 0.1, `ambiente sin saltos en ${e}`);
      assert.ok(Math.abs(p.sunI - prev.sunI) < 0.15, `sol sin saltos en ${e}`);
    }
    prev = p;
  }
});

test('noche usable: piso de sombras, ambiente >= 0.5, nada negro (spec §10)', () => {
  const n = todParams('noche');
  assert.ok(n.ambient >= 0.5, 'ambiente alto');
  assert.ok(n.lift.every(v => v > 0.008), 'piso de sombras sin cero');
  assert.ok(n.moon > 0.5, 'luna como luz fría');
  assert.ok(n.tint[2] > n.tint[0], 'tinte frío (azul > rojo)');
  // gris medio 0.18 lineal tras el grade de noche debe seguir legible
  const gain = gradeGain(n.grade);
  assert.ok(gain > 0.45, `ganancia de noche ${gain.toFixed(2)}`);
  assert.ok(0.18 * gain > 0.06, 'luma de un gris medio >= 0.06 (criterio de aceptación)');
  assert.ok(n.glow > 0, 'brillo de lámparas/ventanas');
});

test('hora dorada: sol bajo y cálido; día neutro; atardecer más rojo que el día', () => {
  const g = todParams('dorada'), d = todParams('dia'), a = todParams('atardecer');
  assert.ok(g.tint[0] > g.tint[2], 'cálido');
  assert.deepEqual(d.tint, [1, 1, 1]);
  assert.ok(a.tint[0] > a.tint[2]);
  assert.ok(g.sunDir[1] < 0.2 && g.sunDir[1] > 0.1, `elevación ~8° (${g.sunDir[1].toFixed(2)})`);
  assert.ok(d.sunDir[1] > 0.8);
  assert.ok(g.sunI > d.sunI * 0.9, 'sol de hora dorada potente');
  assert.equal(g.lightDir, g.sunDir, 'de día la luz es el sol');
  const n = todParams('noche');
  assert.equal(n.lightDir, n.moonDir, 'de noche la luz es la luna');
});

test('geometría solar: vector unitario, azimut poniente con el sol bajo', () => {
  for (const e of [-5, 0, 8, 30, 70]) {
    const v = sunDirection(e);
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    assert.ok(Math.abs(Math.asin(v[1]) * 180 / Math.PI - e) < 1e-6);
  }
  assert.ok(sunAzimuthDeg(8) > 240 && sunAzimuthDeg(8) < 260, 'poniente');
  assert.ok(sunDirection(8)[0] < 0, 'sol al oeste (-x)');
});

test('keyframes ordenados y completos', () => {
  for (let i = 1; i < TOD_KEYFRAMES.length; i++) assert.ok(TOD_KEYFRAMES[i].elev > TOD_KEYFRAMES[i - 1].elev);
  assert.ok(Object.values(TOD_ELEVATION).every(e => e >= TOD_KEYFRAMES[0].elev && e <= TOD_KEYFRAMES.at(-1).elev));
  assert.equal(todParams(undefined).key, 'dia');
});
