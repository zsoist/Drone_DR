import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveDroneEnvelope } from '../web/flightverse/drone-envelope.js';

test('derives the shipped 0.85m drone envelope from finite GLB bounds', () => {
  const envelope = deriveDroneEnvelope({
    min: { x: -0.425, y: -0.14222, z: -0.35 },
    max: { x: 0.425, y: 0.14222, z: 0.35 },
  });

  assert.equal(envelope.source, 'glb');
  assert.equal(envelope.reason, null);
  assert.equal(envelope.scale, 1);
  assert.ok(Math.abs(envelope.radius - 0.589) < 0.001);
});

for (const [name, bounds] of [
  ['missing', null],
  ['non-finite', {
    min: { x: 0, y: 0, z: 0 },
    max: { x: Number.POSITIVE_INFINITY, y: 1, z: 1 },
  }],
  ['degenerate', {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  }],
  ['implausible', {
    min: { x: -100, y: -100, z: -0.001 },
    max: { x: 100, y: 100, z: 0.001 },
  }],
]) {
  test(`${name} GLB bounds retain the explicit fallback envelope`, () => {
    const envelope = deriveDroneEnvelope(bounds);

    assert.equal(envelope.source, 'fallback');
    assert.equal(envelope.radius, 0.59);
    assert.equal(envelope.scale, null);
    assert.ok(envelope.reason);
  });
}
