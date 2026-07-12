// spike_flightverse.js — SPIKE del gate de renderer (P1, docs/FLIGHTVERSE_RENDERER_DECISION.md).
// Prueba las 5 preguntas que deciden el motor, en una ESCENA UNIFICADA (un solo
// WebGLRenderer, un solo scene graph):
//   1. terreno desde dsm_lod (heightfield real, metros) + textura orto
//   2. splat .ksplat vía GS.DropInViewer conviviendo en la misma escena
//   3. query de posición (altura AGL por muestreo bilineal del heightfield)
//   4. captura de frame limpio (render síncrono + toDataURL, sin preserveDrawingBuffer)
//   5. ciclo enter/exit sin fuga (2 ciclos completos: contextos y canvases a cero)
// NO intenta alinear los frames splat↔terreno (eso es geometría de P2, no riesgo
// de motor). Reporte en window.__spike para el gate CDP.
import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';

const SPLAT_ROT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];   // mismo quat que splatview.js
const CID = (new URLSearchParams(location.search).get('m') || 'DJI_20260704160358_0104_D')
  .replace(/[^\w-]/g, '');
const hud = document.getElementById('hud');
const stage = document.getElementById('stage');
const report = { ok: false, done: false, cid: CID, stages: {}, cycles: [], errors: [] };
window.__spike = report;
const say = (m) => { hud.textContent = m; };
const now = () => performance.now();

function heightSampler(hf, grid, spacing, elevMin) {
  const [rows, cols] = grid;
  const [sx, sz] = spacing;
  const W = sx * (cols - 1), H = sz * (rows - 1);
  // frame local: origen = centro del terreno, +x este, +z sur, fila 0 = norte (z=-H/2)
  return (x, z) => {
    const fx = (x + W / 2) / sx, fz = (z + H / 2) / sz;
    if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return null;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, cols - 1), z1 = Math.min(z0 + 1, rows - 1);
    const tx = fx - x0, tz = fz - z0;
    const h00 = hf[z0 * cols + x0], h10 = hf[z0 * cols + x1];
    const h01 = hf[z1 * cols + x0], h11 = hf[z1 * cols + x1];
    const north = h00 * (1 - tx) + h10 * tx;
    const south = h01 * (1 - tx) + h11 * tx;
    return north * (1 - tz) + south * tz - elevMin;
  };
}

function buildTerrain(hf, lod) {
  const [rows, cols] = lod.grid;
  const [Wm, Hm] = lod.size_m;
  const geo = new THREE.PlaneGeometry(Wm, Hm, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);                       // XZ plano, +y arriba; fila 0 → -z (norte)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hf[i] - lod.elev_min);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

async function buildScene(GS, assets) {
  const t0 = now();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0A0C10);
  const camera = new THREE.PerspectiveCamera(55, stage.clientWidth / stage.clientHeight, 0.5, 6000);
  const diag = Math.hypot(...assets.lod.size_m);
  camera.position.set(diag * 0.35, diag * 0.4, diag * 0.45);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(200, 400, 100);
  scene.add(sun);

  const terrain = new THREE.Mesh(
    buildTerrain(assets.hf, assets.lod),
    new THREE.MeshLambertMaterial({ map: assets.tex }));
  scene.add(terrain);

  // splat en la MISMA escena: escalado junto al terreno (alineación real = P2)
  const dv = new GS.DropInViewer({
    sharedMemoryForWorkers: false, antialiased: true,
    halfPrecisionCovariancesOnGPU: true, showLoadingUI: false,
  });
  await dv.addSplatScene(`data/splats/${CID}.ksplat`, {
    rotation: SPLAT_ROT, splatAlphaRemovalThreshold: 8, showLoadingUI: false, progressiveLoad: false,
  });
  const sm = dv.splatMesh || dv.viewer?.splatMesh;
  const rad = sm?.maxSplatDistanceFromSceneCenter;
  const scale = Number.isFinite(rad) && rad > 0 ? (diag * 0.18) / rad : 30;
  dv.scale.setScalar(scale);
  dv.position.set(0, 45, 0);
  scene.add(dv);

  let frames = 0, firstFrameMs = 0, raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
    if (++frames === 1) firstFrameMs = now() - t0;
  };
  loop();
  await new Promise(r => setTimeout(r, 600));       // deja estabilizar el sort worker

  return {
    renderer, scene, camera, dv, terrain,
    stats: () => ({
      firstFrameMs: Math.round(firstFrameMs), frames,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    }),
    capture: () => {
      renderer.render(scene, camera);               // sin preserveDrawingBuffer: render síncrono
      return renderer.domElement.toDataURL('image/png').length;
    },
    dispose: async () => {
      cancelAnimationFrame(raf);
      try { const p = dv.dispose?.(); if (p?.then) await p; } catch (e) { report.errors.push('dv.dispose: ' + e.message); }
      terrain.geometry.dispose();
      terrain.material.map?.dispose();
      terrain.material.dispose();
      controls.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

async function main() {
  const t0 = now();
  say('cargando datos…');
  const [lod, binRes, GS] = await Promise.all([
    fetch(`data/models/${CID}/dsm_lod.json`).then(r => { if (!r.ok) throw new Error('dsm_lod.json ' + r.status); return r.json(); }),
    fetch(`data/models/${CID}/`.concat('dsm_lod256.bin')).then(r => { if (!r.ok) throw new Error('lod bin ' + r.status); return r.arrayBuffer(); }),
    import('/vendor/gaussian-splats-3d.module.min.js'),
  ]);
  const hf = new Float32Array(binRes);
  const tex = await new THREE.TextureLoader().loadAsync(`data/models/${CID}/ortho.webp`);
  tex.colorSpace = THREE.SRGBColorSpace;
  report.stages.datos_ms = Math.round(now() - t0);

  // ciclo 1: construir, medir, capturar, destruir · ciclo 2: reconstruir (sin fuga)
  const assets = { lod, hf, tex };
  for (let cycle = 1; cycle <= 2; cycle++) {
    say(`ciclo ${cycle}: construyendo escena unificada…`);
    const s = await buildScene(GS, assets);
    const sampleAt = heightSampler(hf, lod.grid, lod.spacing_m, lod.elev_min);
    const q = { x: 0, z: 0, y: sampleAt(0, 0) };
    const stats = s.stats();
    const captureBytes = cycle === 1 ? s.capture() : 0;
    if (cycle === 2) { say('ciclo 2 renderizando — inspección'); window.__spikeScene = s; }
    const keep = cycle === 2;
    if (!keep) await s.dispose();
    report.cycles.push({
      cycle, ...stats, captureBytes,
      heightQuery: q,
      canvases: document.querySelectorAll('canvas').length,
      contextsAlive: keep ? 1 : 0,
    });
  }

  const c1 = report.cycles[0], c2 = report.cycles[1];
  report.ok = !!(c1 && c2
    && c1.triangles > 50000 && c2.triangles > 50000   // terreno (117k tris) + splat presentes
    && c1.captureBytes > 100000                        // captura no-negra/no-vacía
    && Number.isFinite(c1.heightQuery.y)
    && c1.canvases === 0);                             // ciclo 1 limpió TODO
  report.done = true;
  say(`SPIKE ${report.ok ? 'OK' : 'FALLÓ'}\n` + JSON.stringify(report, null, 1).slice(0, 1200));
}

main().catch(e => {
  report.errors.push(String(e?.message || e));
  report.done = true;
  say('SPIKE ERROR: ' + report.errors.join(' | '));
});
