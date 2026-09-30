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

// --- display-interval aware thresholds (30/50/60/120/144 Hz panels) -------------------------------------------
import { estimateDisplayInterval } from '../web/flightverse/render-quality.js';

function trace(intervalMs, n, jitter = 0.04) {
  // deterministic pseudo-jitter around the display interval (frames are vsync-quantised, never faster)
  return Array.from({ length: n }, (_, i) => intervalMs + Math.abs(Math.sin(i * 12.9898)) * jitter);
}

for (const [hz, ms] of [[30, 33.3], [50, 20], [60, 16.7], [120, 8.3], [144, 6.94]]) {
  test(`${hz} Hz display: a healthy trace never downgrades and estimates the interval`, () => {
    const g = createRenderQualityGovernor({ deviceDpr: 2, initialDpr: 2, windowSize: 30, cooldownMs: 0 });
    const r = feed(g, trace(ms, 300), 0, ms);
    assert.equal(r.dpr, 2);
    assert.equal(r.changes, 0);
    assert.ok(Math.abs(r.intervalMs - Math.max(8.3, ms)) < 0.6, `interval ${r.intervalMs}`);
  });

  test(`${hz} Hz display: recovers a tier after a load burst (does not stay stuck low)`, () => {
    const g = createRenderQualityGovernor({ deviceDpr: 2, initialDpr: 1.5, windowSize: 30, cooldownMs: 0 });
    const r = feed(g, trace(ms, 30 * 4), 0, ms);
    assert.equal(r.reason, 'stable-recovery');
    assert.ok(r.dpr > 1.5);
  });
}

// overload factors chosen so the late frame does not land on another known display interval (a 60 Hz panel
// delivering a steady 33 ms IS indistinguishable from a 30 Hz panel: that ambiguity is inherent, not a bug)
for (const [hz, ms, k] of [[30, 33.3, 2], [50, 20, 2], [60, 16.7, 1.5], [120, 8.3, 1.7]]) {
  test(`${hz} Hz display: sustained overload downgrades`, () => {
    const g = createRenderQualityGovernor({ deviceDpr: 2, initialDpr: 2, windowSize: 30, cooldownMs: 0 });
    const late = trace(ms * k, 30 * 3);
    const r = feed(g, late, 0, ms);
    assert.ok(r.dpr < 2, `${hz} Hz stayed at ${r.dpr} (interval ${r.intervalMs})`);
  });
}

test('estimateDisplayInterval snaps the low quartile and floors between intervals', () => {
  assert.equal(estimateDisplayInterval(trace(16.7, 40)), 16.7);
  assert.equal(estimateDisplayInterval(trace(20, 40)), 20);
  assert.equal(estimateDisplayInterval(trace(33.3, 40)), 33.3);
  assert.equal(estimateDisplayInterval(trace(24, 40)), 20);       // between 50 and 30 Hz -> conservative
  assert.equal(estimateDisplayInterval(trace(6.94, 40)), 8.3);    // 144 Hz clamps to the fastest known
  assert.equal(estimateDisplayInterval([]), 16.7);
});
