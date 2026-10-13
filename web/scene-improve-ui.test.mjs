import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneTitle, sceneSources, sceneInsight } from './scene-improve-ui.js';

test('scene labels hide technical suffixes without changing owner data', () => {
  const model = { title: 'Casa — ODM+splat en NVIDIA CUDA (F5 v2)' };
  assert.equal(sceneTitle(model.title), 'Casa');
  assert.equal(model.title, 'Casa — ODM+splat en NVIDIA CUDA (F5 v2)');
  assert.equal(sceneTitle('Guatavita 19 jul — banda aérea 18-65m'), 'Guatavita 19 jul — banda aérea 18-65m');
  assert.equal(sceneTitle('Dialectica v1.0'), 'Dialectica');
  assert.equal(sceneTitle('0101 alta stable no mesh'), 'Escena 0101');
  assert.equal(sceneTitle('0100 alta fixed 9500m retry-medium'), 'Escena 0100');
});

test('scene descriptions only use integrated video inputs', () => {
  const model = {clip_id:'recon_a', reconstruction:{sources:[{clip_id:'bad',merged:false},'good','set:photos',null]}};
  assert.deepEqual(sceneSources(model), ['good']);
  assert.deepEqual(sceneSources({...model,site:{effective_sources:['active']}}), ['active']);
  assert.deepEqual(sceneSources({clip_id:'recon_no_inputs'}), []);
});

test('best source selection handles pending data and retries failed requests', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  let fail = true;
  globalThis.fetch = async path => {
    calls.push(path);
    if (path.includes('/retry/') && fail) return {ok:false};
    if (path.includes('/pending/')) return {ok:true,json:async()=>({status:'pending',insight:null})};
    return {ok:true,json:async()=>({status:'ready',insight:{caption_short:'Una ciudad.',caption:'Una ciudad rodeada de montañas.',highlight_segments:[{score:path.includes('/best/') ? .9 : .5}]}})};
  };
  try {
    const model={clip_id:'recon_best',reconstruction:{sources:['other','pending','best']}};
    const insight=await sceneInsight(model);
    assert.equal(insight.clip_id,'best');
    assert.equal(insight.caption_short,'Una ciudad.');
    await sceneInsight(model);
    assert.equal(calls.length,3);
    assert.equal(await sceneInsight({clip_id:'pending'}),null);
    await assert.rejects(sceneInsight({clip_id:'retry'}));
    fail=false;
    assert.equal((await sceneInsight({clip_id:'retry'})).clip_id,'retry');
  } finally { globalThis.fetch=previous; }
});

test('version names keep processing details out of the picker', async () => {
  const { sceneVersionLabel } = await import('./scene-improve-ui.js');
  assert.equal(sceneVersionLabel({current:true,preset:'ultra20',preset_label:'Ultra+ 20K',backend:'NVIDIA CUDA',iters:20000,loss:.04}), 'Actual · Detalle superior');
  assert.equal(sceneVersionLabel({current:false,archived_at:'2026-07-14',preset:'medium',preset_label:'Medium 2K'}), '14 jul 2026 · Detalle medio');
});
