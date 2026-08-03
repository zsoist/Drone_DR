// Pure data and fixed-step helpers for the nine-weapon Flightverse arsenal.
// This module has no DOM or Three dependency so every behavior is testable.

const freezeProfile = profile => Object.freeze({ ...profile });

export const WEAPON_PROFILES = Object.freeze({
  mg: freezeProfile({
    kind: 'bullet', label: 'MG', code: 'MG', auto: true, rate: 0.085,
    max: 120, regen: 12, speed: 150, dmg: 14,
    model: null, effect: 'kinetic',
  }),
  s: freezeProfile({
    kind: 'missile', label: 'M·S', code: 'M·S', cd: 0.4,
    max: 12, regen: 0.55, speed: 74, dmg: 360,
    big: 0.75, radius: 0.1, proximity: 1.2,
    model: null, effect: 'missile-light',
  }),
  m: freezeProfile({
    kind: 'missile', label: 'M·M', code: 'M·M', cd: 0.9,
    max: 8, regen: 0.4, speed: 56, dmg: 900,
    big: 1.25, radius: 0.16, proximity: 1.8,
    model: null, effect: 'missile-medium',
  }),
  l: freezeProfile({
    kind: 'missile', label: 'M·L', code: 'M·L', cd: 2.2,
    max: 3, regen: 0.12, speed: 42, dmg: 1200,
    big: 2.2, radius: 0.25, proximity: 3,
    model: null, effect: 'missile-heavy',
  }),
  ac: freezeProfile({
    kind: 'bullet', label: 'AC-30', code: 'AC', auto: true, rate: 0.16,
    max: 48, regen: 2.4, speed: 125, dmg: 48,
    model: 'ac30_cannon', effect: 'kinetic-heavy',
  }),
  sw: freezeProfile({
    kind: 'swarm', label: 'SWARM-8', code: 'SW', cd: 3.2,
    max: 4, regen: 0.08, count: 8, interval: 0.085,
    speed: 68, dmg: 95, big: 0.48, radius: 0.07, proximity: 0.8,
    model: 'swarm8_pod', effect: 'micro-rocket',
  }),
  vx: freezeProfile({
    kind: 'guided', label: 'VIPER-X', code: 'VX', cd: 2.8,
    max: 4, regen: 0.1, speed: 62, turnRate: 1.9,
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
