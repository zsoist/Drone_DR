const FALLBACK_RADIUS = 0.59;
const TARGET_SPAN = 0.85;
const MIN_RADIUS = 0.42;
const MAX_RADIUS = 0.70;
const MAX_ASPECT_RATIO = 50;

function fallback(reason) {
  return {
    radius: FALLBACK_RADIUS,
    scale: null,
    source: 'fallback',
    reason,
  };
}

export function deriveDroneEnvelope(bounds) {
  const min = bounds?.min;
  const max = bounds?.max;
  const values = [min?.x, min?.y, min?.z, max?.x, max?.y, max?.z];
  if (!values.every(Number.isFinite)) return fallback('non-finite-bounds');

  const size = {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z,
  };
  if (![size.x, size.y, size.z].every(value => value > 1e-6))
    return fallback('degenerate-bounds');

  const dimensions = [size.x, size.y, size.z];
  if (Math.max(...dimensions) / Math.min(...dimensions) > MAX_ASPECT_RATIO)
    return fallback('implausible-aspect-ratio');

  const horizontalSpan = Math.max(size.x, size.z);
  const scale = TARGET_SPAN / horizontalSpan;
  const radius = Math.hypot(size.x * scale, size.y * scale, size.z * scale) / 2 + 0.02;
  if (!Number.isFinite(scale) || !Number.isFinite(radius))
    return fallback('non-finite-envelope');
  if (radius < MIN_RADIUS || radius > MAX_RADIUS)
    return fallback('implausible-envelope');

  return { radius, scale, source: 'glb', reason: null };
}
