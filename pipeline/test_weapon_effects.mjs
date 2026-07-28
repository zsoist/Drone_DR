import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cappedShockwaveDiameter,
  createWeaponEffects,
  effectBudget,
  radialDamage,
} from '../web/flightverse/weapon-effects.js';

const heavyHit = () => ({
  profile: { effect: 'heavy', big: 2.8 },
  hit: {
    kind: 'terrain',
    point: { x: 1, y: 2, z: 3 },
    normal: { x: 0, y: 1, z: 0 },
  },
  inheritedVelocity: { x: 2, y: 0, z: -1 },
  scale: 2.8,
});

test('effect tiers expose exact active and heavy-emission budgets', () => {
  assert.deepEqual(effectBudget('phone'), { active: 520, heavy: 96 });
  assert.deepEqual(effectBudget('tablet'), { active: 850, heavy: 150 });
  assert.deepEqual(effectBudget('desktop'), { active: 1400, heavy: 240 });
});

test('heavy impact emits more particles without one scene object per particle', () => {
  const effects = createWeaponEffects(null, { tier: 'desktop' });
  assert.equal(effects.emitImpact(heavyHit()), 240);
  const snapshot = effects.snapshot();
  assert.equal(snapshot.lastEmission, 240);
  assert.equal(snapshot.emitted, 240);
  assert.ok(snapshot.drawBatches <= 6);
  assert.equal(snapshot.softAlpha, true);
  assert.deepEqual(snapshot.lastImpactNormal, { x: 0, y: 1, z: 0 });
  assert.equal(snapshot.lastImpactKind, 'terrain');
  effects.dispose();
});

test('fixed-capacity rings remain bounded after repeated heavy blowouts', () => {
  const effects = createWeaponEffects(null, { tier: 'phone' });
  for (let index = 0; index < 30; index += 1) effects.emitImpact(heavyHit());
  const snapshot = effects.snapshot();
  assert.equal(snapshot.emitted, 30 * 96);
  assert.ok(snapshot.active <= 520);
  assert.ok(snapshot.peak <= 520);
  effects.dispose();
});

test('blast falloff reaches visible targets and rejects occluded targets', () => {
  const targets = {
    visible: { center: { x: 3, y: 0, z: 0 }, node: { id: 'visible' } },
    occluded: { center: { x: 5, y: 0, z: 0 }, node: { id: 'occluded' } },
    outside: { center: { x: 30, y: 0, z: 0 }, node: { id: 'outside' } },
  };
  const result = radialDamage({
    origin: { x: 0, y: 0, z: 0 },
    radius: 10,
    maxDamage: 100,
    targets,
    castSegment: (_origin, target) => (
      target.x === 5
        ? { fraction: 0.4, node: { id: 'wall' } }
        : null
    ),
  });
  assert.ok(result.visible.damage > 0 && result.visible.damage < 100);
  assert.equal(result.occluded.damage, 0);
  assert.equal(result.occluded.occluded, true);
  assert.equal(result.outside.damage, 0);
});

test('shockwave is capped below 35 percent viewport diameter', () => {
  assert.equal(cappedShockwaveDiameter(900, 1000), 350);
  assert.equal(cappedShockwaveDiameter(200, 1000), 200);
  assert.equal(cappedShockwaveDiameter(100, 0), 0);
});

test('dispose releases batch resources exactly once', () => {
  const disposed = { geometry: 0, material: 0, texture: 0 };
  const sharedTexture = { dispose: () => { disposed.texture += 1; } };
  const scene = {
    children: [],
    add(node) { this.children.push(node); },
    remove(node) { this.children = this.children.filter(item => item !== node); },
  };
  const effects = createWeaponEffects(scene, {
    tier: 'phone',
    ownsTextures: true,
    batchFactory: kind => ({
      node: { name: `batch-${kind}` },
      geometry: { dispose: () => { disposed.geometry += 1; } },
      material: { dispose: () => { disposed.material += 1; } },
      textures: [sharedTexture],
    }),
  });
  assert.equal(scene.children.length, 5);
  effects.dispose();
  effects.dispose();
  assert.equal(scene.children.length, 0);
  assert.deepEqual(disposed, { geometry: 5, material: 5, texture: 1 });
  assert.equal(effects.snapshot().disposeCalls, 1);
});
