// flightverse/audio/recipes.js — declarative synth recipes for ?fv=2 (spec §12).
// Pure data. audio.js plays them through WebAudio; audio/render.js renders the same data
// offline so tests can measure spectral centroids (acceptance: one fingerprint per weapon).
//
// layer: { src:'noise'|'osc', wave?, f:[f0,f1] (Hz, exponential sweep), filter?:{type,f:[f0,f1],q},
//          a (attack s), d (decay s), gain, t (start offset s), tail?:true (reverb-send layer) }
const L = (o) => Object.freeze({ t: 0, a: 0.001, gain: 1, ...o });

/** Nominal spectral centroid (Hz) per weapon fire sound, from the spec table. */
export const CENTROID_TARGET = Object.freeze({ mg: 3000, ac: 1200, misil: 400, swarm: 2000, rail: 8000, nova: 45 });

export const FIRE = Object.freeze({
  // crack 90 ms + body 60 ms + tail 250 ms
  mg: Object.freeze({
    pitchJitter: 0.04, priority: 1, level: 1,
    layers: Object.freeze([
      L({ src: 'noise', filter: { type: 'bandpass', f: [1500, 1500], q: 1.0 }, d: 0.09, gain: 0.62 }),
      L({ src: 'osc', wave: 'sawtooth', f: [300, 110], d: 0.06, gain: 0.05, filter: { type: 'lowpass', f: [2400, 2400], q: 0.7 } }),
      L({ src: 'noise', filter: { type: 'bandpass', f: [1500, 1500], q: 0.7 }, d: 0.25, a: 0.02, gain: 0.05, tail: true }),
    ]),
  }),
  // low thump + metallic crack + mechanical ring-down 400 ms
  ac: Object.freeze({
    pitchJitter: 0.03, priority: 1, level: 1,
    layers: Object.freeze([
      L({ src: 'osc', wave: 'sine', f: [95, 48], d: 0.12, gain: 0.30 }),
      L({ src: 'noise', filter: { type: 'bandpass', f: [1250, 1250], q: 1.3 }, d: 0.07, gain: 0.9 }),
      L({ src: 'osc', wave: 'sine', f: [1250, 1250], d: 0.4, gain: 0.06, t: 0.004 }),
      L({ src: 'osc', wave: 'sine', f: [2100, 2100], d: 0.3, gain: 0.03, t: 0.004 }),
    ]),
  }),
  // launch whoosh (rising/falling body), Doppler loop handled by audio.js while the rocket flies
  misil: Object.freeze({
    pitchJitter: 0.02, priority: 2, level: 0.8,
    layers: Object.freeze([
      L({ src: 'noise', filter: { type: 'bandpass', f: [320, 112], q: 2.5 }, d: 0.55, a: 0.02, gain: 0.85 }),
      L({ src: 'osc', wave: 'sawtooth', f: [190, 85], d: 0.4, a: 0.02, gain: 0.06, filter: { type: 'lowpass', f: [600, 300], q: 0.8 } }),
    ]),
  }),
  // one pop; audio.js steps pitch +2 semitones per rocket
  swarm: Object.freeze({
    pitchJitter: 0.0, priority: 1, level: 0.85,
    layers: Object.freeze([
      L({ src: 'noise', filter: { type: 'bandpass', f: [1400, 1400], q: 1.2 }, d: 0.07, gain: 0.85 }),
      L({ src: 'osc', wave: 'sine', f: [620, 300], d: 0.08, gain: 0.08 }),
    ]),
  }),
  // electric crack 8 kHz + 60 Hz sub
  rail: Object.freeze({
    pitchJitter: 0.0, priority: 2, level: 0.055,
    layers: Object.freeze([
      L({ src: 'noise', filter: { type: 'bandpass', f: [8600, 8600], q: 0.7 }, d: 0.11, gain: 16 }),
      L({ src: 'osc', wave: 'sine', f: [62, 46], d: 0.3, gain: 0.25, t: 0.006 }),
    ]),
  }),
  // drop clunk + sub 45 Hz (the boom is the explosion recipe)
  nova: Object.freeze({
    pitchJitter: 0.0, priority: 3, level: 1,
    layers: Object.freeze([
      L({ src: 'osc', wave: 'sine', f: [52, 40], d: 0.7, a: 0.01, gain: 0.9 }),
      L({ src: 'noise', filter: { type: 'lowpass', f: [220, 160], q: 0.7 }, d: 0.12, gain: 0.06 }),
    ]),
  }),
});

/** MISIL in flight: a short rising rocket-motor loop layered on the launch whoosh. */
export const FLIGHT = Object.freeze({
  misil: Object.freeze([
    L({ src: 'osc', wave: 'sawtooth', f: [110, 240], d: 0.9, a: 0.08, gain: 0.05, filter: { type: 'lowpass', f: [420, 900], q: 0.8 } }),
    L({ src: 'noise', filter: { type: 'bandpass', f: [500, 900], q: 1.0 }, d: 0.9, a: 0.1, gain: 0.25 }),
  ]),
});

