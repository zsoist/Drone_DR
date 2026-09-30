// flightverse/photo.js — MODO FOTO (WS E, ?fv=2): cámara libre (WASD/sticks/arrastre), distancia
// focal 18–85 mm (FOV diagonal de sensor 35 mm: 100°–29°), DOF real (apertura f/1.8–f/16, enfoque
// con toque), exposición ±2 EV, hora del día continua (-5°..70°), ocultar HUD y guardar PNG.
// La cámara obedece máscaras, el borde del mundo y la geometría. El DOF es una pasada propia que
// sólo existe mientras el modo está activo (cero coste fuera de él).
//
// API (ctx.photo.*): ready, active, enter(), exit(), set({focalMm,fstop,ev,tod,hideHud,autoFocus,
//   showDrone}), get(), focusAt(nx,ny), focusDistance(m), move(x,y,z), look(dyaw,dpitch), zoom(dmm),
//   capture({download}) -> Promise<Blob|null>, state()
// Eventos (bus, sólo ?fv=2): 'photo' {active, ...state}
import { pushOutOfMasks } from '/flightverse/tour/poi.js?v=370';
import { PHOTO_LIMITS, focalToVFov, focalToDiagFov, dofParams } from '/flightverse/tour/photo-math.js?v=370';
import { edgeMetric, boundaryExtent } from '/flightverse/tour/edge.js?v=370';
import { elevationOf, ELEV_MIN, ELEV_MAX } from '/flightverse/tour/tod.js?v=370';

export { PHOTO_LIMITS, focalToVFov, focalToDiagFov, dofParams };

