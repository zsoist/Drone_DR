// Flightverse fv2 iteración 2: regresión de hit-stop suave (6) y velocidad máxima robusta de Gate Rush (9).
// (El presupuesto de tareas largas de Invasión (2) lo mide invasion_runtime_gate.py en Chrome.)
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHitStop } from '../web/flightverse/fx/hitstop.js';
import { createStepAccumulator } from '../web/flightverse/loop-step.js';
import { TELEPORT_MPS, createSpeedTracker, resultSpeeds, topSpeedFor } from '../web/flightverse/gate-stats.js';

const STEP = 1 / 120;

// Simula el bucle: dron a 10 m/s, pintado a 60 fps, un hit-stop de 80 ms a los 0,2 s. Devuelve posiciones pintadas.
function runLoop({ skipSteps }) {
  const hs = createHitStop();
  const acc = createStepAccumulator({ step: STEP });
  let cur = 0, prev = 0, hitAcc = 0, sim = 0, steps = 0;
  const shown = [];
  const frame = 1 / 60;
  for (let f = 0; f < 60; f++) {
    const t = f * frame;
    if (Math.abs(t - 0.2) < frame / 2) hs.request(80);
    let n;
    if (skipSteps) {                         // esquema antiguo: acumulador normal + pasos saltados por la escala
      n = acc.feed(frame, 1);
    } else n = acc.feed(frame, hs.scale());   // esquema nuevo: la escala entra como tiempo
    for (let i = 0; i < n; i++) {
      if (skipSteps) { const ts = hs.scale(); if (ts < 1) { hitAcc += ts; if (hitAcc < 1) continue; hitAcc -= 1; } else hitAcc = 0; }
      prev = cur; cur += 10 * STEP; sim += STEP; steps++;
    }
    shown.push(prev + (cur - prev) * acc.alpha);
    hs.step(frame);
  }
  return { shown, sim, steps };
}

test('hit-stop keeps exact fixed steps and a smooth presentation (no skipped-step jerk)', () => {
  const { shown, steps } = runLoop({ skipSteps: false });
  const dx = shown.slice(1).map((p, i) => p - shown[i]);
  assert.ok(dx.every(d => d >= -1e-9), 'the drone never moves backwards');
  // durante el hit-stop el dron frena (el desplazamiento por frame baja) y luego retoma, sin picos
  const nominal = 10 / 60;
  assert.ok(Math.min(...dx) < nominal * 0.35, 'clear freeze feel: per-frame motion drops well below nominal');
  assert.ok(Math.max(...dx) < nominal * 1.15, 'no catch-up spike after the stop');
  for (let i = 1; i < dx.length; i++) assert.ok(Math.abs(dx[i] - dx[i - 1]) < nominal * 0.75, `frame ${i}: smooth change of speed`);
  assert.ok(steps > 0 && steps < 60 * 2, 'steps ran at the fixed dt');
});

test('the OLD skipped-step scheme is jerky (this is what the regression guards against)', () => {
  const { shown } = runLoop({ skipSteps: true });
  const dx = shown.slice(1).map((p, i) => p - shown[i]);
  const nominal = 10 / 60;
  const jerk = dx.some((d, i) => i && Math.abs(d - dx[i - 1]) >= nominal * 0.75) || Math.max(...dx) >= nominal * 1.15;
  assert.ok(jerk, 'old scheme should violate the smoothness bound');
});

test('accumulator: steps are exactly STEP, sim time = scaled real time', () => {
  const acc = createStepAccumulator({ step: STEP });
  let n = 0;
  for (let i = 0; i < 120; i++) n += acc.feed(1 / 60, 0.5);       // 2 s reales a escala 0,5 = 1 s de sim = 120 pasos
  assert.ok(Math.abs(n - 120) <= 1);
  assert.ok(acc.alpha >= 0 && acc.alpha < 1);
});

test('gate rush top speed comes from position/time and ignores teleports', () => {
  const tr = createSpeedTracker();
  let x = 0;
  for (let i = 0; i < 240; i++) {            // 2 s a 12 m/s (paso fijo 1/120)
    x += 12 * STEP; tr.add(STEP, { x, y: 50, z: 0 });
  }
  assert.ok(Math.abs(tr.top - 12) < 0.3, `top ${tr.top}`);
  tr.add(STEP, { x: x + 400, y: 50, z: 0 });  // teletransporte de 400 m en un paso
  assert.equal(tr.teleports, 1);
  assert.ok(tr.top < 13, 'a teleport does not create a fake 48 000 m/s');
  assert.ok(Math.abs(tr.distance - 12 * 240 * STEP) < 0.5, 'teleport distance is not counted');
});

test('gate rush: a run whose reported velocity is ~0.9 m/s still shows the real speed', () => {
  const tr = createSpeedTracker();
  let x = 0;
  for (let i = 0; i < 1200; i++) { x += 4.14 * STEP * 6; tr.add(STEP, { x, y: 0, z: 0 }); }   // ~25 m/s
  const top = topSpeedFor({ tracked: tr.top, avg: tr.avg, reported: 0.9 });
  assert.ok(top > 20, `top ${top}`);
  assert.ok(topSpeedFor({ tracked: 0, avg: 7, reported: 0.9 }) >= 7, 'never below the average');
  assert.equal(topSpeedFor({ tracked: 10, avg: 5, reported: TELEPORT_MPS + 1 }), 10, 'absurd reported speeds are discarded');
});

test('result card: vel máx is never below vel media (0.8 m/s top on a 480 m run is wrong)', () => {
  const r = resultSpeeds({ topSpeed: 0.838, dist: 480, t: 4.12 });
  assert.ok(r.top >= r.avg && r.top > 100);
  assert.deepEqual(resultSpeeds({ topSpeed: 12, dist: 0, t: 0 }), { avg: 0, top: 12 });
  assert.ok(resultSpeeds({ topSpeed: 25, dist: 300, t: 20 }).top === 25, 'a real flight keeps its measured top');
});
