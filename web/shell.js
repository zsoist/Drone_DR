// App shell: sidebar nav, shared formatters, data access. Requires icons.js.
const DATA = 'data';

// ---- captura global de errores JS → /api/client_error (registro central + reporte DeepSeek).
// sendBeacon: no bloquea ni falla ruidoso; máx 5 por sesión de página (anti-loop de un error
// que se repite en cada frame). El server además rate-limita globalmente.
(() => {
  let sent = 0;
  const report = (msg, stack) => {
    if (sent >= 5 || !navigator.sendBeacon) return;
    sent++;
    try {
      navigator.sendBeacon('/api/client_error', new Blob([JSON.stringify({
        msg: String(msg).slice(0, 300),
        stack: String(stack || '').slice(0, 200),
        page: location.pathname.split('/').pop(),
      })], { type: 'application/json' }));
    } catch { /* jamás romper la app por reportar */ }
  };
  addEventListener('error', e => report(e.message, e.error?.stack));
  addEventListener('unhandledrejection', e => report(`unhandled: ${e.reason?.message || e.reason}`, e.reason?.stack));
})();

const NAV = [
  { href: 'home.html', ic: 'gauge', label: 'Inicio' },
  { href: 'index.html', ic: 'grid', label: 'Vuelos' },
  { href: 'drone.html', ic: 'drone', label: 'Dron' },
  { href: 'trips.html', ic: 'pin', label: 'Viajes' },
  { href: 'studio.html', ic: 'film', label: 'Studio' },
  { href: 'tresd.html', ic: 'cube', label: '3D' },
  { href: 'splatlab.html', ic: 'spark', label: 'Splat Lab' },
  { href: 'system.html', ic: 'db', label: 'Sistema' },
];

// scrub de miniaturas compartido (Vuelos, Viajes, Inicio): mouse hover + swipe horizontal iOS
function attachScrub(root) {
  root.querySelectorAll('.card.scrub, .cr-item.scrub').forEach(cardEl => {
    const n = +cardEl.dataset.frames;
    if (!n) return;
    const img = cardEl.querySelector('img');
    const line = cardEl.querySelector('.scrub-line');
    if (!img || !line) return;
    const orig = img.src;
    const at = frac => {
      const i = Math.max(1, Math.ceil(frac * n));
      img.src = `${DATA}/frames/${cardEl.dataset.cid}/f_${String(i).padStart(4, '0')}.jpg`;
      line.style.width = `${(frac * 100).toFixed(1)}%`;
      line.style.opacity = 1;
    };
    cardEl.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;              // touch usa el gesto propio
      const r = cardEl.getBoundingClientRect();
      at((e.clientX - r.left) / r.width);
    });
    cardEl.addEventListener('pointerleave', () => { img.src = orig; line.style.opacity = 0; });
    // iOS: deslizar horizontal sobre el thumb scrubbea; vertical sigue scrolleando
    let t0 = null, scrubT = 0;
    cardEl.addEventListener('touchstart', e => { t0 = e.touches[0]; clearTimeout(scrubT); }, { passive: true });   // cancela un reset pendiente del gesto anterior
    cardEl.addEventListener('touchmove', e => {
      if (!t0) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - t0.clientX) > Math.abs(t.clientY - t0.clientY) + 6) {
        const r = cardEl.getBoundingClientRect();
        at(Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)));
        e.preventDefault();
      }
    }, { passive: false });
    cardEl.addEventListener('touchend', () => {
      t0 = null;
      clearTimeout(scrubT);   // reemplaza (no acumula) el reset; se cancela si empieza otro scrub
      scrubT = setTimeout(() => { img.src = orig; line.style.opacity = 0; }, 900);
    });
  });
}

