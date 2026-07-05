// AeroBrain — visor público de un modelo 3D (link compartible, sin sesión).
// /share.html?m=<clip_id> — nube · malla · splat + comparador foto/elevación.
import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';
import { OBJLoader } from '/vendor/three-addons/loaders/OBJLoader.js';
import { MTLLoader } from '/vendor/three-addons/loaders/MTLLoader.js';
import { PLYLoader } from '/vendor/three-addons/loaders/PLYLoader.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cid = (new URLSearchParams(location.search).get('m') || '').replace(/[^\w-]/g, '');
document.body.innerHTML = `<div style="max-width:1120px;margin:0 auto;padding:22px 16px 60px">
  <div class="page-head rise" style="align-items:center">
    <span style="width:32px;height:32px;border-radius:8px;background:var(--accent-dim);display:grid;place-items:center;color:var(--accent);font-weight:700;font-size:13px">A</span>
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
  <div class="tool-row rise" style="margin-bottom:14px">
    ${q.gsd_cm_px ? `<span class="chip on">${q.gsd_cm_px} cm/px</span>` : ''}
    ${q.area_m2 ? `<span class="chip on">${ha}</span>` : ''}
    ${q.cameras_reconstructed ? `<span class="chip">${q.cameras_reconstructed} cámaras</span>` : ''}
    ${meta.has_dsm ? `<span class="chip">Elevación DSM</span>` : ''}
    ${splat ? `<span class="chip">Gaussian splat</span>` : ''}
  </div>

  <div class="panel rise">
    <div class="ph">Visor 3D
      <span class="spacer" style="flex:1"></span>
      <div class="seg">
        <button class="on" data-v="cloud">Nube de puntos</button>
        <button data-v="mesh">Malla texturizada</button>
        ${splat ? '<button data-v="splat">Gaussian splat</button>' : ''}
      </div>
    </div>
    <div id="sh-view" style="height:64dvh;min-height:400px;display:grid;place-items:center;position:relative;background:radial-gradient(ellipse at 50% 40%, #131a24 0%, #0a0e14 70%)"></div>
  </div>

  ${meta.cmp_asset && meta.has_dsm ? `
  <div class="panel rise" style="margin-top:14px">
    <div class="ph">Foto real ↔ Elevación — arrastra el divisor</div>
    <div class="cmp" id="cmp">
      <img src="${base}/dsm_color.webp" alt="" draggable="false">
      <img class="cmp-over" src="${base}/${esc(meta.cmp_asset)}" alt="" draggable="false" style="clip-path:inset(0 50% 0 0)">
      <div class="cmp-handle" style="left:50%"><span></span></div>
    </div>
  </div>` : ''}

  <div class="panel rise" style="margin-top:14px">
    <div class="ph">Descargas</div>
    <div class="pb"><div class="exp-grid">
      <a class="exp" href="${base}/ortho_full.jpg" target="_blank" rel="noopener"><div><b>Ortofoto 5K</b><span>JPG</span></div></a>
      <a class="exp" href="${base}/cloud.ply" download><div><b>Nube de puntos</b><span>PLY</span></div></a>
      <a class="exp" href="${base}/model/odm_textured_model_geo.obj" download><div><b>Malla 3D</b><span>OBJ</span></div></a>
      ${splat ? `<a class="exp" href="data/splats/${encodeURIComponent(splat.name)}" download><div><b>Gaussian splat</b><span>SPLAT</span></div></a>` : ''}
    </div>
    <p class="footer-note" style="margin:10px 0 0">Procesado localmente con AeroBrain — fotogrametría ODM sobre video de dron DJI.</p></div>
  </div>`;

// ---------- comparador ----------
const cmp = document.getElementById('cmp');
if (cmp) {
  const over = cmp.querySelector('.cmp-over'), handle = cmp.querySelector('.cmp-handle');
  const move = x => {
    const r = cmp.getBoundingClientRect();
    const p = Math.max(2, Math.min(98, (x - r.left) / r.width * 100));
    over.style.clipPath = `inset(0 ${(100 - p).toFixed(2)}% 0 0)`;
    handle.style.left = p + '%';
  };
  cmp.addEventListener('pointerdown', e => { cmp.setPointerCapture(e.pointerId); move(e.clientX); });
  cmp.addEventListener('pointermove', e => { if (e.buttons) move(e.clientX); });
}

