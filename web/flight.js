// Vista de vuelo: player + mapa sincronizado + charts + filmstrip + panel AI.
const main = renderShell('index.html');
const cid = new URLSearchParams(location.search).get('id');

(async () => {
  const flights = await getFlights();
  const idx = flights.findIndex(f => f.clip_id === cid);
  const meta = flights[idx];
  if (!meta) { main.innerHTML = `<div class="empty">${icon('warn')}<p>Vuelo no encontrado.</p></div>`; return; }
  const [aiData, track] = await Promise.all([
    getAI(cid),
    meta.has_srt ? fetch(`${DATA}/tracks/${cid}.flight.json`).then(r => r.json()) : null,
  ]);
  const pts = track?.points || [];
  const s = meta.stats || {};
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const speeds = pts.map((p, i) => i ? haversine(pts[i - 1], p) * 3.6 : 0);

  main.innerHTML = `
    <div class="page-head">
      <a class="btn" href="index.html">${icon('chevL')} Vuelos</a>
      <h1>${fmt.date(meta.date)} · ${meta.time}</h1>
      <span class="count mono">${cid}</span>
      <span class="spacer"></span>
      <span class="tierdot ${meta.tier}" style="position:static"><i></i>${meta.tier}</span>
    </div>

    <div class="fl-layout">
      <div>
        <div class="panel videobox">
          <div id="video-slot"></div>
          <div class="hud" id="hud"></div>
        </div>
        ${meta.frame_count ? `<div class="panel" style="margin-top:16px">
          <div class="ph">${icon('film')} Filmstrip — click para saltar</div>
          <div class="filmstrip" id="strip"></div>
        </div>` : ''}
        ${pts.length ? `<div class="panel" style="margin-top:16px">
          <div class="ph">${icon('activity')} Telemetría — click para saltar</div>
          <div class="pb" style="padding:0">
            <div class="chart-wrap" id="ch-alt"></div>
            <div class="chart-wrap" id="ch-speed" style="border-top:1px solid var(--line)"></div>
          </div>
        </div>` : ''}
      </div>

      <div>
        <div class="panel"><div id="map"></div></div>

        ${aiData ? `<div class="panel" style="margin-top:16px">
          <div class="ph">${icon('spark')} Análisis AI</div>
          <div class="pb">
            <div class="gauge">${scoreRing(aiData.travel_score)}<p>${aiData.summary || ''}</p></div>
            ${aiData.tags?.length ? `<div class="chips" style="margin-top:12px">
              ${aiData.tags.map(t => `<a class="chip" href="index.html?q=${encodeURIComponent(t)}">${t}</a>`).join('')}
            </div>` : ''}
            ${aiData.highlights?.length ? `<div style="margin-top:8px">
              ${aiData.highlights.map(h => `<div class="hl-item">
                <button class="tc" data-t="${h.t}">${fmt.dur(h.t)}</button><p>${h.reason}</p>
              </div>`).join('')}
            </div>` : ''}
          </div>
        </div>` : ''}

        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('gauge')} Datos técnicos</div>
          <div class="pb"><table class="kv">
            <tr><td>Resolución</td><td>${meta.resolution} @ ${meta.fps}fps</td></tr>
            <tr><td>Original</td><td>${fmt.gb(meta.size_bytes)}</td></tr>
            ${meta.proxy_bytes ? `<tr><td>Proxy web</td><td>${fmt.gb(meta.proxy_bytes)}</td></tr>` : ''}
            <tr><td>Distancia</td><td>${fmt.km(s.distance_m || 0)}</td></tr>
            <tr><td>Altura máxima</td><td>${s.max_rel_alt_m ?? '—'} m</td></tr>
            <tr><td>Vel. máxima</td><td>${speeds.length ? Math.round(Math.max(...speeds)) + ' km/h' : '—'}</td></tr>
            ${s.home ? `<tr><td>Despegue</td><td><button class="mono" id="copy-home" title="Copiar coordenadas" style="color:var(--accent)">${s.home[1].toFixed(5)}, ${s.home[0].toFixed(5)}</button></td></tr>` : ''}
          </table>
          <div class="navrow">
            ${meta.has_proxy ? `<a class="btn" href="${DATA}/proxies/${cid}.mp4" download>${icon('dl')} Proxy 1080p</a>` : ''}
            ${meta.has_srt ? `<a class="btn" href="${DATA}/tracks/${cid}.flight.json" download>${icon('dl')} Track GPS</a>` : ''}
            ${s.home ? `<a class="btn" target="_blank" rel="noopener" href="https://maps.google.com/?q=${s.home[1]},${s.home[0]}">${icon('ext')} Google Maps</a>` : ''}
          </div></div>
        </div>

        <div class="navrow">
          ${flights[idx + 1] ? `<a class="btn" href="flight.html?id=${flights[idx + 1].clip_id}">${icon('chevL')} Anterior</a>` : '<span></span>'}
          ${flights[idx - 1] ? `<a class="btn" href="flight.html?id=${flights[idx - 1].clip_id}">Siguiente ${icon('chevR')}</a>` : '<span></span>'}
        </div>
      </div>
    </div>`;

  // ---- video ----
  const slot = document.getElementById('video-slot');
  let video = null;
  if (meta.has_proxy) {
    slot.innerHTML = `<video src="${DATA}/proxies/${cid}.mp4" controls playsinline poster="${DATA}/thumbs/${cid}.jpg"></video>`;
    video = slot.querySelector('video');
  } else {
    slot.innerHTML = `<img src="${DATA}/thumbs/${cid}.jpg" style="width:100%;display:block" alt="">`;
  }

  // ---- HUD ----
  const HUDS = [['alt', 'Altura', 'm'], ['dist', 'Recorrido', ''], ['speed', 'Velocidad', 'km/h'], ['iso', 'ISO', ''], ['shutter', 'Shutter', '']];
  document.getElementById('hud').innerHTML = HUDS.map(([k, lb]) =>
    `<div><div class="lb">${lb}</div><div class="v" id="hud-${k}">—</div></div>`).join('');
  function showPoint(i) {
    if (!pts.length) return;
    i = Math.max(0, Math.min(i, pts.length - 1));
    const p = pts[i];
    set('alt', `${p.rel_alt.toFixed(0)}<small> m</small>`);
    set('dist', cum[i] >= 1000 ? `${(cum[i] / 1000).toFixed(2)}<small> km</small>` : `${Math.round(cum[i])}<small> m</small>`);
    set('speed', `${Math.round(speeds[i] || 0)}<small> km/h</small>`);
    set('iso', p.iso);
    set('shutter', `<small>${p.shutter}</small>`);
    marker?.setLngLat([p.lon, p.lat]);
    cursorAt(i);
  }
  const set = (k, v) => { document.getElementById(`hud-${k}`).innerHTML = v; };
  const seek = t => { if (video) { video.currentTime = t; video.play(); } };

  // ---- filmstrip (frame n = segundo n*2) ----
  if (meta.frame_count) {
    const strip = document.getElementById('strip');
    strip.innerHTML = Array.from({ length: meta.frame_count }, (_, i) =>
      `<img src="${DATA}/frames/${cid}/f_${String(i + 1).padStart(4, '0')}.jpg" loading="lazy" data-t="${i * 2}" alt="">`).join('');
    strip.addEventListener('click', e => { if (e.target.dataset.t) seek(+e.target.dataset.t); });
  }

  // ---- charts SVG ----
  function chart(el, series, label, unit, color) {
    const w = 600, h = 92, max = Math.max(...series, 1);
    const pth = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - 6 - (v / max) * (h - 22)}`).join(' ');
    el.innerHTML = `
      <span class="chart-lb">${label}</span><span class="chart-val" id="${el.id}-v"></span>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline points="${pth} ${w},${h} 0,${h}" fill="${color}" opacity="0.08"/>
        <polyline points="${pth}" fill="none" stroke="${color}" stroke-width="1.5"/>
        <line id="${el.id}-c" x1="0" x2="0" y1="0" y2="${h}" stroke="#E6EBF2" stroke-width="0.75" opacity="0"/>
      </svg>`;
    const svg = el.querySelector('svg');
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
      document.getElementById(`${el.id}-v`).textContent = `${Math.round(series[i] || 0)} ${unit} · ${fmt.dur(i)}`;
      const c = document.getElementById(`${el.id}-c`);
      c.setAttribute('x1', (i / (series.length - 1)) * w); c.setAttribute('x2', (i / (series.length - 1)) * w);
      c.setAttribute('opacity', 0.35);
    });
    svg.addEventListener('mouseleave', () => document.getElementById(`${el.id}-c`).setAttribute('opacity', 0));
    svg.addEventListener('click', e => {
      const r = svg.getBoundingClientRect();
      seek(Math.round(((e.clientX - r.left) / r.width) * (series.length - 1)));
    });
  }
  let cursorAt = () => {};
  if (pts.length) {
    chart(document.getElementById('ch-alt'), pts.map(p => p.rel_alt), 'Altitud', 'm', '#45A0E6');
    chart(document.getElementById('ch-speed'), speeds, 'Velocidad', 'km/h', '#52C79A');
    cursorAt = i => ['ch-alt', 'ch-speed'].forEach(id => {
      const c = document.getElementById(`${id}-c`);
      if (c) { const x = (i / (pts.length - 1)) * 600; c.setAttribute('x1', x); c.setAttribute('x2', x); c.setAttribute('opacity', 0.5); }
    });
  }

  // ---- mapa ----
  let marker = null;
  if (pts.length) {
    const coords = pts.map(p => [p.lon, p.lat]);
    const map = new maplibregl.Map({
      container: 'map', style: SAT_STYLE,
      bounds: [[s.bbox[0], s.bbox[1]], [s.bbox[2], s.bbox[3]]],
      fitBoundsOptions: { padding: 50 }, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#45A0E6', 'line-width': 7, 'line-opacity': 0.22 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#45A0E6', 'line-width': 2.2 } });
      const el = document.createElement('div');
      el.innerHTML = `<svg width="26" height="26" viewBox="0 0 20 20" style="filter:drop-shadow(0 1px 4px rgba(0,0,0,.9))"><circle cx="10" cy="10" r="5" fill="#45A0E6" stroke="#E6EBF2" stroke-width="1.6"/><circle cx="10" cy="10" r="1.6" fill="#0A0C10"/></svg>`;
      marker = new maplibregl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);
      map.on('click', 'route', e => {
        let best = 0, bd = Infinity;
        coords.forEach(([lon, lat], i) => {
          const d = (lon - e.lngLat.lng) ** 2 + (lat - e.lngLat.lat) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        seek(best);
      });
      map.on('mouseenter', 'route', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'route', () => map.getCanvas().style.cursor = '');
      showPoint(0);
    });
  }

  // ---- sync + shortcuts ----
  video?.addEventListener('timeupdate', () => {
    const i = Math.floor(video.currentTime);
    showPoint(i);
    document.querySelectorAll('#strip img').forEach(im => im.classList.toggle('on', +im.dataset.t === i - (i % 2)));
  });
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (b && b.classList.contains('tc')) seek(+b.dataset.t);
    if (e.target.id === 'copy-home') {
      navigator.clipboard.writeText(`${s.home[1]}, ${s.home[0]}`);
      e.target.textContent = 'copiado';
      setTimeout(() => { e.target.textContent = `${s.home[1].toFixed(5)}, ${s.home[0].toFixed(5)}`; }, 1200);
    }
  });
  document.addEventListener('keydown', e => {
    if (!video || e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    if (e.key === 'ArrowLeft') video.currentTime -= 5;
    if (e.key === 'ArrowRight') video.currentTime += 5;
    if (e.key === 'f') video.requestFullscreen?.();
  });
})();

function scoreRing(score = 0) {
  const r = 22, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(10, score)) / 10;
  return `<span class="ring"><svg width="54" height="54">
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="#1E2530" stroke-width="4"/>
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="#45A0E6" stroke-width="4"
      stroke-dasharray="${c * pct} ${c}" stroke-linecap="round"/>
  </svg><b>${score}</b></span>`;
}
