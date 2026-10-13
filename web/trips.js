import { thumbnailURL } from './ui/thumbnail.js?v=443';
import { fmt } from './ui/format.js?v=443';
import { mapSkinOptions, skinMap } from './ui/map-skin.js?v=443';
import { readAI, loadInsights, clipChips, bestCover, flightCaption } from './home.ai.js?v=443';
import { loadFlights, registerFlights, registerPaletteSource, frameFor, skeleton, renderFailure, openPageSheet, save, dataColor, figure, suggestedContent } from './home-shared.js?v=443';
const main = renderShell('trips.html');
main.classList.add('tr-page', 'ab-page');
const CITIES = [
  ['Bogotá', 4.711, -74.072], ['Medellín', 6.244, -75.581], ['Cali', 3.452, -76.532],
  ['Cartagena', 10.391, -75.479], ['Barranquilla', 10.964, -74.797], ['Santa Marta', 11.241, -74.199],
  ['Bucaramanga', 7.119, -73.123], ['Pereira', 4.813, -75.696], ['Manizales', 5.070, -75.518],
  ['Armenia', 4.535, -75.676], ['Ibagué', 4.439, -75.232], ['Villavicencio', 4.142, -73.627],
  ['Tunja', 5.535, -73.368], ['Popayán', 2.444, -76.615], ['Neiva', 2.928, -75.288],
  ['Girardot', 4.303, -74.804], ['Melgar', 4.204, -74.641], ['La Mesa', 4.631, -74.463],
  ['Villeta', 5.013, -74.472], ['Anapoima', 4.548, -74.536], ['Fusagasugá', 4.337, -74.364],
  ['Honda', 5.209, -74.737], ['Mariquita', 5.199, -74.893], ['La Vega', 4.999, -74.339],
];
const R0 = Math.PI / 180;
const havKm = (a, b, c, d) => 12742 * Math.asin(Math.sqrt(
  Math.sin((c - a) * R0 / 2) ** 2 + Math.cos(a * R0) * Math.cos(c * R0) * Math.sin((d - b) * R0 / 2) ** 2));


let clusters = [], flights = [], tripsMeta = {}, routeData = [], map = null, mapSkin = null;
document.addEventListener('ab-theme-change', () => { if (map?.getLayer('routes')) map.setPaintProperty('routes', 'line-color', dataColor()); });
const params = () => new URLSearchParams(location.search);
const linkFor = c => `trips.html?trip=${encodeURIComponent(c.key)}`;
const flightLink = f => `flight.html?id=${encodeURIComponent(f.clip_id)}`;
const flightTitle = f => f.label || `${fmt.date(f.date)} · ${f.time || 'Vuelo'}`;
const tripDistance = fmt.distance;
const rangeFor = c => `${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates.at(-1)) : ''}`;

