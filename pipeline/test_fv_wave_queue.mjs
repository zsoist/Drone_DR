import test from 'node:test';
import assert from 'node:assert/strict';
import { capWaveQueue, DEVICE_BUDGETS } from '../web/flightverse/invasion-policy.js';

const ALL = ['zombie', 'arquero', 'soldado', 'ufo', 'avion', 'dragon', 'gigante'];

test('every selected enemy type survives queue truncation on all tiers/seeds', () => {
  for (const tier of Object.keys(DEVICE_BUDGETS)) {
    for (const wave of [1, 3, 6, 10]) {
      for (let seed = 1; seed <= 500; seed += 1) {
        const q = capWaveQueue({ types: ALL, wave, tier, difficulty: 'dificil', seed });
        assert.ok(q.length <= DEVICE_BUDGETS[tier].maxEnemies);
        for (const type of ALL) assert.ok(q.includes(type), `${type} missing tier=${tier} wave=${wave} seed=${seed}`);
      }
    }
  }
});

test('queue stays deterministic per seed', () => {
  const a = capWaveQueue({ types: ALL, wave: 8, tier: 'low', seed: 77 });
  assert.deepEqual(capWaveQueue({ types: ALL, wave: 8, tier: 'low', seed: 77 }), a);
});
