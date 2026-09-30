// Regression coverage for photogrammetry border skirts found in v292 visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVisualCoverageMask,
  worldCoverageUv,
} from '../web/flightverse/visual-coverage.js';

test('visual coverage mask maps world to UV and patches the shader', async () => {
  assert.deepEqual(worldCoverageUv(-50, -25, [100, 50]), [0, 1]);
  assert.deepEqual(worldCoverageUv(0, 0, [100, 50]), [0.5, 0.5]);
  assert.deepEqual(worldCoverageUv(50, 25, [100, 50]), [1, 0]);

  const material = {};
  const texture = { id: 'coverage' };
  assert.equal(applyVisualCoverageMask(material, {
    texture,
    worldSize: { x: 100, y: 50 },
    texel: { x: 0.01, y: 0.02 },
  }), true);

  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uFvCoverage.value, texture);
  assert.match(shader.vertexShader, /vFvCoverageWorld/);
  assert.match(shader.fragmentShader, /texture2D\(uFvCoverage/);
  assert.match(shader.fragmentShader, /discard/);
  assert.match(shader.fragmentShader, /uFvCoverageTexel/);
  assert.match(material.customProgramCacheKey(), /fv-visual-coverage/);

  assert.equal(applyVisualCoverageMask({}, {
    texture: null,
    worldSize: { x: 100, y: 50 },
    texel: { x: 0.01, y: 0.02 },
  }), false);

});

// Regresión (2026-09-30, iPhone): mesh_coverage.py escribe bytes 0/1; como textura UnsignedByte
// normalizada "1" llega al shader como 1/255 y ambos umbrales (0.5) fallaban → la malla se
// descartaba SIEMPRE y el terreno DSM ("cortinas") se veía en su lugar. La textura debe ser 0/255.
test('coverage bytes 0/1 (and legacy 0/255) become 0/255 so the 0.5 shader threshold works', async () => {
  const { coverageMaskBytes } = await import('../web/flightverse/visual-coverage.js');
  const out = coverageMaskBytes(new Uint8Array([0, 1, 0, 255, 7]).buffer);
  assert.deepEqual([...out], [0, 255, 0, 255, 255]);
  assert.ok(out[1] / 255 >= 0.5, 'covered texel must sample >= 0.5 once normalized');
});
