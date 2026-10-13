import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentDuration, sourceTime, splitSegment, joinOverlap, missingSources, highlightSuggestions, analysisCaption} from './studio.logic.js';
test('reverse split preserves playback order and speed', () => {
 const s = {a:2,b:12,speed:2,reverse:true,title:'Title'};
 const [left,right] = splitSegment(s,2);
 assert.equal(sourceTime(left,0),12);
 assert.equal(sourceTime(left,segmentDuration(left)),8);
 assert.equal(sourceTime(right,0),8);
 assert.equal(sourceTime(right,segmentDuration(right)),2);
 assert.equal(segmentDuration(left)+segmentDuration(right),5);
 assert.equal(right.title,'');
});
test('freeze split preserves its source frame', () => {
 const halves=splitSegment({a:3,b:10,speed:1,freeze:5},2);
 assert.deepEqual(halves.map(segmentDuration),[2,3]);
 assert.deepEqual(halves.map(s=>sourceTime(s,1)),[3,3]);
});
test('transition timing matches exporter mixed and hard cuts', () => {
 const cuts=[{a:0,b:5,speed:1,transition:'none'},{a:0,b:5,speed:1,transition:'dissolve',transDur:.4},{a:0,b:5,speed:1,transition:'none'}];
 assert.equal(joinOverlap(cuts,1),.4);
 assert.equal(joinOverlap(cuts,2),.04);
 cuts[1].transition='none'; assert.equal(joinOverlap(cuts,2),0);
});
test('missing sources block recovery without discarding saved clips', () => {
 const p={tl:[{clip_id:'a'},{clip_id:'b'}]};
 assert.equal(missingSources(p,{a:{}}),1); assert.equal(p.tl.length,2);
});
test('AI moments use exact insight bounds, short captions, and full descriptions', () => {
 const caption = 'Una vista cenital de una casa entre árboles.';
 const [h] = highlightSuggestions([{clip_id:'a',duration_s:30}], {a:{
   caption, caption_short:'Casa entre árboles',
   highlight_segments:[{start:4,end:19,score:.8,reason:'La casa ocupa el encuadre.'}]
 }});
 assert.deepEqual([h.a,h.b,h.caption,h.description,h.score], [4,19,'Casa entre árboles',caption,.8]);
});
test('AI rejects invalid bounds and does not use legacy highlight timestamps', () => {
 const flights = [{clip_id:'a',duration_s:30}];
 assert.deepEqual(highlightSuggestions(flights,{a:{highlights:[{t:5}]}}), []);
 const segments = [{start:-1,end:3}, {start:4,end:31}, {start:4,end:4},
   {start:'2',end:3}, {start:0,end:Infinity}, {start:NaN,end:4}];
 assert.deepEqual(highlightSuggestions(flights,{a:{highlight_segments:segments.map(h=>({...h,score:.5}))}}), []);
});
test('AI ranks moments by segment score and keeps the ten highest', () => {
 const highlight_segments = Array.from({length:12}, (_,i)=>({start:i,end:i+1,score:i/12}));
 const moments = highlightSuggestions([{clip_id:'a',duration_s:30}], {a:{highlight_segments}});
 assert.equal(moments.length,10);
 assert.equal(moments[0].a,11);
 assert.equal(moments[9].a,2);
});
test('AI captions use neutral subjects if an older insight has no short caption', () => {
 const [h] = highlightSuggestions([{clip_id:'a',duration_s:30}], {a:{
   caption:'Excelente panorámica de Bogotá y los Cerros Orientales.',
   highlight_segments:[{start:0,end:4,score:.5}]
 }});
 assert.equal(h.caption,'Plano abierto: Ciudad · Montañas');
});
test('AI subject captions stay under 60 characters for dense descriptions', () => {
 const caption=analysisCaption('Una vista espectacular de la ciudad, edificios, tejados, montañas, calles, tráfico, árboles y cielo.');
 assert.ok(caption.length<=60);
 assert.doesNotMatch(caption,/espectacular|excelente|majestuos/i);
 assert.equal(analysisCaption(''), 'Momento del vuelo');
 assert.equal(analysisCaption('Árboles junto al lago al amanecer.'),'Vegetación · Lago · Amanecer');
});
test('AI captions retain the shot and common rural subjects without praise', () => {
 assert.equal(analysisCaption('Excelente panorámica de Bogotá y los Cerros Orientales.'),'Plano abierto: Ciudad · Montañas');
 assert.equal(analysisCaption('La casa y las personas en el patio crean una imagen acogedora.'),'Casa · Personas');
 assert.equal(analysisCaption('Vista amplia del valle y las colinas.'),'Valle · Colinas');
});

test('Studio and the shell share the same UI module instances', async () => {
 const {readFile} = await import('node:fs/promises');
 const studio = await readFile(new URL('./studio.js',import.meta.url),'utf8');
 const shell = await readFile(new URL('./shell.js',import.meta.url),'utf8');
 for (const name of ['sheet','toast','palette']) {
   const pattern = new RegExp(`\\./ui/${name}\\.js\\?v=\\d+`);
   assert.equal(studio.match(pattern)?.[0],shell.match(pattern)?.[0],name);
 }
});
