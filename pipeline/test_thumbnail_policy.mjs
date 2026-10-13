import test from 'node:test';
import assert from 'node:assert/strict';
import * as media from '../web/ui/thumbnail.js';
import { galleryFrames, propertyCover } from '../web/p.logic.js';
import { bestCover } from '../web/home.ai.js';

test('private thumbnails use the API choice and do not require quality metadata', () => {
  assert.equal(media.thumbnailURL({clip_id:'clip', thumbnail_url:'/data/frames/clip/f_0003.jpg'}), '/data/frames/clip/f_0003.jpg');
  assert.equal(media.thumbnailURL({clip_id:'clip'}), '/data/thumbs/clip.jpg');
  assert.equal(media.thumbnailURL({clip_id:'clip', thumbnail_url:'/data/frames/other/f_0001.jpg'}), '/data/thumbs/clip.jpg');
});
test('featured Home covers still require approval', async () => {
  assert.equal(await bestCover({clip_id:'clip'}, {cover:{clip_id:'clip', frame_url:'/data/frames/clip/f_0001.jpg'}}), null);
});
test('property uses approved API cover and gallery objects including linked clips', () => {
  const frame = (clip, n, status='ok') => ({width:1920, clip_id:clip, frame_time_s:n*20, frame_url:`/data/frames/${clip}/f_000${n}.jpg`, quality:{status}});
  const property = {clip:'clip', clips:['linked'], cover:frame('linked', 1), gallery:[frame('clip',1),frame('linked',2),frame('clip',3,'rejected')]};
  assert.equal(propertyCover(property), '/data/frames/linked/f_0001.jpg');
  assert.deepEqual(galleryFrames(property), []);
  property.gallery.push(frame('clip',4),frame('clip',5));
  assert.equal(galleryFrames(property).length, 4);
  assert.deepEqual(galleryFrames({clip:'clip',gallery:['data/frames/clip/f_0001.jpg']}), []);
});

test('property never enlarges a list thumbnail', () => {
  assert.equal(propertyCover({clip:'clip'}), '');
  assert.equal(propertyCover({clip:'clip',cover:{clip_id:'clip',width:540,frame_url:'/data/thumbs/clip.jpg'}}), '');
});
