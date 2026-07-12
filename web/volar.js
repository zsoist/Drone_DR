// volar.js — FLIGHTVERSE /volar: vuelo jugable sobre la escena real (P3).
// Escena unificada (terreno DSM+orto vía flightverse/scene.js) + dron con
// física de timestep fijo (flightverse/runtime.js) + ghost del vuelo REAL
// (track GPS 1Hz interpolado — el dato más honesto del juego: eso voló ahí).
// HUD: arquitectura de 4 esquinas + barra inferior, cero solapamientos.
// ?autotest=1 → 5s de vuelo sintético y reporte en window.__volar (gate CDP).
import * as THREE from '/flightverse/three.js?v=60';
import { loadManifest, loadTerrain, loadTrack, attachSplat } from '/flightverse/scene.js?v=60';
import { createLoop, createInput, createDrone, MODES, RIGS, STEP } from '/flightverse/runtime.js?v=60';
import { createGateRush, bestTime } from '/flightverse/gaterush.js?v=60';
import { createRecorder } from '/flightverse/recorder.js?v=60';
import { createAudio } from '/flightverse/audio.js?v=60';
import { createTouchSticks } from '/flightverse/touch.js?v=60';
import {
  EffectComposer, RenderPass, EffectPass,
  SMAAEffect, SMAAPreset, BloomEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
  BrightnessContrastEffect, HueSaturationEffect,
} from '/vendor/postprocessing180.module.js?v=60';
import { computeBoundsTree, disposeBoundsTree } from '/vendor/three-mesh-bvh180.module.js?v=60';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const Q = new URLSearchParams(location.search);
const CID = (Q.get('m') || '').replace(/[^\w-]/g, '');
const AT = Q.get('autotest');
const AUTOTEST = AT === '1' || AT === 'record';   // ambos vuelan input sintético
const report = { ready: false, done: false, errors: [], cid: CID };
window.__volar = report;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const M_LAT = 111320;

function hud() {
  document.body.insertAdjacentHTML('beforeend', `
  <div class="vl-hud" id="vl-hud">
    <div class="vl-corner tl">
      <a class="vl-back" href="mundo.html">← Mundo</a>
      <button class="vl-chip" id="vl-share">Compartir</button>
      <div class="vl-scene" id="vl-scene"></div>
    </div>
    <div class="vl-corner tr">
      <div class="vl-metric"><span id="vl-agl">—</span><label>ALT AGL</label></div>
      <div class="vl-metric"><span id="vl-spd">—</span><label>VEL m/s</label></div>
    </div>
    <div class="vl-corner bl">
      <button class="vl-fab" id="vl-fab">&#9776;</button>
      <div class="vl-dock" id="vl-dock">
        <button class="vl-chip" id="vl-mode"></button>
        <button class="vl-chip" id="vl-rig"></button>
        <button class="vl-chip" id="vl-vista">vista · orto</button>
        <button class="vl-chip" id="vl-reto">Gate Rush</button>
        <button class="vl-chip" id="vl-sound">Sonido</button>
        <button class="vl-chip" id="vl-ajustes">Imagen</button>
        <button class="vl-chip" id="vl-ayuda">Guía</button>
        <button class="vl-rec" id="vl-rec">● Grabar</button>
      </div>
    </div>
    <div class="vl-corner br">
      <div class="vl-ghost" id="vl-ghost"></div>
      <div class="vl-fps" id="vl-fps"></div>
    </div>
    <div class="vl-center-top" id="vl-challenge"></div>
    <div class="vl-compass" id="vl-compass"><span id="vl-heading">N 0°</span></div>
    <div class="vl-scrim top"></div><div class="vl-scrim bottom"></div>
    <canvas class="vl-minimap" id="vl-minimap" width="180" height="180"></canvas>
    <div class="vl-count" id="vl-count"></div>
    <div class="vl-result" id="vl-result"></div>
    <div class="vl-grade" id="vl-grade">
      <div class="vl-grade-k">IMAGEN</div>
      <label>Brillo<input type="range" id="gr-b" min="-0.3" max="0.3" step="0.01" value="0"></label>
      <label>Contraste<input type="range" id="gr-c" min="-0.3" max="0.4" step="0.01" value="0.06"></label>
      <label>Saturación<input type="range" id="gr-s" min="-0.5" max="0.5" step="0.01" value="0.06"></label>
      <label>Bloom<input type="range" id="gr-g" min="0" max="1.2" step="0.02" value="0.32"></label>
      <label>Viñeta<input type="range" id="gr-v" min="0" max="0.9" step="0.02" value="0.42"></label>
      <button id="gr-reset">Restablecer</button>
    </div>
    <div class="vl-guide" id="vl-guide">
      <div class="vl-guide-card">
        <div class="vl-guide-k">GUÍA DE VUELO</div>
        <div class="vl-guide-rows">
          <div><span class="vl-gi">01</span><b>Controles RC reales</b><br>Stick IZQ: subir/bajar y girar · Stick DER: avanzar y ladear.<br>Teclado: WASD mover · R/F altura · Q/E girar · Shift turbo.</div>
          <div><span class="vl-gi">02</span><b>Los aros (Gate Rush)</b><br>Pulsa 🏁 y cruza los aros: el AZUL brillante es el siguiente, verde = superado. Están sobre la ruta que tu dron voló de verdad.</div>
          <div><span class="vl-gi">03</span><b>La bola verde (ghost)</b><br>Es tu vuelo REAL reproduciéndose — la estela es el GPS del dron. Persíguela o apágala con G.</div>
          <div><span class="vl-gi">04</span><b>Vista foto-real</b><br>Cambia entre orto, mixta y el splat foto-realista con el botón "vista".</div>
        </div>
        <button id="vl-guide-ok">¡A volar!</button>
      </div>
    </div>
    <div class="vl-help" id="vl-help">
      <b>Controles</b><br>
      WASD mover · R/F subir/bajar · Q/E girar · mouse mirar (click captura)<br>
      Shift turbo · Space freno · 1-5 modo · C cámara · G ghost · P foto-real · V grabar · H ayuda
    </div>
  </div>`);
}

