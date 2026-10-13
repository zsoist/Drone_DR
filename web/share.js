import { fmt } from './ui/format.js?v=431';
import { term } from './ui/terms.js?v=431';
import { Suggested } from './ui/suggested.js?v=431';
import { sceneTitle, sceneVersionLabel, contentSheet, sceneInfo, sceneInsight, suggestionBlock, reducedMotion } from './scene-improve-ui.js?v=431';
import { loadIsCurrent } from './scene-improve-state.js?v=431';
// AeroBrain — visor privado de un modelo 3D (el servidor exige sesión).
// /share.html?m=<clip_id> — nube · malla · splat + comparador foto/elevación.
import * as THREE from '/vendor/three180.module.js?v=431';
import { OrbitControls } from '/vendor/three-addons180/controls/OrbitControls.js?v=431';
import { OBJLoader } from '/vendor/three-addons180/loaders/OBJLoader.js?v=431';
import { MTLLoader } from '/vendor/three-addons180/loaders/MTLLoader.js?v=431';
import { PLYLoader } from '/vendor/three-addons180/loaders/PLYLoader.js?v=431';
import { mountSplatViewer } from '/splatview.js?v=431';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cid = (new URLSearchParams(location.search).get('m') || '').replace(/[^\w-]/g, '');
document.body.classList.add('share-page');
document.body.innerHTML = `<div class="share-main">
  <header class="sh-head rise">
    ${shell.backLink('Escenas', '/tresd.html')}
    <div class="sh-head-t">
      <h1 id="sh-title">Modelo 3D</h1>

    </div><button class="ui-button ui-button--quiet" id="sh-options">Detalles</button>
  </header>
  <div id="sh-body" aria-busy="true"><div class="ui-skeleton ui-skeleton--media" aria-hidden="true"></div></div>
</div>
<svg class="sh-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="sh-hard" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter></svg>`;
const body = document.getElementById('sh-body');
const back = document.querySelector('.sh-head .ui-back');
back.setAttribute('aria-label', 'Volver a Escenas');
back.title = 'Volver a Escenas';
back.replaceChildren(back.querySelector('svg'));

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
const splatVersionLabel = sceneVersionLabel;
const splatDetails = s => s ? [
  s.preset_label, s.backend,
  s.iters ? `${s.iters} iteraciones` : '',
  s.duration_s ? `Tiempo: ${fmtRun(s.duration_s)}` : '',
  s.loss != null ? `Error: loss ${s.loss}` : '',
].filter(Boolean).join(' · ') : '';
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
if (!cid) {
  // sin ?m= no hay nada que pedir: antes hacía fetch a data/models//meta.json (404) y lanzaba
  body.innerHTML = `<div class="ui-empty"><p>El enlace no indica qué escena abrir.</p><a class="ui-button ui-button--primary" href="tresd.html">Ver escenas</a><p>Abre una escena desde tu biblioteca.</p></div>`;
} else try {
  meta = await jfetch(`data/models/${cid}/meta.json`);
  sys = await jfetch('data/manifest/system.json').catch(() => ({}));
} catch {
  body.innerHTML = `<div class="ui-empty"><p>La escena no está disponible.</p><a class="ui-button ui-button--primary" href="tresd.html">Ver escenas</a><p>Comprueba el enlace desde tu biblioteca.</p></div>`;
}
if (!meta) { body.setAttribute('aria-busy','false'); await new Promise(() => {}); }   // página vacía con mensaje: no seguir montando visores

document.getElementById('sh-title').textContent = sceneTitle(meta.title || `Vuelo ${cid.slice(-6)}`);
document.title = `AeroBrain — ${sceneTitle(meta.title || cid)}`;
const q = meta.qa || {};
const base = `data/models/${cid}`;
const splats = splatAssetsFor(cid, sys);
const splat = splatAssetFor(cid, sys);
const splatFmt = (splat?.format || splat?.name.split('.').pop() || 'splat').toUpperCase();
const meshOk = meta.mesh_ok !== false;
const ha = q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(2) + ' ha' : Math.round(q.area_m2 || 0) + ' m²';

const dlRow = (href, name, sub, opts = '') =>
  `<a class="exp sh-dl" href="${href}" ${opts}>${icon('dl')}<div><b>${name}</b><span class="sh-dl-sub" data-size-url="${href}">${sub}</span></div></a>`;
const sizeOf = b => b >= 1e9 ? `${fmt.number(b / 1e9, 1)} GB` : `${fmt.number(Math.max(1, Math.round(b / 1e6)))} MB`;

