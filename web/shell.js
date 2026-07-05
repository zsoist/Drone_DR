// App shell: sidebar nav, shared formatters, data access. Requires icons.js.
const DATA = 'data';

const NAV = [
  { href: 'index.html', ic: 'grid', label: 'Vuelos' },
  { href: 'map.html', ic: 'map', label: 'Mapa' },
  { href: 'trips.html', ic: 'pin', label: 'Viajes' },
  { href: 'studio.html', ic: 'film', label: 'Studio' },
  { href: 'tresd.html', ic: 'cube', label: '3D' },
  { href: 'subir.html', ic: 'dl', label: 'Subir' },
  { href: 'system.html', ic: 'db', label: 'Sistema' },
];

// escape HTML: TODO texto de usuario/LLM pasa por aquí antes de innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// sesión de operador: cookie HttpOnly (el token NUNCA se guarda en el navegador)
async function ensureAuth() {
  if ((await fetch('/api/whoami')).ok) return true;
  for (let i = 0; i < 3; i++) {
    const t = prompt('Token de operador (está en drone-vault/.token):');
    if (t == null) return false;
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t.trim() }) });
    if (r.ok) return true;
    alert('Token inválido.');
  }
  return false;
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
async function pollJobs(el, every = 2500) {
  const paint = async () => {
    try {
      const { jobs } = await (await fetch('/api/jobs')).json();
      el.innerHTML = jobs.length ? jobs.map(j => `
        <div class="hl-item">
          <span class="tc" style="${j.status === 'error' ? 'color:var(--red);background:rgba(217,106,106,.12)' :
            j.status === 'done' ? 'color:var(--mint);background:rgba(82,199,154,.12)' : ''}">${esc(j.status)}</span>
          <p><b>${esc(j.kind)}</b> · ${esc(j.label)} <span class="mono" style="color:var(--text-3)">${esc(j.ts)}${j.mins ? ` · ${j.mins} min` : ''}</span>
          ${j.detail ? `<br><span class="mono" style="font-size:11px;color:var(--text-3)">${esc(j.detail)}</span>` : ''}</p>
          ${j.status === 'running' && ['3d', 'splat'].includes(j.kind) ?
            `<button class="btn" style="padding:3px 9px;font-size:11px" onclick="api('/api/job_cancel',{id:'${esc(j.id)}'})">Cancelar</button>` : ''}
        </div>`).join('') :
        `<p class="footer-note">Sin trabajos aún.</p>`;
    } catch {}
  };
  paint();
  return setInterval(paint, every);
}

// tema: aplicar ANTES de pintar para evitar flash
document.documentElement.dataset.theme = localStorage.getItem('ab_theme') || 'dark';
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('ab_theme', t);
  document.querySelectorAll('.theme-lb').forEach(e => { e.textContent = t === 'light' ? 'Oscuro' : 'Claro'; });
}

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
        <button class="nav-item" onclick="toggleTheme()">${icon('sun')}<span class="theme-lb">${document.documentElement.dataset.theme === 'light' ? 'Oscuro' : 'Claro'}</span></button>
        <div class="foot"><span class="dot"></span>Mac Mini M4 · vault local · $0/mes<br>
          <a href="guia.html" style="color:var(--accent)">Guía de operación</a></div>
      </aside>
      <main class="main" id="main"></main>
    </div>`);
  return document.getElementById('main');
}

const fmt = {
  dur: s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`,
  km: m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
  gb: b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`,
  date: d => {
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const [y, m, day] = d.split('-');
    return `${+day} ${M[+m - 1]} ${y}`;
  },
  hours: s => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`,
};

let _flights = null;
async function getFlights() {
  if (!_flights) {
    const r = await fetch(`${DATA}/manifest/flights.json`);
    _flights = (await r.json()).flights;
  }
  return _flights;
}
// AI viene embebido en flights.json (0 requests extra — clave en móvil)
async function getAI(cid) {
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
const SAT_STYLE = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Esri World Imagery' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const FIT_OPTS = { padding: 50, maxZoom: 17.5 };
const DARK_STYLE = {
  version: 8,
  sources: { c: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: 'CARTO · OSM' } },
  layers: [{ id: 'c', type: 'raster', source: 'c' }],
};
