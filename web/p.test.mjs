import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryFrames, propertyCover, propertyDescription } from './p.logic.js';
const frame = (n, time=n*12, quality={status:'ok',eligible:true,reasons:[]}) => ({clip_id:'clip',frame_url:`/data/frames/clip/f_${String(n).padStart(4,'0')}.jpg`,frame_time_s:time,quality});
test('unreviewed, dark, text, person, and unrelated frames fail closed',()=>{
 const candidates=[frame(1,0,undefined),frame(2,12,{eligible:false,reasons:['dark_frame']}),frame(3,24,{eligible:true,reasons:['text_or_sign']}),frame(4,36,{eligible:false,reasons:['person']}),{...frame(5),clip_id:'other'},frame(6)];
 delete candidates[0].quality;
 // only one approved frame: below the 4-frame minimum, so the gallery hides (QA R5)
 assert.deepEqual(galleryFrames({clip:'clip',gallery:candidates}),[]);
 assert.deepEqual(galleryFrames({clip:'clip',gallery:[...candidates,frame(7,90),frame(8,110),frame(9,130)]}),
  ['/data/frames/clip/f_0006.jpg','/data/frames/clip/f_0007.jpg','/data/frames/clip/f_0008.jpg','/data/frames/clip/f_0009.jpg']);
 assert.equal(propertyCover({clip:'clip'},[]),'data/thumbs/clip.jpg');   // owner clip thumbnail
 assert.equal(propertyCover({}),'');
 assert.deepEqual(galleryFrames({clip:'clip'}, {frame_count:100}),[]);
});
test('gallery uses reviewed URLs, limits six views, and spaces their times',()=>{
 const frames=[frame(1,0),frame(2,1),...Array.from({length:10},(_,i)=>frame(i+3,(i+1)*12))];
 const result=galleryFrames({clip:'clip',gallery:frames});
 assert.equal(result.length,6);
 assert.ok(!result.includes('/data/frames/clip/f_0002.jpg'));
 assert.deepEqual(galleryFrames({clip:'clip',gallery:[]},frames),[]);
 assert.deepEqual(galleryFrames({clip:'clip',gallery:[frame(3)]}),[]);   // fewer than 4 → hidden
});
test('saved galleries cannot bypass quality or permit external URLs',()=>{
 assert.deepEqual(galleryFrames({clip:'clip',gallery:['data/frames/clip/f_0001.jpg']},[]),[]);
 assert.equal(propertyCover({clip:'clip',cover:{...frame(1),frame_url:'https://bad.test/a.jpg'}}),'data/thumbs/clip.jpg');
});
test('legacy description loses repeated observation wording without changing owner copy',()=>{
 const descripcion='El entorno visible incluye un valle. Se observa una calle entre las construcciones. Se observan montañas en el paisaje.';
 assert.equal(propertyDescription({descripcion,descripcion_source:'owner'}),descripcion);
 assert.equal(propertyDescription({descripcion,descripcion_source:'ai_template'}),'El paisaje combina un valle y montañas. Una calle pasa entre las construcciones.');
});
test('property cover uses the approved API object without an insight request',()=>{
 assert.equal(propertyCover({clip:'clip',cover:{...frame(1),width:1920}}),'/data/frames/clip/f_0001.jpg');
 assert.equal(propertyCover({clip:'clip',cover:frame(1)}),'data/thumbs/clip.jpg');   // no full-resolution frame yet
 assert.equal(propertyCover({clip:'clip',cover:{...frame(1),quality:null}}),'data/thumbs/clip.jpg');
});
