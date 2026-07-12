// volar.js — FLIGHTVERSE /volar: vuelo jugable sobre la escena real (P3).
// Escena unificada (terreno DSM+orto vía flightverse/scene.js) + dron con
// física de timestep fijo (flightverse/runtime.js) + ghost del vuelo REAL
// (track GPS 1Hz interpolado — el dato más honesto del juego: eso voló ahí).
// HUD: arquitectura de 4 esquinas + barra inferior, cero solapamientos.
// ?autotest=1 → 5s de vuelo sintético y reporte en window.__volar (gate CDP).
import * as THREE from '/vendor/three.module.js';
import { loadManifest, loadTerrain, loadTrack } from '/flightverse/scene.js';
import { createLoop, createInput, createDrone, MODES, RIGS, STEP } from '/flightverse/runtime.js';

const Q = new URLSearchParams(location.search);
const CID = (Q.get('m') || '').replace(/[^\w-]/g, '');
const AUTOTEST = Q.get('autotest') === '1';
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
      <div class="vl-scene" id="vl-scene"></div>
    </div>
    <div class="vl-corner tr">
      <div class="vl-metric"><span id="vl-agl">—</span><label>ALT AGL</label></div>
      <div class="vl-metric"><span id="vl-spd">—</span><label>VEL m/s</label></div>
    </div>
    <div class="vl-corner bl">
      <div class="vl-mode" id="vl-mode"></div>
      <div class="vl-rig" id="vl-rig"></div>
    </div>
    <div class="vl-corner br">
      <div class="vl-ghost" id="vl-ghost"></div>
      <div class="vl-fps" id="vl-fps"></div>
    </div>
    <div class="vl-help" id="vl-help">
      <b>Controles</b><br>
      WASD mover · R/F subir/bajar · Q/E girar · mouse mirar (click captura)<br>
      Shift turbo · Space freno · 1-5 modo · C cámara · G ghost · H ayuda
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

  // ── escena three ──
  const renderer = new THREE.WebGLRenderer({ antialias: true });
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

  const terrain = await loadTerrain(man, { anisotropy: 8 });
  scene.add(terrain.mesh);
  const W = terrain.world;

  // dron visible (proxy honesto: cuerpo + 4 rotores, sin assets externos)
  const drone = createDrone({ heightAt: terrain.heightAt, spawn: man.spawn });
  const dmesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6),
    new THREE.MeshLambertMaterial({ color: 0xE6EBF2 }));
  dmesh.add(body);
  const rotG = new THREE.MeshLambertMaterial({ color: 0x45A0E6 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 12), rotG);
    r.position.set(x * 1.05, 0.25, z * 1.05);
    dmesh.add(r);
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
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x52C79A, transparent: true, opacity: 0.55 }));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0x52C79A }));
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
  let modeKey = 'asistido', rigIx = 0;
  const setMode = k => { modeKey = k; $('#vl-mode').textContent = `modo · ${MODES[k].label}`; };
  const setRig = ix => {
    rigIx = ((ix % RIGS.length) + RIGS.length) % RIGS.length;
    camera.fov = RIGS[rigIx].fov; camera.updateProjectionMatrix();
    $('#vl-rig').textContent = `cámara · ${RIGS[rigIx].label}`;
  };
  setMode('asistido'); setRig(0);
  const modeKeys = { Digit1: 'cinematico', Digit2: 'asistido', Digit3: 'fpv', Digit4: 'arcade', Digit5: 'dios' };
  addEventListener('keydown', e => {
    if (modeKeys[e.code]) setMode(modeKeys[e.code]);
    if (e.code === 'KeyC') setRig(rigIx + 1);
    if (e.code === 'KeyG' && ghost) { ghost.on = !ghost.on; ghost.grp.visible = ghost.on; }
    if (e.code === 'KeyH') $('#vl-help').classList.toggle('show');
  });
  renderer.domElement.addEventListener('click', () => { if (modeKey === 'fpv') input.requestLock(); });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // cinemático: tour orbital sobre el centro de la escena
  let tourT = 0;
  const diag = Math.hypot(...W.size_m);

  let simT = 0;
  const auto = AUTOTEST ? { until: 5 } : null;
  const P = new THREE.Vector3();
  const loop = createLoop({
    update(dt) {
      simT += dt;
      let inp = input.sample();
      if (auto && simT < auto.until) inp = { fwd: 1, strafe: 0, yaw: 0.15, lift: 0.1, boost: simT > 2, brake: false, mouseDX: 0, mouseDY: 0 };
      drone.step(dt, inp, modeKey);
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
      dmesh.position.copy(P);
      dmesh.rotation.set(0, o.yaw, 0, 'YXZ');
      dmesh.rotation.x = THREE.MathUtils.clamp(-drone.vel.dot(new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw))) * 0.012, -0.35, 0.35);
      if (modeKey === 'cinematico') {
        tourT += STEP * 0.14;
        camera.position.set(Math.cos(tourT) * diag * 0.42, diag * 0.3, Math.sin(tourT) * diag * 0.42);
        camera.lookAt(0, (W.elev_max - W.elev_min) * 0.4, 0);
      } else {
        const rig = RIGS[rigIx];
        rig.fn(P, o, camera, STEP, rig);
      }
      renderer.render(scene, camera);
      // HUD (barato: texto directo, sin re-layout)
      $('#vl-agl').textContent = drone.agl == null ? 'fuera' : `${drone.agl.toFixed(1)} m`;
      $('#vl-spd').textContent = drone.vel.length().toFixed(1);
      $('#vl-fps').textContent = `${Math.round(loop.fps() || 0)} fps`;
    },
  });
  loop.start();
  report.ready = true;

  if (auto) {
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
