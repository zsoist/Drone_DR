#!/usr/bin/env node
// Validador OFFLINE de los POIs del Tour (spec §10/§15.3 E): esquema, velocidad, máscaras (posición y
// cono 40°), AGL >= 12 m, distancia >= 6 m a la superficie DSM y borde (fog[1]). Usa el DSM del vault
// (web/data/models/<cid>/dsm_lod256.bin) como geometría. Exit != 0 si hay violaciones.
//   node pipeline/validate_tour_pois.mjs [cid ...]     (por defecto: todos los web/assets/tour/*.json)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePoiDoc, buildTimeline, auditTimeline, TOUR_LIMITS } from '../web/flightverse/tour/poi.js';
import { resolveEdge, boundaryExtent } from '../web/flightverse/tour/edge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDsm(cid) {
  const dir = path.join(ROOT, 'web/data/models', cid);
  const metaP = path.join(dir, 'dsm_lod.json');
  if (!existsSync(metaP)) return null;
  const meta = JSON.parse(readFileSync(metaP, 'utf8'));
  const buf = readFileSync(path.join(dir, meta.bin || 'dsm_lod256.bin'));
  const hf = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const [rows, cols] = meta.grid;
  const [sx, sz] = meta.spacing_m;
  const W = sx * (cols - 1), H = sz * (rows - 1);
  const heightAt = (x, z) => {
    const fx = (x + W / 2) / sx, fz = (z + H / 2) / sz;
    if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return null;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, cols - 1), z1 = Math.min(z0 + 1, rows - 1);
    const tx = fx - x0, tz = fz - z0;
    const n = hf[z0 * cols + x0] * (1 - tx) + hf[z0 * cols + x1] * tx;
    const south = hf[z1 * cols + x0] * (1 - tx) + hf[z1 * cols + x1] * tx;
    return n * (1 - tz) + south * tz - meta.elev_min;
  };
  const maskP = path.join(dir, meta.mask_bin || 'dsm_lod256.mask.bin');
  const mask = existsSync(maskP) ? readFileSync(maskP) : null;
  const validAt = (x, z) => {
    if (!mask) return true;
    const c = Math.round((x + W / 2) / sx), r = Math.round((z + H / 2) / sz);
    return c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c] > 0;
  };
  /** distancia mínima de un punto a la superficie DSM en un radio (muestreo de celdas). */
  const surfaceDistance = (x, y, z, radius = 8) => {
    let best = Infinity;
    for (let dz = -radius; dz <= radius; dz += sz) {
      for (let dx = -radius; dx <= radius; dx += sx) {
        const h = heightAt(x + dx, z + dz);
        if (h == null) continue;
        const d = Math.hypot(dx, dz, y - h);
        if (d < best) best = d;
      }
    }
    return best;
  };
  return { meta, heightAt, validAt, surfaceDistance, nativeHalf: Math.min(...meta.size_m) / 2 };
}

export function validateWorld(cid) {
  const docP = path.join(ROOT, 'web/assets/tour', `${cid}.json`);
  const doc = JSON.parse(readFileSync(docP, 'utf8'));
  const res = { cid, schema: validatePoiDoc(doc), violations: [], stats: {} };
  if (!res.schema.ok) return res;
  const dsm = loadDsm(cid);
  const tl = buildTimeline(doc);
  const boundary = { shape: 'circle', radius: dsm ? dsm.nativeHalf : 1e9 };
  const edge = resolveEdge(doc.edge, boundary, boundary.radius);
  res.stats = { total_s: +tl.total.toFixed(1), speed_mps: tl.speed, pois: doc.pois.length, masks: (doc.masks || []).length, edge };
  const audit = auditTimeline(tl, doc, {
    heightAt: dsm?.heightAt || null, stepS: 0.25, minAgl: TOUR_LIMITS.minAgl,
    metricFn: dsm ? (x, z) => Math.hypot(x, z) : null, maxMetric: edge.fog[1] - 2,
  });
  res.stats.maxSpeed_mps = audit.speed;
  for (const k of ['mask', 'cone', 'agl', 'edge']) for (const v of audit[k]) res.violations.push({ kind: k, ...v });
  if (audit.speed > 14) res.violations.push({ kind: 'speed', v: audit.speed });
  if (dsm) {
    let minGeo = Infinity, invalid = 0;
    for (let t = 0; t <= tl.total; t += 0.5) {
      const s = tl.sample(t);
      const d = dsm.surfaceDistance(s.pos[0], s.pos[1], s.pos[2]);
      if (d < minGeo) minGeo = d;
      if (d < TOUR_LIMITS.minGeoDist) res.violations.push({ kind: 'geo', t, poi: doc.pois[s.poi]?.id, dist: +d.toFixed(1) });
      if (!dsm.validAt(s.pos[0], s.pos[2])) invalid++;
    }
    res.stats.minGeoDist_m = +minGeo.toFixed(1);
    res.stats.cameraOverNodata = invalid;
    // el objetivo de cada POI debe caer en datos válidos
    for (const p of doc.pois) if (!dsm.validAt(p.look[0], p.look[2])) res.violations.push({ kind: 'look-nodata', poi: p.id });
  }
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'web/assets/tour');
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.replace(/\.json$/, ''));
  let bad = 0;
  for (const cid of ids) {
    const r = validateWorld(cid);
    const nBad = r.violations.length + r.schema.errors.length;
    bad += nBad;
    console.log(`${nBad ? 'FAIL' : 'ok  '} ${cid}`, JSON.stringify(r.stats));
    for (const e of r.schema.errors) console.log('   schema:', e);
    for (const w of r.schema.warnings) console.log('   aviso :', w);
    const byKind = {};
    for (const v of r.violations) (byKind[v.kind] ||= []).push(v);
    for (const [k, list] of Object.entries(byKind)) {
      const per = {};
      for (const v of list) per[v.poi || v.kind] = (per[v.poi || v.kind] || 0) + 1;
      console.log(`   ${k}: ${list.length}`, JSON.stringify(per));
    }
  }
  process.exit(bad ? 1 : 0);
}
