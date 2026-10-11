// flightverse/modes/exclusive.js — exclusión mutua de modos de juego (WS D). Módulo puro, sin THREE/DOM:
// se prueba en node (pipeline/test_fv_mode_exclusive.mjs).
//
// Un único modo activo a la vez. `enter(key)` detiene TODO lo que no sea `key` (y sólo eso) y registra el modo
// vigente; cualquier punto de entrada (ctx.modes.start, startReto, startRun, el selector, la URL de QA) pasa por aquí,
// de modo que Invasión y Gate Rush no pueden correr a la vez aunque un llamador heredado salte ctx.modes.
export const MODE_KEYS = Object.freeze(['explorar', 'tour', 'gaterush', 'invasion']);

/**
 * stoppers: { gaterush(), invasion(), tour?(), onboarding?() } — cada uno idempotente y seguro si el modo no está activo.
 * Devuelve { current, enter(key), stopAll(except?), active() }.
 */
export function createModeArbiter(stoppers = {}) {
  let current = 'explorar';
  let entering = false;                        // los stoppers pueden re-entrar (p.ej. eventos): no recursión
  const stopAll = (except = null) => {
    const stopped = [];
    for (const key of Object.keys(stoppers)) {
      if (key === except || typeof stoppers[key] !== 'function') continue;
      try { if (stoppers[key]() !== false) stopped.push(key); } catch { /* un stopper roto no impide parar el resto */ }
    }
    return stopped;
  };
  return {
    get current() { return current; },
    stopAll,
    /** Declara que `key` va a empezar: detiene el resto. */
    enter(key) {
      if (entering) return [];
      entering = true;
      try {
        const stopped = stopAll(key);
        current = key;
        return stopped;
      } finally { entering = false; }
    },
    /** Vuelve a explorar parando todo. */
    leave() { stopAll(); current = 'explorar'; },
  };
}

// ── Tour: sin chips de estado de vuelo ──────────────────────────────────────────────────────────────────────
/** Chips del HUD que NO deben verse mientras corre el Tour (el dron no vuela: «Viento 0 m/s», «Dron caído»). */
export const TOUR_HIDDEN_IDS = Object.freeze(['hx-wind', 'hx-crash']);
/** ¿Está activo el tour según el estado del evento `tour` del bus ('start'|'poi'|'loop' = sí, 'stop' = no)? */
export const tourActiveFrom = state => !!state && state !== 'stop';
/** Oculta/muestra los chips. `display:none !important` inline: el HUD alterna `hidden` por frame y no lo pisa. */
export function setTourChrome(doc, active) {
  if (!doc?.getElementById) return 0;
  let n = 0;
  for (const id of TOUR_HIDDEN_IDS) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (active) el.style.setProperty('display', 'none', 'important'); else el.style.removeProperty('display');
    n++;
  }
  return n;
}
