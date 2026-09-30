// flightverse/physics/wind.js — mean wind profile + Dryden low-altitude
// turbulence (MIL-F-8785C / MIL-HDBK-1797) + urban shelter from an injected
// heightAt(x,z). Evaluated at 30 Hz with caching. Deterministic (seeded).
import { createRng, rngGauss, rngCopy } from './rng.js';
import { WIND_PRESETS } from './params.js';

const FT = 0.3048;
export const WIND_HZ = 30;
const DT_W = 1 / WIND_HZ;

function smoothstep(a, b, x) {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * opts: { seed, preset:'calm'|'breezy'|'gusty' | w20, sigmaMul, dirRad,
 *         terrain:'urban'|'open', heightAt(x,z)->m|null, veer:rad }
 * dirRad = direction the wind blows TOWARD, measured from +x toward +z.
 */
export function createWind(opts = {}) {
  const preset = WIND_PRESETS[opts.preset] || null;
  const w = {
    w20: opts.w20 ?? (preset ? preset.w20 : 0.5),
    sigmaMul: opts.sigmaMul ?? (preset ? preset.sigmaMul : 1),
    dir: opts.dirRad ?? 0,
    alpha: (opts.terrain === 'open') ? 0.14 : 0.30,
    veerAmp: opts.veer ?? 0.15,
    heightAt: opts.heightAt || null,
    rng: createRng(opts.seed ?? 1),
    tu: 0, tv: 0, tw: 0,            // turbulence states (u along, v cross, w vertical)
    nextT: 0, started: 0,
    cache: new Float64Array(3),
    // diagnostics of the last update
    shelter: 0, meanSpeed: 0, sigW: 0, sigU: 0,
  };
  return w;
}

export function windCopy(dst, src) {
  dst.tu = src.tu; dst.tv = src.tv; dst.tw = src.tw;
  dst.nextT = src.nextT; dst.started = src.started;
  dst.cache[0] = src.cache[0]; dst.cache[1] = src.cache[1]; dst.cache[2] = src.cache[2];
  rngCopy(dst.rng, src.rng);
}

/** Mean wind speed at agl height h (power law, floor at 1 m). */
export function meanWindSpeed(w, h) {
  const hh = h > 1 ? h : 1;
  return w.w20 * Math.pow(hh / 6, w.alpha);
}

/** Dryden sigmas/scales at agl h (m). Returns via out[0..4] = sigU,sigV(=sigU),sigW,Lu,Lw (m). */
export function drydenParams(w, h, out) {
  const hm = h > 1 ? h : 1;
  const hf = (hm > 1000 * FT ? 1000 * FT : hm) / FT;            // feet, low-altitude model cap 1000 ft
  const sigW = 0.1 * w.w20 * w.sigmaMul;
  const den = 0.177 + 0.000823 * hf;
  const sigU = sigW / Math.pow(den, 0.4);
  const Lw = hf;                                     // ft
  const Lu = hf / Math.pow(den, 1.2);                // ft
  out[0] = sigU; out[1] = sigU; out[2] = sigW; out[3] = Lu * FT; out[4] = Lw * FT;
  return out;
}
const DP = new Float64Array(5);

function marchMaxAngle(hFn, px, py, pz, dx, dz, n, d0, growth) {
  let best = -90, d = d0;
  for (let k = 0; k < n; k++) {
    const hk = hFn(px + dx * d, pz + dz * d);
    const th = Math.atan((hk - py) / d) * 57.29577951308232;
    if (th > best) best = th;
    d *= growth;
  }
  return best;
}

function refresh(w, t, px, py, pz, agl, speed) {
  const h = agl > 1 ? agl : 1;
  let W = meanWindSpeed(w, h);
  // slow veer (deterministic in t) — direction change over minutes
  const dir = w.dir + w.veerAmp * Math.sin(0.07 * t + 0.3);
  const cx = Math.cos(dir), sz = Math.sin(dir);
  let sigMul = 1, along = 1, updraft = 0, speedup = 1, shelter = 0;
  const hFn = w.heightAt;
  if (hFn && W > 0.01) {
    // upwind shading: obstacles upwind of us (march against the wind)
    const maxUp = marchMaxAngle(hFn, px, py, pz, -cx, -sz, 8, 8, 1.5);
    shelter = smoothstep(5, 30, maxUp);
    // windward updraft: obstacle just downwind of us deflects flow upward
    const maxDn = marchMaxAngle(hFn, px, py, pz, cx, sz, 4, 6, 1.6);
    updraft = 0.5 * smoothstep(10, 40, maxDn) * (1 - shelter);
    // street canyon: walls on both cross-wind sides
    const l = marchMaxAngle(hFn, px, py, pz, -sz, cx, 3, 6, 2);
    const r = marchMaxAngle(hFn, px, py, pz, sz, -cx, 3, 6, 2);
    const sc = smoothstep(10, 35, l < r ? l : r);
    speedup = 1 + 0.35 * sc * (1 - shelter);
    sigMul = 1 + 1.5 * shelter;
    along = (1 - 0.8 * shelter) - 0.3 * shelter;    // recirculation can reverse it slightly
  }
  w.shelter = shelter;
  const Wm = W * along * speedup;
  w.meanSpeed = Wm;
  // Dryden per-axis exact first-order update
  drydenParams(w, h, DP);
  const vref = speed > 5 ? speed : 5;
  const au = Math.exp(-vref * DT_W / DP[3]);
  const aw = Math.exp(-vref * DT_W / DP[4]);
  const su = DP[0] * sigMul, sw = DP[2] * sigMul;
  w.tu = au * w.tu + Math.sqrt(1 - au * au) * su * rngGauss(w.rng);
  w.tv = au * w.tv + Math.sqrt(1 - au * au) * su * rngGauss(w.rng);
  w.tw = aw * w.tw + Math.sqrt(1 - aw * aw) * sw * rngGauss(w.rng);
  w.sigU = su; w.sigW = sw;
  const u = Wm + w.tu, v = w.tv;
  w.cache[0] = u * cx - v * sz;
  w.cache[1] = w.tw + updraft * (W > 0 ? W : 0);
  w.cache[2] = u * sz + v * cx;
}

/**
 * Wind velocity (world) at time t. Recomputes at 30 Hz, otherwise returns the
 * cached vector. out: array-like [x,y,z]. agl = height above ground (m),
 * speed = ground speed of the vehicle (Vref for the Dryden filter).
 */
export function sampleWind(w, t, px, py, pz, agl, speed, out) {
  if (!w.started) { w.started = 1; w.nextT = t; }
  if (t >= w.nextT - 1e-9) {
    refresh(w, t, px, py, pz, agl, speed);
    w.nextT += DT_W;
    if (w.nextT <= t) w.nextT = t + DT_W;      // resync after a long gap
  }
  out[0] = w.cache[0]; out[1] = w.cache[1]; out[2] = w.cache[2];
  return out;
}
