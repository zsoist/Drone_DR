// Regression coverage for photogrammetry border skirts found in v292 visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Regresión (2026-09-30): el terreno se descarta donde la máscara (collider decimado + dilatación)
// dice "cubierto", pero la malla visual tiene huecos reales ahí → se veía el cielo/bruma a través
// del suelo. Capa de respaldo: DSM erosionado, dibujada ANTES que malla/terreno y luego depth limpio.
test('underTerrainHeights: min filter pulls walls inward, subtracts elevMin, radius from spacing', async () => {
  const { underTerrainHeights } = await import('../web/flightverse/visual-coverage.js');
  const cols = 9, rows = 3;
  const hf = new Float32Array(cols * rows).fill(100);
  for (let y = 0; y < rows; y++) for (let x = 3; x <= 5; x++) hf[y * cols + x] = 130;   // "edificio" de 3 celdas
  // spacing 1 m, erode 1 m → r=1: el edificio de 3 celdas se reduce a 1 celda
  const out = underTerrainHeights(hf, cols, rows, { spacing: 1, elevMin: 90, erodeM: 1, dropM: 0 });
  const row = y => [...out.slice(y * cols, y * cols + cols)];
  assert.deepEqual(row(1), [10, 10, 10, 10, 40, 10, 10, 10, 10]);   // solo el centro del edificio sobrevive
  // nunca por encima del DSM (el respaldo es solo más pequeño/bajo)
  for (let i = 0; i < hf.length; i++) assert.ok(out[i] <= hf[i] - 90 + 1e-6);
  // radio 2 m con celdas de 2.3 m → 1 celda; con 1 m → 2 celdas
  const wide = underTerrainHeights(hf, cols, rows, { spacing: 1, elevMin: 0, erodeM: 2, dropM: 0 });
  assert.equal(wide[1 * cols + 4], 100, 'con r=2 el edificio de 3 celdas desaparece del respaldo');
  const drop = underTerrainHeights(hf, cols, rows, { spacing: 1, elevMin: 0, erodeM: 0, dropM: 0.5 });
  assert.equal(drop[0], 99.5);
});

test('patchUnderTerrainShader: gated by uMeshOn, nodata mask, above-eye discard', async () => {
  const { patchUnderTerrainShader } = await import('../web/flightverse/visual-coverage.js');
  const mk = () => ({
    uniforms: {},
    vertexShader: '#include <common>\n#include <uv_vertex>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  });
  const uMeshOn = { value: 1 };
  const valid = { id: 'valid' };
  const sh = patchUnderTerrainShader(mk(), { uMeshOn, validTex: valid });
  assert.equal(sh.uniforms.uMeshOn, uMeshOn);            // MISMO uniform que el terreno (volar.js lo conmuta)
  assert.equal(sh.uniforms.uValid.value, valid);
  assert.match(sh.vertexShader, /uMeshOn < \.5\) gl_Position/);   // fuera de vista malla: coste cero
  assert.match(sh.fragmentShader, /vFvW\.y > cameraPosition\.y\) discard/);
  assert.match(sh.fragmentShader, /texture2D\(uValid, vFvUv\)\.r < 0\.5\) discard/);
  const noMask = patchUnderTerrainShader(mk(), { uMeshOn });
  assert.doesNotMatch(noMask.fragmentShader, /uValid/);
});

test('scene.js wiring: backdrop drawn before mesh+terrain, depth cleared, haze sorted below it, terrain erosion unconditional', () => {
  const src = readFileSync(new URL('../web/flightverse/scene.js', import.meta.url), 'utf8');
  assert.match(src, /underMesh\.renderOrder = -5/);
  assert.match(src, /onAfterRender = renderer => \{ if \(meshMask\.uMeshOn\.value > 0\.5\) renderer\.clearDepth\(\)/);
  // el plano de bruma de sky.js (opaco, renderOrder 0) taparía el respaldo tras clearDepth si no va antes
  assert.match(src, /fv-haze-ground[\s\S]{0,80}renderOrder = -6/);
  // la erosión de 5 taps del terreno NO depende de fx (con fx=0 dejaba un anillo sin malla ni terreno)
  const block = src.slice(src.indexOf('float fvCv = texture2D(uMeshCoverage'), src.indexOf('if (fvCv > 0.5) discard;'));
  assert.ok(block.length > 100 && !/uFxOn/.test(block), 'erosion must not be gated by uFxOn');
  assert.match(src, /mesh\.add\(underMesh\)/);
});
