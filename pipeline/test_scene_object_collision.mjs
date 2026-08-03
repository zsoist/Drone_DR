import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeCollisionWorld,
  createMutableCollisionWorld,
  createSceneObjectCollision,
} from '../web/flightverse/scene-object-collision.js';

const v = (x, y, z) => ({ x, y, z });
const boxItem = (
  min,
  max,
  node = { userData: {} },
  materialClass = 'concrete',
) => ({
  node,
  bounds: { min: v(...min), max: v(...max) },
  broadSphere: {
    center: v(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ),
    radius: Math.hypot(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    ) / 2,
  },
  materialClass,
});

test('sphere sweep hits the expanded item AABB before visual penetration', () => {
  const items = createSceneObjectCollision([
    boxItem([-1, 0, -1], [1, 2, 1]),
  ]);
  const hit = items.sweepSphere(v(4, 1, 0), v(-4, 1, 0), 0.5);

  assert.equal(hit.fraction, 0.3125);
  assert.deepEqual(hit.normal, v(1, 0, 0));
  assert.deepEqual(hit.point, v(1.5, 1, 0));
  assert.equal(hit.source, 'item');
  assert.equal(hit.materialClass, 'concrete');
});

test('segment cast returns exact item surface and broad phase rejects distant boxes', () => {
  const near = boxItem([-1, 0, -1], [1, 2, 1]);
  const far = boxItem([100, 100, 100], [102, 102, 102]);
  const items = createSceneObjectCollision([near, far]);
  const hit = items.castSegment(v(4, 1, 0), v(-4, 1, 0));

  assert.equal(hit.fraction, 0.375);
  assert.deepEqual(hit.point, v(1, 1, 0));
  assert.equal(hit.node, near.node);
  assert.equal(items.qa.narrowTests, 1);
  assert.equal(items.qa.broadRejects, 1);
});

test('start-inside contact and recovery choose the nearest finite outward face', () => {
  const items = createSceneObjectCollision([
    boxItem([-2, 0, -2], [2, 4, 2]),
  ]);
  const hit = items.sweepSphere(v(1.8, 2, 0), v(1.8, 2, 0), 0.5);
  const recovery = items.recoverSphere(v(1.8, 2, 0), 0.5);

  assert.equal(hit.fraction, 0);
  assert.deepEqual(hit.normal, v(1, 0, 0));
  assert.deepEqual(recovery.translation, v(0.7, 0, 0));
  assert.deepEqual(recovery.point, v(2.5, 2, 0));
});

test('composite returns the earliest world or item contact with source metadata', () => {
  const world = {
    castSegment: () => ({
      kind: 'structure',
      fraction: 0.8,
      point: v(8, 0, 0),
      normal: v(-1, 0, 0),
    }),
    sweepSphere: () => null,
    qa: { ready: true },
  };
  const items = createSceneObjectCollision([
    boxItem([2.5, -1, -1], [3.5, 1, 1]),
  ]);
  const composite = composeCollisionWorld(world, items);
  const hit = composite.castSegment(v(0, 0, 0), v(10, 0, 0));

  assert.equal(hit.source, 'item');
  assert.equal(hit.fraction, 0.25);
  assert.equal(composite.qa.itemHits, 1);
  assert.equal(composite.qa.worldHits, 0);
});

test('dead item removal makes the former path clear in the same fixed step', () => {
  const node = { userData: {} };
  const items = createSceneObjectCollision([
    boxItem([-1, 0, -1], [1, 2, 1], node),
  ]);

  assert.ok(items.castSegment(v(4, 1, 0), v(-4, 1, 0)));
  items.remove(node);
  assert.equal(items.castSegment(v(4, 1, 0), v(-4, 1, 0)), null);

  const replacement = boxItem([5, 0, -1], [7, 2, 1]);
  items.setItems([replacement]);
  assert.equal(items.castSegment(v(4, 1, 0), v(-4, 1, 0)), null);
  assert.ok(items.castSegment(v(8, 1, 0), v(4, 1, 0)));
});

test('mutable composite swaps item colliders without changing the static world', () => {
  const world = {
    castSegment: () => null,
    sweepSphere: () => null,
    closest: () => null,
    groundHeight: () => 12,
    qa: { ready: true },
  };
  const mutable = createMutableCollisionWorld(world);
  const node = { userData: {} };
  mutable.setItems(createSceneObjectCollision([
    boxItem([-1, 0, -1], [1, 2, 1], node),
  ]));

  assert.equal(mutable.groundHeight(3, 4), 12);
  assert.equal(mutable.castSegment(v(4, 1, 0), v(-4, 1, 0)).node, node);
  mutable.setItems(null);
  assert.equal(mutable.castSegment(v(4, 1, 0), v(-4, 1, 0)), null);
  assert.equal(world.qa.ready, true);
});
