// Dynamic scene-item collision. Bounds are already expressed in world space by
// objects.js, so this layer stays dependency-free and deterministic.

const EPSILON = 1e-9;
const AXES = ['x', 'y', 'z'];
const copy = value => ({
  x: Number(value?.x) || 0,
  y: Number(value?.y) || 0,
  z: Number(value?.z) || 0,
});
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (value, amount) => ({
  x: value.x * amount,
  y: value.y * amount,
  z: value.z * amount,
});
const lengthSq = value => (
  value.x * value.x + value.y * value.y + value.z * value.z
);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function queryRadius(value) {
  const radius = typeof value === 'number'
    ? value
    : Number(value?.structure ?? value?.item ?? value?.radius ?? 0);
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

function validItem(item) {
  const min = item?.bounds?.min;
  const max = item?.bounds?.max;
  return Boolean(
    min && max
    && AXES.every(axis => (
      Number.isFinite(Number(min[axis]))
      && Number.isFinite(Number(max[axis]))
      && Number(min[axis]) <= Number(max[axis])
    )),
  );
}

function isLive(item, removed) {
  return validItem(item)
    && !removed.has(item.node)
    && !item.dead
    && !item.node?.userData?.dead;
}

function segmentBroadPhase(start, end, item, radius) {
  const center = item.broadSphere?.center;
  const broadRadius = Number(item.broadSphere?.radius);
  if (!center || !Number.isFinite(broadRadius) || broadRadius < 0) return true;
  const delta = subtract(end, start);
  const sizeSq = lengthSq(delta);
  const offset = subtract(center, start);
  const fraction = sizeSq > EPSILON
    ? clamp(
      (offset.x * delta.x + offset.y * delta.y + offset.z * delta.z) / sizeSq,
      0,
      1,
    )
    : 0;
  const nearest = add(start, scale(delta, fraction));
  const expanded = broadRadius + radius;
  return lengthSq(subtract(nearest, center)) <= expanded * expanded + EPSILON;
}

function expandedBounds(item, radius) {
  return {
    min: {
      x: Number(item.bounds.min.x) - radius,
      y: Number(item.bounds.min.y) - radius,
      z: Number(item.bounds.min.z) - radius,
    },
    max: {
      x: Number(item.bounds.max.x) + radius,
      y: Number(item.bounds.max.y) + radius,
      z: Number(item.bounds.max.z) + radius,
    },
  };
}

function inside(point, bounds) {
  return AXES.every(axis => (
    point[axis] >= bounds.min[axis] - EPSILON
    && point[axis] <= bounds.max[axis] + EPSILON
  ));
}

function insideInterior(point, bounds) {
  return AXES.every(axis => (
    point[axis] > bounds.min[axis] + EPSILON
    && point[axis] < bounds.max[axis] - EPSILON
  ));
}

function nearestExit(point, bounds) {
  const faces = [
    { distance: point.x - bounds.min.x, normal: { x: -1, y: 0, z: 0 } },
    { distance: bounds.max.x - point.x, normal: { x: 1, y: 0, z: 0 } },
    { distance: point.y - bounds.min.y, normal: { x: 0, y: -1, z: 0 } },
    { distance: bounds.max.y - point.y, normal: { x: 0, y: 1, z: 0 } },
    { distance: point.z - bounds.min.z, normal: { x: 0, y: 0, z: -1 } },
    { distance: bounds.max.z - point.z, normal: { x: 0, y: 0, z: 1 } },
  ];
  return faces.reduce(
    (best, face) => (!best || face.distance < best.distance ? face : best),
    null,
  );
}

function itemHit(startValue, endValue, item, radius) {
  const start = copy(startValue);
  const end = copy(endValue);
  const bounds = expandedBounds(item, radius);
  const delta = subtract(end, start);
  if (inside(start, bounds)) {
    const exit = nearestExit(start, bounds);
    return {
      kind: 'item',
      source: 'item',
      fraction: 0,
      point: start,
      surfacePoint: subtract(start, scale(exit.normal, radius)),
      normal: exit.normal,
      distance: 0,
      node: item.node,
      item,
      materialClass: item.materialClass || 'generic',
    };
  }

  let enter = 0;
  let leave = 1;
  let normal = null;
  for (const axis of AXES) {
    const movement = delta[axis];
    if (Math.abs(movement) <= EPSILON) {
      if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return null;
      continue;
    }
    const inverse = 1 / movement;
    let near = (bounds.min[axis] - start[axis]) * inverse;
    let far = (bounds.max[axis] - start[axis]) * inverse;
    let nearNormal = { x: 0, y: 0, z: 0 };
    nearNormal[axis] = -1;
    if (near > far) {
      [near, far] = [far, near];
      nearNormal[axis] = 1;
    }
    if (near > enter) {
      enter = near;
      normal = nearNormal;
    }
    leave = Math.min(leave, far);
    if (enter - leave > EPSILON) return null;
  }
  if (!normal || enter < -EPSILON || enter > 1 + EPSILON) return null;
  const point = add(start, scale(delta, clamp(enter, 0, 1)));
  return {
    kind: 'item',
    source: 'item',
    fraction: clamp(enter, 0, 1),
    point,
    surfacePoint: subtract(point, scale(normal, radius)),
    normal,
    distance: radius,
    node: item.node,
    item,
    materialClass: item.materialClass || 'generic',
  };
}

function closestItem(pointValue, item, maxDistance = Infinity) {
  const point = copy(pointValue);
  const nearest = {
    x: clamp(point.x, item.bounds.min.x, item.bounds.max.x),
    y: clamp(point.y, item.bounds.min.y, item.bounds.max.y),
    z: clamp(point.z, item.bounds.min.z, item.bounds.max.z),
  };
  const offset = subtract(point, nearest);
  let distance = Math.sqrt(lengthSq(offset));
  let normal;
  if (distance <= EPSILON) {
    const exit = nearestExit(point, item.bounds);
    distance = 0;
    normal = exit.normal;
  } else {
    normal = scale(offset, 1 / distance);
  }
  if (distance > maxDistance) return null;
  return {
    kind: 'item',
    source: 'item',
    distance,
    point: nearest,
    normal,
    node: item.node,
    item,
    materialClass: item.materialClass || 'generic',
  };
}

export function createSceneObjectCollision(initialItems = []) {
  let items = [];
  let disposed = false;
  const removed = new WeakSet();
  const qa = {
    ready: true,
    casts: 0,
    sweeps: 0,
    recoveries: 0,
    broadRejects: 0,
    narrowTests: 0,
    hits: 0,
    removals: 0,
    itemCount: 0,
    disposed: false,
  };

  const ensureActive = () => {
    if (disposed) throw new Error('scene object collision disposed');
  };
  const setItems = value => {
    ensureActive();
    items = Array.isArray(value) ? value.filter(validItem) : [];
    qa.itemCount = items.length;
    return qa.itemCount;
  };
  const remove = node => {
    ensureActive();
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return false;
    removed.add(node);
    const item = items.find(entry => entry.node === node);
    if (item) item.dead = true;
    qa.removals += item ? 1 : 0;
    return Boolean(item);
  };
  const query = (startValue, endValue, radiusValue) => {
    const start = copy(startValue);
    const end = copy(endValue);
    const radius = queryRadius(radiusValue);
    let best = null;
    for (const item of items) {
      if (!isLive(item, removed)) continue;
      if (!segmentBroadPhase(start, end, item, radius)) {
        qa.broadRejects += 1;
        continue;
      }
      qa.narrowTests += 1;
      const hit = itemHit(start, end, item, radius);
      if (hit && (!best || hit.fraction < best.fraction)) best = hit;
    }
    if (best) qa.hits += 1;
    return best;
  };

  setItems(initialItems);
  return {
    setItems,
    remove,
    castSegment(start, end, radius = 0) {
      ensureActive();
      qa.casts += 1;
      return query(start, end, radius);
    },
    sweepSphere(start, end, radius) {
      ensureActive();
      qa.sweeps += 1;
      return query(start, end, radius);
    },
    closest(point, maxDistance = Infinity) {
      ensureActive();
      let best = null;
      for (const item of items) {
        if (!isLive(item, removed)) continue;
        const hit = closestItem(point, item, maxDistance);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      return best;
    },
    recoverSphere(pointValue, radiusValue) {
      ensureActive();
      qa.recoveries += 1;
      const radius = queryRadius(radiusValue);
      const origin = copy(pointValue);
      let point = copy(origin);
      let last = null;
      for (let pass = 0; pass < items.length + 2; pass += 1) {
        let candidate = null;
        for (const item of items) {
          if (!isLive(item, removed)) continue;
          const bounds = expandedBounds(item, radius);
          if (!insideInterior(point, bounds)) continue;
          const exit = nearestExit(point, bounds);
          if (!candidate || exit.distance < candidate.distance) {
            candidate = { ...exit, item };
          }
        }
        if (!candidate) break;
        const amount = Math.max(0, candidate.distance);
        point = add(point, scale(candidate.normal, amount));
        last = candidate;
      }
      if (!last) return null;
      return {
        kind: 'item',
        source: 'item',
        fraction: 0,
        point,
        translation: subtract(point, origin),
        normal: last.normal,
        node: last.item.node,
        item: last.item,
        materialClass: last.item.materialClass || 'generic',
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      items = [];
      qa.itemCount = 0;
      qa.disposed = true;
    },
    qa,
  };
}

function earliest(candidates) {
  return candidates
    .filter(hit => hit && Number.isFinite(hit.fraction))
    .sort((a, b) => a.fraction - b.fraction)[0] || null;
}

function shortestRecovery(candidates) {
  return candidates
    .filter(hit => hit?.translation && Number.isFinite(lengthSq(hit.translation)))
    .sort((a, b) => lengthSq(a.translation) - lengthSq(b.translation))[0] || null;
}

export function composeCollisionWorld(world, sceneItems) {
  const items = sceneItems?.castSegment
    ? sceneItems
    : createSceneObjectCollision(sceneItems || []);
  const qa = {
    ready: Boolean(world?.qa?.ready ?? true),
    casts: 0,
    sweeps: 0,
    recoveries: 0,
    worldHits: 0,
    itemHits: 0,
    get itemCount() { return items?.qa?.itemCount || 0; },
    world: world?.qa || null,
    items: items?.qa || null,
  };
  const record = hit => {
    if (!hit) return null;
    if (hit.source === 'item') qa.itemHits += 1;
    else {
      qa.worldHits += 1;
      if (!hit.source) hit = { ...hit, source: 'world' };
    }
    return hit;
  };
  return {
    castSegment(start, end, radius = 0) {
      qa.casts += 1;
      return record(earliest([
        world?.castSegment?.(start, end, radius) || null,
        items?.castSegment?.(start, end, radius) || null,
      ]));
    },
    sweepSphere(start, end, radius) {
      qa.sweeps += 1;
      return record(earliest([
        world?.sweepSphere?.(start, end, radius) || null,
        items?.sweepSphere?.(start, end, radius) || null,
      ]));
    },
    recoverSphere(point, radius) {
      qa.recoveries += 1;
      return shortestRecovery([
        world?.recoverSphere?.(point, radius) || null,
        items?.recoverSphere?.(point, radius) || null,
      ]);
    },
    closest(point, maxDistance = Infinity) {
      const candidates = [
        world?.closest?.(point, maxDistance) || null,
        items?.closest?.(point, maxDistance) || null,
      ].filter(Boolean);
      return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
    },
    groundHeight: (...args) => world?.groundHeight?.(...args) ?? null,
    remove: node => items?.remove?.(node) || false,
    dispose: () => items?.dispose?.(),
    qa,
  };
}

export function createMutableCollisionWorld(world) {
  let items = null;
  let composite = composeCollisionWorld(world, []);
  const wrapper = {
    setItems(next) {
      if (items && items !== next) items.dispose?.();
      items = next?.castSegment
        ? next
        : next
          ? createSceneObjectCollision(next)
          : createSceneObjectCollision([]);
      composite = composeCollisionWorld(world, items);
      return composite.qa.itemCount;
    },
    castSegment: (...args) => composite.castSegment(...args),
    sweepSphere: (...args) => composite.sweepSphere(...args),
    recoverSphere: (...args) => composite.recoverSphere(...args),
    closest: (...args) => composite.closest(...args),
    groundHeight: (...args) => composite.groundHeight(...args),
    remove: node => composite.remove(node),
    dispose() {
      items?.dispose?.();
      items = null;
    },
  };
  Object.defineProperty(wrapper, 'qa', { get: () => composite.qa });
  return wrapper;
}
