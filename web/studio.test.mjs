import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentDuration, sourceTime, splitSegment, joinOverlap, missingSources, highlightSuggestions} from './studio.logic.js';
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
test('AI accepts only stored, finite highlights within source bounds', () => {
 const f=[{clip_id:'a',duration_s:3}];
 assert.equal(highlightSuggestions(f,{}).length,0);
 assert.deepEqual(highlightSuggestions(f,{a:{highlights:[{t:0},{t:'bad'},{t:100}]}}).map(s=>[s.a,s.b]),[[0,2.5]]);
});
