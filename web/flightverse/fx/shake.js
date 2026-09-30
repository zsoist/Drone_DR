// flightverse/fx/shake.js — camera trauma model with tiers and a budget (pure, no Three).
// Spec §5: tiers T1 0.02–0.05, T2 0.06–0.10, T3 0.14–0.22; the ACTIVE trauma is one scalar
// clamped at 0.35 (0 in reduced motion); trauma decays exponentially at 3/s; at most one T3
// per 1.5 s (a second T3 inside the window is downgraded to T2).

export const SHAKE_TIERS = Object.freeze({
  T1: Object.freeze({ min: 0.02, max: 0.05 }),
  T2: Object.freeze({ min: 0.06, max: 0.10 }),
  T3: Object.freeze({ min: 0.14, max: 0.22 }),
});
export const SHAKE_BUDGET = 0.35;
export const SHAKE_DECAY = 3;
export const T3_COOLDOWN = 1.5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createShake({ reduced = () => false, budget = SHAKE_BUDGET, decay = SHAKE_DECAY } = {}) {
  let trauma = 0;
  let clock = 0;
  let lastT3 = -Infinity;
  let rumble = 0;           // seconds left of a sustained low rumble
  let rumbleAmount = 0;
  let fov = 0;
  const stats = { added: 0, downgraded: 0, capped: 0, suppressed: 0 };

  return {
    /**
     * Add trauma of a tier. `attenuation` (0..1) scales by distance. `ceiling`
     * (trauma value) caps what this source may push the total to (SWARM: T2).
     */
    add(tier, amount, { attenuation = 1, ceiling = null } = {}) {
      if (reduced() || budget <= 0) { stats.suppressed += 1; return 0; }
      let t = SHAKE_TIERS[tier] ? tier : 'T1';
      if (t === 'T3') {
        if (clock - lastT3 < T3_COOLDOWN) { t = 'T2'; stats.downgraded += 1; } else lastT3 = clock;
      }
      const range = SHAKE_TIERS[t];
      let add = clamp(amount ?? range.min, range.min, range.max) * clamp(attenuation, 0, 1);
      if (add <= 0) return 0;
      if (ceiling != null) {
        const room = Math.max(0, ceiling - trauma);
        if (add > room) { add = room; stats.capped += 1; }
      }
      const before = trauma;
      trauma = Math.min(budget, trauma + add);
      if (trauma < before + add - 1e-12) stats.capped += 1;
      stats.added += 1;
      const kick = t === 'T3' ? 2.2 : t === 'T2' ? 0.8 : 0;
      fov = Math.max(fov, kick * clamp(attenuation, 0, 1));
      return trauma - before;
    },
    /** Sustained low rumble (NOVA): holds trauma near `amount` (steady state) for `seconds`. */
    rumble(seconds, amount = 0.06) {
      if (reduced()) return;
      rumble = Math.max(rumble, seconds);
      rumbleAmount = Math.max(rumbleAmount, amount);
    },
    step(dt) {
      clock += dt;
      if (rumble > 0) {
        rumble = Math.max(0, rumble - dt);
        trauma = Math.min(budget, trauma + rumbleAmount * decay * dt);   // steady state = rumbleAmount
        if (rumble === 0) rumbleAmount = 0;
      }
      trauma *= Math.exp(-decay * dt);
      if (trauma < 1e-4) trauma = 0;
      fov *= Math.exp(-6 * dt);
      if (fov < 0.02) fov = 0;
      if (reduced()) { trauma = 0; fov = 0; }
      return trauma;
    },
    get trauma() { return trauma; },
    get fov() { return fov; },
    get budget() { return budget; },
    reset() { trauma = 0; fov = 0; rumble = 0; rumbleAmount = 0; lastT3 = -Infinity; },
    stats: () => ({ ...stats, trauma }),
  };
}

/** Camera offsets from trauma: smooth pseudo-noise, angles in rad. Amplitude ∝ trauma. */
export function shakeOffsets(trauma, t) {
  if (trauma <= 0) return { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  const a = trauma * 0.12;
  const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.31 + p * 1.7) * 0.4;
  return {
    yaw: n(37, 0.3) * a,
    pitch: n(41, 1.9) * a,
    roll: n(29, 4.1) * a * 1.2,
    x: n(31, 2.2) * trauma * 0.12,
    y: n(43, 5.3) * trauma * 0.09,
  };
}