body.setAttribute('aria-busy','false');
body.innerHTML = `
  <div class="sh-chips rise">
    ${q.gsd_cm_px ? `<span class="chip on">${q.gsd_cm_px} cm/px</span>` : ''}
    ${q.area_m2 ? `<span class="chip on">${ha}</span>` : ''}
    ${q.cameras_reconstructed ? `<span class="chip">${q.cameras_reconstructed} cámaras</span>` : ''}
    ${meta.has_dsm ? `<span class="chip">Elevación DSM</span>` : ''}
    ${splat ? `<span class="chip">Splat</span>` : ''}
  </div>

  <div class="panel rise sh-viewer">
    <div class="ph sh-ph">

      <a id="sh-volar" class="ui-button ui-button--quiet sh-volar" href="volar.html?m=${encodeURIComponent(cid)}" hidden>${icon('drone')} Volar en 3D</a>
      <div class="ui-segmented sh-tabs" role="group" aria-label="Tipo de visor">
        <button class="on" data-v="cloud" aria-pressed="true">${term('cloud')}</button>
        ${meshOk ? `<button data-v="mesh" aria-pressed="false">${term('mesh')}</button>` : ''}
        ${splat ? `<button data-v="splat" aria-pressed="false">${term('splat')}</button>` : ''}
      </div>
    </div>
    <div id="sh-view" class="sh-view"></div>
  </div>

  <div class="sh-description" id="sh-description" aria-busy="true"><span class="ui-skeleton ui-skeleton--text" aria-hidden="true"></span></div>
  <div class="sh-actions" hidden><button class="ui-button ui-button--secondary" id="sh-info">Información</button><button class="ui-button ui-button--quiet" id="sh-downloads">Descargas</button>${meta.cmp_asset && meta.has_dsm ? '<button class="ui-button ui-button--quiet" id="sh-compare">Foto y relieve</button>' : ''}</div>
  <div id="sh-details" hidden>
  ${meta.cmp_asset && meta.has_dsm ? `
  <div class="panel rise">
    <div class="ph">Foto real y elevación <span class="hint">Arrastra el divisor</span></div>
    <div class="cmp" id="cmp" role="slider" tabindex="0" aria-valuemin="2" aria-valuemax="98" aria-valuenow="50" aria-label="Comparar foto y elevación">
      <img src="${base}/dsm_color.webp" alt="Mapa de elevación en color" draggable="false">
      <img class="cmp-over" src="${base}/${esc(meta.cmp_asset)}" alt="Foto real del sitio" draggable="false" style="clip-path:inset(0 50% 0 0)">
      <div class="cmp-handle" style="left:50%"><span></span></div>
    </div>
  </div>` : ''}

  <div class="panel rise">
    <div class="ph">Descargas</div>
    <div class="pb"><div class="sh-dl-grid">
      ${dlRow(`${base}/ortho_full.jpg`, 'Ortofoto 5K', 'JPG', 'target="_blank" rel="noopener"')}
      ${dlRow(`${base}/cloud.ply`, term('cloud'), 'PLY', 'download')}
      ${meta.cloud_copc_asset ? dlRow(`${base}/${meta.cloud_copc_asset}`, 'Puntos para descargar', 'COPC', 'download') : ''}
      ${meshOk ? dlRow(`${base}/model/odm_textured_model_geo.obj`, term('mesh'), 'OBJ', 'download') : ''}
      ${splat ? dlRow(splatUrl(splat), term('splat'), `${splatFmt}${splat.bytes ? ' · ' + sizeOf(splat.bytes) : ''}`, 'download') : ''}
    </div>
    </div>
  </div></div>`;

const detailNodes = [...document.querySelectorAll('#sh-details > .panel')];
function openDetail(node, title, opener) {
  node.hidden = false;
  const sheet = contentSheet(title,node,opener);
  sheet.element.addEventListener('close',()=>document.getElementById('sh-details').append(node),{once:true});
}
document.getElementById('sh-downloads').onclick=e=>openDetail(detailNodes.at(-1),'Descargas',e.currentTarget);
document.getElementById('sh-compare')?.addEventListener('click',e=>openDetail(detailNodes[0],'Foto y elevación',e.currentTarget));
document.getElementById('sh-info').onclick=e=>sceneInfo({model:{...meta,clip_id:cid},processing:splatDetails(splat),opener:e.currentTarget});

// tamaño de cada descarga como subtítulo (HEAD, solo lectura; si falla queda el formato)
document.querySelectorAll('[data-size-url]').forEach(el => {
  if (/·/.test(el.textContent)) return;
  fetch(el.dataset.sizeUrl, { method: 'HEAD' }).then(r => {
    const n = +r.headers.get('content-length');
    if (r.ok && n) el.textContent = `${el.textContent} · ${sizeOf(n)}`;
  }).catch(() => {});
});