async function main() {
  if (!CID) { location.replace('mundo.html'); return; }
  document.title = 'AeroBrain — Volar';
  hud();
  const say = m => { $('#vl-scene').textContent = m; };
  say('Cargando escena…');

  const man = await loadManifest(CID);
  if (!man.capabilities?.terrain) throw new Error('escena sin terreno volable');
  $('#vl-scene').textContent = man.name;
  // primera impresión: controles visibles 6s (H los trae de vuelta)
  $('#vl-help').classList.add('show');
  setTimeout(() => $('#vl-help').classList.remove('show'), 6000);

  // ── escena three (flags según README de postprocessing: AA lo hace SMAA,
  // depth/stencil viven en los buffers del composer) ──
  const renderer = new THREE.WebGLRenderer({
    powerPreference: 'high-performance', antialias: false, stencil: false, depth: false,
  });
  renderer.toneMapping = THREE.NoToneMapping;   // el tone mapping va al FINAL del pipeline
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  renderer.domElement.className = 'vl-canvas';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0A0C10);
  scene.fog = new THREE.Fog(0x0A0C10, 500, 1600);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(250, 420, 120);
  scene.add(sun);

  // look premium: un solo EffectPass fusiona SMAA+Bloom+ACES+Vignette en un shader
  // NEUTRAL (no ACES): los colores del splat ya son display-referred — ACES
  // los lavaba; bloom umbral 1.0 para que los blancos del splat no lo disparen
  const fx = {
    bc: new BrightnessContrastEffect({ brightness: 0, contrast: 0.06 }),
    hs: new HueSaturationEffect({ saturation: 0.06 }),
    bloom: new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, intensity: 0.32, radius: 0.6 }),
    vig: new VignetteEffect({ offset: 0.3, darkness: 0.42 }),
  };
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera,
    new SMAAEffect({ preset: SMAAPreset.HIGH }),
    fx.bloom, fx.bc, fx.hs,
    new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    fx.vig,
  ));

  const terrain = await loadTerrain(man, { anisotropy: 8 });
  scene.add(terrain.mesh);
  const W = terrain.world;
  // máscara "best of both worlds": uniforms inyectados al Lambert del terreno;
  // en mixta se descartan los fragmentos dentro del radio del splat
  const mask = { uMaskOn: { value: 0 }, uMaskC: { value: new THREE.Vector2() }, uMaskR: { value: 0 } };
  terrain.mesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mask);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFvW = (modelMatrix * vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;\nuniform float uMaskOn;uniform vec2 uMaskC;uniform float uMaskR;')
      .replace('#include <map_fragment>', 'if (uMaskOn > .5 && distance(vFvW.xz, uMaskC) < uMaskR) discard;\n#include <map_fragment>');
  };
  terrain.mesh.material.needsUpdate = true;

  // splat héroe: solo si splat_align.py lo dejó 'aligned' (RMSE sub-métrico).
  // Carga DESPUÉS del terreno (el juego ya es volable mientras llega el ksplat).
  let splat = null;
  if (man.capabilities?.splat && man.transforms?.splat?.status === 'aligned') {
    attachSplat(man, scene, {
      renderer,
      onProgress: p => { if (p < 100) $('#vl-scene').textContent = `${man.name} · splat ${Math.round(p)}%`; },
    }).then(s => {
      splat = s;
      $('#vl-scene').textContent = `${man.name} · foto-real ±${(s.rmse * 100).toFixed(0)}cm`;
      report.splat = { aligned: s.aligned, rmse_m: s.rmse };
      vista = 1; applyVista();   // default foto-real: el splat es la escena
    }).catch(e => {
      report.errors.push('splat: ' + e.message);
      $('#vl-scene').textContent = man.name;
    });
  }

  // colisión precisa contra EDIFICIOS: proxy voxel del splat (splat-transform)
  // horneado al frame del juego (collision_bake.py) + BVH. Lazy: el vuelo ya
  // funciona con el heightfield mientras llega; queries closestPointToPoint
  // ~17µs — cabe de sobra en el paso de 120Hz.
  let coll = null;
  const collV = new THREE.Vector3();
  if (man.assets?.collision_bin && man.assets?.collision_meta) {
    Promise.all([
      fetch(man.assets.collision_meta, { cache: 'no-store' }).then(r => r.json()),
      fetch(man.assets.collision_bin).then(r => r.arrayBuffer()),
    ]).then(([cm, buf]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, cm.verts * 3), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, cm.bytes_pos, cm.tris * 3), 1));
      g.computeBoundsTree();
      g.computeBoundingBox();
      const bb = g.boundingBox;
      mask.uMaskC.value.set((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2);
      mask.uMaskR.value = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.42;
      applyVista();                       // re-evalúa mixta ahora que hay huella
      coll = g.boundsTree;
      report.collision = { tris: cm.tris };
      $('#vl-ghost').textContent += ' · colisión ✓';
    }).catch(e => report.errors.push('colisión: ' + e.message));
  }
  const collide = (p, r) => {
    if (!coll) return null;
    return coll.closestPointToPoint(collV.copy(p), {}, 0, r);
  };

  // dron rediseñado: proporciones DJI (~0.85m), cuerpo bajo, brazos finos,
  // props que giran con la velocidad, gimbal frontal — solo primitivas three
  const drone = createDrone({ heightAt: terrain.heightAt, collide, spawn: man.spawn });
  const dmesh = new THREE.Group();
  const matHull = new THREE.MeshLambertMaterial({ color: 0xE8EDF4 });
  const matGrey = new THREE.MeshLambertMaterial({ color: 0x8f99a8 });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x23282f });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 28, 20), matHull);
  hull.scale.set(1.15, 0.52, 1.85);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 12), matGrey);
  shell.scale.set(1.05, 0.42, 1.5); shell.position.y = 0.055;
  const gimbal = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), matDark);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), matGrey);
  lens.rotation.x = Math.PI / 2; lens.position.z = -0.05;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10),
    new THREE.MeshBasicMaterial({ color: 0x2f6db8 }));
  glass.position.z = -0.066;
  gimbal.add(gb, lens, glass); gimbal.position.set(0, -0.045, -0.27);
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 })); navL.position.set(-0.3, 0, -0.32);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x34c759 })); navR.position.set(0.3, 0, -0.32);
  const sensorM = new THREE.MeshBasicMaterial({ color: 0x11151c });
  for (const sx of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.016, 10), sensorM);
    eye.position.set(sx, 0.015, -0.293); eye.rotation.x = -0.12;
    dmesh.add(eye);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.02), matDark);
  stripe.position.set(0, -0.02, -0.24);
  dmesh.add(hull, shell, gimbal, navL, navR, stripe);
  const props = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.055), matGrey);
    arm.position.set(x * 0.2, 0.015, z * 0.21);
    arm.rotation.y = Math.atan2(-z, x * 1.4);
    arm.rotation.z = x * -0.08;                       // brazos levemente caídos
    const bellB = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.035, 12), matDark);
    bellB.position.set(x * 0.33, 0.035, z * 0.34);
    const bellT = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), matGrey);
    bellT.position.set(x * 0.33, 0.065, z * 0.34);
    const prop = new THREE.Group();
    for (const a of [0, Math.PI]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.006, 0.024), matDark);
      blade.rotation.y = a; blade.rotation.x = 0.12;   // paso de pala
      blade.position.x = Math.cos(a) * 0.06; blade.position.z = -Math.sin(a) * 0.06;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.007, 0.025),
        new THREE.MeshBasicMaterial({ color: 0xff8c1a }));   // puntas naranjas DJI
      tip.position.copy(blade.position);
      tip.position.x += Math.cos(a) * 0.15; tip.position.z -= Math.sin(a) * 0.15;
      tip.rotation.copy(blade.rotation);
      prop.add(blade, tip);
    }
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20),
      new THREE.MeshBasicMaterial({ color: 0x9fb2c8, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    blur.rotation.x = -Math.PI / 2; blur.position.y = 0.004;
    prop.add(blur);
    prop.position.set(x * 0.33, 0.085, z * 0.34);
    props.push({ g: prop, dir: x * z > 0 ? 1 : -1 });
    dmesh.add(arm, bellB, bellT, prop);
  }
  scene.add(dmesh);

  // ── ghost del vuelo real ──
  let ghost = null;
  const track = await loadTrack(man);
  if (track?.points?.length > 3 && W.center_wgs84) {
    const [clon, clat] = W.center_wgs84;
    const mlon = M_LAT * Math.cos(clat * Math.PI / 180);
    const p0 = track.points[0];
    // frame local: +x=este, +z=sur (lat baja) — misma convención que el terreno
    const g0 = terrain.heightAt((p0.lon - clon) * mlon, (clat - p0.lat) * M_LAT);
    const pts = track.points.map(p => new THREE.Vector3(
      (p.lon - clon) * mlon,
      (g0 ?? 0) + (p.rel_alt || 0),
      (clat - p.lat) * M_LAT,
    ));
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(600, pts.length * 3), 0.22, 6, false),
      new THREE.MeshBasicMaterial({ color: 0x52C79A, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0x7dffc9 }));
    const haloCv = document.createElement('canvas'); haloCv.width = haloCv.height = 64;
    const hc = haloCv.getContext('2d');
    const grd = hc.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(125,255,201,.85)'); grd.addColorStop(1, 'rgba(125,255,201,0)');
    hc.fillStyle = grd; hc.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCv), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(4.5);
    marker.add(halo);
    const grp = new THREE.Group();
    grp.add(line); grp.add(marker); grp.visible = true;
    scene.add(grp);
    // t viene como datetime string ("2026-07-04 16:03:58") en los SRT reales;
    // normalizar a segundos desde el inicio, fallback = índice (muestreo 1Hz)
    const T = track.points.map((p, i) => {
      if (typeof p.t === 'number') return p.t;
      const ms = Date.parse(String(p.t || '').replace(' ', 'T'));
      return Number.isFinite(ms) ? ms / 1000 : i;
    });
    const tBase = T[0] || 0;
    for (let i = 0; i < T.length; i++) T[i] -= tBase;
    const dur = T[T.length - 1] || 1;
    ghost = { grp, marker, pts, T, dur, t: 0, on: true };
    $('#vl-ghost').textContent = `ghost · vuelo real ${Math.round(dur)}s`;
  } else {
    $('#vl-ghost').textContent = 'sin track';
  }

  // ── estado de juego ──
  const input = createInput(renderer.domElement);
  const audio = createAudio();
  const sticks = createTouchSticks($('#vl-hud'));
  let sfx = { idx: 0, phase: '', crash: false, count: 0 };
  let modeKey = 'asistido', rigIx = 0;
  const setMode = k => { modeKey = k; $('#vl-mode').textContent = `modo · ${MODES[k].label}`; };
  const setRig = ix => {
    rigIx = ((ix % RIGS.length) + RIGS.length) % RIGS.length;
    camera.fov = RIGS[rigIx].fov; camera.updateProjectionMatrix();
    $('#vl-rig').textContent = `cámara · ${RIGS[rigIx].label}`;
  };
  // vista: 0 mixta · 1 foto-real (solo splat) · 2 orto (solo terreno)
  let vista = 2;
  const applyVista = () => {
    if (!splat && vista !== 2) { vista = 2; }
    terrain.mesh.visible = vista !== 1;
    mask.uMaskOn.value = (vista === 0 && splat && mask.uMaskR.value > 0) ? 1 : 0;
    if (splat) splat.object.visible = vista !== 2;
    $('#vl-vista').textContent = 'vista · ' + (vista === 0 ? 'mixta' : vista === 1 ? 'foto-real' : 'orto');
  };
  const cycleVista = () => { vista = (vista + 1) % 3; applyVista(); };
  $('#vl-vista').addEventListener('click', cycleVista);
  $('#vl-mode').addEventListener('click', () => {
    const ks = Object.keys(MODES);
    setMode(ks[(ks.indexOf(modeKey) + 1) % ks.length]);
  });
  $('#vl-rig').addEventListener('click', () => setRig(rigIx + 1));
  $('#vl-reto').addEventListener('click', () => startReto());   // arrow: startReto se declara abajo
  $('#vl-ayuda').addEventListener('click', () => $('#vl-guide').classList.add('show'));
  $('#vl-ajustes').addEventListener('click', () => $('#vl-grade').classList.toggle('show'));
  $('#vl-fab').addEventListener('click', () => $('#vl-dock').classList.toggle('open'));
  const GRADE_KEY = 'ab.fv.grade';
  const applyGrade = g => {
    fx.bc.brightness = g.b; fx.bc.contrast = g.c;
    fx.hs.saturation = g.s;
    fx.bloom.intensity = g.g;
    fx.vig.darkness = g.v;
    for (const [id, k] of [['gr-b','b'],['gr-c','c'],['gr-s','s'],['gr-g','g'],['gr-v','v']]) $('#'+id).value = g[k];
  };
  const defGrade = { b: 0, c: 0.06, s: 0.06, g: 0.32, v: 0.42 };
  let grade = { ...defGrade, ...(JSON.parse(localStorage.getItem(GRADE_KEY) || '{}')) };
  applyGrade(grade);
  document.getElementById('vl-grade').addEventListener('input', e => {
    const map = { 'gr-b':'b','gr-c':'c','gr-s':'s','gr-g':'g','gr-v':'v' };
    const k = map[e.target.id]; if (!k) return;
    grade[k] = parseFloat(e.target.value);
    applyGrade(grade);
    localStorage.setItem(GRADE_KEY, JSON.stringify(grade));
  });
  $('#gr-reset').addEventListener('click', () => { grade = { ...defGrade }; applyGrade(grade); localStorage.removeItem(GRADE_KEY); });
  $('#vl-guide-ok').addEventListener('click', () => {
    $('#vl-guide').classList.remove('show');
    localStorage.setItem('ab.fv.guided', '1');
  });
  if (!localStorage.getItem('ab.fv.guided') && !AT) $('#vl-guide').classList.add('show');
  $('#vl-sound').addEventListener('click', () => {
    const m = audio.toggleMute();
    $('#vl-sound').textContent = m ? 'Sonido off' : 'Sonido';
    $('#vl-sound').classList.toggle('off', m);
  });
  $('#vl-share').addEventListener('click', async () => {
    const url = `${location.origin}/volar.html?m=${encodeURIComponent(CID)}`;
    try {
      if (navigator.share) await navigator.share({ title: `Vuela ${man.name} — AeroBrain`, url });
      else { await navigator.clipboard.writeText(url); $('#vl-share').textContent = 'Copiado'; setTimeout(() => { $('#vl-share').textContent = 'Compartir'; }, 1600); }
    } catch { /* usuario canceló */ }
  });
  const qModo = Q.get('modo');
  setMode(qModo && MODES[qModo] ? qModo : 'asistido'); setRig(0); applyVista();
  if (Q.get('reto') === '1' && !AT) setTimeout(() => startReto(), 3800);   // tras el arrival
  const modeKeys = { Digit1: 'cinematico', Digit2: 'asistido', Digit3: 'fpv', Digit4: 'arcade', Digit5: 'dios' };
  addEventListener('keydown', e => {
    if (modeKeys[e.code]) setMode(modeKeys[e.code]);
    if (e.code === 'KeyC') setRig(rigIx + 1);
    if (e.code === 'KeyG' && ghost) { ghost.on = !ghost.on; ghost.grp.visible = ghost.on; }
    if (e.code === 'KeyH') $('#vl-help').classList.toggle('show');
    if (e.code === 'KeyT') startReto();
    if (e.code === 'KeyP') cycleVista();
    if (e.code === 'KeyM') $('#vl-mode').style.opacity = audio.toggleMute() ? 0.4 : 1;
    if (e.code === 'Escape' && replay) { replay = null; if (resultShown) $('#vl-result').classList.add('show'); }
  });
  renderer.domElement.addEventListener('click', () => { if (modeKey === 'fpv') input.requestLock(); });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  // ── Gate Rush (desafío del slice) + replay ──
  let reto = null, replay = null, resultShown = false;
  const startReto = () => {
    $('#vl-result').classList.remove('show'); $('#vl-result').innerHTML = '';
    replay = null; resultShown = false;
    if (reto) reto.dispose();
    reto = createGateRush({ scene, trackPts: ghost?.pts, world: W, heightAt: terrain.heightAt });
    reto.start();
  };
  const startReplay = () => {
    if (!reto?.state.rec.length) return;
    $('#vl-result').classList.remove('show');
    replay = { rec: reto.state.rec, f: 0 };
  };
  const showResult = () => {
    resultShown = true;
    const t = reto.state.time;
    const { best, isNew } = bestTime(CID, t);
    $('#vl-result').innerHTML = `
      <div class="vl-result-card">
        <div class="vl-result-k">GATE RUSH · COMPLETADO</div>
        <div class="vl-result-time">${t.toFixed(2)}<small>s</small></div>
        <div class="vl-result-rows">
          <span>${isNew ? 'nuevo récord' : `récord ${best?.toFixed(2)}s`}</span>
          <span>vel. máx ${reto.state.topSpeed.toFixed(1)} m/s</span>
          <span>${reto.state.total} gates</span>
        </div>
        <div class="vl-result-btns">
          <button data-act="retry">Reintentar</button>
          <button data-act="replay">Ver replay</button>
          <a href="mundo.html">Mundo</a>
        </div>
      </div>`;
    $('#vl-result').classList.add('show');
  };
  $('#vl-result').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'retry') startReto();
    if (act === 'replay') startReplay();
  });

  // cinemático: tour orbital sobre el centro de la escena
  let tourT = 0;
  const diag = Math.hypot(...W.size_m);

  // ── minimapa táctico: la ortofoto REAL como radar (dron/ghost/gates) ──
  const mm = { cv: $('#vl-minimap'), img: null, ready: false };
  if (man.assets?.ortho) {
    const im = new Image();
    im.onload = () => { mm.img = im; mm.ready = true; };
    im.src = man.assets.ortho;
  }
  const mmXY = (x, z) => [
    (x / W.size_m[0] + 0.5) * mm.cv.width,
    (z / W.size_m[1] + 0.5) * mm.cv.height,
  ];
  function drawMinimap() {
    if (!mm.ready) return;
    const c = mm.cv.getContext('2d');
    c.clearRect(0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 0.92;
    c.drawImage(mm.img, 0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 1;
    if (reto?.gates) for (let i = 0; i < reto.gates.length; i++) {
      const g = reto.gates[i];
      const [gx, gz] = mmXY(g.center.x, g.center.z);
      c.beginPath(); c.arc(gx, gz, 3, 0, 7);
      c.strokeStyle = g.passed ? '#52C79A' : (i === reto.state.idx ? '#45A0E6' : '#566274');
      c.lineWidth = 1.6; c.stroke();
    }
    if (ghost?.on) {
      const [gx, gz] = mmXY(ghost.marker.position.x, ghost.marker.position.z);
      c.fillStyle = '#52C79A'; c.beginPath(); c.arc(gx, gz, 2.4, 0, 7); c.fill();
    }
    const [dx, dz] = mmXY(drone.pos.x, drone.pos.z);
    c.save(); c.translate(dx, dz); c.rotate(-drone.yaw);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }

  // llegada cinematográfica: swoop desde vista de mapa hacia el rig (skip en autotest)
  let arrival = AT ? null : { t: 0, dur: 3.4 };

  let simT = 0;
  const auto = AUTOTEST ? { until: 5 } : null;
  const autoReto = AT === 'gaterush' ? { last: 0, replayed: false } : null;

  // ── Quick Record (WebM del canvas — camino instantáneo del Video Studio) ──
  const recorder = createRecorder(renderer.domElement);
  const recBtn = $('#vl-rec');
  const toggleRec = async () => {
    if (!recorder.supported) { recBtn.textContent = 'grabación no soportada'; return; }
    if (recorder.recording) {
      const blob = await recorder.stop();
      recBtn.classList.remove('on'); recBtn.textContent = '● Grabar';
      if (blob) recorder.download(blob, `volar_${CID}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
    } else if (recorder.start()) { recBtn.classList.add('on'); audio.rec(true); }
  };
  recBtn.addEventListener('click', toggleRec);
  addEventListener('keydown', e => { if (e.code === 'KeyV') toggleRec(); });
  if (AT === 'record') {
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
  }
  const P = new THREE.Vector3();
  const loop = createLoop({
    update(dt) {
      simT += dt;
      if (replay) {
        // replay: la grabación (60Hz) manda; física apagada, interpolación intacta
        replay.f += dt * 60;
        const n = replay.rec.length;
        if (replay.f >= n - 1) replay.f = 0;
        const i = Math.floor(replay.f), f = replay.f - i;
        const a = replay.rec[i], b = replay.rec[Math.min(i + 1, n - 1)];
        drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
        drone.pos.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
        drone.yaw = a[3] + (b[3] - a[3]) * f;
      } else {
        let inp = input.sample();
        const ts = sticks?.sample();
        if (ts?.active) { inp.fwd = ts.fwd; inp.strafe = ts.strafe; inp.yaw = ts.yaw; inp.lift = ts.lift; }
        if (auto && simT < auto.until) inp = { fwd: 1, strafe: 0, yaw: 0.15, lift: 0.1, boost: simT > 2, brake: false, mouseDX: 0, mouseDY: 0 };
        drone.step(dt, inp, modeKey);
        if (autoReto) {
          // autotest del slice: teleporta por los gates — prueba detección,
          // resultado y replay reales sin fingir sus verificaciones
          if (!reto && simT > 0.5) startReto();
          else if (reto?.state.phase === 'running' && simT - autoReto.last > 0.4) {
            autoReto.last = simT;
            const g = reto.gates[reto.state.idx];
            if (g) { drone.pos.copy(g.center); drone.prev.pos.copy(g.center); }
          } else if (reto?.state.phase === 'finished' && !autoReto.replayed) {
            autoReto.replayed = true;
            startReplay();
            setTimeout(() => {
              report.reto = { time: reto.state.time, gates: reto.state.total, recFrames: reto.state.rec.length };
              report.replayActive = !!replay;
              report.ok = reto.state.total >= 4 && reto.state.time != null
                && reto.state.rec.length > 30 && !!replay;
              report.done = true;
            }, 1200);
          }
        }
        if (reto) {
          reto.update(dt, drone.pos, drone.vel, drone.yaw);
          const st = reto.state;
          if (st.idx > sfx.idx) audio.gate();
          if (st.phase === 'countdown') { const c = Math.ceil(st.countdown); if (c !== sfx.count) audio.tick(); sfx.count = c; }
          if (st.phase === 'running' && sfx.phase === 'countdown') audio.go();
          if (st.phase === 'finished' && sfx.phase !== 'finished') audio.finish();
          sfx.idx = st.idx; sfx.phase = st.phase;
          if (st.phase === 'finished' && !resultShown) showResult();
        }
        if (drone.crashedSoft && !sfx.crash) audio.crash();
        sfx.crash = drone.crashedSoft;
      }
      if (ghost?.on) {
        ghost.t = (ghost.t + dt) % ghost.dur;
        const i = ghost.T.findIndex(t => t > ghost.t);
        const a = Math.max(0, i - 1), b = Math.max(0, i);
        const ta = ghost.T[a], tb = ghost.T[b] || ta + 1;
        const f = tb > ta ? (ghost.t - ta) / (tb - ta) : 0;
        ghost.marker.position.lerpVectors(ghost.pts[a], ghost.pts[b] || ghost.pts[a], f);
      }
    },
    render(alpha) {
      const o = drone.lerpPose(alpha, P);
      if (ghost?.on) ghost.marker.children[0].scale.setScalar(4 + Math.sin(simT * 3.2) * 0.8);
      const spin = (14 + drone.vel.length() * 3) * STEP;
      for (const pr of props) pr.g.rotation.y += spin * pr.dir;
      dmesh.position.copy(P);
      dmesh.rotation.set(0, o.yaw, 0, 'YXZ');
      dmesh.rotation.x = THREE.MathUtils.clamp(-drone.vel.dot(new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw))) * 0.012, -0.35, 0.35);
      if (arrival) {
        // swoop de entrada: de vista-mapa al rig chase, easeOutCubic
        arrival.t += STEP;
        const k = Math.min(1, arrival.t / arrival.dur);
        const e = 1 - Math.pow(1 - k, 3);
        const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(14);
        const want = P.clone().add(back).add(new THREE.Vector3(0, 6, 0));
        const hi = P.clone().add(new THREE.Vector3(diag * 0.25, diag * 0.55, diag * 0.35));
        camera.position.lerpVectors(hi, want, e);
        camera.lookAt(P);
        if (k >= 1) arrival = null;
      } else if (modeKey === 'cinematico') {
        tourT += STEP * 0.14;
        camera.position.set(Math.cos(tourT) * diag * 0.42, diag * 0.3, Math.sin(tourT) * diag * 0.42);
        camera.lookAt(0, (W.elev_max - W.elev_min) * 0.4, 0);
      } else {
        const rig = RIGS[rigIx];
        rig.fn(P, o, camera, STEP, rig);
      }
      composer.render();
      drawMinimap();
      // HUD (barato: texto directo, sin re-layout)
      $('#vl-agl').textContent = drone.agl == null ? 'fuera' : `${drone.agl.toFixed(1)} m`;
      $('#vl-spd').textContent = drone.vel.length().toFixed(1);
      $('#vl-fps').textContent = `${Math.round(loop.fps() || 0)} fps`;
      if (recorder.recording) recBtn.textContent = `■ REC ${recorder.seconds.toFixed(0)}s`;
      audio.update(drone.vel.length(), drone.vel.y);
      const hdg = ((-o.yaw * 180 / Math.PI) % 360 + 360) % 360;
      const card = ['N','NE','E','SE','S','SO','O','NO'][Math.round(hdg / 45) % 8];
      $('#vl-heading').textContent = `${card} ${Math.round(hdg)}°`;
      const ch = $('#vl-challenge'), cnt = $('#vl-count');
      if (replay) {
        ch.textContent = 'REPLAY · ESC para salir'; cnt.classList.remove('show');
      } else if (reto) {
        const st = reto.state;
        if (st.phase === 'countdown') {
          cnt.textContent = String(Math.ceil(st.countdown)); cnt.classList.add('show');
          ch.textContent = 'GATE RUSH';
        } else cnt.classList.remove('show');
        if (st.phase === 'running') ch.textContent = `T ${st.t.toFixed(1)}s · gate ${Math.min(st.idx + 1, st.total)}/${st.total}`;
        if (st.phase === 'finished') ch.textContent = `GATE RUSH · ${st.time.toFixed(2)}s`;
      } else {
        ch.textContent = 'T · iniciar Gate Rush'; cnt.classList.remove('show');
      }
    },
  });
  // governor de perf: ajusta pixelRatio según fps medidos (fill-rate del splat)
  let dprNow = Math.min(devicePixelRatio, 2);
  setInterval(() => {
    const f = loop.fps() || 60;
    const maxDpr = Math.min(devicePixelRatio, 2);
    let want = dprNow;
    if (f < 52) want = Math.max(1, dprNow - 0.25);
    else if (f > 58 && dprNow < maxDpr) want = Math.min(maxDpr, dprNow + 0.25);
    if (want !== dprNow) {
      dprNow = want;
      renderer.setPixelRatio(dprNow);
      renderer.setSize(innerWidth, innerHeight);
      composer.setSize(innerWidth, innerHeight);
    }
  }, 2000);

  loop.start();
  report.ready = true;

  if (auto && AT === '1') {
    setTimeout(() => {
      report.fps = Math.round(loop.fps() || 0);
      report.pos = { x: +drone.pos.x.toFixed(1), y: +drone.pos.y.toFixed(1), z: +drone.pos.z.toFixed(1) };
      report.agl = drone.agl == null ? null : +drone.agl.toFixed(1);
      report.distance = Math.round(drone.distance);
      report.ghost = !!ghost;
      report.moved = drone.distance > 20;
      report.ok = report.moved && report.fps >= 20 && Number.isFinite(drone.pos.y);
      report.done = true;
    }, (auto.until + 1.5) * 1000);
  }
}

main().catch(e => {
  report.errors.push(String(e?.message || e));
  report.done = true;
  document.body.insertAdjacentHTML('beforeend',
    `<div class="vl-err">No se pudo iniciar el vuelo: ${esc(e.message)} · <a href="mundo.html">volver al Mundo</a></div>`);
});
