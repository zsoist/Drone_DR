import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../web/flightverse/aiming.js', import.meta.url);

async function loadAiming() {
  const source = await readFile(sourceUrl, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

test('resolveAimRay puts the reticle on the nearest enemy before a farther structure', async () => {
  const { resolveAimRay } = await loadAiming();
  const hit = resolveAimRay(
    { position: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 }, far: 100 },
    { castSegment: () => ({ kind: 'structure', fraction: 0.12, point: { x: 12, y: 2, z: 0 }, normal: { x: -1, y: 0, z: 0 } }) },
    [{ enemy: true, center: { x: 6, y: 2, z: 0 }, radius: 1 }],
  );

  assert.equal(hit.kind, 'target');
  approx(hit.point.x, 5);
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
});

test('resolveAimRay preserves the authoritative collision-world hit when it is nearest', async () => {
  const { resolveAimRay } = await loadAiming();
  const hit = resolveAimRay(
    { position: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 }, far: 100 },
    { castSegment: () => ({ kind: 'structure', fraction: 0.04, point: { x: 4, y: 2, z: 0 }, normal: { x: -1, y: 0, z: 0 } }) },
    [{ enemy: true, center: { x: 6, y: 2, z: 0 }, radius: 1 }],
  );

  assert.equal(hit.kind, 'structure');
  approx(hit.point.x, 4);
});

test('resolveAimRay ignores a destroyed enemy instead of putting the reticle on it', async () => {
  const { resolveAimRay } = await loadAiming();
  const hit = resolveAimRay(
    { position: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 }, far: 100 },
    { castSegment: () => ({ kind: 'structure', fraction: 0.04, point: { x: 4, y: 2, z: 0 }, normal: { x: -1, y: 0, z: 0 } }) },
    [{ enemy: true, center: { x: 2, y: 2, z: 0 }, radius: 1, g: { userData: { dead: true } } }],
  );

  assert.equal(hit.kind, 'structure');
  approx(hit.point.x, 4);
});

test('resolveAimRay falls back to the playable boundary when no scene object is hit', async () => {
  const { resolveAimRay } = await loadAiming();
  const hit = resolveAimRay(
    { position: { x: 0, y: 3, z: 0 }, direction: { x: 1, y: 0, z: 0 }, far: 100 },
    { castSegment: () => null },
    [],
    { shape: 'circle', radius: 10 },
  );

  assert.equal(hit.kind, 'boundary');
  approx(hit.point.x, 10);
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
});

test('resolveAimRay honors the Flightverse square boundary halfExtent', async () => {
  const { resolveAimRay } = await loadAiming();
  const hit = resolveAimRay(
    { position: { x: 0, y: 3, z: 0 }, direction: { x: 1, y: 0, z: 0 }, far: 100 },
    { castSegment: () => null },
    [],
    { shape: 'square', halfExtent: 10 },
  );

  assert.equal(hit.kind, 'boundary');
  approx(hit.point.x, 10);
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
});

test('projectileDirection converges from the hardpoint to the reticle hit point', async () => {
  const { projectileDirection } = await loadAiming();
  const direction = projectileDirection(
    { x: 1, y: 2, z: 3 },
    { x: 7, y: 4, z: 3 },
  );

  approx(direction.x, 3 / Math.sqrt(10));
  approx(direction.y, 1 / Math.sqrt(10));
  approx(direction.z, 0);
});

test('impactTransform offsets a decal along the exact collision normal instead of terrain-up', async () => {
  const { impactTransform } = await loadAiming();
  const impact = impactTransform({
    point: { x: 8, y: 4, z: -3 },
    normal: { x: 0, y: 0, z: -1 },
  }, 0.02);

  assert.deepEqual(impact.normal, { x: 0, y: 0, z: -1 });
  assert.deepEqual(impact.position, { x: 8, y: 4, z: -3.02 });
  assert.deepEqual(impact.axis, { x: 0, y: 0, z: -1 });
});

test('fire policy permits continuous firing only for MG', async () => {
  const { isContinuousWeapon } = await loadAiming();
  assert.equal(isContinuousWeapon('mg'), true);
  assert.equal(isContinuousWeapon('s'), false);
  assert.equal(isContinuousWeapon('m'), false);
  assert.equal(isContinuousWeapon('l'), false);
});

test('EffectPool evicts the oldest active effect and exposes bounded counters', async () => {
  const { EffectPool } = await loadAiming();
  const pool = new EffectPool(2);
  let cleanups = 0;
  const first = { id: 'first', onEvict: () => { cleanups += 1; } };
  pool.add(first);
  pool.add({ id: 'second' });
  pool.add({ id: 'third' });

  assert.equal(first.evicted, true);
  assert.equal(cleanups, 1, 'eviction invokes its owned cleanup exactly once');
  assert.deepEqual(pool.entries.map(entry => entry.id), ['second', 'third']);
  assert.deepEqual(pool.counters, { limit: 2, active: 2, added: 3, evicted: 1 });
});

test('disposeOwnedRenderObject frees only owned geometry and materials', async () => {
  const { disposeOwnedRenderObject } = await loadAiming();
  const calls = { removed: 0, geometry: 0, firstMaterial: 0, secondMaterial: 0, texture: 0 };
  const object = {
    parent: { remove: () => { calls.removed += 1; } },
    geometry: { dispose: () => { calls.geometry += 1; } },
    material: [
      { dispose: () => { calls.firstMaterial += 1; }, map: { dispose: () => { calls.texture += 1; } } },
      { dispose: () => { calls.secondMaterial += 1; } },
    ],
  };

  assert.equal(disposeOwnedRenderObject(object), true);
  assert.deepEqual(calls, { removed: 1, geometry: 1, firstMaterial: 1, secondMaterial: 1, texture: 0 });
  assert.equal(disposeOwnedRenderObject(object), false, 'cleanup is idempotent');
  assert.deepEqual(calls, { removed: 1, geometry: 1, firstMaterial: 1, secondMaterial: 1, texture: 0 });
});
