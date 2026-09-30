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
  const max = DEVICE_BUDGETS[tierName(tier)].maxEnemies;
  const head = queue.slice(0, max);
  // Reserve one slot per enemy type so truncation never drops a type (e.g. the dragon).
  const counts = new Map();
  for (const t of head) counts.set(t, (counts.get(t) || 0) + 1);
  for (const type of selected) {
    if (counts.get(type) || head.length < 1) continue;
    for (let i = head.length - 1; i >= 0; i -= 1) {
      if (counts.get(head[i]) > 1) {
        counts.set(head[i], counts.get(head[i]) - 1);
        head[i] = type;
        counts.set(type, 1);
        break;
      }
    }
  }
  return head;
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

// Una oleada solo termina con alive===0. Un enemigo de tierra que nace en un bolsillo sin camino
// (steerGroundEnemy → blocked/evade para siempre) o un volador que se pierde bloqueaban TODAS las
// oleadas siguientes. Tras el tiempo de gracia, los rezagados se retiran sin puntuar.
export const STRAGGLER_GROUND_S = 90;
export const STRAGGLER_ANY_S = 150;
export function shouldCullStraggler({ waveClock, air, queueEmpty }) {
  if (!queueEmpty || !Number.isFinite(waveClock)) return false;
  return waveClock >= (air ? STRAGGLER_ANY_S : STRAGGLER_GROUND_S);
}

// ════════════════════════════════════════════════════════════════════════════
// Flightverse v2 (?fv=2) — Invasión "justa": rampa de dificultad, daño con gracia,
// telégrafos, línea de visión, victoria, marcadores, puntuación, medallas.
// Todo puro y determinista: el motor (invasion.js) y las pruebas comparten estos números.
// ════════════════════════════════════════════════════════════════════════════

/** Tabla de dificultad (hp/cadencia/precisión) — fuente única; invasion.js la importa. */
export const DIFFICULTY_TUNING = Object.freeze({
  facil:   Object.freeze({ hp: 0.8, cadence: 1.25, accuracy: 0.72 }),
  media:   Object.freeze({ hp: 1, cadence: 1, accuracy: 0.86 }),
  dificil: Object.freeze({ hp: 1.25, cadence: 0.78, accuracy: 0.95 }),
});

/** Números de combate por tipo (fuente única; los SPECS visuales de invasion.js los extienden). */
export const ENEMY_COMBAT = Object.freeze({
  zombie:  { hp: 100,  speed: 1.6, dmg: 8,  melee: 2.2, tele: 0.5 },
  arquero: { hp: 90,   speed: 1.2, tele: 0.5,
    shoot: { every: 3.2, speed: 26, dmg: 6, grav: 9, range: 90, band: { min: 24, max: 80 } } },
  soldado: { hp: 120,  speed: 3.2, tele: 0.5,
    shoot: { every: 2.4, speed: 46, dmg: 3, grav: 0, range: 110, burst: 3, band: { min: 20, max: 95 } } },
  ufo:     { hp: 240,  speed: 7, fly: 'orbit', tele: 0.5,
    shoot: { every: 4, speed: 20, dmg: 10, grav: 0, range: 140, plasma: true, band: { min: 28, max: 115 } } },
  avion:   { hp: 140,  speed: 34, fly: 'pass', attackDistance: 120, dmg: 12, passHit: 16, tele: 0.8 },
  dragon:  { hp: 700,  speed: 9, fly: 'serp', tele: 0.8,
    shoot: { every: 4.5, speed: 17, dmg: 15, grav: 2, range: 150, fire: true, band: { min: 32, max: 125 } } },
  gigante: { hp: 1600, speed: 2.1, dmg: 22, melee: 7, tele: 1.0, slope: 6, foot: 5 },
});

