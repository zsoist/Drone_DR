// Vuelos: gallery with instant search (incl. AI tags), filters, sort, views.
const main = renderShell('index.html');
let flights = [], ai = {}, semRank = null, models = new Set();
let state = { q: '', tier: 'all', sort: 'date', scene: null, semantic: false, spot: null, has: new Set(),
              view: localStorage.getItem('ab.vview') || 'grid' };

main.innerHTML = `
  <div class="page-head"><h1>Vuelos</h1><span class="count" id="count"></span></div>
  <div class="glass tbcard tb2">
    <div class="tb-row">
      <label class="search" data-tip="Busca por fecha, lugar o cualquier tag del análisis AI">${icon('search')}<input id="q" type="search" placeholder="Buscar por fecha, lugar, tags AI…" autocomplete="off"><kbd>/</kbd></label>
      <button class="chip" id="sem-toggle" data-tip="Busca por significado con embeddings — escribe y pulsa Enter">${icon('spark')} Semántica</button>
      <span class="spacer" style="flex:1"></span>
      <label class="eb-field"><span>Tier</span>
      <select class="ctl" id="tier" aria-label="Filtrar por tier">
        <option value="all">Todos</option>
        <option value="full">Full — con video</option>
        <option value="standard">Standard</option>
        <option value="skim">Skim</option>
        <option value="archived">Archivados</option>
      </select></label>
      <label class="eb-field"><span>Orden</span>
      <select class="ctl" id="sort" aria-label="Ordenar">
        <option value="date">Más recientes</option>
        <option value="dur">Más largos</option>
        <option value="dist">Más distancia</option>
        <option value="alt">Más altura</option>
        <option value="score">Mejor score AI</option>
      </select></label>
    </div>
    <div class="tb-div"></div>
    <div class="tb-row">
      <span class="tb-lb">Filtros</span>
      <button class="chip" data-qf="video" data-tip="Solo clips con streaming">${icon('play')} Video</button>
      <button class="chip" data-qf="model" data-tip="Con modelo 3D procesado">${icon('cube')} 3D</button>
      <button class="chip" data-qf="ai" data-tip="Con análisis AI">${icon('spark')} AI</button>
      <button class="chip" data-qf="alto" data-tip="Altura máxima sobre 100 m">${icon('mountain')} +100 m</button>
      <button class="chip" data-qf="4k60" data-tip="4K a 60 cuadros">${icon('film')} 4K60</button>
      <button class="chip" data-qf="largo" data-tip="Duración sobre 1 minuto">${icon('clock')} +1 min</button>
      <button class="chip" data-qf="top" data-tip="Score AI de 6 o más">${icon('spark')} Score 6+</button>
      <span class="spacer" style="flex:1"></span>
      <span class="tb-lb">Vista</span>
      <div class="seg" role="group" aria-label="Vista">
      <button data-view="grid" class="on" data-tip="Cuadrícula">${icon('grid')}</button>
      <button data-view="list" data-tip="Lista compacta">${icon('list')}</button>
      <button data-view="map" data-tip="Rutas en el mapa">${icon('map')}<span class="seg-lb">Mapa</span></button>
      <button data-view="places" data-tip="Agrupados por lugar de despegue">${icon('pin')}<span class="seg-lb">Lugares</span></button>
      <button data-view="dates" data-tip="Agrupados por fecha">${icon('cal')}<span class="seg-lb">Fechas</span></button>
      </div>
    </div>
    <div class="chips tb-scenes" id="scene-chips"></div>
  </div>
  <div class="grid" id="grid">${'<div class="sk" style="aspect-ratio:16/11"></div>'.repeat(6)}</div>
  <div id="mapview" style="display:none">
    <div class="panel" style="position:relative">
      <div class="tool-row" style="padding:10px 14px;border-bottom:1px solid var(--line)">
        <span class="tool-lb">Color</span>
        <button class="chip on" data-mc="uni">Ruta</button>
        <button class="chip" data-mc="alt">Altura</button>
        <button class="chip" data-mc="year">Año</button>
      </div>
      <div id="vmap" style="height:calc(100dvh - 380px);min-height:400px"></div>
      <button class="map-recenter" id="vm-fit" title="Ver todo">${icon('map')}</button>
    </div>
    <p class="footer-note" style="margin-top:10px">Los filtros y la búsqueda de arriba también
    filtran el mapa. Click en una ruta o pin de lugar para el preview.</p>
  </div>
  <p class="footer-note">Los clips en tier full incluyen video 1080p; standard tienen análisis AI sin proxy; skim solo telemetría. Procesado localmente en el Mac Mini M4.</p>`;

