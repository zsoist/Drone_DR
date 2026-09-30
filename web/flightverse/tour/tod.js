// flightverse/tour/tod.js — HORA DEL DÍA (WS E). Datos + matemática pura (sin DOM, sin three).
// Presets discretos (dia · dorada · atardecer · noche) y un continuo por ELEVACIÓN SOLAR
// (-5°..70°, el slider del modo foto): todos salen de la misma tabla de keyframes interpolada.
// Cada juego de parámetros lleva cielo + luces (los consume sky.js) y GRADE (lo consume
// tour/grade.js): el foto-real/malla/splat son unlit, así que la hora se "hornea" en el grade.
// Probado en pipeline/test_tour_tod.mjs.

export const TOD_ELEVATION = Object.freeze({ dia: 55, dorada: 8, atardecer: 2, noche: -30 });
export const TOD_ALIASES = Object.freeze({ golden: 'dorada', day: 'dia', dusk: 'atardecer', night: 'noche' });
export const TOD_LABELS = Object.freeze({ dia: 'Día', dorada: 'Dorada', atardecer: 'Atardecer', noche: 'Noche' });
export const ELEV_MIN = -5, ELEV_MAX = 70;

const C = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const toHex = c => (Math.round(Math.max(0, Math.min(1, c[0])) * 255) << 16)
  | (Math.round(Math.max(0, Math.min(1, c[1])) * 255) << 8)
  | Math.round(Math.max(0, Math.min(1, c[2])) * 255);

// colores = [r,g,b] 0..1 lineales-sRGB "de pintor" (se mezclan tal cual); números se mezclan directo.
const K = (elev, v) => ({ elev, ...v });
const KEYS = [
  K(-30, {
    top: C(0x050810), mid: C(0x0b1526), horizon: C(0x1a2839), midPos: 0.32, topPos: 0.9,
    sun: C(0x000000), sunSize: 340, sunI: 0.85, sunTint: C(0xbdd4ff), ambient: 0.62, hemi: 0.26,
    stars: 1.1, moon: 1, galaxy: 0.5, clouds: 0.18, cloudTint: C(0x8fa5c2), scatter: 0,
    // grade de noche: frío azulado, ev -0.45 y piso de sombras: NO negro (spec §10: ambient floor)
    tint: [0.50, 0.66, 1.0], ev: -0.40, sat: 0.82, lift: [0.014, 0.022, 0.040], glow: 1.6,
  }),
  K(-12, {
    top: C(0x0a1024), mid: C(0x1d2446), horizon: C(0x4a4a72), midPos: 0.26, topPos: 0.8,
    sun: C(0x5a4a66), sunSize: 300, sunI: 0.75, sunTint: C(0xb4c4ef), ambient: 0.6, hemi: 0.28,
    stars: 0.85, moon: 0.75, galaxy: 0.3, clouds: 0.22, cloudTint: C(0x8a8fb8), scatter: 0.12,
    tint: [0.62, 0.72, 1.0], ev: -0.30, sat: 0.88, lift: [0.014, 0.020, 0.036], glow: 1.4,
  }),
  K(-5, {
    top: C(0x16204a), mid: C(0x3a3d76), horizon: C(0xb27f8c), midPos: 0.18, topPos: 0.62,
    sun: C(0xff8a5a), sunSize: 160, sunI: 0.7, sunTint: C(0xc8b4ee), ambient: 0.58, hemi: 0.3,
    stars: 0.35, moon: 0.25, galaxy: 0.08, clouds: 0.4, cloudTint: C(0xc48fa2), scatter: 0.5,
    tint: [0.80, 0.80, 1.02], ev: -0.18, sat: 0.96, lift: [0.010, 0.012, 0.022], glow: 1.0,
  }),
  K(2, {
    top: C(0x2b3a72), mid: C(0x9a7290), horizon: C(0xe5a079), midPos: 0.16, topPos: 0.55,
    sun: C(0xffc985), sunSize: 190, sunI: 1.0, sunTint: null, ambient: 0.6, hemi: 0.4,
    stars: 0.14, moon: 0, galaxy: 0, clouds: 0.5, cloudTint: C(0xffa97e), scatter: 0.36,
    tint: [1.10, 0.86, 0.76], ev: -0.10, sat: 1.06, lift: [0.004, 0.003, 0.006], glow: 0.4,
  }),
  K(8, {
    top: C(0x2a5cb0), mid: C(0x86a6d6), horizon: C(0xf2cba6), midPos: 0.26, topPos: 0.62,
    sun: C(0xffc98a), sunSize: 230, sunI: 1.4, sunTint: null, ambient: 0.74, hemi: 0.5,
    stars: 0, moon: 0, galaxy: 0, clouds: 0.55, cloudTint: C(0xffd9b4), scatter: 0.42,
    tint: [1.05, 0.98, 0.89], ev: 0.10, sat: 1.06, lift: [0.002, 0.002, 0.003], glow: 0.0,
  }),
  K(22, {
    top: C(0x2d62b2), mid: C(0x8db6e6), horizon: C(0xf0e6d8), midPos: 0.20, topPos: 0.6,
    sun: C(0xfff0cf), sunSize: 300, sunI: 1.3, sunTint: null, ambient: 0.8, hemi: 0.5,
    stars: 0, moon: 0, galaxy: 0, clouds: 0.55, cloudTint: C(0xfff0e0), scatter: 0.12,
    tint: [1.03, 0.99, 0.93], ev: 0.0, sat: 1.04, lift: [0, 0, 0], glow: 0.0,
  }),
  K(55, {
    top: C(0x2456a8), mid: C(0x7fb0e8), horizon: C(0xdcebf8), midPos: 0.22, topPos: 0.6,
    sun: C(0xfff4d6), sunSize: 340, sunI: 1.25, sunTint: null, ambient: 0.85, hemi: 0.45,
    stars: 0, moon: 0, galaxy: 0, clouds: 0.55, cloudTint: C(0xffffff), scatter: 0.08,
    tint: [1, 1, 1], ev: 0.0, sat: 1.0, lift: [0, 0, 0], glow: 0.0,
  }),
];
export const TOD_KEYFRAMES = KEYS;

