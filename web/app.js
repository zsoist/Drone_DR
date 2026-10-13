import { fmt } from './ui/format.js?v=429';
import { mapSkinOptions, skinMap } from './ui/map-skin.js?v=429';
import { skinPlayer } from './ui/player.js?v=429';
import { readAI, loadInsights, captionView, clipChips, qualityLabels } from './home.ai.js?v=429';
import { loadFlights, registerFlights, openPageSheet, save, skeleton, dataColor, suggestedContent } from './home-shared.js?v=429';
// Vuelos: gallery with instant search (incl. AI tags), filters, sort, views.
const main = renderShell('index.html');
// The clip library belongs to Viajes, including collection and tag links.
document.querySelectorAll('.ab-nav-item[href="home.html"], .ab-nav-item[href="trips.html"]').forEach(link => {
  if (link.classList.contains('ab-rail-brand')) return;
  const active = link.getAttribute('href') === 'trips.html';
  link.classList.toggle('active', active);
  if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
});
let flights = [], ai = {}, semRank = null, models = new Set();
let state = { q: '', tier: 'all', sort: 'date', scene: null, semantic: false, spot: null, has: new Set(),
              view: localStorage.getItem('ab.vview') || 'grid' };

const TIERS = [['all', 'Todos'], ['full', 'Completo'], ['standard', 'Estándar'], ['skim', 'Básico'], ['archived', 'Archivados']];
const TIER_TIPS = { all: 'Todos los vuelos', full: 'Video, análisis, GPS y fotogramas', standard: 'Video, análisis y GPS', skim: 'Video y telemetría', archived: 'Vuelos archivados' };

main.classList.add('vf-page', 'ab-page');
main.innerHTML = `
  ${pageHead('Vuelos', '', '<a class="ui-button ui-button--quiet" href="trips.html">Viajes</a>', { subId: 'count' })}<nav class="vf-view ui-segmented" aria-label="Vista de vuelos"><button class="ui-button ui-button--quiet" data-view="grid">${icon('grid')} Galería</button><button class="ui-button ui-button--quiet" data-view="list">${icon('list')} Lista</button><button class="ui-button ui-button--quiet" data-view="map">${icon('map')} Mapa</button></nav>
  <div class="vf-bar" role="search">
    <label class="search vf-search">${icon('search')}<input id="q" type="search" placeholder="Buscar vuelos" aria-label="Buscar vuelos" autocomplete="off">
      <button type="button" class="vf-sem hit44" id="sem-toggle" aria-pressed="false" aria-label="Buscar por significado" data-tip="Describe una escena y pulsa Enter">${icon('search')}</button>
      <kbd>/</kbd></label>
    <button type="button" class="btn vf-filters-btn ui-button ui-button--secondary" id="vf-filters-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="vf-more">${icon('sliders')} Filtros <span class="vf-badge" id="vf-badge" hidden></span></button>
    <div class="vf-more" id="vf-more">
      <div class="vf-tools">
        <div class="vf-fld"><span class="tool-lb vf-lb">Ordenar por</span>
        <select class="ctl" id="sort" aria-label="Ordenar">
          <option value="date">Más recientes</option>
          <option value="dur">Más largos</option>
          <option value="dist">Más distancia</option>
          <option value="alt">Más altura</option>
          <option value="score">Mejor puntuación</option>
        </select></div>
        <div class="vf-fld"><span class="tool-lb vf-lb">Explorar por</span>
        <select class="ctl" id="vf-group" aria-label="Agrupar vuelos"><option value="grid">Sin agrupar</option><option value="places">Lugares</option><option value="dates">Fechas</option></select></div>
      </div>
      <div class="vf-fld vf-fld-chips"><span class="tool-lb vf-lb">Filtrar</span>
      <div class="chip-row vf-chips" role="toolbar" aria-label="Filtros">
        ${TIERS.map(([k, l]) => `<button class="chip ui-chip ${k === 'all' ? 'on' : ''}" data-tier="${k}" aria-pressed="${k === 'all'}" data-tip="${TIER_TIPS[k]}">${l}</button>`).join('')}
        <span class="chip-div" aria-hidden="true"></span>
        <button class="chip ui-chip" data-qf="video" aria-pressed="false" data-tip="Solo clips con video disponible">${icon('play')} Video</button>
        <button class="chip ui-chip" data-qf="model" aria-pressed="false" data-tip="Con modelo 3D procesado">${icon('cube')} 3D</button>
        <button class="chip ui-chip" data-qf="ai" aria-pressed="false" data-tip="Con análisis del vuelo">${icon('search')} Análisis</button>
        <button class="chip ui-chip" data-qf="alto" aria-pressed="false" data-tip="Altura máxima sobre 100 m">${icon('mountain')} +100 m</button>
        <button class="chip ui-chip" data-qf="4k60" aria-pressed="false" data-tip="4K a 60 cuadros">${icon('film')} 4K60</button>
        <button class="chip ui-chip" data-qf="largo" aria-pressed="false" data-tip="Duración sobre 1 minuto">${icon('clock')} +1 min</button>
        <button class="chip ui-chip" data-qf="top" aria-pressed="false" data-tip="Puntuación sugerida de 6 o más">${icon('search')} Destacados</button>
        <span class="vf-scenes" id="scene-chips"></span>
      </div></div>
    </div>
  </div>
  <div class="vf-selection" id="vf-selection" hidden></div>
  <p class="vf-note" id="ai-status" role="status">Cargando etiquetas…</p>
  <div class="grid" id="grid">${skeleton(6)}</div>
  <div id="mapview" hidden>
    <div class="panel vf-mappanel">
      <div class="tool-row vf-maptools">
        <span class="tool-lb">Color</span>
        <button class="chip on ui-chip" data-mc="uni" aria-pressed="true">Ruta</button>
        <button class="chip ui-chip" data-mc="alt" aria-pressed="false">Altura</button>
        <button class="chip ui-chip" data-mc="year" aria-pressed="false">Año</button>
      </div>
      <div id="vmap" class="vf-map"></div>
      <button class="map-recenter" id="vm-fit" title="Ver todo" aria-label="Ver todos los vuelos">${icon('map')}</button>
    </div>
    <div class="vf-map-list" id="vf-map-list"></div><p class="page-foot vf-note">Los filtros y la búsqueda de arriba también filtran el mapa. Los números indican vuelos. Amplía un grupo o elige un vuelo de la lista.</p>
  </div>
  <footer class="page-foot" id="vf-foot">Todos los niveles preparan video para reproducción. La disponibilidad se muestra en cada vuelo.</footer>`;

