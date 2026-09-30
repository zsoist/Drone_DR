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
