import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

// planInstances is pure; import the module source with the three shim stubbed out.
const src = readFileSync(new URL('../web/flightverse/vegetation.js', import.meta.url), 'utf8')
  .replace(/^import \* as THREE.*$/m, 'const THREE = {};');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const doc = (n) => ({
  version: 1, types: ['tree_round', 'tree_conifer', 'tree_oak', 'bush'],
  instances: Array.from({ length: n }, (_, i) => [i, -i, 1, 5, 0.5, i % 4, 0x336611]),
});

test('caps are ordered and off levels have none', () => {
  assert.ok(mod.VEGETATION_CAPS.lite < mod.VEGETATION_CAPS.high);
  assert.equal(mod.vegetationCap('off'), 0);
});

test('planInstances keeps a prefix and splits by type', () => {
  const plan = mod.planInstances(doc(100), 40);
  assert.equal(plan.reduce((s, b) => s + b.length, 0), 40);
  assert.equal(plan[3].length, 10);
});

test('planInstances rejects wrong versions and drops malformed rows', () => {
  assert.equal(mod.planInstances({ ...doc(3), version: 2 }, 10), null);
  assert.equal(mod.planInstances(null, 10), null);
  const d = doc(3); d.instances.push([1, 1], [NaN, 0, 0, 3, 0, 0, 0], [0, 0, 0, 3, 0, 9, 0]);
  assert.equal(mod.planInstances(d, 99).reduce((s, b) => s + b.length, 0), 3);
});

test('shipped vegetation assets stay within the 1.5 MB budget and carry a licence', () => {
  let total = 0;
  for (const f of ['tree_round', 'tree_conifer', 'tree_oak', 'bush']) {
    total += statSync(new URL(`../web/assets/vegetation/${f}.glb`, import.meta.url)).size;
  }
  assert.ok(total < 1.5 * 1024 * 1024);
  assert.match(readFileSync(new URL('../web/assets/vegetation/kenney-nature-kit-LICENSE.txt', import.meta.url), 'utf8'), /CC0|Creative Commons Zero/);
});
