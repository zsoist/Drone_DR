import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentDuration, sourceTime, splitSegment, joinOverlap, missingSources, clipCaption, highlightSuggestions, analysisCaption, reelPosition, approvedFrameURL} from './studio.logic.js';
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
test('AI titles retain the stored caption when no short caption exists', () => {
 const [h] = highlightSuggestions([{clip_id:'a',duration_s:30}], {a:{
   caption:'Vista de Bogotá y los Cerros Orientales.',
   highlight_segments:[{start:0,end:4,score:.5}]
 }});
 assert.equal(h.caption,'Vista de Bogotá y los Cerros Orientales.');
});
test('clip titles prefer owner data, then captions, never highlight labels', () => {
 const insight={caption_short:'Edificio entre árboles',caption:'Un edificio entre árboles junto a la calle.',highlights:[{label:'Cambio de escena'}]};
 assert.equal(clipCaption({label:'Mi oficina'},insight),'Mi oficina');
 assert.equal(clipCaption({},insight),'Edificio entre árboles');
 assert.equal(clipCaption({ai:{caption_short:'Río junto al bosque'}},null),'Río junto al bosque');
 assert.equal(clipCaption({}, {highlights:insight.highlights}), '');
});
test('reel cuts retain unequal and fractional API spans through preview and timeline', () => {
 const moments=highlightSuggestions([{clip_id:'a',duration_s:80}], {a:{caption_short:'Río entre montañas',
   highlight_segments:[{start:2.25,end:5.75,score:.9},{start:20,end:31,score:.8},{start:55,end:72.5,score:.7}]}});
 assert.deepEqual(moments.map(h=>[h.a,h.b]),[[2.25,5.75],[20,31],[55,72.5]]);
 assert.deepEqual(moments.map(h=>segmentDuration({...h,speed:1})),[3.5,11,17.5]);
 assert.equal(reelPosition(moments,14.5).source,55);
 assert.equal(reelPosition(moments,32).source,72.5);
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

test('assembled reel seek uses clip boundaries and trims, not source durations', () => {
 const cuts=[{a:98,b:115},{a:18,b:24},{a:20,b:31}];
 assert.deepEqual(reelPosition(cuts,0),{index:0,offset:0,time:0,total:34,source:98});
 assert.deepEqual(reelPosition(cuts,17),{index:1,offset:17,time:17,total:34,source:18});
 assert.deepEqual(reelPosition(cuts,25),{index:2,offset:23,time:25,total:34,source:22});
 assert.equal(reelPosition(cuts,-3).source,98);
 assert.equal(reelPosition(cuts,100).source,31);
 assert.equal(reelPosition([],0),null);
});
test('reel seek preserves fractional cut durations and the last frame', () => {
 const cuts=[{a:2.25,b:5.75},{a:20.1,b:22.6}];
 assert.equal(reelPosition(cuts,3.5).index,1);
 assert.equal(reelPosition(cuts,3.5).source,20.1);
 assert.equal(reelPosition(cuts,6).source,22.6);
});

test('automatic frames require positive backend quality evidence and local media URLs', () => {
 const frame = {frame_url:'/data/frames/clip/f_0001.jpg', quality:{eligible:true}};
 assert.equal(approvedFrameURL(frame),frame.frame_url);
 for (const bad of [null, {frame_url:frame.frame_url}, {...frame,quality:{eligible:false}},
   {...frame,quality:{eligible:'true'}}, {...frame,frame_url:'https://example.com/frame.jpg'}]) {
   assert.equal(approvedFrameURL(bad),'');
 }
});
test('reel suggestions exclude synthetic moments and uniform sampling-grid ranges', () => {
 const flights=[{clip_id:'a',duration_s:120}];
 const insight={sampled_frame_times:[0,30,60,90],highlight_segments:[
   {start:0,end:30,score:.8},{start:60,end:90,score:.9}]};
 assert.deepEqual(highlightSuggestions(flights,{a:insight}),[]);
 insight.highlight_segments[1].end=85;
 assert.equal(highlightSuggestions(flights,{a:insight}).length,2);
 assert.deepEqual(highlightSuggestions(flights,{a:{...insight,synthetic:true}}),[]);
 insight.highlight_segments[0].synthetic=true;
 assert.equal(highlightSuggestions(flights,{a:insight}).length,1);
});
