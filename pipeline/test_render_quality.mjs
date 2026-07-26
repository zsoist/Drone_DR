import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderQualityGovernor } from '../web/flightverse/render-quality.js';

function feed(governor, values, start = 0, step = 16.7) {
  let result;
  values.forEach((frameMs, index) => {
    result = governor.sample(frameMs, start + index * step);
  });
  return result;
}

test('holds quality through stable frames and isolated spikes', () => {
  const governor = createRenderQualityGovernor({
    deviceDpr: 2,
    initialDpr: 2,
    windowSize: 30,
    cooldownMs: 1000,
  });
  const frames = Array(60).fill(16.7);
  frames[14] = 45;
  frames[44] = 38;
  feed(governor, frames);
  const state = governor.snapshot();
  assert.equal(state.dpr, 2);
  assert.equal(state.changes, 0);
  assert.equal(state.samples, 30);
});

test('downgrades one tier only after two sustained slow windows', () => {
  const governor = createRenderQualityGovernor({
    deviceDpr: 2,
    initialDpr: 2,
    windowSize: 10,
    cooldownMs: 1000,
  });
  feed(governor, Array(10).fill(24), 0);
  assert.equal(governor.snapshot().dpr, 2);
  const result = feed(governor, Array(10).fill(24), 200);
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'sustained-load');
  assert.equal(result.dpr, 1.75);
});

test('cooldown blocks a second immediate downgrade', () => {
  const governor = createRenderQualityGovernor({
    deviceDpr: 2,
    initialDpr: 2,
    windowSize: 5,
    cooldownMs: 5000,
  });
  feed(governor, Array(10).fill(28), 0, 20);
  assert.equal(governor.snapshot().dpr, 1.75);
  feed(governor, Array(30).fill(28), 300, 20);
  assert.equal(governor.snapshot().dpr, 1.75);
});

test('recovers one tier after three stable windows beyond cooldown', () => {
  const governor = createRenderQualityGovernor({
    deviceDpr: 2,
    initialDpr: 1.5,
    windowSize: 10,
    cooldownMs: 1000,
  });
  feed(governor, Array(20).fill(15), 2000);
  assert.equal(governor.snapshot().dpr, 1.5);
  const result = feed(governor, Array(10).fill(15), 2400);
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'stable-recovery');
  assert.equal(result.dpr, 1.75);
});

test('caps tiers to the device and reset clears evidence without changing dpr', () => {
  const governor = createRenderQualityGovernor({
    deviceDpr: 1.4,
    initialDpr: 2,
    windowSize: 5,
  });
  assert.equal(governor.snapshot().dpr, 1.4);
  feed(governor, [16, 17, 18], 0);
  governor.reset(500);
  const state = governor.snapshot();
  assert.equal(state.dpr, 1.4);
  assert.equal(state.samples, 0);
  assert.equal(state.avgMs, 0);
  assert.equal(state.p95Ms, 0);
  assert.equal(state.reason, 'resume-reset');
});

test('ignores invalid and background-sized frame samples', () => {
  const governor = createRenderQualityGovernor({ deviceDpr: 2, initialDpr: 2 });
  for (const value of [NaN, Infinity, 0, -3, 300]) governor.sample(value, 10);
  assert.equal(governor.snapshot().samples, 0);
  assert.equal(governor.snapshot().changes, 0);
});
