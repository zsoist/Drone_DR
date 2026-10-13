import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCover } from '../web/home.ai.js';
import { jobRelativeTime, systemRelativeTime } from '../web/system.logic.js';

const flight = { clip_id: 'test_flight' };
const frame = { clip_id: flight.clip_id, frame_url: '/data/frames/test_flight/f_0078.jpg', frame_time_s: 154, quality: { eligible: true } };

test('the hero keeps the selected frame and its own description together', async () => {
  const cover = await bestCover(flight, { caption_short: 'Opening facade', cover: { ...frame, caption_short: 'Skyline above the city' } });
  assert.equal(cover.url, frame.frame_url);
  assert.equal(cover.time, 154);
  assert.equal(cover.caption, 'Skyline above the city');
});

test('a copied opening caption uses the full description of the same clip', async () => {
  const cover = await bestCover(flight, { caption_short: 'Opening facade', caption: 'The flight starts at a facade and then shows the skyline.', cover: { ...frame, caption_short: 'Opening facade' } });
  assert.equal(cover.caption, 'The flight starts at a facade and then shows the skyline.');
});

test('another clip cannot supply a hero image or caption', async () => {
  assert.equal(await bestCover(flight, { cover: { ...frame, clip_id: 'another_flight' } }), null);
});

test('job and sample ages use the same units at each boundary', () => {
  const now = 2e12;
  for (const [seconds, label] of [[2, '2 s'], [120, '2 min'], [7200, '2 h'], [172800, '2 d'], [2592000, '1 mes'], [5184000, '2 meses'], [31536000, '1 año']]) {
    assert.equal(systemRelativeTime(now - seconds * 1000, now), `hace ${label}`);
    assert.equal(jobRelativeTime({ status: 'done', finished: now / 1000 - seconds }, now), `hace ${label}`);
  }
  assert.equal(jobRelativeTime({ status: 'queued', started: now / 1000 + 60 }, now), 'en cola');
  assert.equal(jobRelativeTime({ status: 'done' }, now), 'sin fecha');
});

test('the reviewed skyline description applies only to its exact image', async () => {
  const clip_id = 'DJI_20260724162423_0219_D';
  const cover = { ...frame, clip_id, frame_url: `/data/frames/${clip_id}/f_0078.jpg`, caption: 'Clip description' };
  assert.equal((await bestCover({ clip_id }, { cover })).caption, 'Edificios y montañas bajo un cielo parcialmente nublado.');
  assert.equal((await bestCover({ clip_id }, { cover: { ...cover, frame_url: `/data/frames/${clip_id}/f_0079.jpg` } })).caption, 'Clip description');
});

test('legacy clips with only a short description keep their caption', async () => {
  assert.equal((await bestCover(flight, { cover: frame, caption_short: 'Edificios y montañas' })).caption, 'Edificios y montañas');
});
