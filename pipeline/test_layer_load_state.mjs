// Regression coverage for ISSUE-001/004 from the 2026-07-25 World QA audit.
import assert from 'node:assert/strict';
import {
  createLazyLayerLoader,
  markLoadStep,
} from '../web/flightverse/layer-load-state.js';

let starts = 0;
let release;
const pending = new Promise(resolve => { release = resolve; });
const loader = createLazyLayerLoader(async () => {
  starts += 1;
  return pending;
});

assert.equal(loader.state, 'deferred');
assert.equal(starts, 0, 'a deferred layer must not consume bandwidth before it is requested');

const first = loader.ensure();
const second = loader.ensure();
assert.equal(loader.state, 'loading');
assert.equal(starts, 1, 'concurrent requests must share one asset load');

release({ id: 'mesh' });
assert.deepEqual(await first, { id: 'mesh' });
assert.deepEqual(await second, { id: 'mesh' });
assert.equal(loader.state, 'ready');
assert.equal(starts, 1);
assert.deepEqual(await loader.ensure(), { id: 'mesh' });
assert.equal(starts, 1, 'a ready layer must be reused');

const added = [];
const liveRoot = {
  querySelector(selector) {
    assert.equal(selector, '#vb-malla');
    return { classList: { add: token => added.push(token) } };
  },
};
assert.equal(markLoadStep(liveRoot, 'vb-malla'), true);
assert.deepEqual(added, ['ok']);
assert.equal(markLoadStep({ querySelector: () => null }, 'vb-malla'), false,
  'a completed async load must tolerate a removed boot HUD');
assert.equal(markLoadStep(null, 'vb-malla'), false);

console.log('layer load state: ok');
