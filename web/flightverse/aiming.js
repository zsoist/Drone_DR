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

// ─────────────────────────────────────────────────────────────────────────────
// ?fv=2 ballistics, lead, lock — pure (no Three). The HUD (ui/*) reads the
// results through ctx.fx.aimData; nothing here draws.
// ─────────────────────────────────────────────────────────────────────────────

/** Vertical drop (m) of a ballistic round after flying `range` m at `speed` m/s. */
export function bulletDrop(speed, gravity, range) {
  if (!(speed > 0) || !(range > 0)) return 0;
  const t = range / speed;
  return 0.5 * Math.max(0, gravity) * t * t;
}

/**
 * Exact (analytic) step for a ballistic round: x += v·dt + ½·a·dt², v += a·dt.
 * The fv2 simulation and solveLead share this, so the pipper and the tracer agree.
 */
export function ballisticStep(pos, vel, gravity, dt) {
  pos.x += vel.x * dt;
  pos.y += vel.y * dt - 0.5 * gravity * dt * dt;
  pos.z += vel.z * dt;
  vel.y -= gravity * dt;
}

/**
 * Lead + drop solution for a constant-velocity target.
 * Returns the world point the AIM RAY must pass through so a round with muzzle
 * speed `speed` and gravity `gravity` fired from `muzzle` hits the target:
 *   aim = target + targetVel·t + (0, ½·g·t², 0)       (the pipper)
 *   intercept = target + targetVel·t                     (where the round arrives)
 */
export function solveLead({ muzzle, target, targetVel = { x: 0, y: 0, z: 0 }, speed, gravity = 0, iterations = 5 }) {
  const m = copy(muzzle);
  const p = copy(target);
  const v = copy(targetVel);
  let t = Math.max(1e-4, length(subtract(p, m)) / Math.max(1, speed));
  let aim = p;
  let intercept = p;
  for (let i = 0; i < iterations; i += 1) {
    intercept = add(p, scale(v, t));
    aim = { x: intercept.x, y: intercept.y + 0.5 * gravity * t * t, z: intercept.z };
    t = Math.max(1e-4, length(subtract(aim, m)) / Math.max(1, speed));
  }
  intercept = add(p, scale(v, t));
  aim = { x: intercept.x, y: intercept.y + 0.5 * gravity * t * t, z: intercept.z };
  return {
    time: t,
    intercept,
    aim,
    drop: 0.5 * gravity * t * t,
    range: length(subtract(aim, m)),
  };
}

/** Angle (rad) between unit-ish vectors a and b. */
export function angleBetween(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return Math.acos(Math.max(-1, Math.min(1, dot(na, nb))));
}

/**
 * Smoothed velocity estimate per hittable (targets don't all expose `vel`).
 * update(target, position, dt) -> {x,y,z}. dt <= 0 returns the previous estimate.
 */
export function createVelocityTracker({ smoothing = 0.35 } = {}) {
  const memory = new WeakMap();
  return {
    update(key, position, dt) {
      if (!key || typeof key !== 'object') return { x: 0, y: 0, z: 0 };
      if (key.vel && Number.isFinite(key.vel.x)) return copy(key.vel);
      const now = copy(position);
      const entry = memory.get(key);
      if (!entry) {
        memory.set(key, { last: now, vel: { x: 0, y: 0, z: 0 } });
        return { x: 0, y: 0, z: 0 };
      }
      if (dt > 1e-5) {
        const inst = scale(subtract(now, entry.last), 1 / dt);
        const speed = length(inst);
        // a teleport (respawn, pass reset) is not velocity
        if (speed < 140) {
          entry.vel = add(scale(entry.vel, 1 - smoothing), scale(inst, smoothing));
        } else entry.vel = { x: 0, y: 0, z: 0 };
        entry.last = now;
      }
      return copy(entry.vel);
    },
  };
}

/**
 * Lead-pipper evaluation for one candidate. Returns null when the pipper must
 * not be shown (out of range, outside the front cone, no target).
 */
export function evaluateLead({
  muzzle, cameraPos, cameraDir, target, targetVel, speed, gravity, range = 250, cone = Math.PI / 6,
}) {
  if (!target) return null;
  const toTarget = subtract(copy(target), copy(cameraPos));
  const dist = length(toTarget);
  if (dist > range || dist < 1) return null;
  if (angleBetween(cameraDir, toTarget) > cone) return null;
  const solution = solveLead({ muzzle, target, targetVel, speed, gravity });
  return { ...solution, distance: dist };
}

