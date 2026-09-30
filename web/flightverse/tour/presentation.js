// flightverse/tour/presentation.js — instalación de la PRESENTACIÓN del mundo (WS E, sólo ?fv=2):
// hora del día + grade, borde del mundo (niebla-muro), máscaras, guardia de vacío, Tour y Foto.
// Se engancha al render SIN tocar volar.js: envuelve `sky.update` (que el loop llama tras elegir la
// cámara y antes de la sacudida/render) para poseer la cámara del Tour/Foto, y `composer.render`
// para la captura PNG. Ver el encabezado de tour/index.js para la API pública.
import { WORLD_LOOK, setWorldEdge } from '/flightverse/world-look.js?v=369';
import { installGrade } from '/flightverse/tour/grade.js?v=369';
import { boundaryFromCoverage, boundaryExtent, resolveEdge, edgeState, limitThrust, edgeMetric } from '/flightverse/tour/edge.js?v=369';
import { pushOutOfMasks, insideAnyMask } from '/flightverse/tour/poi.js?v=369';
import { TOD_ELEVATION, resolveTodKey, elevationOf, nearestTodKey, TOD_LABELS } from '/flightverse/tour/tod.js?v=369';
import { createTour, loadPoiDoc, createLocalEvents, makeEmit } from '/flightverse/tour/tour.js?v=369';
import { createPhoto } from '/flightverse/photo.js?v=369';
import { createVoidGuard } from '/flightverse/tour/void-guard.js?v=369';
import { installDefaultUi } from '/flightverse/tour/default-ui.js?v=369';
import { applySplatEdge, findSplatMesh } from '/flightverse/tour/splat-edge.js?v=369';