// ---------- visores (nube / malla / splat) ----------
const view = document.getElementById('sh-view');
const spinner = label => {
  view.innerHTML = `<div style="width:80%;text-align:center">
    <div class="sk" style="height:10px;border-radius:5px"></div>
    <p class="footer-note sh-st" style="margin:10px 0 0">${label}</p></div>`;
  return view.querySelector('.sh-st');
};

function makeScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(view.clientWidth, view.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.innerHTML = '';
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, view.clientWidth / view.clientHeight, 0.1, 5000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.55;
  controls.autoRotate = true;            // efecto de entrada — se apaga al tocar
  controls.autoRotateSpeed = 0.7;
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(1, 2, 1.5);
  scene.add(dl);
  new ResizeObserver(() => {
    const W = view.clientWidth, H = view.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
  }).observe(view);
  (function loop() {
    if (!renderer.domElement.isConnected) { renderer.dispose(); return; }  // tab cambiado
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, cam);
  })();
  return { scene, cam, controls, renderer };
}

function frame(obj, cam, controls, topDown = false) {
  const bb = new THREE.Box3().setFromObject(obj);
  const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  obj.position.sub(c);
  const dist = Math.max(sz.x, sz.y, sz.z) * 0.9;
  if (topDown) cam.position.set(dist * 0.15, dist * 0.92, dist * 0.28);
  else cam.position.set(dist * 0.6, dist * 0.55, dist * 0.6);
  cam.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
}

const loaders = {
  async cloud() {
    const st = spinner('Descargando nube de puntos…');
    const geo = await new PLYLoader().loadAsync(`${base}/cloud.ply`,
      ev => { st.textContent = ev.total ? `Nube · ${Math.round(ev.loaded / ev.total * 100)}%` : `Nube · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
    const { scene, cam, controls } = makeScene();
    const mat = new THREE.PointsMaterial({ size: 0.18, sizeAttenuation: true, vertexColors: geo.hasAttribute('color') });
    const pts = new THREE.Points(geo, mat);
    pts.rotation.x = -Math.PI / 2;
    scene.add(pts);
    frame(pts, cam, controls, true);
  },
  async mesh() {
    const st = spinner('Descargando malla texturizada…');
    const mbase = `${base}/model/`;
    const mtl = await new MTLLoader().setPath(mbase).loadAsync('odm_textured_model_geo.mtl');
    mtl.preload();
    const obj = await new OBJLoader().setMaterials(mtl).setPath(mbase).loadAsync('odm_textured_model_geo.obj',
      ev => { if (ev.loaded) st.textContent = `Malla · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
    const { scene, cam, controls, renderer } = makeScene();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    obj.traverse(n => {
      if (!n.isMesh) return;
      const src = Array.isArray(n.material) ? n.material : [n.material];
      const mats = src.map(m => {
        if (m.map) { m.map.anisotropy = maxAniso; m.map.needsUpdate = true; }
        return new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : 0x8a97a8, side: THREE.DoubleSide });
      });
      n.material = mats.length === 1 ? mats[0] : mats;
    });
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    frame(obj, cam, controls);
  },
  async splat() {
    spinner('Cargando gaussian splat…');
    const { GaussianSplats3D } = await import('/vendor/gaussian-splats-3d.module.min.js');
    view.innerHTML = '';
    const viewer = new GaussianSplats3D.Viewer({ rootElement: view, sharedMemoryForWorkers: false, antialiased: true });
    await viewer.addSplatScene(`data/splats/${splat.name}`, { progressiveLoad: true, splatAlphaRemovalThreshold: 5 });
    viewer.start();
  },
};

document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  loaders[b.dataset.v]().catch(() => { view.innerHTML = '<p class="footer-note">No se pudo cargar esta vista.</p>'; });
});
loaders.cloud().catch(() => { view.innerHTML = '<p class="footer-note">No se pudo cargar la nube.</p>'; });
