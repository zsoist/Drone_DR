const EPSILON = 1e-9;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function pointAt(start, delta, fraction) {
  return {
    x: start.x + delta.x * fraction,
    y: start.y + delta.y * fraction,
    z: start.z + delta.z * fraction,
  };
}

function normalized(vector, fallback = { x: 0, y: 1, z: 0 }) {
  const lengthSq = dot(vector, vector);
  if (lengthSq <= EPSILON) return { ...fallback };
  const inverseLength = 1 / Math.sqrt(lengthSq);
  return {
    x: vector.x * inverseLength,
    y: vector.y * inverseLength,
    z: vector.z * inverseLength,
  };
}

export function segmentSphereHit(start, end, center, radius) {
  if (!finitePositive(radius)) return null;

  const delta = subtract(end, start);
  const fromCenter = subtract(start, center);
  const radiusSq = radius * radius;
  const startDistanceSq = dot(fromCenter, fromCenter);
  const motionSq = dot(delta, delta);

  if (startDistanceSq <= radiusSq + EPSILON) {
    return {
      fraction: 0,
      point: { ...start },
      normal: normalized(fromCenter, normalized({
        x: -delta.x,
        y: -delta.y,
        z: -delta.z,
      })),
    };
  }
  if (motionSq <= EPSILON) return null;

  const projected = dot(fromCenter, delta);
  const discriminant = projected * projected
    - motionSq * (startDistanceSq - radiusSq);
  if (discriminant < -EPSILON) return null;

  const fraction = (-projected - Math.sqrt(Math.max(0, discriminant))) / motionSq;
  if (fraction < -EPSILON || fraction > 1 + EPSILON) return null;

  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const point = pointAt(start, delta, clampedFraction);
  return {
    fraction: clampedFraction,
    point,
    normal: normalized(subtract(point, center), normalized({
      x: -delta.x,
      y: -delta.y,
      z: -delta.z,
    })),
  };
}

export function segmentCircleBoundaryHit(start, end, radius) {
  if (!finitePositive(radius)) return null;

  const startRadiusSq = start.x * start.x + start.z * start.z;
  const endRadiusSq = end.x * end.x + end.z * end.z;
  const radiusSq = radius * radius;
  if (startRadiusSq > radiusSq + EPSILON || endRadiusSq <= radiusSq + EPSILON) {
    return null;
  }

  const delta = subtract(end, start);
  const planarMotionSq = delta.x * delta.x + delta.z * delta.z;
  if (planarMotionSq <= EPSILON) return null;

  const projected = start.x * delta.x + start.z * delta.z;
  const discriminant = projected * projected
    - planarMotionSq * (startRadiusSq - radiusSq);
  if (discriminant < -EPSILON) return null;

  const fraction = (-projected + Math.sqrt(Math.max(0, discriminant)))
    / planarMotionSq;
  if (fraction < -EPSILON || fraction > 1 + EPSILON) return null;

  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const point = pointAt(start, delta, clampedFraction);
  return {
    fraction: clampedFraction,
    point,
    normal: normalized({ x: -point.x, y: 0, z: -point.z }),
  };
}

export function segmentSquareBoundaryHit(start, end, halfExtent) {
  if (!finitePositive(halfExtent)) return null;

  const inside = (point) => Math.abs(point.x) <= halfExtent + EPSILON
    && Math.abs(point.z) <= halfExtent + EPSILON;
  if (!inside(start) || inside(end)) return null;

  const delta = subtract(end, start);
  const candidates = [];
  for (const axis of ['x', 'z']) {
    if (Math.abs(delta[axis]) <= EPSILON) continue;
    const face = delta[axis] > 0 ? halfExtent : -halfExtent;
    const fraction = (face - start[axis]) / delta[axis];
    if (fraction < -EPSILON || fraction > 1 + EPSILON) continue;
    const point = pointAt(start, delta, fraction);
    const otherAxis = axis === 'x' ? 'z' : 'x';
    if (Math.abs(point[otherAxis]) > halfExtent + EPSILON) continue;
    candidates.push({
      axis,
      fraction: Math.min(1, Math.max(0, fraction)),
      point,
      sign: Math.sign(face),
    });
  }
  if (candidates.length === 0) return null;

  const fraction = Math.min(...candidates.map((candidate) => candidate.fraction));
  const simultaneous = candidates.filter(
    (candidate) => Math.abs(candidate.fraction - fraction) <= EPSILON,
  );
  const normal = { x: 0, y: 0, z: 0 };
  for (const candidate of simultaneous) {
    normal[candidate.axis] -= candidate.sign;
  }

  return {
    fraction,
    point: pointAt(start, delta, fraction),
    normal: normalized(normal),
  };
}

export function earliestHit(hits) {
  let earliest = null;
  for (const hit of hits || []) {
    if (!hit || !Number.isFinite(hit.fraction)) continue;
    if (hit.fraction < 0 || hit.fraction > 1) continue;
    if (!earliest || hit.fraction < earliest.fraction) earliest = hit;
  }
  return earliest;
}

export function normalizeTargetRadius(target) {
  if (!target || typeof target !== 'object') return 0;
  if (finitePositive(target.radius)) return target.radius;
  if (finitePositive(target.radiusSq)) return Math.sqrt(target.radiusSq);
  if (finitePositive(target.r2)) {
    return target.enemy ? target.r2 : Math.sqrt(target.r2);
  }
  return 0;
}
