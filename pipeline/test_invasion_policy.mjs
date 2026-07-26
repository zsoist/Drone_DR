import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capWaveQueue,
  createBurstSchedule,
  DEVICE_BUDGETS,
  engagementState,
  getDeviceBudget,
  nextEnemyState,
  predictiveAim,
  selectEnemyLod,
  steerGroundEnemy,
} from '../web/flightverse/invasion-policy.js';

test('device tiers cap enemies, projectiles, and near-detail models', () => {
  assert.deepEqual(getDeviceBudget('low'), {
    maxEnemies: 12,
    maxProjectiles: 18,
    nearDetail: 1,
    fullDistance: 18,
    lod1Distance: 42,
  });
  assert.deepEqual(getDeviceBudget('medium'), {
    maxEnemies: 20,
    maxProjectiles: 32,
    nearDetail: 3,
    fullDistance: 26,
    lod1Distance: 70,
  });
  assert.deepEqual(getDeviceBudget('high'), {
    maxEnemies: 30,
    maxProjectiles: 48,
    nearDetail: 6,
    fullDistance: 36,
    lod1Distance: 100,
  });
  assert.equal(DEVICE_BUDGETS.low.maxEnemies < DEVICE_BUDGETS.high.maxEnemies, true);
});

test('LOD selection reserves full models for the near-detail budget', () => {
  assert.equal(selectEnemyLod('zombie', 17.9, 'low', { nearUsed: 0 }), 'full');
  assert.equal(selectEnemyLod('zombie', 17.9, 'low', { nearUsed: 1 }), 'lod1');
  assert.equal(selectEnemyLod('zombie', 42, 'low', { nearUsed: 1 }), 'lod1');
  assert.equal(selectEnemyLod('zombie', 42.1, 'low', { nearUsed: 0 }), 'lod2');
  assert.equal(selectEnemyLod('dragon', 35, 'high', { nearUsed: 5 }), 'full');
  assert.equal(selectEnemyLod('dragon', 35, 'high', { nearUsed: 6 }), 'lod1');
  assert.equal(selectEnemyLod('dragon', 101, 'high', { nearUsed: 0 }), 'lod2');
});

test('wave composition is capped by tier and seeded decisions are repeatable', () => {
  const input = {
    types: ['zombie', 'arquero', 'soldado', 'ufo'],
    wave: 6,
    tier: 'low',
    difficulty: 'dificil',
  };
  const first = capWaveQueue({ ...input, seed: 9182 });
  const repeated = capWaveQueue({ ...input, seed: 9182 });
  const otherSeed = capWaveQueue({ ...input, seed: 9183 });

  assert.equal(first.length, 12);
  assert.deepEqual(repeated, first);
  assert.notDeepEqual(otherSeed, first);
  assert.equal(first.every(type => input.types.includes(type)), true);
});

test('ranged engagement bands evade nearby targets and pursue distant targets', () => {
  const band = { min: 24, max: 80 };
  assert.equal(engagementState(12, band), 'evade');
  assert.equal(engagementState(24, band), 'attack');
  assert.equal(engagementState(55, band), 'attack');
  assert.equal(engagementState(80, band), 'attack');
  assert.equal(engagementState(81, band), 'pursue');
});

test('blocked ground routes choose a deterministic walkable alternate', () => {
  const result = steerGroundEnemy({
    position: { x: 0, z: 0 },
    target: { x: 10, z: 0 },
    speed: 2,
    dt: 0.5,
    seed: 7,
    isWalkable: (_x, z) => Math.abs(z) > 0.4,
    neighbors: [],
  });

  assert.equal(result.blocked, true);
  assert.equal(result.moved, true);
  assert.equal(result.usedAlternate, true);
  assert.ok(Math.abs(result.position.z) > 0.4);
  assert.ok(result.position.x > 0);
});

test('ground steering separates nearby allies while retaining target progress', () => {
  const result = steerGroundEnemy({
    position: { x: 0, z: 0 },
    target: { x: 10, z: 0 },
    speed: 2,
    dt: 0.5,
    seed: 12,
    isWalkable: () => true,
    separationRadius: 3,
    neighbors: [{ x: 0.6, z: 0.15 }],
  });

  assert.equal(result.moved, true);
  assert.ok(result.position.x > 0);
  assert.ok(result.position.z < 0);
});

test('predictive aim leads a moving target and compensates projectile drop', () => {
  const aim = predictiveAim({
    origin: { x: 0, y: 0, z: 0 },
    target: { x: 10, y: 0, z: 0 },
    targetVelocity: { x: 1, y: 0, z: 0 },
    projectileSpeed: 10,
    gravity: 9,
  });

  assert.ok(Math.abs(aim.time - (10 / 9)) < 1e-6);
  assert.ok(Math.abs(aim.point.x - (100 / 9)) < 1e-6);
  assert.ok(Math.abs(aim.point.y - (50 / 9)) < 1e-6);
  assert.equal(aim.point.z, 0);
  assert.ok(Math.abs(Math.hypot(aim.velocity.x, aim.velocity.y) - 10) < 1e-9);
});

test('enemy state transitions cover spawn, ranged combat, bounded air runs, recovery, and death', () => {
  assert.equal(nextEnemyState({ state: 'spawn', timeInState: 0.2 }), 'spawn');
  assert.equal(nextEnemyState({ state: 'spawn', timeInState: 0.5 }), 'pursue');
  assert.equal(nextEnemyState({
    state: 'pursue', ranged: true, distance: 50, band: { min: 24, max: 80 }, attackReady: false,
  }), 'strafe');
  assert.equal(nextEnemyState({
    state: 'strafe', ranged: true, distance: 50, band: { min: 24, max: 80 }, attackReady: true,
  }), 'attack');
  assert.equal(nextEnemyState({
    state: 'strafe', ranged: true, distance: 12, band: { min: 24, max: 80 }, attackReady: true,
  }), 'evade');
  assert.equal(nextEnemyState({ state: 'attack', timeInState: 0.4, windup: 0.35 }), 'recover');
  assert.equal(nextEnemyState({
    state: 'attack', air: true, timeInState: 1.5, maxAttackDuration: 1.2,
  }), 'evade');
  assert.equal(nextEnemyState({
    state: 'evade', air: true, distance: 120, disengageDistance: 110,
  }), 'recover');
  assert.equal(nextEnemyState({ state: 'recover', timeInState: 0.8, recoverDuration: 0.75 }), 'pursue');
  assert.equal(nextEnemyState({ state: 'attack', dead: true }), 'dead');
  assert.equal(nextEnemyState({ state: 'dead', dead: true }), 'dead');
});

test('burst schedules and projectile admission stay bounded', () => {
  assert.deepEqual(createBurstSchedule({
    requestedShots: 99,
    intervalMs: 120,
    maxShots: 4,
    maxDurationMs: 500,
  }), [0, 120, 240, 360]);
  assert.deepEqual(createBurstSchedule({
    requestedShots: 5,
    intervalMs: 250,
    maxShots: 5,
    maxDurationMs: 600,
  }), [0, 250, 500]);
});
