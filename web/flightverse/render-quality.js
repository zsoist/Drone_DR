const BASE_TIERS = [1, 1.25, 1.5, 1.75, 2];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

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
      const slow = measured.avgMs > 18.5 || measured.p95Ms > 20.5;
      const recovered = measured.avgMs < 17.3 && measured.p95Ms < 18;
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
