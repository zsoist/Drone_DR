// Pure, deterministic Invasion decisions. This module intentionally has no
// browser or Three.js dependencies so device budgets and AI can be regression tested.

export const DEVICE_BUDGETS = Object.freeze({
  low: Object.freeze({
    maxEnemies: 12,
    maxProjectiles: 18,
    nearDetail: 1,
    fullDistance: 18,
    lod1Distance: 42,
  }),
  medium: Object.freeze({
    maxEnemies: 20,
    maxProjectiles: 32,
    nearDetail: 3,
    fullDistance: 26,
    lod1Distance: 70,
  }),
  high: Object.freeze({
    maxEnemies: 30,
    maxProjectiles: 48,
    nearDetail: 6,
    fullDistance: 36,
    lod1Distance: 100,
  }),
});

const DIFFICULTY = Object.freeze({
  facil: 0.8,
  media: 1,
  dificil: 1.25,
});

const AIR_TYPES = new Set(['ufo', 'avion', 'dragon']);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function tierName(tier) {
  return Object.hasOwn(DEVICE_BUDGETS, tier) ? tier : 'medium';
}

export function getDeviceBudget(tier = 'medium') {
  return { ...DEVICE_BUDGETS[tierName(tier)] };
}

export function getInvasionRuntimeCaps(tier = 'medium', selectedTypeCount = 1) {
  const budget = DEVICE_BUDGETS[tierName(tier)];
  const types = Math.max(1, Math.min(7, Math.floor(finite(selectedTypeCount, 1))));
  return {
    enemies: budget.maxEnemies,
    shots: budget.maxProjectiles,
    bursts: budget.maxEnemies * 4,
    modelCache: types * 3,
  };
}

export function modelLoadDecision(cacheEntry) {
  return cacheEntry == null ? 'load' : 'skip';
}

export function selectEnemyLod(_type, distance, tier = 'medium', budget = {}) {
  const limits = DEVICE_BUDGETS[tierName(tier)];
  const d = Math.max(0, finite(distance, Number.POSITIVE_INFINITY));
  const nearUsed = Math.max(0, finite(budget.nearUsed));
  const nearLimit = Math.max(0, finite(budget.nearLimit, limits.nearDetail));

  if (d <= limits.fullDistance && nearUsed < nearLimit) return 'full';
  if (d <= limits.lod1Distance) return 'lod1';
  return 'lod2';
}

function seededGenerator(seed) {
  let state = (finite(seed, 1) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function countForType(type, wave) {
  if (type === 'gigante') return Math.max(1, Math.ceil(wave / 2));
  if (type === 'dragon') return 1;
  if (type === 'ufo' || type === 'avion') return 1 + Math.floor(wave / 2);
  return 3 + wave * 2;
}

export function capWaveQueue({
  types = ['zombie'],
  wave = 1,
  tier = 'medium',
  difficulty = 'media',
  seed = 1,
} = {}) {
  const selected = [...new Set(types.filter(type => typeof type === 'string' && type))];
  if (!selected.length) selected.push('zombie');
  const safeWave = Math.max(1, Math.floor(finite(wave, 1)));
  const scale = DIFFICULTY[difficulty] || DIFFICULTY.media;
  const queue = [];

  for (const type of selected) {
    const count = Math.max(1, Math.round(countForType(type, safeWave) * scale));
    for (let index = 0; index < count; index += 1) queue.push(type);
  }

  const random = seededGenerator(seed);
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [queue[index], queue[swap]] = [queue[swap], queue[index]];
  }
  return queue.slice(0, DEVICE_BUDGETS[tierName(tier)].maxEnemies);
}

export function engagementState(distance, band = {}) {
  const d = Math.max(0, finite(distance, Number.POSITIVE_INFINITY));
  const min = Math.max(0, finite(band.min));
  const max = Math.max(min, finite(band.max, min));
  if (d < min) return 'evade';
  if (d > max) return 'pursue';
  return 'attack';
}

function normalize2(x, z) {
  const length = Math.hypot(x, z);
  return length > 1e-9 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function rotate2(vector, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: vector.x * cos - vector.z * sin,
    z: vector.x * sin + vector.z * cos,
  };
}

export function steerGroundEnemy({
  position,
  target,
  speed = 0,
  dt = 0,
  seed = 1,
  isWalkable = () => true,
  neighbors = [],
  separationRadius = 3,
} = {}) {
  const start = { x: finite(position?.x), z: finite(position?.z) };
  const toward = normalize2(finite(target?.x) - start.x, finite(target?.z) - start.z);
  const step = Math.max(0, finite(speed)) * Math.max(0, finite(dt));
  if (!step || (!toward.x && !toward.z)) {
    return {
      position: start,
      heading: Math.atan2(toward.x, toward.z),
      blocked: false,
      moved: false,
      usedAlternate: false,
    };
  }

  let separationX = 0;
  let separationZ = 0;
  const radius = Math.max(0.01, finite(separationRadius, 3));
  for (const neighbor of neighbors) {
    const dx = start.x - finite(neighbor?.x);
    const dz = start.z - finite(neighbor?.z);
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-6 || distance >= radius) continue;
    const weight = 0.75 * (1 - distance / radius);
    separationX += (dx / distance) * weight;
    separationZ += (dz / distance) * weight;
  }
  const desired = normalize2(toward.x + separationX, toward.z + separationZ);
  const direct = {
    x: start.x + desired.x * step,
    z: start.z + desired.z * step,
  };
  if (isWalkable(direct.x, direct.z)) {
    return {
      position: direct,
      heading: Math.atan2(desired.x, desired.z),
      blocked: false,
      moved: true,
      usedAlternate: false,
    };
  }

  const random = seededGenerator(seed);
  const side = random() < 0.5 ? -1 : 1;
  const angles = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]
    .map(angle => angle * side);
  for (const angle of angles) {
    const alternate = rotate2(toward, angle);
    const candidate = {
      x: start.x + alternate.x * step,
      z: start.z + alternate.z * step,
    };
    if (!isWalkable(candidate.x, candidate.z)) continue;
    return {
      position: candidate,
      heading: Math.atan2(alternate.x, alternate.z),
      blocked: true,
      moved: true,
      usedAlternate: true,
    };
  }

  return {
    position: start,
    heading: Math.atan2(toward.x, toward.z),
    blocked: true,
    moved: false,
    usedAlternate: false,
  };
}

