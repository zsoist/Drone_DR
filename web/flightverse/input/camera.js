// flightverse/input/camera.js — rigs de cámara, gimbal y herramientas de vuelo (WS C).
// Envuelve camera-rigs.js: selección de rig, gimbal (rueda/slider/botones), FOV kick,
// pose por frame y colisión de cámara. Publica ctx.controls.{cameraController, flightTools}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { resolveCameraCollision, RIGS, STEP } from '/flightverse/runtime.js?v=370';
import { createCameraRigController } from '/flightverse/camera-rigs.js?v=370';
import { createFlightTools } from '/flightverse/flight-tools.js?v=370';

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
  let maskPushes = 0;

  // ── Flightverse v2 (?fv=2): resorte, colisión por esfera, empuje fuera de geometría, cámara de choque ──
  const v2 = !!ctx.flags.fv2 || Q.get('phys') === 'v2';
  const V3 = (x, y, z) => ({ x, y, z });
  const ca = V3(0, 0, 0), cb = V3(0, 0, 0);
  const pushRadii = { structure: 0.3, terrain: 0.35, boundary: 0.3 };
  const collisionAdapter = {
    cast(a, b, radius) {
      ca.x = a[0]; ca.y = a[1]; ca.z = a[2]; cb.x = b[0]; cb.y = b[1]; cb.z = b[2];
      try {
        const hit = collision.castSegment(ca, cb, radius);
        return hit && Number.isFinite(hit.fraction) ? hit.fraction : null;
      } catch { return null; }
    },
    push(p) {
      ca.x = p[0]; ca.y = p[1]; ca.z = p[2];
      try {
        const rec = collision.recoverSphere?.(ca, pushRadii);
        return rec?.translation ? [rec.translation.x, rec.translation.y, rec.translation.z] : null;
      } catch { return null; }
    },
  };
  const defaultGimbal = gimbalTilt;
  let fadeEl = null;
  let fadeOut = 0;                 // s restantes del fundido de entrada tras reaparecer
  let crashShown = false;
  if (v2) {
    camera.near = Math.min(camera.near, 0.15);
    camera.updateProjectionMatrix();
    const style = document.createElement('style');
    style.textContent = '.vl-fv-fade{position:fixed;inset:0;z-index:50;background:#000;opacity:0;pointer-events:none}';
    document.head.appendChild(style);
    fadeEl = document.createElement('div');
    fadeEl.className = 'vl-fv-fade';
    fadeEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fadeEl);
  }
  let lastT = 0;
  const frameDt = () => {
    const t = performance.now();
    const d = lastT ? Math.min(0.1, Math.max(0.0005, (t - lastT) / 1000)) : 1 / 60;
    lastT = t;
    return d;
  };

  return {
    setRig, cycleRig, setGimbal, defaultGimbal,
    /** v2: el choque destruye el dron -> la cámara de choque muestra los restos aunque sea FPV. */
    onCrash() { crashShown = true; ctx.droneModel.mesh.visible = true; },
    onRespawn() {
      crashShown = false; fadeOut = 0.2;
      ctx.droneModel.mesh.visible = !RIGS[rigIx].hideDrone;
      ctx.droneFade = 1;
    },
    get rigIx() { return rigIx; },
    get gimbalTilt() { return gimbalTilt; },
    /** Contadores de colisión de cámara (para el reporte final del autotest). */
    stats: () => ({ checks: cameraCollisionChecks, hits: cameraCollisionHits }),
    /** FOV kick con turbo + patada de sacudida: sensación de velocidad AAA (lerp suave, barato). */
    updateFov(rdt) {
      const shake = ctx.fx.shake;
      if (shake.fov > 0.05) shake.fov *= Math.pow(0.006, rdt);   // decae ~rápido
      const activeCamera = cameraController.snapshot();
      let wantFov = activeCamera.fov + (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 9 : 0)
        + (shake.fov || 0);
      if (v2 && ctx.phys?.active) {
        // v2: FOV sube con la velocidad (hasta +6°) y con el turbo (+9°), más la respiración del orbit
        const k = Math.min(1, ctx.drone.vel.length() / 14);
        wantFov = activeCamera.fov + 6 * k * k * (3 - 2 * k) + 9 * (ctx.phys.boost || 0)
          + (shake.fov || 0) + (activeCamera.fovBreath || 0);
      }
      if (Math.abs(camera.fov - wantFov) > 0.1) {
        camera.fov += (wantFov - camera.fov) * 0.08;
        camera.updateProjectionMatrix();
      }
    },
    /** Pose de cámara del rig activo (rama por defecto del render) + colisión + reporte. */
    update(o) {
      const { P, drone } = ctx;
      const dw = input.takeWheel();
      if (dw) setGimbal(gimbalTilt - (v2 ? (dw / 100) * 3 * Math.PI / 180 : dw * 0.0011));   // v2: 3° por muesca
      const rdt = v2 ? frameDt() : 0;
      let crashInfo = null, v2opts = null;
      if (v2 && ctx.phys?.active) {
        crashInfo = ctx.phys.crash;
        const st = ctx.controls.v2?.settings;
        v2opts = {
          fpvTilt: (st ? st.get().fpvTiltDeg : 28) * Math.PI / 180,
          reduced: st ? st.reducedMotion() : false,
        };
      }
      const cameraPose = cameraController.update({
        dronePosition: P,
        dronePose: o,
        velocity: drone.vel,
        dt: STEP,
        realDt: rdt,
        collision: v2 && o.v2 ? collisionAdapter : null,
        v2opts,
        crash: crashInfo,
      });
      camera.position.set(...cameraPose.position);
      camera.quaternion.set(...cameraPose.quaternion);
      if (v2 && cameraPose.key !== 'fpv' && ctx.masks?.list?.length) {
        // E: zonas sin cámara (malla rota…): la cámara que orbita/persigue sale de ellas a lo largo del gradiente.
        // FPV no se toca: la vista ES el dron y mover el ojo sin mover el dron desorienta.
        const cp = [camera.position.x, camera.position.y, camera.position.z];
        if (ctx.masks.inside(cp, 2)) {
          const out = ctx.masks.pushOut(cp, 2);
          camera.position.set(out[0], out[1], out[2]);
          maskPushes += 1;
        }
      }
      if (v2 && o.v2) {
        ctx.droneFade = cameraPose.droneFade;
        if (cameraPose.key !== 'fpv') {
          cameraCollisionChecks += 1;
          if (cameraPose.armScale < 0.98) cameraCollisionHits += 1;
        }
        if (crashInfo) {                             // fundido negro del respawn (200 ms) + entrada
          let a = 0;
          if (crashInfo.active && crashInfo.t > 0.8) a = Math.min(1, (crashInfo.t - 0.8) / 0.1);
          else if (fadeOut > 0) { fadeOut = Math.max(0, fadeOut - rdt); a = fadeOut / 0.2; }
          if (fadeEl) fadeEl.style.opacity = a.toFixed(3);
        }
        if (crashShown && !crashInfo?.active && !ctx.phys.crash.active) crashShown = false;
      } else if (!cameraPose.hideDrone) {
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
        mask_pushes: maskPushes,
      };
    },
    dispose() {
      fadeEl?.remove();
      flightTools.dispose();
      cameraController.dispose();
    },
  };
}