// "VOLAR EN 3D" depende solo de la escena del modelo, no de cuántos splats haya
fetch(`data/models/${cid}/scene.v2.json`).then(r => r.ok ? r.json() : null)
  .then(sc => { if (sc?.capabilities?.terrain) { const b = document.getElementById('sh-volar'); if (b) b.hidden = false; } })
  .catch(() => {});

if (splat && splats.length > 1) {
  const seg = document.querySelector('.sh-actions');
  const sel = document.createElement('select');
  sel.className = 'share-splat-select';
  sel.classList.add('ctl');
  sel.title = 'Versión de la escena';
  sel.setAttribute('aria-label', 'Versión de la escena');
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

const options = document.querySelector('.sh-actions');
options.prepend(document.getElementById('sh-description'));
options.append(document.getElementById('sh-volar'));
document.getElementById('sh-options').onclick = e => {
  options.hidden = false;
  const sheet = contentSheet('Detalles de la escena', options, e.currentTarget);
  sheet.element.addEventListener('close', () => { options.hidden = true; body.append(options); }, {once:true});
};
const description = document.getElementById('sh-description');
const peekKey = `ab.scene-description.${cid}`;
let peek;
const closePeek = () => { peek?.remove(); peek = null; };
document.getElementById('sh-options').addEventListener('click', closePeek);
sceneInsight({...meta, clip_id:cid}).then(insight => {
  description.replaceChildren(...(insight ? [suggestionBlock({title:'', text:insight.caption_short, fullText:insight.caption})] : []));
  let seen = false;
  try { seen = sessionStorage.getItem(peekKey) === 'seen'; } catch {}
  if (insight?.caption_short && !seen) {
    peek = Suggested({content:insight.caption_short});
    peek.classList.add('sh-peek');
    const dismiss = document.createElement('button');
    dismiss.className = 'ui-button ui-button--quiet';
    dismiss.type = 'button'; dismiss.setAttribute('aria-label','Ocultar descripción');
    dismiss.innerHTML = icon('close'); dismiss.onclick = closePeek;
    peek.append(dismiss); document.querySelector('.share-main').append(peek);
    try { sessionStorage.setItem(peekKey,'seen'); } catch {}
    document.getElementById('sh-view').addEventListener('pointerdown',closePeek,{once:true});
  }
}).catch(() => { description.textContent = 'Descripción no disponible.'; })
  .finally(() => description.setAttribute('aria-busy','false'));

// ---------- comparador ----------
const cmp = document.getElementById('cmp');
if (cmp) {
  const over = cmp.querySelector('.cmp-over'), handle = cmp.querySelector('.cmp-handle');
  const move = x => {
    const r = cmp.getBoundingClientRect();
    const p = Math.max(2, Math.min(98, (x - r.left) / r.width * 100));
    over.style.clipPath = `inset(0 ${(100 - p).toFixed(2)}% 0 0)`;
    handle.style.left = p + '%';
    cmp.setAttribute('aria-valuenow', Math.round(p));
  };
  cmp.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const r=cmp.getBoundingClientRect();move(r.left+r.width*(+cmp.getAttribute('aria-valuenow')+(e.key==='ArrowRight'?2:-2))/100);});
  cmp.addEventListener('pointerdown', e => { cmp.setPointerCapture(e.pointerId); move(e.clientX); });
  cmp.addEventListener('pointermove', e => { if (e.buttons) move(e.clientX); });
}

