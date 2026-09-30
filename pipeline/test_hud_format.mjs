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