/**
 * Pipper "on target" dwell: the aim ray must stay within `tolerance` rad of the
 * solution for `hold` s. Stateful; step(dt, angleError|null) -> boolean.
 */
export function createDwell(hold = 0.2) {
  let t = 0;
  return {
    step(dt, error, tolerance) {
      if (error == null || error > tolerance) t = 0; else t = Math.min(hold * 4, t + dt);
      return t >= hold;
    },
    reset() { t = 0; },
    get value() { return t; },
  };
}

/** Pick the candidate nearest to the aim ray within `cone` rad and `range`. */
export function pickLockCandidate({ origin, direction, candidates, cone, range, sticky = null, castSegment = null }) {
  const o = copy(origin);
  const d = normalize(direction);
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates || []) {
    if (!c?.center || !activeHittable(c) || !c.enemy) continue;
    const to = subtract(copy(c.center), o);
    const dist = length(to);
    if (dist > range || dist < 2) continue;
    // angular size of the target widens the cone (big enemies are easier to lock)
    const widen = Math.atan2(targetRadius(c), dist);
    const ang = angleBetween(d, to);
    if (ang > cone + widen) continue;
    if (castSegment) {
      const blocked = castSegment(o, copy(c.center), 0);
      if (blocked && Number.isFinite(blocked.fraction) && blocked.fraction < 0.98 && blocked.node !== (c.node || c.g)
        && blocked.kind !== 'target') continue;
    }
    const score = ang - (c === sticky ? cone * 0.5 : 0);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Up to `max` distinct targets inside the swarm cone, nearest-to-ray first. */
export function pickSwarmTargets({ origin, direction, candidates, cone, range, max = 8, castSegment = null }) {
  const scored = [];
  const o = copy(origin);
  const d = normalize(direction);
  for (const c of candidates || []) {
    if (!c?.center || !activeHittable(c) || !c.enemy) continue;
    const to = subtract(copy(c.center), o);
    const dist = length(to);
    if (dist > range || dist < 2) continue;
    const ang = angleBetween(d, to);
    if (ang > cone + Math.atan2(targetRadius(c), dist)) continue;
    if (castSegment) {
      const blocked = castSegment(o, copy(c.center), 0);
      if (blocked && Number.isFinite(blocked.fraction) && blocked.fraction < 0.98
        && blocked.node !== (c.node || c.g) && blocked.kind !== 'target') continue;
    }
    scored.push([ang, c]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, max).map(e => e[1]);
}

/**
 * Lock state machine for MISIL guided / SWARM. Pure and time-driven.
 * states: 'none' | 'acquiring' | 'locked' | 'lost'   (lost lasts `loseFade`, then none)
 * step({ dt, holding, candidate }) -> { state, progress, target, changed }
 */
export function createLockTracker({ lockTime = 0.8, loseGrace = 0.35, loseFade = 0.15 } = {}) {
  let state = 'none';
  let progress = 0;
  let target = null;
  let missing = 0;
  let fade = 0;
  return {
    step({ dt = 0, holding = false, candidate = null }) {
      const before = state;
      const beforeTarget = target;
      if (!holding) {
        if (state === 'locked' || state === 'acquiring') {
          // trigger released: the caller reads `target` from the last frame; we reset
          state = 'none'; progress = 0; target = null; missing = 0;
        } else if (state === 'lost') {
          fade -= dt;
          if (fade <= 0) { state = 'none'; target = null; }
        }
        return { state, progress, target, changed: state !== before || target !== beforeTarget };
      }
      if (state === 'lost') {
        fade -= dt;
        if (fade <= 0) { state = 'none'; target = null; progress = 0; }
      }
      if (state === 'none' || state === 'lost') {
        if (candidate) { state = 'acquiring'; target = candidate; progress = 0; missing = 0; }
      } else if (state === 'acquiring') {
        if (!candidate) { state = 'none'; target = null; progress = 0; }
        else if (candidate !== target) { target = candidate; progress = 0; }
        else {
          progress = Math.min(1, progress + dt / lockTime);
          if (progress >= 1) state = 'locked';
        }
      } else if (state === 'locked') {
        if (candidate === target) missing = 0;
        else {
          missing += dt;
          if (missing >= loseGrace) { state = 'lost'; fade = loseFade; progress = 0; missing = 0; }
        }
      }
      return { state, progress, target, changed: state !== before || target !== beforeTarget };
    },
    get state() { return state; },
    get progress() { return progress; },
    get target() { return target; },
    reset() { state = 'none'; progress = 0; target = null; missing = 0; fade = 0; },
  };
}
