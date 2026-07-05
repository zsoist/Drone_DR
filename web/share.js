// AeroBrain — visor público de un modelo 3D (link compartible, sin sesión).
// /share.html?m=<clip_id> — nube de puntos + splat + descargas.
import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';
import { PLYLoader } from '/vendor/three-addons/loaders/PLYLoader.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cid = (new URLSearchParams(location.search).get('m') || '').replace(/[^\w-]/g, '');
document.body.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 16px 60px">
  <div class="page-head" style="align-items:center">
    <span style="width:30px;height:30px;border-radius:8px;background:var(--accent-dim);display:grid;place-items:center;color:var(--accent);font-weight:700;font-size:13px">A</span>
    <h1 id="sh-title">Modelo 3D</h1>
    <span class="count">AeroBrain · fotogrametría de dron</span>
  </div>
  <div id="sh-body"><p class="footer-note">Cargando…</p></div>
</div>`;
const body = document.getElementById('sh-body');

async function jfetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

let meta = null, sys = {};
try {
  meta = await jfetch(`data/models/${cid}/meta.json`);
  sys = await jfetch('data/manifest/system.json').catch(() => ({}));
} catch {
  body.innerHTML = '<div class="empty">Este modelo no existe o el link ya no está activo.</div>';
  throw new Error('modelo no encontrado');
}

document.getElementById('sh-title').textContent = meta.title || `Vuelo ${cid.slice(-6)}`;
document.title = `AeroBrain — ${meta.title || cid}`;
const q = meta.qa || {};
const base = `data/models/${cid}`;
const splat = (sys.splats || []).find(s => s.name === `${cid}.splat`);
const ha = q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(2) + ' ha' : Math.round(q.area_m2 || 0) + ' m²';

body.innerHTML = `
  <div class="tool-row" style="margin-bottom:14px">
    ${q.gsd_cm_px ? `<span class="chip on">${q.gsd_cm_px} cm/px</span>` : ''}
    ${q.area_m2 ? `<span class="chip on">${ha}</span>` : ''}
    ${q.cameras_reconstructed ? `<span class="chip">${q.cameras_reconstructed} cámaras</span>` : ''}
    ${meta.has_dsm ? `<span class="chip">Elevación DSM</span>` : ''}
  </div>
  <div class="panel">
    <div class="ph">Nube de puntos 3D — arrastra para orbitar, pellizca para zoom</div>
    <div id="sh-cloud" style="height:64dvh;min-height:380px;display:grid;place-items:center;position:relative;background:radial-gradient(ellipse at 50% 40%, #131a24 0%, #0a0e14 70%)">
      <p class="footer-note" id="sh-st" style="margin:0">Descargando nube…</p>
    </div>
  </div>
  <div class="panel" style="margin-top:14px">
    <div class="ph">Vistas & descargas</div>
    <div class="pb">
      <div class="navrow" style="flex-wrap:wrap">
        <a class="btn" href="${base}/ortho_full.jpg" target="_blank" rel="noopener">Ortofoto 5K</a>
        <a class="btn" href="${base}/cloud.ply" download>Nube .ply</a>
        ${splat ? `<a class="btn" href="data/splats/${encodeURIComponent(splat.name)}" download>Gaussian splat</a>` : ''}
      </div>
      <p class="footer-note" style="margin:8px 0 0">Procesado localmente con AeroBrain — fotogrametría ODM sobre video de dron DJI.</p>
    </div>
  </div>`;

// visor de nube — auto-carga con vista cenital
const box = document.getElementById('sh-cloud');
const st = document.getElementById('sh-st');
try {
  const geo = await new PLYLoader().loadAsync(`${base}/cloud.ply`,
    ev => { st.textContent = ev.total ? `Nube · ${Math.round(ev.loaded / ev.total * 100)}%`
                                      : `Nube · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(box.clientWidth, box.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.innerHTML = '';
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, box.clientWidth / box.clientHeight, 0.1, 5000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  const mat = new THREE.PointsMaterial({ size: 0.18, sizeAttenuation: true, vertexColors: geo.hasAttribute('color') });
  const pts = new THREE.Points(geo, mat);
  pts.rotation.x = -Math.PI / 2;
  scene.add(pts);
  const bb = new THREE.Box3().setFromObject(pts);
  const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  pts.position.sub(c);
  const dist = Math.max(sz.x, sz.y, sz.z) * 0.9;
  cam.position.set(dist * 0.15, dist * 0.92, dist * 0.28);
  cam.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  new ResizeObserver(() => {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H);
    cam.aspect = W / H; cam.updateProjectionMatrix();
  }).observe(box);
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); })();
} catch (e) {
  st.textContent = 'No se pudo cargar la nube de puntos.';
}
