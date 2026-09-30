// Pure data and fixed-step helpers for the Flightverse arsenal.
// This module has no DOM or Three dependency so every behavior is testable.
//
// Nine profiles stay in the registry (ammo/cooldown logic is shared by the legacy
// and ?fv=2 paths). Under ?fv=2 the player-facing arsenal is SIX weapons
// (WEAPON_UI_KEYS); M·S / M·L / VIPER-X are internal variants of MISIL.

const freezeProfile = profile => Object.freeze({ ...profile });

export const WEAPON_PROFILES = Object.freeze({
  mg: freezeProfile({
    kind: 'bullet', label: 'MG', code: 'MG', auto: true, rate: 0.085,
    max: 120, regen: 12, speed: 150, dmg: 14, gravity: 4,
    model: null, effect: 'kinetic',
  }),
  s: freezeProfile({
    kind: 'missile', label: 'M·S', code: 'M·S', cd: 0.4,
    max: 12, regen: 0.55, speed: 74, dmg: 360, gravity: 2.2,
    big: 0.75, radius: 0.1, proximity: 1.2,
    model: null, effect: 'missile-light',
  }),
  m: freezeProfile({
    kind: 'missile', label: 'M·M', code: 'M·M', cd: 0.9,
    max: 8, regen: 0.4, speed: 56, dmg: 900, gravity: 2.2,
    big: 1.25, radius: 0.16, proximity: 1.8,
    model: null, effect: 'missile-medium',
  }),
  l: freezeProfile({
    kind: 'missile', label: 'M·L', code: 'M·L', cd: 2.2,
    max: 3, regen: 0.12, speed: 42, dmg: 1200, gravity: 2.2,
    big: 2.2, radius: 0.25, proximity: 3,
    model: null, effect: 'missile-heavy',
  }),
  ac: freezeProfile({
    kind: 'bullet', label: 'AC-30', code: 'AC', auto: true, rate: 0.16,
    max: 48, regen: 2.4, speed: 125, dmg: 48, gravity: 4,
    model: 'ac30_cannon', effect: 'kinetic-heavy',
  }),
  sw: freezeProfile({
    kind: 'swarm', label: 'SWARM-8', code: 'SW', cd: 3.2,
    max: 4, regen: 0.08, count: 8, interval: 0.085,
    speed: 68, dmg: 95, gravity: 2.2, big: 0.48, radius: 0.07, proximity: 0.8,
    model: 'swarm8_pod', effect: 'micro-rocket',
  }),
  vx: freezeProfile({
    kind: 'guided', label: 'VIPER-X', code: 'VX', cd: 2.8,
    max: 4, regen: 0.1, speed: 62, turnRate: 1.9, gravity: 1.2,
    dmg: 720, big: 1.45, radius: 0.17, proximity: 2.4,
    model: 'viperx_missile', effect: 'guided',
  }),
  rg: freezeProfile({
    kind: 'rail', label: 'RAIL', code: 'RG', cd: 1.7,
    max: 10, regen: 0.28, speed: 460, dmg: 520,
    radius: 0.025, fireball: false,
    model: 'railgun_pod', effect: 'rail',
  }),
  tb: freezeProfile({
    kind: 'bomb', label: 'NOVA', code: 'TB', cd: 4.8,
    max: 2, regen: 0.045, speed: 12, gravity: 18,
    dmg: 1200, splash: 18, big: 2.8, radius: 0.28, proximity: 0,
    model: 'nova_bomb', effect: 'heavy',
  }),
});

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const copy = value => ({
  x: finite(value?.x),
  y: finite(value?.y),
  z: finite(value?.z),
});
const normalize = value => {
  const vector = copy(value);
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
};

export function isContinuousWeaponKey(key) {
  return Boolean(WEAPON_PROFILES[key]?.auto);
}

export function createLaunchSchedule(schedules, key, origin, aim) {
  const profile = WEAPON_PROFILES[key];
  if (!Array.isArray(schedules) || profile?.kind !== 'swarm') return false;
  if (schedules.some(schedule => schedule.key === key)) return false;
  schedules.push({
    key,
    origin,
    aim,
    launched: 0,
    elapsed: profile.interval,
  });
  return true;
}

