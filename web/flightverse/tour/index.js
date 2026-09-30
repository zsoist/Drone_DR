// flightverse/tour/index.js — punto de instalación del workstream E (Tour, ghost del
// vuelo real, autopiloto Arcade, Director/replay, cámaras de presentación, grabación).
// installTour(ctx) es ASYNC (descarga el track GPS) y corre justo tras crear el dron.
//
// Publica en ctx.tour:
//   ghost{toggle,update,renderPulse}, autopilot, director, cinematic, recorder,
//   autotestRecord(), dispose()
// y en ctx.state: ghost, director, replay. Registra ctx.actions.{toggleGhost, enterDirector}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
//
// ── Presentación del mundo (WS E) — SÓLO con ?fv=2 (installPresentation) ──
//   ctx.tod     {set(keyOrElev,{animate}), get(), elevation, keys, cycle()}  hora del día (dia·dorada·atardecer·noche o -5..70°)
//   ctx.edge    {boundary, cfg, current, state(x,z), limit(tx,tz,x,z), scale(x,z), externalUi}  borde del mundo
//   ctx.tour    + {ready, doc, guided, start(opts), stop(), next(), prev(), goTo(i), state(), validate(), setSpeed(m)}
//   ctx.photo   {enter, exit, toggle, set, get, focusAt, move, look, zoom, capture, state, opts}
//   ctx.masks   {list, pushOut(p, margin), inside(p)}  zonas sin cámara (para C: empuje de cámara)
//   ctx.grade   {setGrade, setEvExtra}, ctx.gradeApi (pasadas de post)
//   ctx.actions + startTour stopTour enterPhoto exitPhoto
//   eventos (sólo fv2) en el bus (BUS_EVENTS; ctx.tour.events.on es un alias de bus.on):
//     'tour'  {state:'start'|'stop'|'poi'|'loop', index, n, poi:{id,name,short,dwell,index,n}}
//     'photo' {active, ...state}      'edge' {warn, s, fog, dist, m}      'tod' {key, elev}  (tod ya está en el bus)
//   ctx.ui.external = {tour,photo,edge} (A) desactiva el chrome de respaldo de default-ui.js.
import { createRecorder } from '/flightverse/recorder.js?v=370';
import { createGhost } from '/flightverse/tour/ghost.js?v=370';
import { createAutopilot } from '/flightverse/tour/autopilot.js?v=370';
import { createDirector } from '/flightverse/tour/director.js?v=370';
import { createCinematic } from '/flightverse/tour/cinematic.js?v=370';
import { installPresentation } from '/flightverse/tour/presentation.js?v=370';
import { freezePixelRatio } from '/flightverse/tour/render-guard.js?v=370';

export async function installTour(ctx) {
  const { report, AT } = ctx;
  const tour = ctx.tour;
  tour.ghost = await createGhost(ctx);
  tour.autopilot = createAutopilot(ctx);
  tour.cinematic = createCinematic(ctx);
  // ── Quick Record (WebM del canvas — camino instantáneo del Video Studio) ──
  let dprLock = null;
  const unlock = () => { dprLock?.release(); dprLock = null; };
  const recorder = createRecorder(ctx.renderer.domElement, {
    onError: err => {
      console.warn('[recorder]', err);
      unlock();
      ctx.ui.menu?.recorderFailed?.();
    },
    onLimit: why => console.warn('[recorder] tope alcanzado:', why),
  });
  // mientras se graba el DPR no cambia (el gobernador de calidad alteraría la resolución del stream);
  // SÓLO con ?fv=2 (la ruta legacy queda intacta)
  const recStart = recorder.start.bind(recorder), recStop = recorder.stop.bind(recorder);
  recorder.start = () => { const ok = recStart(); if (ok && ctx.flags.fv2 && !dprLock && !ctx.state.exporting) dprLock = freezePixelRatio(ctx); return ok; };
  recorder.stop = async () => { try { return await recStop(); } finally { unlock(); } };
  tour.recorder = recorder;
  tour.director = createDirector(ctx);
  ctx.actions.toggleGhost = () => tour.ghost.toggle();
  /** ?autotest=record: graba 2.5 s a partir del segundo 1 y reporta bytes/mime. */
  tour.autotestRecord = () => {
    if (AT !== 'record') return;
    setTimeout(() => {
      const started = recorder.start();
      setTimeout(async () => {
        const blob = started ? await recorder.stop() : null;
        report.recordBytes = blob?.size || 0;
        report.recordMime = blob?.type || null;
        report.ok = (blob?.size || 0) > 50000;
        report.done = true;
      }, 2500);
    }, 1000);
  };
  tour.dispose = () => {};
  if (ctx.flags.fv2) {
    try { await installPresentation(ctx); } catch (e) {
      console.warn('[tour] presentación v2 no disponible:', e?.message || e);
      report.errors.push('presentation: ' + (e?.message || e));
    }
  }
  return tour;
}
