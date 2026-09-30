// flightverse/ui/records.js — estado local de la experiencia de primera vez y medallas de ONBOARDING (WS A).
// Las medallas y récords de Gate Rush / Invasión (par, top-10 'ab_fv_records', fantasma) son de D
// (modes/rules.js); aquí solo se PRESENTAN (ui/screens2.js lee vm.medal, vm.par, vm.misses, vm.rank, vm.top).
// Módulo puro (testeable en node).
export const MEDALS_KEY = 'ab_fv_medals';
export const ONBOARD_KEY = 'ab_fv_onboarded';
export const MEDAL_RANK = Object.freeze({ bronze: 1, silver: 2, gold: 3 });
export const MEDAL_TEXT = Object.freeze({ bronze: 'Bronce', silver: 'Plata', gold: 'Oro' });

const parse = (storage, key, fallback) => {
  try { const v = JSON.parse(storage?.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
};

/** Estante de medallas propias de la UI (p.ej. 'primer-vuelo'). */
export function createMedalShelf({ storage = globalThis.localStorage } = {}) {
  return {
    all: () => parse(storage, MEDALS_KEY, {}),
    /** true si la medalla es nueva o mejora la anterior. */
    award(id, level = 'bronze') {
      const db = parse(storage, MEDALS_KEY, {});
      if ((MEDAL_RANK[db[id]] || 0) >= (MEDAL_RANK[level] || 0)) return false;
      db[id] = level;
      try { storage?.setItem(MEDALS_KEY, JSON.stringify(db)); } catch { /* cuota / privado */ }
      return true;
    },
  };
}
export const isOnboarded = storage => { try { return !!storage?.getItem(ONBOARD_KEY); } catch { return false; } };
export const setOnboarded = storage => { try { storage?.setItem(ONBOARD_KEY, '1'); } catch { /* bloqueado */ } };

/** Formato mm:ss.d del cronómetro. */
export function formatTime(t) {
  if (!Number.isFinite(t)) return '--:--.-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
