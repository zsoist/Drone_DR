// Mapa de experiencias — split view estilo Airbnb: mapa + tarjetas sincronizadas,
// spots agrupados por lugar, filtros, y modal de preview con video.
const main = renderShell('map.html');
main.innerHTML = `
  <div class="page-head"><h1>Mapa de vuelos</h1><span class="count" id="count"></span>
    <span class="spacer"></span>
    <div class="seg" role="group"><button id="st-sat" class="on">Satélite</button><button id="st-dark">Oscuro</button></div>
  </div>
  <div class="panel map-wrap">
    <div style="position:relative;min-height:0">
      <div id="map" style="position:absolute;inset:0"></div>
      <button class="map-recenter" id="mv-fit" title="Ver todos los vuelos">${icon('map')}</button>
    </div>
    <aside class="map-side">
      <div class="map-filters">
        <input class="ctl" id="mf-q" placeholder="Buscar vuelo o lugar…" style="width:100%;margin-bottom:8px">
        <div class="tool-row" style="padding:0">
          <button class="chip" data-mf="video">Video</button>
          <button class="chip" data-mf="model">3D</button>
          <button class="chip" data-mf="ai">AI</button>
          <button class="chip" data-mf="alto">+100 m</button>
          <button class="chip" id="mf-spot" style="display:none"></button>
        </div>
      </div>
      <div class="map-cards" id="cards"></div>
    </aside>
  </div>`;

