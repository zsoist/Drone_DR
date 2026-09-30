// flightverse/world-look.js — look compartido del mundo (WS E): UNA inyección de shader para
// terreno, malla fotogramétrica y vegetación con tres deberes, todos gobernados por uniformes
// COMPARTIDOS (un solo objeto, cero coste por material):
//   1. NIEBLA-MURO del borde del mundo: desde fog[0] hasta fog[1] (métrica radial al centro) el
//      fragmento se funde con el color de la niebla; el horizonte del cielo tiene ese mismo color,
//      así la isla se disuelve en bruma en vez de terminar en un corte contra un degradado plano.
//   2. DISOLUCIÓN CERCANA (dither): los fragmentos a < ~1.4 m de la cámara se vuelven transparentes
//      (alpha-hash) — adiós a pantallas llenas de una pared/mapa estirado al pegarse a la malla.
//   3. BRUMA INTERIOR (uFvNear.z): si la cámara está dentro de geometría, todo se funde a niebla
//      (en vez del "vacío" gris/oscuro). Lo calcula tour/void-guard.js.
// Con `uFvEdgeB.y = 0` y `uFvNear.w = 0` (legacy, sin ?fv=2) el aspecto es idéntico al anterior.
import * as THREE from '/flightverse/three.js?v=369';

export const WORLD_LOOK = {
  uFvEdgeA: { value: new THREE.Vector4(0, 0, 1e9, 1e9 + 1) },   // cx, cz, fog0, fog1
  uFvEdgeB: { value: new THREE.Vector4(0, 0, 0, 0) },           // x=forma(0 círculo,1 cuadrado) y=fuerza
  uFvEdgeColor: { value: new THREE.Color(0xcfe2f2) },
  uFvNear: { value: new THREE.Vector4(0.3, 1.4, 0, 0) },        // x=inicio, y=fin del dither, z=bruma interior, w=activo
};

const KEY = '|fv-world-look-v1';

/** Encadena el look del mundo sobre un material (sin pisar onBeforeCompile/customProgramCacheKey previos). */
export function applyWorldLook(material) {
  if (!material || material.userData?.fvWorldLook) return material;
  material.userData = material.userData || {};
  material.userData.fvWorldLook = true;
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);
    Object.assign(shader.uniforms, WORLD_LOOK);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvEW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fvEP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fvEP = instanceMatrix * fvEP;
        #endif
        vFvEW = (modelMatrix * fvEP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFvEW;
        uniform vec4 uFvEdgeA; uniform vec4 uFvEdgeB; uniform vec3 uFvEdgeColor; uniform vec4 uFvNear;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uFvNear.w > 0.5) {
          float fvNd = length(vFvEW - cameraPosition);
          if (fvNd < uFvNear.y) {
            float fvK = smoothstep(uFvNear.x, uFvNear.y, fvNd);
            float fvH = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (fvK < fvH) discard;
          }
        }`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        if (uFvEdgeB.y > 0.0) {
          vec2 fvD = vFvEW.xz - uFvEdgeA.xy;
          float fvM = uFvEdgeB.x > 0.5 ? max(abs(fvD.x), abs(fvD.y)) : length(fvD);
          float fvT = clamp((fvM - uFvEdgeA.z) / max(uFvEdgeA.w - uFvEdgeA.z, 1.0), 0.0, 1.0);
          fvT = fvT * fvT * (3.0 - 2.0 * fvT);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uFvEdgeColor, fvT * uFvEdgeB.y);
        }
        if (uFvNear.z > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, uFvEdgeColor, uFvNear.z);`);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}${KEY}`;
  material.needsUpdate = true;
  return material;
}

/** Configura el borde (lo llama tour/index.js). fog = [f0,f1] en métrica radial. */
export function setWorldEdge({ center = [0, 0], fog, shape = 'circle', strength = 1 }) {
  WORLD_LOOK.uFvEdgeA.value.set(center[0], center[1], fog[0], fog[1]);
  WORLD_LOOK.uFvEdgeB.value.set(shape === 'square' ? 1 : 0, strength, 0, 0);
}

/** Activa/desactiva disolución cercana + bruma interior. */
export function setNearLook({ active = true, start = 0.3, end = 1.4, mist = 0 } = {}) {
  WORLD_LOOK.uFvNear.value.set(start, end, mist, active ? 1 : 0);
}
