// AeroBrain — visor público de un modelo 3D (link compartible, sin sesión).
// /share.html?m=<clip_id> — nube · malla · splat + comparador foto/elevación.
import * as THREE from '/vendor/three180.module.js?v=218';
import { OrbitControls } from '/vendor/three-addons180/controls/OrbitControls.js?v=218';
import { OBJLoader } from '/vendor/three-addons180/loaders/OBJLoader.js?v=218';
import { MTLLoader } from '/vendor/three-addons180/loaders/MTLLoader.js?v=218';
import { PLYLoader } from '/vendor/three-addons180/loaders/PLYLoader.js?v=218';
import { mountSplatViewer } from '/splatview.js?v=218';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cid = (new URLSearchParams(location.search).get('m') || '').replace(/[^\w-]/g, '');
document.body.classList.add('share-page');
document.body.innerHTML = `<div class="share-main" style="max-width:1120px;margin:0 auto;padding:22px 16px 60px">
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

const SPLAT_EXT = /\.(sog|spz|ksplat|splat|ply)$/i;
const SPLAT_RANK = { sog: 0, spz: 1, ksplat: 2, splat: 3, ply: 4 };
const wantedSplat = new URLSearchParams(location.search).get('s') || '';
const splatKey = s => s.path || s.name;
const splatUrl = s => 'data/splats/' + splatKey(s).split('/').map(encodeURIComponent).join('/');
const fmtRun = sec => !sec ? ''
  : sec < 180 ? `${Math.round(sec)}s`
    : sec < 7200 ? `${Math.round(sec / 60)}min`
      : `${(sec / 3600).toFixed(1)}h`;
const splatVersionLabel = s => [
  s.current ? 'Actual' : (s.archived_at || 'Historial'),
  s.preset_label || (s.preset ? s.preset[0].toUpperCase() + s.preset.slice(1) : ''),
  s.iters ? `${s.iters >= 1000 ? (s.iters / 1000) + 'k' : s.iters} iters` : '',
  s.backend || '',
  fmtRun(s.duration_s),
  s.loss != null ? `loss ${s.loss}` : '',
  `${(s.bytes / 1e6).toFixed(1)} MB`,
].filter(Boolean).join(' · ');
function splatAssetsFor(clipId, system) {
  return (system.splats || [])
    .filter(s => SPLAT_EXT.test(s.name) && ((s.clip_id || s.name.replace(SPLAT_EXT, '')) === clipId))
    .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0)   // la versión ACTUAL manda (consistente con build_index y tresd)
      || (b.iters || 0) - (a.iters || 0)
      || (SPLAT_RANK[(a.format || a.name.split('.').pop()).toLowerCase()] ?? 9)
      - (SPLAT_RANK[(b.format || b.name.split('.').pop()).toLowerCase()] ?? 9)
      || String(b.archived_at || '').localeCompare(String(a.archived_at || '')));
}
function splatAssetFor(clipId, system) {
  const all = splatAssetsFor(clipId, system);
  return all.find(s => splatKey(s) === wantedSplat || s.name === wantedSplat) || all[0] || null;
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
const splats = splatAssetsFor(cid, sys);
const splat = splatAssetFor(cid, sys);
const splatFmt = (splat?.format || splat?.name.split('.').pop() || 'splat').toUpperCase();
const meshOk = meta.mesh_ok !== false;
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
      <a id="sh-volar" href="volar.html?m=${encodeURIComponent(cid)}" style="display:none;
        text-decoration:none;font:650 12px var(--font);letter-spacing:.1em;color:#fff;
        padding:8px 14px;border-radius:8px;background:linear-gradient(135deg,#45A0E6,#5A78E8);
        margin-right:10px">✈ VOLAR EN 3D</a>
      <div class="seg">
        <button class="on" data-v="cloud">Nube de puntos</button>
        ${meshOk ? '<button data-v="mesh">Malla texturizada</button>' : ''}
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
      ${meta.cloud_copc_asset ? `<a class="exp" href="${base}/${meta.cloud_copc_asset}" download><div><b>Nube optimizada</b><span>COPC</span></div></a>` : ''}
      ${meshOk ? `<a class="exp" href="${base}/model/odm_textured_model_geo.obj" download><div><b>Malla 3D</b><span>OBJ</span></div></a>` : ''}
      ${splat ? `<a class="exp" href="${splatUrl(splat)}" download><div><b>Gaussian splat</b><span>${splatFmt}</span></div></a>` : ''}
    </div>
    <p class="footer-note" style="margin:10px 0 0">Procesado localmente con AeroBrain — fotogrametría ODM sobre video de dron DJI.</p></div>
  </div>`;

