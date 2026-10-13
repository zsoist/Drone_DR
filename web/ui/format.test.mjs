import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt } from './format.js';
import { term } from './terms.js';
test('Colombian figures and explicit units', () => {
  assert.equal(fmt.number(1200), '1.200');
  assert.equal(fmt.number(1234.56, 1), '1.234,6');
  assert.equal(fmt.distance(999), '999 m');
  assert.equal(fmt.distance(1000), '1,0 km');
  assert.equal(fmt.distance(10880), '10,9 km');
  assert.equal(fmt.area(16.24), '16,2 ha');
  assert.equal(fmt.shutter('1/400.0'), '1/400');
  assert.equal(fmt.shutter(1 / 400), '1/400');
  assert.equal(fmt.shutter(2), '2 s');
});
test('duration and media clock carry without 60-second fields', () => {
  assert.equal(fmt.duration(219), '3 min 39 s');
  assert.equal(fmt.duration(4800), '1 h 20 min');
  assert.equal(fmt.duration(59.9), '1 min');
  assert.equal(fmt.clock(59.9), '1:00');
  assert.equal(fmt.clock(3600), '1:00:00');
  assert.equal(fmt.duration(-2), '0 s');
  assert.equal(fmt.duration(0), '0 s');
});
test('calendar dates retain their Colombian day; relative time uses milliseconds', () => {
  assert.equal(fmt.date('2026-07-24'), '24 jul 2026');
  assert.equal(fmt.date('2026-07-24T02:00:00Z'), '23 jul 2026');
  assert.equal(fmt.relative('2026-07-24T10:00:00Z', '2026-07-24T12:00:00Z'), 'hace 2 h');
  assert.equal(fmt.relative('2026-07-24T14:00:00Z', '2026-07-24T12:00:00Z'), 'dentro de 2 h');
  assert.equal(fmt.date('invalid'), '');
});
test('missing values do not become invented zero measurements', () => {
  for (const value of [null, undefined, '', NaN, Infinity]) {
    for (const key of ['number', 'duration', 'clock', 'distance', 'area', 'shutter']) assert.equal(fmt[key](value), '—', key);
  }
  assert.equal(fmt.shutter('1/0'), '—');
  assert.equal(term('splat'), 'Escena fotorrealista');
  assert.equal(term('frontier'), 'Detalle avanzado');
  assert.equal(term('gateRush'), 'Carrera de aros');
});
