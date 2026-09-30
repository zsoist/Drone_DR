// flightverse/tour/grade.js — UN grade de color por hora del día + tonemapper (WS E, ?fv=2).
// El foto-real, la malla y el terreno son unlit/display-referred, así que la luz de la hora se
// hornea aquí: tinte, exposición (EV), sat, piso de sombras (noche usable, nunca negro) y brillo de
// "lámparas/ventanas" en zonas claras. Se FUSIONA en el EffectPass existente (mismo nº de pasadas:
// presupuesto móvil "tonemap + un grade"); el ToneMappingEffect pasa a AgX (spec §13).
import {
  EffectPass, Effect, ToneMappingEffect, ToneMappingMode, DepthOfFieldEffect,
} from '/vendor/postprocessing180.module.js?v=368';
import * as THREE from '/flightverse/three.js?v=368';

const FRAG = `
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uSat;
uniform float uGlow;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c0 = inputColor.rgb;
  float l0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
  vec3 c = c0 * uGain;
  // piso de sombras: sólo donde la escena es oscura (noche/atardecer); 0 de día
  c += uLift * (1.0 - smoothstep(0.0, 0.40, l0));
  // lámparas/ventanas: lo más claro de la foto conserva brillo cálido cuando el grade oscurece
  float g = smoothstep(0.45, 0.95, l0) * uGlow;
  c += c0 * vec3(1.0, 0.74, 0.46) * g * 0.45;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}`;

export class TodGradeEffect extends Effect {
  constructor() {
    super('TodGradeEffect', FRAG, {
      uniforms: new Map([
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['uSat', new THREE.Uniform(1)],
        ['uGlow', new THREE.Uniform(0)],
      ]),
    });
    this.evExtra = 0;
    this.base = { tint: [1, 1, 1], ev: 0, sat: 1, lift: [0, 0, 0], glow: 0 };
  }

  /** grade = { tint:[r,g,b], ev, sat, lift:[r,g,b], glow } (de tod.js). */
  setGrade(grade) {
    this.base = { ...this.base, ...grade };
    this.#push();
  }

  /** EV extra del modo foto (±2). */
  setEvExtra(ev) { this.evExtra = ev; this.#push(); }

  #push() {
    const { tint, ev, sat, lift, glow } = this.base;
    const k = Math.pow(2, ev + this.evExtra);
    this.uniforms.get('uGain').value.set(tint[0] * k, tint[1] * k, tint[2] * k);
    this.uniforms.get('uLift').value.set(lift[0], lift[1], lift[2]);
    this.uniforms.get('uSat').value = sat;
    this.uniforms.get('uGlow').value = glow;
  }
}

/**
 * Reemplaza el EffectPass principal de ctx.composer por otro con el grade insertado ANTES del
 * tone mapping (HDR lineal) y AgX como tonemapper. Devuelve null si no se puede (sin romper nada).
 */
export function installGrade(ctx, { toneMode = 'AGX' } = {}) {
  const { composer, camera } = ctx;
  try {
    const idx = composer.passes.findIndex(p => p instanceof EffectPass);
    if (idx < 0) return null;
    const old = composer.passes[idx];
    const fx = old.effects.slice();
    const tmIx = fx.findIndex(e => e instanceof ToneMappingEffect);
    if (tmIx < 0) return null;
    const grade = new TodGradeEffect();
    fx.splice(tmIx, 0, grade);
    const tm = fx[tmIx + 1];
    const legacyMode = tm.mode;
    const pass = new EffectPass(camera, ...fx);
    composer.addPass(pass, idx);
    composer.removePass(old);
    const api = {
      grade, pass, toneMapping: tm, legacyMode,
      setGrade: g => grade.setGrade(g),
      setEvExtra: ev => grade.setEvExtra(ev),
      setToneMode(name) { tm.mode = ToneMappingMode[name] ?? ToneMappingMode.NEUTRAL; },
      tonemapName: () => Object.keys(ToneMappingMode).find(k => ToneMappingMode[k] === tm.mode),
      /** DOF (modo foto): pasada propia SÓLO mientras dura el modo; sin coste fuera de él. */
      createDof() {
        const dof = new DepthOfFieldEffect(camera, { focusDistance: 30, focusRange: 10, bokehScale: 3, resolutionScale: 0.5 });
        const dofPass = new EffectPass(camera, dof);
        return { dof, dofPass };
      },
      addPassBefore(p) { const i = composer.passes.indexOf(pass); composer.addPass(p, Math.max(0, i)); },
      removePass(p) { composer.removePass(p); },
    };
    api.setToneMode(toneMode);
    return api;
  } catch (e) {
    console.warn('[grade] no se pudo instalar:', e?.message || e);
    return null;
  }
}
