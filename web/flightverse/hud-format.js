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
