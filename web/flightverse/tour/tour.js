// flightverse/tour/tour.js — TOUR guiado (WS E, ?fv=2): cámara de spline Catmull-Rom/Hermite sobre
// los POIs del mundo (web/assets/tour/<cid>.json), giro con retardo 1.2 s, tarjeta de etiqueta por
// POI, saltar/siguiente, hora dorada por defecto. Respeta máscaras, AGL mínimo 12 m y distancia
// mínima a la geometría (6 m) con correcciones suavizadas.
//
// API (ctx.tour.*): ready, active, doc, index, time, total, start(opts), stop(), next(), prev(),
//   goTo(i), pause(bool), setSpeed(mult), validate(), state()
// Eventos (bus, sólo ?fv=2): 'tour' {state:'start'|'stop'|'poi'|'loop', index, n, poi}
import {
  validatePoiDoc, buildTimeline, auditTimeline, pushOutOfMasks, TOUR_LIMITS,
} from '/flightverse/tour/poi.js?v=368';
import { edgeMetric } from '/flightverse/tour/edge.js?v=368';

/**
 * Carga los POIs del mundo. Consulta primero assets/tour/index.json (siempre existe) y sólo pide
 * <cid>.json si está listado: un mundo sin tour NO produce un 404 en la consola.
 */
