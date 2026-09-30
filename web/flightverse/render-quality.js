const BASE_TIERS = [1, 1.25, 1.5, 1.75, 2];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Display refresh intervals the governor understands (144/120, 90, 60, 50, 30 Hz). The interval is estimated from
// the LOW QUARTILE of the frame times (the frames the GPU was not late for) and snapped to the nearest one within
// 12 %; a value between two intervals is floored to the faster display (conservative: a GPU-bound 24 ms frame on a
// 60 Hz panel is slow, not "a 50 Hz display"). All thresholds are relative to it, so 30 and 50 Hz panels recover.
export const DISPLAY_INTERVALS_MS = Object.freeze([8.3, 11.1, 16.7, 20, 33.3]);
const SNAP_TOLERANCE = 0.12;
const SLOW_AVG = 1.11;      // avg > 1.11 x interval
const SLOW_P95 = 1.23;      // or p95 > 1.23 x interval
const OK_AVG = 1.04;        // recovered: avg < 1.04 x interval
const OK_P95 = 1.08;        //            and p95 < 1.08 x interval

export function estimateDisplayInterval(values) {
  if (!values.length) return 16.7;
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.25))];
  let best = DISPLAY_INTERVALS_MS[0];
  for (const candidate of DISPLAY_INTERVALS_MS) {
    if (Math.abs(low - candidate) <= candidate * SNAP_TOLERANCE) return candidate;
    if (candidate <= low) best = candidate;
  }
  return best;
}

function percentile95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

export function createRenderQualityGovernor(options = {}) {
  const maxDpr = clamp(Number(options.deviceDpr) || 1, 1, 2);
  const tiers = [...new Set([...BASE_TIERS.filter(value => value < maxDpr), maxDpr])]
    .sort((a, b) => a - b);
  const windowSize = Math.max(5, Math.round(options.windowSize || 30));
  const cooldownMs = Math.max(0, Number(options.cooldownMs ?? 3000));
  let dpr = clamp(Number(options.initialDpr) || maxDpr, 1, maxDpr);
  let samples = [];
  let windowSamples = 0;
  let slowWindows = 0;
  let recoveryWindows = 0;
  let lastChangeAt = -Infinity;
  let changes = 0;
  let reason = 'initial';

  const stats = () => {
    const total = samples.reduce((sum, value) => sum + value, 0);
    return {
      avgMs: samples.length ? total / samples.length : 0,
      p95Ms: percentile95(samples),
      intervalMs: estimateDisplayInterval(samples),
      samples: samples.length,
    };
  };

  const adjacentTier = direction => {
    if (direction < 0) {
      const candidates = tiers.filter(value => value < dpr - 0.001);
      return candidates.length ? candidates.at(-1) : dpr;
    }
    return tiers.find(value => value > dpr + 0.001) ?? dpr;
  };

  const snapshot = () => {
    const measured = stats();
    return {
      dpr,
      tier: tiers.indexOf(dpr),
      changes,
      reason,
      avgMs: measured.avgMs,
      p95Ms: measured.p95Ms,
      intervalMs: measured.intervalMs,
      samples: measured.samples,
    };
  };

  const sample = (frameMs, timestamp = 0) => {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs >= 250) {
      return { changed: false, ...snapshot() };
    }
    samples.push(frameMs);
    if (samples.length > windowSize) samples.shift();
    windowSamples += 1;
    let changed = false;

    if (windowSamples >= windowSize && samples.length === windowSize) {
      windowSamples = 0;
      const measured = stats();
      const interval = measured.intervalMs;
      const slow = measured.avgMs > interval * SLOW_AVG || measured.p95Ms > interval * SLOW_P95;
      const recovered = measured.avgMs < interval * OK_AVG && measured.p95Ms < interval * OK_P95;
      slowWindows = slow ? slowWindows + 1 : 0;
      recoveryWindows = recovered ? recoveryWindows + 1 : 0;

      if (timestamp - lastChangeAt >= cooldownMs && slowWindows >= 2) {
        const next = adjacentTier(-1);
        if (next !== dpr) {
          dpr = next;
          changes += 1;
          changed = true;
          reason = 'sustained-load';
          lastChangeAt = timestamp;
        }
        slowWindows = 0;
        recoveryWindows = 0;
      } else if (timestamp - lastChangeAt >= cooldownMs && recoveryWindows >= 3) {
        const next = adjacentTier(1);
        if (next !== dpr) {
          dpr = next;
          changes += 1;
          changed = true;
          reason = 'stable-recovery';
          lastChangeAt = timestamp;
        }
        slowWindows = 0;
        recoveryWindows = 0;
      }
    }

    return { changed, ...snapshot() };
  };

  const reset = () => {
    samples = [];
    windowSamples = 0;
    slowWindows = 0;
    recoveryWindows = 0;
    reason = 'resume-reset';
  };

  return { sample, reset, snapshot };
}
