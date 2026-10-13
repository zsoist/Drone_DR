import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryFrames, propertyCover } from './p.logic.js';
test('short clips never invent gallery indices',()=>{
 const frames=galleryFrames({}, {clip_id:'short',frame_count:6});
 assert.equal(frames.length,6);
 assert.equal(frames[0],'data/frames/short/f_0001.jpg');
 assert.equal(frames.at(-1),'data/frames/short/f_0006.jpg');
});
test('missing analysis or frame inventory yields no gallery requests',()=>{
 assert.deepEqual(galleryFrames({},null),[]);
 assert.deepEqual(galleryFrames({gallery:[]},{frame_count:15}),[]);
});
test('saved galleries reject external URLs and path traversal',()=>{
 assert.deepEqual(galleryFrames({gallery:['https://bad.test/a.jpg','data/frames/../f_0001.jpg','data/frames/clip/f_0001.jpg']}),['data/frames/clip/f_0001.jpg']);
});

test('property covers keep owner frames before the bundled high-resolution frame',()=>{
 const clip='DJI_20260315121003_0092_D';
 assert.equal(propertyCover({clip}), 'p.guaduas-cover.jpg');
 assert.equal(propertyCover({clip,gallery:['data/frames/owner/f_0002.jpg']}), 'data/frames/owner/f_0002.jpg');
 assert.equal(propertyCover({clip:'other'}, {clip_id:'other',frame_count:2}), 'data/frames/other/f_0001.jpg');
 assert.equal(propertyCover({}), '');
});
