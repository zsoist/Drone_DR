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
          <div class="toolbar" style="padding:10px 12px;margin:0;border-top:1px solid var(--line)">
            <button class="btn primary" id="btn-photo">${icon('iso')} Foto 4K</button>
            <div class="seg" id="q-seg"><button data-q="auto" class="on">Auto</button>${meta.has_proxy720 ? '<button data-q="720">720p</button>' : ''}${meta.has_proxy ? '<button data-q="hd">1080p</button>' : ''}${meta.raw_rel ? '<button data-q="4k">4K</button>' : ''}</div>
            <span class="spacer"></span>
            <button class="btn" id="btn-label" title="Renombrar">${icon('tag')}</button>
            <button class="btn" id="btn-arch" title="${meta.archived ? 'Desarchivar' : 'Archivar'}">${icon('db')}</button>
          </div>
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

        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('spark')} Análisis AI ${aiData?.deep ? '· profundo' : ''}
            <span class="spacer" style="flex:1"></span>
            <button class="btn" id="btn-deep" style="padding:4px 10px;font-size:11px">${aiData ? 'Re-analizar profundo' : 'Analizar ahora'}</button>
          </div>
          <div class="pb">
            ${aiData ? `
            <div class="gauge">${scoreRing(aiData.travel_score)}<p>${esc(aiData.summary || '')}</p></div>
            ${aiData.camera_motion || aiData.quality ? `<table class="kv" style="margin-top:12px">
              ${aiData.camera_motion ? `<tr><td>Cámara</td><td style="text-align:left;font-family:var(--font)">${esc(aiData.camera_motion)}</td></tr>` : ''}
              ${aiData.quality ? `<tr><td>Calidad</td><td style="text-align:left;font-family:var(--font)">
                exposición ${esc(aiData.quality.exposure)} · ${esc(aiData.quality.stability)} · luz ${esc(aiData.quality.light)}
                ${aiData.quality.issues?.length ? `<br><span style="color:var(--amber)">⚠ ${esc(aiData.quality.issues.join(' · '))}</span>` : ''}</td></tr>` : ''}
              ${aiData.subjects?.length ? `<tr><td>Sujetos</td><td style="text-align:left;font-family:var(--font)">${esc(aiData.subjects.join(' · '))}</td></tr>` : ''}
            </table>` : ''}
            ${aiData.tags?.length ? `<div class="chips" style="margin-top:12px">
              ${aiData.tags.map(t => `<a class="chip" href="index.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
            </div>` : ''}` : `<p class="footer-note">Este clip aún no tiene análisis — pídelo con el botón.</p>`}
          </div>
        </div>

        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('activity')} Momentos
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="btn-hl" style="padding:4px 10px;font-size:11px">+ Highlight aquí</button>
          </div>
          <div class="pb" id="hl-list">
            ${(aiData?.highlights || []).map(h => `<div class="hl-item">
              <button class="tc" data-t="${h.t}">${fmt.dur(h.t)}</button>
              <p>${esc(h.reason)}${h.type ? ` <span class="mono" style="font-size:10px;color:${h.type === 'manual' ? 'var(--mint)' : 'var(--text-3)'}">${esc(h.type)}</span>` : ''}</p>
              <a class="btn" style="padding:3px 9px;font-size:11px" href="studio.html?clip=${cid}&a=${Math.max(0, h.t - 3)}&b=${h.t + 4}">Editar</a>
            </div>`).join('') || '<p class="footer-note">Sin momentos aún — marca uno con el video pausado donde quieras.</p>'}
          </div>
        </div>

        ${aiData?.edit_suggestions?.length ? `<div class="panel" style="margin-top:16px">
          <div class="ph">${icon('film')} Sugerencias de edición</div>
          <div class="pb">
            ${aiData.edit_suggestions.map(s => `<div class="hl-item"><p>${esc(s)}</p></div>`).join('')}
            ${aiData.hashtags?.length ? `<div class="chips" style="margin-top:10px">${aiData.hashtags.map(h => `<span class="chip">${esc(h)}</span>`).join('')}</div>` : ''}
          </div>
        </div>` : ''}

        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('gauge')} Datos técnicos</div>
          <div class="pb"><table class="kv">
            <tr><td>Resolución</td><td>${meta.resolution} @ ${meta.fps}fps</td></tr>
            <tr><td>Codec / bitrate</td><td>HEVC 10-bit · ${(meta.size_bytes * 8 / meta.duration_s / 1e6).toFixed(0)} Mbps</td></tr>
            <tr><td>Original / proxy</td><td>${fmt.gb(meta.size_bytes)}${meta.proxy_bytes ? ` / ${fmt.gb(meta.proxy_bytes)}` : ''}</td></tr>
            <tr><td>Duración / frames</td><td>${fmt.dur(meta.duration_s)} · ${Math.round(meta.duration_s * meta.fps).toLocaleString()} f</td></tr>
            <tr><td>Distancia</td><td>${fmt.km(s.distance_m || 0)}</td></tr>
            <tr><td>Altura máx / prom</td><td>${s.max_rel_alt_m ?? '—'} m${pts.length ? ` / ${Math.round(pts.reduce((a, p) => a + p.rel_alt, 0) / pts.length)} m` : ''}</td></tr>
            <tr><td>Vel. máx / prom</td><td>${speeds.length ? `${Math.round(Math.max(...speeds))} / ${Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)} km/h` : '—'}</td></tr>
            ${pts.length ? `<tr><td>Alejamiento máx</td><td>${Math.round(Math.max(...pts.map(p => haversine({ lat: s.home[1], lon: s.home[0] }, p))))} m del despegue</td></tr>
            <tr><td>ISO rango</td><td>${Math.min(...pts.map(p => p.iso))} – ${Math.max(...pts.map(p => p.iso))}</td></tr>` : ''}
            ${s.home ? `<tr><td>Despegue</td><td><button class="mono" id="copy-home" title="Copiar coordenadas" style="color:var(--accent)">${s.home[1].toFixed(5)}, ${s.home[0].toFixed(5)}</button></td></tr>` : ''}
          </table>
          <div class="navrow">
            ${meta.has_proxy ? `<a class="btn primary" href="studio.html?clip=${cid}">${icon('film')} Editar en Studio</a>` : ''}
            ${meta.has_proxy ? `<a class="btn" href="${DATA}/proxies/${cid}.mp4" download>${icon('dl')} 1080p</a>` : ''}
            ${meta.has_srt ? `<a class="btn" href="${DATA}/tracks/${cid}.flight.json" download>${icon('dl')} GPS</a>` : ''}
            ${s.home ? `<a class="btn" target="_blank" rel="noopener" href="https://maps.google.com/?q=${s.home[1]},${s.home[0]}">${icon('ext')} Maps</a>` : ''}
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
  const SRC = {
    '720': meta.has_proxy720 ? `${DATA}/proxies720/${cid}.mp4` : null,
    hd: meta.has_proxy ? `${DATA}/proxies/${cid}.mp4` : null,
    '4k': meta.raw_rel ? `${DATA}/raw/${meta.raw_rel}` : null,
  };
  // Auto: red lenta o pantalla chica → 720; si no, 1080
  function autoPick() {
    const net = navigator.connection || {};
    const slow = (net.downlink && net.downlink < 5) || /(^|-)(2|3)g$/.test(net.effectiveType || '');
    if (SRC['720'] && (slow || innerWidth < 820)) return '720';
    return SRC.hd ? 'hd' : SRC['720'] ? '720' : '4k';
  }
  let quality = localStorage.getItem('ab.vq') || 'auto';
  const resolved = () => quality === 'auto' ? autoPick() : (SRC[quality] ? quality : autoPick());
  if (SRC.hd || SRC['720'] || SRC['4k']) {
    slot.innerHTML = `<video src="${SRC[resolved()]}" controls playsinline webkit-playsinline preload="metadata" poster="${DATA}/thumbs/${cid}.jpg"></video>`;
    video = slot.querySelector('video');
  } else {
    slot.innerHTML = `<img src="${DATA}/thumbs/${cid}.jpg" style="width:100%;display:block" alt="">`;
  }
  function paintQ() {
    document.querySelectorAll('#q-seg [data-q]').forEach(b =>
      b.classList.toggle('on', b.dataset.q === quality));
  }
  function setQuality(k) {
    quality = k;
    localStorage.setItem('ab.vq', k);
    paintQ();
    if (!video) return;
    const src = SRC[resolved()];
    if (!src || video.src.endsWith(src)) return;
    const t = video.currentTime, playing = !video.paused;
    video.src = src;
    video.currentTime = t;
    if (playing) video.play();
  }
  paintQ();
  document.getElementById('q-seg')?.addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) setQuality(b.dataset.q);
  });

  // Foto 4K: el server extrae el frame del ORIGINAL en el segundo actual
  document.getElementById('btn-photo').addEventListener('click', async e => {
    const token = getToken();
    if (!token) return;
    const btn = e.currentTarget;
    btn.textContent = 'Capturando…';
    const d = await api('/api/frame', { clip_id: cid, t: +(video?.currentTime || 0).toFixed(1) });
    btn.innerHTML = `${icon('iso')} Foto 4K`;
    if (!d.ok) return alert(d.error || 'error');
    // modal (iOS Safari bloquea window.open async y no siempre respeta download):
    // imagen inline + botón descargar + hint de guardar con long-press
    const ov = document.createElement('div');
    ov.className = 'login-ov';
    ov.innerHTML = `
      <div class="photo-modal">
        <img src="${d.url}" alt="Foto 4K">
        <div class="pm-bar">
          <span>3840×2160 · mantén presionada la imagen para guardarla en Fotos</span>
          <a class="btn primary" href="${d.url}" download>${icon('dl')} Descargar</a>
          <button class="btn" data-close>Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
  });

  // análisis profundo on-demand (16 frames, prompt de director de fotografía)
  document.getElementById('btn-deep')?.addEventListener('click', async e => {
    const token = getToken();
    if (!token) return;
    e.currentTarget.textContent = 'Analizando… (~30s)';
    await api('/api/analyze', { clip_id: cid });
    const poll = setInterval(async () => {
      const { jobs } = await (await fetch('/api/jobs')).json();
      const j = jobs.find(x => x.kind === 'analyze' && x.label.includes(cid));
      if (j && j.status !== 'running') { clearInterval(poll); location.reload(); }
    }, 3000);
  });

  // highlight manual en el segundo actual del video
  document.getElementById('btn-hl')?.addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const t = +(video?.currentTime || 0).toFixed(1);
    const reason = prompt(`Highlight en ${fmt.dur(t)} — ¿por qué?`, 'momento favorito');
    if (reason == null) return;
    await api('/api/highlight', { clip_id: cid, t, reason });
    location.reload();
  });

  document.getElementById('btn-label').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const label = prompt('Nombre para este vuelo:', meta.label || '');
    if (label == null) return;
    await api('/api/clip', { clip_id: cid, label });
    location.reload();
  });
  document.getElementById('btn-arch').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    await api('/api/clip', { clip_id: cid, archived: !meta.archived });
    location.href = 'index.html';
  });

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
    set('iso', esc(p.iso));
    set('shutter', `<small>${esc(p.shutter)}</small>`);
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
      fitBoundsOptions: FIT_OPTS, attributionControl: { compact: true },
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
