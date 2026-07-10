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

  let has3D = false;
  try {
    const sy = await (await fetch(`${DATA}/manifest/system.json`)).json();
    has3D = (sy.models || []).some(m => m.clip_id === cid);
  } catch {}

  main.innerHTML = `
    <div class="hero glass rise">
      <a class="btn hero-back" href="index.html" data-tip="Volver a la galería">${icon('chevL')}</a>
      <div class="hero-t">
        <h1>${esc(meta.label) || fmt.date(meta.date) + ' · ' + meta.time}</h1>
        <div class="hero-sub mono">${meta.label ? fmt.date(meta.date) + ' ' + meta.time + ' · ' : ''}${cid}</div>
      </div>
      <div class="hero-chips">
        <span class="gchip ${meta.tier}" data-tip="${meta.tier === 'full' ? 'Tier full: video web + AI + GPS' : meta.tier === 'standard' ? 'Tier standard: AI y GPS, sin proxy' : 'Tier skim: solo telemetría'}">${esc(meta.tier)}</span>
        <span class="gchip" data-tip="Resolución y cuadros por segundo del original">${meta.resolution === '3840x2160' ? '4K' : esc(meta.resolution)}${Math.round(meta.fps) >= 50 ? '60' : ''}</span>
        <span class="gchip" data-tip="Duración del clip">${fmt.dur(meta.duration_s)}</span>
        ${meta.has_srt ? `<span class="gchip" data-tip="Telemetría GPS de 1 Hz disponible">${icon('route')} GPS</span>` : ''}
        ${has3D ? `<span class="gchip mint" data-tip="Este vuelo tiene modelo 3D procesado">${icon('cube')} 3D listo</span>` : ''}
      </div>
      <div class="hero-actions">
        <button class="btn" id="btn-label" data-tip="Ponle nombre a este vuelo">${icon('tag')} Editar detalles</button>
        ${meta.has_proxy ? `<a class="btn" href="studio.html?clip=${cid}" data-tip="Cortes, reels y LUTs">${icon('film')} Studio</a>` : ''}
        ${has3D ? `<a class="btn primary" href="tresd.html" data-tip="Abrir el proyecto de fotogrametría">${icon('cube')} Ver en 3D</a>` : ''}
        <button class="btn" id="btn-arch" data-tip="${meta.archived ? 'Devolver a la galería' : 'Ocultar de la galería (no borra nada)'}">${icon('db')}</button>
      </div>
    </div>

    <div class="fl-layout">
      <div>
        <div class="panel videobox">
          <div id="video-slot"></div>
          <div class="toolbar" style="padding:10px 12px;margin:0;border-top:1px solid var(--line)">
            <button class="btn primary" id="btn-photo">${icon('iso')} Foto 4K</button>
            <div class="seg" id="q-seg"><button data-q="auto" class="on">Auto</button>${meta.has_proxy720 ? '<button data-q="720">720p</button>' : ''}${meta.has_proxy ? '<button data-q="hd">1080p</button>' : ''}${meta.raw_rel ? '<button data-q="4k">4K</button>' : ''}</div>
            <span class="spacer"></span>
          </div>
          <div class="hud" id="hud"></div>
        </div>
        ${pts.length ? `<div class="panel rise" style="margin-top:16px">
          <div class="ph">${icon('activity')} Telemetría en vivo — click en la curva para saltar el video</div>
          <div class="pb" style="padding:0">
            <div class="chart-wrap" id="ch-alt"></div>
            <div class="chart-wrap" id="ch-speed" style="border-top:1px solid var(--line)"></div>
          </div>
    </div>` : ''}
        ${meta.frame_count ? `<div class="panel" style="margin-top:16px">
          <div class="ph">${icon('film')} Filmstrip — click para saltar</div>
          <div class="filmstrip" id="strip"></div>
        </div>` : ''}


        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('activity')} Momentos
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="btn-hl" style="padding:4px 10px;font-size:11px">+ Highlight aquí</button>
          </div>
          <div class="pb" id="hl-list">
            ${(aiData?.highlights || []).map(h => `<div class="hl-item">
              <button class="tc" data-t="${+h.t || 0}">${fmt.dur(+h.t || 0)}</button>
              <p>${esc(h.reason)}${h.type ? ` <span class="mono" style="font-size:10px;color:${h.type === 'manual' ? 'var(--mint)' : 'var(--text-3)'}">${esc(h.type)}</span>` : ''}</p>
              <a class="btn" style="padding:3px 9px;font-size:11px" href="studio.html?clip=${cid}&a=${Math.max(0, (+h.t || 0) - 3)}&b=${(+h.t || 0) + 4}">Editar</a>
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
          <div class="pb">
          <div class="kv2">
            <table class="kv">
              <tr><td colspan="2" class="kv-h">Vuelo</td></tr>
              <tr><td>Duración</td><td>${fmt.dur(meta.duration_s)}</td></tr>
              <tr><td>Distancia</td><td>${fmt.km(s.distance_m || 0)}</td></tr>
              <tr><td>Altura máx/prom</td><td>${s.max_rel_alt_m ?? '—'}${pts.length ? ` / ${Math.round(pts.reduce((a, p) => a + p.rel_alt, 0) / pts.length)}` : ''} m</td></tr>
              <tr><td>Vel. máx/prom</td><td>${speeds.length ? `${Math.round(Math.max(...speeds))} / ${Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)} km/h` : '—'}</td></tr>
              ${pts.length ? `<tr><td>Alejamiento</td><td>${Math.round(Math.max(...pts.map(p => haversine({ lat: s.home[1], lon: s.home[0] }, p))))} m máx</td></tr>` : ''}
              ${s.home ? `<tr><td>Despegue</td><td><button class="mono" id="copy-home" title="Copiar" style="color:var(--accent)">${s.home[1].toFixed(5)}, ${s.home[0].toFixed(5)}</button></td></tr>` : ''}
            </table>
            <table class="kv">
              <tr><td colspan="2" class="kv-h">Cámara y archivo</td></tr>
              <tr><td>Resolución</td><td>${meta.resolution}<br><small>@ ${Math.round(meta.fps)} fps</small></td></tr>
              <tr><td>Codec</td><td>HEVC 10-bit<br><small>${(meta.size_bytes * 8 / meta.duration_s / 1e6).toFixed(0)} Mbps</small></td></tr>
              <tr><td>Original</td><td>${fmt.gb(meta.size_bytes)}</td></tr>
              ${meta.proxy_bytes ? `<tr><td>Proxy 1080</td><td>${fmt.gb(meta.proxy_bytes)}</td></tr>` : ''}
              <tr><td>Frames</td><td>${Math.round(meta.duration_s * meta.fps).toLocaleString()}</td></tr>
              ${pts.length ? `<tr><td>ISO rango</td><td>${Math.min(...pts.map(p => p.iso))} – ${Math.max(...pts.map(p => p.iso))}</td></tr>` : ''}
            </table>
          </div>
          <div class="exp-grid" style="margin-top:4px">
            ${meta.has_proxy ? `<a class="exp" href="studio.html?clip=${cid}">${icon('film')}<div><b>Editar en Studio</b><span>cortes · reels · LUTs</span></div></a>` : ''}
            ${meta.has_proxy ? `<button class="exp" id="share-video">${icon('ext')}<div><b>Guardar en Fotos</b><span>iPhone · share sheet</span></div></button>` : ''}
            ${meta.has_proxy ? `<a class="exp" href="${DATA}/proxies/${cid}.mp4" download>${icon('dl')}<div><b>Video 1080p</b><span>MP4 · ${meta.proxy_bytes ? fmt.gb(meta.proxy_bytes) : ''}</span></div></a>` : ''}
            ${meta.has_proxy720 ? `<a class="exp" href="${DATA}/proxies720/${cid}.mp4" download>${icon('dl')}<div><b>Video 720p</b><span>MP4 · ligero</span></div></a>` : ''}
            ${meta.raw_rel ? `<a class="exp" href="${DATA}/raw/${meta.raw_rel}" download>${icon('db')}<div><b>Original 4K</b><span>HEVC · ${fmt.gb(meta.size_bytes)}</span></div></a>` : ''}
            ${meta.has_srt ? `<a class="exp" href="${DATA}/tracks/${cid}.flight.json" download>${icon('route')}<div><b>Track GPS</b><span>JSON · 1 Hz</span></div></a>` : ''}
            ${s.home ? `<a class="exp" href="https://maps.apple.com/?ll=${s.home[1]},${s.home[0]}&q=Despegue" target="_blank" rel="noopener">${icon('pin')}<div><b>Ver despegue</b><span>Apple Maps</span></div></a>` : ''}
          </div></div>
        </div>

        <div class="navrow">
          ${flights[idx + 1] ? `<a class="btn" href="flight.html?id=${flights[idx + 1].clip_id}">${icon('chevL')} Anterior</a>` : '<span></span>'}
          ${flights[idx - 1] ? `<a class="btn" href="flight.html?id=${flights[idx - 1].clip_id}">Siguiente ${icon('chevR')}</a>` : '<span></span>'}
        </div>
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
            ${aiData.story_arc ? `<p class="ai-arc">«${esc(aiData.story_arc)}»</p>` : ''}
            ${aiData.director_notes?.length ? `<div class="dir-notes">
              <p class="mlb" style="margin:14px 0 6px">Informe del director</p>
              ${aiData.director_notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
            ${aiData.highlights?.length ? `<p class="mlb" style="margin:14px 0 6px">Momentos — tap para saltar</p>
            <div class="chips">${aiData.highlights.map(h =>
              `<button class="chip tc mom" data-t="${+h.t || 0}">▶ ${fmt.dur(+h.t || 0)}${h.type ? ' · ' + esc(h.type) : ''}</button>`).join('')}</div>
            ${aiData.highlights[0]?.reason ? `<p class="footer-note" style="margin:6px 0 0" id="mom-why">${esc(aiData.highlights[0].reason)}</p>` : ''}` : ''}
            ${aiData.edit_suggestions?.length ? `<p class="mlb" style="margin:14px 0 6px">Sugerencias de edición</p>
            <ul class="ai-edits">${aiData.edit_suggestions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${aiData.uses?.length ? `<p class="mlb" style="margin:14px 0 6px">Úsalo para</p>
            <ul class="ai-edits">${aiData.uses.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${aiData.hashtags?.length ? `<div class="chips" style="margin-top:12px">
              ${aiData.hashtags.map(t => `<span class="chip" style="color:var(--accent)">${esc(t)}</span>`).join('')}</div>` : ''}
            ${aiData.tags?.length ? `<div class="chips" style="margin-top:10px">
              ${aiData.tags.map(t => `<a class="chip" href="index.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
            </div>` : ''}` : `<p class="footer-note">Este clip aún no tiene análisis — pídelo con el botón.</p>`}
          </div>
        </div>

        </div>
      </div>
    </div>

`;

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
  let viewerPingTimer = null;
  const pingViewer = () => fetch('/api/viewer_ping', { cache: 'no-store', keepalive: true }).catch(() => {});
  const startViewerPing = () => {
    pingViewer();
    if (!viewerPingTimer) viewerPingTimer = setInterval(pingViewer, 15_000);
  };
  const stopViewerPing = () => {
    clearInterval(viewerPingTimer);
    viewerPingTimer = null;
  };
  video?.addEventListener('play', startViewerPing);
  video?.addEventListener('pause', stopViewerPing);
  video?.addEventListener('ended', stopViewerPing);
  addEventListener('pagehide', stopViewerPing, { once: true });
  function paintQ() {
    document.querySelectorAll('#q-seg [data-q]').forEach(b =>
      b.classList.toggle('on', b.dataset.q === quality));
  }
  let onMeta = null; // guarda contra listeners duplicados si cambian calidad rápido
  function setQuality(k) {
    quality = k;
    localStorage.setItem('ab.vq', k);
    paintQ();
    if (!video) return;
    const src = SRC[resolved()];
    if (!src || video.src.endsWith(src)) return;
    const t = video.currentTime, playing = !video.paused;
    if (onMeta) video.removeEventListener('loadedmetadata', onMeta);
    onMeta = () => {
      video.currentTime = t;      // seek recién con metadata del nuevo source
      if (playing) video.play();
      onMeta = null;
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.src = src;
    video.load();
  }
  paintQ();
  document.getElementById('q-seg')?.addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) setQuality(b.dataset.q);
  });

  // Compartir a Fotos (iOS): Web Share API con archivo — el share sheet ofrece
  // "Guardar video/imagen" directo al carrete; fallback = descarga normal
  async function shareFile(url, name, type, btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = 'Preparando…';
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
    } catch {}
    btn.innerHTML = orig;
  }
  document.getElementById('share-video')?.addEventListener('click', e => {
    const src = meta.has_proxy720 ? `${DATA}/proxies720/${cid}.mp4` : `${DATA}/proxies/${cid}.mp4`;
    shareFile(src, `${cid}.mp4`, 'video/mp4', e.currentTarget);
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
    openPhotoEditor({ url: d.url, name: `${cid}_foto.jpg` });
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
  const HUDS = [['alt', 'Altura', 'm'], ['dist', 'Recorrido', ''], ['speed', 'Velocidad', 'km/h'],
                ['head', 'Rumbo', ''], ['home', 'Al despegue', 'm'], ['iso', 'ISO', ''], ['shutter', 'Shutter', '']];
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
    // rumbo: bearing hacia el siguiente punto — flecha que gira con el dron
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const brg = bearing(p, q);
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(brg / 45) % 8];
    set('head', `<span class="hud-arrow" style="transform:rotate(${Math.round(brg)}deg)">➤</span> <small>${card}</small>`);
    const hm = s.home ? havm(s.home[1], s.home[0], p.lat, p.lon) : null;
    set('home', hm != null ? `${Math.round(hm)}<small> m</small>` : '—');
    marker?.setLngLat([p.lon, p.lat]);
    marker?.setRotation(brg);
    cursorAt(i);
  }
  const set = (k, v) => { document.getElementById(`hud-${k}`).innerHTML = v; };
  const R0 = Math.PI / 180;
  function bearing(a, b) {
    const y = Math.sin((b.lon - a.lon) * R0) * Math.cos(b.lat * R0);
    const x = Math.cos(a.lat * R0) * Math.sin(b.lat * R0) -
              Math.sin(a.lat * R0) * Math.cos(b.lat * R0) * Math.cos((b.lon - a.lon) * R0);
    return (Math.atan2(y, x) * 180 / Math.PI + 360 + 270) % 360;  // +270: la flecha ➤ apunta al Este en 0°
  }
  function havm(la1, lo1, la2, lo2) {
    const h = Math.sin((la2 - la1) * R0 / 2) ** 2 +
              Math.cos(la1 * R0) * Math.cos(la2 * R0) * Math.sin((lo2 - lo1) * R0 / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
  }
  const seek = t => { if (video) { video.currentTime = t; video.play(); } };

  // ---- filmstrip (frame n = segundo n*2) ----
  if (meta.frame_count) {
    const strip = document.getElementById('strip');
    strip.innerHTML = Array.from({ length: meta.frame_count }, (_, i) =>
      `<img src="${DATA}/frames/${cid}/f_${String(i + 1).padStart(4, '0')}.jpg" loading="lazy" data-t="${i * 2}" alt="">`).join('');
    strip.addEventListener('click', e => { if (e.target.dataset.t) seek(+e.target.dataset.t); });
  }

  // ---- charts SVG ----
  const CHARTS = {};
  function chart(el, series, label, unit, color) {
    const w = 800, h = 130, max = Math.max(...series, 1), pad = 8;
    const X = i => (i / (series.length - 1)) * w;
    const Y = v => h - pad - (v / max) * (h - 34);
    const pth = series.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
    const gid = `g-${el.id}`;
    el.innerHTML = `
      <span class="chart-lb">${label}</span>
      <span class="chart-badge mono" id="${el.id}-v">— ${unit}</span>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
          <stop offset="1" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient></defs>
        ${[0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${w}" y1="${Y(max * f)}" y2="${Y(max * f)}"
          stroke="currentColor" stroke-width="0.4" opacity="0.10"/>`).join('')}
        <text x="6" y="${Y(max) + 4}" font-size="9" fill="currentColor" opacity="0.4"
          font-family="var(--mono)">${Math.round(max)} ${unit}</text>
        <polyline points="${pth} ${w},${h} 0,${h}" fill="url(#${gid})" stroke="none"/>
        <polyline class="ch-line" points="${pth}" fill="none" stroke="${color}" stroke-width="1.8"/>
        <line id="${el.id}-c" x1="0" x2="0" y1="0" y2="${h}" stroke="currentColor" stroke-width="0.75" opacity="0"/>
        <circle id="${el.id}-dot" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.4"
          cx="0" cy="${Y(series[0] || 0)}" style="filter:drop-shadow(0 0 6px ${color})"/>
      </svg>`;
    // dibujo animado de la curva al montar
    const line = el.querySelector('.ch-line');
    const len = line.getTotalLength();
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    requestAnimationFrame(() => {
      line.style.transition = 'stroke-dashoffset 1100ms cubic-bezier(.25,.1,.25,1)';
      line.style.strokeDashoffset = '0';
    });
    CHARTS[el.id] = { series, unit, X, Y };
    const svg = el.querySelector('svg');
    svg.style.touchAction = 'pan-y';               // deslizar horizontal = scrub; vertical sigue scrolleando
    svg.addEventListener('pointermove', e => {     // pointermove cubre mouse Y dedo (mousemove era desktop-only)
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
      document.getElementById(`${el.id}-v`).textContent = `${Math.round(series[i] || 0)} ${unit} · ${fmt.dur(i)}`;
      const c = document.getElementById(`${el.id}-c`);
      c.setAttribute('x1', X(i)); c.setAttribute('x2', X(i));
      c.setAttribute('opacity', 0.3);
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
      const ch = CHARTS[id];
      if (!ch) return;
      const dot = document.getElementById(`${id}-dot`);
      if (dot) { dot.setAttribute('cx', ch.X(i)); dot.setAttribute('cy', ch.Y(ch.series[i] || 0)); }
      const badge = document.getElementById(`${id}-v`);
      if (badge) badge.textContent = `${Math.round(ch.series[i] || 0)} ${ch.unit} · ${fmt.dur(i)}`;
    });
  }

  // ---- mapa ----
  let marker = null;
  if (pts.length) {
    const coords = pts.map(p => [p.lon, p.lat]);
    const map = new maplibregl.Map({
      cooperativeGestures: true,                   // mapa mid-page: 1 dedo scrollea la página, 2 mueven el mapa
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
      marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(coords[0]).addTo(map);
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
  main.addEventListener('pointerover', e => {
    const m = e.target.closest('.mom');
    if (!m || !aiData?.highlights) return;
    const h = aiData.highlights.find(x => (+x.t || 0) === +m.dataset.t);
    const why = document.getElementById('mom-why');
    if (h && why) why.textContent = h.reason || '';
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
