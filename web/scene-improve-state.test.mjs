import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from './vendor/three180.core.js';
import { originalInputs, coverageRows, loadIsCurrent, mapLayerIds, centerReplacement, analysisFor } from './scene-improve-state.js';

test('combined reconstruction keeps videos, photo sets, and loose photos', () => {
  const model={clip_id:'recon_a',reconstruction:{sources:[{clip_id:'video_a'},'video_b',{clip_id:'set:roof/north'},{clip_id:'video_a'}],photos:['roof.jpg']}};
  assert.deepEqual(originalInputs(model),{sources:['video_a','video_b','set:roof/north'],photos:['roof.jpg']});
  assert.deepEqual(originalInputs(model,{sources:['active_video'],photos:['active.jpg']}),{sources:['active_video'],photos:['active.jpg']});
  assert.deepEqual(originalInputs({clip_id:'recon_missing'}).sources,[]);
  assert.deepEqual(originalInputs({clip_id:'video_a'}).sources,['video_a']);
});
test('an explicitly empty photo inventory does not inherit old photos',()=>{
  assert.deepEqual(originalInputs({reconstruction:{photos:['old.jpg']}},{photos:[]}).photos,[]);
});
test('square coverage uses its own availability',()=>{
  const scene={coverage:{shapes:{circle:[{diameter_m:100,ready:true}],square:[{diameter_m:100,ready:false}]}}};
  assert.equal(coverageRows(scene,'square')[0].ready,false);
  assert.deepEqual(coverageRows(scene,'triangle'),[]);
});
test('stale failures cannot replace the current viewer',()=>{
  const host={_loadToken:1};const token=host._loadToken;host._loadToken++;
  assert.equal(loadIsCurrent(host,token),false);
  assert.equal(loadIsCurrent(host,2),true);
});
test('orthophoto visibility includes the HD tile layer',()=>{
  assert.deepEqual(mapLayerIds('ortho'),['ortho','ortho-hd']);
  assert.deepEqual(mapLayerIds('dsm'),['dsm']);
});
test('replacement quality remains centered without changing the camera',()=>{
  const root=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxGeometry(3,7,2));mesh.position.set(230,-180,50);root.add(mesh);
  const camera=new THREE.PerspectiveCamera();camera.position.set(10,30,20);const before=camera.position.clone();
  centerReplacement(root,THREE);root.updateMatrixWorld(true);
  assert.ok(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).length()<1e-8);
  assert.deepEqual(camera.position,before);
});
test('scene suggestions use existing analysis without replacing owner content',()=>{
  const model={clip_id:'recon_a',title:'Owner title',reconstruction:{sources:[{clip_id:'video'}]}};
  assert.equal(analysisFor(model,[{clip_id:'video',ai:{summary:'Stored summary'}}]).summary,'Stored summary');
  assert.equal(model.title,'Owner title');assert.equal(analysisFor(model,[]),null);
});

// Exercise the standalone request path without loading DOM-only sheet modules.
const requestSource = readFileSync(new URL('./scene-improve-ui.js', import.meta.url), 'utf8')
  .match(/async function readSceneData\(path\) \{[\s\S]*?\n\}/)[0];
test('standalone scene information sends same-origin credentials', async () => {
  let request;
  const response = { status: 200 };
  const read = runInNewContext(`(${requestSource})`, {
    fetch: async (path, options) => { request = { path, options }; return response; },
  });
  assert.equal(await read('/api/capture_report?clip_id=scene'), response);
  assert.equal(request.path, '/api/capture_report?clip_id=scene');
  assert.equal(request.options.credentials, 'same-origin');
});
test('standalone scene information redirects an expired session with its return URL', async () => {
  let destination;
  const read = runInNewContext(`(${requestSource})`, {
    fetch: async () => ({ status: 401 }),
    location: { pathname: '/share.html', search: '?m=scene', hash: '#info', replace: url => { destination = url; } },
  });
  await assert.rejects(read('/api/capture_report?clip_id=scene'), /Sesión expirada/);
  assert.equal(destination, '/login.html?next=%2Fshare.html%3Fm%3Dscene%23info');
});
test('scene information keeps the shared auth wrapper on app pages', async () => {
  const response = { status: 200 };
  let requested;
  const read = runInNewContext(`(${requestSource})`, {
    authFetch: async path => { requested = path; return response; },
    fetch: () => { throw new Error('Must use the shared wrapper'); },
  });
  assert.equal(await read('/api/capture_report?clip_id=scene'), response);
  assert.equal(requested, '/api/capture_report?clip_id=scene');
});
