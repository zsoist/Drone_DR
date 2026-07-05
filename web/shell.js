// App shell: sidebar nav, shared formatters, data access. Requires icons.js.
const DATA = 'data';

const NAV = [
  { href: 'index.html', ic: 'grid', label: 'Vuelos' },
  { href: 'map.html', ic: 'map', label: 'Mapa' },
  { href: 'trips.html', ic: 'pin', label: 'Viajes' },
  { href: 'studio.html', ic: 'film', label: 'Studio' },
  { href: 'system.html', ic: 'db', label: 'Sistema' },
];

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
        <div class="foot"><span class="dot"></span>Mac Mini M4 · vault local · $0/mes</div>
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
async function getAI(cid) {
  try {
    const r = await fetch(`${DATA}/ai/${cid}.json`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function getAIAll(flights) {
  const out = {};
  await Promise.all(flights.map(async f => { out[f.clip_id] = await getAI(f.clip_id); }));
  return out;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const SAT_STYLE = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri World Imagery' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const DARK_STYLE = {
  version: 8,
  sources: { c: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: 'CARTO · OSM' } },
  layers: [{ id: 'c', type: 'raster', source: 'c' }],
};
