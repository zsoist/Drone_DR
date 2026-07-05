// Flight view: satellite map + video, synced through the 1Hz GPS track.
// track.points[i] corresponds to second i of the video (SRT is frame-aligned).
const DATA = 'data';
const id = new URLSearchParams(location.search).get('id');

const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function main() {
  const [meta, track] = await Promise.all([
    fetch(`${DATA}/manifest/${id}.json`).then(r => r.json()),
    fetch(`${DATA}/tracks/${id}.flight.json`).then(r => r.ok ? r.json() : null),
  ]);

  document.getElementById('title').textContent =
    `${meta.stats.start?.slice(0, 16) || meta.clip_id}`;
  document.getElementById('subtitle').textContent =
    `${fmtKm(meta.stats.distance_m || 0)} · ${Math.round(meta.stats.max_rel_alt_m || 0)}m · ${meta.resolution}`;

  // --- video (proxy if the clip earned one) ---
  const slot = document.getElementById('video-slot');
  let video = null;
  if (meta.has_proxy ?? meta.proxy_bytes) {
    slot.innerHTML = `<video src="${DATA}/proxies/${id}.mp4" controls playsinline
                        poster="${DATA}/thumbs/${id}.jpg"></video>`;
    video = slot.querySelector('video');
  } else {
    slot.innerHTML = `<img src="${DATA}/thumbs/${id}.jpg" style="width:100%;display:block">
      <p class="no-proxy">Clip en tier "${meta.tier}" — sin proxy web. Reprocesa como "full" para ver el video.</p>`;
  }

  if (!track || !track.points.length) return;
  const pts = track.points;
  const coords = pts.map(p => [p.lon, p.lat]);

  // cumulative distance per second, so the HUD can show progress
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));

  // --- map: free Esri satellite tiles, no API key ---
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri World Imagery',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
    bounds: meta.stats.bbox ? [[meta.stats.bbox[0], meta.stats.bbox[1]], [meta.stats.bbox[2], meta.stats.bbox[3]]] : undefined,
    fitBoundsOptions: { padding: 60 },
    attributionControl: { compact: true },
  });

  map.on('load', () => {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    });
    map.addLayer({
      id: 'route-glow', type: 'line', source: 'route',
      paint: { 'line-color': '#4cc2ff', 'line-width': 7, 'line-opacity': 0.25 },
    });
    map.addLayer({
      id: 'route', type: 'line', source: 'route',
      paint: { 'line-color': '#4cc2ff', 'line-width': 2.5 },
    });

    const el = document.createElement('div');
    el.textContent = '🛸';
    el.style.cssText = 'font-size:26px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.8));cursor:pointer';
    const marker = new maplibregl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);

    const hud = {
      alt: document.getElementById('h-alt'),
      dist: document.getElementById('h-dist'),
      speed: document.getElementById('h-speed'),
      iso: document.getElementById('h-iso'),
    };
    function showPoint(i) {
      i = Math.max(0, Math.min(i, pts.length - 1));
      const p = pts[i];
      marker.setLngLat([p.lon, p.lat]);
      hud.alt.textContent = `${p.rel_alt.toFixed(0)} m`;
      hud.dist.textContent = fmtKm(cum[i]);
      const v = i > 0 ? haversine(pts[i - 1], pts[i]) : 0; // m over 1s = m/s
      hud.speed.textContent = `${(v * 3.6).toFixed(0)} km/h`;
      hud.iso.textContent = p.iso;
    }
    showPoint(0);

    if (video) {
      // 1Hz track ⇒ the point index IS the floor of currentTime
      video.addEventListener('timeupdate', () => showPoint(Math.floor(video.currentTime)));
      // click the route to seek the video there
      map.on('click', 'route', e => {
        let best = 0, bestD = Infinity;
        coords.forEach(([lon, lat], i) => {
          const d = (lon - e.lngLat.lng) ** 2 + (lat - e.lngLat.lat) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        });
        video.currentTime = best;
        video.play();
      });
      map.on('mouseenter', 'route', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'route', () => map.getCanvas().style.cursor = '');
    }
  });
}

main().catch(e => {
  document.getElementById('video-slot').innerHTML =
    `<p class="no-proxy">Error: ${e.message}</p>`;
});