function setHTML(el, html) {
  if (el.__h === html) return false;
  el.__h = html;
  el.innerHTML = html;
  return true;
}


const spotKey = f => f.stats?.home ? `${Math.round(f.stats.home[0] / 0.005)}:${Math.round(f.stats.home[1] / 0.005)}` : null;
function matches(f) {
  if (state.collection && !state.collection.has(f.clip_id)) return false;
  if (state.tag && !ai[f.clip_id]?.tags?.includes(state.tag)) return false;
  if (state.flag && !ai[f.clip_id]?.quality_flags?.includes(state.flag)) return false;
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
  if (state.semantic && semRank) return semRank.has(f.clip_id);
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
const flightTitle = f => f.label || `${fmt.date(f.date)}${f.time ? ' · ' + f.time : ''}`;
// Altura relativa al punto de despegue: valores negativos (barómetro bajo el home) no son "altura" → guion.
const altM = v => { const n = Math.round(v || 0); return n < 0 ? '—' : n + ' m'; };
const metric = (ico, label, value) =>
  `<span title="${label}">${icon(ico)}<b>${value}</b><span class="sr-only">${label}</span></span>`;

function card(f) {
  const a = ai[f.clip_id];
  const title = flightTitle(f, a);
  return `
  <article class="card"><a class="vf-card-link scrub" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
    <div class="thumb" data-transition-key="clip-${esc(f.clip_id)}">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">

      ${a?.travel_score != null ? `<span class="score-pill" title="Puntuación sugerida">${a.travel_score}/10</span>` : ''}
      <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
      ${f.has_proxy ? `<span class="play-badge" data-tip="Ver vuelo con video disponible">${icon('play')}</span>` : ''}
      <span class="scrub-line"></span>
    </div>
    <div class="body">
      <div class="t"><span class="vf-title">${esc(title)}</span></div>
      ${f.label ? `<div class="vf-when"><time>${fmt.date(f.date)}${f.time ? ' · ' + f.time : ''}</time></div>` : ''}
      <div class="metrics">
        ${metric('route', 'Distancia', fmt.km(f.stats.distance_m || 0))}
        ${metric('mountain', 'Altura máxima', altM(f.stats.max_rel_alt_m))}
        ${metric('film', 'Resolución y fps', ((f.resolution || '').split('x')[1] || '?') + 'p' + Math.round(f.fps || 0))}
      </div>

    </div>
  </a><div class="vf-card-tools">${clipChips(a)}<button class="ui-button ui-button--quiet rename-btn" data-rename="${esc(f.clip_id)}" aria-label="Renombrar vuelo">${icon('edit')}</button></div>${captionView(a)}</article>`;
}

function chipsRow() {
  const scenes = [...new Set(flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
  const clear = state.spot && spots[state.spot]
    ? `<button class="chip on ui-chip" data-clearspot aria-label="Quitar lugar ${esc(spots[state.spot].name)}">${icon('close')} ${esc(spots[state.spot].name)}</button>` : '';
  setHTML(document.getElementById('scene-chips'),
    (clear || scenes.length ? '<span class="chip-div" aria-hidden="true"></span>' : '') + clear +
    scenes.map(sc =>
      `<button class="chip ui-chip ${state.scene === sc ? 'on' : ''}" data-scene="${esc(sc)}" aria-pressed="${state.scene === sc}">${esc(sc)}</button>`).join(''));
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
    .slice(0, 4)
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
  const selection = document.getElementById('vf-selection');
  const labels = [state.collectionLabel, state.tag, qualityLabels[state.flag]].filter(Boolean);
  selection.hidden = !labels.length;
  selection.innerHTML = labels.length ? `<span>${esc(labels.join(' · '))}</span><button class="ui-button ui-button--quiet" data-clear-filters>Quitar filtros ${icon('close')}</button>` : '';
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
  if (isMap) { renderMap(list); document.getElementById('vf-map-list').innerHTML = list.slice(0, 30).map(f => `<button class="vf-map-item" data-preview="${esc(f.clip_id)}"><img src="${DATA}/thumbs/${encodeURIComponent(f.clip_id)}.jpg" alt=""><span>${esc(flightTitle(f, ai[f.clip_id]))}<small>${fmt.dur(f.duration_s)} · ${fmt.km(f.stats?.distance_m || 0)}</small></span></button>`).join('') || noResults('map', 'Sin vuelos', 'Sube un vuelo con GPS para ver su ruta.'); syncFoot(list.length, true); return; }
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
const activeFilters = () => state.has.size + (state.tier !== 'all' ? 1 : 0) + (state.scene ? 1 : 0) + (state.spot ? 1 : 0) + (state.q ? 1 : 0) + (state.collection ? 1 : 0) + (state.tag ? 1 : 0) + (state.flag ? 1 : 0);
function noResults(ic, title, base) {
  const n = activeFilters();
  const onlyQ = n === 1 && state.q;
  return emptyState({ icon: ic, title,
    help: !n ? base : onlyQ ? 'Nada coincide con tu búsqueda. Prueba otras palabras o bórrala.'
      : `${n} filtros activos dejan la lista vacía. Quítalos para ver todos los vuelos.`,
    action: n ? `<button type="button" class="btn ui-button ui-button--secondary" data-clear-filters>${onlyQ ? 'Borrar búsqueda' : 'Limpiar filtros'}</button>` : '<a class="ui-button ui-button--primary" href="studio.html?via=subir">Subir video</a><p>Por ejemplo, un vuelo sobre los cerros.</p>', cls: 'vf-span' });
}
function clearFilters() {
  semSeq++;
  state.collection = null; state.collectionLabel = ''; state.tag = null; state.flag = null;
  const url = new URL(location.href); ['collection', 'tag', 'flag', 'q'].forEach(key => url.searchParams.delete(key)); history.replaceState(null, '', url);
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
    sp.name = sp.flights.find(f => f.label)?.label || `Lugar · ${fmt.date(sp.flights[0].date)}`;
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
    <a class="card" href="index.html?spot=${encodeURIComponent(sp.key)}&v=grid" data-spotcard="${esc(sp.key)}">
      <div class="thumb">
        <img src="${DATA}/thumbs/${esc(best.clip_id)}.jpg" alt="" loading="lazy" width="960" height="540">
        <span class="ovl">${fs.length} ${fs.length === 1 ? 'vuelo' : 'vuelos'}</span>
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
      <span>${fs.length} vuelos · ${fmt.km(dist)} · ${fmt.hours(dur)}</span></div>` +
      fs.map(card).join('');
  }).join('') : noResults('cal', 'Sin vuelos', 'Todavía no hay vuelos para agrupar por fecha.');
  grid.classList.toggle('is-empty', !months.length);
  syncFoot(months.length, false);
  attachScrub(grid);
}
document.addEventListener('click', async e => {
  const preview = e.target.closest('[data-preview]');
  if (preview) { openPreview(flights.find(f => f.clip_id === preview.dataset.preview)); return; }
  const sc = e.target.closest('[data-scene]');
  if (sc) { state.scene = state.scene === sc.dataset.scene ? null : sc.dataset.scene; render(); }
  const spc = e.target.closest('[data-spotcard]');
  if (spc && !e.metaKey && !e.ctrlKey) { e.preventDefault(); state.spot = spc.dataset.spotcard; setView('grid'); }
  if (e.target.closest('[data-clearspot]')) { state.spot = null; render(); }
  if (e.target.closest('[data-clear-filters]')) { clearFilters(); return; }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    e.preventDefault(); e.stopPropagation();
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
        <button class="btn ui-button ui-button--primary" type="submit">Guardar</button>
        <button class="btn ui-button ui-button--secondary" type="button" data-cancel>Cancelar</button>
      </div>
    </div></form>`;
  const close = openPageSheet(ov, { initialFocus: '#vf-rn-in' });
  ov.querySelector('[data-cancel]').addEventListener('click', () => close());
  const form = ov.querySelector('form'), input = ov.querySelector('#vf-rn-in'), err = ov.querySelector('#vf-rn-err');
  input.select();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const label = input.value.trim();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; err.hidden = true;
    try {                                                 // api() puede rechazar (403/red)
      await save('/api/clip', { clip_id: f.clip_id, label });
      f.label = label; close(); render();
    } catch (error) { btn.disabled = false; err.textContent = error.message; err.hidden = false; }
  });
}

// ---------- vista mapa: rutas + pins de lugar, filtrados por la barra de arriba ----------
let vmap = null, vmapLoaded = false;
let spotMarkers = [];
function updateSpotMarkers() {
  spotMarkers.forEach(marker => marker.remove());
  const groups = [];
  Object.values(spots).filter(sp => sp.flights.some(matches)).forEach(sp => {
    const point = vmap.project([sp.lng, sp.lat]);
    const group = groups.find(g => Math.hypot(point.x - g.point.x, point.y - g.point.y) < 56);
    if (group) group.spots.push(sp);
    else groups.push({ point, spots: [sp] });
  });
  spotMarkers = groups.map(group => {
    const places = group.spots, first = places[0];
    const rows = places.flatMap(sp => sp.flights.filter(matches));
    const score = Math.max(0, ...rows.map(f => ai[f.clip_id]?.travel_score || 0));
    const el = document.createElement('button');
    el.className = 'vf-map-pin';
    el.dataset.transitionKey = `pin-${rows[0].clip_id}`;
    el.classList.toggle('on', places.some(sp => sp.key === state.spot));
    el.style.setProperty('--moment-size', `${24 + score * 2}px`);
    el.setAttribute('aria-label', places.length > 1 ? `Ampliar ${places.length} lugares: ${places.map(sp => sp.name).join(', ')}` : `Ver ${rows.length} vuelos de ${first.name}`);
    el.title = el.getAttribute('aria-label');
    el.innerHTML = `<span>${rows.length}</span>`;
    el.addEventListener('click', () => {
      const duration = document.documentElement.dataset.motion === 'reduced' ? 0 : 340;
      if (places.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        places.forEach(sp => bounds.extend([sp.lng, sp.lat]));
        vmap.fitBounds(bounds, { padding: 84, maxZoom: 17, duration });
      } else {
        state.spot = state.spot === first.key ? null : first.key;
        render();
        if (state.spot) vmap.flyTo({ center: [first.lng, first.lat], zoom: 15.5, duration });
      }
    });
    return new maplibregl.Marker({ element: el }).setLngLat([first.lng, first.lat]).addTo(vmap);
  });
}
function renderMap(list) {
  const ids = list.map(f => f.clip_id);
  if (!vmap) {
    const withBox = flights.filter(f => f.stats?.bbox);
    const bounds = new maplibregl.LngLatBounds();
    withBox.forEach(f => { bounds.extend([f.stats.bbox[0], f.stats.bbox[1]]); bounds.extend([f.stats.bbox[2], f.stats.bbox[3]]); });
    // sin ningún bbox, un LngLatBounds vacío hace throw en el constructor y en fitBounds (#2):
    // arranca el mapa centrado por defecto y no intenta encuadrar la nada
    const hasBounds = withBox.length > 0;
    const opts = { ...mapSkinOptions, container: 'vmap', style: SAT_STYLE };
    if (hasBounds) { opts.bounds = bounds; opts.fitBoundsOptions = { padding: 84 }; }
    else { opts.center = [-74.08, 4.65]; opts.zoom = 9; }   // Bogotá por defecto
    vmap = new maplibregl.Map(opts);
    skinMap(vmap);
    new ResizeObserver(() => vmap.resize()).observe(document.getElementById('vmap'));
    document.getElementById('vm-fit').addEventListener('click', () => {
      state.spot = null;
      render();
      if (hasBounds) vmap.fitBounds(bounds, { padding: 84, duration: document.documentElement.dataset.motion === 'reduced' ? 0 : 340 });
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
        vmap.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': dataColor(), 'line-width': 6, 'line-opacity': 0.18 } });
        vmap.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': dataColor(), 'line-width': 1.8, 'line-opacity': 0.9 } });
        vmap.on('click', 'routes', e => {
          const f = flights.find(x => x.clip_id === e.features[0].properties.cid);
          if (f) openPreview(f);
        });
        vmap.on('mouseenter', 'routes', () => { vmap.getCanvas().style.cursor = 'pointer'; });
        vmap.on('mouseleave', 'routes', () => { vmap.getCanvas().style.cursor = ''; });
        vmapLoaded = true;
        applyMapFilter(flights.filter(matches).map(f => f.clip_id));
      }).catch(() => { document.querySelector('.vf-note').textContent = 'No se pudieron cargar las rutas. Recarga para intentarlo de nuevo.'; });
      updateSpotMarkers();
      vmap.on('moveend', updateSpotMarkers);
    });
  }
  vmap.resize();
  if (vmapLoaded) applyMapFilter(ids);
  if (!renderMap._colorWired) {
    renderMap._colorWired = true;
    const colors = () => ({
      uni: dataColor(),
      alt: ['interpolate', ['linear'], ['get', 'alt'],
            0, dataColor(35), 80, dataColor(55), 150, dataColor(75), 260, dataColor()],
      year: ['match', ['get', 'year'], '2025', dataColor(50), '2026', dataColor(), dataColor(35)],
    });
    document.addEventListener('ab-theme-change', () => document.querySelector('[data-mc].on')?.click());
    document.querySelectorAll('[data-mc]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-mc]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      if (vmap.getLayer('routes')) vmap.setPaintProperty('routes', 'line-color', colors()[b.dataset.mc]);
      if (vmap.getLayer('routes-glow')) vmap.setPaintProperty('routes-glow', 'line-color', colors()[b.dataset.mc]);
    }));
  }
  if (vmapLoaded) updateSpotMarkers();
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
        ? `<video class="m-prev vf-prev" src="${DATA}/proxies/${esc(f.clip_id)}.mp4" poster="${DATA}/thumbs/${esc(f.clip_id)}.jpg" muted playsinline preload="metadata"></video>`
        : `<img class="vf-prev-img" src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" alt="Miniatura de ${esc(flightTitle(f, a))}" width="960" height="540">`}
      <div class="tool-row vf-prev-chips">
        <span class="chip ui-chip">${fmt.dur(f.duration_s)}</span>
        <span class="chip ui-chip">${altM(f.stats.max_rel_alt_m)} alt</span>
        <span class="chip ui-chip">${fmt.km(f.stats.distance_m || 0)}</span>
        ${models.has(f.clip_id) ? `<span class="chip on ui-chip">3D</span>` : ''}
      </div>
      ${a?.caption_short ? `<div class="vf-preview-insight">${captionView(a)}</div>` : '<p class="vf-prev-note">Sin análisis aún.</p>'}
      <div class="navrow vf-prev-actions">
        <a class="btn ui-button ui-button--primary" href="flight.html?id=${encodeURIComponent(f.clip_id)}">${icon('film')} Ver vuelo completo</a>
        ${models.has(f.clip_id) ? `<a class="btn ui-button ui-button--secondary" href="tresd.html">${icon('cube')} Modelo 3D</a>` : ''}
      </div>
    </div></div>`;

  const insight = ov.querySelector('.vf-preview-insight');
  if (insight) insight.replaceChildren(suggestedContent(insight.innerHTML));
  const video = ov.querySelector('video');
  const player = video ? skinPlayer(video) : null;
  openPageSheet(ov, { size: 'full', onClose: () => player?.destroy() });
}

const qEl = document.getElementById('q');
qEl.addEventListener('input', e => {
  semSeq++;
  state.q = e.target.value; semRank = null;
  render();
});
let semSeq = 0;
qEl.addEventListener('keydown', async e => {
  if (e.key === 'Enter' && state.semantic && state.q.trim()) {
    qEl.blur();
    const mySeq = ++semSeq;                              // token: respuestas fuera de orden no pisan (#6)
    document.getElementById('count').textContent = 'buscando por significado…';
    try {
      const { results, error } = await readAI(`/api/search?q=${encodeURIComponent(state.q.trim())}&limit=50`);
      if (mySeq !== semSeq) return;                      // llegó una búsqueda más nueva → descarta esta
      if (error) { document.getElementById('count').textContent = 'error: ' + error; return; }
      semRank = new Map(results.map((r, i) => [r.clip_id, results.length - i]));
      render();
    } catch (err) { if (mySeq === semSeq) document.getElementById('count').textContent = 'No se pudo buscar. Pulsa Enter para reintentar.'; }
  }
});
document.getElementById('sem-toggle').addEventListener('click', e => {
  e.preventDefault();
  semSeq++;
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
    <div class="vf-sheet-f"><button type="button" class="btn ui-button ui-button--quiet" data-reset>Limpiar</button><button type="button" class="btn ui-button ui-button--primary" data-done></button></div>
  </div>`;
  ov.querySelector('.modal-b').appendChild(more);
  more.classList.add('in-sheet');
  sheetOpen = true;
  filtersBtn.setAttribute('aria-expanded', 'true');
  const close = openPageSheet(ov, { size: 'full', initialFocus: '#sort', onClose: () => {
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
document.getElementById('vf-group').addEventListener('change', e => setView(e.target.value));
function setView(v) {
  state.view = v;
  localStorage.setItem('ab.vview', v);
  const url = new URL(location.href); url.searchParams.set('v', v);
  if (state.spot) url.searchParams.set('spot', state.spot); else url.searchParams.delete('spot');
  history.replaceState(null, '', url);
  syncViewButtons();
  render();
}
function syncViewButtons() {
  document.getElementById('vf-group').value = ['places', 'dates'].includes(state.view) ? state.view : 'grid';
  document.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
}
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.defaultPrevented && !e.target.closest('input,textarea,select,button,a,[contenteditable],dialog')) {
    e.preventDefault(); document.getElementById('q').focus();
  }
});

