// flightverse/hud-format.js — funciones puras de texto/estado del HUD (testeables en node).

// Etiqueta honesta de alineación del splat: un transform 'aligned' puede no traer rmse_m
// (p.ej. método nerfstudio-colmap-exact) y `undefined * 100` imprimía "±NaNcm" en el HUD.
export function splatAlignmentLabel(splat) {
  if (!splat?.aligned) return 'sin alinear';
  return Number.isFinite(splat.rmse) ? `±${(splat.rmse * 100).toFixed(0)}cm` : 'alineado';
}

// Resumen de una run de Invasión terminada + mejor marca. `prev` = {score,...} o null.
export function summarizeInvasionRun(state, prev) {
  const score = Math.max(0, Math.floor(Number(state?.score) || 0));
  const run = {
    wave: Math.max(1, Math.floor(Number(state?.wave) || 1)),
    killed: Math.max(0, Math.floor(Number(state?.killed) || 0)),
    score,
    types: Array.isArray(state?.types) ? [...state.types] : [],
    difficulty: state?.difficulty || 'media',
  };
  const prevScore = Number.isFinite(prev?.score) ? prev.score : null;
  run.newBest = score > 0 && (prevScore == null || score > prevScore);
  run.best = run.newBest ? score : prevScore;
  return run;
}

// ── HUD v2: escala por viewport y textos humanos (ui/*, testeable en node) ─────────────────────────────
/** Escala del HUD: `vs` (geometría + tipografía por viewport) y `hs` (= vs × tamaño de texto del jugador).
 *  En móvil (lado corto < 660 px) vs = 1; en escritorio crece hasta 1.5 (1440×900 → ~1.3: placas de 18 px, canvas de 17 px). */
export function hudScale(w, h, textScalePct = 100) {
  const vs = Math.min(1.5, Math.max(1, Math.min((Number(w) || 0) / 1100, (Number(h) || 0) / 660)));
  const ts = Math.min(1.3, Math.max(1, (Number(textScalePct) || 100) / 100));
  return { vs: +vs.toFixed(3), hs: +(vs * ts).toFixed(3), ts };
}

/** Subtítulo de la hoja de pausa sin datos crudos: «Nombre · 200 m · círculo · 31.416 m²» → «Nombre · zona de 200 m».
 *  Conserva el estado de carga que volar.js añade al final («malla 45%», «foto-real ±4cm»…). */
export function humanSceneLabel(raw) {
  const parts = String(raw ?? '').split('·').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const out = [parts[0]];
  let dropped = false;
  for (const p of parts.slice(1)) {
    if (/^\d[\d.,\s]*\s*m$/i.test(p)) { out.push(`zona de ${p.replace(/\s+/g, ' ')}`); continue; }
    if (/^(círculo|circulo|cuadrado)$/i.test(p) || /^[\d.,\s]+m²$/i.test(p)) { dropped = true; continue; }
    if (/^extensión nativa$/i.test(p)) { out.push('zona completa'); continue; }
    const pct = p.match(/^(malla|splat)\s+(\d+)\s*%$/i);
    if (pct) { out.push(`${/malla/i.test(pct[1]) ? 'Malla' : 'Foto-real'} ${pct[2]} %`); continue; }
    if (/^malla fotogramétrica$/i.test(p)) { out.push('Malla fotogramétrica'); continue; }
    if (/^foto-real/i.test(p)) { out.push(p.charAt(0).toUpperCase() + p.slice(1)); continue; }
    out.push(p);
  }
  void dropped;
  return out.join(' · ');
}

/** Causa legible de un choque (bus 'crash' → energyClass; ctx.phys.impact.name). */
export function crashCauseLabel(energyClass, integrity) {
  if (Number.isFinite(integrity) && integrity <= 0) return 'casco destruido';
  if (energyClass === 'prop') return 'hélice dañada';
  if (energyClass === 'crash') return 'golpe fuerte';
  return 'impacto';
}

/** Perfiles de vuelo: texto de una línea para el menú (velocidad = techo aproximado a nivel del mar). */
export const FLIGHT_PROFILES = Object.freeze([
  { key: 'cine', label: 'Cine', desc: 'Suave y estable para grabar · ~6 m/s' },
  { key: 'normal', label: 'Normal', desc: 'Equilibrado para explorar · ~10 m/s' },
  { key: 'sport', label: 'Sport', desc: 'Ágil y rápido, más reto · ~14 m/s' },
]);
