// Vuelos: gallery with instant search (incl. AI tags), filters, sort, views.
const main = renderShell('index.html');
let flights = [], ai = {}, semRank = null, models = new Set();
let state = { q: '', tier: 'all', sort: 'date', scene: null, semantic: false, spot: null,
              view: localStorage.getItem('ab.vview') || 'grid' };

main.innerHTML = `
  <div class="page-head"><h1>Vuelos</h1><span class="count" id="count"></span></div>
  <div class="statgrid" id="stats">${'<div class="sk" style="height:74px"></div>'.repeat(4)}</div>
  <div class="toolbar">
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Buscar por fecha, lugar, tags AI…" autocomplete="off"><kbd>/</kbd></label>
    <button class="chip" id="sem-toggle" title="Búsqueda semántica AI (por significado)">${icon('spark')} Semántica</button>
    <select class="ctl" id="tier" aria-label="Filtrar por tier">
      <option value="all">Todos los tiers</option>
      <option value="full">Full — con video</option>
      <option value="standard">Standard</option>
      <option value="skim">Skim</option>
      <option value="archived">Archivados</option>
    </select>
    <select class="ctl" id="sort" aria-label="Ordenar">
      <option value="date">Más recientes</option>
      <option value="dur">Más largos</option>
      <option value="dist">Más distancia</option>
      <option value="alt">Más altura</option>
      <option value="score">Mejor score AI</option>
    </select>
    <div class="seg" role="group" aria-label="Vista">
      <button data-view="grid" class="on" title="Cuadrícula">${icon('grid')}</button>
      <button data-view="list" title="Lista">${icon('list')}</button>
      <button data-view="map" title="Mapa">${icon('map')}<span class="seg-lb">Mapa</span></button>
      <button data-view="places" title="Lugares">${icon('pin')}<span class="seg-lb">Lugares</span></button>
      <button data-view="dates" title="Fechas">${icon('cal')}<span class="seg-lb">Fechas</span></button>
    </div>
  </div>
  <div class="chips" id="scene-chips" style="margin-bottom:14px"></div>
  <div class="grid" id="grid">${'<div class="sk" style="aspect-ratio:16/11"></div>'.repeat(6)}</div>
  <div id="mapview" style="display:none">
    <div class="panel" style="position:relative">
      <div id="vmap" style="height:calc(100dvh - 330px);min-height:420px"></div>
      <button class="map-recenter" id="vm-fit" title="Ver todo">${icon('map')}</button>
    </div>
    <p class="footer-note" style="margin-top:10px">Los filtros y la búsqueda de arriba también
    filtran el mapa. Click en una ruta o pin de lugar para el preview.</p>
  </div>
  <p class="footer-note">Los clips en tier full incluyen video 1080p; standard tienen análisis AI sin proxy; skim solo telemetría. Procesado localmente en el Mac Mini M4.</p>`;