export async function installPresentation(ctx) {
  const { THREE, camera, sky, composer, report, bus, CID, state: S, actions: A } = ctx;
  const tour = ctx.tour;
  tour.events = createLocalEvents(bus);              // alias de bus.on/emit: tour · photo · edge · tod (ver encabezado de index.js)
  tour.emitEvt = makeEmit(ctx);
  const fxOff = ctx.fxLevel === 'off';

  // ── frontera efectiva (la misma que usa la colisión) ──
  const nativeHalf = Math.min(...ctx.W.size_m) / 2;
  const boundary = boundaryFromCoverage(report.coverage, nativeHalf);
  const doc = await loadPoiDoc(CID);
  const edgeCfg = resolveEdge(doc?.edge, boundary, nativeHalf);
  const masks = doc?.masks || [];

  // ── hora del día + grade ──
  sky.enableV2();
  const gradeApi = installGrade(ctx, { toneMode: new URLSearchParams(location.search).get('tm') || 'NEUTRAL' });
  ctx.gradeApi = gradeApi;
  ctx.grade = gradeApi ? { setGrade: gradeApi.setGrade, setEvExtra: gradeApi.setEvExtra, setToneMode: gradeApi.setToneMode } : null;
  sky.onTod(tp => { gradeApi?.setGrade(tp.grade); });
  const todState = { anim: null, lastApply: 0 };
  const applyTod = v => { sky.setTod(v); ctx.syncLook?.(); };
  applyTod(sky.preset);                       // alinea cielo + grade con el preset inicial (?cielo= o día)
  const tod = {
    keys: ['dia', 'dorada', 'atardecer', 'noche'],
    labels: TOD_LABELS,
    get elevation() { return sky.elevation; },
    get() { return { key: sky.preset, elev: +sky.elevation.toFixed(1) }; },
    /** set('dorada' | 'golden' | 25, { animate: true|false, dur }) */
    set(v, { animate = true, dur = 2.4 } = {}) {
      const to = elevationOf(v);
      if (to == null) return false;
      const key = typeof v === 'string' ? resolveTodKey(v) : nearestTodKey(to);
      if (!animate || Math.abs(sky.elevation - to) < 0.5) {
        todState.anim = null; applyTod(typeof v === 'string' ? key : to);
        tour.emitEvt('tod', { key, elev: to });
        return true;
      }
      todState.anim = { from: sky.elevation, to, t: 0, dur, key, raw: v };
      return true;
    },
    cycle() {
      const i = tod.keys.indexOf(sky.preset);
      const k = tod.keys[(i + 1) % tod.keys.length];
      tod.set(k, { animate: false });
      return k;
    },
  };
  ctx.tod = tod;
  tour.setTod = (v, o) => tod.set(v, o);
  const stepTod = rdt => {
    const a = todState.anim;
    if (!a) return;
    a.t += rdt;
    const k = Math.min(1, a.t / a.dur), e = k * k * (3 - 2 * k);
    const now = performance.now();
    if (k >= 1) {
      todState.anim = null;
      applyTod(typeof a.raw === 'string' ? a.key : a.to);
      tour.emitEvt('tod', { key: a.key, elev: a.to });
    } else if (now - todState.lastApply > 50) {
      todState.lastApply = now;
      applyTod(a.from + (a.to - a.from) * e);
    }
  };

  // ── borde del mundo: niebla-muro en terreno, malla, vegetación y splat ──
  WORLD_LOOK.uFvEdgeColor.value = sky.fogColor;           // mismo objeto Color: siempre sincronizado con el cielo
  setWorldEdge({ center: [0, 0], fog: edgeCfg.fog, shape: boundary.shape, strength: fxOff ? 0 : 1 });
  const edgeApi = {
    boundary, cfg: edgeCfg, externalUi: false,
    current: { m: 0, dist: boundaryExtent(boundary), fog: 0, warn: false, s: 0, scale: 1, out: [1, 0] },
    state: (x, z) => edgeState(x, z, boundary, edgeCfg),
    /** Empuje deseado (tx,tz) en (x,z) -> empuje con la componente saliente apagada en la última banda. */
    limit: (tx, tz, x, z) => limitThrust(tx, tz, edgeState(x, z, boundary, edgeCfg)),
    scale: (x, z) => edgeState(x, z, boundary, edgeCfg).scale,
    metric: (x, z) => edgeMetric(x, z, boundary),
  };
  ctx.edge = edgeApi;
  let edgeWarn = false;
  const stepEdge = () => {
    const p = ctx.P;
    const st = edgeState(p.x, p.z, boundary, edgeCfg);
    edgeApi.current = st;
    if (st.warn !== edgeWarn) {
      edgeWarn = st.warn;
      tour.emitEvt('edge', { warn: st.warn, s: st.s, fog: st.fog, dist: st.dist, m: st.m });
    }
  };
  // splat: no pasa por materiales three -> worldModifier dyno (se espera a que termine de cargar)
  if (!fxOff) {
    let tries = 0;
    const poll = setInterval(() => {
      const sm = findSplatMesh(ctx.worldGroup);
      if (sm) { clearInterval(poll); applySplatEdge(sm).catch(e => console.warn('[edge] splat:', e?.message || e)); }
      else if (++tries > 120) clearInterval(poll);
    }, 1000);
    tour.dispose = (prev => () => { clearInterval(poll); prev?.(); })(tour.dispose);
  }

  // ── máscaras sin cámara (para C: empuje de cámara fuera de zonas feas) ──
  ctx.masks = {
    list: masks,
    pushOut: (p, margin = 2) => pushOutOfMasks(p, masks, margin),
    inside: (p, margin = 0) => insideAnyMask(p, masks, margin),
  };

  // ── guardia de vacío ──
  const voidGuard = createVoidGuard(ctx);
  ctx.voidGuard = voidGuard;

  // ── Tour + Foto ──
  const guided = doc ? createTour(ctx, doc, { edge: edgeCfg, boundary }) : { ready: false, errors: ['sin POIs para este mundo'], active: false };
  tour.guided = guided;
  Object.defineProperties(tour, {
    ready: { get: () => !!guided.ready, configurable: true },
    doc: { get: () => doc, configurable: true },
    active: { get: () => !!guided.active, configurable: true },
  });
  for (const k of ['start', 'stop', 'next', 'prev', 'goTo', 'state', 'validate', 'setSpeed', 'pause']) {
    tour[k] = (...a) => (guided[k] ? guided[k](...a) : (k === 'state' ? { active: false, n: 0 } : false));
  }
  tour.edge = edgeApi;
  const photo = createPhoto(ctx, { doc, boundary, edge: edgeCfg });
  ctx.photo = photo;
  A.startTour = opts => { photo.exit(); return tour.start(opts); };
  A.stopTour = () => tour.stop();
  A.enterPhoto = () => { tour.stop(); return photo.enter(); };
  A.exitPhoto = () => photo.exit();
  installDefaultUi(ctx);

  // Cinemático (modo legacy) = Tour (spec §7): al entrar arranca el spline; al salir se detiene.
  bus.on('mode', ({ key }) => {
    if (key === 'cinematico' && guided.ready) { photo.exit(); guided.start({}); }
    else if (guided.active) guided.stop();
  });

  // ── gancho de render ──
  let lastT = performance.now();
  let droneHidden = false, inputHeld = false;
  const applyHold = hold => {
    if (hold) {
      ctx.input?.setEnabled?.(false);
      ctx.controls?.sticks?.setEnabled?.(false);
      inputHeld = true;
    } else if (inputHeld) {
      inputHeld = false;
      const on = !ctx.ui.overlay?.active();
      ctx.input?.setEnabled?.(on);
      ctx.controls?.sticks?.setEnabled?.(on);
    }
    const mesh = ctx.droneModel?.mesh;
    if (mesh) {
      const hide = hold && !(photo.active && photo.opts.showDrone);
      if (hide) { mesh.visible = false; droneHidden = true; }
      else if (droneHidden) { mesh.visible = true; droneHidden = false; }
    }
  };
  const origSkyUpdate = sky.update.bind(sky);
  sky.update = (dt, camPos, focus) => {
    const now = performance.now();
    const rdt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    const ownsCamera = !S.director && !S.replay && !S.exporting;
    if (ownsCamera) {
      const hold = photo.active || guided.active;
      applyHold(hold);
      if (photo.active) photo.frame(rdt);
      else if (guided.active) guided.frame(rdt);
    }
    stepTod(rdt);
    stepEdge();
    voidGuard.update(rdt);
    return origSkyUpdate(dt, camPos, focus);
  };
  const origRender = composer.render.bind(composer);
  composer.render = (...a) => { origRender(...a); photo.afterRender(); };

  // ── informe de QA ──
  report.presentation = {
    boundary, edge: edgeCfg, pois: doc?.pois?.length || 0, masks: masks.length,
    tourReady: !!guided.ready, tourErrors: guided.errors || [],
    tonemap: gradeApi?.tonemapName?.() || null, grade: !!gradeApi,
  };
  if (guided.ready && ctx.terrain) report.presentation.tourAudit = (() => {
    const a = guided.audit();
    return { ok: a.ok, mask: a.mask.length, cone: a.cone.length, agl: a.agl.length, edge: a.edge.length, maxSpeed: a.speed };
  })();
  const prevDispose = tour.dispose;
  tour.dispose = () => { photo.dispose(); voidGuard.dispose(); prevDispose?.(); };
  return tour;
}
