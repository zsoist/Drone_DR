// Tour (WS E): esquema de POIs, spline Catmull-Rom/Hermite, máscaras y auditoría de los JSON reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  validatePoiDoc, buildTimeline, makeTimedSpline, maskField, pushOutOfMasks, insideAnyMask,
  masksInCone, auditTimeline, TOUR_LIMITS,
} from '../web/flightverse/tour/poi.js';

const good = () => ({
  world: 'w',
  speed: 7,
  pois: Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`, name: `Punto ${i}`, short: 'Descripción corta.',
    spline: [[i * 60, 40, 0], [i * 60 + 20, 42, 25]], look: [i * 60 + 10, 10, 60],
    dwell: 4, fov: 55, tod: 'dorada', mask: [],
  })),
  masks: [{ id: 'm1', type: 'sphere', c: [500, 10, 0], r: 30, why: 'malla rota' }],
  edge: { fog: [250, 420], warn: 380 },
});

test('esquema: documento válido pasa; 5-8 POIs; ids únicos', () => {
  const r = validatePoiDoc(good());
  assert.equal(r.ok, true, r.errors.join('; '));
  const few = good(); few.pois.length = 4;
  assert.match(validatePoiDoc(few).errors.join(), /5-8/);
  const many = good(); while (many.pois.length < 9) many.pois.push({ ...many.pois[0], id: `x${many.pois.length}` });
  assert.equal(validatePoiDoc(many).ok, false);
  const dup = good(); dup.pois[1].id = 'p0';
  assert.match(validatePoiDoc(dup).errors.join(), /duplicado/);
});

test('esquema: campos inválidos se reportan con su ruta', () => {
  const bad = good();
  bad.pois[0].spline = [[1, 2, 3]];
  bad.pois[1].look = [1, 2];
  bad.pois[2].dwell = 99;
  bad.pois[3].fov = 10;
  bad.pois[4].tod = 'mediodia';
  bad.pois[0].name = '  ';
  bad.masks[0].type = 'cono';
  bad.edge = { fog: [400, 100] };
  const e = validatePoiDoc(bad).errors.join('\n');
  for (const frag of ['pois[0].spline', 'pois[1].look', 'pois[2].dwell', 'pois[3].fov', 'pois[4].tod',
    'pois[0].name', 'masks[0].type', 'edge.fog']) assert.match(e, new RegExp(frag.replace(/[[\]]/g, '\\$&')), frag);
  assert.equal(validatePoiDoc(null).ok, false);
  assert.equal(validatePoiDoc({ world: 'w', pois: 'x' }).ok, false);
});

test('esquema: t creciente y sin mezclar puntos con/sin t; mask referencia ids existentes', () => {
  const d = good();
  d.pois[0].spline = [[0, 40, 0, 0], [10, 40, 10, 4], [20, 40, 20, 3]];
  assert.match(validatePoiDoc(d).errors.join(), /no es creciente/);
  const m = good(); m.pois[0].spline = [[0, 40, 0, 0], [10, 40, 10]];
  assert.match(validatePoiDoc(m).errors.join(), /mezcla/);
  const r = good(); r.pois[0].mask = ['fantasma'];
  assert.match(validatePoiDoc(r).errors.join(), /inexistente/);
});

test('spline: pasa por los puntos de control y es continua (C0) y suave (sin saltos de velocidad)', () => {
  const pts = [[0, 0, 0], [40, 10, 0], [80, 10, 40], [80, 30, 90]];
  const times = [0, 5, 11, 18];
  const s = makeTimedSpline(pts, times);
  pts.forEach((p, i) => {
    const q = s(times[i]);
    p.forEach((v, c) => assert.ok(Math.abs(v - q[c]) < 1e-9, `pasa por P${i}`));
  });
  let prev = s(0), maxJump = 0, maxAcc = 0, pv = null;
  for (let t = 0.05; t <= 18; t += 0.05) {
    const q = s(t);
    const v = q.map((x, c) => (x - prev[c]) / 0.05);
    maxJump = Math.max(maxJump, Math.hypot(...v));
    if (pv) maxAcc = Math.max(maxAcc, Math.hypot(...v.map((x, c) => x - pv[c])) / 0.05);
    pv = v; prev = q;
  }
  assert.ok(maxJump < 14, `velocidad acotada (${maxJump.toFixed(1)})`);
  assert.ok(maxAcc < 30, `aceleración acotada, sin esquinas (${maxAcc.toFixed(1)})`);
});

test('spline en bucle cierra sin costura', () => {
  const pts = [[0, 0, 0], [50, 0, 0], [50, 0, 50], [0, 0, 50]];
  const times = [0, 6, 12, 18];
  const s = makeTimedSpline(pts, times, { loop: true, total: 24 });
  const a = s(0), b = s(24 - 1e-6);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3);
  const wrap = s(24 + 3), same = s(3);
  assert.ok(Math.hypot(wrap[0] - same[0], wrap[1] - same[1], wrap[2] - same[2]) < 1e-6);
});

test('timeline: velocidad 6-9 m/s, dwell respetado, muestreo por POI y tránsito', () => {
  const doc = good();
  const tl = buildTimeline(doc, { speed: 7 });
  assert.equal(tl.n, 5);
  assert.ok(tl.total > 20);
  let prev = tl.sample(0).pos, peak = 0;
  for (let t = 0.25; t < tl.total; t += 0.25) {
    const p = tl.sample(t).pos;
    peak = Math.max(peak, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / 0.25);
    prev = p;
  }
  assert.ok(peak <= 7 * 1.3, `pico ${peak.toFixed(1)} m/s`);
  tl.sections.forEach((s, i) => assert.ok(s.end - s.start >= doc.pois[i].dwell - 1e-9, `dwell POI ${i}`));
  const inPoi = tl.sample((tl.sections[2].start + tl.sections[2].end) / 2);
  assert.equal(inPoi.phase, 'poi'); assert.equal(inPoi.poi, 2);
  assert.deepEqual(inPoi.look, doc.pois[2].look);
  const between = tl.sample((tl.sections[1].end + tl.sections[2].start) / 2);
  assert.equal(between.phase, 'transit');
  assert.ok(between.fov >= 50 && between.fov <= 60);
  // el sample envuelve (loop)
  const a = tl.sample(1.5).pos, b = tl.sample(tl.total + 1.5).pos;
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6);
});

test('máscaras: esfera y caja dan distancia con signo y empujan hacia fuera con margen', () => {
  const sph = { id: 's', type: 'sphere', c: [0, 0, 0], r: 10, why: 'x' };
  assert.ok(maskField(sph, [0, 0, 0]).d < 0);
  assert.ok(Math.abs(maskField(sph, [15, 0, 0]).d - 5) < 1e-9);
  const out = pushOutOfMasks([3, 0, 0], [sph], 2);
  assert.ok(Math.hypot(...out) >= 12 - 1e-9, 'queda a r+margen');
  assert.ok(out[0] > 0, 'empuja a lo largo del gradiente (mismo lado)');
  const box = { id: 'b', type: 'box', c: [100, 0, 0], size: [20, 20, 20], why: 'x' };
  assert.ok(maskField(box, [100, 0, 0]).d < 0);
  assert.ok(Math.abs(maskField(box, [120, 0, 0]).d - 10) < 1e-9);
  const pb = pushOutOfMasks([104, 0, 0], [box], 1);
  assert.ok(maskField(box, pb).d >= 1 - 1e-9);
  assert.equal(insideAnyMask([0, 0, 0], [sph]), true);
  assert.equal(insideAnyMask([50, 0, 0], [sph, box]), false);
  // varias máscaras: la salida no cae dentro de la otra
  const a = { id: 'a', type: 'sphere', c: [0, 0, 0], r: 10, why: 'x' };
  const b = { id: 'b', type: 'sphere', c: [14, 0, 0], r: 10, why: 'x' };
  const p = pushOutOfMasks([7, 0, 0], [a, b], 1);
  assert.ok(!insideAnyMask(p, [a, b], 0.9));
});

test('cono de encuadre: un centro de máscara dentro de 40° se detecta; fuera o detrás no', () => {
  const m = { id: 'm', type: 'sphere', c: [100, 0, 0], r: 10, why: 'x' };
  const cam = [0, 0, 0];
  assert.deepEqual(masksInCone(cam, [50, 0, 0], [m]), ['m']);
  assert.deepEqual(masksInCone(cam, [50, 0, 10], [m]), ['m'], 'a 11° sigue dentro de ±20°');
  assert.deepEqual(masksInCone(cam, [0, 0, 50], [m]), [], 'a 90° fuera');
  assert.deepEqual(masksInCone(cam, [-50, 0, 0], [m]), [], 'detrás');
});

test('auditTimeline: detecta máscara, AGL bajo y borde', () => {
  const doc = good();
  doc.masks = [{ id: 'cerca', type: 'sphere', c: [10, 41, 12], r: 6, why: 'x' }];
  const tl = buildTimeline(doc);
  const a = auditTimeline(tl, doc, { heightAt: () => 38, minAgl: 12 });
  assert.ok(a.mask.length > 0, 'cámara dentro de la máscara');
  assert.ok(a.agl.length > 0, 'AGL < 12 (40-38=2)');
  const b = auditTimeline(tl, doc, { heightAt: () => 0, metricFn: x => x, maxMetric: 100 });
  assert.ok(b.edge.length > 0, 'pasa de 100 m del centro');
  assert.equal(b.agl.length, 0);
  assert.ok(b.speed > 0);
});

test('JSON reales de web/assets/tour: esquema válido, 5-8 POIs en español, sin emojis', () => {
  const dir = new URL('../web/assets/tour/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.ok(files.length >= 2, 'al menos Dialectica y Casa orbital');
  assert.ok(files.includes('recon_4e4245a1f4_aoi130.json') && files.includes('recon_b2fbe03239.json'));
  for (const f of files) {
    const doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const r = validatePoiDoc(doc);
    assert.equal(r.ok, true, `${f}: ${r.errors.join('; ')}`);
    assert.equal(`${doc.world}.json`, f);
    assert.ok(doc.pois.length >= 5 && doc.pois.length <= 8, f);
    for (const p of doc.pois) {
      assert.ok(/[áéíóúñ]|\s/.test(p.name + p.short), 'textos en español');
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(p.name + p.short), 'sin emojis');
      assert.ok(p.short.length <= 90, `${f}/${p.id} short largo`);
      assert.ok(p.fov >= TOUR_LIMITS.fovMin && p.fov <= TOUR_LIMITS.fovMax, `${f}/${p.id} fov`);
    }
    const tl = buildTimeline(doc);
    assert.ok(tl.total > 30 && tl.total < 400);
    const a = auditTimeline(tl, doc, {});
    assert.equal(a.mask.length, 0, `${f}: cámara dentro de una máscara`);
    assert.equal(a.cone.length, 0, `${f}: máscara dentro del cono de un POI`);
    assert.ok(a.speed <= 7.5 * 1.35, `${f}: velocidad ${a.speed}`);
  }
});

test('assets/tour/index.json lista exactamente los mundos con JSON (sin 404 en consola para el resto)', () => {
  const dir = new URL('../web/assets/tour/', import.meta.url);
  const idx = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.replace(/\.json$/, '')).sort();
  assert.deepEqual([...idx.worlds].sort(), files);
});