export const FAIR = Object.freeze({
  graceS: 3,                 // tras cualquier impacto: sin más daño
  respawnInvulnS: 5,         // tras reaparecer
  spawnMinRadius: 80,        // m mínimos de nacimiento respecto al jugador
  firstAttackDelayS: 6,      // nadie ataca antes de 6 s de oleada
  noDefeatBeforeS: 30,       // no se puede perder en < 30 s desde el inicio de una oleada
  idleWarnS: 10,             // quieto y golpeado → aviso "Muévete"
  lives: 3,
  maxHitFrac: Object.freeze({ facil: 0.15, media: 0.15, dificil: 0.22 }),
  dmgScale: Object.freeze({ facil: 0.5, media: 0.6, dificil: 0.85 }),
  maxProjectileSpeed: 60,    // m/s en Media
  healthPackHp: 25,
  healthPackEveryWaves: 2,
});

export const VICTORY_WAVE = 10;
/** Oleada en la que entra cada tipo (spec §9). */
export const TYPE_INTRO = Object.freeze({
  zombie: 1, arquero: 2, soldado: 3, avion: 4, ufo: 5, dragon: 7, gigante: 9,
});

export const WAVE_PHONE_CAP = 12;
export function waveHpScale(n) { return 1 + 0.1 * Math.min(VICTORY_WAVE, Math.max(1, Math.floor(finite(n, 1)))); }
export function waveConcurrentCap(n, { coarse = false, tierMax = 30 } = {}) {
  const cap = 3 + Math.max(1, Math.floor(finite(n, 1)));
  return Math.min(cap, coarse ? WAVE_PHONE_CAP : tierMax);
}
/** Tipos activos en la oleada n (intersección con la selección). Si ninguno ha entrado aún, la selección tal cual. */
export function unlockedTypes(selected, wave) {
  const w = Math.max(1, Math.floor(finite(wave, 1)));
  const list = (selected?.length ? selected : ['zombie']).filter(t => Object.hasOwn(TYPE_INTRO, t));
  const open = list.filter(t => TYPE_INTRO[t] <= w);
  return open.length ? open : list;
}

/** Daño por impacto ya equilibrado: escala por dificultad, +3 %/oleada y tope del % de la vida máxima. */
export function fairHitDamage(specDmg, difficulty = 'media', wave = 1, maxHp = 100) {
  const scale = FAIR.dmgScale[difficulty] ?? FAIR.dmgScale.media;
  const cap = maxHp * (FAIR.maxHitFrac[difficulty] ?? FAIR.maxHitFrac.media);
  const ramp = 1 + 0.03 * (Math.max(1, finite(wave, 1)) - 1);
  return Math.min(cap, Math.max(0, finite(specDmg)) * scale * ramp);
}

/** Vida del jugador con gracia, invulnerabilidad, vidas y protección de inicio de oleada. */
export function createPlayerVitals({ maxHp = 100, lives = FAIR.lives } = {}) {
  const v = {
    maxHp, hp: maxHp, lives, livesMax: lives,
    lastHitT: -Infinity, invulnUntil: -Infinity, protectUntil: -Infinity,
    lastMoveT: 0, hitsTaken: 0, hitsBlocked: 0, damageThisWave: 0,
  };
  return {
    state: v,
    /** now en segundos de simulación. Devuelve {applied, blocked, lost}. */
    hit(amount, now) {
      if (!(amount > 0) || v.hp <= 0) return { applied: 0, blocked: 'dead', lost: false };
      if (now < v.invulnUntil) { v.hitsBlocked++; return { applied: 0, blocked: 'invuln', lost: false }; }
      if (now - v.lastHitT < FAIR.graceS) { v.hitsBlocked++; return { applied: 0, blocked: 'grace', lost: false }; }
      const floor = now < v.protectUntil ? 1 : 0;
      const before = v.hp;
      v.hp = Math.max(floor, v.hp - amount);
      v.lastHitT = now;
      v.hitsTaken++;
      v.damageThisWave += before - v.hp;
      return { applied: before - v.hp, blocked: null, lost: v.hp <= 0 };
    },
    /** El jugador perdió una vida: reaparece con vida llena e invulnerabilidad. false si no quedan vidas. */
    respawn(now) {
      v.lives -= 1;
      if (v.lives <= 0) return false;
      v.hp = v.maxHp;
      v.invulnUntil = now + FAIR.respawnInvulnS;
      v.lastHitT = -Infinity;
      return true;
    },
    heal(amount) { v.hp = Math.min(v.maxHp, v.hp + amount); },
    startWave(now) { v.protectUntil = now + FAIR.noDefeatBeforeS; v.damageThisWave = 0; },
    invulnerable(now) { return now < v.invulnUntil; },
    noteMove(now, speed) { if (speed > 0.6) v.lastMoveT = now; },
    /** ¿Golpeado estando quieto ≥ 10 s? */
    shouldWarnMove(now) { return now - v.lastMoveT >= FAIR.idleWarnS && now - v.lastHitT < 2; },
  };
}