// escape HTML: TODO texto de usuario/LLM pasa por aquí antes de innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// sesión de operador: cookie HttpOnly (credenciales NUNCA se guardan en el navegador).
// Varios api() pueden recibir 403 a la vez (al cargar la página se disparan varios POST):
// deben COMPARTIR un único login en vuelo. Hoy el 2º+ ve el overlay #login-ov ya presente,
// loginModal() resuelve false por su guard singleton, y api() lanza 'sin sesión' en falso.
let authInFlight = null;   // promesa del login en curso, compartida entre llamadas concurrentes
async function ensureAuth() {
  if ((await fetch('/api/whoami')).ok) return true;
  // single-flight: el primer 403 abre el modal; los demás esperan ESA misma promesa en vez de
  // ver el overlay ya presente y resolver false ('sin sesión' en falso para sus POST)
  if (!authInFlight) {
    authInFlight = loginModal().finally(() => { authInFlight = null; });
  }
  return authInFlight;
}
function loginModal() {
  return new Promise(resolve => {
    if (document.getElementById('login-ov')) { resolve(false); return; }
    const ov = document.createElement('div');
    ov.id = 'login-ov';
    ov.className = 'login-ov';
    ov.innerHTML = `
      <form class="login-card" id="login-form">
        <div class="login-brand"><span class="mark">${icon('drone')}</span>
          <div><b>AeroBrain</b><span>Iniciar sesión</span></div></div>
        <label>Correo<input type="email" id="lg-user" autocomplete="username" value="reyesusma@hotmail.com" required></label>
        <label>Contraseña<input type="password" id="lg-pass" autocomplete="current-password" required autofocus></label>
        <div class="login-err" id="lg-err"></div>
        <button class="btn primary big" type="submit" id="lg-go">Entrar</button>
        <button class="btn" type="button" id="lg-cancel">Cancelar</button>
      </form>`;
    document.body.appendChild(ov);
    const done = ok => { ov.remove(); resolve(ok); };
    ov.querySelector('#lg-cancel').onclick = () => done(false);
    ov.addEventListener('click', e => { if (e.target === ov) done(false); });
    ov.querySelector('#login-form').onsubmit = async e => {
      e.preventDefault();
      const go = ov.querySelector('#lg-go'); go.textContent = 'Entrando…'; go.disabled = true;
      let r;
      try {
        r = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: ov.querySelector('#lg-user').value.trim(),
            password: ov.querySelector('#lg-pass').value }) });
      } catch {
        ov.querySelector('#lg-err').textContent = 'Sin conexión — revisa la red e intenta de nuevo.';
        go.textContent = 'Entrar'; go.disabled = false;
        return;
      }
      if (r.ok) return done(true);
      ov.querySelector('#lg-err').textContent = 'Correo o contraseña incorrectos.';
      go.textContent = 'Entrar'; go.disabled = false;
      ov.querySelector('#lg-pass').select();
    };
    setTimeout(() => ov.querySelector('#lg-pass').focus(), 50);
  });
}
// POST autenticado vía cookie de sesión; pide login solo si hace falta
async function api(path, body) {
  let r = await fetch(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (r.status === 403) {
    if (!await ensureAuth()) throw new Error('sin sesión');
    r = await fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  return r.json();
}
// compat: código viejo llama getToken() como gate — ahora solo asegura sesión
function getToken() { return 'session'; }
// migración: borra el token que versiones anteriores dejaron en localStorage
localStorage.removeItem('ab_token');
// limpia códigos ANSI/escape que ODM mete en el log
function cleanLog(t) {
  return String(t || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\^?\[\[[0-9;]*m/g, '').trim();
}
const KIND_META = {
  ingest: { ic: 'dl', name: 'Importar SD' },
  '3d': { ic: 'cube', name: 'Modelo 3D' },
  splat: { ic: 'layers', name: 'Gaussian Splat' },
  edit: { ic: 'film', name: 'Edición' },
  upload: { ic: 'dl', name: 'Subida' },
  analyze: { ic: 'spark', name: 'Análisis AI' },
  foto4k: { ic: 'iso', name: 'Foto 4K' },
};
// etapa humana a partir del log/detail de ODM
function humanStage(j) {
  const src = cleanLog(j.log) + ' ' + (j.detail || '');
  const M = [
    [/frames: \d+/, 'Extrayendo frames del video'],
    [/geotag|exiftool/i, 'Geoetiquetando con tu GPS'],
    [/feature|opensfm.*extract/i, 'Detectando características'],
    [/match/i, 'Emparejando imágenes'],
    [/reconstruct|bundle/i, 'Reconstruyendo cámaras 3D'],
    [/Densify|depthmap|openmvs/i, 'Densificando nube de puntos'],
    [/filterpoints/i, 'Filtrando nube de puntos'],
    [/meshing|PoissonRecon|dem2mesh/i, 'Generando malla 3D'],
    [/texturing|mvstex|texture/i, 'Texturizando el modelo'],
    [/dem|dsm|dtm|tiles\.tif|merged\.vrt/i, 'Calculando elevación (DSM)'],
    [/orthophoto/i, 'Generando ortofoto'],
    [/publicando|publish|gdal_translate.*ortho/i, 'Publicando assets web'],
    [/entrenando|Step \d+/i, 'Entrenando el splat'],
  ];
  for (const [re, label] of M) if (re.test(src)) return label;
  return j.detail || '';
}
function jobCard(j, flightsIdx, entering = true) {
  const meta = KIND_META[j.kind] || { ic: 'activity', name: j.kind };
  const f = flightsIdx?.[j.label];
  const title = `${meta.name} · ${f ? (esc(f.label) || fmt.date(f.date) + ' ' + f.time) : esc((j.label || '').length > 30 ? (j.label || '').slice(-14) : (j.label || 'trabajo'))}`;
  const stLabel = { running: 'procesando', queued: 'en cola', done: 'listo',
    error: 'falló', cancelled: 'cancelado', cancel_failed: 'cancel falló' }[j.status] || j.status;
  const pct = j.progress ? Math.round(j.progress * 100) : null;
  const eta = (j.status === 'running' && j.progress > 0.1 && j.mins > 0.5)
    ? Math.max(1, Math.round(j.mins / j.progress * (1 - j.progress))) : null;
  const lastLog = cleanLog((j.log || '').split('\n').pop());
  return `
  <div class="job-card${entering ? '' : ' upd'}" data-jid="${esc(j.id)}">
    <div class="jc-head">${icon(meta.ic)}<span class="jc-title">${title}</span>
      <span class="jc-status ${esc(j.status)}">${esc(stLabel)}${pct != null && j.status === 'running' ? ` ${pct}%` : ''}</span></div>
    ${j.status === 'running' ? `
      ${j.kind === '3d' ? (() => {
        const steps = [['frames', 'Frames'], ['odm', 'Fotogrametr\u00eda'], ['publish', 'Publicar']];
        const at = steps.findIndex(s => s[0] === j.stage);
        return `<div class="jc-steps">${steps.map(([, lb], i) =>
          `<span class="jc-step${i < at ? ' done' : i === at ? ' act' : ''}">${i < at ? '\u2713 ' : ''}${lb}</span>`).join('')}</div>`;
      })() : ''}
      <div class="jc-stage">${esc(humanStage(j))}</div>
      ${pct != null ? `<div class="jc-bar"><div style="width:${pct}%"></div></div>` : ''}
      <div class="jc-meta"><span>${j.mins ? j.mins + ' min transcurridos' : ''}</span>
        <span>${eta ? '~' + eta + ' min restantes' : ''}</span></div>
      ${lastLog ? `<div class="jc-log">${esc(lastLog)}</div>` : ''}` : ''}
    ${j.status === 'queued' ? `<div class="jc-stage">Esperando turno — el worker procesa un trabajo pesado a la vez.</div>` : ''}
    ${j.status === 'done' ? `<div class="jc-meta"><span>${esc(j.detail || '')}</span>
      ${j.kind === '3d' ? '<a href="tresd.html" style="color:var(--accent)">Ver en 3D →</a>' :
        j.kind === 'splat' ? '<a href="tresd.html" style="color:var(--accent)">Ver splat →</a>' :
        (j.artifact && j.artifact_exists !== false) ? `<a href="data/${esc(j.artifact)}" target="_blank" style="color:var(--accent)">Abrir →</a>` : ''}</div>` : ''}
    ${j.status === 'cancelled' || j.status === 'cancel_failed' ? `<div class="jc-meta"><span>${esc(j.detail || '')}</span></div>` : ''}
    ${j.status === 'error' ? `<details class="jc-err"><summary>${esc((j.detail || 'error').slice(0, 90))} — ver log</summary><pre>${esc(cleanLog(j.log) || 'sin log')}</pre></details>` : ''}
    ${['running', 'queued'].includes(j.status) && ['3d', 'splat'].includes(j.kind) ?
      `<div class="jc-actions"><button class="btn" style="padding:4px 11px;font-size:11px" data-cancel="${esc(j.id)}">Cancelar</button></div>` : ''}
  </div>`;
}
async function pollJobs(el, every = 2500, onDone = null) {
  let flightsIdx = null;
  try {
    const fl = await getFlights();
    flightsIdx = Object.fromEntries(fl.map(f => [f.clip_id, f]));
  } catch {}
  let busy = false;
  const prevStatus = {};   // detectar transición running/queued → done (hook onDone)
  const paint = async () => {
    if (busy) return;                                     // guard de overlap: polls lentos no se pisan (#44)
    busy = true;
    try {
      const res = await fetch('/api/jobs');
      if (res.status === 403) { el.innerHTML = '<p class="footer-note">Inicia sesión para ver trabajos.</p>'; return; }
      const { jobs = [] } = await res.json();             // respuesta sin jobs → [] (no crash) (#46)
      if (onDone) {
        for (const j of jobs) {
          if (j.status === 'done' && ['running', 'queued'].includes(prevStatus[j.id])) {
            try { onDone(j); } catch { /* el hook jamás rompe el poller */ }
          }
          prevStatus[j.id] = j.status;
        }
      }
      if (!jobs.length) { el.innerHTML = '<p class="footer-note">Sin trabajos aún.</p>'; return; }
      const active = jobs.filter(j => ['running', 'queued'].includes(j.status));
      const doneRecent = jobs.filter(j => !['running', 'queued'].includes(j.status)).slice(0, 3);
      const older = jobs.filter(j => !['running', 'queued'].includes(j.status)).slice(3);
      const list = [...active, ...doneRecent];
      const hash = j => [j.status, j.progress, j.mins, j.detail, j.stage, (j.log || '').slice(-80)].join('|');
      const ids = list.map(j => j.id).join(',') + '§' + older.map(j => j.id).join(',');   // identidades, no sólo el conteo
      if (el.dataset.ids !== ids) {
        // cambio estructural (job nuevo / cambio de zona): rebuild completo
        const wasOpen = el.querySelector('details.jobs-older')?.open;
        el.dataset.ids = ids;
        el.innerHTML =
          list.map(j => jobCard(j, flightsIdx)).join('') +
          (older.length ? `<details class="jobs-older"${wasOpen ? ' open' : ''}><summary>${older.length} trabajos anteriores</summary>
            ${older.map(j => jobCard(j, flightsIdx)).join('')}</details>` : '');
        [...list, ...older].forEach(j => { el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`)?.setAttribute('data-h', hash(j)); });
      } else {
        // mismos jobs: actualiza EN SITIO solo las tarjetas cuyo contenido cambió (incluye las 'older')
        [...list, ...older].forEach(j => {
          const node = el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`);
          if (!node || node.dataset.h === hash(j)) return;
          const tmp = document.createElement('div');
          tmp.innerHTML = jobCard(j, flightsIdx, false);
          const next = tmp.firstElementChild;
          next.dataset.h = hash(j);
          node.replaceWith(next);
        });
      }
    } catch {} finally { busy = false; }
  };
  paint();
  if (!el._pollBound) {                                   // listener idempotente (no lo dupliques por llamada) (#47)
    el._pollBound = true;
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-cancel]');
      if (c) api('/api/job_cancel', { id: c.dataset.cancel }).catch(() => {});   // no unhandled rejection (#68)
    });
  }
  clearInterval(el._pollTimer);                           // no acumules intervalos si se re-llama (#47)
  el._pollTimer = setInterval(paint, every);
  return el._pollTimer;
}