// ---------- visores (nube / malla / splat) ----------
const view = document.getElementById('sh-view');
const spinner = label => {
  view.innerHTML = `<div class="sh-spin">
    <div class="sk"></div>
    <p class="footer-note sh-st">${label}</p></div>`;
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
  controls.autoRotate = !reducedMotion();            // efecto de entrada — se apaga al tocar
  controls.autoRotateSpeed = 0.7;
  const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
  const stopAutoplay=()=>{if(motionPreference.matches)controls.autoRotate=false;};
  motionPreference.addEventListener('change',stopAutoplay);
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
      motionPreference.removeEventListener('change',stopAutoplay);
      controls.dispose();
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
  const home=()=>{cam.position.copy(savedPosition);controls.target.copy(savedTarget);controls.update();wake();};
  const savedPosition=new THREE.Vector3(),savedTarget=new THREE.Vector3();
  requestAnimationFrame(()=>{savedPosition.copy(cam.position);savedTarget.copy(controls.target);});
  const nav=document.createElement('div');nav.className='viewer-tools';
  nav.innerHTML='<button class="ui-button ui-button--secondary" data-camera="home" aria-label="Reiniciar vista">'+icon('fit')+'</button><button class="ui-button ui-button--secondary" data-camera="full">Ampliar</button>';
  const exit=()=>{view.classList.remove('sv-fullscreen');nav.querySelector('[data-camera="full"]').textContent='Ampliar';};
  nav.addEventListener('click',e=>{const b=e.target.closest('[data-camera]');if(!b)return;if(b.dataset.camera==='home')home();else{view.classList.toggle('sv-fullscreen');b.textContent=view.classList.contains('sv-fullscreen')?'Salir':'Ampliar';}});
  renderer.domElement.tabIndex=0;
  view.onkeydown=e=>{if(e.key==='Escape')exit();};
  view.append(nav);
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
    const st = spinner('Cargando puntos…');
    const geo = await new PLYLoader().loadAsync(`${base}/cloud.ply`,
      ev => { st.textContent = ev.total ? `Puntos · ${Math.round(ev.loaded / ev.total * 100)}%` : `Puntos · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
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
    const st = spinner('Cargando modelo 3D…');
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
      ev => { if (ev.loaded) st.textContent = `Modelo 3D · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
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
    const tierBtns = Object.entries(TIERS)
      .filter(([, t]) => !t.hires || HIRES_OK)
      .map(([k, t]) => `<button aria-pressed="${k === curTier}" data-mq="${k}">${t.label}</button>`).join('');
    const hud = document.createElement('div');
    hud.className = 'sh-quality';
    hud.innerHTML = `<p>Calidad del modelo</p><div class="ui-segmented" role="group" aria-label="Calidad del modelo">${tierBtns}</div>`;
    options.append(hud);
    hud.addEventListener('click', async ev => {
      const mq = ev.target.closest('[data-mq]');
      if (!mq || mq.getAttribute('aria-pressed') === 'true') return;
      const btns = [...hud.querySelectorAll('[data-mq]')];
      btns.forEach(b => b.disabled = true);
      const t = mq.textContent; mq.textContent = '…';
      const ok = await switchTier(mq.dataset.mq);
      mq.textContent = t; btns.forEach(b => b.disabled = false);
      if (ok) btns.forEach(c => c.setAttribute('aria-pressed', String(c === mq)));
    });
  },
  async splat() {
    const myLoad = view._loadToken;
    const st = spinner('Cargando escena…');
    const ac = view._loadAbort = new AbortController();   // cambiar de tab aborta el mount en vuelo
    let handle;
    try {
      handle = await mountSplatViewer(view, splatUrl(splat),
        { bytes: splat.bytes, compact: true, signal: ac.signal, onStatus: t => { if (st) st.textContent = t; },
          // mismo criterio que tresd.js: el lane CUDA entrena normalizado → unidades relativas
          unitsMeters: splat.backend ? !/cuda|nvidia/i.test(splat.backend) : null });
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

function loadView(b, confirmed = false) {
  if (!b) return;
  options.querySelector('.sh-quality')?.remove();
  view._loadToken = (view._loadToken || 0) + 1;   // invalida carga mesh/cloud/splat en vuelo (#1)
  try { view._loadAbort?.abort(); } catch {} view._loadAbort = null;
  // el módulo premium expone su propio dispose (limpia HUD + listeners + viewer)
  if (view._splatDispose) { const d = view._splatDispose; view._splatDispose = null; view._splatViewer = null; try { d(); } catch {} }
  else if (view._splatViewer) { const v = view._splatViewer; view._splatViewer = null; try { const p = v.dispose(); if (p?.catch) p.catch(() => {}); } catch {} }
  document.querySelectorAll('.sh-tabs button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  const bytes = b.dataset.v === 'splat' ? splat?.bytes : b.dataset.v === 'cloud' ? meta.cloud_bytes : meta.mesh_bytes;
  if (!confirmed && matchMedia('(max-width:600px)').matches && bytes > 80 * 1024 * 1024) {
    view.innerHTML = `<div class="sh-large"><p>Esta vista descarga ${sizeOf(bytes)}.</p><button class="ui-button ui-button--primary" id="sh-start">Cargar escena · ${sizeOf(bytes)}</button></div>`;
    document.getElementById('sh-start').onclick = () => loadView(b, true);
    return;
  }
  const token = view._loadToken;
  loaders[b.dataset.v]().catch(err => {
    if (!loadIsCurrent(view, token)) return;
    view.innerHTML = '<div class="sh-err"><p>No se pudo cargar esta vista.</p><button class="ui-button ui-button--secondary" id="sh-retry">Reintentar</button></div>';
    document.getElementById('sh-retry').onclick = () => loadView(b, true);
  });
}
document.querySelector('.sh-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-v]');
  if (button && button.getAttribute('aria-pressed') !== 'true') loadView(button);
});
loadView(document.querySelector(`.sh-tabs [data-v="${splat ? 'splat' : 'cloud'}"]`));
