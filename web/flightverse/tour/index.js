// flightverse/tour/index.js — punto de instalación del workstream E (Tour, ghost del
// vuelo real, autopiloto Arcade, Director/replay, cámaras de presentación, grabación).
// installTour(ctx) es ASYNC (descarga el track GPS) y corre justo tras crear el dron.
//
// Publica en ctx.tour:
//   ghost{toggle,update,renderPulse}, autopilot, director, cinematic, recorder,
//   autotestRecord(), dispose()
// y en ctx.state: ghost, director, replay. Registra ctx.actions.{toggleGhost, enterDirector}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { createRecorder } from '/flightverse/recorder.js?v=367';
import { createGhost } from '/flightverse/tour/ghost.js?v=367';
import { createAutopilot } from '/flightverse/tour/autopilot.js?v=367';
import { createDirector } from '/flightverse/tour/director.js?v=367';
import { createCinematic } from '/flightverse/tour/cinematic.js?v=367';

export async function installTour(ctx) {
  const { report, AT } = ctx;
  const tour = ctx.tour;
  tour.ghost = await createGhost(ctx);
  tour.autopilot = createAutopilot(ctx);
  tour.cinematic = createCinematic(ctx);
  // ── Quick Record (WebM del canvas — camino instantáneo del Video Studio) ──
  const recorder = createRecorder(ctx.renderer.domElement, {
    onError: err => {
      console.warn('[recorder]', err);
      ctx.ui.menu.recorderFailed();
    },
  });
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
  return tour;
}
