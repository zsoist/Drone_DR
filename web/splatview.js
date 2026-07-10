// splatview.js — visor PREMIUM de gaussian splats, compartido por tresd.js y share.js.
// Feature clave: doble-click raycastea contra el splat y mueve el target de la órbita a ESE
// punto — así te acercas a cualquier edificio (antes el target era el centroide = siempre
// zoomeabas al medio). Más: reset, auto-rotar, FOV, tamaño, screenshot, pantalla
// completa, teclado. Navegación suave con damping + animación de focus con easing.
import * as THREE from '/vendor/three.module.js';

const SPLAT_ROT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];   // OpenSfM Z-up -> viewer Y-up

// icono inline mínimo (no dependemos de icons.js aquí)
const I = {
  home: '<path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9"/>',
  rot: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>',
  eye: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
  fov: '<path d="M12 12 3 6m9 6L3 18m9-6h9"/>',
  size: '<circle cx="12" cy="12" r="2.5"/><path d="M5 5h3M5 5v3M19 5h-3M19 5v3M5 19h3M5 19v-3M19 19h-3M19 19v-3"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
};
const btn = (id, label, path) =>
  `<button data-sv="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24">${path}</svg></button>`;

export async function mountSplatViewer(host, splatUrl, { bytes = 0, onStatus } = {}) {
  const GS = await import('/vendor/gaussian-splats-3d.module.min.js');
  host.style.position = 'relative';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;inset:0;touch-action:none';
  host.appendChild(holder);

  const viewer = new GS.Viewer({
    rootElement: holder, sharedMemoryForWorkers: false, antialiased: true,
    halfPrecisionCovariancesOnGPU: true, showLoadingUI: false,
    sceneRevealMode: GS.SceneRevealMode.Instant,
    splatRenderMode: GS.SplatRenderMode.ThreeD,
    // renderMode Always (default): OnChange congela autoRotate/damping/focus (el loop deja de
    // llamar controls.update()). La batería en móvil se cuida pausando el loop cuando la pestaña
    // se oculta (visibilitychange, abajo) — cubre el caso "abrió el share y lo dejó de fondo".
    cameraUp: [0, 1, 0], initialCameraPosition: [0, 5, 4], initialCameraLookAt: [0, 0, 0],
  });

  const tmoMs = Math.min(120000, 45000 + Math.round((bytes || 0) / 1048576) * 3000);
  let tmoId = 0;
  try {
    const loadP = viewer.addSplatScene(splatUrl, {
      progressiveLoad: false, showLoadingUI: false, splatAlphaRemovalThreshold: 8,
      rotation: SPLAT_ROT, onProgress: p => onStatus?.(`Splat · ${Math.round(p)}%`),
    });
    loadP.catch(() => {});   // si el timeout gana el race, este rechazo tardío no debe ser 'unhandled'
    await Promise.race([
      loadP,
      new Promise((_, rej) => { tmoId = setTimeout(() => rej(new Error(`timeout de ${Math.round(tmoMs / 1000)}s procesando el splat`)), tmoMs); }),
    ]);
  } catch (err) {
    // el viewer YA existe (contexto WebGL + workers WASM): si no lo desechamos aquí, el caller
    // recibe la excepción sin `handle`, nunca llama dispose() y el visor queda huérfano (fuga
    // de contexto GPU; el navegador limita ~16 y el visor deja de renderizar tras varios timeouts).
    clearTimeout(tmoId);
    try { const p = viewer.dispose(); if (p?.catch) p.catch(() => {}); } catch {}
    holder.remove();
    throw err;
  }
  clearTimeout(tmoId);   // éxito: cancela el timer pendiente (si no, dispara un reject no-op tardío)

  const THREEV = THREE;
  const mesh = viewer.splatMesh;
  const center = (mesh?.calculatedSceneCenter && mesh.calculatedSceneCenter.clone()) || new THREEV.Vector3();
  // guarda contra Infinity (splat con posiciones no acotadas): 'NaN || x' cae al fallback pero
  // 'Infinity || x' es truthy → near/far/minDistance=Infinity → proyección degenerada, visor negro.
  const rawR = mesh?.maxSplatDistanceFromSceneCenter;
  const rawR2 = mesh?.visibleRegionRadius;
  const radius = Math.max(
    Number.isFinite(rawR) ? rawR : (Number.isFinite(rawR2) ? rawR2 : 1), 0.5);
  const cam = viewer.camera, ctrl = viewer.controls;
  const homeState = {};
  const homeMin = Math.max(radius * 0.0012, 0.001);
  const inspectMin = Math.max(radius * 0.00008, 0.00018);

  function frame() {
    const dir = new THREEV.Vector3(0.18, 0.78, 0.52).normalize();
    cam.position.copy(center).addScaledVector(dir, radius * 1.15);
    cam.near = Math.max(radius / 200000, 0.00002);      // near macro: acercarse sin clip
    cam.far = Math.max(radius * 100, 50);
    cam.updateProjectionMatrix();
    ctrl.target.copy(center);
    ctrl.minDistance = homeMin;                         // home usable; macro baja el piso más
    ctrl.maxDistance = radius * 18;
    ctrl.update();
    homeState.pos = cam.position.clone();
    homeState.target = center.clone();
    homeState.fov = cam.fov;
  }
  frame();
  viewer.start();

  // navegación premium — esquema GOOGLE MAPS/EARTH: arrastrar = MOVER el mapa (pan),
  // rueda = zoom al cursor, click-derecho o Ctrl+arrastrar = rotar/inclinar;
  // táctil: 1 dedo = mover, pellizco = zoom, 2 dedos girando = rotar.
  // (el fork de OrbitControls del viewer usa los mismos enums numéricos de three)
  ctrl.enableDamping = true; ctrl.dampingFactor = 0.06;
  ctrl.rotateSpeed = 0.6; ctrl.zoomSpeed = 2.15; ctrl.panSpeed = 0.95;
  ctrl.maxPolarAngle = Math.PI * 0.495;
  ctrl.mouseButtons = { LEFT: THREEV.MOUSE.PAN, MIDDLE: THREEV.MOUSE.DOLLY, RIGHT: THREEV.MOUSE.ROTATE };
  ctrl.touches = { ONE: THREEV.TOUCH.PAN, TWO: THREEV.TOUCH.DOLLY_ROTATE };
  ctrl.screenSpacePanning = false;                   // pan pegado al suelo, como un mapa
  if ('zoomToCursor' in ctrl) ctrl.zoomToCursor = true;
  try { ctrl.listenToKeyEvents(window); } catch {}   // flechas = pan

  // ---- FOCUS por doble-click: raycast al splat -> target ahí -> minDistance diminuto ----
  const dims = new THREEV.Vector2();
  let anim = 0;
  function animateTo(toTarget, toPos, toMin) {
    const vcam = viewer.camera, vctrl = viewer.controls;   // refs frescas (la cámara puede cambiar)
    const t0 = performance.now(), dur = 550;
    const sT = vctrl.target.clone(), sP = vcam.position.clone();
    cancelAnimationFrame(anim);
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - (1 - k) ** 3;
      vctrl.target.lerpVectors(sT, toTarget, e);
      vcam.position.lerpVectors(sP, toPos, e);
      vctrl.update();
      viewer.forceRenderNextFrame?.();          // OnChange: garantiza que la animación de focus se dibuje
      if (k < 1) anim = requestAnimationFrame(step);
      else if (toMin != null) vctrl.minDistance = toMin;
    })();
  }
  const groundPlane = new THREEV.Plane(new THREEV.Vector3(0, 1, 0), -center.y);
  const groundRay = new THREEV.Raycaster();
  function focusAt(clientX, clientY) {
    const rect = holder.getBoundingClientRect();
    const vcam = viewer.camera;                         // FRESCO: el viewer intercambia su cámara tras montar
    vcam.updateMatrixWorld();                           // matriz fresca aunque el rAF esté pausado (tab de fondo)
    // plano del suelo (la escena aérea ≈ plana): determinista y siempre acierta. Intersecta
    // el rayo del cursor con el plano a la altura del centro de escena → punto de focus.
    const ndc = new THREEV.Vector2((clientX - rect.left) / rect.width * 2 - 1,
                                   -((clientY - rect.top) / rect.height) * 2 + 1);
    groundRay.setFromCamera(ndc, vcam);
    const p = new THREEV.Vector3();
    if (!groundRay.ray.intersectPlane(groundPlane, p)) return false;
    // clamp al radio de la escena (un rayo casi paralelo al suelo daría un punto lejísimos)
    if (p.distanceTo(center) > radius * 1.5) return false;
    // baja el piso YA (no al final de la animación) → puedes seguir con la rueda hasta pegarte
    viewer.controls.minDistance = inspectMin;
    // acércate al punto: macro real para revisar fachadas/techos sin quedar flotando lejos.
    const d = vcam.position.distanceTo(p);
    const newPos = p.clone().addScaledVector(vcam.position.clone().sub(p).normalize(), Math.min(d, radius * 0.012));
    animateTo(p, newPos);
    return true;
  }
  function dolly(mult) {
    const vcam = viewer.camera, vctrl = viewer.controls;
    const dir = vcam.position.clone().sub(vctrl.target);
    const d = dir.length();
    if (!Number.isFinite(d) || d <= 0) return;
    const nd = Math.max(vctrl.minDistance || inspectMin, Math.min(vctrl.maxDistance || radius * 20, d * mult));
    vcam.position.copy(vctrl.target).addScaledVector(dir.normalize(), nd);
    vctrl.update();
    kick();
  }
  // el canvas del viewer captura los pointer events de sus controles; escuchamos en el HOST
  // en fase de captura (baja top-down antes que nada) para no depender del bubbling
  const inViewer = e => holder.contains(e.target) || e.target === holder;   // solo dentro del visor
  const onDbl = e => { if (!inViewer(e)) return; e.preventDefault(); e.stopPropagation(); focusAt(e.clientX, e.clientY); };
  host.addEventListener('dblclick', onDbl, true);
  // TÁCTIL: dblclick es poco fiable en móvil/iPad → detector propio de doble-tap sobre pointerup
  let lastTap = 0, lastTX = 0, lastTY = 0;
  const onPtrUp = e => {
    if (e.pointerType === 'mouse' || !inViewer(e)) return;
    if (e.timeStamp - lastTap < 320 && Math.abs(e.clientX - lastTX) < 32 && Math.abs(e.clientY - lastTY) < 32) {
      lastTap = 0; focusAt(e.clientX, e.clientY);
    } else { lastTap = e.timeStamp; lastTX = e.clientX; lastTY = e.clientY; }
  };
  host.addEventListener('pointerup', onPtrUp, true);

  // ---- HUD premium ----
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
    `<label class="sv-slider" title="Tamaño de splat">${svg(I.size)}<input type="range" data-sv="scale" min="60" max="160" value="100"></label>` +
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

  // fuerza un frame: en renderMode OnChange, cambiar FOV/brillo/tamaño no mueve la cámara y
  // no re-dibujaría solo. forceRenderNextFrame() de la lib pinta el siguiente frame.
  const kick = () => { try { viewer.forceRenderNextFrame?.(); } catch {} };
  // brillo/exposición del render (si el renderer lo soporta)
  const setExposure = v => { try { if (viewer.renderer) { viewer.renderer.toneMappingExposure = v; } } catch {} };
  // tamaño de splat (uniform del mesh, si existe)
  const setScale = v => { try { if (mesh && 'splatScale' in mesh) mesh.splatScale = v; } catch {} };

  hud.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]'); if (!b) return;
    const k = b.dataset.sv;
    const vcam = viewer.camera, vctrl = viewer.controls;   // refs frescas: el viewer intercambia cámara tras montar
    if (k === 'home') {
      vctrl.minDistance = homeMin;
      animateTo(homeState.target, homeState.pos, homeMin);
      vcam.fov = homeState.fov; vcam.updateProjectionMatrix();
      const fovIn = hud.querySelector('[data-sv="fov"]'); if (fovIn) fovIn.value = Math.round(homeState.fov);  // re-sincroniza el slider
      kick();
    }
    else if (k === 'inspect') { vctrl.minDistance = inspectMin; dolly(0.08); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 700); }
    else if (k === 'zin') { vctrl.minDistance = inspectMin; dolly(0.25); }
    else if (k === 'zout') dolly(1.55);
    else if (k === 'rot') { vctrl.autoRotate = !vctrl.autoRotate; vctrl.autoRotateSpeed = 0.9; b.classList.toggle('on', vctrl.autoRotate); kick(); }
    else if (k === 'shot') screenshot();
    else if (k === 'full') toggleFull();
  });
  hud.addEventListener('input', e => {
    const k = e.target.dataset.sv, v = +e.target.value;
    const vcam = viewer.camera;
    if (k === 'fov') { vcam.fov = v; vcam.updateProjectionMatrix(); }
    else if (k === 'scale') setScale(v / 100);
    kick();
  });

  function screenshot() {
    try {
      // frame SÍNCRONO justo antes de leer: el renderer vendido no usa preserveDrawingBuffer,
      // así que fuera del instante posterior a un draw el buffer sale negro. update()+render()
      // deja píxeles frescos que toDataURL sí captura en el mismo tick.
      try { viewer.update?.(); viewer.render?.(); } catch {}
      const cv = holder.querySelector('canvas');
      const url = cv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = 'splat.png'; a.click();
    } catch { onStatus?.('captura no disponible en este navegador'); }
  }
  function setFull(on) {
    if (on === host.classList.contains('sv-fullscreen')) return;
    host.classList.toggle('sv-fullscreen', on);
    document.documentElement.classList.toggle('sv-noscroll', on);
    setTimeout(() => { try { viewer.getRenderDimensions(new THREEV.Vector2()); kick(); } catch {} }, 60);
  }
  function toggleFull() {
    if (!host.classList.contains('sv-fullscreen')) {
      setFull(true);
      // estado de historia: en móvil/iPad el botón/gesto Atrás cierra el fullscreen en vez de
      // abandonar la página (antes Atrás salía del visor entero).
      try { history.pushState({ svFull: true }, ''); } catch {}
    } else if (history.state && history.state.svFull) {
      try { history.back(); } catch { setFull(false); }   // consume el estado → dispara onPop → cierra
    } else {
      setFull(false);
    }
  }
  function onPop() { if (host.classList.contains('sv-fullscreen')) setFull(false); }
  window.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  function onKey(e) {
    if (!holder.isConnected) return;
    // escribir "r"/"+"/"-" en un input (renombrar proyecto, búsqueda) NO debe mover el visor
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
    host.removeEventListener('dblclick', onDbl, true);     // el leak #1 del hunt: se acumulaban por carga
    host.removeEventListener('pointerup', onPtrUp, true);
    cancelAnimationFrame(anim);
    host.classList.remove('sv-fullscreen');
    document.documentElement.classList.remove('sv-noscroll');
    if (history.state && history.state.svFull) { try { history.back(); } catch {} }   // consume el estado fantasma
    hud.remove(); tip.remove();
    try { const p = viewer.dispose(); if (p?.catch) p.catch(() => {}); } catch {}
  }
  return { viewer, dispose };
}
