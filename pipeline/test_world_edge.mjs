// Borde del mundo (WS E): niebla-muro, aviso, límite suave, defaults y reescalado por ?diametro=.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryFromCoverage, boundaryExtent, edgeMetric, distToBoundary, fogFactor, softScale, softS,
  defaultEdge, resolveEdge, edgeState, limitThrust, EDGE_SOFT_BAND_M,
} from '../web/flightverse/tour/edge.js';

const circle = { shape: 'circle', radius: 130 };
const square = { shape: 'square', halfExtent: 100 };

test('métrica: euclídea en círculo, Chebyshev en cuadrado', () => {
  assert.equal(edgeMetric(30, 40, circle), 50);
  assert.equal(edgeMetric(30, 80, square), 80);
  assert.equal(distToBoundary(0, 0, circle), 130);
  assert.equal(distToBoundary(0, 130, circle), 0);
  assert.ok(distToBoundary(0, 140, circle) < 0);
});

test('boundaryFromCoverage usa el diámetro efectivo y la forma', () => {
  assert.deepEqual(boundaryFromCoverage({ effective_diameter_m: 200, shape: 'circle' }, 130), { shape: 'circle', radius: 100 });
  assert.deepEqual(boundaryFromCoverage({ effective_diameter_m: 200, shape: 'square' }, 130), { shape: 'square', halfExtent: 100 });
  assert.deepEqual(boundaryFromCoverage({}, 130), { shape: 'circle', radius: 130 });
});

test('niebla: 0 antes de fog[0], 1 desde fog[1], monótona y suave', () => {
  const fog = [250, 420];
  assert.equal(fogFactor(200, fog), 0);
  assert.equal(fogFactor(250, fog), 0);
  assert.equal(fogFactor(420, fog), 1);
  assert.equal(fogFactor(500, fog), 1);
  let prev = -1;
  for (let m = 240; m <= 430; m += 5) {
    const f = fogFactor(m, fog);
    assert.ok(f >= prev - 1e-12, `monótona en ${m}`);
    prev = f;
  }
  assert.ok(Math.abs(fogFactor(335, fog) - 0.5) < 1e-9, 'punto medio = 0.5');
});

test('default: niebla opaca ANTES del borde y aviso 30 m dentro (spec §10)', () => {
  for (const R of [50, 100, 130, 256, 430]) {
    const e = defaultEdge({ shape: 'circle', radius: R });
    assert.ok(e.fog[0] < e.fog[1]);
    assert.ok(e.fog[1] < R, `fog[1] < R (${R})`);
    assert.equal(e.warn, R - 30);
    assert.ok(e.warn <= e.fog[1]);
  }
});

test('resolveEdge: JSON válido se respeta; inválido cae al default; reescala por diámetro menor', () => {
  const native = 130;
  const json = { fog: [80, 122], warn: 100 };
  const same = resolveEdge(json, { shape: 'circle', radius: 130 }, native);
  assert.deepEqual(same.fog, [80, 122]);
  assert.equal(same.warn, 100);
  assert.equal(same.source, 'json');
  const half = resolveEdge(json, { shape: 'circle', radius: 65 }, native);
  assert.ok(Math.abs(half.fog[1] - 61) < 1e-9 || half.fog[1] <= 63, 'fog[1] escalado y < R');
  assert.ok(half.fog[1] <= 65 - 2);
  assert.ok(half.warn <= half.fog[1]);
  const bad = resolveEdge({ fog: [300, 100], warn: -4 }, { shape: 'circle', radius: 130 }, native);
  assert.equal(bad.source, 'default');
  const tooBig = resolveEdge({ fog: [80, 500], warn: 100 }, { shape: 'circle', radius: 130 }, native);
  assert.ok(tooBig.fog[1] <= 128, 'nunca opaca más allá de R-2');
});

test('límite suave: 1 lejos, 0 en la frontera, monótono en la última banda', () => {
  assert.equal(softScale(10, circle), 1);
  assert.equal(softScale(130 - EDGE_SOFT_BAND_M, circle), 1);
  assert.equal(softScale(130, circle), 0);
  assert.equal(softScale(140, circle), 0);
  let prev = 2;
  for (let m = 100; m <= 130; m += 2) {
    const s = softScale(m, circle);
    assert.ok(s <= prev + 1e-12);
    prev = s;
  }
  assert.ok(Math.abs(softS(115, circle) + softScale(115, circle) - 1) < 1e-12);
});

test('edgeState + limitThrust: frena sólo la componente saliente', () => {
  const edge = resolveEdge(null, circle, 130);
  const inside = edgeState(0, 0, circle, edge);
  assert.equal(inside.warn, false);
  assert.equal(inside.fog, 0);
  assert.equal(inside.scale, 1);
  const near = edgeState(120, 0, circle, edge);
  assert.equal(near.warn, true);
  assert.ok(near.out[0] > 0.99);
  const [tx, tz] = limitThrust(10, 4, near);
  assert.ok(tx < 10 && tx >= 0);
  assert.equal(tz, 4, 'tangencial intacto');
  const [ix] = limitThrust(-10, 0, near);
  assert.equal(ix, -10, 'entrante intacto');
  const atEdge = edgeState(130, 0, circle, edge);
  const [ex] = limitThrust(10, 0, atEdge);
  assert.ok(Math.abs(ex) < 1e-9, 'en la frontera no hay empuje saliente');
});

test('cuadrado: out apunta al lado dominante', () => {
  const edge = resolveEdge(null, square, 100);
  const st = edgeState(90, 20, square, edge);
  assert.deepEqual(st.out, [1, 0]);
  const st2 = edgeState(10, -95, square, edge);
  assert.deepEqual(st2.out, [0, -1]);
  assert.equal(boundaryExtent(square), 100);
});