/** Segundos de pre-disparo de un tipo (≥ 0.5 siempre). */
export function telegraphFor(type) {
  return Math.max(0.5, ENEMY_COMBAT[type]?.tele ?? 0.5);
}

/**
 * Plan de ataque: t (desde que empieza el telégrafo) en que sale cada proyectil / golpe.
 * La aserción "telégrafo precede al disparo ≥ 0.5 s" vive en los tests sobre esta función.
 */
export function planAttack(type, { intervalMs = 120 } = {}) {
  const tele = telegraphFor(type);
  const c = ENEMY_COMBAT[type] || {};
  const burst = createBurstSchedule({ requestedShots: c.shoot?.burst || 1, intervalMs, maxShots: 4, maxDurationMs: 420 });
  return { tele, shotTimes: burst.map(ms => tele + ms / 1000) };
}

export function firstAttackAllowed(waveClock, enemyAge) {
  return waveClock >= FAIR.firstAttackDelayS && enemyAge >= 0.5;
}

/** Línea de visión enemigo→jugador con castSegment inyectado (world collision). */
export function hasLineOfSight(castSegment, from, to, tolerance = 0.98) {
  if (typeof castSegment !== 'function') return true;
  const hit = castSegment(from, to, 0);
  return !hit || !(hit.fraction < tolerance);
}

function segmentClosestDistance(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return { dist: Math.hypot(dx, dy, dz), t };
}

/**
 * Un paso de proyectil enemigo: ¿choca con cobertura antes de llegar al dron?
 * Devuelve {kind:'world'|'drone'|'miss', t}. Barrido segmento-esfera (sin túnel a 46 m/s).
 */
export function resolveShotStep({ prev, next, dronePos, hitRadius = 1.8, castSegment }) {
  const world = typeof castSegment === 'function' ? castSegment(prev, next, 0) : null;
  const drone = segmentClosestDistance(prev, next, dronePos);
  const droneHit = drone.dist < hitRadius;
  if (world && (!droneHit || world.fraction <= drone.t)) return { kind: 'world', t: world.fraction, hit: world };
  if (droneHit) return { kind: 'drone', t: drone.t };
  return { kind: 'miss', t: 1 };
}

/** Detector de enemigos atascados: 'ok' | 'nudge' (desvío) | 'relocate' (reaparecer cerca). */
export function createStuckTracker({ windowS = 4, minProgress = 1.0 } = {}) {
  let ax = null, az = null, t = 0, strikes = 0;
  return {
    get strikes() { return strikes; },
    reset() { ax = null; t = 0; },
    step(x, z, dt, wantsToMove) {
      if (!wantsToMove) { ax = null; t = 0; return 'ok'; }
      if (ax == null) { ax = x; az = z; t = 0; return 'ok'; }
      t += dt;
      if (t < windowS) return 'ok';
      const moved = Math.hypot(x - ax, z - az);
      ax = x; az = z; t = 0;
      if (moved >= minProgress) { strikes = 0; return 'ok'; }
      strikes++;
      return strikes >= 2 ? 'relocate' : 'nudge';
    },
  };
}

