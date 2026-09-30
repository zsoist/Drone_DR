// flightverse/ui/prefs.js — preferencias del jugador (WS A). Módulo PURO (sin DOM salvo
// `applyToDocument`): testeable en node. Persistencia en localStorage 'ab_fv_prefs'.
// Otros workstreams leen ctx.ui.prefs.get(key) y escuchan bus 'prefs' {key, value}.
export const PREFS_KEY = 'ab_fv_prefs';
export const PREF_DEFAULTS = Object.freeze({
  textScale: 100,          // 100 | 115 | 130 (% del texto de menús)
  reducedMotion: 'auto',   // 'auto' (prefers-reduced-motion) | 'on' | 'off'
  vibration: true,
  leftHanded: false,
  rcMode2: false,          // RC Mode 2: acelerador/guiñada a la izquierda
  autoFire: false,         // disparo automático mientras se toca la zona de mirar
  invertY: false,
  lookSens: 1,             // x0.5 .. x2
  expo: 0.35,              // 0 .. 0.6
  holdBoost: true,         // true = mantener, false = alternar
  holdFire: true,
  windPreset: 'brisa',     // calmo | brisa | racheado
  volMaster: 0.85, volSfx: 0.8, volMusic: 0.35,
});
const ENUMS = {
  textScale: [100, 115, 130],
  reducedMotion: ['auto', 'on', 'off'],
  windPreset: ['calmo', 'brisa', 'racheado'],
};
const RANGES = { lookSens: [0.5, 2], expo: [0, 0.6], volMaster: [0, 1], volSfx: [0, 1], volMusic: [0, 1] };

/** Normaliza un valor según el tipo/rango de la preferencia; devuelve el default si es inválido. */
export function sanitizePref(key, value) {
  if (!(key in PREF_DEFAULTS)) return undefined;
  const def = PREF_DEFAULTS[key];
  if (ENUMS[key]) {
    const v = typeof def === 'number' ? Number(value) : value;
    return ENUMS[key].includes(v) ? v : def;
  }
  if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
  if (RANGES[key]) {
    const n = Number(value);
    if (!Number.isFinite(n)) return def;
    return Math.min(RANGES[key][1], Math.max(RANGES[key][0], n));
  }
  return def;
}

export function loadPrefs(storage) {
  const out = { ...PREF_DEFAULTS };
  try {
    const raw = JSON.parse(storage?.getItem(PREFS_KEY) || '{}');
    for (const k of Object.keys(PREF_DEFAULTS)) if (k in raw) out[k] = sanitizePref(k, raw[k]);
  } catch { /* JSON corrupto o almacenamiento bloqueado: defaults */ }
  return out;
}

/** True si el movimiento debe reducirse (preferencia del juego, o la del sistema en 'auto'). */
export function resolveReducedMotion(pref, systemReduced) {
  return pref === 'on' ? true : pref === 'off' ? false : !!systemReduced;
}

export function createPrefs({ storage = globalThis.localStorage, bus = null, systemReduced = () => false } = {}) {
  const values = loadPrefs(storage);
  const listeners = new Set();
  const persist = () => { try { storage?.setItem(PREFS_KEY, JSON.stringify(values)); } catch { /* cuota / privado */ } };
  const api = {
    get: key => values[key],
    all: () => ({ ...values }),
    set(key, value) {
      const v = sanitizePref(key, value);
      if (v === undefined || values[key] === v) return values[key];
      values[key] = v;
      persist();
      for (const fn of listeners) { try { fn(key, v, api); } catch (e) { console.error(e); } }
      bus?.emit('prefs', { key, value: v });
      return v;
    },
    reset() { for (const k of Object.keys(PREF_DEFAULTS)) api.set(k, PREF_DEFAULTS[k]); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reducedMotion: () => resolveReducedMotion(values.reducedMotion, systemReduced()),
  };
  return api;
}