function stats(list) {
  const dist = list.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
  const dur = list.reduce((a, f) => a + f.duration_s, 0);
  const alt = Math.max(0, ...list.map(f => f.stats.max_rel_alt_m || 0));
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="lb">${icon('drone')} Vuelos</div><div class="v">${list.length}</div></div>
    <div class="stat"><div class="lb">${icon('route')} Distancia</div><div class="v">${fmt.km(dist)}</div></div>
    <div class="stat"><div class="lb">${icon('clock')} En el aire</div><div class="v">${fmt.hours(dur)}</div></div>
    <div class="stat"><div class="lb">${icon('mountain')} Alt máx</div><div class="v">${Math.round(alt)}<small> m</small></div></div>`;
}

const spotKey = f => f.stats?.home ? `${Math.round(f.stats.home[0] / 0.005)}:${Math.round(f.stats.home[1] / 0.005)}` : null;
function matches(f) {
  if (state.semantic && semRank) return semRank.has(f.clip_id);
  if (state.spot && spotKey(f) !== state.spot) return false;
  if (state.tier === 'archived') { if (!f.archived) return false; }
  else if (f.archived) return false;
  if (state.tier !== 'all' && state.tier !== 'archived' && f.tier !== state.tier) return false;
  if (state.scene && ai[f.clip_id]?.scene_type !== state.scene) return false;
  if (!state.q) return true;
  const a = ai[f.clip_id];
  const hay = [f.clip_id, f.date, f.time, f.label, a?.summary, a?.scene_type, ...(a?.tags || [])]
    .join(' ').toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}
const SORTS = {
  date: (a, b) => b.clip_id.localeCompare(a.clip_id),
  dur: (a, b) => b.duration_s - a.duration_s,
  dist: (a, b) => (b.stats.distance_m || 0) - (a.stats.distance_m || 0),
  alt: (a, b) => (b.stats.max_rel_alt_m || 0) - (a.stats.max_rel_alt_m || 0),
  score: (a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0),
};

function card(f) {
  const a = ai[f.clip_id];
  return `
  <a class="card" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
    <div class="thumb">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
      <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
      ${a?.travel_score != null ? `<span class="score-pill">${a.travel_score}/10</span>` : ''}
      <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
      <button class="rename-btn" data-rename="${f.clip_id}" title="Renombrar">${icon('tag')}</button>
    </div>
    <div class="body">
      <div class="t"><span>${esc(f.label) || fmt.date(f.date)}</span><time>${f.label ? fmt.date(f.date) + ' ' : ''}${f.time}</time></div>
      <div class="metrics">
        <span>${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b></span>
        <span>${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
        <span>${icon('film')}<b>${f.resolution.split('x')[1]}p${Math.round(f.fps)}</b></span>
      </div>
      ${a?.summary ? `<p class="ai-line">${esc(a.summary)}</p>` : ''}
    </div>
  </a>`;
}

function chipsRow() {
  const scenes = [...new Set(flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
  document.getElementById('scene-chips').innerHTML =
    (state.spot && spots[state.spot] ? `<button class="chip on" data-clearspot>✕ ${esc(spots[state.spot].name)}</button>` : '') +
    scenes.map(sc =>
      `<button class="chip ${state.scene === sc ? 'on' : ''}" data-scene="${esc(sc)}">${esc(sc)}</button>`).join('');
}

function render() {
  const list = flights.filter(matches).sort(
    state.semantic && semRank ? (a, b) => (semRank.get(b.clip_id) || 0) - (semRank.get(a.clip_id) || 0) : SORTS[state.sort]);
  document.getElementById('count').textContent =
    `${list.length} de ${flights.length}` + (state.q ? ` · "${state.q}"` : '');
  const grid = document.getElementById('grid');
  const mapv = document.getElementById('mapview');
  const isMap = state.view === 'map';
  grid.style.display = isMap ? 'none' : '';
  mapv.style.display = isMap ? '' : 'none';
  stats(list);
  chipsRow();
  if (isMap) { renderMap(list); return; }
  if (state.view === 'places') { renderPlaces(list); return; }
  if (state.view === 'dates') { renderDates(list); return; }
  grid.className = `grid ${state.view === 'list' ? 'list' : ''}`;
  grid.innerHTML = list.length ? list.map(card).join('') :
    `<div class="empty" style="grid-column:1/-1">${icon('search')}<p>Sin resultados para esa búsqueda.</p></div>`;
  grid.querySelectorAll('.card').forEach((c, i) => {
    c.style.animation = `cardIn 340ms cubic-bezier(.25,.1,.25,1) both ${Math.min(i * 35, 420)}ms`;
  });
  hoverScrub(grid);
}

// ---------- lugares: spots agrupados por punto de despegue (~500 m) ----------
let spots = {};
function buildSpots() {
  spots = {};
  flights.forEach(f => {
    const k = spotKey(f);
    if (!k) return;
    (spots[k] ??= { key: k, flights: [] }).flights.push(f);
  });
  Object.values(spots).forEach(sp => {
    sp.lng = sp.flights.reduce((a, f) => a + f.stats.home[0], 0) / sp.flights.length;
    sp.lat = sp.flights.reduce((a, f) => a + f.stats.home[1], 0) / sp.flights.length;
    sp.name = sp.flights.find(f => f.label)?.label || `Spot · ${fmt.date(sp.flights[0].date)}`;
  });
}

function renderPlaces(list) {
  const grid = document.getElementById('grid');
  const visible = Object.values(spots)
    .map(sp => ({ ...sp, flights: sp.flights.filter(f => list.includes(f)) }))
    .filter(sp => sp.flights.length)
    .sort((a, b) => b.flights.length - a.flights.length);
  grid.className = 'grid';
  grid.innerHTML = visible.length ? visible.map((sp, i) => {
    const fs = sp.flights;
    const dates = fs.map(f => f.date).sort();
    const dist = fs.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    const dur = fs.reduce((a, f) => a + f.duration_s, 0);
    const best = [...fs].sort((a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0))[0];
    return `
    <a class="card" data-spotcard="${esc(sp.key)}" style="animation:cardIn 340ms var(--ease) both ${i * 45}ms">
      <div class="thumb">
        <img src="${DATA}/thumbs/${esc(best.clip_id)}.jpg" alt="" loading="lazy" width="960" height="540">
        <span class="ovl mono">${fs.length} ${fs.length === 1 ? 'vuelo' : 'vuelos'}</span>
      </div>
      <div class="body">
        <div class="t"><span>${esc(sp.name)}</span>
          <time>${fmt.date(dates[0])}${dates.length > 1 ? ' – ' + fmt.date(dates[dates.length - 1]) : ''}</time></div>
        <div class="metrics">
          <span>${icon('route')}<b>${fmt.km(dist)}</b></span>
          <span>${icon('clock')}<b>${fmt.hours(dur)}</b></span>
          <span>${icon('mountain')}<b>${Math.round(Math.max(...fs.map(f => f.stats.max_rel_alt_m || 0)))} m</b></span>
        </div>
      </div>
    </a>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">${icon('pin')}<p>Sin lugares con esos filtros.</p></div>`;
}

// ---------- fechas: cronología agrupada por mes ----------
function renderDates(list) {
  const grid = document.getElementById('grid');
  const groups = {};
  list.forEach(f => { (groups[(f.date || 'sin-fecha').slice(0, 7)] ??= []).push(f); });
  const months = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  grid.className = 'grid list';
  grid.innerHTML = months.length ? months.map(([m, fs]) => {
    const name = new Date(m + '-15').toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const dist = fs.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    const dur = fs.reduce((a, f) => a + f.duration_s, 0);
    return `<div class="month-head" style="grid-column:1/-1">
      <b>${esc(name.charAt(0).toUpperCase() + name.slice(1))}</b>
      <span class="mono">${fs.length} vuelos · ${fmt.km(dist)} · ${fmt.hours(dur)}</span></div>` +
      fs.map(card).join('');
  }).join('') : `<div class="empty" style="grid-column:1/-1">${icon('cal')}<p>Sin vuelos con esos filtros.</p></div>`;
  hoverScrub(grid);
}
document.addEventListener('click', async e => {
  const sc = e.target.closest('[data-scene]');
  if (sc) { state.scene = state.scene === sc.dataset.scene ? null : sc.dataset.scene; render(); }
  const spc = e.target.closest('[data-spotcard]');
  if (spc) { e.preventDefault(); state.spot = spc.dataset.spotcard; setView('grid'); }
  if (e.target.closest('[data-clearspot]')) { state.spot = null; render(); }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    e.preventDefault(); e.stopPropagation();
    const token = getToken();
    if (!token) return;
    const f = flights.find(x => x.clip_id === rn.dataset.rename);
    const label = prompt('Nombre para este vuelo:', f?.label || '');
    if (label == null) return;
    await api('/api/clip', { clip_id: rn.dataset.rename, label });
    f.label = label; render();
  }
}, true);

// ---------- vista mapa: rutas + pins de lugar, filtrados por la barra de arriba ----------
let vmap = null, vmapLoaded = false;
const spotPills = {};
function renderMap(list) {
  const ids = list.map(f => f.clip_id);
  if (!vmap) {
    const withBox = flights.filter(f => f.stats?.bbox);
    const bounds = new maplibregl.LngLatBounds();
    withBox.forEach(f => { bounds.extend([f.stats.bbox[0], f.stats.bbox[1]]); bounds.extend([f.stats.bbox[2], f.stats.bbox[3]]); });
    vmap = new maplibregl.Map({ container: 'vmap', style: SAT_STYLE, bounds,
                                fitBoundsOptions: { padding: 60 }, attributionControl: { compact: true } });
    vmap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    new ResizeObserver(() => vmap.resize()).observe(document.getElementById('vmap'));
    document.getElementById('vm-fit').addEventListener('click', () => {
      state.spot = null;
      render();
      vmap.fitBounds(bounds, { padding: 60, duration: 1200 });
    });
    vmap.on('load', () => {
      fetch(`${DATA}/manifest/routes.json`).then(r => r.json()).then(({ routes }) => {
        const features = routes.map(r => ({ type: 'Feature', properties: { cid: r.cid },
                                            geometry: { type: 'LineString', coordinates: r.line } }));
        vmap.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        vmap.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 6, 'line-opacity': 0.18 } });
        vmap.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 1.8, 'line-opacity': 0.9 } });
        vmap.on('click', 'routes', e => {
          const f = flights.find(x => x.clip_id === e.features[0].properties.cid);
          if (f) openPreview(f);
        });
        vmap.on('mouseenter', 'routes', () => { vmap.getCanvas().style.cursor = 'pointer'; });
        vmap.on('mouseleave', 'routes', () => { vmap.getCanvas().style.cursor = ''; });
        vmapLoaded = true;
        applyMapFilter(flights.filter(matches).map(f => f.clip_id));
      });
      Object.values(spots).forEach(sp => {
        const el = document.createElement('button');
        el.className = 'spot-pill';
        el.innerHTML = `${icon('drone')} ${esc(sp.name.length > 18 ? sp.name.slice(0, 17) + '…' : sp.name)}
          ${sp.flights.length > 1 ? `<b>${sp.flights.length}</b>` : ''}`;
        el.addEventListener('click', () => {
          state.spot = state.spot === sp.key ? null : sp.key;
          render();
          if (state.spot) vmap.flyTo({ center: [sp.lng, sp.lat], zoom: 15.5, speed: 1.3, curve: 1.5 });
        });
        spotPills[sp.key] = el;
        new maplibregl.Marker({ element: el }).setLngLat([sp.lng, sp.lat]).addTo(vmap);
      });
    });
  }
  vmap.resize();
  if (vmapLoaded) applyMapFilter(ids);
  Object.entries(spotPills).forEach(([k, el]) => {
    el.classList.toggle('on', k === state.spot);
    el.style.display = spots[k].flights.some(f => ids.includes(f.clip_id)) ? '' : 'none';
  });
}
function applyMapFilter(ids) {
  ['routes', 'routes-glow'].forEach(l => {
    if (vmap.getLayer(l)) vmap.setFilter(l, ['in', 'cid', ...ids]);
  });
}

