import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueSceneNames } from './display-name.js';

const flights = [
  { clip_id: 'DJI_20260704160358_0104_D', place: 'Bogotá', date: '2026-07-04', time: '16:03:58' },
  { clip_id: 'DJI_20260706133809_0101_D', place: 'Bogotá', date: '2026-07-06', time: '13:38:09' },
];
const src = scene => [scene.clip_id];

test('generic stored names become place and date; real names stay', () => {
  const names = uniqueSceneNames([
    { clip_id: 'DJI_20260706133809_0101_D', name: 'Escena 0101' },
    { clip_id: 'x', name: 'Casa orbital' },
  ], flights, { sourcesOf: src });
  assert.match(names.get('DJI_20260706133809_0101_D'), /^Bogotá · 6 jul/);
  assert.equal(names.get('x'), 'Casa orbital');
});

test('every scene gets a unique name, so Escenas and Mundo agree', () => {
  const scenes = [
    { clip_id: 'DJI_20260704160358_0104_D', name: 'Render ultra 4 jul 2026 16:03' },
    { clip_id: 'DJI_20260704160358_0104_D', name: 'Render ultra 4 jul 2026 16:03' },
  ];
  const names = [...uniqueSceneNames(scenes.map((s, i) => ({ ...s, clip_id: s.clip_id + i })),
    flights.map(f => ({ ...f, clip_id: f.clip_id })), { sourcesOf: s => [s.clip_id.slice(0, -1)] }).values()];
  assert.equal(new Set(names).size, names.length);
});