function interceptTime(relative, velocity, projectileSpeed) {
  const speedSq = projectileSpeed * projectileSpeed;
  const a = velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2 - speedSq;
  const b = 2 * (relative.x * velocity.x + relative.y * velocity.y + relative.z * velocity.z);
  const c = relative.x ** 2 + relative.y ** 2 + relative.z ** 2;

  if (c <= 1e-12) return 0;
  if (Math.abs(a) < 1e-9) return b < -1e-9 ? -c / b : Math.sqrt(c / speedSq);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Math.sqrt(c / speedSq);
  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter(value => value > 0);
  return candidates.length ? Math.min(...candidates) : Math.sqrt(c / speedSq);
}

export function predictiveAim({
  origin,
  target,
  targetVelocity = {},
  projectileSpeed,
  gravity = 0,
} = {}) {
  const from = {
    x: finite(origin?.x),
    y: finite(origin?.y),
    z: finite(origin?.z),
  };
  const velocity = {
    x: finite(targetVelocity?.x),
    y: finite(targetVelocity?.y),
    z: finite(targetVelocity?.z),
  };
  const relative = {
    x: finite(target?.x) - from.x,
    y: finite(target?.y) - from.y,
    z: finite(target?.z) - from.z,
  };
  const speed = Math.max(0.001, finite(projectileSpeed, 1));
  const time = interceptTime(relative, velocity, speed);
  const point = {
    x: from.x + relative.x + velocity.x * time,
    y: from.y + relative.y + velocity.y * time + 0.5 * Math.max(0, finite(gravity)) * time * time,
    z: from.z + relative.z + velocity.z * time,
  };
  const direction = normalize3(point.x - from.x, point.y - from.y, point.z - from.z);
  return {
    time,
    point,
    velocity: {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed,
    },
  };
}

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z);
  return length > 1e-9
    ? { x: x / length, y: y / length, z: z / length }
    : { x: 0, y: 0, z: 0 };
}

export function nextEnemyState(input = {}) {
  const {
    state = 'spawn',
    dead = false,
    air = false,
    ranged = false,
    blocked = false,
    attackReady = false,
  } = input;
  const time = Math.max(0, finite(input.timeInState));
  const distance = Math.max(0, finite(input.distance, Number.POSITIVE_INFINITY));

  if (dead || state === 'dead') return 'dead';
  if (state === 'spawn') return time >= finite(input.spawnDuration, 0.5) ? 'pursue' : 'spawn';

  if (state === 'attack') {
    if (air && time >= finite(input.maxAttackDuration, 1.4)) return 'evade';
    return time >= finite(input.windup, 0.45) ? 'recover' : 'attack';
  }
  if (state === 'recover') {
    return time >= finite(input.recoverDuration, 0.75) ? 'pursue' : 'recover';
  }
  if (state === 'evade') {
    if (air) {
      return distance >= finite(input.disengageDistance, 110) ? 'recover' : 'evade';
    }
    return !blocked && time >= finite(input.evadeDuration, 0.6) ? 'pursue' : 'evade';
  }

  if (blocked && !air) return 'evade';
  if (ranged) {
    const engagement = engagementState(distance, input.band);
    if (engagement !== 'attack') return engagement;
    return attackReady ? 'attack' : (air ? 'orbit' : 'strafe');
  }
  if (air) {
    const attackDistance = finite(input.attackDistance, 80);
    return distance <= attackDistance && attackReady ? 'attack' : 'pursue';
  }
  if (distance <= finite(input.attackDistance, 2.5) && attackReady) return 'attack';
  return 'pursue';
}

export function createBurstSchedule({
  requestedShots = 1,
  intervalMs = 0,
  maxShots = 4,
  maxDurationMs = 500,
} = {}) {
  const count = Math.max(0, Math.min(
    Math.floor(finite(requestedShots)),
    Math.floor(finite(maxShots, 4)),
  ));
  const interval = Math.max(0, finite(intervalMs));
  const duration = Math.max(0, finite(maxDurationMs, 500));
  const schedule = [];
  for (let index = 0; index < count; index += 1) {
    const delay = index * interval;
    if (delay > duration) break;
    schedule.push(delay);
  }
  return schedule;
}

export function isAirEnemy(type) {
  return AIR_TYPES.has(type);
}