/** Máquina de fases de la run. Devuelve el siguiente estado (puro) + evento opcional. */
export function stepRunPhase(s, dt, { alive = 0, queueLen = 0, burstsLen = 0, victoryWave = VICTORY_WAVE } = {}) {
  const out = { ...s, event: null };
  if (s.phase === 'loading') {
    out.countdown = s.countdown - dt;
    if (out.countdown <= 0) { out.phase = 'countdown'; out.countdown = 3; out.event = 'intro'; }
  } else if (s.phase === 'countdown') {
    out.countdown = s.countdown - dt;
    if (out.countdown <= 0) { out.phase = 'running'; out.countdown = 0; out.wave = s.wave + 1; out.event = 'wave-start'; }
  } else if (s.phase === 'running') {
    if (alive === 0 && queueLen === 0 && burstsLen === 0) {
      if (s.wave >= victoryWave) { out.phase = 'victory'; out.event = 'victory'; }
      else { out.phase = 'clear'; out.countdown = 2.5; out.event = 'wave-clear'; }
    }
  } else if (s.phase === 'clear') {
    out.countdown = s.countdown - dt;
    if (out.countdown <= 0) { out.phase = 'countdown'; out.countdown = 3; out.event = 'intro'; }
  }
  return out;
}

export const SCORE_BASE = Object.freeze({
  zombie: 100, arquero: 120, soldado: 150, avion: 200, ufo: 220, dragon: 1000, gigante: 1500,
});
export const COMBO_WINDOW_S = 4;
export const COMBO_MAX = 12;
export function killScore(type, combo) { return (SCORE_BASE[type] ?? 100) * Math.max(1, Math.min(COMBO_MAX, combo)); }
export function waveBonus(wave, noDamage) { return 200 * wave + (noDamage ? 300 : 0); }

/** Medalla de Invasión: bronce oleada 3, plata 6, oro 10 sin perder vidas. */
export function invasionMedal({ wavesCleared = 0, livesLost = 0, victory = false }) {
  if ((victory || wavesCleared >= VICTORY_WAVE) && livesLost === 0) return 'gold';
  if (wavesCleared >= 6) return 'silver';
  if (wavesCleared >= 3) return 'bronze';
  return null;
}

/**
 * Marcadores de HUD (spec §9). project(pos) -> {x,y,behind} en NDC (-1..1, y arriba).
 * Devuelve coordenadas de pantalla normalizadas 0..1 (origen arriba-izquierda).
 */
export function computeMarkers({
  enemies = [], player, project, maxMarkers = 6, maxEdge = 3, maxDist = 300, edgeInset = 0.06,
} = {}) {
  const rows = [];
  for (const e of enemies) {
    const dx = e.pos.x - player.x, dy = e.pos.y - player.y, dz = e.pos.z - player.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) continue;
    const p = project(e.pos);
    if (!p) continue;
    const onScreen = !p.behind && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    rows.push({ id: e.id, type: e.type, dist, hpFrac: e.hpFrac ?? 1, boss: !!e.boss, telegraphing: !!e.telegraphing, p, onScreen, dir: { x: dx, y: dy, z: dz } });
  }
  rows.sort((a, b) => a.dist - b.dist);
  const markers = [], edges = [];
  const overflow = [];
  const edgeOf = r => {
    // dirección en pantalla; detrás del dron se invierte para apuntar al lado más corto
    let sx = r.p.x, sy = r.p.y;
    if (r.p.behind) { sx = -sx; sy = -sy; if (Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05) sx = 1; }
    const ang = Math.atan2(sy, sx);            // 0 = derecha, +π/2 = arriba
    const m = Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
    const ex = Math.max(-1, Math.min(1, sx / m)) * (1 - edgeInset * 2);
    const ey = Math.max(-1, Math.min(1, sy / m)) * (1 - edgeInset * 2);
    return {
      id: r.id, type: r.type, dist: Math.round(r.dist), angle: ang, telegraphing: r.telegraphing,
      x: (ex + 1) / 2, y: (1 - ey) / 2,
      opacity: +Math.max(0.35, 1 - r.dist / (maxDist * 1.1)).toFixed(2),
    };
  };
  for (const r of rows) {
    if (r.onScreen && markers.length < maxMarkers) {
      markers.push({
        id: r.id, type: r.type, dist: Math.round(r.dist), hpFrac: r.hpFrac, boss: r.boss, telegraphing: r.telegraphing,
        x: (r.p.x + 1) / 2, y: (1 - r.p.y) / 2,
      });
    } else if (r.onScreen) overflow.push(r);
    else if (edges.length < maxEdge) edges.push(edgeOf(r));          // fuera de pantalla: prioridad (lo que no ves es lo que te mata)
  }
  for (const r of overflow) { if (edges.length >= maxEdge) break; edges.push(edgeOf(r)); }   // el resto "colapsa" a flechas si sobra hueco
  return { markers, edges };
}