async function optionalJSON(url, fallback) {
  try { const r = await authFetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; }
}
async function load() {
  main.innerHTML = `<h1>Viajes</h1>${skeleton(2)}`;
  try {
    flights = (await loadFlights()).filter(f => !f.archived).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    [tripsMeta, routeData] = await Promise.all([
      optionalJSON(`${DATA}/manifest/trips_meta.json`, {}),
      optionalJSON(`${DATA}/manifest/routes.json`, { routes: [] }),
    ]);
    clusters = [];
    flights.forEach(f => {
      const h = f.stats?.home;
      if (!Array.isArray(h) || !h.every(Number.isFinite)) return;
      let c = clusters.find(x => havKm(x.lat, x.lon, h[1], h[0]) < 30);
      if (!c) { c = { lat: h[1], lon: h[0], flights: [] }; clusters.push(c); }
      c.flights.push(f);
    });
    const used = new Set();
    clusters.forEach(c => {
      const generated = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
      c.recapKey = generated;
      // Keep the saved key stable. A read must never migrate owner data.
      const saved = Object.keys(tripsMeta).filter(k => !used.has(k) && /^-?[\d.]+,-?[\d.]+$/.test(k))
        .map(k => [k, havKm(c.lat, c.lon, ...k.split(',').map(Number))]).sort((a, b) => a[1] - b[1])[0];
      c.key = saved?.[1] < 30 ? saved[0] : generated;
      used.add(c.key);
      const meta = tripsMeta[c.key] || {};
      const near = CITIES.map(([n, la, lo]) => [n, havKm(c.lat, c.lon, la, lo)]).sort((a, b) => a[1] - b[1])[0];
      c.name = meta.name || (near?.[1] < 30 ? near[0] : `Zona ${generated}`);
      c.dates = [...new Set(c.flights.map(f => f.date))].sort();
      c.dist = c.flights.reduce((a, f) => a + (f.stats?.distance_m || 0), 0);
      c.dur = c.flights.reduce((a, f) => a + (f.duration_s || 0), 0);
      c.alt = Math.max(0, ...c.flights.map(f => f.stats?.max_rel_alt_m || 0));
      c.best = [...c.flights].sort((a, b) => (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0))[0];
      c.cover = c.flights.find(f => f.clip_id === meta.cover) || c.best;
      c.coverTime = meta.cover ? undefined : c.cover.ai?.highlights?.[0]?.t;
    });
    clusters.sort((a, b) => b.dates.at(-1).localeCompare(a.dates.at(-1)));
    registerFlights(flights);
    registerPaletteSource(() => clusters.map(c => ({ id: `trip-${c.key}`, label: c.name, keywords: c.dates.join(' '), href: linkFor(c) })));
    await loadCovers();
    render();
  } catch { renderFailure(main, load); }
}
async function loadCovers() {
  for (const c of clusters) {
    const { insights } = await loadInsights(c.flights);
    c.coverUrl = '';
    if (tripsMeta[c.key]?.cover) { c.coverUrl = frameFor(c.cover); continue; }
    for (const flight of [...c.flights].sort((a, b) => (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0))) {
      const cover = await bestCover(flight, insights[flight.clip_id]);
      if (cover) { c.cover = flight; c.coverTime = cover.time; c.coverUrl = cover.url; break; }
    }
  }
}
function render() {
  mapSkin?.destroy(); map?.remove(); map = null;
  const selected = params().get('trip');
  if (selected) {
    const c = clusters.find(c => c.key === selected);
    if (c) { renderDetail(c); return; }
    main.innerHTML = '<div class="ui-empty"><h1>Viaje no encontrado</h1><p>Abre un lugar de tu lista de viajes.</p><a class="ui-button ui-button--primary" href="trips.html">Ver viajes</a></div>';
    return;
  }
  const isMap = params().get('view') === 'map';
  main.classList.toggle('tr-map-page', isMap);
  const located = clusters.reduce((sum, c) => sum + c.flights.length, 0);
  main.innerHTML = `<header class="tr-heading"><div><h1>Viajes</h1><p>${fmt.number(clusters.length)} lugares · ${fmt.number(located)} vuelos con GPS</p></div><a class="ui-button ui-button--quiet" href="index.html">Ver vuelos ${icon('arrowR')}</a></header>
    <div class="tr-view ui-segmented" role="group" aria-label="Vista de viajes"><button aria-pressed="${!isMap}" data-view-link="trips.html">${icon('list')} Lista</button><button aria-pressed="${isMap}" data-view-link="trips.html?view=map">${icon('map')} Mapa</button></div>
    ${isMap && clusters.length ? '<div class="tr-map" id="trip-map" aria-label="Mapa de viajes"></div>' : ''}
    <div class="tr-places ${isMap ? 'tr-places-compact' : ''}">${clusters.map(c => `<article class="tr-place" data-place="${esc(c.key)}"><a href="${linkFor(c)}" class="tr-place-link" aria-label="Ver ${esc(c.name)}"><img ${c.coverUrl ? `src="${c.coverUrl}"` : 'hidden'} alt="Vista aérea de ${esc(c.name)}" data-transition-key="trip-${esc(c.key.replace(/[^\w-]/g, '-'))}"></a><div class="tr-place-copy"><div class="tr-place-title"><h2><a href="${linkFor(c)}">${esc(c.name)}</a></h2><button class="ui-button ui-button--quiet tr-more" data-menu="${esc(c.key)}" aria-label="Opciones de ${esc(c.name)}">${icon('more')}</button></div><p>${rangeFor(c)}</p><span>${esc(fmt.number(c.flights.length))} vuelos · ${esc(tripDistance(c.dist))} · ${esc(fmt.duration(c.dur))}</span></div></article>`).join('') || '<div class="ui-empty"><h2>Tus lugares aparecerán aquí</h2><p>Sube un vuelo con GPS para empezar tu diario.</p><a class="ui-button ui-button--primary" href="studio.html?via=subir">Subir video</a><p>Por ejemplo, tu próxima visita a los cerros.</p></div>'}</div>`;
  if (!isMap && clusters.length && matchMedia('(min-width:1024px)').matches) main.insertAdjacentHTML('beforeend', '<div class="tr-map tr-list-map" id="trip-map" aria-label="Mapa de los lugares visitados"></div>');
  if (document.getElementById('trip-map')) mountMap(clusters.flatMap(c => c.flights), true);
  bindActions();
}
function renderDetail(c) {
  main.classList.remove('tr-map-page');
  main.innerHTML = `${shell.backLink('Viajes', '/trips.html')}
    <header class="tr-detail-head"><div><h1>${esc(c.name)}</h1><p>${rangeFor(c)}</p></div><div class="tr-actions"><a class="ui-button ui-button--primary" href="${flightLink(c.cover)}">${icon('play')} Ver recorrido</a><button class="ui-button ui-button--quiet" data-menu="${esc(c.key)}" aria-label="Opciones de ${esc(c.name)}">${icon('more')}</button></div></header>
    <div class="tr-overview"><img class="tr-cover" ${c.coverUrl ? `src="${c.coverUrl}"` : 'hidden'} alt="Vista aérea de ${esc(c.name)}" data-transition-key="trip-${esc(c.key.replace(/[^\w-]/g, '-'))}"><div class="tr-map" id="trip-map" aria-label="Rutas del viaje"></div></div>
    <dl class="tr-facts"><div><dt>Vuelos</dt><dd>${figure(fmt.number(c.flights.length))}</dd></div><div><dt>En el aire</dt><dd>${figure(fmt.duration(c.dur))}</dd></div><div><dt>Recorrido</dt><dd>${figure(tripDistance(c.dist))}</dd></div><div><dt>Altura máxima</dt><dd>${figure(fmt.distance(c.alt))}</dd></div></dl>
    <section class="tr-recap" id="trip-recap" aria-busy="true"><h2>El viaje en una mirada</h2>${skeleton(2)}</section>
    <section class="tr-section"><h2>Diario de vuelos</h2><div id="tr-journal"></div>${c.flights.length > 10 ? `<button class="ui-button ui-button--secondary" id="tr-more-flights" aria-expanded="false">Ver los ${fmt.number(c.flights.length)} vuelos</button>` : ''}</section>`;
  mountMap(c.flights);
  let expanded = false;
  const journal = document.getElementById('tr-journal');
  function renderJournal() {
    const rows = expanded ? c.flights : c.flights.slice(0, 10);
    const dates = [...new Set(rows.map(f => f.date))];
    const content = dates.map(date => `<section class="tr-day"><h3>${fmt.date(date)}</h3><div class="tr-flights">${rows.filter(f => f.date === date).map(f => `<article class="tr-journal-clip" data-clip="${esc(f.clip_id)}"><a class="tr-flight" href="${flightLink(f)}"><img src="${esc(thumbnailURL(f))}" alt="" loading="lazy" data-transition-key="clip-${esc(f.clip_id)}"><span><strong>${esc(f.label || 'Vuelo')}</strong><span>${esc(f.time || '')} · ${esc(fmt.duration(f.duration_s))} · ${esc(fmt.distance(f.stats?.distance_m))}</span></span>${icon('arrowR')}</a><div class="tr-clip-insight" aria-busy="true"><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div></div></article>`).join('')}</div></section>`).join('');
    journal.innerHTML = content;
    loadJournalInsights(rows);
  }
  renderJournal();
  document.getElementById('tr-more-flights')?.addEventListener('click', e => {
    expanded = !expanded; renderJournal();
    e.currentTarget.textContent = expanded ? 'Mostrar menos' : `Ver los ${fmt.number(c.flights.length)} vuelos`;
    e.currentTarget.setAttribute('aria-expanded', String(expanded));
    if (!expanded) journal.scrollIntoView({ block: 'start' });
  });
  loadRecap(c);
  bindActions();
}
function mountMap(rows, pins = false, routes = routeData.routes || []) {
  const ids = new Set(rows.map(f => f.clip_id));
  const selected = routes.filter(r => ids.has(r.cid) && r.line?.length > 1);
  const bounds = new maplibregl.LngLatBounds();
  selected.forEach(r => r.line.forEach(point => bounds.extend(point)));
  if (bounds.isEmpty()) rows.forEach(f => { if (f.stats?.home) bounds.extend(f.stats.home); });
  if (bounds.isEmpty()) { document.getElementById('trip-map').innerHTML = '<p class="ui-empty">Sin rutas GPS para este viaje.</p>'; return; }
  const recent = !pins && (rows.map(f => selected.find(r => r.cid === f.clip_id)).find(Boolean));
  const recentBounds = recent ? recent.line.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds()) : bounds;
  // Request the next raster zoom level, while keeping the shared satellite style.
  const style = { ...SAT_STYLE, sources: { ...SAT_STYLE.sources, sat: { ...SAT_STYLE.sources.sat, tileSize: 128 } } };
  map = new maplibregl.Map({ ...mapSkinOptions, container: 'trip-map', style, cooperativeGestures: true, bounds, fitBoundsOptions: { padding: pins ? { top: 72, right: 124, bottom: 64, left: 52 } : { top: 32, right: 72, bottom: 80, left: 32 }, maxZoom: 17 } });
  mapSkin = skinMap(map);
  const current = map;
  let showRouteCounts = true, routeMarkers = [];
  function updateRouteCounts() {
    routeMarkers.forEach(marker => marker.remove()); routeMarkers = [];
    if (pins || !showRouteCounts) return;
    const groups = [];
    for (const route of selected) {
      const point = current.project(route.line[0]);
      let group = groups.find(g => Math.hypot(g.point.x - point.x, g.point.y - point.y) < 44);
      if (!group) { group = { point, routes: [] }; groups.push(group); }
      group.routes.push(route);
    }
    for (const group of groups) {
      const button = document.createElement('button'); button.className = 'tr-route-count';
      button.textContent = fmt.number(group.routes.length);
      button.setAttribute('aria-label', `Acercar ${group.routes.length} ${group.routes.length === 1 ? 'ruta' : 'rutas'}`);
      button.onclick = () => {
        const box = new maplibregl.LngLatBounds();
        group.routes.forEach(route => route.line.forEach(point => box.extend(point)));
        current.fitBounds(box, { padding: 72, maxZoom: 17, duration: document.documentElement.dataset.motion === 'reduced' ? 0 : 340 });
      };
      routeMarkers.push(new maplibregl.Marker({ element: button }).setLngLat(group.routes[0].line[0]).addTo(current));
    }
  }
  current.on('moveend', updateRouteCounts);
  current.on('remove', () => routeMarkers.forEach(marker => marker.remove()));
  if (recent) {
    const context = document.createElement('div'); context.className = 'tr-map-context';
    const flight = rows.find(f => f.clip_id === recent.cid);
    context.innerHTML = `<button class="ui-button ui-button--secondary" aria-pressed="true" title="Ruta reciente · ${fmt.date(flight?.date)}">Ver ruta reciente</button>`;
    current.getContainer().append(context);
    const toggle = context.querySelector('button'); toggle.disabled = true;
    current.once('load', () => { toggle.disabled = false; });
    current.once('remove', () => context.remove());
    context.querySelector('button').addEventListener('click', e => {
      const all = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(all));
      e.currentTarget.textContent = all ? 'Ver ruta reciente' : `Ver ${fmt.number(selected.length)} rutas`;
      for (const layer of ['routes', 'routes-halo']) if (current.getLayer(layer)) current.setFilter(layer, all ? null : ['==', 'cid', recent.cid]);
      showRouteCounts = all; updateRouteCounts();
      current.fitBounds(all ? bounds : recentBounds, { padding: { top: 32, right: 72, bottom: 100, left: 32 }, maxZoom: 17, duration: document.documentElement.dataset.motion === 'reduced' ? 0 : 340 });
    });
  }
  if (pins) {
    const legend = document.createElement('p'); legend.className = 'tr-map-legend';
    legend.innerHTML = '<span aria-hidden="true"><i></i><i></i></span>Tamaño según número de vuelos';
    current.getContainer().append(legend);
  }
  const resize = new ResizeObserver(() => current.resize()); resize.observe(document.getElementById('trip-map'));
  current.on('remove', () => resize.disconnect());
  current.on('load', () => {
    const features = selected.map(r => ({ type: 'Feature', properties: { cid: r.cid }, geometry: { type: 'LineString', coordinates: r.line } }));
    current.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    current.addLayer({ id: 'routes-halo', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': .85 } });
    current.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dataColor(), 'line-width': 4 } });
    updateRouteCounts();
    current.addLayer({ id: 'route-selected', type: 'line', source: 'routes', filter: ['in', 'cid', ''], paint: { 'line-color': dataColor(), 'line-width': 7 } });
    if (pins) clusters.forEach(c => {
      const el = document.createElement('a'); el.className = 'tr-pin'; el.href = linkFor(c);
      el.setAttribute('aria-label', `Ver ${c.name}, ${fmt.number(c.flights.length)} vuelos`);
      el.dataset.flightCount = String(c.flights.length);
      const largest = Math.max(...clusters.map(place => place.flights.length));
      el.style.setProperty('--pin-size', `${Math.max(16, 44 * Math.sqrt(c.flights.length / largest))}px`);
      el.innerHTML = `<span>${esc(c.name)} · ${fmt.number(c.flights.length)}</span><i aria-hidden="true"></i>`;
      new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([c.lon, c.lat]).addTo(current);
      const card = [...main.querySelectorAll('[data-place]')].find(node => node.dataset.place === c.key);
      const select = active => {
        card?.classList.toggle('tr-place-active', active); el.classList.toggle('tr-pin-active', active);
        current.setFilter('route-selected', ['in', 'cid', ...(active ? c.flights.map(f => f.clip_id) : [''])]);
      };
      for (const node of [el, card].filter(Boolean)) {
        node.addEventListener('mouseenter', () => select(true)); node.addEventListener('mouseleave', () => select(false));
        node.addEventListener('focusin', () => select(true)); node.addEventListener('focusout', () => select(false));
      }
    });
  });
}
async function loadJournalInsights(rows) {
  const entries = [...main.querySelectorAll('.tr-journal-clip')];
  const { insights, failed } = await loadInsights(rows);
  for (const entry of entries) {
    if (!entry.isConnected) continue;
    const insight = insights[entry.dataset.clip], flight = rows.find(f => f.clip_id === entry.dataset.clip);
    entry.querySelector('strong').textContent = flightCaption(flight, insight);
    const img = entry.querySelector('img'); img.src = thumbnailURL(flight); img.hidden = false;
    const region = entry.querySelector('.tr-clip-insight');
    region.innerHTML = clipChips(insight, { compact: true });
    region.setAttribute('aria-busy', 'false');
  }
  const journal = document.getElementById('tr-journal');
  if (journal && Object.values(insights).some(Boolean) && !journal.closest('.ui-suggested')) {
    const wrap = suggestedContent('<span>Diario</span>'); journal.before(wrap); wrap.querySelector('.ui-suggested-content').replaceChildren(journal);
  }
  if (failed && entries[0]?.isConnected) entries[0].querySelector('.tr-clip-insight').insertAdjacentHTML('beforeend', '<p class="w2-note">No se pudieron cargar algunas etiquetas.</p>');
}
function recapText(recap, trip) {
  const text = String(recap.summary || '');
  const ids = [...(recap.clip_ids || []), ...trip.flights.map(f => f.clip_id)].map(id => id.toLowerCase());
  // Omit complete technical sentences so partial IDs or scores cannot leave broken prose.
  const internal = /\b(?:DJI[_-][\w-]*|recon[_-][\w-]*|clip[_ -]?id|scores?|puntuaci[oó]n(?:es)?|puntajes?|calificaci[oó]n(?:es)?|valoraci[oó]n(?:es)?|selecci[oó]n de IA)\b|\b\d+(?:[.,]\d+)?\s*\/\s*(?:10|100)\b/i;
  const sentences = [...new Intl.Segmenter('es', { granularity: 'sentence' }).segment(text)]
    .map(part => part.segment.trim()).filter(sentence => !internal.test(sentence)
      && !ids.some(id => sentence.toLowerCase().includes(id)));
  const distance = recap.distance_m ?? trip.dist;
  const summary = sentences.join(' ').replace(/\b(\d+(?:[.,]\d+)*)\s*(?:metros?|m)\b/g, (match, number) => {
    const value = Number(number.includes(',') ? number.replaceAll('.', '').replace(',', '.') : number);
    return Math.abs(value - distance) < 1 ? tripDistance(distance) : match;
  });
  return summary || (text ? `${trip.flights.length} ${trip.flights.length === 1 ? 'vuelo' : 'vuelos'} · ${tripDistance(distance)} de recorrido.` : 'El resumen aún no está disponible.');
}
async function loadRecap(c) {
  const region = document.getElementById('trip-recap');
  try {
    const recap = await readAI(`/api/trip/${encodeURIComponent(c.recapKey)}/recap`);
    if (!region.isConnected) return;
    const { insights } = await loadInsights(c.flights);
    if (!region.isConnected) return;
    // Spread frames across dates and clips; never turn a zero timestamp into a highlight.
    const chosen = [], used = new Set();
    const dates = [...c.dates].reverse();
    const candidates = dates.map(date => c.flights.filter(f => f.date === date).sort((a, b) => (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0)));
    for (let i = 0; i < c.flights.length && chosen.length < 6; i++) {
      for (const group of candidates) {
        const f = group[i]; if (!f || used.has(f.clip_id)) continue;
        const cover = await bestCover(f, insights[f.clip_id]);
        if (!cover) continue;
        chosen.push({ flight: f, time: cover.time, url: cover.url, caption: flightCaption(f, insights[f.clip_id]) }); used.add(f.clip_id);
        if (chosen.length === 6) break;
      }
    }
    region.innerHTML = '<h2>El viaje en una mirada</h2>';
    region.append(suggestedContent(`<p class="tr-summary">${esc(recapText(recap, c))}</p><div class="tr-frames">${chosen.map(({ flight: f, time, url, caption }) => `<a href="${flightLink(f)}&t=${time}"><img src="${url}" alt="${esc(caption)}" loading="lazy"><span>${esc(caption)}</span><small>${fmt.date(f.date)} · ${fmt.clock(time)}</small></a>`).join('')}</div>`));
    const routes = (recap.route || []).map(r => ({ cid: r.clip_id, line: r.coordinates }));
    if (routes.length) { mapSkin?.destroy(); map?.remove(); map = null; mountMap(c.flights, false, routes); }
  } catch { if (!region.isConnected) return; if (!map) mountMap(c.flights); region.innerHTML = '<h2>El viaje en una mirada</h2><p class="w2-note">No se pudo cargar el resumen. <button class="ui-button ui-button--quiet">Reintentar</button></p>'; region.querySelector('button').addEventListener('click', () => loadRecap(c)); }
  finally { region.setAttribute('aria-busy', 'false'); }
}
function bindActions() {
  main.querySelectorAll('[data-view-link]').forEach(button => button.addEventListener('click', () => { location.href = button.dataset.viewLink; }));
  main.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', () => {
    const c = clusters.find(c => c.key === button.dataset.menu);
    openMenu(button, [{ id: 'rename', label: 'Renombrar', icon: 'edit' }, { id: 'cover', label: 'Elegir portada', icon: 'image' }, { id: 'postal', label: 'Descargar postal', icon: 'dl' }], { onSelect: id => id === 'rename' ? renameCity(c) : id === 'cover' ? pickCover(c) : makePostal(c, button) });
  }));
  main.querySelectorAll('[data-postal]').forEach(button => button.addEventListener('click', () => makePostal(clusters.find(c => c.key === button.dataset.postal), button)));
}
function renameCity(c) {
  const node = document.createElement('form'); node.className = 'tr-form';
  node.innerHTML = `<label for="tm-name">Nombre del lugar</label><input class="ctl" id="tm-name" maxlength="60" value="${esc(c.name)}" required><p role="alert" class="tr-error" hidden></p><button class="ui-button ui-button--primary" type="submit">Guardar</button>`;
  const close = openPageSheet(node, { title: 'Renombrar lugar', size: 'half', initialFocus: '#tm-name' });
  node.addEventListener('submit', async e => {
    e.preventDefault(); const button = node.querySelector('button'); button.disabled = true;
    try { const name = node.querySelector('input').value.trim(); if (!name) throw new Error('Escribe un nombre.'); await save('/api/trip_meta', { key: c.key, name }); c.name = name; close(); render(); }
    catch (error) { const p = node.querySelector('[role=alert]'); p.textContent = error.message; p.hidden = false; }
    finally { button.disabled = false; }
  });
}
function pickCover(c) {
  const node = document.createElement('div');
  node.innerHTML = `<p>Elige la imagen que abre este viaje.</p><p class="tr-error" role="alert" hidden></p><div class="tr-cover-options">${c.flights.map(f => `<button class="tr-cover-option" data-pick="${esc(f.clip_id)}" aria-pressed="${c.cover.clip_id === f.clip_id}"><img src="${frameFor(f)}" alt=""><span>${esc(flightTitle(f))}${c.cover.clip_id === f.clip_id ? ' · Portada actual' : ''}</span></button>`).join('')}</div>`;
  const close = openPageSheet(node, { title: `Portada de ${c.name}`, size: 'full' });
  node.addEventListener('click', async e => {
    const button = e.target.closest('[data-pick]'); if (!button) return;
    node.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await save('/api/trip_meta', { key: c.key, cover: button.dataset.pick }); c.cover = c.flights.find(f => f.clip_id === button.dataset.pick); c.coverTime = undefined; c.coverUrl = frameFor(c.cover); close(); render(); }
    catch (error) { const p = node.querySelector('[role=alert]'); p.textContent = error.message; p.hidden = false; }
    finally { node.querySelectorAll('button').forEach(b => b.disabled = false); }
  });
}
  async function makePostal(c, btn) {
    if (btn._busy) return;                                // doble-click en vuelo corrompía el botón (#16)
    btn._busy = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '…';
    try {
      if (!c.coverUrl) throw new Error('No cover');
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = c.coverUrl; });
      const cv = document.createElement('canvas');
      cv.width = 1080;
      cv.height = 1350;                                       // 4:5 para redes
      const x = cv.getContext('2d');
      const sc = Math.max(cv.width / img.width, cv.height / img.height);
      x.drawImage(img, (cv.width - img.width * sc) / 2, (cv.height - img.height * sc) / 2,
                  img.width * sc, img.height * sc);
      const g = x.createLinearGradient(0, cv.height * 0.45, 0, cv.height);
      g.addColorStop(0, 'rgba(6,9,14,0)');
      g.addColorStop(1, 'rgba(6,9,14,0.92)');
      x.fillStyle = g;
      x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#fff';
      await document.fonts.ready;
      x.font = '700 84px AeroBrain Sans';
      x.fillText(c.name, 60, cv.height - 180);
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.font = '400 34px AeroBrain Sans';
      x.fillText(`${c.flights.length} vuelos · ${tripDistance(c.dist)} · alt máx ${Math.round(c.alt)} m`, 62, cv.height - 118);
      x.fillText(`${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''} · AeroBrain`, 62, cv.height - 66);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
      const file = new File([blob], `${c.name.replace(/\W+/g, '_')}_postal.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
    } catch (err) { if (err?.name !== 'AbortError') toast('No se pudo generar la postal.'); }
    btn.innerHTML = orig; btn._busy = false;
  }



load();
