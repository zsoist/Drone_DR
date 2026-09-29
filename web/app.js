// Vuelos: gallery with instant search (incl. AI tags), filters, sort, views.
const main = renderShell('index.html');
let flights = [], ai = {}, semRank = null, models = new Set();
let state = { q: '', tier: 'all', sort: 'date', scene: null, semantic: false, spot: null, has: new Set(),
              view: localStorage.getItem('ab.vview') || 'grid' };

const TIERS = [['all', 'Todos'], ['full', 'Full'], ['standard', 'Standard'], ['skim', 'Skim'], ['archived', 'Archivados']];
const TIER_TIPS = { all: 'Todos los tiers', full: 'Con video y análisis AI', standard: 'Análisis AI sin proxy', skim: 'Solo telemetría', archived: 'Vuelos archivados' };

main.classList.add('vf-page');
main.innerHTML = `
  ${pageHead('Vuelos', '', '', { subId: 'count' })}
  <div class="vf-bar" role="search">
    <label class="search vf-search">${icon('search')}<input id="q" type="search" placeholder="Buscar vuelos" aria-label="Buscar vuelos" autocomplete="off">
      <button type="button" class="vf-sem hit44" id="sem-toggle" aria-pressed="false" aria-label="Búsqueda semántica" data-tip="Semántica: busca por significado con embeddings — escribe y pulsa Enter">${icon('spark')}</button>
      <kbd>/</kbd></label>
    <button type="button" class="btn vf-filters-btn" id="vf-filters-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="vf-more">${icon('sliders')} Filtros <span class="vf-badge" id="vf-badge" hidden></span></button>
    <div class="vf-more" id="vf-more">
      <div class="vf-tools">
        <div class="vf-fld"><span class="tool-lb vf-lb">Ordenar por</span>
        <select class="ctl" id="sort" aria-label="Ordenar">
          <option value="date">Más recientes</option>
          <option value="dur">Más largos</option>
          <option value="dist">Más distancia</option>
          <option value="alt">Más altura</option>
          <option value="score">Mejor score AI</option>
        </select></div>
        <div class="vf-fld"><span class="tool-lb vf-lb">Vista</span>
        <div class="seg" role="group" aria-label="Vista">
          <button data-view="grid" class="on" data-tip="Cuadrícula" aria-label="Vista de cuadrícula">${icon('grid')}<span class="seg-lb">Cuadrícula</span></button>
          <button data-view="list" data-tip="Lista compacta" aria-label="Vista de lista">${icon('list')}<span class="seg-lb">Lista</span></button>
        </div></div>
        <div class="vf-fld"><span class="tool-lb vf-lb">Explorar por</span>
        <div class="seg vf-explore" role="group" aria-label="Explorar por">
          <button data-view="map" data-tip="Rutas en el mapa" aria-label="Explorar en el mapa">${icon('map')}<span class="seg-lb">Mapa</span></button>
          <button data-view="places" data-tip="Agrupados por lugar de despegue" aria-label="Agrupar por lugares">${icon('pin')}<span class="seg-lb">Lugares</span></button>
          <button data-view="dates" data-tip="Agrupados por fecha" aria-label="Agrupar por fechas">${icon('cal')}<span class="seg-lb">Fechas</span></button>
        </div></div>
      </div>
      <div class="vf-fld vf-fld-chips"><span class="tool-lb vf-lb">Filtrar</span>
      <div class="chip-row vf-chips" role="toolbar" aria-label="Filtros">
        ${TIERS.map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-tier="${k}" aria-pressed="${k === 'all'}" data-tip="${TIER_TIPS[k]}">${l}</button>`).join('')}
        <span class="chip-div" aria-hidden="true"></span>
        <button class="chip" data-qf="video" aria-pressed="false" data-tip="Solo clips con streaming">${icon('play')} Video</button>
        <button class="chip" data-qf="model" aria-pressed="false" data-tip="Con modelo 3D procesado">${icon('cube')} 3D</button>
        <button class="chip" data-qf="ai" aria-pressed="false" data-tip="Con análisis AI">${icon('spark')} AI</button>
        <button class="chip" data-qf="alto" aria-pressed="false" data-tip="Altura máxima sobre 100 m">${icon('mountain')} +100 m</button>
        <button class="chip" data-qf="4k60" aria-pressed="false" data-tip="4K a 60 cuadros">${icon('film')} 4K60</button>
        <button class="chip" data-qf="largo" aria-pressed="false" data-tip="Duración sobre 1 minuto">${icon('clock')} +1 min</button>
        <button class="chip" data-qf="top" aria-pressed="false" data-tip="Score AI de 6 o más">${icon('spark')} Score 6+</button>
        <span class="vf-scenes" id="scene-chips"></span>
      </div></div>
    </div>
  </div>
  <div class="grid" id="grid">${'<div class="sk vf-sk"></div>'.repeat(6)}</div>
  <div id="mapview" hidden>
    <div class="panel vf-mappanel">
      <div class="tool-row vf-maptools">
        <span class="tool-lb">Color</span>
        <button class="chip on" data-mc="uni">Ruta</button>
        <button class="chip" data-mc="alt">Altura</button>
        <button class="chip" data-mc="year">Año</button>
      </div>
      <div id="vmap" class="vf-map"></div>
      <button class="map-recenter" id="vm-fit" title="Ver todo" aria-label="Ver todos los vuelos">${icon('map')}</button>
    </div>
    <p class="page-foot vf-note">Los filtros y la búsqueda de arriba también filtran el mapa. Toca una ruta o un pin de lugar para ver el preview.</p>
  </div>
  <footer class="page-foot" id="vf-foot">Los clips en tier full incluyen video 1080p; standard tienen análisis AI sin proxy; skim solo telemetría. Procesado localmente en el Mac Mini M4.</footer>`;

function setHTML(el, html) {
  if (el.__h === html) return false;
  el.__h = html;
  el.innerHTML = html;
  return true;
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

// Título corto: etiqueta manual > arranque del resumen AI (sin muletilla "El vuelo inicia con…") > fecha.
const flightTitle = (f, a) => f.label || shortTitle(a?.summary) || `Sin título${f.time ? ' · ' + f.time : ''}`;
// Altura relativa al punto de despegue: valores negativos (barómetro bajo el home) no son "altura" → guion.
const altM = v => { const n = Math.round(v || 0); return n < 0 ? '—' : n + ' m'; };
const metric = (ico, label, value) =>
  `<span title="${label}">${icon(ico)}<b>${value}</b><span class="sr-only">${label}</span></span>`;

function card(f) {
  const a = ai[f.clip_id];
  const title = flightTitle(f, a);
  const untitled = !f.label && title.startsWith('Sin título');
  const named = !untitled;
  return `
  <a class="card scrub" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
    <div class="thumb">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
      <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
      ${a?.travel_score != null ? `<span class="score-pill" title="Score AI">${a.travel_score}/10</span>` : ''}
      <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
      ${f.has_proxy ? `<span class="play-badge" data-tip="Ver vuelo con streaming">${icon('play')}</span>` : ''}
      <span class="scrub-line"></span>
      <button class="rename-btn" data-rename="${f.clip_id}" title="Renombrar" aria-label="Renombrar vuelo">${icon('tag')}</button>
    </div>
    <div class="body">
      <div class="t"><span class="vf-title">${esc(title)}</span></div>
      <div class="vf-when"><time>${named ? fmt.date(f.date) + (f.time ? ' · ' + f.time : '') : fmt.date(f.date)}</time></div>
      <div class="metrics">
        ${metric('route', 'Distancia', fmt.km(f.stats.distance_m || 0))}
        ${metric('mountain', 'Altura máxima', altM(f.stats.max_rel_alt_m))}
        ${metric('film', 'Resolución y fps', ((f.resolution || '').split('x')[1] || '?') + 'p' + Math.round(f.fps || 0))}
      </div>
      ${f.label && a?.summary ? `<p class="ai-line">${esc(a.summary)}</p>` : ''}
    </div>
  </a>`;
}

function chipsRow() {
  const scenes = [...new Set(flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
  const clear = state.spot && spots[state.spot]
    ? `<button class="chip on" data-clearspot aria-label="Quitar lugar ${esc(spots[state.spot].name)}">${icon('close')} ${esc(spots[state.spot].name)}</button>` : '';
  setHTML(document.getElementById('scene-chips'),
    (clear || scenes.length ? '<span class="chip-div" aria-hidden="true"></span>' : '') + clear +
    scenes.map(sc =>
      `<button class="chip ${state.scene === sc ? 'on' : ''}" data-scene="${esc(sc)}" aria-pressed="${state.scene === sc}">${esc(sc)}</button>`).join(''));
}

// Entrada de tarjetas: solo en el primer montaje y solo las del primer viewport.
// Escalón de 30 ms (máx. 4 pasos = 120 ms) + 200 ms de animación = 320 ms en total.
let entered = false;
function enterOnce(grid) {
  if (entered) return;
  entered = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const vh = innerHeight;
  [...grid.querySelectorAll('.card')]
    .filter(c => c.getBoundingClientRect().top < vh)
    .slice(0, 12)
    .forEach((c, i) => { c.style.setProperty('--in-delay', `${Math.min(i, 4) * 30}ms`); c.classList.add('vf-in'); });
}

let lastCount = 0;
function syncControls() {
  const n = state.has.size + (state.tier !== 'all' ? 1 : 0) + (state.scene ? 1 : 0) + (state.spot ? 1 : 0);
  const badge = document.getElementById('vf-badge');
  badge.hidden = !n; badge.textContent = n;
  filtersBtn.classList.toggle('on', n > 0);
  const done = document.querySelector('[data-done]');
  if (done) done.textContent = `Ver ${lastCount} ${lastCount === 1 ? 'vuelo' : 'vuelos'}`;
  document.querySelectorAll('[data-tier]').forEach(b => {
    const on = b.dataset.tier === state.tier;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('[data-qf]').forEach(b => {
    const on = state.has.has(b.dataset.qf);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
}

function render() {
  const list = flights.filter(matches).sort(
    state.semantic && semRank ? (a, b) => (semRank.get(b.clip_id) || 0) - (semRank.get(a.clip_id) || 0) : SORTS[state.sort]);
  lastCount = list.length;
  document.getElementById('count').textContent =
    `${list.length} de ${flights.length}` + (state.q ? ` · "${state.q}"` : '');
  const grid = document.getElementById('grid');
  const mapv = document.getElementById('mapview');
  const isMap = state.view === 'map';
  grid.hidden = isMap;
  mapv.hidden = !isMap;
  chipsRow();
  syncControls();
  if (isMap) { renderMap(list); syncFoot(list.length, true); return; }
  if (state.view === 'places') { renderPlaces(list); return; }
  if (state.view === 'dates') { renderDates(list); return; }
  grid.className = `grid ${state.view === 'list' ? 'list' : ''}`;
  if (setHTML(grid, list.length ? list.map(card).join('') : noResults('search', 'Sin resultados', 'Prueba con otra búsqueda.'))) {
    enterOnce(grid);
    attachScrub(grid);
  }
  grid.classList.toggle('is-empty', !list.length);
  syncFoot(list.length, isMap);
}

// Estado vacío único de la página: con filtros activos explica por qué y ofrece limpiarlos.
const activeFilters = () => state.has.size + (state.tier !== 'all' ? 1 : 0) + (state.scene ? 1 : 0) + (state.spot ? 1 : 0) + (state.q ? 1 : 0);
function noResults(ic, title, base) {
  const n = activeFilters();
  const onlyQ = n === 1 && state.q;
  return emptyState({ icon: ic, title,
    help: !n ? base : onlyQ ? 'Nada coincide con tu búsqueda. Prueba otras palabras o bórrala.'
      : `${n} filtros activos dejan la lista vacía. Quítalos para ver todos los vuelos.`,
    action: n ? `<button type="button" class="btn sm" data-clear-filters>${onlyQ ? 'Borrar búsqueda' : 'Limpiar filtros'}</button>` : '', cls: 'vf-span' });
}
function clearFilters() {
  state.q = ''; state.tier = 'all'; state.scene = null; state.spot = null; state.has.clear();
  if (state.semantic) { state.semantic = false; semRank = null; const t = document.getElementById('sem-toggle'); t.classList.remove('on'); t.setAttribute('aria-pressed', 'false'); qEl.placeholder = 'Buscar vuelos'; }
  qEl.value = '';
  render();
}
function syncFoot(n, isMap) { document.getElementById('vf-foot').hidden = isMap || !n; }

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
  grid.__h = null;
  grid.innerHTML = visible.length ? visible.map(sp => {
    const fs = sp.flights;
    const dates = fs.map(f => f.date).sort();
    const dist = fs.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    const dur = fs.reduce((a, f) => a + f.duration_s, 0);
    const best = [...fs].sort((a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0))[0];
    return `
    <a class="card" data-spotcard="${esc(sp.key)}">
      <div class="thumb">
        <img src="${DATA}/thumbs/${esc(best.clip_id)}.jpg" alt="" loading="lazy" width="960" height="540">
        <span class="ovl mono">${fs.length} ${fs.length === 1 ? 'vuelo' : 'vuelos'}</span>
      </div>
      <div class="body">
        <div class="t"><span class="vf-title">${esc(sp.name)}</span></div>
        <div class="vf-when"><time>${fmt.date(dates[0])}${dates.length > 1 ? ' – ' + fmt.date(dates[dates.length - 1]) : ''}</time></div>
        <div class="metrics">
          ${metric('route', 'Distancia total', fmt.km(dist))}
          ${metric('clock', 'Tiempo en el aire', fmt.hours(dur))}
          ${metric('mountain', 'Altura máxima', altM(Math.max(...fs.map(f => f.stats.max_rel_alt_m || 0))))}
        </div>
      </div>
    </a>`;
  }).join('') : noResults('pin', 'Sin lugares', 'Todavía no hay lugares de despegue registrados.');
  grid.classList.toggle('is-empty', !visible.length);
  syncFoot(visible.length, false);
}

// ---------- fechas: cronología agrupada por mes ----------
function renderDates(list) {
  const grid = document.getElementById('grid');
  const groups = {};
  list.forEach(f => { (groups[(f.date || 'sin-fecha').slice(0, 7)] ??= []).push(f); });
  const months = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  grid.className = 'grid list';
  grid.__h = null;
  grid.innerHTML = months.length ? months.map(([m, fs]) => {
    const name = new Date(m + '-15').toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const dist = fs.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    const dur = fs.reduce((a, f) => a + f.duration_s, 0);
    return `<div class="month-head vf-span">
      <b>${esc(name.charAt(0).toUpperCase() + name.slice(1))}</b>
      <span class="mono">${fs.length} vuelos · ${fmt.km(dist)} · ${fmt.hours(dur)}</span></div>` +
      fs.map(card).join('');
  }).join('') : noResults('cal', 'Sin vuelos', 'Todavía no hay vuelos para agrupar por fecha.');
  grid.classList.toggle('is-empty', !months.length);
  syncFoot(months.length, false);
  attachScrub(grid);
}
document.addEventListener('click', async e => {
  const sc = e.target.closest('[data-scene]');
  if (sc) { state.scene = state.scene === sc.dataset.scene ? null : sc.dataset.scene; render(); }
  const spc = e.target.closest('[data-spotcard]');
  if (spc) { e.preventDefault(); state.spot = spc.dataset.spotcard; setView('grid'); }
  if (e.target.closest('[data-clearspot]')) { state.spot = null; render(); }
  if (e.target.closest('[data-clear-filters]')) { clearFilters(); return; }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    e.preventDefault(); e.stopPropagation();
    if (!getToken()) return;
    const f = flights.find(x => x.clip_id === rn.dataset.rename);
    if (f) openRename(f);
  }
}, true);

// ---------- renombrar (modal canónico, sin prompt()) ----------
function openRename(f) {
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<form class="modal vf-modal vf-rename">
    <div class="modal-h"><b>${icon('edit')} Renombrar vuelo</b>
      <button class="modal-x" type="button" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="modal-b">
      <label class="mlb" for="vf-rn-in">Nombre</label>
      <input class="ctl" id="vf-rn-in" maxlength="120" autocomplete="off" placeholder="Ej. Fachada norte, atardecer" value="${esc(f.label || '')}">
      <p class="vf-rn-err" id="vf-rn-err" role="alert" hidden></p>
      <div class="navrow vf-prev-actions">
        <button class="btn primary" type="submit">Guardar</button>
        <button class="btn" type="button" data-cancel>Cancelar</button>
      </div>
    </div></form>`;
  const close = openModal(ov, { initialFocus: '#vf-rn-in' });
  ov.querySelector('[data-cancel]').addEventListener('click', () => close());
  const form = ov.querySelector('form'), input = ov.querySelector('#vf-rn-in'), err = ov.querySelector('#vf-rn-err');
  input.select();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const label = input.value.trim();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; err.hidden = true;
    try {                                                 // api() puede rechazar (403/red)
      await api('/api/clip', { clip_id: f.clip_id, label });
      f.label = label; close(); render();
    } catch { btn.disabled = false; err.textContent = 'No se pudo renombrar — revisa tu sesión.'; err.hidden = false; }
  });
}

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
  ov.innerHTML = `<div class="modal vf-modal">
    <div class="modal-h"><b>${icon('drone')} ${esc(f.label || fmt.date(f.date) + ' · ' + (f.time || ''))}</b>
      <button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="modal-b">
      ${f.has_proxy
        ? `<video class="m-prev vf-prev" src="${DATA}/proxies/${esc(f.clip_id)}.mp4" poster="${DATA}/thumbs/${esc(f.clip_id)}.jpg" controls muted playsinline preload="none"></video>`
        : `<img class="vf-prev-img" src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" alt="Miniatura de ${esc(flightTitle(f, a))}" width="960" height="540">`}
      <div class="tool-row vf-prev-chips">
        <span class="chip">${fmt.dur(f.duration_s)}</span>
        <span class="chip">${altM(f.stats.max_rel_alt_m)} alt</span>
        <span class="chip">${fmt.km(f.stats.distance_m || 0)}</span>
        ${models.has(f.clip_id) ? `<span class="chip on">3D</span>` : ''}
      </div>
      ${a?.summary ? `<p class="vf-prev-note">${esc(a.summary)}</p>` : ''}
      <div class="navrow vf-prev-actions">
        <a class="btn primary" href="flight.html?id=${encodeURIComponent(f.clip_id)}">${icon('film')} Ver vuelo completo</a>
        ${models.has(f.clip_id) ? `<a class="btn" href="tresd.html">${icon('cube')} Modelo 3D</a>` : ''}
      </div>
    </div></div>`;
  openModal(ov, { onClose: () => ov.querySelector('video')?.pause() });
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
document.getElementById('sem-toggle').addEventListener('click', e => {
  e.preventDefault();
  state.semantic = !state.semantic;
  const t = document.getElementById('sem-toggle');
  t.classList.toggle('on', state.semantic);
  t.setAttribute('aria-pressed', state.semantic);
  qEl.placeholder = state.semantic ? 'Describe lo que buscas y pulsa Enter…' : 'Buscar vuelos';
  if (!state.semantic) { semRank = null; }
  qEl.focus();
  render();
});
document.querySelectorAll('[data-qf]').forEach(b => b.addEventListener('click', () => {
  state.has.has(b.dataset.qf) ? state.has.delete(b.dataset.qf) : state.has.add(b.dataset.qf);
  render();
}));
document.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => { state.tier = b.dataset.tier; render(); }));
document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
// Móvil: los filtros viven en una hoja inferior (openModal) en vez de empujar el contenido; los mismos nodos
// (con sus listeners) se mueven a la hoja y vuelven a su sitio al cerrar.
const filtersBtn = document.getElementById('vf-filters-btn');
let sheetOpen = false;
filtersBtn.addEventListener('click', () => {
  if (sheetOpen) return;
  const more = document.getElementById('vf-more');
  const mark = document.createComment('vf-more');
  more.before(mark);
  const ov = document.createElement('div');
  ov.className = 'modal-ov vf-sheet-ov';
  ov.innerHTML = `<div class="modal vf-sheet">
    <div class="modal-h"><b>${icon('sliders')} Filtros</b><button class="modal-x" type="button" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="modal-b"></div>
    <div class="vf-sheet-f"><button type="button" class="btn ghost" data-reset>Limpiar</button><button type="button" class="btn primary" data-done></button></div>
  </div>`;
  ov.querySelector('.modal-b').appendChild(more);
  more.classList.add('in-sheet');
  sheetOpen = true;
  filtersBtn.setAttribute('aria-expanded', 'true');
  const close = openModal(ov, { initialFocus: '#sort', onClose: () => {
    sheetOpen = false; filtersBtn.setAttribute('aria-expanded', 'false');
    more.classList.remove('in-sheet'); mark.replaceWith(more);
  } });
  ov.querySelector('[data-done]').addEventListener('click', () => close());
  ov.querySelector('[data-reset]').addEventListener('click', () => { clearFilters(); });
  syncControls();
});
document.querySelectorAll('[data-view]').forEach(b =>
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    // los modos de "Explorar por" se apagan al pulsarlos otra vez → vuelve a la cuadrícula
    setView(b.closest('.vf-explore') && state.view === v ? 'grid' : v);
  }));
function setView(v) {
  state.view = v;
  localStorage.setItem('ab.vview', v);
  syncViewButtons();
  render();
}
function syncViewButtons() {
  document.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
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
  syncViewButtons();
  flights = await getFlights();
  ai = await getAIAll(flights);   // embebido en flights.json: sin requests extra
  buildSpots();
  render();                       // un solo pintado inicial (con títulos AI): la entrada se anima una vez
  fetch(`${DATA}/manifest/system.json`).then(r => r.json())
    .then(sy => { models = new Set((sy.models || []).map(m => m.clip_id)); if (state.has.has('model')) render(); }).catch(() => {});
})().catch(e => {
  main.querySelector('#grid').innerHTML = emptyState({ icon: 'warn', title: 'No se pudo cargar', help: e.message, cls: 'vf-span' });
});
