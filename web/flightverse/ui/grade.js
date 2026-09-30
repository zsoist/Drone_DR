// flightverse/ui/grade.js — look/grade (brillo, contraste, saturación, bloom, viñeta, tono) + presets.
// Compartido por el panel legado (menu.js) y la página «Imagen» del menú v2 (menu2.js). Persistido en
// localStorage 'ab.fv.grade'. Sin cambio de comportamiento respecto al bloque original de menu.js.
const $ = s => document.querySelector(s);
const GRADE_KEY = 'ab.fv.grade';
export const GRADE_PRESETS = Object.freeze({
  natural: { b: 0.9, c: 0.04, s: 0.02, g: 0.18, v: 0.35 },
  vivo:    { b: 1.0, c: 0.14, s: 0.22, g: 0.4, v: 0.4 },
  cine:    { b: 0.82, c: 0.18, s: -0.06, g: 0.28, v: 0.62 },
});
const DEF_GRADE = { b: 0.88, t: 1, c: 0.06, s: 0.06, g: 0.25, v: 0.42, h: 0 };

/** Cablea sliders (#gr-b…#gr-h, salidas #o-*), presets ([data-pr]) y restablecer. Devuelve { apply, preset(name) }. */
export function installGrade(ctx, { inputRoot, presetsRoot, resetBtn }) {
  const { post: fx, terrain } = ctx;
  const applyGrade = g => {
    fx.exp.uniforms.get('uExp').value = g.b;
    fx.hs.hue = (g.h ?? 0) * Math.PI;
    // bloom: con NEUTRAL casi nada supera lum 1.0 — el slider baja el UMBRAL
    fx.bloom.luminanceMaterial.threshold = Math.max(0.55, 1.0 - (g.g ?? 0) * 0.28);
    for (const [oid, k] of [['o-b', 'b'], ['o-t', 't'], ['o-c', 'c'], ['o-s', 's'], ['o-g', 'g'], ['o-v', 'v'], ['o-h', 'h']])
      if ($('#' + oid)) $('#' + oid).textContent = (+(g[k] ?? 0)).toFixed(2);
    terrain.mesh.material.color.setScalar(g.t ?? 1);   // ganancia SOLO del 3D
    fx.bc.contrast = g.c;
    fx.hs.saturation = g.s;
    fx.bloom.intensity = g.g;
    fx.vig.darkness = g.v;
    for (const [id, k] of [['gr-b', 'b'], ['gr-t', 't'], ['gr-c', 'c'], ['gr-s', 's'], ['gr-g', 'g'], ['gr-v', 'v'], ['gr-h', 'h']]) if ($('#' + id)) $('#' + id).value = g[k] ?? 1;
  };
  let grade = { ...DEF_GRADE, ...(JSON.parse(localStorage.getItem(GRADE_KEY) || '{}')) };
  applyGrade(grade);
  inputRoot.addEventListener('input', e => {
    const map = { 'gr-b': 'b', 'gr-t': 't', 'gr-c': 'c', 'gr-s': 's', 'gr-g': 'g', 'gr-v': 'v', 'gr-h': 'h' };
    const k = map[e.target.id]; if (!k) return;
    grade[k] = parseFloat(e.target.value);
    applyGrade(grade);
    localStorage.setItem(GRADE_KEY, JSON.stringify(grade));
  });
  resetBtn.addEventListener('click', () => { grade = { ...DEF_GRADE }; applyGrade(grade); localStorage.removeItem(GRADE_KEY); });
  const preset = name => {
    const p = GRADE_PRESETS[name]; if (!p) return false;
    grade = { ...p }; applyGrade(grade);
    localStorage.setItem(GRADE_KEY, JSON.stringify(grade));
    return true;
  };
  presetsRoot.addEventListener('click', e => { preset(e.target.closest('[data-pr]')?.dataset.pr); });
  // grade fuera de rango guardado (el bug del fondo blanco): sanear
  grade.c = Math.max(-0.15, Math.min(0.55, grade.c));
  if (!(grade.b >= 0.35 && grade.b <= 1.6)) grade.b = 0.88;  // migra esquemas viejos (y el 1.3 quemado)
  applyGrade(grade);
  return { apply: () => applyGrade(grade), preset, get current() { return { ...grade }; } };
}