function setHTML(el, html) {
  if (el.__h === html) return;
  el.__h = html;
  el.innerHTML = html;
}


const spotKey = f => f.stats?.home ? `${Math.round(f.stats.home[0] / 0.005)}:${Math.round(f.stats.home[1] / 0.005)}` : null;
function matches(f) {
  if (state.semantic && semRank) return semRank.has(f.clip_id) && (!f.archived || state.tier === 'archived');   // la semántica no resucita archivados
  if (state.spot && spotKey(f) !== state.spot) return false;
  if (state.has.has('video') && !f.has_proxy) return false;
  if (state.has.has('model') && !models.has(f.clip_id)) return false;
  if (state.has.has('ai') && !ai[f.clip_id]) return false;
  if (state.has.has('alto') && (f.stats.max_rel_alt_m || 0) < 100) return false;
  if (state.has.has('4k60') && !(f.resolution === '3840x2160' && f.fps > 45)) return false;
  if (state.has.has('largo') && f.duration_s < 60) return false;
  if (state.has.has('top') && (ai[f.clip_id]?.travel_score || 0) < 6) return false;
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
  <a class="card scrub" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
    <div class="thumb">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
      <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
      ${a?.travel_score != null ? `<span class="score-pill">${a.travel_score}/10</span>` : ''}
      <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
      ${f.has_proxy ? `<span class="play-badge" data-tip="Ver vuelo con streaming">${icon('play')}</span>` : ''}
      <span class="scrub-line"></span>
      <button class="rename-btn" data-rename="${f.clip_id}" title="Renombrar">${icon('tag')}</button>
    </div>
    <div class="body">
      <div class="t"><span>${esc(f.label) || fmt.date(f.date)}</span><time>${f.label ? fmt.date(f.date) + ' ' : ''}${f.time}</time></div>
      <div class="metrics">
        <span>${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b></span>
        <span>${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
        <span>${icon('film')}<b>${(f.resolution || '').split('x')[1] || '?'}p${Math.round(f.fps || 0)}</b></span>
      </div>
      ${a?.summary ? `<p class="ai-line">${esc(a.summary)}</p>` : ''}
    </div>
  </a>`;
}

function chipsRow() {
  const scenes = [...new Set(flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
  setHTML(document.getElementById('scene-chips'),
    (state.spot && spots[state.spot] ? `<button class="chip on" data-clearspot>✕ ${esc(spots[state.spot].name)}</button>` : '') +
    scenes.map(sc =>
      `<button class="chip ${state.scene === sc ? 'on' : ''}" data-scene="${esc(sc)}">${esc(sc)}</button>`).join(''));
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
  chipsRow();
  if (isMap) { renderMap(list); return; }
  if (state.view === 'places') { renderPlaces(list); return; }
  if (state.view === 'dates') { renderDates(list); return; }
  grid.className = `grid ${state.view === 'list' ? 'list' : ''}`;
  grid.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  grid.innerHTML = list.length ? list.map(card).join('') :
    `<div class="empty" style="grid-column:1/-1">${icon('search')}<p>Sin resultados para esa búsqueda.</p></div>`;
  grid.querySelectorAll('.card').forEach((c, i) => {
    c.style.animation = `cardIn 340ms cubic-bezier(.25,.1,.25,1) both ${Math.min(i * 35, 420)}ms`;
  });
  attachScrub(grid);
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
  attachScrub(grid);
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
    try {                                                 // api() puede rechazar (403/red) → no dejar unhandled (#7)
      await api('/api/clip', { clip_id: rn.dataset.rename, label });
      if (f) { f.label = label; render(); }
    } catch { alert('No se pudo renombrar — revisa tu sesión.'); }
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
    // sin ningún bbox, un LngLatBounds vacío hace throw en el constructor y en fitBounds (#2):
    // arranca el mapa centrado por defecto y no intenta encuadrar la nada
    const hasBounds = withBox.length > 0;
    const opts = { container: 'vmap', style: SAT_STYLE, attributionControl: { compact: true } };
    if (hasBounds) { opts.bounds = bounds; opts.fitBoundsOptions = { padding: 60 }; }
    else { opts.center = [-74.08, 4.65]; opts.zoom = 9; }   // Bogotá por defecto
    vmap = new maplibregl.Map(opts);
    vmap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    new ResizeObserver(() => vmap.resize()).observe(document.getElementById('vmap'));
    document.getElementById('vm-fit').addEventListener('click', () => {
      state.spot = null;
      render();
      if (hasBounds) vmap.fitBounds(bounds, { padding: 60, duration: 1200 });
    });
    vmap.on('load', () => {
      fetch(`${DATA}/manifest/routes.json`).then(r => r.json()).then(({ routes }) => {
        const byId = Object.fromEntries(flights.map(f => [f.clip_id, f]));
        const features = routes.map(r => ({ type: 'Feature',
          properties: { cid: r.cid,
                        alt: Math.round(byId[r.cid]?.stats?.max_rel_alt_m || 0),
                        year: (byId[r.cid]?.date || '').slice(0, 4) },
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
  if (!renderMap._colorWired) {
    renderMap._colorWired = true;
    const COLORS = {
      uni: '#45A0E6',
      alt: ['interpolate', ['linear'], ['get', 'alt'],
            0, '#45A0E6', 80, '#52C79A', 150, '#E0A458', 260, '#D96A6A'],
      year: ['match', ['get', 'year'], '2025', '#E0A458', '2026', '#45A0E6', '#8A97A8'],
    };
    document.querySelectorAll('[data-mc]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-mc]').forEach(x => x.classList.toggle('on', x === b));
      if (vmap.getLayer('routes')) vmap.setPaintProperty('routes', 'line-color', COLORS[b.dataset.mc]);
      if (vmap.getLayer('routes-glow')) vmap.setPaintProperty('routes-glow', 'line-color', COLORS[b.dataset.mc]);
    }));
  }
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
        ? `<video class="m-prev" style="max-height:320px" src="${DATA}/proxies/${esc(f.clip_id)}.mp4" poster="${DATA}/thumbs/${esc(f.clip_id)}.jpg" controls muted playsinline preload="none"></video>`
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

const qEl = document.getElementById('q');
qEl.addEventListener('input', e => { state.q = e.target.value; if (!state.semantic) render(); });
let semSeq = 0;
qEl.addEventListener('keydown', async e => {
  if (e.key === 'Enter' && state.semantic && state.q.trim()) {
    qEl.blur();
    const mySeq = ++semSeq;                              // token: respuestas fuera de orden no pisan (#6)
    document.getElementById('count').textContent = 'buscando por significado…';
    try {
      const { results, error } = await api('/api/search', { q: state.q.trim() });
      if (mySeq !== semSeq) return;                      // llegó una búsqueda más nueva → descarta esta
      if (error) { document.getElementById('count').textContent = 'error: ' + error; return; }
      semRank = new Map(results.map((r, i) => [r.clip_id, results.length - i]));
      render();
    } catch (err) { if (mySeq === semSeq) document.getElementById('count').textContent = 'sin sesión para búsqueda AI'; }
  }
});
document.getElementById('sem-toggle').addEventListener('click', () => {
  state.semantic = !state.semantic;
  document.getElementById('sem-toggle').classList.toggle('on', state.semantic);
  qEl.placeholder = state.semantic ? 'Describe lo que buscas y pulsa Enter…' : 'Buscar por fecha, lugar, tags AI…';
  if (!state.semantic) { semRank = null; }
  render();
});
document.querySelectorAll('[data-qf]').forEach(b => b.addEventListener('click', () => {
  b.classList.toggle('on');
  state.has.has(b.dataset.qf) ? state.has.delete(b.dataset.qf) : state.has.add(b.dataset.qf);
  render();
}));
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
