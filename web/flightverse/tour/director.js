// flightverse/tour/director.js — DIRECTOR (P6): keyframes de cámara sobre el replay
// grabado de Gate Rush + reproducción del replay (WS E). Estado en ctx.state:
// director, replay (la entrada/salida las dispara ui/screens vía ctx.actions).
import CameraControls from '/vendor/camera-controls.module.js?v=369';
import { canExport, exportDeterministic } from '/flightverse/export.js?v=369';
import { STEP } from '/flightverse/runtime.js?v=369';
import { lockRenderSize } from '/flightverse/tour/render-guard.js?v=369';

export function createDirector(ctx) {
  const { THREE, camera, renderer, report, CID, state: S, actions: A } = ctx;
  const $ = ctx.$;
  CameraControls.install({ THREE });
  // ── DIRECTOR (P6): keyframes de cámara sobre el replay grabado ──
  const cc = new CameraControls(camera, renderer.domElement);
  cc.enabled = false;
  const recAt = f => {                     // pose del rec 60Hz con lerp
    const drone = ctx.drone;
    const rec = S.reto?.state.rec; if (!rec?.length) return;
    const i = Math.min(Math.floor(f), rec.length - 1);
    const b = rec[Math.min(i + 1, rec.length - 1)], a = rec[i], k = f - i;
    drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
    drone.pos.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    drone.yaw = a[3] + (b[3] - a[3]) * k;
  };
  function enterDirector() {
    const drone = ctx.drone;
    if (!S.reto?.state.rec?.length) return;
    ctx.ui.overlay.open('director');
    S.replay = null;
    S.reto?.setVisible(false);
    S.director = { keys: [], playing: false, f: 0, len: S.reto.state.rec.length - 1 };
    cc.enabled = true;
    cc.setLookAt(drone.pos.x + 20, drone.pos.y + 12, drone.pos.z + 20,
      drone.pos.x, drone.pos.y, drone.pos.z, false);
    $('#dir-scrub').max = String(S.director.len);
    paintKeys();
  }
  function exitDirector() {
    S.director = null; cc.enabled = false; S.reto?.setVisible(true);
    ctx.ui.overlay.close('director');
    if (S.resultShown) ctx.ui.overlay.open('result');
  }
  function paintKeys() {
    $('#dir-keys').innerHTML = S.director.keys.map((k, i) =>
      `<button data-dk="${i}">${(k.f / 60).toFixed(1)}s <svg viewBox="0 0 20 20" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg></button>`).join('')
      || '<span>añade keyframes moviendo la cámara y pulsando + Keyframe</span>';
  }
  const _dirT = new THREE.Vector3();
  const dirCam = f => {                    // cámara interpolada entre keyframes
    const ks = S.director.keys; if (!ks.length) return;
    let a = ks[0], b = ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++)
      if (f >= ks[i].f && f <= ks[i + 1].f) { a = ks[i]; b = ks[i + 1]; break; }
    const span = Math.max(1, b.f - a.f);
    let k = Math.min(1, Math.max(0, (f - a.f) / span));
    k = k * k * (3 - 2 * k);               // smoothstep
    camera.position.lerpVectors(a.pos, b.pos, k);
    _dirT.lerpVectors(a.target, b.target, k);
    camera.lookAt(_dirT);
  };
  $('#dir-key').addEventListener('click', () => {
    if (!S.director) return;
    const t = new THREE.Vector3(); cc.getTarget(t);
    S.director.keys.push({ f: S.director.f, pos: camera.position.clone(), target: t });
    S.director.keys.sort((x, y) => x.f - y.f);
    paintKeys();
  });
  $('#dir-keys').addEventListener('click', e => {
    const i = e.target.closest('[data-dk]')?.dataset.dk;
    if (i == null || !S.director) return;
    S.director.keys.splice(+i, 1); paintKeys();
  });
  $('#dir-scrub').addEventListener('input', e => {
    if (S.director && !S.director.playing) { S.director.f = +e.target.value; recAt(S.director.f); }
  });
  const dirPlay = async (rec) => {
    if (!S.director || S.director.keys.length < 2) return;
    S.director.playing = true; S.director.f = 0; cc.enabled = false;
    if (rec) { ctx.tour.recorder.start(); }
  };
  $('#dir-play').addEventListener('click', () => dirPlay(false));
  $('#dir-rec').addEventListener('click', () => dirPlay(true));
  $('#dir-exit').addEventListener('click', exitDirector);
  $('#dir-hd').addEventListener('click', async () => {
    const { drone, composer, P } = ctx;
    const director = S.director;
    if (!director || director.keys.length < 2) return;
    if (!canExport()) { $('#dir-hd').textContent = 'sin WebCodecs — usa Grabar'; return; }
    const btn = $('#dir-hd');
    btn.disabled = true;
    // resolución fija: cada frame es un paso del rec — determinista de verdad. lockRenderSize aísla el
    // export de `resize`, del gobernador de calidad (applyDpr) y del aspecto de cámara: mientras dura,
    // setSize/setPixelRatio/composer.setSize se ignoran (se recuerda el último pedido) y el aspecto es 16:9.
    const lock = lockRenderSize(ctx, { width: 1920, height: 1080 });
    try {
      const blob = await exportDeterministic({
        frames: director.len, canvas: renderer.domElement, width: 1920, height: 1080,
        drawFrame: f => { recAt(f); drone.lerpPose(1, P); ctx.droneModel.mesh.position.copy(P);
          ctx.droneModel.mesh.rotation.set(0, drone.yaw, 0); dirCam(f); composer.render(); },
        onProgress: p => { btn.textContent = `Exportando ${(p * 100) | 0}%`; },
      });
      ctx.tour.recorder.download(blob, `director_${CID}_1080p.webm`);
      btn.textContent = 'Exportar 1080p';
    } catch (e) {
      btn.textContent = 'error: ' + String(e.message).slice(0, 24);
      report.errors.push('export: ' + e.message);
    } finally {
      btn.disabled = false;
      lock.release();
    }
  });
  A.enterDirector = enterDirector;

  return {
    enterDirector, exitDirector,
    /** Rama del paso fijo mientras S.director: avanza/graba el director. */
    stepDirector(dt) {
      const director = S.director;
      const recorder = ctx.tour.recorder;
      if (director.playing) {
        director.f += dt * 60;
        if (director.f >= director.len) {
          director.f = director.len; director.playing = false; cc.enabled = true;
          if (recorder.recording) recorder.stop().then(b => {
            if (b) recorder.download(b, `director_${CID}.webm`);
          });
        }
        $('#dir-scrub').value = String(director.f);
      }
      recAt(director.f);
    },
    /** Rama del paso fijo mientras S.replay: la grabación (60Hz) manda; física apagada. */
    stepReplay(dt) {
      const drone = ctx.drone;
      const replay = S.replay;
      // replay: la grabación (60Hz) manda; física apagada, interpolación intacta
      replay.f += dt * 60;
      const n = replay.rec.length;
      if (replay.f >= n - 1) replay.f = 0;
      const i = Math.floor(replay.f), f = replay.f - i;
      const a = replay.rec[i], b = replay.rec[Math.min(i + 1, n - 1)];
      drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
      drone.pos.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      drone.yaw = a[3] + (b[3] - a[3]) * f;
    },
    /** Por frame: cámara del director (keyframes o CameraControls libre). */
    cameraUpdate() {
      if (S.director.playing) dirCam(S.director.f);
      else cc.update(STEP);
    },
  };
}