export function advanceLaunchSchedules(schedules, dt, launch) {
  if (!Array.isArray(schedules)) return 0;
  let emitted = 0;
  for (let index = schedules.length - 1; index >= 0; index -= 1) {
    const schedule = schedules[index];
    const profile = WEAPON_PROFILES[schedule.key];
    if (!profile || profile.kind !== 'swarm') {
      schedules.splice(index, 1);
      continue;
    }
    schedule.elapsed += Math.max(0, finite(dt));
    while (
      schedule.launched < profile.count
      && schedule.elapsed + 1e-9 >= profile.interval
    ) {
      schedule.elapsed -= profile.interval;
      launch?.({
        key: schedule.key,
        index: schedule.launched,
        origin: schedule.origin,
        aim: schedule.aim,
      });
      schedule.launched += 1;
      emitted += 1;
    }
    if (schedule.launched >= profile.count) schedules.splice(index, 1);
  }
  return emitted;
}

export function steerVector(current, desired, turnRate, dt) {
  const from = normalize(current);
  const to = normalize(desired);
  const amount = Math.max(0, Math.min(1, finite(turnRate) * finite(dt)));
  return normalize({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  });
}

export function isGuidanceTargetVisible(origin, target, castSegment, targetNode = null) {
  if (typeof castSegment !== 'function') return true;
  const hit = castSegment(origin, target, 0);
  return !hit
    || hit.node === targetNode
    || !Number.isFinite(hit.fraction)
    || hit.fraction >= 1 - 1e-6;
}

export function integrateProjectileState(state, profile, dt) {
  const step = Math.max(0, finite(dt));
  if (!state?.position || !state?.velocity || !profile) return state;
  state.velocity.y -= finite(profile.gravity) * step;
  state.position.x += state.velocity.x * step;
  state.position.y += state.velocity.y * step;
  state.position.z += state.velocity.z * step;
  return state;
}

export function weaponAssetTier({ quality = 'auto', coarse = false } = {}) {
  if (coarse || quality === 'auto') return 'runtime';
  return ['extra', '4k', 'ultra'].includes(quality) ? 'ultra' : 'runtime';
}

// ─────────────────────────────────────────────────────────────────────────────
// ?fv=2 — the six-weapon arsenal (docs/FLIGHTVERSE_DESIGN_SPEC.md §4)
// ─────────────────────────────────────────────────────────────────────────────

/** Player-facing weapons, in slot order (keys 1-6). Everything else is internal. */
export const WEAPON_UI_KEYS = Object.freeze(['mg', 'ac', 'm', 'sw', 'rg', 'tb']);

/** Every registry key -> the player-facing weapon it belongs to. */
export const WEAPON_FAMILY = Object.freeze({
  mg: 'mg', ac: 'ac', s: 'm', m: 'm', l: 'm', vx: 'm', sw: 'sw', rg: 'rg', tb: 'tb',
});

/** Labels/HUD class per player-facing weapon (A reads this; the old labels stay in WEAPON_PROFILES). */
export const WEAPON_UI = Object.freeze({
  mg: Object.freeze({ slot: 1, label: 'MG', code: 'MG', role: 'sustain', hud: 'gun', spreadPx: 22, icon: 'three-ticks' }),
  ac: Object.freeze({ slot: 2, label: 'AC-30', code: 'AC', role: 'heavy', hud: 'gun', spreadPx: 14, icon: 'thick-bar' }),
  m: Object.freeze({ slot: 3, label: 'MISIL', code: 'MS', role: 'general', hud: 'missile', icon: 'nose-fin' }),
  sw: Object.freeze({ slot: 4, label: 'SWARM-8', code: 'SW', role: 'area', hud: 'swarm', icon: 'dots-8' }),
  rg: Object.freeze({ slot: 5, label: 'RAIL', code: 'RG', role: 'pierce', hud: 'rail', icon: 'line-ring' }),
  tb: Object.freeze({ slot: 6, label: 'NOVA', code: 'NV', role: 'skill', hud: 'nova', icon: 'circle-circle' }),
});

/**
 * MISIL behaviours. Tap = unguided M·M profile. Press-and-hold on a target to
 * lock, release = guided VIPER-X profile. Ammo/cooldown always come from `m`.
 */
export const MISIL = Object.freeze({
  tap: 'm',
  guided: 'vx',
  holdToLock: 0.25,      // s held before the lock sequence starts (shorter = tap)
  lockTime: 0.8,         // s to acquire (HUD progress outline)
  lockRange: 400,        // m
  lockCone: 0.11,        // rad half-angle around the aim ray (≈6°)
  loseGrace: 0.35,       // s a locked target may be occluded before the lock drops
  loseFade: 0.15,        // s of shrink-and-fade after the lock drops
});

/** SWARM multi-lock: one extra target every `step` s, up to 8, wider cone than MISIL. */
export const SWARM_LOCK = Object.freeze({ max: 8, step: 0.12, cone: 0.22, range: 300, homing: 1.3 });