if (splat && splats.length > 1) {
  fetch(`data/models/${cid}/scene.v2.json`).then(r => r.ok ? r.json() : null)
  .then(sc => { if (sc?.capabilities?.terrain) { const b = document.getElementById('sh-volar'); if (b) b.style.display = 'inline-block'; } })
  .catch(() => {});
const seg = document.querySelector('.seg');
  const sel = document.createElement('select');
  sel.className = 'share-splat-select';
  sel.title = 'Versión del splat';
  sel.style.cssText = 'background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px';
  sel.innerHTML = splats.map(s => {
    const label = splatVersionLabel(s);
    return `<option value="${esc(splatKey(s))}"${splatKey(s) === splatKey(splat) ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
  sel.addEventListener('change', () => {
    const u = new URL(location.href);
    u.searchParams.set('s', sel.value);
    location.href = u.toString();
  });
  seg?.appendChild(sel);
}

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
  controls.zoomSpeed = 1.35;
  // esquema GOOGLE MAPS: arrastrar = mover el mapa, rueda = zoom al cursor, click-derecho o
  // Ctrl+arrastrar = rotar; táctil: 1 dedo = mover, pellizco = zoom, 2 dedos = rotar
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;   // el pan corre sobre el plano del suelo
  if ('zoomToCursor' in controls) controls.zoomToCursor = true;
  controls.autoRotate = true;            // efecto de entrada — se apaga al tocar
  controls.autoRotateSpeed = 0.7;
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(1, 2, 1.5);
  scene.add(dl);
  let renderFrames = 90;                                       // render on-demand (idle = 0 GPU)
  const wake = () => { renderFrames = 90; };
  view._wake = wake;
  controls.addEventListener('change', wake);
  const ro = new ResizeObserver(() => {
    const W = view.clientWidth, H = view.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    wake();
  });
  ro.observe(view);
  (function loop() {
    // tab cambiado: libera geometría+materiales+texturas y suelta el contexto WebGL
    if (!renderer.domElement.isConnected) {
      ro.disconnect();
      const freed = new Set();
      scene.traverse(o => {
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if (!m) return;
          if (m.map && !freed.has(m.map)) { freed.add(m.map); m.map.dispose(); }
          m.dispose();
        });
      });
      renderer.forceContextLoss(); renderer.dispose();
      return;
    }
    requestAnimationFrame(loop);
    if (controls.update()) renderFrames = Math.max(renderFrames, 2);   // damping/autoRotate
    if (renderFrames > 0) { renderer.render(scene, cam); renderFrames--; }
  })();
  return { scene, cam, controls, renderer };
}

function frame(obj, cam, controls, topDown = false) {
  const bb = new THREE.Box3().setFromObject(obj);
  const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  obj.position.sub(c);
  let maxDim = Math.max(sz.x, sz.y, sz.z);
  if (!isFinite(maxDim) || maxDim <= 0) maxDim = 1;            // geometría degenerada -> sin NaN
  const dist = maxDim * 0.72;
  if (topDown) cam.position.set(dist * 0.12, dist * 0.78, dist * 0.22);
  else cam.position.set(dist * 0.6, dist * 0.55, dist * 0.6);
  cam.near = Math.max(maxDim / 20000, 0.00025);   // ratio near/far acotado: /50000 daba z-fighting en malla
  cam.far = Math.max(dist * 10, 50);
  cam.updateProjectionMatrix();
  cam.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  // terreno 2.5D: bajo el horizonte solo hay underside roto; y sin minDistance el
  // zoom atraviesa la malla (near-clip = "modelo destrozado")
  controls.maxPolarAngle = Math.PI * 0.42;   // ~75°: rasante en una malla 2.5D = bosque de faldones 'destrozado' (estándar Pix4D/DroneDeploy)
  controls.minDistance = Math.max(maxDim * 0.0025, 0.003);
  controls.maxDistance = dist * 5;
  if ('zoomToCursor' in controls) controls.zoomToCursor = true;
}

function fitSplatViewer(viewer) {
  const mesh = viewer?.splatMesh;
  const center = mesh?.calculatedSceneCenter || new THREE.Vector3();
  const radius = Math.max(mesh?.maxSplatDistanceFromSceneCenter || mesh?.visibleRegionRadius || 1, 0.5);
  const dist = radius * 1.15;                     // encuadre close-up por defecto
  const dir = new THREE.Vector3(0.2, 0.72, 0.66).normalize();
  viewer.camera.position.copy(center).addScaledVector(dir, dist);
  viewer.camera.near = Math.max(radius / 10000, 0.0005);   // near chico → acercar sin clip
  viewer.camera.far = Math.max(radius * 80, dist * 8);
  viewer.camera.updateProjectionMatrix();
  if (viewer.controls) {
    viewer.controls.target.copy(center);
    viewer.controls.minDistance = Math.max(radius * 0.0025, 0.002);
    viewer.controls.maxDistance = radius * 18;
    if ('zoomToCursor' in viewer.controls) viewer.controls.zoomToCursor = true;
    viewer.controls.update();
  }
}

const loaders = {
  async cloud() {
    const myLoad = view._loadToken;                            // currency (#1)
    const st = spinner('Descargando nube de puntos…');
    const geo = await new PLYLoader().loadAsync(`${base}/cloud.ply`,
      ev => { st.textContent = ev.total ? `Nube · ${Math.round(ev.loaded / ev.total * 100)}%` : `Nube · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
    if (view._loadToken !== myLoad) { geo.dispose(); return; }
    const { scene, cam, controls } = makeScene();
    const mat = new THREE.PointsMaterial({ size: 0.18, sizeAttenuation: true, vertexColors: geo.hasAttribute('color') });
    const pts = new THREE.Points(geo, mat);
    pts.rotation.x = -Math.PI / 2;
    scene.add(pts);
    frame(pts, cam, controls, true);
  },
  async mesh() {
    const myLoad = view._loadToken;                            // currency (#1)
    const st = spinner('Descargando malla texturizada…');
    const mbase = `${base}/model/`;
    // switch de calidad 4-tier con supersampling por tier (Metal). extra/ultra desktop-only
    // (Safari/iPhone evictan >~1GB → parches negros). ultra = geo.mtl 4096 original.
    const TIERS = {
      bajo:  { mtl: 'odm_textured_model_viewer_low.mtl',   pr: 1.5, label: 'Rápido' },
      alto:  { mtl: 'odm_textured_model_viewer.mtl',       pr: 2,   label: 'HD' },
      extra: { mtl: 'odm_textured_model_viewer_extra.mtl', pr: 2,   label: 'Extra', hires: true },
      ultra: { mtl: 'odm_textured_model_geo.mtl',          pr: 3,   label: 'Ultra', hires: true },
    };
    const HIRES_OK = !matchMedia('(pointer: coarse)').matches && window.innerWidth >= 900;
    const prFor = tier => {
      const dpr = devicePixelRatio || 1;
      if (tier === 'ultra') return Math.min(2.5, dpr + 0.75);   // SSAA capado (pr3+MSAA = framebuffer enorme, redundante) (#11)       // SSAA por encima del nativo
      if (tier === 'extra') return Math.min(2.25, dpr + 0.4);
      return Math.min(dpr, TIERS[tier].pr);
    };
    const tierMaterials = async (tier, fallback = false) => {
      let mc;
      try {
        mc = await new MTLLoader().setPath(mbase).loadAsync(TIERS[tier].mtl);
      } catch (e) {
        if (!fallback || tier === 'bajo') throw e;             // no degradar 'bajo' a 4096
        mc = await new MTLLoader().setPath(mbase).loadAsync('odm_textured_model_geo.mtl');
      }
      mc.preload();
      return mc;
    };
    let curTier = matchMedia('(max-width: 820px), (pointer: coarse)').matches ? 'bajo' : 'alto';
    const mc0 = await tierMaterials(curTier, true);
    const meshFile = (meta.model_viewer || 'model/odm_textured_model_geo.obj').split('/').pop();
    const obj = await new OBJLoader().setMaterials(mc0).setPath(mbase).loadAsync(meshFile,
      ev => { if (ev.loaded) st.textContent = `Malla · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
    if (view._loadToken !== myLoad) return;                    // tab cambió durante la descarga
    const { scene, cam, controls, renderer } = makeScene();
    renderer.setPixelRatio(prFor(curTier));
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const swatches = [];
    obj.traverse(n => {
      if (!n.isMesh) return;
      const src = Array.isArray(n.material) ? n.material : [n.material];
      src.forEach(m => { if (m.map) { m.map.anisotropy = maxAniso; m.map.needsUpdate = true; } });
      const mats = src.map(m => new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : 0x8a97a8, side: THREE.DoubleSide }));
      swatches.push({ names: src.map(m => m.name), mats });
      n.material = mats.length === 1 ? mats[0] : mats;
    });
    async function switchTier(tier) {
      if (tier === curTier) return false;
      let mc; try { mc = await tierMaterials(tier); } catch { return false; }
      const freed = new Set();
      swatches.forEach(s => s.names.forEach((nm, i) => {
        const newMap = mc.materials[nm]?.map;
        if (!newMap) return;                                  // conserva el actual si falta en el tier
        newMap.anisotropy = maxAniso;
        const old = s.mats[i].map;
        s.mats[i].map = newMap; s.mats[i].needsUpdate = true;
        if (old && old !== newMap && !freed.has(old)) { freed.add(old); old.dispose(); }
      }));
      renderer.setPixelRatio(prFor(tier));
      curTier = tier;
      view._wake?.();
      setTimeout(() => view._wake?.(), 900);                  // re-arma por upload GPU lento de tier grande (#7)
      return true;
    }
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    frame(obj, cam, controls);
    // HUD de calidad (share.html no tiene foto/relieve; solo el switch de resolución)
    const tierBtns = Object.entries(TIERS)
      .filter(([, t]) => !t.hires || HIRES_OK)
      .map(([k, t]) => `<button class="chip${k === curTier ? ' on' : ''}" data-mq="${k}">${t.label}</button>`).join('');
    const hud = document.createElement('div');
    hud.className = 'viewer-hud';
    hud.innerHTML = `<label>Calidad ${tierBtns}</label>`;
    view.appendChild(hud);
    hud.addEventListener('click', async ev => {
      const mq = ev.target.closest('[data-mq]');
      if (!mq || mq.classList.contains('on')) return;
      const btns = [...hud.querySelectorAll('[data-mq]')];
      btns.forEach(b => b.disabled = true);
      const t = mq.textContent; mq.textContent = '…';
      const ok = await switchTier(mq.dataset.mq);
      mq.textContent = t; btns.forEach(b => b.disabled = false);
      if (ok) btns.forEach(c => c.classList.toggle('on', c === mq));
    });
  },
  async splat() {
    const myLoad = view._loadToken;
    const st = spinner('Descargando gaussian splat…');
    let handle;
    try {
      handle = await mountSplatViewer(view, splatUrl(splat),
        { bytes: splat.bytes, onStatus: t => { if (st) st.textContent = t; } });
    } catch (err) {
      if (view._loadToken !== myLoad) return;       // superado por otro load: no error falso
      throw err;
    }
    if (view._loadToken !== myLoad) { handle.dispose(); return; }   // tab cambió durante la carga
    view._splatViewer = handle.viewer;
    view._splatDispose = handle.dispose;            // dispose premium (limpia HUD + listeners + viewer)
    view.querySelector('.sh-st')?.parentElement?.remove();
  },
};

document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  view._loadToken = (view._loadToken || 0) + 1;   // invalida carga mesh/cloud/splat en vuelo (#1)
  // el módulo premium expone su propio dispose (limpia HUD + listeners + viewer)
  if (view._splatDispose) { const d = view._splatDispose; view._splatDispose = null; view._splatViewer = null; try { d(); } catch {} }
  else if (view._splatViewer) { const v = view._splatViewer; view._splatViewer = null; try { const p = v.dispose(); if (p?.catch) p.catch(() => {}); } catch {} }
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  const NAMES = { cloud: 'la nube de puntos (cloud.ply)', mesh: 'la malla texturizada (OBJ/MTL)', splat: `el gaussian splat (.${splatFmt.toLowerCase()})` };
  loaders[b.dataset.v]().catch(err => {
    view.innerHTML = `<p class="footer-note">No se pudo cargar ${NAMES[b.dataset.v]} del modelo ${esc(cid)}.
      <span style="color:var(--text-3)">${esc(String(err && err.message || err).slice(0, 120))}</span></p>`;
  });
});
loaders.cloud().catch(err => {
  view.innerHTML = `<p class="footer-note">No se pudo cargar la nube de puntos (cloud.ply) del modelo ${esc(cid)}.
    <span style="color:var(--text-3)">${esc(String(err && err.message || err).slice(0, 120))}</span></p>`;
});
