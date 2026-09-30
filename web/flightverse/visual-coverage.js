export function worldCoverageUv(x, z, worldSize) {
  const width = Number(worldSize?.[0]);
  const height = Number(worldSize?.[1]);
  if (!(width > 0) || !(height > 0)) return null;
  return [x / width + 0.5, 0.5 - z / height];
}

// mesh_coverage.bin trae bytes 0/1 (pipeline/mesh_coverage.py). Como textura UnsignedByte
// normalizada, 1 → 1/255 y los umbrales 0.5 de los shaders (malla y terreno) nunca se
// cumplían: malla siempre descartada, terreno DSM siempre visible. Normaliza a 0/255.
export function coverageMaskBytes(buffer) {
  const out = new Uint8Array(buffer.byteLength);
  const src = new Uint8Array(buffer);
  for (let i = 0; i < src.length; i++) out[i] = src[i] ? 255 : 0;
  return out;
}

export function applyVisualCoverageMask(
  material,
  {
    texture,
    worldSize,
    texel,
  } = {},
) {
  if (
    !material || !texture
    || !(Number(worldSize?.x) > 0) || !(Number(worldSize?.y) > 0)
    || !(Number(texel?.x) > 0) || !(Number(texel?.y) > 0)
  ) return false;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = shader => {
    previousCompile?.call(material, shader);
    Object.assign(shader.uniforms, {
      uFvCoverage: { value: texture },
      uFvCoverageWorldSize: { value: worldSize },
      uFvCoverageTexel: { value: texel },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vFvCoverageWorld;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvFvCoverageWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFvCoverageWorld;
uniform sampler2D uFvCoverage;
uniform vec2 uFvCoverageWorldSize;
uniform vec2 uFvCoverageTexel;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 fvCoverageUv = vec2(
  vFvCoverageWorld.x / uFvCoverageWorldSize.x + 0.5,
  0.5 - vFvCoverageWorld.z / uFvCoverageWorldSize.y
);
if (any(lessThan(fvCoverageUv, vec2(0.0)))
    || any(greaterThan(fvCoverageUv, vec2(1.0)))) discard;
float fvCoverage = texture2D(uFvCoverage, fvCoverageUv).r;
fvCoverage = min(fvCoverage,
  texture2D(uFvCoverage, fvCoverageUv + vec2(uFvCoverageTexel.x, 0.0)).r);
fvCoverage = min(fvCoverage,
  texture2D(uFvCoverage, fvCoverageUv - vec2(uFvCoverageTexel.x, 0.0)).r);
fvCoverage = min(fvCoverage,
  texture2D(uFvCoverage, fvCoverageUv + vec2(0.0, uFvCoverageTexel.y)).r);
fvCoverage = min(fvCoverage,
  texture2D(uFvCoverage, fvCoverageUv - vec2(0.0, uFvCoverageTexel.y)).r);
if (fvCoverage < 0.5) discard;
#include <map_fragment>`,
      );
  };
  material.customProgramCacheKey = () => {
    const previous = previousCacheKey?.call(material) || '';
    return `${previous}|fv-visual-coverage-v1`;
  };
  material.needsUpdate = true;
  return true;
}

// --- Terreno "de respaldo" bajo la malla (relleno de huecos) ---------------------------------
// La máscara de cobertura sale de los triángulos del COLLIDER (decimado, dilatado 1 celda): una
// celda "cubierta" puede tener huecos reales en la malla visual (copas, bordes de techo, lo que el
// decimado puentea). Ahí el terreno DSM se descarta y se veía el CIELO/bruma a través del suelo.
// Solución (scene.js): una segunda superficie, el DSM ERosionado, que solo existe en vista malla y
// se dibuja como CAPA DE FONDO: antes que malla y terreno (renderOrder -5) y luego se limpia el
// depth, así la malla/terreno la sobrescriben siempre y solo asoma donde no queda ningún píxel.
// (Hundir el DSM o dejarlo con z-test normal NO sirve: en copas la malla queda por debajo del DSM
// y el respaldo taparía malla buena; y el terreno completo reintroduce las cortinas grises.)
// El mínimo en radio ~2 m mete paredes y copas DENTRO del volumen de la malla: las cortinas del
// DSM no asoman por los bordes de las fachadas.
export const FV_UNDER_ERODE_M = 2.0;
export const FV_UNDER_DROP_M = 0;

// Alturas (relativas a elevMin) del respaldo: filtro de mínimo separable (2r+1)² (menos dropM).
export function underTerrainHeights(hf, cols, rows, { spacing = 1, elevMin = 0, erodeM = FV_UNDER_ERODE_M, dropM = FV_UNDER_DROP_M } = {}) {
  const r = Math.max(0, Math.min(6, Math.round(erodeM / Math.max(1e-6, spacing))));
  const tmp = new Float32Array(hf.length);
  const out = new Float32Array(hf.length);
  for (let y = 0; y < rows; y++) {                       // horizontal
    for (let x = 0; x < cols; x++) {
      let m = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(cols - 1, x + r); k++) m = Math.min(m, hf[y * cols + k]);
      tmp[y * cols + x] = m;
    }
  }
  for (let y = 0; y < rows; y++) {                       // vertical
    for (let x = 0; x < cols; x++) {
      let m = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(rows - 1, y + r); k++) m = Math.min(m, tmp[k * cols + x]);
      out[y * cols + x] = m - elevMin - dropM;
    }
  }
  return out;
}

// onBeforeCompile del respaldo (MeshBasicMaterial con la ortofoto): solo se dibuja en vista malla
// (uMeshOn=1; si no, sus vértices salen del clip → coste cero), respeta la máscara nodata y no
// dibuja superficies por encima del ojo (solo se verían mirando hacia arriba: ahí el cielo es legítimo).
export function patchUnderTerrainShader(shader, { uMeshOn, validTex = null } = {}) {
  shader.uniforms.uMeshOn = uMeshOn;
  if (validTex) shader.uniforms.uValid = { value: validTex };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uMeshOn;\nvarying vec2 vFvUv;\nvarying vec3 vFvW;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFvUv = uv;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvFvW = (modelMatrix * vec4(transformed, 1.)).xyz;\nif (uMeshOn < .5) gl_Position = vec4(2., 2., 2., 1.);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFvUv;\nvarying vec3 vFvW;' + (validTex ? '\nuniform sampler2D uValid;' : ''))
    .replace('#include <map_fragment>',
      // superficies por encima del ojo solo se ven mirando hacia arriba: ahí el cielo es legítimo
      'if (vFvW.y > cameraPosition.y) discard;\n'
      + (validTex ? 'if (texture2D(uValid, vFvUv).r < 0.5) discard;\n' : '') + '#include <map_fragment>');
  return shader;
}
