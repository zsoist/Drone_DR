import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryFrames, propertyCover, propertyDescription, propertyMedia } from './p.logic.js';
const frame = (n, time=n*12, quality={eligible:true,reasons:[]}) => ({clip_id:'clip',frame_url:`/data/frames/clip/f_${String(n).padStart(4,'0')}.jpg`,frame_time_s:time,quality});
test('unreviewed, dark, text, person, and unrelated frames fail closed',()=>{
 const candidates=[frame(1,0,undefined),frame(2,12,{eligible:false,reasons:['dark_frame']}),frame(3,24,{eligible:true,reasons:['text_or_sign']}),frame(4,36,{eligible:false,reasons:['person']}),{...frame(5),clip_id:'other'},frame(6)];
 delete candidates[0].quality;
 assert.deepEqual(galleryFrames({clip:'clip'},candidates),['data/frames/clip/f_0006.jpg']);
 assert.equal(propertyCover({clip:'clip'},[]),'');
 assert.deepEqual(galleryFrames({clip:'clip'}, {frame_count:100}),[]);
});
test('gallery uses reviewed URLs, limits six views, and spaces their times',()=>{
 const frames=[frame(1,0),frame(2,1),...Array.from({length:10},(_,i)=>frame(i+3,(i+1)*12))];
 const result=galleryFrames({clip:'clip'},frames);
 assert.equal(result.length,6);
 assert.ok(!result.includes('data/frames/clip/f_0002.jpg'));
 assert.deepEqual(galleryFrames({clip:'clip',gallery:[]},frames),[]);
 assert.deepEqual(galleryFrames({clip:'clip',gallery:['data/frames/clip/f_0003.jpg']},frames),['data/frames/clip/f_0003.jpg']);
});
test('saved galleries cannot bypass quality or permit external URLs',()=>{
 assert.deepEqual(galleryFrames({clip:'clip',gallery:['data/frames/clip/f_0001.jpg']},[]),[]);
 assert.equal(propertyCover({clip:'clip'},[{...frame(1),frame_url:'https://bad.test/a.jpg'}]),'');
});
test('legacy description loses repeated observation wording without changing owner copy',()=>{
 const descripcion='El entorno visible incluye un valle. Se observa una calle entre las construcciones. Se observan montañas en el paisaje.';
 assert.equal(propertyDescription({descripcion,descripcion_source:'owner'}),descripcion);
 assert.equal(propertyDescription({descripcion,descripcion_source:'ai_template'}),'El paisaje combina un valle y montañas. Una calle pasa entre las construcciones.');
});
test('missing quality fields never produce automatic media from an old API response',async()=>{
 assert.deepEqual(await propertyMedia('clip',async()=>({ok:true,json:async()=>({cover:null})})),[]);
 assert.deepEqual(await propertyMedia('clip',async()=>({ok:true,json:async()=>({cover:frame(1)})})),[frame(1)]);
 await assert.rejects(propertyMedia('clip',async()=>({ok:false})),/imágenes/);
});
