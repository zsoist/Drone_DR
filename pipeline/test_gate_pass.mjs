// Regression: Gate Rush counted any drone within 1.05-1.25x ring radius of the centre, so skimming past
// the OUTSIDE of a ring (or flying along its plane) scored the gate. Passing must cross the ring disc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentPassesGate } from '../web/flightverse/collision-math.js';

const c = { x: 10, y: 20, z: -5 };
const n = { x: 0, y: 0, z: 1 };
const R = 6.5 * 1.12;
const p = (x, y, z) => ({ x, y, z });

test('flying through the ring counts, both directions', () => {
  assert.equal(segmentPassesGate(p(10, 20, -5.2), p(10, 20, -4.8), c, n, R), true);
  assert.equal(segmentPassesGate(p(10, 20, -4.8), p(10, 20, -5.2), c, n, R), true);
  assert.equal(segmentPassesGate(p(14, 22, -5.1), p(14, 22, -4.9), c, n, R), true);
});

test('skimming beside the ring does not count (old sphere test did)', () => {
  // 7.0 m from centre: inside the old 7.28 m sphere, outside the 6.5 m ring plane crossing radius test? still < R, so
  // use a pass that clearly misses the disc:
  assert.equal(segmentPassesGate(p(19, 20, -5.2), p(19, 20, -4.8), c, n, R), false);
  // flying along the ring plane never crosses it
  assert.equal(segmentPassesGate(p(3, 20, -5), p(17, 20, -5), c, n, R), false);
  // approaching but stopping before the plane
  assert.equal(segmentPassesGate(p(10, 20, -9), p(10, 20, -5.5), c, n, R), false);
});

test('a fast step (tunnelling-prone) that crosses the plane inside the disc counts once', () => {
  assert.equal(segmentPassesGate(p(10, 20, -30), p(10, 20, 20), c, n, R), true);
  assert.equal(segmentPassesGate(p(30, 20, -30), p(30, 20, 20), c, n, R), false);
});

test('teleport onto the centre (autotest) counts; bad numbers never do', () => {
  assert.equal(segmentPassesGate(p(50, 50, 50), c, c, n, R), true);
  assert.equal(segmentPassesGate(p(NaN, 0, 0), c, c, n, R), false);
  assert.equal(segmentPassesGate(p(0, 0, 0), p(1, 1, 1), c, n, 0), false);
});