export function createPhoto(ctx, { doc = null, boundary = null, edge = null, grade = null } = {}) {
  const { THREE, camera, renderer, sky, bus, flags } = ctx;
  const masks = doc?.masks || [];
  const L = PHOTO_LIMITS;
  const api = {
    ready: true, active: false, externalUi: false,
    opts: { focalMm: 35, fstop: 4, ev: 0, elev: null, hideHud: false, autoFocus: true, showDrone: false, dof: true },
  };
  const emit = ctx.tour.emitEvt || ((type, detail) => { if (flags.fv2) bus.emit(type, detail); });
  const pos = new THREE.Vector3();
  let yaw = 0, pitch = 0;
  const vel = new THREE.Vector3();
  const mv = { x: 0, y: 0, z: 0 };          // entrada continua -1..1 (derecha, arriba, adelante)
  const keys = new Set();
  let saved = null, dofFx = null, focusDist = 40, captureCb = null, styleEl = null;
  // Profundidad de respaldo para el DOF en vista foto-real: el splat NO escribe depth (el búfer sólo
  // tiene el terreno tramado/cielo). Se dibuja el DSM (incluye edificios y árboles) sólo-depth a media
  // resolución en un RT propio y se le da a la pasada de DOF.
  let depthRT = null, depthScene = null, depthMat = null;
  const usesDsmDepth = () => ctx.report?.representation?.active === 'splat' && !!ctx.terrain?.mesh;
  function ensureDepthRT() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, size.x >> 1), h = Math.max(2, size.y >> 1);
    if (depthRT && depthRT.width === w && depthRT.height === h) return;
    depthRT?.depthTexture?.dispose(); depthRT?.dispose();
    depthRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
    depthRT.depthTexture = new THREE.DepthTexture(w, h);
    depthRT.depthTexture.type = THREE.UnsignedIntType;
    if (!depthScene) {
      depthScene = new THREE.Scene();
      depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide });
      const proxy = new THREE.Mesh(ctx.terrain.mesh.geometry, depthMat);
      proxy.frustumCulled = false;
      depthScene.add(proxy);
    }
  }
  function renderDsmDepth() {
    ensureDepthRT();
    const prev = renderer.getRenderTarget();
    const ar = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(depthRT);
    renderer.render(depthScene, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = ar;
    dofFx.dofPass.setDepthTexture(depthRT.depthTexture);
  }
  const dir = new THREE.Vector3(), tmp = new THREE.Vector3(), ray = new THREE.Vector3();

  function applyCamera() {
    camera.position.copy(pos);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    const vf = focalToVFov(api.opts.focalMm, camera.aspect || 1);
    if (Math.abs(camera.fov - vf) > 0.01) { camera.fov = vf; camera.updateProjectionMatrix(); }
  }

  function updateDof() {
    if (!dofFx) return;
    const p = dofParams(api.opts.focalMm, api.opts.fstop, focusDist);
    dofFx.dof.bokehScale = p.bokehScale;
    dofFx.dof.cocMaterial.focusDistance = p.focusDistance;
    dofFx.dof.cocMaterial.focusRange = p.focusRange;
  }

  function raycastDistance(nx = 0, ny = 0) {
    // rayo desde la cámara por el punto NDC (nx,ny) hasta 600 m; devuelve distancia o null
    camera.updateMatrixWorld();
    ray.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    const end = tmp.copy(camera.position).addScaledVector(ray, 600);
    const hit = ctx.collision?.castSegment?.(camera.position, end, 0);
    return hit ? Math.max(0.5, camera.position.distanceTo(hit.point)) : null;
  }

  api.focusAt = (nx = 0, ny = 0) => {
    const d = raycastDistance(nx, ny);
    focusDist = d ?? 120;
    updateDof();
    return focusDist;
  };
  api.focusDistance = m => { api.opts.autoFocus = false; focusDist = Math.max(0.5, m); updateDof(); };

  api.set = (o = {}) => {
    const s = api.opts;
    if (o.focalMm != null) s.focalMm = Math.max(L.focalMin, Math.min(L.focalMax, +o.focalMm));
    if (o.fstop != null) s.fstop = Math.max(L.fMin, Math.min(L.fMax, +o.fstop));
    if (o.ev != null) { s.ev = Math.max(L.evMin, Math.min(L.evMax, +o.ev)); ctx.grade?.setEvExtra(s.ev); }
    if (o.dof != null) s.dof = !!o.dof;
    if (o.autoFocus != null) s.autoFocus = !!o.autoFocus;
    if (o.showDrone != null) { s.showDrone = !!o.showDrone; }
    if (o.tod != null) {
      const e = typeof o.tod === 'number' ? Math.max(ELEV_MIN, Math.min(ELEV_MAX, o.tod)) : o.tod;
      s.elev = elevationOf(e);
      ctx.tour.setTod?.(e);
    }
    if (o.hideHud != null) { s.hideHud = !!o.hideHud; document.body.classList.toggle('fv-photo-clean', s.hideHud && api.active); }
    if (api.active) { applyCamera(); updateDof(); }
    return api.get();
  };
  api.get = () => ({ ...api.opts, focusDist: +focusDist.toFixed(1), fov: +camera.fov.toFixed(1) });
  api.state = () => ({ active: api.active, framing: api.framing || null, ...api.get(), pos: pos.toArray().map(v => +v.toFixed(1)), yaw, pitch });
  api.move = (x = 0, y = 0, z = 0) => { mv.x = x; mv.y = y; mv.z = z; };
  api.look = (dyaw = 0, dpitch = 0) => {
    yaw -= dyaw; pitch = Math.max(-1.5, Math.min(1.5, pitch - dpitch));
  };
  api.zoom = dmm => api.set({ focalMm: api.opts.focalMm + dmm });
  /** Coloca la cámara libre: pos [x,y,z] y mira a `look` [x,y,z] (o yaw/pitch en grados). */
  api.setPose = (p, look = null, yawDeg = null, pitchDeg = null) => {
    if (p) pos.set(p[0], p[1], p[2]);
    if (look) {
      dir.set(look[0] - pos.x, look[1] - pos.y, look[2] - pos.z);
      yaw = Math.atan2(-dir.x, -dir.z); pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    } else if (yawDeg != null) { yaw = yawDeg * Math.PI / 180; pitch = (pitchDeg || 0) * Math.PI / 180; }
    vel.set(0, 0, 0);
    if (api.active) { applyCamera(); if (api.opts.autoFocus) api.focusAt(0, 0); }
    return api.state();
  };

  // ── entrada de escritorio/táctil propia (sólo mientras el modo está activo) ──
  const KEYMAP = {
    KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyR: [0, 1, 0], KeyF: [0, -1, 0],
    ArrowUp: null, ArrowDown: null,
  };
  const onKeyDown = e => {
    if (!api.active || ctx.ui.overlay?.active()) return;
    if (e.code in KEYMAP && KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'ArrowLeft' || e.code === 'ArrowRight'
      || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      keys.add(e.code); e.preventDefault(); e.stopImmediatePropagation();
    } else if (e.code === 'Escape') { api.exit(); e.stopImmediatePropagation(); }
    else if (e.code === 'Enter') { api.capture({ download: true }); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyH') { api.set({ hideHud: !api.opts.hideHud }); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyC' || e.code === 'KeyP' || e.code === 'KeyT' || e.code === 'KeyG' || e.code === 'KeyV') {
      e.preventDefault(); e.stopImmediatePropagation();          // atajos del vuelo: sin efecto en modo foto
    }
  };
  const onKeyUp = e => { keys.delete(e.code); };
  const pointers = new Map();
  let pinch0 = 0, moved = 0, downAt = 0;
  const onDown = e => {
    if (!api.active || e.target !== renderer.domElement) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0; downAt = performance.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    }
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
  };
  const onMove = e => {
    const p = pointers.get(e.pointerId);
    if (!p || !api.active) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 1) {
      const k = (camera.fov * Math.PI / 180) / Math.max(200, innerHeight);       // px -> rad según el FOV
      api.look(dx * k, dy * k);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) api.zoom((d - pinch0) * 0.12);
      pinch0 = d;
    }
  };
  const onUp = e => {
    const had = pointers.delete(e.pointerId);
    if (had && api.active && pointers.size === 0 && moved < 8 && performance.now() - downAt < 350
      && e.target === renderer.domElement) {
      // toque corto = enfocar ahí (NDC)
      api.opts.autoFocus = false;
      api.focusAt((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
    }
  };
  const onWheel = e => {
    if (!api.active || e.target !== renderer.domElement) return;
    api.zoom(-Math.sign(e.deltaY) * 3); e.preventDefault();
  };

  function injectStyle() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'fv-photo-style';
    // HUD fuera: todo salvo el canvas y la UI marcada del modo foto (data-fv-photo-ui)
    styleEl.textContent = 'body.fv-photo-clean>*:not(canvas):not([data-fv-photo-ui]){visibility:hidden!important}';
    document.head.appendChild(styleEl);
  }

  // Encuadre inicial favorecedor: antes la foto arrancaba con la cámara FPV inclinada 28° hacia arriba (sólo cielo). Se sitúa
  // en el punto de vista del POI más cercano (los POI ya traen cámara y objetivo curados) y mira a su objetivo; si no hay
  // POI a <= 250 m, vista 3/4 del dron (por detrás y a la derecha, inclinada ~20° hacia abajo) con el dron visible.
  function frameFlattering() {
    const from = camera.position;
    let best = null, bd = 250;
    for (const p of (doc?.pois || [])) {
      const v = p.spline?.[0];
      if (!v || !p.look) continue;
      const d = Math.hypot(v[0] - from.x, v[1] - from.y, v[2] - from.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const v = best.spline[0];
      pos.set(v[0], v[1], v[2]);
      dir.set(best.look[0] - pos.x, best.look[1] - pos.y, best.look[2] - pos.z);
      yaw = Math.atan2(-dir.x, -dir.z); pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      vel.set(0, 0, 0);
      return { kind: 'poi', id: best.id, pitchDeg: +(pitch * 180 / Math.PI).toFixed(1) };
    }
    const d = ctx.drone?.pos;
    if (!d) return { kind: 'keep' };
    const hy = ctx.drone.yaw || 0;
    const fx = -Math.sin(hy), fz = -Math.cos(hy);                 // avance del dron
    const R = 10, back = 0.8, side = 0.6;                          // 3/4 trasero derecho
    pos.set(d.x - fx * R * back + (-fz) * R * side * -1, d.y + R * Math.tan(20 * Math.PI / 180), d.z - fz * R * back + (fx) * R * side * -1);
    dir.set(d.x - pos.x, d.y - pos.y, d.z - pos.z);
    yaw = Math.atan2(-dir.x, -dir.z); pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    vel.set(0, 0, 0);
    api.opts.showDrone = true;
    return { kind: 'drone', pitchDeg: +(pitch * 180 / Math.PI).toFixed(1) };
  }

  api.enter = () => {
    if (api.active) return true;
    api.active = true;
    injectStyle();
    saved = { fov: camera.fov, pos: camera.position.clone(), rot: camera.rotation.clone(), tod: sky?.elevation };
    pos.copy(camera.position);
    // yaw/pitch desde la orientación actual de la cámara
    dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    yaw = Math.atan2(-dir.x, -dir.z); pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    ctx.state.photoActive = true;
    api.framing = frameFlattering();
    if (api.opts.dof && ctx.gradeApi?.createDof) {
      dofFx = ctx.gradeApi.createDof();
      ctx.gradeApi.addPassBefore(dofFx.dofPass);
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    api.focusAt(0, 0);
    applyCamera();
    updateDof();
    emit('photo', { active: true, ...api.state() });
    return true;
  };

  api.exit = () => {
    if (!api.active) return;
    api.active = false;
    ctx.state.photoActive = false;
    keys.clear(); pointers.clear();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('pointerup', onUp);
    renderer.domElement.removeEventListener('pointercancel', onUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    if (dofFx) { ctx.gradeApi.removePass(dofFx.dofPass); dofFx.dof.dispose?.(); dofFx.dofPass.dispose?.(); dofFx = null; }
    if (depthRT) { depthRT.depthTexture?.dispose(); depthRT.dispose(); depthRT = null; }
    document.body.classList.remove('fv-photo-clean');
    ctx.grade?.setEvExtra(0);
    if (saved) { camera.fov = saved.fov; camera.updateProjectionMatrix(); }
    emit('photo', { active: false });
  };

  api.toggle = () => (api.active ? api.exit() : api.enter());

  /** Por frame (cabecera de render, antes del render). Devuelve true si posee la cámara. */
  api.frame = rdt => {
    if (!api.active) return false;
    // entrada continua + teclado
    let ix = mv.x, iy = mv.y, iz = mv.z;
    for (const k of keys) {
      const m = KEYMAP[k];
      if (m) { ix += m[0]; iy += m[1]; iz += m[2]; }
      else if (k === 'KeyQ' || k === 'ArrowLeft') api.look(-1.2 * rdt, 0);
      else if (k === 'KeyE' || k === 'ArrowRight') api.look(1.2 * rdt, 0);
      else if (k === 'ArrowUp') api.look(0, 0.9 * rdt);
      else if (k === 'ArrowDown') api.look(0, -0.9 * rdt);
    }
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = fast ? L.speedFast : (keys.has('ControlLeft') ? L.speedSlow : L.speed);
    // avance en el plano del encuadre (incluye el pitch: estilo cámara libre)
    dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = tmp.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const want = ray.set(0, 0, 0).addScaledVector(dir, iz).addScaledVector(right, ix);
    want.y += iy;
    if (want.lengthSq() > 1) want.normalize();
    vel.lerp(want.multiplyScalar(speed), 1 - Math.exp(-rdt / 0.12));
    pos.addScaledVector(vel, rdt);

    // reglas del mundo: borde, máscaras, suelo, geometría
    if (boundary && edge) {
      const R = boundaryExtent(boundary) - 3;
      const m = edgeMetric(pos.x, pos.z, boundary);
      if (m > R) {
        if (boundary.shape === 'square') { pos.x = Math.max(-R, Math.min(R, pos.x)); pos.z = Math.max(-R, Math.min(R, pos.z)); }
        else { const k = R / m; pos.x *= k; pos.z *= k; }
      }
    }
    if (masks.length) { const q = pushOutOfMasks([pos.x, pos.y, pos.z], masks, 2); pos.set(q[0], q[1], q[2]); }
    const g = ctx.terrain?.heightAt?.(pos.x, pos.z);
    if (g != null) pos.y = Math.max(pos.y, g + L.minAgl);
    const hit = ctx.collision?.closest?.(pos, L.minGeoDist);
    if (hit && hit.kind !== 'terrain' && hit.normal && hit.distance < L.minGeoDist) {
      pos.addScaledVector(hit.normal, L.minGeoDist - hit.distance);
    }
    applyCamera();
    camera.updateMatrixWorld();
    if (dofFx && usesDsmDepth()) renderDsmDepth();
    if (api.opts.autoFocus && dofFx && (vel.lengthSq() > 0.01 || (frameN++ % 20 === 0))) {
      // foco automático al centro (suavizado)
      const d = raycastDistance(0, 0);
      if (d != null) focusDist += (d - focusDist) * (1 - Math.exp(-rdt / 0.25));
      updateDof();
    }
    return true;
  };
  let frameN = 0;

  /**
   * Captura PNG del próximo frame (después del render). `composerRender` lo llama tour/index.js
   * tras composer.render(): el búfer de dibujo sigue válido en la misma tarea.
   */
  api.afterRender = () => {
    if (!captureCb) return;
    const cb = captureCb; captureCb = null;
    try {
      const cv = renderer.domElement;
      const long = Math.max(cv.width, cv.height);
      let src = cv;
      if (long > L.maxLongSide) {
        const k = L.maxLongSide / long;
        const c2 = document.createElement('canvas');
        c2.width = Math.round(cv.width * k); c2.height = Math.round(cv.height * k);
        c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height);
        src = c2;
      }
      src.toBlob(b => cb(b), 'image/png');
    } catch (e) { cb(null); console.warn('[photo] captura falló:', e?.message || e); }
  };

  api.capture = ({ download = true } = {}) => new Promise(resolve => {
    if (!api.active) { resolve(null); return; }
    captureCb = blob => {
      if (blob && download) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `flightverse_${ctx.CID}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
      emit('photo', { active: true, captured: !!blob, bytes: blob?.size || 0 });
      resolve(blob);
    };
    // pide un frame fresco; si el render está en pausa, afterRender lo atiende en el siguiente
  });
  api.dispose = () => api.exit();
  return api;
}