// tema: aplicar ANTES de pintar para evitar flash
document.documentElement.dataset.theme = localStorage.getItem('ab_theme') || 'dark';
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('ab_theme', t);
  document.querySelectorAll('.theme-lb').forEach(e => { e.textContent = t === 'light' ? 'Oscuro' : 'Claro'; });
}

document.addEventListener('click', async e => {
  if (e.target.closest('[data-theme-toggle]')) toggleTheme();
  if (e.target.closest('#auth-link')) {
    e.preventDefault();
    if ((await fetch('/api/whoami')).ok) { await fetch('/api/logout', { method: 'POST' }); alert('Sesión cerrada.'); }
    else await loginModal();
  }
});
function renderShell(active) {
  const cur = location.pathname.split('/').pop() || 'index.html';
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="index.html">
          <span class="mark">${icon('drone')}</span>
          <span><b>AeroBrain</b><span>Flight Intelligence</span></span>
        </a>
        ${NAV.map(n => `
          <a class="nav-item ${n.href === (active || cur) ? 'active' : ''}" href="${n.href}">
            ${icon(n.ic)}<span>${n.label}</span>
          </a>`).join('')}
        <button class="nav-item" data-theme-toggle>${icon('sun')}<span class="theme-lb">${document.documentElement.dataset.theme === 'light' ? 'Oscuro' : 'Claro'}</span></button>
        <div class="foot">
          <span class="foot-status"><span class="dot"></span>Mac Mini M4 · vault local</span>
          <div class="foot-btns">
            <a class="fbtn" href="guia.html">${icon('list')} Guía</a>
            <a class="fbtn" href="#" id="auth-link">${icon('iso')} Sesión</a>
          </div>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`);
  // rail móvil (≤820px, scroll-x): centra el tab ACTIVO al cargar — sin esto, en las tabs del
  // final (3D/Splat Lab/Sistema) la barra arranca mostrando Inicio y no ves dónde estás
  const bar = document.querySelector('.sidebar');
  const act = bar?.querySelector('.nav-item.active');
  if (bar && act && bar.scrollWidth > bar.clientWidth + 1) {
    bar.scrollLeft = act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2;
  }
  return document.getElementById('main');
}

const fmt = {
  // Math.floor en los segundos también (no Math.round) → nunca "0:60"/"1:60"; guard de NaN
  dur: s => {
    s = Math.max(0, Math.round(+s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  km: m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
  gb: b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`,
  date: d => {
    if (!d || typeof d !== 'string') return '';        // fmt.date(undefined) ya no tumba la página
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const [y, m, day] = d.split('-');
    return `${+day} ${M[+m - 1]} ${y}`;
  },
  hours: s => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`,
};

let _flights = null;
async function getFlights() {
  if (!_flights) {
    try {
      const r = await fetch(`${DATA}/manifest/flights.json`);
      _flights = (await r.json()).flights || [];        // manifest vacío/malo → [] (no undefined)
    } catch { return []; }                               // no cachea el fallo: reintentará
  }
  return _flights;
}
// AI viene embebido en flights.json (0 requests extra — clave en móvil)
async function getAI(cid) {
  // la página de detalle lee el JSON completo (director_notes, edit_suggestions…);
  // el embebido de flights.json es solo el resumen para las listas
  try {
    const r = await fetch(`${DATA}/ai/${encodeURIComponent(cid)}.json`);
    if (r.ok) return await r.json();
  } catch {}
  const fl = await getFlights();
  return fl.find(f => f.clip_id === cid)?.ai || null;
}
async function getAIAll(flights) {
  const out = {};
  flights.forEach(f => { out[f.clip_id] = f.ai || null; });
  return out;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// maxzoom 19 en el source: más allá, MapLibre sobre-escala la tile en vez de
// mostrar "Map data not available" (vuelos cortos fuerzan zoom 20+)
// satelite: maxzoom 17 — mas alla MapLibre ESCALA el tile (suave) en vez de
// pedir niveles que Esri no tiene en zonas rurales (tiles "not available");
// la ortofoto del dron va encima con su propia nitidez de todos modos
// paneles colapsables: click en el titulo (no en sus botones) pliega el cuerpo
document.addEventListener('click', e => {
  const ph = e.target.closest('.panel > .ph');
  if (!ph || e.target.closest('button, a, input, select, label, .seg, .chip')) return;
  const panel = ph.parentElement;
  const collapsed = panel.classList.contains('clpsd');
  const from = panel.offsetHeight;
  panel.classList.toggle('clpsd');
  const to = panel.offsetHeight;
  panel.style.overflow = 'hidden';
  panel.animate([{ height: from + 'px' }, { height: to + 'px' }],
                { duration: 230, easing: 'cubic-bezier(.25,.1,.25,1)' })
       .finished.then(() => { panel.style.overflow = ''; });
});

const SAT_STYLE = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Esri World Imagery' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const FIT_OPTS = { padding: 50, maxZoom: 17.5 };
const DARK_STYLE = {
  version: 8,
  sources: { c: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: 'CARTO · OSM' } },
  layers: [{ id: 'c', type: 'raster', source: 'c' }],
};