/** Lead pipper (MG, AC, SWARM vs enemies only). */
export const LEAD = Object.freeze({ range: 250, cone: 30 * Math.PI / 180, hold: 0.2, tolerance: 0.006 });

/**
 * Per-weapon FX / feel table. Colours are sRGB hex strings (renderer converts).
 * `shake`: tier name + trauma; `hitstop`: ms applied on kills (or every hit when `any`).
 */
export const WEAPON_FX = Object.freeze({
  mg: Object.freeze({
    tracer: Object.freeze({ every: 3, length: 1.2, width: 0.035, core: '#FFF3D6', edge: '#FFB25A', alpha: 0.9 }),
    muzzle: Object.freeze({ size: 0.35, life: 0.05, casing: true }),
    impact: Object.freeze({ sparks: 6, life: 0.4, decal: [0.15, 0.3] }),
    shake: Object.freeze({ tier: 'T1', trauma: 0.02 }),
    hitstop: null,
    heat: Object.freeze({ perShot: 0.012, cool: 0.34 }),
    spread: 0.012,
    sound: 'mg',
  }),
  ac: Object.freeze({
    tracer: Object.freeze({ every: 1, length: 2.0, width: 0.06, core: '#FFFFFF', edge: '#FF8A3D', alpha: 0.95 }),
    muzzle: Object.freeze({ size: 0.7, life: 0.085, smoke: true }),
    impact: Object.freeze({ sparks: 12, debris: 6, life: 0.8, decal: [0.4, 0.5] }),
    shake: Object.freeze({ tier: 'T1', trauma: 0.03, escalateAt: 10, escalateTier: 'T2', escalateTrauma: 0.06 }),
    hitstop: null,
    heat: Object.freeze({ perShot: 0.03, cool: 0.3 }),
    spread: 0.006,
    sound: 'ac',
  }),
  m: Object.freeze({
    trail: Object.freeze({ puffs: 24, size: 0.9, life: 1.2 }),
    flare: 0.5,
    muzzle: Object.freeze({ size: 0.6, life: 0.09, backblast: true }),
    explosion: 'M',
    shake: Object.freeze({ tier: 'T2', trauma: 0.06 }),
    hitstop: Object.freeze({ kill: 50 }),
    sound: 'misil',
  }),
  sw: Object.freeze({
    trail: Object.freeze({ puffs: 10, size: 0.45, life: 0.8 }),
    flare: 0.3,
    cone: 6 * Math.PI / 180,
    muzzle: Object.freeze({ size: 0.25, life: 0.06 }),
    explosion: 'S',
    shake: Object.freeze({ tier: 'T1', trauma: 0.035, cap: 'T2', budgetHits: 8 }),
    hitstop: null,
    sound: 'swarm',
  }),
  rg: Object.freeze({
    beam: Object.freeze({ width: 0.06, core: '#FFFFFF', edge: '#8FD3FF', life: 0.25, afterglow: 1.2 }),
    charge: 0.35,
    muzzle: Object.freeze({ size: 0.5, life: 0.1, ring: true }),
    impact: Object.freeze({ flash: 0.12, shockwave: 3, hole: true }),
    shake: Object.freeze({ tier: 'T3', trauma: 0.14 }),
    hitstop: Object.freeze({ any: 70 }),
    sound: 'rail',
  }),
  tb: Object.freeze({
    trail: Object.freeze({ puffs: 18, size: 1.4, life: 1.6 }),
    charge: 0.6,
    muzzle: Object.freeze({ size: 0.4, life: 0.1 }),
    explosion: 'XL',
    shake: Object.freeze({ tier: 'T3', trauma: 0.22, rumble: 0.6 }),
    hitstop: Object.freeze({ kill: 80, always: 80 }),
    sound: 'nova',
  }),
});

/** Explosion class from the registry's `big` factor (legacy callers pass 0.5–2.8). */
export function explosionClass(big) {
  const b = finite(big);
  if (b <= 0.95) return 'S';
  if (b < 2.5) return 'M';
  return 'XL';
}

/**
 * Resolve the registry profile a MISIL shot actually flies with.
 * Ammo/cooldown stay with the `m` profile either way.
 */
export function misilProfileKey({ guided = false, target = null } = {}) {
  return guided && target ? MISIL.guided : MISIL.tap;
}

/** Weapons that hold heat (MG/AC). */
export function usesHeat(key) {
  return Boolean(WEAPON_FX[key]?.heat);
}

/** Fire-direction spread half-angle (rad) for gun-class weapons. */
export function gunSpread(key) {
  return WEAPON_FX[key]?.spread ?? 0;
}
