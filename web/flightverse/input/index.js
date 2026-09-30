// flightverse/input/index.js — punto de instalación del workstream C (controles, cámara,
// física/modo de vuelo, dron visual). installControls(ctx) es síncrono y corre tras
// installEnemies; requiere ctx.{input, audio, drone, droneModel, fx, tour, ui.weapons}.
//
// Publica en ctx.controls:
//   cameraController, flightTools, sticks, firePointers,
//   camera{setRig,cycleRig,setGimbal,updateFov,update,stats,rigIx,gimbalTilt},
//   bindings, step(dt), afterStep(), report(), onPause(), dispose()
// y en ctx.actions: setMode, setRig, cycleRig, releaseFiring, beginFiring.
// Emite en el bus: mode{key}, crash{energyClass}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
// ?fv=2 (o ?phys=v2): Physics v2 (input/physics-link.js -> ctx.phys / window.__volar.physics, bus crash/damage/respawn),
// entradas v2 (input/v2-input.js: stick flotante, zona de mirada, mouse-look con pointer lock, gamepad, háptica,
// ctx.controls.v2.settings) y cámaras v2 (camera-rigs.js). Sin la bandera todo corre como antes.
import { MODES } from '/flightverse/runtime.js?v=368';
import { createBindings } from '/flightverse/input/bindings.js?v=368';
import { createCameraControls } from '/flightverse/input/camera.js?v=368';

export { createDroneModel } from '/flightverse/input/drone-model.js?v=368';

export function installControls(ctx) {
  const { state: S, bus } = ctx;
  const $ = ctx.$;
  const controls = ctx.controls;
  const bindings = createBindings(ctx);
  const camera = createCameraControls(ctx);

  const setMode = k => {
    S.modeKey = k; $('#vl-mode').textContent = `modo · ${MODES[k].label}`;
    $('#vl-cine').classList.toggle('show', k === 'cinematico');
    $('#vl-goto').classList.toggle('show', !!MODES[k].autopilot && !!S.ghost);
    if (MODES[k].autopilot) {
      // pistas degeneradas (4+ puntos idénticos) dan len 0 → u NaN → getPointAt lanza y congela el paso fijo
      const ghost = S.ghost;
      const trackUsable = ghost && ghost.pts.length > 3
        && ghost.pts.some(p => p.distanceToSquared(ghost.pts[0]) > 1);
      if (trackUsable) { ctx.tour.autopilot.initAuto(); ctx.tour.autopilot.goToStart(); }
      else {                                   // honesto: sin track no hay autopiloto
        S.modeKey = 'asistido';
        $('#vl-mode').textContent = 'modo · Normal';
        $('#vl-challenge').textContent = 'esta escena no tiene ruta real — Arcade no disponible';
        setTimeout(() => { $('#vl-challenge').textContent = ''; }, 2600);
      }
    }
    bus.emit('mode', { key: S.modeKey });
  };

  Object.assign(ctx.actions, {
    setMode, setRig: camera.setRig, cycleRig: camera.cycleRig,
  });
  Object.assign(controls, {
    bindings, camera, setMode,
    step: dt => bindings.step(dt),
    afterStep: () => bindings.afterStep(),
    report: () => bindings.report(),
    onPause: () => bindings.onPause(),
    dispose() {
      bindings.dispose();
      camera.dispose();
    },
  });
  bindings.installHotkeys();
  return controls;
}
