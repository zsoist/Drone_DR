// flightverse/fx/hitstop.js — hit-stop window (pure). Kills and Explosion M/XL only (see
// WEAPON_FX.hitstop). Time scale 0.05 for 40/60/80 ms. Audio is not affected. Reduced motion skips.
// scale() is eased (continuous); runtime.js feeds it to the step accumulator (loop-step.js), no steps are skipped.
// It runs on REAL time: step(realDt) every render frame; the loop multiplies its dt by scale().

export const HITSTOP_MS = Object.freeze({ S: 40, M: 60, XL: 80 });
export const HITSTOP_SCALE = 0.05;
export const HITSTOP_EASE_IN = 0.016;    // s: 1 -> 0.05 (smoothstep), so the drone decelerates instead of snapping
export const HITSTOP_EASE_OUT = 0.024;   // s: 0.05 -> 1, capped at 40 % of the window
export const HITSTOP_COOLDOWN = 0.18;    // s of real time between two stops (8 swarm kills ≠ a freeze)

export function createHitStop({ reduced = () => false } = {}) {
  let remaining = 0;
  let total = 0;
  let lastDt = 1 / 60;
  let cooldown = 0;
  const stats = { requested: 0, applied: 0, rejected: 0, lastMs: 0, totalMs: 0 };
  return {
    request(ms) {
      stats.requested += 1;
      if (reduced() || !(ms > 0)) { stats.rejected += 1; return false; }
      if (cooldown > 0 && remaining <= 0) { stats.rejected += 1; return false; }
      const s = ms / 1000;
      if (s > remaining) { remaining = s; total = s; }
      cooldown = HITSTOP_COOLDOWN + remaining;
      stats.applied += 1;
      stats.lastMs = ms;
      stats.totalMs += ms;
      return true;
    },
    step(realDt) {
      if (realDt > 0) lastDt = Math.min(0.1, realDt);
      if (remaining > 0) remaining = Math.max(0, remaining - realDt);
      if (cooldown > 0) cooldown = Math.max(0, cooldown - realDt);
    },
    // Eased time scale, AVERAGED over the next frame (`lastDt`): the loop samples it once per frame, so a point sample of a
    // 16 ms ramp would still look like a step. Continuous and integrable: the sim keeps exact steps, presentation is smooth.
    scale() {
      if (remaining <= 0) return 1;
      const prof = rem => {
        if (rem <= 0) return 1;
        const tin = Math.min(HITSTOP_EASE_IN, total * 0.25), tout = Math.min(HITSTOP_EASE_OUT, total * 0.4);
        const sm = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
        const f = Math.min(tin > 0 ? sm((total - rem) / tin) : 1, tout > 0 ? sm(rem / tout) : 1);
        return 1 - (1 - HITSTOP_SCALE) * f;
      };
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += prof(remaining - lastDt * (k + 0.5) / 8);
      return sum / 8;
    },
    get active() { return remaining > 0; },
    get remainingMs() { return remaining * 1000; },
    stats: () => ({ ...stats }),
    reset() { remaining = 0; total = 0; cooldown = 0; },
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
