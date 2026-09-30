// flightverse/fx/hitstop.js — hit-stop window (pure). Kills and Explosion M/XL only (see
// WEAPON_FX.hitstop). Time scale 0.05 for 40/60/80 ms. Audio is not affected. Reduced motion skips.
// It runs on REAL time: step(realDt) every render frame; the loop multiplies its dt by scale().

export const HITSTOP_MS = Object.freeze({ S: 40, M: 60, XL: 80 });
export const HITSTOP_SCALE = 0.05;
export const HITSTOP_COOLDOWN = 0.18;    // s of real time between two stops (8 swarm kills ≠ a freeze)

export function createHitStop({ reduced = () => false } = {}) {
  let remaining = 0;
  let cooldown = 0;
  const stats = { requested: 0, applied: 0, rejected: 0, lastMs: 0, totalMs: 0 };
  return {
    request(ms) {
      stats.requested += 1;
      if (reduced() || !(ms > 0)) { stats.rejected += 1; return false; }
      if (cooldown > 0 && remaining <= 0) { stats.rejected += 1; return false; }
      const s = ms / 1000;
      if (s > remaining) remaining = s;
      cooldown = HITSTOP_COOLDOWN + remaining;
      stats.applied += 1;
      stats.lastMs = ms;
      stats.totalMs += ms;
      return true;
    },
    step(realDt) {
      if (remaining > 0) remaining = Math.max(0, remaining - realDt);
      if (cooldown > 0) cooldown = Math.max(0, cooldown - realDt);
    },
    scale() { return remaining > 0 ? HITSTOP_SCALE : 1; },
    get active() { return remaining > 0; },
    get remainingMs() { return remaining * 1000; },
    stats: () => ({ ...stats }),
    reset() { remaining = 0; cooldown = 0; },
  };
}

/**
 * Which stop (ms) an event earns, or 0. `kill`: a target died. `hit`: anything was hit.
 * Explosion M/XL that damages nothing (terrain) does not stop time, except XL.
 */
export function hitStopFor({ weaponFx = null, size = null, kill = false, hit = false, damaged = false } = {}) {
  const hs = weaponFx?.hitstop || null;
  let ms = 0;
  if (hs?.any && hit) ms = Math.max(ms, hs.any);
  if (hs?.always && size === 'XL') ms = Math.max(ms, hs.always);
  if (kill) ms = Math.max(ms, hs?.kill ?? HITSTOP_MS[size || 'S']);
  if (!kill && (size === 'M' || size === 'XL') && damaged) ms = Math.max(ms, HITSTOP_MS[size]);
  return ms;
}
