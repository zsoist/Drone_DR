// splatview.js — visor PREMIUM de gaussian splats, compartido por tresd.js y share.js.
// Feature clave: doble-click raycastea contra el splat y mueve el target de la órbita a ESE
// punto — así te acercas a cualquier edificio (antes el target era el centroide = siempre
// zoomeabas al medio). Más: reset, auto-rotar, FOV, brillo, tamaño, screenshot, pantalla
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
};
const btn = (id, label, path) =>
  `<button data-sv="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24">${path}</svg></button>`;

export async function mountSplatViewer(host, splatUrl, { bytes = 0, onStatus } = {}) {
  const GS = await import('/vendor/gaussian-splats-3d.module.min.js');
  host.style.position = 'relative';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;inset:0';
  host.appendChild(holder);

  const viewer = new GS.Viewer({
    rootElement: holder, sharedMemoryForWorkers: false, antialiased: true,
    halfPrecisionCovariancesOnGPU: true, showLoadingUI: false,
    sceneRevealMode: GS.SceneRevealMode.Instant,
    splatRenderMode: GS.SplatRenderMode.ThreeD,
    cameraUp: [0, 1, 0], initialCameraPosition: [0, 5, 4], initialCameraLookAt: [0, 0, 0],
  });

  const tmoMs = Math.min(120000, 45000 + Math.round((bytes || 0) / 1048576) * 3000);
  await Promise.race([
    viewer.addSplatScene(splatUrl, {
      progressiveLoad: false, showLoadingUI: false, splatAlphaRemovalThreshold: 60,
      rotation: SPLAT_ROT, onProgress: p => onStatus?.(`Splat · ${Math.round(p)}%`),
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout de ${Math.round(tmoMs / 1000)}s procesando el splat`)), tmoMs)),
  ]);

  const THREEV = THREE;
  const mesh = viewer.splatMesh;
  const center = (mesh?.calculatedSceneCenter && mesh.calculatedSceneCenter.clone()) || new THREEV.Vector3();
  const radius = Math.max(mesh?.maxSplatDistanceFromSceneCenter || mesh?.visibleRegionRadius || 1, 0.5);
  const cam = viewer.camera, ctrl = viewer.controls;
  const homeState = {};

  function frame() {
    const dir = new THREEV.Vector3(0.2, 0.72, 0.66).normalize();
    cam.position.copy(center).addScaledVector(dir, radius * 1.7);
    cam.near = Math.max(radius / 2000, 0.003);          // near diminuto = acercarse sin clip
    cam.far = Math.max(radius * 100, 50);
    cam.updateProjectionMatrix();
    ctrl.target.copy(center);
    ctrl.minDistance = radius * 0.2;                    // afuera del volumen (el focus lo baja)
    ctrl.maxDistance = radius * 20;
    ctrl.update();
    homeState.pos = cam.position.clone();
    homeState.target = center.clone();
    homeState.fov = cam.fov;
  }
  frame();
  viewer.start();

  // navegación premium
  ctrl.enableDamping = true; ctrl.dampingFactor = 0.06;
  ctrl.rotateSpeed = 0.6; ctrl.zoomSpeed = 1.0; ctrl.panSpeed = 0.85;
  ctrl.maxPolarAngle = Math.PI * 0.495;
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
      if (k < 1) anim = requestAnimationFrame(step);
      else if (toMin != null) vctrl.minDistance = toMin;
    })();
  }
  const groundPlane = new THREEV.Plane(new THREEV.Vector3(0, 1, 0), -center.y);
  const groundRay = new THREEV.Raycaster();
  function focusAt(clientX, clientY) {
    const rect = holder.getBoundingClientRect();
    const vcam = viewer.camera;                         // FRESCO: el viewer intercambia su cámara tras montar
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
    viewer.controls.minDistance = Math.max(radius * 0.003, 0.02);
    // acércate al punto: nueva posición a ~min(dist actual, radius*0.3) del edificio
    const d = vcam.position.distanceTo(p);
    const newPos = p.clone().addScaledVector(vcam.position.clone().sub(p).normalize(), Math.min(d, radius * 0.3));
    animateTo(p, newPos);
    return true;
  }
  // el canvas del viewer captura los pointer events de sus controles; escuchamos en el HOST
  // en fase de captura (baja top-down antes que nada) para no depender del bubbling
  host.addEventListener('dblclick', e => {
    if (!holder.contains(e.target) && e.target !== holder) return;   // solo dentro del visor
    e.preventDefault(); e.stopPropagation();
    focusAt(e.clientX, e.clientY);
  }, true);

  // ---- HUD premium ----
  const hud = document.createElement('div');
  hud.className = 'sv-hud';
  hud.innerHTML =
    btn('home', 'Reiniciar vista (R)', I.home) +
    btn('rot', 'Auto-rotar', I.rot) +
    `<span class="sv-sep"></span>` +
    `<label class="sv-slider" title="Campo de visión">${svg(I.fov)}<input type="range" data-sv="fov" min="30" max="80" value="${Math.round(cam.fov)}"></label>` +
    `<label class="sv-slider" title="Brillo">${svg(I.eye)}<input type="range" data-sv="exp" min="60" max="180" value="100"></label>` +
    `<label class="sv-slider" title="Tamaño de splat">${svg(I.size)}<input type="range" data-sv="scale" min="60" max="160" value="100"></label>` +
    `<span class="sv-sep"></span>` +
    btn('shot', 'Captura PNG', I.cam) +
    btn('full', 'Pantalla completa (F)', I.full);
  host.appendChild(hud);
  const tip = document.createElement('div');
  tip.className = 'sv-tip';
  tip.textContent = 'Doble-click en un edificio para acercarte · arrastra = orbitar · rueda = zoom · click-derecho = mover';
  host.appendChild(tip);
  setTimeout(() => tip.classList.add('fade'), 4200);

  function svg(p) { return `<svg viewBox="0 0 24 24">${p}</svg>`; }

  // brillo/exposición del render (si el renderer lo soporta)
  const setExposure = v => { try { if (viewer.renderer) { viewer.renderer.toneMappingExposure = v; } } catch {} };
  // tamaño de splat (uniform del mesh, si existe)
  const setScale = v => { try { if (mesh && 'splatScale' in mesh) mesh.splatScale = v; } catch {} };

  hud.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]'); if (!b) return;
    const k = b.dataset.sv;
    if (k === 'home') { ctrl.minDistance = radius * 0.2; animateTo(homeState.target, homeState.pos, radius * 0.2); cam.fov = homeState.fov; cam.updateProjectionMatrix(); }
    else if (k === 'rot') { ctrl.autoRotate = !ctrl.autoRotate; ctrl.autoRotateSpeed = 0.9; b.classList.toggle('on', ctrl.autoRotate); }
    else if (k === 'shot') screenshot();
    else if (k === 'full') toggleFull();
  });
  hud.addEventListener('input', e => {
    const k = e.target.dataset.sv, v = +e.target.value;
    if (k === 'fov') { cam.fov = v; cam.updateProjectionMatrix(); }
    else if (k === 'exp') setExposure(v / 100);
    else if (k === 'scale') setScale(v / 100);
  });

  function screenshot() {
    try {
      const cv = holder.querySelector('canvas');
      const url = cv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = 'splat.png'; a.click();
    } catch { onStatus?.('captura no disponible en este navegador'); }
  }
  function toggleFull() {
    host.classList.toggle('sv-fullscreen');
    document.documentElement.classList.toggle('sv-noscroll', host.classList.contains('sv-fullscreen'));
    setTimeout(() => { try { viewer.renderer && viewer.getRenderDimensions(new THREEV.Vector2()); } catch {} }, 60);
  }
  window.addEventListener('keydown', onKey);
  function onKey(e) {
    if (!holder.isConnected) return;
    if (e.key === 'r' || e.key === 'R') hud.querySelector('[data-sv="home"]').click();
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'Escape' && host.classList.contains('sv-fullscreen')) toggleFull();
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(anim);
    host.classList.remove('sv-fullscreen');
    document.documentElement.classList.remove('sv-noscroll');
    hud.remove(); tip.remove();
    try { const p = viewer.dispose(); if (p?.catch) p.catch(() => {}); } catch {}
  }
  return { viewer, dispose };
}
