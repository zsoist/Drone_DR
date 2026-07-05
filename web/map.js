// Mapa global: todas las rutas de vuelo, popups con ficha, toggle satélite/oscuro.
const main = renderShell('map.html');
main.innerHTML = `
  <div class="page-head"><h1>Mapa de vuelos</h1><span class="count" id="count"></span>
    <span class="spacer"></span>
    <div class="seg" role="group"><button id="st-sat" class="on">Satélite</button><button id="st-dark">Oscuro</button></div>
  </div>
  <div class="panel"><div id="map" style="height:calc(100dvh - 190px);min-height:420px"></div></div>`;

(async () => {
  const flights = (await getFlights()).filter(f => f.has_srt && f.stats.bbox);
  document.getElementById('count').textContent = `${flights.length} vuelos con GPS`;

  const bounds = new maplibregl.LngLatBounds();
  flights.forEach(f => { bounds.extend([f.stats.bbox[0], f.stats.bbox[1]]); bounds.extend([f.stats.bbox[2], f.stats.bbox[3]]); });

  const map = new maplibregl.Map({
    container: 'map', style: SAT_STYLE, bounds, fitBoundsOptions: { padding: 60 },
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  async function drawRoutes() {
    const tracks = await Promise.all(flights.map(f =>
      fetch(`${DATA}/tracks/${f.clip_id}.flight.json`).then(r => r.json()).catch(() => null)));
    const features = tracks.map((t, i) => t && {
      type: 'Feature',
      properties: { cid: flights[i].clip_id },
      geometry: { type: 'LineString', coordinates: t.points.map(p => [p.lon, p.lat]) },
    }).filter(Boolean);
    if (map.getSource('routes')) return;
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 6, 'line-opacity': 0.18 } });
    map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#45A0E6', 'line-width': 1.8, 'line-opacity': 0.9 } });
    map.on('click', 'routes', e => {
      const f = flights.find(x => x.clip_id === e.features[0].properties.cid);
      new maplibregl.Popup({ closeButton: false, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(`<a href="flight.html?id=${f.clip_id}" style="display:block">
          <img src="${DATA}/thumbs/${f.clip_id}.jpg" style="width:100%;border-radius:6px" alt="">
          <b style="display:block;margin-top:6px;font-size:13px">${fmt.date(f.date)} · ${f.time}</b>
          <span style="font-size:11.5px;color:#8A97A8">${fmt.km(f.stats.distance_m || 0)} · ${Math.round(f.stats.max_rel_alt_m || 0)}m · ${fmt.dur(f.duration_s)}</span>
        </a>`).addTo(map);
    });
    map.on('mouseenter', 'routes', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'routes', () => map.getCanvas().style.cursor = '');
    // marcador de despegue por vuelo (los markers DOM sobreviven al cambio de estilo)
    if (window._homeMarkers) return;
    window._homeMarkers = true;
    flights.forEach(f => {
      if (!f.stats.home) return;
      const el = document.createElement('div');
      el.innerHTML = `<svg width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="#0A0C10" stroke="#45A0E6" stroke-width="2"/></svg>`;
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => { location.href = `flight.html?id=${f.clip_id}`; });
      new maplibregl.Marker({ element: el }).setLngLat(f.stats.home).addTo(map);
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
})();
