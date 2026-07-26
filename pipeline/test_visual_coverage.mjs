// Regression coverage for photogrammetry border skirts found in v292 visual QA.
import assert from 'node:assert/strict';
import {
  applyVisualCoverageMask,
  worldCoverageUv,
} from '../web/flightverse/visual-coverage.js';

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

console.log('visual coverage: ok');