export async function loadPoiDoc(cid) {
  try {
    const ri = await fetch('assets/tour/index.json', { cache: 'no-store' });
    if (!ri.ok) return null;
    const idx = await ri.json();
    if (!Array.isArray(idx?.worlds) || !idx.worlds.includes(cid)) return null;
    const r = await fetch(`assets/tour/${cid}.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Emisor local mínimo (on/off/emit) para los eventos propios de WS E que aún no están en BUS_EVENTS. */
export function createLocalEvents() {
  const map = new Map();
  return {
    on(type, fn) { let s = map.get(type); if (!s) map.set(type, s = new Set()); s.add(fn); return () => s.delete(fn); },
    emit(type, detail = {}) {
      for (const fn of [...(map.get(type) || [])]) { try { fn(detail); } catch (e) { console.warn('[tour] handler', type, e); } }
    },
  };
}

/**
 * Emite en el bus SOLO si el evento está registrado en BUS_EVENTS (A); siempre en el emisor local
 * `ctx.tour.events`. Así no hay "evento desconocido" en consola y A puede migrar al bus sin cambios.
 */
export function makeEmit(ctx, knownEvents) {
  return (type, detail) => {
    if (!ctx.flags.fv2) return;
    ctx.tour.events?.emit(type, detail);
    if (knownEvents && Object.prototype.hasOwnProperty.call(knownEvents, type)) ctx.bus.emit(type, detail);
  };
}

export function createTour(ctx, doc, { edge = null, boundary = null } = {}) {
  const { THREE, camera, bus, flags } = ctx;
  const check = validatePoiDoc(doc);
  const n = doc?.pois?.length || 0;
  const api = {
    ready: check.ok, errors: check.errors, warnings: check.warnings,
    doc, active: false, index: 0, time: 0, total: 0, paused: false, speedMul: 1,
    externalUi: false,
  };
  if (!check.ok) { console.warn('[tour] POIs inválidos:', check.errors); return api; }

  const tl = buildTimeline(doc, { loop: true });
  api.total = tl.total;
  api.timeline = tl;
  const heightAt = ctx.terrain?.heightAt || null;
  const masks = doc.masks || [];
  const lookCur = new THREE.Vector3();
  const corr = new THREE.Vector3();          // corrección suavizada (máscara/AGL/geometría)
  const tmp = new THREE.Vector3();
  const blend = { k: 1, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
  let savedFov = null, lastPoi = -1, lastLoop = 0;
  const emit = ctx.tour.emitEvt || ((type, detail) => { if (flags.fv2) bus.emit(type, detail); });

  const poiInfo = i => {
    const p = doc.pois[i];
    return { id: p.id, name: p.name, short: p.short, dwell: p.dwell, index: i, n };
  };

  // fov efectivo: en vertical (retrato) el FOV vertical se ensancha para conservar el encuadre horizontal
  function effFov(f) {
    const a = camera.aspect || 1;
    return a < 1 ? Math.min(74, f * (1 + (1 - a) * 0.55)) : f;
  }

  api.audit = (opts = {}) => auditTimeline(tl, doc, {
    heightAt, masks, stepS: 0.25,
    metricFn: boundary ? (x, z) => edgeMetric(x, z, boundary) : null,
    maxMetric: edge ? edge.fog[1] - 2 : Infinity,
    ...opts,
  });
  api.validate = () => ({ ...check, audit: api.audit() });

  function sectionStart(i) { return tl.sections[i].start; }

  api.start = (opts = {}) => {
    if (api.active) api.stop(true);
    api.active = true; api.paused = false;
    api.index = Math.max(0, Math.min(n - 1, opts.poi | 0));
    api.time = sectionStart(api.index) - 0.001;
    const s = tl.sample(Math.max(0, api.time));
    lookCur.set(...s.look);
    corr.set(0, 0, 0);
    blend.k = 0; blend.pos.copy(camera.position); blend.fov = camera.fov;
    blend.look.copy(camera.position).add(tmp.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(30));
    savedFov = camera.fov;
    lastPoi = -1;
    ctx.state.tourActive = true;
    ctx.tour.setTod?.(opts.tod || doc.pois[api.index].tod || 'dorada');
    emit('tour', { state: 'start', index: api.index, n, poi: poiInfo(api.index) });
    return true;
  };
  api.stop = (silent = false) => {
    if (!api.active) return;
    api.active = false;
    ctx.state.tourActive = false;
    if (savedFov != null) { camera.fov = savedFov; camera.updateProjectionMatrix(); }
    if (!silent) emit('tour', { state: 'stop', index: api.index, n, poi: poiInfo(api.index) });
  };
  api.goTo = i => {
    const k = ((i % n) + n) % n;
    blend.k = 0; blend.pos.copy(camera.position); blend.fov = camera.fov;
    blend.look.copy(lookCur);
    api.index = k;
    api.time = sectionStart(k) - 0.001;
    lastPoi = -1;
  };
  api.next = () => api.goTo(api.index + 1);
  api.prev = () => api.goTo(api.index - 1);
  api.pause = v => { api.paused = !!v; };
  api.setSpeed = m => { api.speedMul = Math.max(0.25, Math.min(3, Number(m) || 1)); };
  api.state = () => ({
    active: api.active, index: api.index, n, time: +api.time.toFixed(2), total: +api.total.toFixed(2),
    paused: api.paused, poi: poiInfo(api.index),
  });

  /** Por frame (desde la cabecera de render). Escribe la pose en `camera`. */
  api.frame = rdt => {
    if (!api.active) return false;
    const held = api.paused || !!ctx.ui.overlay?.active();
    if (!held) api.time += rdt * api.speedMul;
    if (api.time >= tl.total) { api.time -= tl.total; emit('tour', { state: 'loop', index: 0, n, poi: poiInfo(0) }); lastLoop++; }
    const s = tl.sample(Math.max(0, api.time));
    if (s.poi !== lastPoi && s.phase === 'poi') {
      lastPoi = s.poi; api.index = s.poi;
      emit('tour', { state: 'poi', index: s.poi, n, poi: poiInfo(s.poi) });
    } else if (s.phase === 'transit') api.index = s.poi;

    // posición deseada + correcciones (máscara -> AGL -> geometría), todas suavizadas (sin saltos)
    let p = pushOutOfMasks(s.pos, masks, 2);
    if (heightAt) {
      const g = heightAt(p[0], p[2]);
      if (g != null) p[1] = Math.max(p[1], g + TOUR_LIMITS.minAgl);
    }
    tmp.set(p[0], p[1], p[2]);
    const coll = ctx.collision;
    if (coll?.closest) {
      const hit = coll.closest(tmp, TOUR_LIMITS.minGeoDist);
      if (hit && hit.kind !== 'terrain' && hit.distance < TOUR_LIMITS.minGeoDist && hit.normal) {
        tmp.addScaledVector(hit.normal, TOUR_LIMITS.minGeoDist - hit.distance);
      }
    }
    const want = tmp.clone().sub(tmp.set(s.pos[0], s.pos[1], s.pos[2]));   // corrección deseada
    corr.lerp(want, 1 - Math.exp(-rdt / 0.35));
    const pos = tmp.set(s.pos[0], s.pos[1], s.pos[2]).add(corr);

    // retardo del giro 1.2 s (spec)
    const kLook = 1 - Math.exp(-rdt / TOUR_LIMITS.lookLagS);
    lookCur.x += (s.look[0] - lookCur.x) * kLook;
    lookCur.y += (s.look[1] - lookCur.y) * kLook;
    lookCur.z += (s.look[2] - lookCur.z) * kLook;

    let fov = effFov(s.fov);
    if (blend.k < 1) {                       // entrada / salto: fundido suave desde la pose previa
      blend.k = Math.min(1, blend.k + rdt / 1.6);
      const e = blend.k * blend.k * (3 - 2 * blend.k);
      const fp = blend.pos.clone().lerp(pos, e);
      const fl = blend.look.clone().lerp(lookCur, e);
      camera.position.copy(fp); camera.lookAt(fl);
      fov = blend.fov + (fov - blend.fov) * e;
    } else {
      camera.position.copy(pos);
      camera.lookAt(lookCur);
    }
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return true;
  };
  return api;
}