/** Charge sounds (RAIL 350 ms rise, NOVA 600 ms siren): `rise` is a swept oscillator. */
export const CHARGE = Object.freeze({
  rg: Object.freeze({
    layers: Object.freeze([
      L({ src: 'osc', wave: 'sawtooth', f: [260, 3400], d: 0.35, a: 0.03, gain: 0.07, filter: { type: 'lowpass', f: [900, 6000], q: 1.2 } }),
      L({ src: 'osc', wave: 'sine', f: [1200, 5200], d: 0.35, a: 0.05, gain: 0.04 }),
    ]),
  }),
  tb: Object.freeze({
    layers: Object.freeze([
      L({ src: 'osc', wave: 'sawtooth', f: [420, 780], d: 0.3, a: 0.02, gain: 0.08, filter: { type: 'lowpass', f: [1400, 1400], q: 0.8 } }),
      L({ src: 'osc', wave: 'sawtooth', f: [780, 420], d: 0.3, a: 0.02, gain: 0.08, t: 0.3, filter: { type: 'lowpass', f: [1400, 1400], q: 0.8 } }),
    ]),
  }),
});

/** Explosion: sub thump + crack + (debris rain scheduled by audio.js). Sizes S / M / XL. */
export const EXPLOSION = Object.freeze({
  S: Object.freeze({ thump: [72, 46, 0.22], thumpGain: 0.5, crack: [0.05, 0.6], rain: [0.5, 0.18], duckDb: 0, lp: 6000, priority: 1 }),
  M: Object.freeze({ thump: [66, 40, 0.32], thumpGain: 0.75, crack: [0.06, 0.8], rain: [1.0, 0.3], duckDb: 6, lp: 5200, priority: 2 }),
  XL: Object.freeze({ thump: [58, 32, 0.6], thumpGain: 1.0, crack: [0.08, 0.95], rain: [1.2, 0.4], duckDb: 9, lp: 4200, priority: 3 }),
});

export const IMPACT = Object.freeze({
  concrete: Object.freeze({ f: 1900, q: 0.8, d: 0.06, gain: 0.26 }),
  ground: Object.freeze({ f: 600, q: 0.6, d: 0.09, gain: 0.3 }),
  metal: Object.freeze({ f: 3600, q: 2.2, d: 0.08, gain: 0.3, ring: 2400 }),
  foliage: Object.freeze({ f: 4800, q: 0.5, d: 0.07, gain: 0.16 }),
  body: Object.freeze({ f: 420, q: 0.9, d: 0.07, gain: 0.3 }),
  energy: Object.freeze({ f: 2600, q: 1.6, d: 0.06, gain: 0.26 }),
});

/** Default bus gains (spec §12). */
export const BUS_GAINS = Object.freeze({ master: 0.85, engine: 0.5, sfx: 0.8, ui: 0.7, music: 0.35, amb: 0.3 });

export const DUCK = Object.freeze({ attack: 0.02, release: 0.6, targets: Object.freeze(['engine', 'music', 'amb']) });

/** Kill confirm: E5 then B5, 70 ms each; +1 semitone per consecutive kill up to +6; reset after 3 s. */
export const KILL = Object.freeze({ f1: 659.25, f2: 987.77, dur: 0.07, maxStep: 6, reset: 3 });
export const HIT_TICK = Object.freeze({ f: 1800, dur: 0.02 });

export function killPitch(streak) {
  const step = Math.min(KILL.maxStep, Math.max(0, streak - 1));
  return Math.pow(2, step / 12);
}

/** Streak tracker: pure so the pitch-stepping contract is testable. */
export function createKillStreak(reset = KILL.reset) {
  let streak = 0;
  let last = -Infinity;
  return {
    hit(now) {
      streak = now - last > reset ? 1 : streak + 1;
      last = now;
      return { streak, pitch: killPitch(streak) };
    },
    get streak() { return streak; },
  };
}

/** Lock tone beep rate (Hz) from acquisition progress: 3 -> 12. */
export function lockBeepRate(progress) {
  return 3 + 9 * Math.min(1, Math.max(0, progress));
}

/** dB -> linear. */
export const dbToGain = db => Math.pow(10, -Math.abs(db) / 20);

/** Distance model: 1/(1+d/30) gain, lowpass by air absorption, delay d/343 capped at 1 s. */
export function distanceModel(d) {
  const dist = Math.max(0, d || 0);
  return {
    gain: 1 / (1 + dist / 30),
    lowpass: Math.max(700, 9000 / (1 + dist / 60)),
    delay: Math.min(1, dist / 343),
  };
}

/** Rotor / wind mapping from physics v2 motor speeds (normalised omega 0..1) and airspeed. */
export function engineFromMotors(m, airspeed, gust = 0, integrity = 1) {
  const list = Array.from(m || [0.4, 0.4, 0.4, 0.4]);
  const mean = list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  const freqs = list.map(w => 70 + Math.max(0, Math.min(1.2, w)) * 150);
  const load = Math.min(1, Math.max(0, (mean - 0.25) / 0.6));
  const wind = Math.min(0.22, airspeed * airspeed * 0.00016 + gust * 0.02);
  return { freqs, load, wind, windFreq: 400 + airspeed * 30, stutter: integrity < 0.2 ? 1 : integrity < 0.4 ? 0.4 : 0, mean };
}
