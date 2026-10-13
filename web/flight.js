import { flightFallback } from './ui/display-name.js?v=450';
import { thumbnailURL } from './ui/thumbnail.js?v=450';
import { fmt } from './ui/format.js?v=450';
import { mapSkinOptions, skinMap } from './ui/map-skin.js?v=450';
import { skinPlayer } from './ui/player.js?v=450';
import { readAI, clipChips, credibleHighlights, eligibleFrame } from './home.ai.js?v=450';
import { loadFlights, registerFlights, openPageSheet, save, renderFailure, skeleton, dataColor, figure, suggestedContent } from './home-shared.js?v=450';
import { sampleTimes, sampleAt, acceptsShortcut } from './flight-clock.js?v=450';
// Vista de vuelo: player + mapa sincronizado + charts + filmstrip + panel AI.
const main = renderShell('index.html');
main.classList.add('ab-page');
const cid = new URLSearchParams(location.search).get('id');
main.innerHTML = skeleton(2);

(async () => {
  const flights = await loadFlights();
  registerFlights(flights);
  const idx = flights.findIndex(f => f.clip_id === cid);
  const meta = flights[idx];
  if (!meta) { main.innerHTML = emptyState({ icon: 'warn', title: 'Vuelo no encontrado', help: 'El enlace no corresponde a ningún vuelo.', action: '<a class="btn ui-button ui-button--secondary" href="index.html">Ver vuelos</a>' }); return; }
  let trackFailed = false;
  const [aiData, track] = await Promise.all([
    getAI(cid),
    meta.has_srt ? fetch(`${DATA}/tracks/${encodeURIComponent(cid)}.flight.json`).then(r => { if (!r.ok) throw new Error('GPS'); return r.json(); }).catch(() => { trackFailed = true; return null; }) : null,
  ]);
  const pts = (Array.isArray(track?.points) ? track.points : []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const times = sampleTimes(pts);
  const s = meta.stats || {};
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  // Header and player share the same rounding rule.
  const durTxt = fmt.duration(meta.duration_s);
  const speeds = pts.map((p, i) => i ? haversine(pts[i - 1], p) * 3.6 / Math.max(.001, times[i] - times[i - 1]) : 0);

  let has3D = false;
  try {
    const sy = await (await fetch(`${DATA}/manifest/system.json`)).json();
    has3D = (sy.models || []).some(m => m.clip_id === cid);
  } catch {}

  // HEVC Main10 (los raw DJI): solo ofrecer 4K si este navegador lo decodifica
  // (Safari y Chrome/Apple Silicon sí; Firefox/Android no → se quedan en proxies H.264)
  const hevcOK = !!document.createElement('video')
    .canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"');

  const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
  const flatSpeed = pts.length > 0 && maxSpeed < 2;      // serie plana: no merece una curva
  const older = flights[idx + 1], newer = flights[idx - 1];
  const dlItems = [
    meta.has_proxy && `<button class="exp" id="share-video">${icon('ext')}<div><b>Guardar en Fotos</b><span>Compartir o descargar</span></div></button>`,
    meta.has_proxy && `<a class="exp" href="${DATA}/proxies/${cid}.mp4" download>${icon('dl')}<div><b>Video 1080p</b><span>MP4 · ${meta.proxy_bytes ? fmt.gb(meta.proxy_bytes) : ''}</span></div></a>`,
    meta.has_proxy720 && `<a class="exp" href="${DATA}/proxies720/${cid}.mp4" download>${icon('dl')}<div><b>Video 720p</b><span>MP4 · ligero</span></div></a>`,
    meta.raw_rel && `<a class="exp" href="/api/raw_video?clip=${encodeURIComponent(cid)}" download>${icon('db')}<div><b>Original 4K</b><span>HEVC · ${fmt.gb(meta.size_bytes)}</span></div></a>`,
    meta.has_srt && `<a class="exp" href="${DATA}/tracks/${cid}.flight.json" download>${icon('route')}<div><b>Ruta GPS</b><span>JSON · 1 Hz</span></div></a>`,
    s.home && `<a class="exp" href="https://maps.apple.com/?ll=${s.home[1]},${s.home[0]}&q=Despegue" target="_blank" rel="noopener">${icon('pin')}<div><b>Ver despegue</b><span>Apple Maps</span></div></a>`,
  ].filter(Boolean);

  const highlights = aiData?.highlights || [];
  const manualHighlights = [...highlights, ...(aiData?.owner_highlights || [])].filter((h, i, rows) => h.type === 'manual' && rows.findIndex(row => row.type === 'manual' && row.t === h.t) === i);
  const highlightRows = rows => rows.map(h => `<div class="hl-item">
    <button class="tc hit44 fl-moment-jump" data-t="${+h.t || 0}" aria-label="Ir a ${fmt.clock(+h.t || 0)}">${h.frame ? `<img src="${esc(h.frame.frame_url)}" alt="">` : ''}<span>${fmt.clock(+h.t || 0)}</span></button>
    ${h.label || h.reason || h.type === 'manual' ? `<p>${esc(h.label || h.reason || '')}${h.type === 'manual' ? ' <span class="fl-type">Marcado por ti</span>' : ''}</p>` : ''}
    <button class="ui-button ui-button--quiet fl-moment-menu" data-edit-start="${h.start ?? Math.max(0, (+h.t || 0) - 3)}" data-edit-end="${h.end ?? Math.min(meta.duration_s, (+h.t || 0) + 4)}" aria-label="Opciones del momento">${icon('more')}</button>
  </div>`).join('');


  main.innerHTML = `
  <div class="fl">
    ${shell.backLink('Vuelos', '/index.html')}
    <header class="fl-head">
      <div class="fl-title"><h1>${esc(meta.label || flightFallback(meta))}</h1><p>${durTxt} · ${meta.resolution === '3840x2160' ? '4K' : esc(meta.resolution)} · ${Math.round(meta.fps)} fps</p></div>
      <div class="fl-actions">${meta.has_proxy ? `<a class="ui-button ui-button--primary" href="studio.html?clip=${cid}">Abrir en Studio</a>` : ''}<button class="ui-button ui-button--quiet" id="fl-more" aria-label="Más opciones del vuelo">${icon('more')}</button></div>
    </header>
    <section class="fl-summary" id="flight-summary" aria-label="Resumen del vuelo" aria-busy="true"><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div></section>

    <div class="fl-layout">
      <div class="fl-main">
        <div class="panel videobox fl-video">
          <div id="video-slot" data-transition-key="clip-${esc(cid)}"></div>
          <p id="fl-media-status" class="fl-hint" role="status" hidden></p><div class="fl-bar">

          </div>
          <div class="hud" id="hud"></div>
        </div>
        ${pts.length ? `<div class="panel rise fl-tel">
          <div class="ph">${icon('activity')} Telemetría <span class="hint">Toca la curva para saltar</span></div>
          <div class="pb fl-tel-b">
            <div class="chart-wrap" id="ch-alt"></div><p class="fl-alt-note">Altura respecto al despegue. Los valores por debajo se muestran como 0 m.</p>
            ${flatSpeed
              ? `<div class="fl-flat"><b>Velocidad</b><span>Sin desplazamiento apreciable · máx ${fmt.number(maxSpeed, 1)} km/h</span></div>`
              : '<div class="chart-wrap" id="ch-speed"></div>'}
          </div>
        </div>` : ''}
        ${meta.frame_count ? `<div class="panel fl-film">
          <div class="ph">${icon('film')} Fotogramas <span class="hint">Toca para saltar</span></div>
          <div class="filmstrip" id="strip"></div>
        </div>` : ''}

        <div class="panel fl-moments">
          <div class="ph">${icon('activity')} Momentos
            <button class="btn ph-push ui-button ui-button--secondary" id="btn-hl">${icon('plus')} Marcar aquí</button>
          </div>
          <div class="pb" id="hl-list" aria-busy="true">
            ${manualHighlights.length ? highlightRows(manualHighlights) : ''}
            ${!manualHighlights.length ? '<div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div>' : ''}
          </div>
        </div>

        ${aiData?.edit_suggestions?.length ? `<div class="panel fl-edits">
          <div class="ph">${icon('film')} Sugerencias de edición</div>
          <div class="pb">
            <span class="fl-hint">Sugerido</span><ul class="fl-edit-notes">${aiData.edit_suggestions.map(note => `<li>${esc(note)}</li>`).join('')}</ul>
            ${aiData.hashtags?.length ? `<div class="chips fl-chips">${aiData.hashtags.map(h => `<span class="chip ui-chip">${esc(h)}</span>`).join('')}</div>` : ''}
          </div>
        </div>` : ''}

        <div class="panel fl-tech">
          <div class="ph">${icon('gauge')} Datos técnicos</div>
          <div class="pb">
          <div class="kv2">
            <table class="kv">
              <tr><td colspan="2" class="kv-h">Vuelo</td></tr>
              <tr><td>Duración</td><td>${durTxt}</td></tr>
              <tr><td>Distancia</td><td>${fmt.km(s.distance_m || 0)}</td></tr>
              <tr><td>Altura máx/prom</td><td>${fmt.number(s.max_rel_alt_m, 1)}${pts.length ? ` / ${Math.round(pts.reduce((a, p) => a + p.rel_alt, 0) / pts.length)}` : ''} m</td></tr>
              <tr><td>Vel. máx/prom</td><td>${speeds.length ? `${Math.round(Math.max(...speeds))} / ${Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)} km/h` : '—'}</td></tr>
              ${pts.length && s.home ? `<tr><td>Alejamiento</td><td>${Math.round(Math.max(...pts.map(p => haversine({ lat: s.home[1], lon: s.home[0] }, p))))} m máx</td></tr>` : ''}
              ${s.home ? `<tr><td>Despegue</td><td><button class="mono fl-copy hit44" id="copy-home" title="Copiar coordenadas">${fmt.number(s.home[1], 5)}°, ${fmt.number(s.home[0], 5)}°</button></td></tr>` : ''}
            </table>
            <table class="kv">
              <tr><td colspan="2" class="kv-h">Cámara y archivo</td></tr>
              <tr><td>Resolución</td><td>${meta.resolution}<br><small>@ ${Math.round(meta.fps)} fps</small></td></tr>
              <tr><td>Códec</td><td>HEVC 10-bit<br><small>${(meta.size_bytes * 8 / meta.duration_s / 1e6).toFixed(0)} Mbps</small></td></tr>
              <tr><td>Original</td><td>${fmt.gb(meta.size_bytes)}</td></tr>
              ${meta.proxy_bytes ? `<tr><td>Video 1080p</td><td>${fmt.gb(meta.proxy_bytes)}</td></tr>` : ''}
              <tr><td>Fotogramas</td><td>${fmt.number(Math.round(meta.duration_s * meta.fps))}</td></tr>
              ${pts.length ? `<tr><td>ISO rango</td><td>${Math.min(...pts.map(p => p.iso))} – ${Math.max(...pts.map(p => p.iso))}</td></tr>` : ''}
            </table>
          </div></div>
        </div>

        <div class="panel fl-dl" id="fl-dl">
          <div class="ph">${icon('dl')} Descargas y accesos <span class="hint">${dlItems.length} elementos</span></div>
          <div class="pb"><div class="fl-dl-grid">
            ${dlItems.join('')}
          </div></div>
        </div>
      </div>

      <div class="fl-side">
        ${pts.length ? '<div class="panel fl-map"><h2 class="ph">Ruta del vuelo</h2><div id="map"></div></div>' : `<div class="fl-no-gps"><h2>${trackFailed ? 'No se pudo cargar el GPS' : 'Sin GPS'}</h2><p>${trackFailed ? 'El video está disponible. Reintenta para recuperar la ruta y la telemetría.' : 'Este video no tiene una ruta registrada.'}</p>${trackFailed ? '<button class="ui-button ui-button--secondary" id="gps-retry">Reintentar GPS</button>' : ''}</div>`}

        <section class="panel fl-ai"><h2 class="ph">Análisis del vuelo</h2><div class="pb"><p class="fl-hint">${aiData ? 'Revisa las observaciones antes de usarlas en una edición.' : 'Sin análisis aún. Solicita el análisis para encontrar momentos y etiquetas.'}</p>${aiData?.quality?.issues?.length ? `<p class="fl-issue">${esc(aiData.quality.issues.join(' · '))}</p>` : ''}${aiData?.tags?.length ? `<div class="fl-tags">${aiData.tags.filter(tag => !/^(drone|dron)$/i.test(tag)).map(tag => `<a class="ui-chip" href="index.html?q=${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}</div>` : ''}<button class="ui-button ui-button--secondary" id="btn-deep">${aiData ? 'Actualizar análisis' : 'Analizar vuelo'}</button><p class="fl-hint" id="analysis-status" role="status"></p></div></section>
      </div>
    </div>
  </div>
`;
  main.querySelector('.fl-video').after(document.getElementById('flight-summary'));
  main.querySelector('.fl-bar').prepend(main.querySelector('.fl-actions'));
  for (const panel of main.querySelectorAll('.fl-edits .pb')) {
    panel.querySelector('.fl-hint')?.remove();
    const content = suggestedContent(panel.innerHTML); panel.replaceChildren(content);
  }
  const analysisParts = [...main.querySelectorAll('.fl-ai .fl-issue, .fl-ai .fl-tags')];
  if (analysisParts.length) {
    const analysis = suggestedContent(analysisParts.map(part => part.outerHTML).join('')); analysisParts[0].before(analysis);
    analysis.querySelector('.ui-suggested-content').replaceChildren(...analysisParts);
  }
  const technical = document.querySelector('.fl-tech');
  const technicalBody = technical.querySelector('.pb');
  technical.remove();
  function showDetails() {
    const content = technicalBody.cloneNode(true);
    content.classList.add('fl');
    content.querySelector('#copy-home')?.addEventListener('click', async e => {
      const button = e.currentTarget;
      try { await navigator.clipboard.writeText(`${s.home[1]}, ${s.home[0]}`); button.textContent = 'Copiado'; }
      catch { toast('No se pudieron copiar las coordenadas.'); }
    });
    openPageSheet(content, { title: 'Detalles', size: 'full' });
  }
  // Descargas: abierto en escritorio (datos primero), colapsado en móvil
  const downloads = document.getElementById('fl-dl');
  const downloadBody = downloads.querySelector('.pb');
  downloadBody.id = 'fl-downloads';
  const downloadTitle = downloads.querySelector('.ph');
  downloadTitle.innerHTML = '<button class="ui-button ui-button--quiet" aria-expanded="false" aria-controls="fl-downloads">Descargas y accesos</button>';
  downloadBody.hidden = true;
  downloadTitle.querySelector('button').addEventListener('click', e => { downloadBody.hidden = !downloadBody.hidden; e.currentTarget.setAttribute('aria-expanded', String(!downloadBody.hidden)); });
  document.getElementById('gps-retry')?.addEventListener('click', () => location.reload());


  const telemetry = main.querySelector('.fl-tel');
  if (telemetry) main.querySelector('.fl-map')?.after(telemetry);

  // ---- video ----
  const slot = document.getElementById('video-slot');
  let video = null;
  const SRC = {
    '720': meta.has_proxy720 ? `${DATA}/proxies720/${cid}.mp4` : null,
    hd: meta.has_proxy ? `${DATA}/proxies/${cid}.mp4` : null,
    // /data/raw está vetado (denylist de seguridad del vault) — el 4K original
    // se sirve autenticado vía API, y solo si el navegador decodifica HEVC
    '4k': meta.raw_rel && hevcOK ? `/api/raw_video?clip=${encodeURIComponent(cid)}` : null,
  };
  // Auto: red lenta o pantalla chica → 720; si no, 1080
  function autoPick() {
    const net = navigator.connection || {};
    const slow = (net.downlink && net.downlink < 5) || /(^|-)(2|3)g$/.test(net.effectiveType || '');
    if (SRC['720'] && (slow || innerWidth < 820)) return '720';
    return SRC.hd ? 'hd' : SRC['720'] ? '720' : '4k';
  }
  let quality = localStorage.getItem('ab.vq') || 'auto';
  if (quality !== 'auto' && !SRC[quality]) quality = 'auto';
  const resolved = () => quality === 'auto' ? autoPick() : (SRC[quality] ? quality : autoPick());
  if (SRC.hd || SRC['720'] || SRC['4k']) {
    slot.innerHTML = `<video src="${SRC[resolved()]}" playsinline webkit-playsinline preload="metadata" poster="${esc(thumbnailURL(meta))}"></video>`;
    video = slot.querySelector('video');
    const player = skinPlayer(video, { label: 'Recorrido del vuelo' });
    const qualityControl = document.createElement('button'); qualityControl.className = 'ui-button ui-button--quiet fl-quality';
    qualityControl.id = 'fl-quality'; qualityControl.type = 'button'; qualityControl.setAttribute('aria-label', 'Calidad de video');
    const controls = player.element.querySelector('.ui-player-controls');
    const secondary = [...controls.querySelectorAll('button')].slice(1);
    secondary.forEach(button => button.classList.add('fl-player-secondary'));
    controls.append(qualityControl);
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'ui-button ui-button--quiet fl-player-more';
    more.setAttribute('aria-label', 'Opciones del video'); more.innerHTML = icon('more');
    controls.append(more);
    more.addEventListener('click', () => openMenu(more, [
      ...secondary.flatMap((button, i) => button.hidden ? [] : [{id: `control-${i}`, label: button.getAttribute('aria-label')}]),
      {id: 'quality', label: 'Calidad de video', hint: qualityControl.textContent},
      ...flightMenuItems,
    ], {onSelect: id => {
      if (id === 'quality') openMenu(more, qualityItems(), {onSelect: setQuality});
      else if (id.startsWith('control-')) secondary[Number(id.split('-')[1])]?.click();
      else selectFlightAction(id);
    }}));
    const qualityItems = () => [{ id: 'auto', label: 'Automática' },
      ...Object.entries(SRC).filter(([, url]) => url).map(([id]) => ({id, label: {'720': '720p', hd: '1080p', '4k': '4K'}[id]}))]
      .map(item => ({...item, hint: item.id === quality ? 'Actual' : ''}));
    qualityControl.addEventListener('click', () => openMenu(qualityControl, qualityItems(), {onSelect: setQuality}));
    addEventListener('pagehide', () => player.destroy(), { once: true });
  } else {
    // sin fuente reproducible: estado honesto — el thumb + qué falta y por qué
    slot.innerHTML = `
      <div class="fl-noproxy">
        <img src="${esc(thumbnailURL(meta))}" alt="Vista del vuelo" width="960" height="540">
        <div class="fl-noproxy-msg">
          <div class="fl-unavailable">
            <b>${icon('film')} Video no disponible</b>
            <p class="fl-hint">${meta.raw_rel && !hevcOK
              ? 'El original es 4K HEVC y este navegador no lo decodifica. Prueba el video 1080p cuando esté disponible.'
              : 'No hay una versión de video compatible. Puedes descargar el original.'}</p>
          </div>
        </div>
      </div>`;
  }
  let viewerPingTimer = null;
  const pingViewer = () => authFetch('/api/viewer_ping', { cache: 'no-store', keepalive: true }).catch(() => {});
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
    const button = document.getElementById('fl-quality');
    if (button) button.textContent = { auto: 'Auto', '720': '720p', hd: '1080p', '4k': '4K' }[quality] || 'Auto';
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
      if (playing) video.play().catch(() => {});
      onMeta = null;
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.src = src;
    video.load();
  }
  paintQ();
  video?.addEventListener('error', () => { const status = document.getElementById('fl-media-status'); status.hidden = false; status.textContent = 'No se pudo cargar el video. Prueba otra calidad.'; });

  // Compartir a Fotos (iOS): Web Share API con archivo — el share sheet ofrece
  // "Guardar video/imagen" directo al carrete; fallback = descarga normal
  async function shareFile(url, name, type, btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = 'Preparando…'; btn.disabled = true;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
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
    } catch (err) {
      if (err?.name !== 'AbortError') toast(`No se pudo guardar el archivo: ${err?.message || err}`);
    }
    btn.innerHTML = orig; btn.disabled = false;
  }
  document.getElementById('share-video')?.addEventListener('click', e => {
    const src = meta.has_proxy720 ? `${DATA}/proxies720/${cid}.mp4` : `${DATA}/proxies/${cid}.mp4`;
    shareFile(src, `${cid}.mp4`, 'video/mp4', e.currentTarget);
  });

  // Foto 4K: el server extrae el frame del ORIGINAL en el segundo actual
  async function capturePhoto() {
    const btn = [...document.querySelectorAll('#fl-more, .fl-player-more')].find(button => button.getClientRects().length);
    btn.disabled = true; btn.textContent = 'Capturando…';
    try {
      const data = await save('/api/frame', { clip_id: cid, t: +(video?.currentTime || 0).toFixed(1) });
      const content = document.createElement('div');
      content.innerHTML = `<img class="fl-photo-result" src="${esc(data.url)}" alt="Fotograma extraído del vuelo"><a class="ui-button ui-button--primary" href="${esc(data.url)}" download="${esc(cid)}_foto.jpg">Descargar foto</a>`;
      openPageSheet(content, { title: 'Foto del vuelo', size: 'full' });
    } catch (error) { toast(error.message); }
    finally { btn.disabled = false; btn.innerHTML = icon('more'); }
  }
  document.getElementById('btn-deep')?.addEventListener('click', async e => {
    const button = e.currentTarget; button.disabled = true;
    try {
      await save('/api/analyze', { clip_id: cid });
      document.getElementById('analysis-status').textContent = 'Análisis en cola. Consulta su progreso en Actividad.';
    } catch (error) { document.getElementById('analysis-status').textContent = error.message; }
    finally { button.disabled = false; }
  });

  // highlight manual en el segundo actual del video (modal canónico, sin prompt())
  document.getElementById('btn-hl')?.addEventListener('click', () => {
    const t = +(video?.currentTime || 0).toFixed(1);
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<form class="modal fl-modal">
      <div class="modal-h"><b>${icon('plus')} Marcar momento · ${fmt.dur(t)}</b><button class="modal-x" type="button" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        <label class="mlb" for="hl-reason">¿Por qué es especial?</label>
        <input id="hl-reason" class="m-ipt fl-grow" maxlength="140" value="momento favorito" autocomplete="off">
        <p class="fl-hint" id="hl-err" role="alert" hidden></p>
        <div class="tool-row fl-actions-row"><button class="btn ui-button ui-button--primary" type="submit">Marcar</button><button class="btn ui-button ui-button--secondary" type="button" data-cancel>Cancelar</button></div>
      </div></form>`;
    const close = openPageSheet(ov, { initialFocus: '#hl-reason' });
    ov.querySelector('#hl-reason').select();
    ov.querySelector('[data-cancel]').addEventListener('click', () => close());
    ov.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const reason = ov.querySelector('#hl-reason').value.trim() || 'momento favorito';
      e.submitter && (e.submitter.disabled = true);
      try { await save('/api/highlight', { clip_id: cid, t, reason }); location.reload(); }
      catch (error) { const er = ov.querySelector('#hl-err'); er.textContent = error.message; er.hidden = false; e.submitter && (e.submitter.disabled = false); }
    });
  });

  function editFlight() {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal fl-modal">
      <div class="modal-h"><b>${icon('edit')} Editar vuelo</b><button class="modal-x" type="button" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        <label class="mlb" for="m-label">Nombre</label>
        <div class="tool-row">
          <input id="m-label" class="m-ipt fl-grow" maxlength="80" placeholder="${esc(fmt.date(meta.date))} · ${esc(meta.time)}" value="${esc(meta.label || '')}">
          <button class="btn ui-button ui-button--primary" id="m-save">Guardar</button>
        </div>
        <p class="fl-hint" id="m-error" role="alert" hidden></p>
        <div class="mlb">Galería</div>
        <button class="btn ui-button ui-button--secondary" id="m-arch" data-tip="${meta.archived ? 'Vuelve a aparecer en la galería' : 'Se oculta de la galería; nada se borra'}">${icon('db')} ${meta.archived ? 'Desarchivar' : 'Archivar'}</button>
        <div class="mlb fl-danger-lb">Papelera</div>
        <button class="btn ui-button ui-button--danger" id="m-del">${icon('warn')} Borrar este vuelo</button>
        <p class="fl-hint fl-danger-note">El video y sus datos se mueven a la papelera. La recuperación aún no está disponible en la app.</p>
      </div></div>`;
    openPageSheet(ov, { size: 'full', initialFocus: '#m-label' });
    ov.querySelector('#m-save').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      const errorLine = ov.querySelector('#m-error'); errorLine.hidden = true;
      try { await save('/api/clip', { clip_id: cid, label: ov.querySelector('#m-label').value.trim() }); location.reload(); }
      catch (error) { errorLine.textContent = error.message; errorLine.hidden = false; }
      finally { button.disabled = false; }
    });
    ov.querySelector('#m-label').addEventListener('keydown', e => {
      if (e.key === 'Enter') ov.querySelector('#m-save').click();
    });
    ov.querySelector('#m-arch').addEventListener('click', async () => {
      try { await save('/api/clip', { clip_id: cid, archived: !meta.archived }); location.href = 'index.html'; } catch (error) { toast(error.message); }
    });
    ov.querySelector('#m-del').addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) {           // confirmación en dos pasos, sin confirm() nativo
        b.dataset.armed = '1';
        b.innerHTML = `${icon('warn')} Confirmar: mover a la papelera`;
        b.classList.add('armed');
        return;
      }
      b.disabled = true;
      b.innerHTML = 'Borrando…';
      let r;
      try { r = await save('/api/clip', { clip_id: cid, delete: true }); } catch (error) { b.disabled = false; b.textContent = 'Reintentar borrado'; toast(error.message); return; }
      if (r?.ok) location.href = 'index.html';
      else { b.disabled = false; b.innerHTML = `${icon('warn')} Error: ${esc(r?.error || 'no se pudo')}`; }
    });
  }

  const flightMenuItems = [
    { id: 'edit', label: 'Editar vuelo', icon: 'edit' },
    { id: 'details', label: 'Detalles', icon: 'info' },
    { id: 'photo', label: 'Extraer foto 4K', icon: 'image' },
    { id: 'previous', label: 'Vuelo anterior', icon: 'arrowL', disabled: !older },
    { id: 'next', label: 'Vuelo siguiente', icon: 'arrowR', disabled: !newer },
  ];
  function selectFlightAction(id) {
    if (id === 'edit') editFlight();
    if (id === 'details') showDetails();
    if (id === 'photo') capturePhoto();
    if (id === 'previous' && older) location.href = `flight.html?id=${encodeURIComponent(older.clip_id)}`;
    if (id === 'next' && newer) location.href = `flight.html?id=${encodeURIComponent(newer.clip_id)}`;
  }
  document.getElementById('fl-more').addEventListener('click', e => openMenu(e.currentTarget, flightMenuItems, { onSelect: selectFlightAction }));
  if (video) document.getElementById('fl-more').classList.add('fl-flight-secondary');

  // ---- HUD ----
  document.getElementById('hud').hidden = !pts.length;
  const HUDS = [['alt', 'Altura relativa', 'm'], ['dist', 'Recorrido hasta aquí', ''], ['speed', 'Velocidad', 'km/h'],
                ['head', 'Rumbo', ''], ['iso', 'ISO', ''], ['shutter', 'Obturación', '']];
  document.getElementById('hud').innerHTML = HUDS.map(([k, lb]) =>
    `<div><div class="lb">${lb}</div><div class="v" id="hud-${k}">—</div></div>`).join('');
  function showPoint(i) {
    if (!pts.length) return;
    i = Math.max(0, Math.min(i, pts.length - 1));
    const p = pts[i];
    set('alt', `${Number.isFinite(p.rel_alt) ? Math.max(0, p.rel_alt).toFixed(0) : '—'}<small> m</small>`);
    set('dist', figure(fmt.distance(cum[i])));
    set('speed', `${Math.round(speeds[i] || 0)}<small> km/h</small>`);
    set('iso', esc(p.iso));
    set('shutter', esc(fmt.shutter(p.shutter)));
    // rumbo: bearing hacia el siguiente punto — flecha que gira con el dron
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const brg = bearing(p, q);
    const trueBrg = (brg - 270 + 360) % 360;  // brg lleva +270 (offset de la flecha); el punto cardinal usa el rumbo real
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(trueBrg / 45) % 8];
    set('head', `<span class="hud-arrow" style="transform:rotate(${Math.round(brg)}deg)">${icon('arrowR')}</span> <small>${card}</small>`);
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
  const seek = t => { if (video) { video.currentTime = Math.max(0, Math.min(t, Number.isFinite(video.duration) ? video.duration : meta.duration_s)); syncClock(); } };

  // The filmstrip is filled from approved, timestamped backend frames.
  if (meta.frame_count) {
    const strip = document.getElementById('strip');
    strip.innerHTML = '<div class="ui-skeleton ui-skeleton--media" aria-hidden="true"></div>';
    strip.addEventListener('click', e => { const button = e.target.closest('[data-t]'); if (button) seek(+button.dataset.t); });
  }

  // ---- charts SVG ----
  // colores desde los tokens del tema (los atributos SVG no resuelven var())
  const C = { accent: dataColor(), ok: dataColor() };
  const CHARTS = {};
  function chart(el, series, label, unit, color) {
    const w = 800, h = 130, max = Math.max(...series, 1), min = Math.min(...series, 0), pad = 8;
    const X = i => ((times[i] || 0) / Math.max(times.at(-1) || 1, 1)) * w;
    const Y = v => h - pad - ((v - min) / (max - min)) * (h - 34);
    const pth = series.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
    const gid = `g-${el.id}`;
    el.innerHTML = `
      <span class="chart-lb">${label}</span>
      <span class="chart-badge mono" id="${el.id}-v">— ${unit}</span>
      <span class="chart-ax mono max">${Math.round(max)} ${unit}</span>
      <span class="chart-ax mono min">${Math.round(min)} ${unit}</span>
      <div class="chart-plot">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${label}: toca para saltar el video" role="img">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
          <stop offset="1" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient></defs>
        ${[0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${w}" y1="${Y(max * f)}" y2="${Y(max * f)}"
          stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.10"/>`).join('')}
        <polyline points="${pth} ${w},${h} 0,${h}" fill="url(#${gid})" stroke="none"/>
        <polyline class="ch-line" points="${pth}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
        <line id="${el.id}-c" x1="0" x2="0" y1="0" y2="${h}" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/>
      </svg>
      <i class="chart-dot" id="${el.id}-dot" style="left:0;top:${(Y(series[0] || 0) / h * 100).toFixed(2)}%;--dot:${color}"></i>
      </div>`;
    CHARTS[el.id] = { series, unit, X, Y, w, h };
    const svg = el.querySelector('svg');
    svg.style.touchAction = 'pan-y';               // deslizar horizontal = scrub; vertical sigue scrolleando
    svg.addEventListener('click', e => {
      const r = svg.getBoundingClientRect();
      seek(((e.clientX - r.left) / r.width) * (times.at(-1) || 0));
    });
  }
  let cursorAt = () => {};
  if (pts.length) {
    chart(document.getElementById('ch-alt'), pts.map(p => Math.max(0, Number(p.rel_alt) || 0)), 'Altura relativa', 'm', C.accent);
    if (!flatSpeed) chart(document.getElementById('ch-speed'), speeds, 'Velocidad', 'km/h', C.ok);
    cursorAt = i => ['ch-alt', 'ch-speed'].forEach(id => {
      const ch = CHARTS[id];
      if (!ch) return;
      const dot = document.getElementById(`${id}-dot`);
      if (dot) { dot.style.left = `${(ch.X(i) / ch.w * 100).toFixed(2)}%`; dot.style.top = `${(ch.Y(ch.series[i] || 0) / ch.h * 100).toFixed(2)}%`; }
      const badge = document.getElementById(`${id}-v`);
      if (badge) badge.textContent = `${Math.round(ch.series[i] || 0)} ${ch.unit} · ${fmt.dur(times[i] || 0)}`;
    });
  }

  // ---- mapa ----
  let marker = null;
  if (pts.length) {
    const coords = pts.map(p => [p.lon, p.lat]);
    const map = new maplibregl.Map({
      ...mapSkinOptions,
      cooperativeGestures: true,                   // mapa mid-page: 1 dedo scrollea la página, 2 mueven el mapa
      container: 'map', style: SAT_STYLE,
      bounds: coords.reduce((bounds, point) => bounds.extend(point), new maplibregl.LngLatBounds()),
      fitBoundsOptions: { padding: 36, maxZoom: 18 },
    });
    const mapSkin = skinMap(map);
    const resize = new ResizeObserver(() => map.resize()); resize.observe(document.getElementById('map'));
    addEventListener('pagehide', () => { resize.disconnect(); mapSkin.destroy(); map.remove(); }, { once: true });
    document.addEventListener('ab-theme-change', () => {
      const color = dataColor();
      ['route', 'route-glow'].forEach(layer => { if (map.getLayer(layer)) map.setPaintProperty(layer, 'line-color', color); });
      main.querySelectorAll('.ch-line').forEach(line => line.setAttribute('stroke', color));
      main.querySelectorAll('.chart-plot stop').forEach(stop => stop.setAttribute('stop-color', color));
      main.querySelectorAll('.chart-dot').forEach(dot => dot.style.setProperty('--dot', color));
    });
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': dataColor(), 'line-width': 7, 'line-opacity': 0.22 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': dataColor(), 'line-width': 2.2 } });
      const el = document.createElement('div');
      el.className = 'fl-marker';
      el.dataset.transitionKey = `pin-${cid}`;
      el.innerHTML = `<svg width="26" height="26" viewBox="0 0 20 20"><circle class="o" cx="10" cy="10" r="5"/><circle class="i" cx="10" cy="10" r="1.6"/></svg>`;
      marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(coords[0]).addTo(map);
      map.on('click', 'route', e => {
        let best = 0, bd = Infinity;
        coords.forEach(([lon, lat], i) => {
          const d = (lon - e.lngLat.lng) ** 2 + (lat - e.lngLat.lat) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        seek(times[best]);
      });
      map.on('mouseenter', 'route', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'route', () => map.getCanvas().style.cursor = '');
      syncClock();
    });
  }

  // ---- sync + shortcuts ----
  function syncClock() {
    const time = video?.currentTime || 0;
    showPoint(sampleAt(times, time));
    const frames = [...document.querySelectorAll('#strip .fl-frame')];
    const current = frames.findLast(button => +button.dataset.t <= time);
    frames.forEach(button => button.classList.toggle('on', button === current));
  }
  ['timeupdate', 'seeked', 'play', 'pause'].forEach(event => video?.addEventListener(event, syncClock));
  const initialTime = Math.max(0, Number(new URLSearchParams(location.search).get('t')) || 0);
  if (video && initialTime) {
    if (video.readyState) seek(initialTime); else video.addEventListener('loadedmetadata', () => seek(initialTime), { once: true });
  }
  syncClock();
  loadSummary();
  async function loadSummary() {
    const region = document.getElementById('flight-summary');
    try {
      const [summary, detail] = await Promise.all([
        readAI(`/api/flight/${encodeURIComponent(cid)}/summary`),
        readAI(`/api/clip/${encodeURIComponent(cid)}/insight`),
      ]);
      const insight = detail.insight;
      region.innerHTML = `<dl><div><dt>Recorrido</dt><dd>${figure(fmt.distance(summary.distance_m))}</dd></div><div><dt>Altura máxima</dt><dd>${figure(fmt.distance(summary.max_altitude_m == null ? null : Math.max(0, summary.max_altitude_m)))}</dd></div></dl>`;
      const seenMomentLabels = new Set();
      const moments = credibleHighlights(insight, aiData?.sampled_frame_times).filter(h => {
        const label = (h.reason || '').trim().toLocaleLowerCase('es');
        if (label && seenMomentLabels.has(label)) return false;
        if (label) seenMomentLabels.add(label);
        return !manualHighlights.some(m => Math.abs(m.t - h.start) < 1);
      });
      const best = summary.best_moment;
      const verifiedBest = best?.selection === 'ai' && !best.synthetic && best.time_s >= 0 && moments.some(h => best.time_s >= h.start && best.time_s < h.end);
      const summaryText = insight?.caption_short || summary.summary;
      if (summaryText) region.append(suggestedContent(`<p>${esc(summaryText)}</p>${insight?.caption ? `<details class="ai-caption-detail"><summary>Ver descripción</summary><p>${esc(insight.caption)}</p></details>` : ''}${verifiedBest ? `<button class="ui-button ui-button--secondary tc" id="fl-best-moment" data-t="${best.time_s}">${icon('play')} Mejor momento · ${fmt.clock(best.time_s)}</button>` : ''}`));
      else region.insertAdjacentHTML('beforeend', '<p class="fl-hint">El resumen aún no está disponible.</p>');
      const frames = (detail.frames || [])
        .filter(frame => eligibleFrame(frame) && Number.isFinite(frame.frame_time_s)
          && frame.frame_time_s >= 0 && frame.frame_time_s <= meta.duration_s)
        .sort((a, b) => a.frame_time_s - b.frame_time_s)
        .filter((frame, i, rows) => rows.findIndex(row => row.frame_url === frame.frame_url) === i);
      if (frames.length) {
        if (video) video.poster = thumbnailURL(detail);
        else { const img = slot.querySelector('img'); if (img) { img.src = thumbnailURL(detail); img.hidden = false; } }
      }
      // Ten targets cover the complete available timeline, including both ends.
      const count = Math.min(10, frames.length);
      const filmstrip = [...new Set(Array.from({ length: count }, (_, i) => {
        const target = frames[0].frame_time_s + (frames.at(-1).frame_time_s - frames[0].frame_time_s) * i / Math.max(1, count - 1);
        return frames.reduce((best, frame) => Math.abs(frame.frame_time_s - target) < Math.abs(best.frame_time_s - target) ? frame : best);
      }))];
      const strip = document.getElementById('strip');
      if (strip) strip.innerHTML = filmstrip.map(frame => `<button class="fl-frame" data-t="${frame.frame_time_s}" aria-label="Ir a ${fmt.clock(frame.frame_time_s)}"><img src="${esc(frame.frame_url)}" alt="" loading="lazy"><span>${fmt.clock(frame.frame_time_s)}</span></button>`).join('') || '<p class="fl-hint">No hay fotogramas seleccionados.</p>';
      syncClock();
      const analysisBody = document.querySelector('.fl-ai .pb');
      analysisBody.querySelector('.ui-suggested')?.remove();
      analysisBody.querySelector('.fl-hint')?.remove();
      if (insight) {
        const chips = clipChips(insight, { compact: true });
        analysisBody.prepend(suggestedContent(chips));
      }
      const list = document.getElementById('hl-list');
      list.innerHTML = highlightRows(manualHighlights);
      if (moments.length) {
        const container = document.createElement('div');
        for (const h of moments) {
          const key = `ab.moment.dismissed.${cid}.${h.start}`;
          if (localStorage.getItem(key)) continue;
          const reason = h.label || h.reason || '';
          const target = h.evidence?.peak_time_s ?? h.start;
          const frame = frames.filter(frame => frame.frame_time_s >= h.start && frame.frame_time_s < h.end)
            .sort((a, b) => Math.abs(a.frame_time_s - target) - Math.abs(b.frame_time_s - target))[0];
          const item = suggestedContent(highlightRows([{ ...h, reason, frame, t: h.start }]), {
            onAccept: async () => { const label = reason || fmt.clock(h.start); await save('/api/highlight', { clip_id: cid, t: h.start, reason: label }); manualHighlights.push({ t: h.start, reason: label, type: 'manual' }); },
            onDismiss: () => { localStorage.setItem(key, '1'); item.remove(); if (!container.childElementCount) container.closest('.ui-suggested')?.remove(); },
          });
          item.classList.add('fl-moment-suggestion');
          item.querySelector('.ui-suggested-label').remove();
          const actions = item.querySelector('.ui-suggested-actions');
          for (const [i, button] of [...actions.querySelectorAll('button')].entries()) {
            const label = button.textContent; button.setAttribute('aria-label', label); button.title = label;
            button.innerHTML = icon(i === 0 ? 'check' : 'close');
          }
          item.querySelector('.hl-item').insertBefore(actions, item.querySelector('.fl-moment-menu'));
          item.setAttribute('aria-label', `Momento a ${fmt.clock(h.start)}`);
          container.append(item);
        }
        if (container.childElementCount) {
          const section = suggestedContent(container.innerHTML); section.querySelector('.ui-suggested-content').replaceChildren(container); list.append(section);
        }
      }
      if (!list.childElementCount) list.innerHTML = '<p class="fl-hint">Sin momentos confirmados. Pausa el video y selecciona Marcar aquí.</p>';
    } catch {
      document.getElementById('hl-list').innerHTML = highlightRows(manualHighlights) + '<p class="fl-hint">No se pudieron cargar los momentos.</p>';
      region.innerHTML = '<p class="fl-hint">No se pudo cargar el resumen. <button class="ui-button ui-button--quiet">Reintentar</button></p>';
      region.querySelector('button').addEventListener('click', loadSummary);
    } finally { region.setAttribute('aria-busy', 'false'); document.getElementById('hl-list').setAttribute('aria-busy', 'false'); }
  }
  main.addEventListener('click', e => {
    const button = e.target.closest('.fl-moment-menu');
    if (button) openMenu(button, [{ id: 'edit', label: 'Editar en Studio', icon: 'edit',
      href: `studio.html?clip=${encodeURIComponent(cid)}&a=${button.dataset.editStart}&b=${button.dataset.editEnd}` }]);
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
  });
  document.addEventListener('keydown', e => {
    if (!video || !acceptsShortcut(e) || document.querySelector('dialog[open]')) return;
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(video.currentTime - 5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(video.currentTime + 5); }
    if (e.key === 'f') document.querySelector('.fl-video').requestFullscreen?.();
  });
})().catch(() => renderFailure(main));
