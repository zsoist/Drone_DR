// flightverse/input/camera.js — rigs de cámara, gimbal y herramientas de vuelo (WS C).
// Envuelve camera-rigs.js: selección de rig, gimbal (rueda/slider/botones), FOV kick,
// pose por frame y colisión de cámara. Publica ctx.controls.{cameraController, flightTools}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { resolveCameraCollision, RIGS, STEP } from '/flightverse/runtime.js?v=367';
import { createCameraRigController } from '/flightverse/camera-rigs.js?v=367';
import { createFlightTools } from '/flightverse/flight-tools.js?v=367';

export function createCameraControls(ctx) {
  const { Q, camera, report, collision, input } = ctx;
  const $ = ctx.$;
  const controls = ctx.controls;
  const requestedRig = Q.get('rig');
  let rigIx = Math.max(0, RIGS.findIndex(rig => rig.key === 'fpv'));
  if (requestedRig != null) {
    const byKey = RIGS.findIndex(rig => rig.key === requestedRig);
    rigIx = byKey >= 0 ? byKey : Math.abs(+requestedRig || 0) % RIGS.length;
  }
  const cameraController = createCameraRigController({ initialKey: RIGS[rigIx].key });
  controls.cameraController = cameraController;
  let gimbalTilt = cameraController.snapshot().gimbalRadians;
  const setGimbal = r => {
    gimbalTilt = cameraController.setGimbalRadians(r);
    $('#osd-gimbal').textContent = `GIMBAL ${Math.round(gimbalTilt * 180 / Math.PI)}°`;
    controls.flightTools?.syncGimbalRadians(gimbalTilt);
  };
  const setRig = ix => {
    rigIx = ((ix % RIGS.length) + RIGS.length) % RIGS.length;
    cameraController.select(RIGS[rigIx].key);
    report.camera.rig = cameraController.snapshot().key;
    camera.fov = RIGS[rigIx].fov; camera.updateProjectionMatrix();
    $('#vl-rig').textContent = `cámara · ${RIGS[rigIx].label}`;
    ctx.droneModel.mesh.visible = !RIGS[rigIx].hideDrone;
    $('#vl-fpv').classList.toggle('show', !!RIGS[rigIx].hideDrone);
    $('#vl-hud').classList.toggle('fpv-active', !!RIGS[rigIx].hideDrone);
    $('#vl-gimbal-toggle').disabled = !RIGS[rigIx].hideDrone;
    if (!RIGS[rigIx].hideDrone) controls.flightTools?.closeGimbal('camera');
    controls.flightTools?.syncCamera(RIGS[rigIx]);
  };
  const cycleRig = () => setRig(rigIx + 1);
  const cameraItems = [...document.querySelectorAll('#vl-camera-picker button[data-camera]')];
  const flightTools = createFlightTools({
    cameraTrigger: $('#vl-camera-toggle'),
    cameraPickerTrigger: $('#vl-camera-picker-toggle'),
    cameraPanel: $('#vl-camera-picker'),
    cameraItems,
    gimbalTrigger: $('#vl-gimbal-toggle'),
    gimbalTray: $('#vl-gimbal-tray'),
    gimbalRange: $('#vl-gimbal-range'),
    gimbalValue: $('#vl-gimbal-value'),
    gimbalButtons: [...document.querySelectorAll('#vl-gimbal-tray button')],
    eventRoot: document,
    visibilityRoot: document,
    onCycleCamera: direction => setRig(rigIx + direction),
    onSelectCamera: key => {
      const next = RIGS.findIndex(rig => rig.key === key);
      if (next >= 0) setRig(next);
    },
    onGimbal: setGimbal,
  });
  controls.flightTools = flightTools;
  flightTools.syncGimbalRadians(gimbalTilt);

  let cameraCollisionHits = 0;
  let cameraCollisionChecks = 0;

  return {
    setRig, cycleRig, setGimbal,
    get rigIx() { return rigIx; },
    get gimbalTilt() { return gimbalTilt; },
    /** Contadores de colisión de cámara (para el reporte final del autotest). */
    stats: () => ({ checks: cameraCollisionChecks, hits: cameraCollisionHits }),
    /** FOV kick con turbo + patada de sacudida: sensación de velocidad AAA (lerp suave, barato). */
    updateFov(rdt) {
      const shake = ctx.fx.shake;
      if (shake.fov > 0.05) shake.fov *= Math.pow(0.006, rdt);   // decae ~rápido
      const activeCamera = cameraController.snapshot();
      const wantFov = activeCamera.fov + (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 9 : 0)
        + (shake.fov || 0);
      if (Math.abs(camera.fov - wantFov) > 0.1) {
        camera.fov += (wantFov - camera.fov) * 0.08;
        camera.updateProjectionMatrix();
      }
    },
    /** Pose de cámara del rig activo (rama por defecto del render) + colisión + reporte. */
    update(o) {
      const { P, drone } = ctx;
      const dw = input.takeWheel();
      if (dw) setGimbal(gimbalTilt - dw * 0.0011);
      const cameraPose = cameraController.update({
        dronePosition: P,
        dronePose: o,
        velocity: drone.vel,
        dt: STEP,
      });
      camera.position.set(...cameraPose.position);
      camera.quaternion.set(...cameraPose.quaternion);
      if (!cameraPose.hideDrone) {
        cameraCollisionChecks += 1;
        report.camera.collision_checks = cameraCollisionChecks;
        if (resolveCameraCollision(collision, P, camera.position)) {
          cameraCollisionHits += 1;
          report.camera.collision_hits = cameraCollisionHits;
        }
      }
      report.camera = {
        ...report.camera,
        ...cameraPose,
        rig: cameraPose.key,
        collision_checks: cameraCollisionChecks,
        collision_hits: cameraCollisionHits,
      };
    },
    dispose() {
      flightTools.dispose();
      cameraController.dispose();
    },
  };
}