(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) { state.q = params.get('q'); document.getElementById('q').value = state.q; }
  if (['grid', 'list', 'map', 'places', 'dates'].includes(params.get('v'))) state.view = params.get('v');
  syncViewButtons();
  flights = await loadFlights();
  registerFlights(flights);
  state.spot = params.get('spot');
  state.tag = params.get('tag'); state.flag = params.get('flag');
  if (params.has('collection')) {
    state.collection = new Set();
    try {
      const { collections } = await readAI('/api/collections');
      const collection = collections.find(c => c.id === params.get('collection'));
      state.collection = new Set(collection?.clip_ids || []);
      state.collectionLabel = collection?.label || 'Colección no disponible';
    } catch { state.collectionLabel = 'No se pudo cargar la colección. Vuelve a abrirla para reintentar.'; }
  }
  ai = await getAIAll(flights);   // embebido en flights.json: sin requests extra
  const { insights, failed } = await loadInsights(flights.filter(f => !f.archived));
  for (const [id, insight] of Object.entries(insights)) if (insight) ai[id] = { ...ai[id], ...insight };
  const aiStatus = document.getElementById('ai-status');
  aiStatus.textContent = failed ? 'No se pudieron cargar algunas etiquetas.' : '';
  const suggestions = suggestedContent('');
  suggestions.classList.add('vf-suggested');
  aiStatus.hidden = !failed;
  aiStatus.after(suggestions);
  suggestions.querySelector('.ui-suggested-content').append(document.getElementById('grid'), document.getElementById('mapview'));
  buildSpots();
  render();                       // un solo pintado inicial (con títulos AI): la entrada se anima una vez
  fetch(`${DATA}/manifest/system.json`).then(r => r.json())
    .then(sy => { models = new Set((sy.models || []).map(m => m.clip_id)); if (state.has.has('model')) render(); }).catch(() => {});
})().catch(e => {
  main.querySelector('#grid').innerHTML = emptyState({ icon: 'warn', title: 'No se pudieron cargar los vuelos', help: 'Revisa la conexión y vuelve a intentarlo.', action: '<button class="ui-button ui-button--primary" id="vf-retry">Reintentar</button>', cls: 'vf-span' });
  document.getElementById('vf-retry').addEventListener('click', () => location.reload());
});