(async () => {
  const flights = (await getFlights()).filter(f => f.has_srt && f.stats.bbox);
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  const models = new Set((sys.models || []).map(m => m.clip_id));
  document.getElementById('count').textContent = `${flights.length} vuelos con GPS`;

  // ---------- spots: agrupa vuelos por lugar (~500 m de grilla) ----------
  const spots = {};
  flights.forEach(f => {
    if (!f.stats.home) return;
    const key = `${Math.round(f.stats.home[0] / 0.005)}:${Math.round(f.stats.home[1] / 0.005)}`;
    (spots[key] ??= { key, flights: [], lng: 0, lat: 0 }).flights.push(f);
  });
  Object.values(spots).forEach(s => {
    s.lng = s.flights.reduce((a, f) => a + f.stats.home[0], 0) / s.flights.length;
    s.lat = s.flights.reduce((a, f) => a + f.stats.home[1], 0) / s.flights.length;
    s.name = s.flights.find(f => f.label)?.label ||
             `${fmt.date(s.flights[0].date)}${s.flights.length > 1 ? ` +${s.flights.length - 1}` : ''}`;
  });

  // ---------- mapa ----------
  const bounds = new maplibregl.LngLatBounds();
  flights.forEach(f => { bounds.extend([f.stats.bbox[0], f.stats.bbox[1]]); bounds.extend([f.stats.bbox[2], f.stats.bbox[3]]); });
  const map = new maplibregl.Map({
    container: 'map', style: SAT_STYLE, bounds, fitBoundsOptions: { padding: 60 },
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // el contenedor cambia de tamaño despues del primer layout: sin esto el canvas
  // queda corto y el panel muestra una banda muerta abajo
  new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));
  map.once('load', () => map.resize());
  setTimeout(() => map.resize(), 450);
  document.getElementById('mv-fit').addEventListener('click', () => {
    state.spot = null;
    syncSpotChip();
    render();
    map.fitBounds(bounds, { padding: 60, duration: 1400 });
  });

  const spotEls = {};
  function drawRoutes() {
    fetch(`${DATA}/manifest/routes.json`).then(r => r.json()).then(({ routes }) => {
      if (map.getSource('routes')) return;
      const features = routes.map(r => ({
        type: 'Feature', properties: { cid: r.cid },
        geometry: { type: 'LineString', coordinates: r.line },
      }));
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 6, 'line-opacity': 0.18 } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 1.8, 'line-opacity': 0.9 } });
      // capa de resaltado: se enciende al pasar por una tarjeta
      map.addLayer({ id: 'routes-hl', type: 'line', source: 'routes',
                     filter: ['==', 'cid', ''],
                     paint: { 'line-color': '#FFD166', 'line-width': 4, 'line-opacity': 0.95 } });
      map.on('click', 'routes', e => {
        const f = flights.find(x => x.clip_id === e.features[0].properties.cid);
        if (f) openPreview(f);
      });
      map.on('mouseenter', 'routes', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'routes', () => { map.getCanvas().style.cursor = ''; });
    });
    // pins-píldora por spot (estilo Airbnb) — los markers DOM sobreviven el cambio de estilo
    if (Object.keys(spotEls).length) return;
    Object.values(spots).forEach(s => {
      const el = document.createElement('button');
      el.className = 'spot-pill';
      el.innerHTML = `${icon('drone')} ${esc(s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name)}
        ${s.flights.length > 1 ? `<b>${s.flights.length}</b>` : ''}`;
      el.addEventListener('click', () => {
        state.spot = state.spot === s.key ? null : s.key;
        syncSpotChip();
        render();
        if (state.spot) map.flyTo({ center: [s.lng, s.lat], zoom: 15.5, speed: 1.3, curve: 1.5 });
      });
      spotEls[s.key] = el;
      new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }
  map.on('load', drawRoutes);

  document.getElementById('st-sat').addEventListener('click', () => setStyle('sat'));
  document.getElementById('st-dark').addEventListener('click', () => setStyle('dark'));
  function setStyle(k) {
    document.getElementById('st-sat').classList.toggle('on', k === 'sat');
    document.getElementById('st-dark').classList.toggle('on', k === 'dark');
    map.setStyle(k === 'sat' ? SAT_STYLE : DARK_STYLE);
    map.once('styledata', () => setTimeout(drawRoutes, 100));
  }

  // ---------- filtros + tarjetas ----------
  const state = { q: '', has: new Set(), spot: null };
  function syncSpotChip() {
    const c = document.getElementById('mf-spot');
    if (state.spot) {
      c.style.display = '';
      c.classList.add('on');
      c.textContent = `✕ ${spots[state.spot].name}`;
    } else c.style.display = 'none';
    Object.entries(spotEls).forEach(([k, el]) => el.classList.toggle('on', k === state.spot));
  }
  const filtered = () => flights.filter(f => {
    if (state.spot && !spots[state.spot].flights.includes(f)) return false;
    if (state.has.has('video') && !f.has_proxy) return false;
    if (state.has.has('model') && !models.has(f.clip_id)) return false;
    if (state.has.has('ai') && !f.ai) return false;
    if (state.has.has('alto') && (f.stats.max_rel_alt_m || 0) < 100) return false;
    const hay = `${f.label || ''} ${f.date || ''} ${f.clip_id}`.toLowerCase();
    return !state.q || hay.includes(state.q);
  });

  function render() {
    const rows = filtered();
    document.getElementById('cards').innerHTML = rows.map(f => `
      <div class="mcard rise" data-cid="${esc(f.clip_id)}">
        <img src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="">
        <div class="mc-b">
          <b>${esc(f.label) || fmt.date(f.date) + ' · ' + (f.time || '')}</b>
          <span class="mono">${fmt.dur(f.duration_s)} · ${Math.round(f.stats.max_rel_alt_m || 0)} m · ${fmt.km(f.stats.distance_m || 0)}</span>
          <div class="mc-badges">
            ${f.has_proxy ? `<span class="chip">${icon('play')} video</span>` : ''}
            ${models.has(f.clip_id) ? `<span class="chip">${icon('cube')} 3D</span>` : ''}
            ${f.ai ? `<span class="chip">${icon('spark')} AI</span>` : ''}
          </div>
        </div>
      </div>`).join('') || '<p class="footer-note" style="padding:14px">Nada con esos filtros.</p>';
  }
  render();

  document.getElementById('mf-q').addEventListener('input', e => { state.q = e.target.value.toLowerCase(); render(); });
  main.querySelectorAll('[data-mf]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    state.has.has(b.dataset.mf) ? state.has.delete(b.dataset.mf) : state.has.add(b.dataset.mf);
    render();
  }));
  document.getElementById('mf-spot').addEventListener('click', () => { state.spot = null; syncSpotChip(); render(); });

  // hover tarjeta → resalta la ruta en el mapa; click → vuela + preview
  const cards = document.getElementById('cards');
  cards.addEventListener('pointerover', e => {
    const c = e.target.closest('.mcard');
    if (map.getLayer('routes-hl')) map.setFilter('routes-hl', ['==', 'cid', c ? c.dataset.cid : '']);
  });
  cards.addEventListener('pointerleave', () => {
    if (map.getLayer('routes-hl')) map.setFilter('routes-hl', ['==', 'cid', '']);
  });
  cards.addEventListener('click', e => {
    const c = e.target.closest('.mcard');
    if (!c) return;
    const f = flights.find(x => x.clip_id === c.dataset.cid);
    if (f.stats.home) map.flyTo({ center: f.stats.home, zoom: 16, speed: 1.4, curve: 1.5 });
    openPreview(f);
  });

  // ---------- modal de preview ----------
  function openPreview(f) {
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
          ${f.stats.max_speed_ms ? `<span class="chip">${Math.round(f.stats.max_speed_ms * 3.6)} km/h</span>` : ''}
        </div>
        ${f.ai?.summary ? `<p class="footer-note" style="margin:10px 0 0">${esc(f.ai.summary)}</p>` : ''}
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
})();