const NUM_FIELDS = ['midPos', 'topPos', 'sunSize', 'sunI', 'ambient', 'hemi', 'stars', 'moon', 'galaxy',
  'clouds', 'scatter', 'ev', 'sat', 'glow'];
const COL_FIELDS = ['top', 'mid', 'horizon', 'sun', 'cloudTint', 'tint', 'lift'];

const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const smooth = k => k * k * (3 - 2 * k);

export function resolveTodKey(key) {
  const k = TOD_ALIASES[key] || key;
  return Object.prototype.hasOwnProperty.call(TOD_ELEVATION, k) ? k : null;
}

/** Elevación solar (°) de un preset o número. Desconocido -> null. */
export function elevationOf(keyOrElev) {
  if (typeof keyOrElev === 'number' && Number.isFinite(keyOrElev)) return keyOrElev;
  const k = resolveTodKey(keyOrElev);
  return k ? TOD_ELEVATION[k] : null;
}

/** Preset discreto más cercano a una elevación (para etiquetas/eventos `tod`). */
export function nearestTodKey(elev) {
  let best = 'dia', d = Infinity;
  for (const [k, e] of Object.entries(TOD_ELEVATION)) {
    const dd = Math.abs(e - elev);
    if (dd < d) { d = dd; best = k; }
  }
  return best;
}

/** Azimut del sol (°, desde el norte, horario): poniente con el sol bajo, más al sur/cenit arriba. */
export function sunAzimuthDeg(elev) {
  const k = smooth(Math.max(0, Math.min(1, (elev - 8) / 47)));
  return lerp(252, 165, k);
}

/** Dirección unitaria al sol (marco escena: +x este, +y arriba, -z norte). */
export function sunDirection(elev, azDeg = sunAzimuthDeg(elev)) {
  const e = elev * Math.PI / 180, a = azDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

/**
 * Parámetros interpolados a una elevación (se satura a [-30, 55] -> sólo los presets extremos).
 * Devuelve { elev, key, colors como [r,g,b] 0..1 + hex, nums..., sunDir, moonDir, grade:{tint,ev,sat,lift,glow} }.
 */
export function todParams(keyOrElev) {
  let elev = elevationOf(keyOrElev);
  if (elev == null) elev = TOD_ELEVATION.dia;
  const e = Math.max(KEYS[0].elev, Math.min(KEYS[KEYS.length - 1].elev, elev));
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].elev) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = Math.max(0, Math.min(1, (e - a.elev) / (b.elev - a.elev)));
  const out = { elev, key: typeof keyOrElev === 'string' ? resolveTodKey(keyOrElev) : nearestTodKey(elev) };
  for (const f of NUM_FIELDS) out[f] = lerp(a[f], b[f], k);
  for (const f of COL_FIELDS) out[f] = lerp3(a[f], b[f], k);
  // sunTint (luz direccional): si alguno de los dos no tiene, usa el color del sol
  const ta = a.sunTint || a.sun, tb = b.sunTint || b.sun;
  out.sunTint = lerp3(ta, tb, k);
  out.hex = {};
  for (const f of ['top', 'mid', 'horizon', 'sun', 'cloudTint', 'sunTint']) out.hex[f] = toHex(out[f]);
  out.sunDir = sunDirection(Math.max(elev, -2));                // bajo el horizonte el "sol" se queda en él
  out.moonDir = [-0.92, 0.16, -0.33];
  // luna = luz direccional cuando moon > 0.5 (la luz REAL de noche, como antes)
  out.lightDir = out.moon > 0.5 ? out.moonDir : out.sunDir;
  out.grade = { tint: out.tint, ev: out.ev, sat: out.sat, lift: out.lift, glow: out.glow };
  return out;
}

/** Luminancia media esperada de un grade sobre un gris medio (0.18 lineal): gate "noche usable". */
export function gradeGain(grade) {
  const lum = 0.2126 * grade.tint[0] + 0.7152 * grade.tint[1] + 0.0722 * grade.tint[2];
  return lum * Math.pow(2, grade.ev);
}
