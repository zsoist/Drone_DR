// Pure aim/collision helpers. This module intentionally has no Three.js dependency so
// the reticle and projectile contracts can be tested with deterministic fixtures.

const EPSILON = 1e-8;
const disposedOwnedObjects = new WeakSet();

const finiteZero = value => Object.is(value, -0) ? 0 : value;
const copy = vector => ({ x: finiteZero(vector.x), y: finiteZero(vector.y), z: finiteZero(vector.z) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (vector, amount) => ({ x: vector.x * amount, y: vector.y * amount, z: vector.z * amount });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = vector => Math.sqrt(dot(vector, vector));

function normalize(vector, fallback = { x: 0, y: 0, z: -1 }) {
  const size = length(vector);
  return size > EPSILON ? copy(scale(vector, 1 / size)) : copy(fallback);
}

function pointOn(start, direction, distance) {
  return add(start, scale(direction, distance));
}

function cameraDirection(camera) {
  if (camera?.direction) return normalize(camera.direction);
  const q = camera?.quaternion;
  if (!q) return { x: 0, y: 0, z: -1 };
  // Rotate Three's local forward vector (0, 0, -1) by the camera quaternion.
  return normalize({
    x: -2 * (q.x * q.z + q.w * q.y),
    y: -2 * (q.y * q.z - q.w * q.x),
    z: -1 + 2 * (q.x * q.x + q.y * q.y),
  });
}

function targetRadius(target) {
  if (Number.isFinite(target?.radius) && target.radius > 0) return target.radius;
  if (Number.isFinite(target?.radiusSq) && target.radiusSq > 0) return Math.sqrt(target.radiusSq);
  if (Number.isFinite(target?.r2) && target.r2 > 0) return target.enemy ? target.r2 : Math.sqrt(target.r2);
  return 0;
}

function activeHittable(target) {
  if (!target?.center || targetRadius(target) <= 0) return false;
  if (target.enemy) return !target.g?.userData?.dead;
  return !target.node?.userData?.dead;
}

function sphereHit(start, end, target) {
  const radius = targetRadius(target);
  if (!activeHittable(target) || radius <= 0) return null;
  const segment = subtract(end, start);
  const toStart = subtract(start, target.center);
  const a = dot(segment, segment);
  if (a <= EPSILON) return null;
  const b = 2 * dot(toStart, segment);
  const c = dot(toStart, toStart) - radius * radius;
  let fraction = null;
  if (c <= 0) fraction = 0;
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (root < 0 || root > 1) return null;
    fraction = root;
  }
  const point = add(start, scale(segment, fraction));
  return {
    kind: 'target',
    target,
    fraction,
    point,
    normal: normalize(subtract(point, target.center), scale(normalize(segment), -1)),
  };
}

function circleBoundaryHit(start, end, radius) {
  if (!(radius > 0)) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const a = dx * dx + dz * dz;
  if (a <= EPSILON) return null;
  const b = 2 * (start.x * dx + start.z * dz);
  const c = start.x * start.x + start.z * start.z - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const roots = [
    (-b - Math.sqrt(discriminant)) / (2 * a),
    (-b + Math.sqrt(discriminant)) / (2 * a),
  ].filter(value => value >= 0 && value <= 1);
  const fraction = c >= 0 ? 0 : roots.at(-1);
  if (!Number.isFinite(fraction)) return null;
  const point = {
    x: start.x + dx * fraction,
    y: start.y + (end.y - start.y) * fraction,
    z: start.z + dz * fraction,
  };
  return {
    kind: 'boundary',
    fraction,
    point,
    normal: normalize({ x: -point.x, y: 0, z: -point.z }),
  };
}

function squareBoundaryHit(start, end, radius) {
  if (!(radius > 0)) return null;
  const segment = subtract(end, start);
  const candidates = [];
  for (const [axis, side] of [['x', -radius], ['x', radius], ['z', -radius], ['z', radius]]) {
    const delta = segment[axis];
    if (Math.abs(delta) <= EPSILON) continue;
    const fraction = (side - start[axis]) / delta;
    if (fraction < 0 || fraction > 1) continue;
    const point = add(start, scale(segment, fraction));
    const other = axis === 'x' ? point.z : point.x;
    if (Math.abs(other) > radius + EPSILON) continue;
    candidates.push({
      kind: 'boundary', fraction, point,
      normal: axis === 'x'
        ? { x: side < 0 ? 1 : -1, y: 0, z: 0 }
        : { x: 0, y: 0, z: side < 0 ? 1 : -1 },
    });
  }
  return candidates.sort((a, b) => a.fraction - b.fraction)[0] || null;
}

function boundaryHit(start, end, boundary) {
  if (!boundary) return null;
  if (typeof boundary.castSegment === 'function') return boundary.castSegment(start, end, 0);
  if (boundary.shape === 'square') return squareBoundaryHit(start, end, boundary.halfExtent ?? boundary.radius);
  return circleBoundaryHit(start, end, boundary.radius);
}

function nearestHit(candidates) {
  return candidates
    .filter(hit => hit && Number.isFinite(hit.fraction))
    .sort((a, b) => a.fraction - b.fraction)[0] || null;
}

/**
 * Resolve the camera-center ray against the authoritative collision world,
 * dynamic targets, and (when not already owned by the world) its boundary.
 */
export function resolveAimRay(camera, collisionWorld, hittables = [], boundary = null) {
  const origin = copy(camera?.position || camera?.origin || { x: 0, y: 0, z: 0 });
  const direction = cameraDirection(camera);
  const far = Math.max(1, Number(camera?.far) || 1200);
  const end = pointOn(origin, direction, far);
  const candidates = [collisionWorld?.castSegment?.(origin, end, 0) || null];
  for (const target of hittables) candidates.push(sphereHit(origin, end, target));
  candidates.push(boundaryHit(origin, end, boundary));
  const hit = nearestHit(candidates);
  if (hit) {
    return {
      ...hit,
      point: copy(hit.point),
      normal: normalize(hit.normal, scale(direction, -1)),
      distance: far * hit.fraction,
    };
  }
  return {
    kind: 'none', fraction: 1, point: end, normal: scale(direction, -1), distance: far,
  };
}

/** Return a normalized hardpoint-to-reticle direction without camera/gimbal coupling. */
export function projectileDirection(muzzle, aimPoint) {
  return normalize(subtract(aimPoint, muzzle));
}

/**
 * Evidence used to place decals/craters/structural effects at the exact hit
 * surface. CircleGeometry's local +Z is aligned to `axis` by the renderer.
 */
export function impactTransform(hit, offset = 0.012) {
  const normal = normalize(hit?.normal || { x: 0, y: 1, z: 0 });
  return {
    position: add(hit?.point || { x: 0, y: 0, z: 0 }, scale(normal, offset)),
    normal,
    axis: copy(normal),
  };
}

export function isContinuousWeapon(weapon) {
  return weapon === 'mg';
}

/**
 * Dispose a render object allocated by an effect without touching shared
 * textures. Callers opt out of geometry/material disposal for shared assets.
 */
export function disposeOwnedRenderObject(object, { geometry = true, material = true } = {}) {
  if (!object || typeof object !== 'object' || disposedOwnedObjects.has(object)) return false;
  disposedOwnedObjects.add(object);
  object.parent?.remove?.(object);
  if (geometry) object.geometry?.dispose?.();
  if (material) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) item?.dispose?.();
  }
  return true;
}

/** A small generic FIFO pool whose counters are safe to expose as telemetry. */
export class EffectPool {
  constructor(limit) {
    this.limit = Math.max(1, Math.floor(limit) || 1);
    this.entries = [];
    this.added = 0;
    this.evicted = 0;
  }

  add(entry) {
    if (this.entries.length >= this.limit) {
      const oldest = this.entries.shift();
      oldest.evicted = true;
      oldest.onEvict?.();
      this.evicted += 1;
    }
    this.entries.push(entry);
    this.added += 1;
    return entry;
  }

  release(entry) {
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  get counters() {
    return {
      limit: this.limit,
      active: this.entries.length,
      added: this.added,
      evicted: this.evicted,
    };
  }
}
