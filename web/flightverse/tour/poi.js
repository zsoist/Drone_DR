// flightverse/tour/poi.js — TOUR: esquema de POIs, spline de cámara y máscaras (WS E).
// Matemática pura (sin DOM, sin three): se prueba en pipeline/test_tour_poi.mjs y la usa el
// validador offline pipeline/validate_tour_pois.mjs.
//
// Formato (web/assets/tour/<cid>.json, spec §10). Coordenadas = marco local de la escena
// (origen = centro del DSM, +x este, +z sur, y = altura sobre el piso `elev_min`):
// { "world": "<cid>", "pois": [ { id, name, short, spline:[[x,y,z,t?]], look:[x,y,z], dwell, fov,
//     tod?, mask?:[ids] } ],
//   "masks": [ { id, type:"sphere"|"box", c:[x,y,z], r | size:[sx,sy,sz], why } ],
//   "edge": { fog:[a,b], warn } , "speed"?: m/s }
// `t` (opcional) = segundo RELATIVO al primer punto del POI en que la cámara pasa por ese punto.
// Sin `t` el tiempo sale de dist/velocidad. `dwell` = segundos de la sección del POI como mínimo.

export const TOUR_LIMITS = Object.freeze({
  minPois: 5, maxPois: 8, speedMin: 6, speedMax: 9, fovMin: 50, fovMax: 60,
  minAgl: 12, minGeoDist: 6, lookLagS: 1.2, coneDeg: 40, labelS: 4,
});
export const TOD_KEYS = Object.freeze(['dia', 'dorada', 'atardecer', 'noche']);

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Valida un documento de POIs. Devuelve { ok, errors[], warnings[] } (nunca lanza). */
export function validatePoiDoc(doc, { strictCount = true } = {}) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['documento vacío'], warnings };
  if (typeof doc.world !== 'string' || !doc.world) err('world: string requerido');
  if (!Array.isArray(doc.pois)) { err('pois: array requerido'); return { ok: false, errors, warnings }; }
  const n = doc.pois.length;
  if (strictCount && (n < TOUR_LIMITS.minPois || n > TOUR_LIMITS.maxPois)) {
    err(`pois: ${n} (deben ser ${TOUR_LIMITS.minPois}-${TOUR_LIMITS.maxPois})`);
  } else if (!n) err('pois: vacío');
  const maskIds = new Set();
  const masks = Array.isArray(doc.masks) ? doc.masks : [];
  if (doc.masks != null && !Array.isArray(doc.masks)) err('masks: debe ser array');
  masks.forEach((m, i) => {
    const tag = `masks[${i}]`;
    if (!m || typeof m.id !== 'string' || !m.id) return err(`${tag}.id requerido`);
    if (maskIds.has(m.id)) err(`${tag}.id duplicado: ${m.id}`);
    maskIds.add(m.id);
    if (m.type !== 'sphere' && m.type !== 'box') err(`${tag}.type debe ser sphere|box`);
    if (!isVec3(m.c)) err(`${tag}.c debe ser [x,y,z]`);
    if (m.type === 'sphere' && !(isNum(m.r) && m.r > 0)) err(`${tag}.r > 0 requerido`);
    if (m.type === 'box' && !(isVec3(m.size) && m.size.every(s => s > 0))) err(`${tag}.size [sx,sy,sz] > 0 requerido`);
    if (typeof m.why !== 'string' || !m.why) warn(`${tag}.why vacío`);
  });
  const ids = new Set();
  doc.pois.forEach((p, i) => {
    const tag = `pois[${i}]`;
    if (!p || typeof p !== 'object') return err(`${tag} inválido`);
    if (typeof p.id !== 'string' || !p.id) err(`${tag}.id requerido`);
    else if (ids.has(p.id)) err(`${tag}.id duplicado: ${p.id}`);
    else ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) err(`${tag}.name requerido`);
    if (typeof p.short !== 'string' || !p.short.trim()) err(`${tag}.short requerido`);
    else if (p.short.length > 90) warn(`${tag}.short largo (${p.short.length}); la etiqueta es de una línea`);
    if (!Array.isArray(p.spline) || p.spline.length < 2) err(`${tag}.spline: mínimo 2 puntos`);
    else {
      let lastT = -Infinity;
      p.spline.forEach((q, j) => {
        if (!Array.isArray(q) || (q.length !== 3 && q.length !== 4) || !q.every(isNum)) return err(`${tag}.spline[${j}] debe ser [x,y,z] o [x,y,z,t]`);
        if (q.length === 4) {
          if (q[3] <= lastT) err(`${tag}.spline[${j}].t no es creciente`);
          lastT = q[3];
        }
      });
      const withT = p.spline.filter(q => Array.isArray(q) && q.length === 4).length;
      if (withT && withT !== p.spline.length) err(`${tag}.spline mezcla puntos con y sin t`);
    }
    if (!isVec3(p.look)) err(`${tag}.look debe ser [x,y,z]`);
    if (!(isNum(p.dwell) && p.dwell >= 1 && p.dwell <= 15)) err(`${tag}.dwell debe estar en 1..15 s`);
    if (!(isNum(p.fov) && p.fov >= 40 && p.fov <= 75)) err(`${tag}.fov debe estar en 40..75`);
    else if (p.fov < TOUR_LIMITS.fovMin || p.fov > TOUR_LIMITS.fovMax) warn(`${tag}.fov fuera de 50-60`);
    if (p.tod != null && !TOD_KEYS.includes(p.tod) && p.tod !== 'golden') err(`${tag}.tod desconocido: ${p.tod}`);
    if (p.mask != null) {
      if (!Array.isArray(p.mask)) err(`${tag}.mask debe ser array de ids`);
      else for (const id of p.mask) if (!maskIds.has(id)) err(`${tag}.mask referencia id inexistente: ${id}`);
    }
  });
  if (doc.edge != null) {
    const e = doc.edge;
    if (!(Array.isArray(e.fog) && e.fog.length === 2 && e.fog.every(isNum) && e.fog[0] < e.fog[1])) err('edge.fog debe ser [a,b] con a<b');
    if (e.warn != null && !(isNum(e.warn) && e.warn > 0)) err('edge.warn debe ser número > 0');
    if (isNum(e.warn) && Array.isArray(e.fog) && e.warn > e.fog[1]) warn('edge.warn > fog[1]');
  }
  if (doc.speed != null && !(isNum(doc.speed) && doc.speed >= TOUR_LIMITS.speedMin && doc.speed <= TOUR_LIMITS.speedMax)) {
    err(`speed debe estar en ${TOUR_LIMITS.speedMin}-${TOUR_LIMITS.speedMax} m/s`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ───────────────────────────── máscaras ─────────────────────────────

/** Distancia con signo a la máscara (negativa dentro) y gradiente unitario hacia fuera. */
export function maskField(mask, p) {
  const [cx, cy, cz] = mask.c;
  const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
  if (mask.type === 'sphere') {
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    return { d: d - mask.r, g: [dx / d, dy / d, dz / d] };
  }
  // caja alineada a ejes (size = dimensiones completas)
  const hx = mask.size[0] / 2, hy = mask.size[1] / 2, hz = mask.size[2] / 2;
  const qx = Math.abs(dx) - hx, qy = Math.abs(dy) - hy, qz = Math.abs(dz) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  if (outside > 0) {
    return { d: outside, g: [Math.sign(dx) * ox / outside, Math.sign(dy) * oy / outside, Math.sign(dz) * oz / outside] };
  }
  // dentro: empujar por la cara más cercana
  const m = Math.max(qx, qy, qz);
  if (m === qx) return { d: m, g: [Math.sign(dx) || 1, 0, 0] };
  if (m === qy) return { d: m, g: [0, Math.sign(dy) || 1, 0] };
  return { d: m, g: [0, 0, Math.sign(dz) || 1] };
}

/**
 * Empuja p fuera de todas las máscaras (con margen) a lo largo del gradiente. Con máscaras solapadas
 * (unión) elige, de entre las salidas de cada máscara violada, la más cercana que quede libre de
 * todas; si ninguna lo está, avanza por la que deja menos máscaras encima y reintenta.
 */
export function pushOutOfMasks(p, masks, margin = 2, iterations = 8) {
  let cur = [p[0], p[1], p[2]];
  if (!masks?.length) return cur;
  const exitOf = (m, q) => {
    const f = maskField(m, q);
    const k = margin - f.d;
    return [q[0] + f.g[0] * k, q[1] + f.g[1] * k, q[2] + f.g[2] * k];
  };
  const hits = q => masks.filter(o => maskField(o, q).d < margin - 1e-9);
  for (let it = 0; it < iterations; it++) {
    const inside = hits(cur);
    if (!inside.length) break;
    let best = null, bestScore = Infinity;
    for (const m of inside) {
      const cand = exitOf(m, cur);
      const left = hits(cand).length;
      const d = Math.hypot(cand[0] - cur[0], cand[1] - cur[1], cand[2] - cur[2]);
      const score = left * 1e6 + d;
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    cur = best;
  }
  if (hits(cur).length) {
    // máscaras solapadas sin salida por gradiente: búsqueda radial del punto libre más cercano
    const dirs = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; dirs.push([Math.cos(a), 0, Math.sin(a)]); }
    dirs.push([0, 1, 0]);
    let bestP = null, bestD = Infinity;
    for (const d of dirs) {
      for (let r = 1; r <= 600; r += 1) {
        const q = [p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r];
        if (!hits(q).length) { if (r < bestD) { bestD = r; bestP = q; } break; }
      }
    }
    if (bestP) cur = bestP;
  }
  return cur;
}

export function insideAnyMask(p, masks, margin = 0) {
  return !!masks?.some(m => maskField(m, p).d < margin);
}

/**
 * ¿Algún CENTRO de máscara cae dentro del cono de visión (ángulo total `coneDeg`) desde `cam`
 * mirando hacia `look`? Solo cuenta si el centro está por delante y a menos de `maxDist`
 * (por defecto 2x la distancia cámara-objetivo + radio). Devuelve la lista de máscaras violadas.
 */
export function masksInCone(cam, look, masks, coneDeg = TOUR_LIMITS.coneDeg) {
  const fx = look[0] - cam[0], fy = look[1] - cam[1], fz = look[2] - cam[2];
  const fl = Math.hypot(fx, fy, fz) || 1e-6;
  const cosHalf = Math.cos((coneDeg / 2) * Math.PI / 180);
  const hits = [];
  for (const m of masks || []) {
    const vx = m.c[0] - cam[0], vy = m.c[1] - cam[1], vz = m.c[2] - cam[2];
    const vl = Math.hypot(vx, vy, vz) || 1e-6;
    const cos = (vx * fx + vy * fy + vz * fz) / (vl * fl);
    if (cos >= cosHalf) hits.push(m.id);
  }
  return hits;
}

// ───────────────────────────── spline ─────────────────────────────

/**
 * Hermite cúbico con tangentes por diferencias finitas NO uniformes (Catmull-Rom parametrizado
 * por tiempo): continuidad C1 en la velocidad aunque los tramos duren distinto.
 * pts[i] = [x,y,z], times[i] creciente. Devuelve sampler(t) -> [x,y,z] (t se envuelve si loop).
 */
export function makeTimedSpline(pts, times, { loop = false, total: totalOpt = null } = {}) {
  const n = pts.length;
  if (n < 2) throw new Error('spline: mínimo 2 puntos');
  const T = times.slice();
  let P = pts;
  let total;
  if (loop) total = totalOpt > T[n - 1] ? totalOpt : T[n - 1] + (T[n - 1] - T[n - 2] || 1);   // cierre: tramo de vuelta al inicio
  else total = T[n - 1];
  const idx = i => (loop ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  const tAt = i => {
    if (!loop) return T[idx(i)];
    const w = Math.floor(i / n), k = ((i % n) + n) % n;
    return T[k] + w * total;
  };
  const tang = i => {
    const a = idx(i - 1), b = idx(i + 1);
    const dt = tAt(i + 1) - tAt(i - 1);
    const o = [0, 0, 0];
    if (!loop && (i === 0 || i === n - 1)) {
      const j = i === 0 ? 1 : n - 2;
      for (let c = 0; c < 3; c++) o[c] = (P[j][c] - P[i][c]) / ((T[j] - T[i]) || 1);
      return o;
    }
    for (let c = 0; c < 3; c++) o[c] = (P[b][c] - P[a][c]) / (dt || 1);
    return o;
  };
  const cache = new Map();
  const tangC = i => { const k = idx(i); if (!cache.has(k)) cache.set(k, tang(k)); return cache.get(k); };
  const sampler = t => {
    if (loop) t = ((t % total) + total) % total; else t = clamp(t, T[0], T[n - 1]);
    let i = 0;
    const last = loop ? n : n - 1;
    while (i < last - 1 && t >= tAt(i + 1)) i++;
    const t0 = tAt(i), t1 = tAt(i + 1);
    const h = t1 - t0 || 1;
    const u = clamp((t - t0) / h, 0, 1);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const a = idx(i), b = idx(i + 1);
    const m0 = tangC(i), m1 = tangC(i + 1);
    const o = [0, 0, 0];
    for (let c = 0; c < 3; c++) o[c] = h00 * P[a][c] + h10 * h * m0[c] + h01 * P[b][c] + h11 * h * m1[c];
    return o;
  };
  sampler.total = total;
  return sampler;
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);

/**
 * Construye la línea de tiempo del tour: control points de TODOS los POIs en orden (más un
 * tramo de transición POI->POI a `speed` m/s), spline cerrada (loop).
 * Devuelve { total, knots[], sections[], sample(t) } donde sample(t) -> { pos, look, fov, poi,
 * phase:'poi'|'transit', k }.
 */
export function buildTimeline(doc, { speed, loop = true, minTransitS = 3, maxSpeedRatio = 1.25 } = {}) {
  const v = clamp(Number(speed ?? doc.speed ?? 7.5), TOUR_LIMITS.speedMin, TOUR_LIMITS.speedMax);
  // La curva Hermite es más larga que la cuerda y puede rebasar: si la velocidad pico supera
  // maxSpeedRatio*v se estiran TODOS los tiempos (proporcional) hasta cumplirlo. Converge en 1-3 pasadas.
  let stretch = 1;
  let tl = null;
  for (let pass = 0; pass < 4; pass++) {
    tl = buildOnce(doc, v, stretch, loop, minTransitS);
    let peak = 0, prev = tl.sample(0).pos;
    for (let t = 0.25; t < tl.total; t += 0.25) {
      const p = tl.sample(t).pos;
      peak = Math.max(peak, dist3(prev, p) / 0.25);
      prev = p;
    }
    tl.peakSpeed = peak;
    if (peak <= maxSpeedRatio * v) break;
    stretch *= peak / (maxSpeedRatio * v) * 1.02;
  }
  tl.stretch = stretch;
  return tl;
}

function buildOnce(doc, v, stretch, loop, minTransitS) {
  const pts = [], times = [], sections = [];
  let t = 0;
  doc.pois.forEach((poi, pi) => {
    const hasT = poi.spline.every(q => q.length === 4);
    poi.spline.forEach((q, j) => {
      const p = [q[0], q[1], q[2]];
      if (j === 0) {
        if (pts.length) {                       // tránsito desde el POI anterior
          const d = dist3(pts[pts.length - 1], p);
          t += Math.max(minTransitS, d / v) * stretch;
        }
        sections.push({ poi: pi, start: t, end: t });
        times.push(t);
      } else {
        const prev = pts[pts.length - 1];
        const dt = hasT ? q[3] - poi.spline[j - 1][3] : dist3(prev, p) / v;
        t += Math.max(0.25, dt) * stretch;
        times.push(t);
      }
      pts.push(p);
    });
    // dwell mínimo: si la sección dura menos, se alarga el último tramo del POI
    const sec = sections[sections.length - 1];
    const dur = t - sec.start;
    if (dur < poi.dwell) {
      t += poi.dwell - dur;
      times[times.length - 1] = t;
    }
    sec.end = t;
  });
  const closeS = Math.max(minTransitS, dist3(pts[pts.length - 1], pts[0]) / v) * stretch;
  const spl = makeTimedSpline(pts, times, { loop, total: times[times.length - 1] + closeS });
  const total = spl.total;
  const sectionAt = tt => {
    const w = ((tt % total) + total) % total;
    for (let i = 0; i < sections.length; i++) if (w >= sections[i].start && w <= sections[i].end) return { i, w };
    return { i: -1, w };
  };
  const sample = tt => {
    const pos = spl(tt);
    const { i, w } = sectionAt(tt);
    let look, fov, poiIx, phase, k = 0;
    if (i >= 0) {
      const s = sections[i], p = doc.pois[s.poi];
      look = p.look; fov = p.fov; poiIx = s.poi; phase = 'poi';
      k = (w - s.start) / Math.max(1e-6, s.end - s.start);
    } else {
      // tránsito: entre el final de la sección previa y el inicio de la siguiente
      let prev = sections.length - 1;
      for (let j = 0; j < sections.length; j++) if (sections[j].end <= w) prev = j;
      const next = (prev + 1) % sections.length;
      const a = doc.pois[sections[prev].poi], b = doc.pois[sections[next].poi];
      const endPrev = sections[prev].end;
      const startNext = next === 0 ? total : sections[next].start;
      k = clamp((w - endPrev) / Math.max(1e-6, startNext - endPrev), 0, 1);
      const e = smooth(k);
      look = [lerp(a.look[0], b.look[0], e), lerp(a.look[1], b.look[1], e), lerp(a.look[2], b.look[2], e)];
      fov = lerp(a.fov, b.fov, e);
      poiIx = k < 0.5 ? sections[prev].poi : sections[next].poi;
      phase = 'transit';
    }
    return { pos, look, fov, poi: poiIx, phase, k, time: w };
  };
  return { total, speed: v, sections, knots: pts.map((p, i) => ({ p, t: times[i] })), sample, n: doc.pois.length };
}

/**
 * Recorre la línea de tiempo y reporta violaciones de reglas:
 *  - máscara: posición dentro de una máscara (margen) o centro de máscara en el cono 40° del encuadre
 *  - agl: altura sobre el terreno < mínimo (heightAt(x,z) opcional)
 *  - borde: fuera de `maxMetric` (opcional) usando metricFn
 */
export function auditTimeline(tl, doc, { heightAt = null, stepS = 0.25, minAgl = TOUR_LIMITS.minAgl,
  maskMargin = 2, metricFn = null, maxMetric = Infinity } = {}) {
  const masks = doc.masks || [];
  const v = { mask: [], cone: [], coneTransit: [], agl: [], edge: [], speed: 0 };
  let prev = null, maxSpeed = 0;
  for (let t = 0; t <= tl.total; t += stepS) {
    const s = tl.sample(t);
    if (insideAnyMask(s.pos, masks, maskMargin)) v.mask.push({ t: +t.toFixed(2), poi: doc.pois[s.poi]?.id, pos: s.pos.map(x => +x.toFixed(1)) });
    // regla del spec: el ENCUADRE de un POI no incluye centros de máscara en el cono de 40°.
    // En tránsito (la mirada gira de un POI al siguiente) sólo se informa, no invalida.
    const hits = masksInCone(s.pos, s.look, masks);
    if (hits.length) {
      (s.phase === 'poi' ? v.cone : v.coneTransit).push({ t: +t.toFixed(2), masks: hits, poi: doc.pois[s.poi]?.id });
    }
    if (heightAt) {
      const g = heightAt(s.pos[0], s.pos[2]);
      if (g != null && s.pos[1] - g < minAgl) v.agl.push({ t: +t.toFixed(2), poi: doc.pois[s.poi]?.id, agl: +(s.pos[1] - g).toFixed(1) });
    }
    if (metricFn && metricFn(s.pos[0], s.pos[2]) > maxMetric) v.edge.push({ t: +t.toFixed(2) });
    if (prev) maxSpeed = Math.max(maxSpeed, dist3(prev, s.pos) / stepS);
    prev = s.pos;
  }
  v.speed = +maxSpeed.toFixed(2);
  v.ok = !v.mask.length && !v.cone.length && !v.agl.length && !v.edge.length;
  return v;
}
