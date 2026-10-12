import { loadFlights, registerFlights, registerPaletteSource, frameFor, skeleton, renderFailure, openPageSheet, save, suggestion, wireSuggestions, dataColor } from './home-shared.js?v=383';
const main = renderShell('trips.html');
main.classList.add('tr-page');
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


let clusters = [], flights = [], tripsMeta = {}, routeData = [], map = null;
document.addEventListener('ab-theme-change', () => { if (map?.getLayer('routes')) map.setPaintProperty('routes', 'line-color', dataColor()); });
const params = () => new URLSearchParams(location.search);
const linkFor = c => `trips.html?trip=${encodeURIComponent(c.key)}`;
const flightLink = f => `flight.html?id=${encodeURIComponent(f.clip_id)}`;
const flightTitle = f => f.label || `${fmt.date(f.date)} · ${f.time || 'Vuelo'}`;
const rangeFor = c => `${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates.at(-1)) : ''}`;

async function optionalJSON(url, fallback) {
  try { const r = await authFetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; }
}
async function load() {
  main.innerHTML = `<h1>Viajes</h1>${skeleton(2)}`;
  try {
    flights = (await loadFlights()).filter(f => !f.archived);
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
    render();
  } catch { renderFailure(main, load); }
}
function render() {
  map?.remove(); map = null;
  const selected = params().get('trip');
  if (selected) {
    const c = clusters.find(c => c.key === selected);
    if (c) { renderDetail(c); return; }
    main.innerHTML = '<div class="ui-empty"><h1>Viaje no encontrado</h1><p>Abre un lugar de tu lista de viajes.</p><a class="ui-button ui-button--primary" href="trips.html">Ver viajes</a></div>';
    return;
  }
  const isMap = params().get('view') === 'map';
  main.innerHTML = `<header class="tr-heading"><div><h1>Viajes</h1><p>${clusters.length} lugares · ${flights.length} vuelos</p></div><a class="ui-button ui-button--primary" href="index.html">Ver vuelos ${icon('arrowR')}</a></header>
    <nav class="tr-view ui-segmented" aria-label="Vista de viajes"><a class="ui-button ui-button--quiet" ${!isMap ? 'aria-current="page"' : ''} href="trips.html">${icon('list')} Lista</a><a class="ui-button ui-button--quiet" ${isMap ? 'aria-current="page"' : ''} href="trips.html?view=map">${icon('map')} Mapa</a></nav>
    ${isMap && clusters.length ? '<div class="tr-map" id="trip-map" aria-label="Mapa de viajes"></div>' : ''}
    <div class="tr-places ${isMap ? 'tr-places-compact' : ''}">${clusters.map(c => `<article class="tr-place"><a href="${linkFor(c)}" class="tr-place-link"><img src="${frameFor(c.cover, c.coverTime)}" alt="Vista aérea de ${esc(c.name)}" data-transition-key="trip-${esc(c.key.replace(/[^\w-]/g, '-'))}"><div class="tr-place-copy"><h2>${esc(c.name)}</h2><p>${rangeFor(c)}</p><span>${c.flights.length} vuelos · ${fmt.km(c.dist)} · ${fmt.hours(c.dur)}</span></div></a><button class="ui-button ui-button--quiet tr-more" data-menu="${esc(c.key)}" aria-label="Opciones de ${esc(c.name)}">${icon('more')}</button></article>`).join('') || '<div class="ui-empty"><h2>Tus lugares aparecerán aquí</h2><p>Sube un vuelo con GPS para empezar tu diario.</p><a class="ui-button ui-button--primary" href="studio.html?via=subir">Subir video</a><p>Por ejemplo, tu próxima visita a los cerros.</p></div>'}</div>`;
  if (isMap && clusters.length) mountMap(clusters.flatMap(c => c.flights), true);
  bindActions();
}
function renderDetail(c) {
  const highlights = c.flights.flatMap(f => (f.ai?.highlights || []).map(h => ({ f, h })))
    .sort((a, b) => (b.f.ai?.travel_score || 0) - (a.f.ai?.travel_score || 0)).slice(0, 6);
  const dates = [...c.dates].reverse();
  main.innerHTML = `<a class="ui-button ui-button--quiet tr-back" href="trips.html">${icon('arrowL')} Viajes</a>
    <header class="tr-detail-head"><div><h1>${esc(c.name)}</h1><p>${rangeFor(c)}</p></div><div class="tr-actions"><button class="ui-button ui-button--primary" data-postal="${esc(c.key)}">${icon('dl')} Descargar postal</button><button class="ui-button ui-button--quiet" data-menu="${esc(c.key)}" aria-label="Opciones de ${esc(c.name)}">${icon('more')}</button></div></header>
    <div class="tr-overview"><img class="tr-cover" src="${frameFor(c.cover, c.coverTime)}" alt="Vista aérea de ${esc(c.name)}" data-transition-key="trip-${esc(c.key.replace(/[^\w-]/g, '-'))}"><div class="tr-map" id="trip-map" aria-label="Rutas del viaje"></div></div>
    <dl class="tr-facts"><div><dt>Vuelos</dt><dd>${c.flights.length}</dd></div><div><dt>En el aire</dt><dd>${fmt.hours(c.dur)}</dd></div><div><dt>Recorrido</dt><dd>${fmt.km(c.dist)}</dd></div><div><dt>Altura máxima</dt><dd>${Math.round(c.alt)} m</dd></div></dl>
    <section class="tr-recap"><h2>El viaje en una mirada</h2>${c.best.ai?.summary ? suggestion(`trip-${c.key}`, `Del vuelo destacado: ${c.best.ai.summary}`, flightLink(c.best)) : '<p class="w2-note">Sin análisis aún. Cuando esté listo, verás el resumen y los mejores momentos.</p>'}</section>
    <section class="tr-section"><h2>Mejores momentos</h2>${highlights.length ? `<p class="w2-note">Sugerido a partir de tus vuelos analizados.</p><div class="tr-frames">${highlights.map(({ f, h }) => `<a href="${flightLink(f)}&t=${Math.max(0, +h.t || 0)}"><img src="${frameFor(f, h.t)}" alt="${esc(h.reason || 'Momento destacado')}" loading="lazy"><span>${fmt.dur(h.t)} · ${esc(h.reason || 'Ver momento')}</span></a>`).join('')}</div>` : '<p class="w2-note">Sin análisis aún. Abre un vuelo para marcar un momento.</p>'}</section>
    <section class="tr-section"><h2>Diario de vuelos</h2>${dates.map(date => `<section class="tr-day"><h3>${fmt.date(date)}</h3><div class="tr-flights">${c.flights.filter(f => f.date === date).map(f => `<a class="tr-flight" href="${flightLink(f)}"><img src="${frameFor(f)}" alt="" loading="lazy" data-transition-key="clip-${esc(f.clip_id)}"><span><strong>${esc(flightTitle(f))}</strong><span>${fmt.dur(f.duration_s)} · ${fmt.km(f.stats?.distance_m || 0)}</span></span>${icon('arrowR')}</a>`).join('')}</div></section>`).join('')}</section>`;
  mountMap(c.flights);
  bindActions();
}
function mountMap(rows, pins = false) {
  const bounds = new maplibregl.LngLatBounds();
  rows.forEach(f => { if (f.stats?.bbox) { bounds.extend(f.stats.bbox.slice(0, 2)); bounds.extend(f.stats.bbox.slice(2)); } });
  if (bounds.isEmpty()) { document.getElementById('trip-map').innerHTML = '<p class="ui-empty">Sin rutas GPS para este viaje.</p>'; return; }
  map = new maplibregl.Map({ container: 'trip-map', style: SAT_STYLE, cooperativeGestures: true, bounds, fitBoundsOptions: { ...FIT_OPTS, padding: pins ? { top: 128, right: 112, bottom: 80, left: 80 } : 64 }, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const current = map;
  current.on('load', () => {
    const ids = new Set(rows.map(f => f.clip_id));
    const features = (routeData.routes || []).filter(r => ids.has(r.cid)).map(r => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.line } }));
    current.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    current.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': dataColor(), 'line-width': 3 } });
    if (pins) clusters.forEach(c => {
      const el = document.createElement('a'); el.className = 'ui-button ui-button--secondary tr-pin'; el.href = linkFor(c); el.textContent = c.name;
      new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(current);
    });
  });
}
function bindActions() {
  main.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', () => {
    const c = clusters.find(c => c.key === button.dataset.menu);
    openMenu(button, [{ id: 'rename', label: 'Renombrar', icon: 'edit' }, { id: 'cover', label: 'Elegir portada', icon: 'image' }, { id: 'postal', label: 'Descargar postal', icon: 'dl' }], { onSelect: id => id === 'rename' ? renameCity(c) : id === 'cover' ? pickCover(c) : makePostal(c, button) });
  }));
  main.querySelectorAll('[data-postal]').forEach(button => button.addEventListener('click', () => makePostal(clusters.find(c => c.key === button.dataset.postal), button)));
}
function renameCity(c) {
  const node = document.createElement('form'); node.className = 'tr-form';
  node.innerHTML = `<label for="tm-name">Nombre del lugar</label><input class="ctl" id="tm-name" maxlength="60" value="${esc(c.name)}" required><p role="alert" class="tr-error" hidden></p><button class="ui-button ui-button--primary" type="submit">Guardar</button>`;
  const close = openPageSheet(node, { title: 'Renombrar lugar', size: 'half' });
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
    try { await save('/api/trip_meta', { key: c.key, cover: button.dataset.pick }); c.cover = c.flights.find(f => f.clip_id === button.dataset.pick); c.coverTime = undefined; close(); render(); }
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
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = frameFor(c.cover || c.best, c.coverTime); });
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
      x.font = '400 34px JetBrains Mono';
      x.fillText(`${c.flights.length} vuelos · ${fmt.km(c.dist)} · alt máx ${Math.round(c.alt)} m`, 62, cv.height - 118);
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


wireSuggestions(main);
load();