// ---------- preview modal (vista mapa) ----------
function openPreview(f) {
  const a = ai[f.clip_id];
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" style="max-width:640px">
    <div class="modal-h"><b>${icon('drone')} ${esc(f.label) || fmt.date(f.date) + ' · ' + (f.time || '')}</b>
      <button class="modal-x" aria-label="Cerrar">✕</button></div>
    <div class="modal-b">
      ${f.has_proxy
        ? `<video class="m-prev" style="max-height:320px" src="${DATA}/proxies/${esc(f.clip_id)}.mp4" controls muted playsinline preload="metadata"></video>`
        : `<img src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" style="width:100%;border-radius:10px" alt="">`}
      <div class="tool-row" style="margin-top:12px">
        <span class="chip">${fmt.dur(f.duration_s)}</span>
        <span class="chip">${Math.round(f.stats.max_rel_alt_m || 0)} m alt</span>
        <span class="chip">${fmt.km(f.stats.distance_m || 0)}</span>
        ${models.has(f.clip_id) ? `<span class="chip on">3D</span>` : ''}
      </div>
      ${a?.summary ? `<p class="footer-note" style="margin:10px 0 0">${esc(a.summary)}</p>` : ''}
      <div class="navrow" style="margin-top:14px;flex-wrap:wrap">
        <a class="btn primary" href="flight.html?id=${encodeURIComponent(f.clip_id)}">${icon('film')} Ver vuelo completo</a>
        ${models.has(f.clip_id) ? `<a class="btn" href="tresd.html">${icon('cube')} Modelo 3D</a>` : ''}
      </div>
    </div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('.modal-x')) { ov.querySelector('video')?.pause(); ov.remove(); }
  });
}

