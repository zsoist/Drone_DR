// flightverse/input/curves.js — pure input shaping and persisted control settings
// (WS C). No DOM, no three: node tests import this file directly.
//
// Spec 6: stick dead zone 9 %, expo 0.35, v = sign(x)(|x|(1-e) + e x^3); look zone
// 0.22 deg/px (0.10-0.45), expo 0.25, inertia 90 ms; gamepad dead zone 0.10 / expo 0.30;
// mouse 0.0022 rad/px yaw, 0.0018 pitch (x0.5-2), invert Y.

export const CONTROL_DEFAULTS = Object.freeze({
  deadzone: 0.09,          // floating stick, fraction of the radius (8-10 % per spec)
  expo: 0.35,              // floating stick expo
  lookSens: 0.22,          // degrees per pixel of drag in the look zone (0.10-0.45)
  lookExpo: 0.25,
  lookInertiaMs: 90,
  mouseSens: 1,            // multiplier over 0.0022 / 0.0018 rad per px (0.5-2)
  invertY: false,
  leftHanded: false,       // swap move / look zones
  mode2: false,            // RC Mode 2: left = throttle+yaw, right = move
  autoFire: false,         // fire at the reticle while the look zone is touched
  haptics: true,
  padDeadzone: 0.10,
  padExpo: 0.30,
  fpvTiltDeg: 28,          // FPV camera uptilt (25-30)
});

export const CONTROL_LIMITS = Object.freeze({
  deadzone: [0.05, 0.2], expo: [0, 0.8], lookSens: [0.10, 0.45], lookExpo: [0, 0.6],
  lookInertiaMs: [0, 250], mouseSens: [0.5, 2], padDeadzone: [0.02, 0.3], padExpo: [0, 0.8],
  fpvTiltDeg: [25, 30],
});

export const STORAGE_KEY = 'ab.fv.controls';

export const clamp = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));

/** Validate + clamp a (possibly partial / corrupt) settings object onto the defaults. */
export function normalizeSettings(raw) {
  const out = { ...CONTROL_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(CONTROL_DEFAULTS)) {
    if (!(key in raw)) continue;
    const def = CONTROL_DEFAULTS[key];
    const value = raw[key];
    if (typeof def === 'boolean') {
      out[key] = Boolean(value);
    } else {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      const lim = CONTROL_LIMITS[key];
      out[key] = lim ? clamp(n, lim[0], lim[1]) : n;
    }
  }
  return out;
}

export function loadSettings(storage) {
  try {
    const text = storage?.getItem?.(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(storage, settings) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Radial dead zone + expo on a stick vector (x, y in [-1, 1], |v| <= 1 after clamping).
 * The magnitude m is rescaled ((m - dz) / (1 - dz)) so there is no jump at the edge of the
 * dead zone, then shaped with m' = m (1 - e) + e m^3. Direction is preserved.
 * Returns out = [x', y']. Along one axis this is exactly sign(x)(|x|(1-e) + e x^3).
 */
export function stickCurve(x, y, deadzone, expo, out = [0, 0]) {
  let m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; m = 1; }
  if (m <= deadzone || m < 1e-9) { out[0] = 0; out[1] = 0; return out; }
  const r = (m - deadzone) / (1 - deadzone);
  const shaped = r * (1 - expo) + expo * r * r * r;
  const k = shaped / m;
  out[0] = x * k; out[1] = y * k;
  return out;
}

/** One-axis convenience (gamepad triggers / axes). */
export function axisCurve(x, deadzone, expo) {
  const a = Math.abs(x);
  if (a <= deadzone) return 0;
  const r = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(x) * (r * (1 - expo) + expo * r * r * r);
}

/**
 * Look-drag shaping. `d` is the pixel delta of one sample, `ref` the delta that counts as a
 * "fast" drag (px); slow drags stay linear (precise aim), fast drags are amplified by expo.
 */
export function lookCurve(d, expo, ref = 28) {
  const a = Math.abs(d);
  const k = Math.min(2.2, (1 - expo) + expo * (a / ref) * (a / ref));   // capped: a flick never explodes
  return d * k;
}

/** Look inertia: exponential decay of the release velocity. Returns the new velocity. */
export function inertiaDecay(v, dtMs, tauMs) {
  if (tauMs <= 0) return 0;
  return v * Math.exp(-dtMs / tauMs);
}

export const DEG = Math.PI / 180;
/** Mouse-look pixels -> radians (yaw, pitch). Pitch sign: moving the mouse up looks up. */
export function mouseLook(dx, dy, settings) {
  const s = settings.mouseSens;
  return {
    yaw: -dx * 0.0022 * s,                              // + = turn left (legacy yaw convention)
    pitch: -dy * 0.0018 * s * (settings.invertY ? -1 : 1),
  };
}