/**
 * Simulación determinista de un jugador QUIETO (peor caso: sin LOS de cobertura, todo impacta con p=hitProb).
 * Devuelve segundos hasta perder la primera vida (Infinity si sobrevive `seconds`).
 */
export function simulateStationaryPlayer({
  difficulty = 'media', types = ['zombie'], wave = 1, seconds = 120, hitProb = 0.9, seed = 7, tier = 'medium', coarse = false,
} = {}) {
  const rnd = seededGenerator(seed);
  const tune = DIFFICULTY_TUNING[difficulty] || DIFFICULTY_TUNING.media;
  const active = unlockedTypes(types, wave);
  const queue = capWaveQueue({ types: active, wave, tier, difficulty, seed })
    .slice(0, waveConcurrentCap(wave, { coarse, tierMax: DEVICE_BUDGETS[tierName(tier)].maxEnemies }));
  const vitals = createPlayerVitals();
  vitals.startWave(0);
  const foes = queue.map((type, i) => {
    const c = ENEMY_COMBAT[type];
    const r = FAIR.spawnMinRadius + rnd() * (c.fly ? 60 : 30);
    return { type, c, d: r, cool: FAIR.firstAttackDelayS + i * 0.35, tele: -1, age: 0 };
  });
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) {
    for (const f of foes) {
      f.age += dt;
      const band = f.c.shoot?.band;
      const stop = band ? band.max * 0.95 : (f.c.melee ? 0 : (f.c.attackDistance || 0));
      if (f.d > stop && f.tele < 0) f.d = Math.max(stop, f.d - f.c.speed * dt);
      if (f.tele >= 0) {
        f.tele -= dt;
        if (f.tele < 0) {
          f.tele = -1;
          const shots = f.c.shoot?.burst || 1;
          const dmg = fairHitDamage((f.c.shoot?.dmg ?? f.c.dmg), difficulty, wave);
          for (let s = 0; s < shots; s++) {
            if (rnd() < hitProb) vitals.hit(dmg, t + s * 0.12);
          }
          f.cool = (f.c.shoot?.every || 0.8) * tune.cadence;
        }
        continue;
      }
      f.cool -= dt;
      const inRange = f.c.melee ? f.d <= f.c.melee : (f.c.shoot ? f.d <= f.c.shoot.range : f.d <= (f.c.attackDistance || 80));
      if (f.cool <= 0 && inRange && firstAttackAllowed(t, f.age)) f.tele = telegraphFor(f.type);
    }
    if (vitals.state.hp <= 0) return t;
  }
  return Infinity;
}

/** Saca la primera aparición de cada tipo al frente: toda oleada presenta su variedad de entrada. */
export function interleaveQueue(queue) {
  const seen = new Set(), head = [], rest = [];
  for (const t of queue) { if (!seen.has(t)) { seen.add(t); head.push(t); } else rest.push(t); }
  return [...head, ...rest];
}