// hover sobre la card = scrub por los keyframes del clip
function hoverScrub(grid) {
  grid.querySelectorAll('.card').forEach(c => {
    const n = +c.dataset.frames;
    if (!n) return;
    const img = c.querySelector('img');
    const orig = img.src;
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      const i = Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * n));
      img.src = `${DATA}/frames/${c.dataset.cid}/f_${String(i).padStart(4, '0')}.jpg`;
    });
    c.addEventListener('mouseleave', () => { img.src = orig; });
  });
}

const qEl = document.getElementById('q');
qEl.addEventListener('input', e => { state.q = e.target.value; if (!state.semantic) render(); });
qEl.addEventListener('keydown', async e => {
  if (e.key === 'Enter' && state.semantic && state.q.trim()) {
    qEl.blur();
    document.getElementById('count').textContent = 'buscando por significado…';
    try {
      const { results, error } = await api('/api/search', { q: state.q.trim() });
      if (error) { document.getElementById('count').textContent = 'error: ' + error; return; }
      semRank = new Map(results.map((r, i) => [r.clip_id, results.length - i]));
      render();
    } catch (err) { document.getElementById('count').textContent = 'sin sesión para búsqueda AI'; }
  }
});
document.getElementById('sem-toggle').addEventListener('click', () => {
  state.semantic = !state.semantic;
  document.getElementById('sem-toggle').classList.toggle('on', state.semantic);
  qEl.placeholder = state.semantic ? 'Describe lo que buscas y pulsa Enter…' : 'Buscar por fecha, lugar, tags AI…';
  if (!state.semantic) { semRank = null; }
  render();
});
document.getElementById('tier').addEventListener('change', e => { state.tier = e.target.value; render(); });
document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
document.querySelectorAll('[data-view]').forEach(b =>
  b.addEventListener('click', () => setView(b.dataset.view)));
function setView(v) {
  state.view = v;
  localStorage.setItem('ab.vview', v);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  render();
}
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault(); document.getElementById('q').focus();
  }
});

(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) { state.q = params.get('q'); document.getElementById('q').value = state.q; }
  if (['grid', 'list', 'map', 'places', 'dates'].includes(params.get('v'))) state.view = params.get('v');
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  flights = await getFlights();
  buildSpots();
  render();                       // pinta ya con manifests
  fetch(`${DATA}/manifest/system.json`).then(r => r.json())
    .then(sy => { models = new Set((sy.models || []).map(m => m.clip_id)); }).catch(() => {});
  ai = await getAIAll(flights);   // enriquece con AI cuando llegue
  render();
})().catch(e => {
  main.querySelector('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('warn')}<p>Error: ${esc(e.message)}</p></div>`;
});
