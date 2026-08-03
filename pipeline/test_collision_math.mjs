import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../web/flightverse/collision-math.js', import.meta.url);

async function loadCollisionMath() {
  const source = await readFile(sourceUrl, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const assertVec = (actual, expected, epsilon = 1e-9) => {
  approx(actual.x, expected.x, epsilon);
  approx(actual.y, expected.y, epsilon);
  approx(actual.z, expected.z, epsilon);
};

test('segmentSphereHit catches a thin target between endpoints', async () => {
  const { segmentSphereHit } = await loadCollisionMath();
  const hit = segmentSphereHit(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 },
    1,
  );

  approx(hit.fraction, 0.4);
  assertVec(hit.point, { x: 4, y: 0, z: 0 });
  assertVec(hit.normal, { x: -1, y: 0, z: 0 });
});

test('segmentSphereHit preserves an exact tangent contact', async () => {
  const { segmentSphereHit } = await loadCollisionMath();
  const hit = segmentSphereHit(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 5, y: 1, z: 0 },
    1,
  );

  approx(hit.fraction, 0.5);
  assertVec(hit.point, { x: 5, y: 0, z: 0 });
  assertVec(hit.normal, { x: 0, y: -1, z: 0 });
});

test('segmentSphereHit returns null when the swept segment misses', async () => {
  const { segmentSphereHit } = await loadCollisionMath();
  assert.equal(segmentSphereHit(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 5, y: 2, z: 0 },
    1,
  ), null);
});

test('segmentSphereHit reports immediate contact when starting inside', async () => {
  const { segmentSphereHit } = await loadCollisionMath();
  const hit = segmentSphereHit(
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    2,
  );

  assert.equal(hit.fraction, 0);
  assertVec(hit.point, { x: 0, y: 0, z: 0 });
  assertVec(hit.normal, { x: -1, y: 0, z: 0 });
});

test('earliestHit chooses the first finite collision and ignores nulls', async () => {
  const { earliestHit } = await loadCollisionMath();
  const near = { fraction: 0.2, kind: 'target' };
  const far = { fraction: 0.8, kind: 'structure' };

  assert.equal(earliestHit([null, far, near]), near);
  assert.equal(earliestHit([null, undefined]), null);
});

test('segmentCircleBoundaryHit stops at the native circular edge', async () => {
  const { segmentCircleBoundaryHit } = await loadCollisionMath();
  const hit = segmentCircleBoundaryHit(
    { x: 0, y: 7, z: 0 },
    { x: 10, y: 7, z: 0 },
    5,
  );

  approx(hit.fraction, 0.5);
  assertVec(hit.point, { x: 5, y: 7, z: 0 });
  assertVec(hit.normal, { x: -1, y: 0, z: 0 });
});

test('segmentCircleBoundaryHit ignores motion that remains inside', async () => {
  const { segmentCircleBoundaryHit } = await loadCollisionMath();
  assert.equal(segmentCircleBoundaryHit(
    { x: 0, y: 0, z: 0 },
    { x: 4.9, y: 0, z: 0 },
    5,
  ), null);
});

test('segmentSquareBoundaryHit returns the first crossed face', async () => {
  const { segmentSquareBoundaryHit } = await loadCollisionMath();
  const hit = segmentSquareBoundaryHit(
    { x: 0, y: 3, z: 0 },
    { x: 10, y: 3, z: 2 },
    5,
  );

  approx(hit.fraction, 0.5);
  assertVec(hit.point, { x: 5, y: 3, z: 1 });
  assertVec(hit.normal, { x: -1, y: 0, z: 0 });
});

test('segmentSquareBoundaryHit resolves a corner with a normalized inward normal', async () => {
  const { segmentSquareBoundaryHit } = await loadCollisionMath();
  const hit = segmentSquareBoundaryHit(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 10 },
    5,
  );

  approx(hit.fraction, 0.5);
  assertVec(hit.point, { x: 5, y: 0, z: 5 });
  const invSqrt2 = 1 / Math.sqrt(2);
  assertVec(hit.normal, { x: -invSqrt2, y: 0, z: -invSqrt2 });
});

test('normalizeTargetRadius never squares an already squared enemy radius again', async () => {
  const { normalizeTargetRadius } = await loadCollisionMath();

  assert.equal(normalizeTargetRadius({ radius: 6, radiusSq: 36, r2: 1296 }), 6);
  assert.equal(normalizeTargetRadius({ radiusSq: 20.25 }), 4.5);
  assert.equal(normalizeTargetRadius({ enemy: true, r2: 1.7 }), 1.7);
});

test('collision math rejects invalid radii instead of inventing hits', async () => {
  const { normalizeTargetRadius, segmentSphereHit } = await loadCollisionMath();

  assert.equal(normalizeTargetRadius({ radius: -1 }), 0);
  assert.equal(normalizeTargetRadius({ radiusSq: Number.NaN }), 0);
  assert.equal(segmentSphereHit(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
    -1,
  ), null);
});
