// splatview.js — visor PREMIUM de gaussian splats, compartido por tresd.js y share.js.
// MOTOR: Spark 2.1 (r180) — migrado desde GaussianSplats3D 0.4.7 (fase E del
// plan FLIGHTVERSE; el autor de GS3D descontinuó la lib y recomienda Spark).
// La UX se conserva completa: doble-click/doble-tap enfoca, home, macro, zoom,
// auto-rotar, FOV, captura, fullscreen con history-state, teclado, y el mismo
// contrato mountSplatViewer(host, url, {bytes, onStatus}) → { viewer, dispose }.
import * as THREE from '/vendor/three180.module.js?v=192';
import { OrbitControls } from '/vendor/three-addons180/controls/OrbitControls.js?v=192';

const SPLAT_ROT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];   // OpenSfM Z-up -> viewer Y-up

// icono inline mínimo (no dependemos de icons.js aquí)
const I = {
  home: '<path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9"/>',
  rot: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>',
  fov: '<path d="M12 12 3 6m9 6L3 18m9-6h9"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
};
const btn = (id, label, path) =>
  `<button data-sv="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24">${path}</svg></button>`;

export async function mountSplatViewer(host, splatUrl, { bytes = 0, onStatus } = {}) {
  const { SparkRenderer, SplatMesh } = await import('/vendor/spark.module.js?v=192');
  host.style.position = 'relative';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;inset:0;touch-action:none';
  host.appendChild(holder);

  // ── escena propia (Spark es drop-in sobre three normal) ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(holder.clientWidth || 640, holder.clientHeight || 420);
  renderer.setClearColor(0x0a0e14, 1);
  holder.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.02, 5000);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const ctrl = new OrbitControls(cam, renderer.domElement);
  // MISMO esquema que nube/malla — tres visores, una sola memoria muscular:
  // izquierdo = pan pegado al suelo (como un mapa), derecho = rotar, rueda = zoom
  ctrl.enableDamping = true;
  ctrl.dampingFactor = 0.07;
  ctrl.rotateSpeed = 0.55;
  ctrl.zoomSpeed = 1.35;
  ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctrl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  ctrl.screenSpacePanning = false;

  let rafId = 0, running = true;
  const loop = () => { rafId = requestAnimationFrame(loop); ctrl.update(); renderer.render(scene, cam); };
  const onVis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
    else if (!running) { running = true; loop(); }
  };
  document.addEventListener('visibilitychange', onVis);

  function teardownCore() {
    cancelAnimationFrame(rafId);
    try { cancelAnimationFrame(anim); } catch {}
    document.removeEventListener('visibilitychange', onVis);
    try { ctrl.dispose(); } catch {}
    try { mesh?.dispose?.(); } catch {}
    try { renderer.forceContextLoss(); renderer.dispose(); } catch {}
    holder.remove();
  }

  // ── carga con timeout proporcional al peso (mismo contrato que antes) ──
  const tmoMs = Math.min(120000, 45000 + Math.round((bytes || 0) / 1048576) * 3000);
  let tmoId = 0;
  const mesh = new SplatMesh({ url: splatUrl });
  mesh.quaternion.set(...SPLAT_ROT);
  scene.add(mesh);
  try {
    const loadP = mesh.initialized;
    loadP.catch(() => {});   // si el timeout gana el race, este rechazo tardío no debe ser 'unhandled'
    await Promise.race([
      loadP,
      new Promise((_, rej) => { tmoId = setTimeout(() => rej(new Error(`timeout de ${Math.round(tmoMs / 1000)}s procesando el splat`)), tmoMs); }),
    ]);
  } catch (err) {
    clearTimeout(tmoId);
    teardownCore();
    throw err;
  }
  clearTimeout(tmoId);
  onStatus?.('Splat · 100%');

  // ── bounds: Spark no expone centro/radio como GS3D — Box3 del mesh con
  // guard anti no-finito (mismo patrón defensivo del visor anterior) ──
  const bb = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  let radius = 1;
  if (Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x)) {
    bb.getCenter(center);
    radius = Math.max(bb.getSize(new THREE.Vector3()).length() / 2, 0.5);
  }
  const homeState = {};
  const homeMin = Math.max(radius * 0.0012, 0.001);
  const inspectMin = Math.max(radius * 0.00008, 0.00018);

  function frame() {
    const dir = new THREE.Vector3(0.18, 0.78, 0.52).normalize();
    cam.position.copy(center).addScaledVector(dir, radius * 1.15);
    cam.near = Math.max(radius / 200000, 0.00002);
    cam.far = Math.max(radius * 100, 50);
    cam.updateProjectionMatrix();
    ctrl.target.copy(center);
    ctrl.minDistance = homeMin;
    ctrl.maxDistance = radius * 18;
    ctrl.update();
    homeState.pos = cam.position.clone();
    homeState.target = center.clone();
    homeState.fov = cam.fov;
  }
  frame();
  loop();

  // resize: el host puede cambiar (fullscreen, layout) — GS lo hacía interno
  const ro = new ResizeObserver(() => {
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  });
  ro.observe(holder);

  // navegación premium — esquema GOOGLE MAPS/EARTH (idéntico al visor anterior)
  ctrl.enableDamping = true; ctrl.dampingFactor = 0.06;
  ctrl.rotateSpeed = 0.6; ctrl.zoomSpeed = 2.15; ctrl.panSpeed = 0.95;
  ctrl.maxPolarAngle = Math.PI * 0.495;
  ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctrl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  ctrl.screenSpacePanning = false;
  if ('zoomToCursor' in ctrl) ctrl.zoomToCursor = true;
  try { ctrl.listenToKeyEvents(window); } catch {}

  // ---- FOCUS por doble-click: rayo al plano del suelo -> target ahí ----
  let anim = 0;
  function animateTo(toTarget, toPos, toMin) {
    const t0 = performance.now(), dur = 550;
    const sT = ctrl.target.clone(), sP = cam.position.clone();
    cancelAnimationFrame(anim);
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - (1 - k) ** 3;
      ctrl.target.lerpVectors(sT, toTarget, e);
      cam.position.lerpVectors(sP, toPos, e);
      ctrl.update();
      if (k < 1) anim = requestAnimationFrame(step);
      else if (toMin != null) ctrl.minDistance = toMin;
    })();
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -center.y);
  const groundRay = new THREE.Raycaster();
  function focusAt(clientX, clientY) {
    const rect = holder.getBoundingClientRect();
    cam.updateMatrixWorld();
    const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1,
                                  -((clientY - rect.top) / rect.height) * 2 + 1);
    groundRay.setFromCamera(ndc, cam);
    const p = new THREE.Vector3();
    if (!groundRay.ray.intersectPlane(groundPlane, p)) return false;
    if (p.distanceTo(center) > radius * 1.5) return false;
    ctrl.minDistance = inspectMin;
    const d = cam.position.distanceTo(p);
    const newPos = p.clone().addScaledVector(cam.position.clone().sub(p).normalize(), Math.min(d, radius * 0.012));
    animateTo(p, newPos);
    return true;
  }
  function dolly(mult) {
    const dir = cam.position.clone().sub(ctrl.target);
    const d = dir.length();
    if (!Number.isFinite(d) || d <= 0) return;
    const nd = Math.max(ctrl.minDistance || inspectMin, Math.min(ctrl.maxDistance || radius * 20, d * mult));
    cam.position.copy(ctrl.target).addScaledVector(dir.normalize(), nd);
    ctrl.update();
  }
  const inViewer = e => holder.contains(e.target) || e.target === holder;
  const onDbl = e => { if (!inViewer(e)) return; e.preventDefault(); e.stopPropagation(); focusAt(e.clientX, e.clientY); };
  host.addEventListener('dblclick', onDbl, true);
  let lastTap = 0, lastTX = 0, lastTY = 0;
  const onPtrUp = e => {
    if (e.pointerType === 'mouse' || !inViewer(e)) return;
    if (e.timeStamp - lastTap < 320 && Math.abs(e.clientX - lastTX) < 32 && Math.abs(e.clientY - lastTY) < 32) {
      lastTap = 0; focusAt(e.clientX, e.clientY);
    } else { lastTap = e.timeStamp; lastTX = e.clientX; lastTY = e.clientY; }
  };
  host.addEventListener('pointerup', onPtrUp, true);

  // ---- HUD premium (sin slider de tamaño: era un uniform de GS3D) ----
  const hud = document.createElement('div');
  hud.className = 'sv-hud';
  hud.innerHTML =
    btn('home', 'Reiniciar vista (R)', I.home) +
    btn('inspect', 'Modo macro', I.target) +
    btn('zin', 'Acercar', I.plus) +
    btn('zout', 'Alejar', I.minus) +
    btn('rot', 'Auto-rotar', I.rot) +
    `<span class="sv-sep"></span>` +
    `<label class="sv-slider" title="Campo de visión">${svg(I.fov)}<input type="range" data-sv="fov" min="30" max="80" value="${Math.round(cam.fov)}"></label>` +
    `<span class="sv-sep"></span>` +
    btn('shot', 'Captura PNG', I.cam) +
    btn('full', 'Pantalla completa (F)', I.full);
  host.appendChild(hud);
  const tip = document.createElement('div');
  tip.className = 'sv-tip';
  const coarse = matchMedia('(hover: none), (pointer: coarse)').matches;
  tip.textContent = coarse
    ? 'Arrastra = mover · pellizca = zoom · 2 dedos = rotar · doble-toca = enfocar'
    : 'Arrastra = mover el mapa · rueda = zoom · click-derecho = rotar · doble-click = enfocar';
  host.appendChild(tip);
  setTimeout(() => tip.classList.add('fade'), 4200);

  function svg(p) { return `<svg viewBox="0 0 24 24">${p}</svg>`; }

  hud.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]'); if (!b) return;
    const k = b.dataset.sv;
    if (k === 'home') {
      ctrl.minDistance = homeMin;
      animateTo(homeState.target, homeState.pos, homeMin);
      cam.fov = homeState.fov; cam.updateProjectionMatrix();
      const fovIn = hud.querySelector('[data-sv="fov"]'); if (fovIn) fovIn.value = Math.round(homeState.fov);
    }
    else if (k === 'inspect') { ctrl.minDistance = inspectMin; dolly(0.08); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 700); }
    else if (k === 'zin') { ctrl.minDistance = inspectMin; dolly(0.25); }
    else if (k === 'zout') dolly(1.55);
    else if (k === 'rot') { ctrl.autoRotate = !ctrl.autoRotate; ctrl.autoRotateSpeed = 0.9; b.classList.toggle('on', ctrl.autoRotate); }
    else if (k === 'shot') screenshot();
    else if (k === 'full') toggleFull();
  });
  hud.addEventListener('input', e => {
    if (e.target.dataset.sv === 'fov') { cam.fov = +e.target.value; cam.updateProjectionMatrix(); }
  });

  function screenshot() {
    try {
      // render síncrono justo antes de leer (sin preserveDrawingBuffer)
      renderer.render(scene, cam);
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = 'splat.png'; a.click();
    } catch { onStatus?.('captura no disponible en este navegador'); }
  }
  function setFull(on) {
    if (on === host.classList.contains('sv-fullscreen')) return;
    host.classList.toggle('sv-fullscreen', on);
    document.documentElement.classList.toggle('sv-noscroll', on);
  }
  function toggleFull() {
    if (!host.classList.contains('sv-fullscreen')) {
      setFull(true);
      try { history.pushState({ svFull: true }, ''); } catch {}
    } else if (history.state && history.state.svFull) {
      try { history.back(); } catch { setFull(false); }
    } else {
      setFull(false);
    }
  }
  function onPop() { if (host.classList.contains('sv-fullscreen')) setFull(false); }
  window.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  function onKey(e) {
    if (!holder.isConnected) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'r' || e.key === 'R') hud.querySelector('[data-sv="home"]').click();
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === '+' || e.key === '=') dolly(0.25);
    else if (e.key === '-' || e.key === '_') dolly(1.55);
    else if (e.key === 'Escape' && host.classList.contains('sv-fullscreen')) toggleFull();
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    host.removeEventListener('dblclick', onDbl, true);
    host.removeEventListener('pointerup', onPtrUp, true);
    cancelAnimationFrame(anim);
    ro.disconnect();
    host.classList.remove('sv-fullscreen');
    document.documentElement.classList.remove('sv-noscroll');
    if (history.state && history.state.svFull) { try { history.back(); } catch {} }
    hud.remove(); tip.remove();
    teardownCore();
  }
  // interfaz compatible con los callers y browser_matrix: camera/controls/dispose
  const viewer = { camera: cam, controls: ctrl, renderer, splatMesh: mesh, dispose };
  return { viewer, dispose };
}
