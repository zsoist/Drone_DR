// Regression: HUD said "foto-real ±NaNcm" for aligned splats without rmse_m (aoi130), and Invasión
// defeat only flashed a toast. Pure helpers keep both behaviours testable outside the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splatAlignmentLabel, summarizeInvasionRun } from '../web/flightverse/hud-format.js';

test('splat alignment label never prints NaN', () => {
  assert.equal(splatAlignmentLabel({ aligned: true, rmse: 0.043 }), '±4cm');
  assert.equal(splatAlignmentLabel({ aligned: true, rmse: undefined }), 'alineado');
  assert.equal(splatAlignmentLabel({ aligned: true, rmse: null }), 'alineado');
  assert.equal(splatAlignmentLabel({ aligned: true, rmse: NaN }), 'alineado');
  assert.equal(splatAlignmentLabel({ aligned: false, rmse: null }), 'sin alinear');
  assert.equal(splatAlignmentLabel(null), 'sin alinear');
  for (const s of [{ aligned: true }, { aligned: true, rmse: 0 }, { aligned: false }]) {
    assert.doesNotMatch(splatAlignmentLabel(s), /NaN|undefined|null/);
  }
});

test('invasion run summary tracks the best score and survives odd state', () => {
  const first = summarizeInvasionRun({ wave: 3, killed: 9, score: 420, types: ['zombie'], difficulty: 'dificil' }, null);
  assert.deepEqual(
    { wave: first.wave, killed: first.killed, score: first.score, newBest: first.newBest, best: first.best },
    { wave: 3, killed: 9, score: 420, newBest: true, best: 420 },
  );
  const worse = summarizeInvasionRun({ wave: 1, killed: 1, score: 50 }, { score: 420 });
  assert.equal(worse.newBest, false);
  assert.equal(worse.best, 420);
  assert.equal(worse.difficulty, 'media');
  const zero = summarizeInvasionRun({ wave: 0, score: 0 }, null);
  assert.equal(zero.newBest, false, 'a zero-point run is not a record');
  assert.equal(zero.wave, 1);
  const junk = summarizeInvasionRun({ wave: 'x', killed: NaN, score: undefined, types: null }, { score: 'a' });
  assert.deepEqual([junk.wave, junk.killed, junk.score, junk.types.length], [1, 0, 0, 0]);
});

import { hudScale, humanSceneLabel, crashCauseLabel, FLIGHT_PROFILES } from '../web/flightverse/hud-format.js';

test('HUD scale: desktop grows with the viewport, phones stay at 1, text scale multiplies fonts only', () => {
  const d = hudScale(1440, 900);
  assert.ok(d.vs >= 1.25 && d.vs <= 1.5 && d.hs === d.vs, 'desktop 1440x900 scales the HUD');
  assert.ok(Math.round(12 * d.hs) >= 15, '12 px labels become >= 15 px on desktop');
  assert.deepEqual(hudScale(430, 932), { vs: 1, hs: 1, ts: 1 });
  assert.deepEqual(hudScale(932, 430, 130), { vs: 1, hs: 1.3, ts: 1.3 });
  assert.equal(hudScale(1440, 900, 130).hs, +(d.vs * 1.3).toFixed(3));
  assert.equal(hudScale(5000, 3000).vs, 1.5);
});

test('scene subtitle is human, never raw coverage data', () => {
  const h = humanSceneLabel('Zona · 200 m · círculo · 31.416 m² · malla 45%');
  assert.equal(h, 'Zona · zona de 200 m · Malla 45 %');
  assert.doesNotMatch(h, /círculo|m²/);
  assert.equal(humanSceneLabel(h), h, 'idempotent');
  assert.equal(humanSceneLabel('Zona · extensión nativa'), 'Zona · zona completa');
});

test('crash cause + flight profiles', () => {
  assert.equal(crashCauseLabel('prop'), 'hélice dañada');
  assert.equal(crashCauseLabel('crash', 0.5), 'golpe fuerte');
  assert.equal(crashCauseLabel('crash', 0), 'casco destruido');
  assert.deepEqual(FLIGHT_PROFILES.map(p => p.key), ['cine', 'normal', 'sport']);
  assert.ok(FLIGHT_PROFILES.every(p => p.desc.length > 10));
});
