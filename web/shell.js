// App shell: sidebar nav, shared formatters, data access. Requires icons.js.
const DATA = 'data';

// ---- captura global de errores JS → /api/client_error (registro central + reporte DeepSeek).
// sendBeacon: no bloquea ni falla ruidoso; máx 5 por sesión de página (anti-loop de un error
// que se repite en cada frame). El server además rate-limita globalmente.
(() => {
  let sent = 0;
  const report = (msg, stack) => {
    if (sent >= 5 || !navigator.sendBeacon) return;
    sent++;
    try {
      navigator.sendBeacon('/api/client_error', new Blob([JSON.stringify({
        msg: String(msg).slice(0, 300),
        stack: String(stack || '').slice(0, 200),
        page: location.pathname.split('/').pop(),
      })], { type: 'application/json' }));
    } catch { /* jamás romper la app por reportar */ }
  };
  addEventListener('error', e => report(e.message, e.error?.stack));
  addEventListener('unhandledrejection', e => report(`unhandled: ${e.reason?.message || e.reason}`, e.reason?.stack));
})();

const NAV = [
  { href: 'home.html', ic: 'gauge', label: 'Inicio' },
  { href: 'index.html', ic: 'grid', label: 'Vuelos' },
  { href: 'drone.html', ic: 'drone', label: 'Dron' },
  { href: 'trips.html', ic: 'pin', label: 'Viajes' },
  { href: 'mundo.html', ic: 'globe', label: 'Mundo' },
  { href: 'studio.html', ic: 'film', label: 'Studio' },
  { href: 'tresd.html', ic: 'cube', label: '3D' },
  { href: 'splatlab.html', ic: 'spark', label: 'Splat Lab' },
  { href: 'system.html', ic: 'db', label: 'Sistema' },
];

// scrub de miniaturas compartido (Vuelos, Viajes, Inicio): mouse hover + swipe horizontal iOS
function attachScrub(root) {
  root.querySelectorAll('.card.scrub, .cr-item.scrub').forEach(cardEl => {
    const n = +cardEl.dataset.frames;
    if (!n) return;
    const img = cardEl.querySelector('img');
    const line = cardEl.querySelector('.scrub-line');
    if (!img || !line) return;
    const orig = img.src;
    const at = frac => {
      const i = Math.max(1, Math.ceil(frac * n));
      img.src = `${DATA}/frames/${cardEl.dataset.cid}/f_${String(i).padStart(4, '0')}.jpg`;
      line.style.width = `${(frac * 100).toFixed(1)}%`;
      line.style.opacity = 1;
    };
    cardEl.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;              // touch usa el gesto propio
      const r = cardEl.getBoundingClientRect();
      at((e.clientX - r.left) / r.width);
    });
    cardEl.addEventListener('pointerleave', () => { img.src = orig; line.style.opacity = 0; });
    // iOS: deslizar horizontal sobre el thumb scrubbea; vertical sigue scrolleando
    let t0 = null, scrubT = 0;
    cardEl.addEventListener('touchstart', e => { t0 = e.touches[0]; clearTimeout(scrubT); }, { passive: true });   // cancela un reset pendiente del gesto anterior
    cardEl.addEventListener('touchmove', e => {
      if (!t0) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - t0.clientX) > Math.abs(t.clientY - t0.clientY) + 6) {
        const r = cardEl.getBoundingClientRect();
        at(Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)));
        e.preventDefault();
      }
    }, { passive: false });
    cardEl.addEventListener('touchend', () => {
      t0 = null;
      clearTimeout(scrubT);   // reemplaza (no acumula) el reset; se cancela si empieza otro scrub
      scrubT = setTimeout(() => { img.src = orig; line.style.opacity = 0; }, 900);
    });
  });
}

// escape HTML: TODO texto de usuario/LLM pasa por aquí antes de innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// sesión de operador: cookie HttpOnly (credenciales NUNCA se guardan en el navegador).
// Varios api() pueden recibir 403 a la vez (al cargar la página se disparan varios POST):
// deben COMPARTIR un único login en vuelo. Hoy el 2º+ ve el overlay #login-ov ya presente,
// loginModal() resuelve false por su guard singleton, y api() lanza 'sin sesión' en falso.
let authInFlight = null;   // promesa del login en curso, compartida entre llamadas concurrentes
async function ensureAuth() {
  if ((await fetch('/api/whoami')).ok) return true;
  // single-flight: el primer 403 abre el modal; los demás esperan ESA misma promesa en vez de
  // ver el overlay ya presente y resolver false ('sin sesión' en falso para sus POST)
  if (!authInFlight) {
    authInFlight = loginModal().finally(() => { authInFlight = null; });
  }
  return authInFlight;
}
function loginModal() {
  return new Promise(resolve => {
    if (document.getElementById('login-ov')) { resolve(false); return; }
    const ov = document.createElement('div');
    ov.id = 'login-ov';
    ov.className = 'login-ov';
    ov.innerHTML = `
      <form class="login-card" id="login-form">
        <div class="login-brand"><span class="mark">${icon('drone')}</span>
          <div><b>AeroBrain</b><span>Iniciar sesión</span></div></div>
        <label>Correo<input type="email" id="lg-user" autocomplete="username" value="reyesusma@hotmail.com" required></label>
        <label>Contraseña<input type="password" id="lg-pass" autocomplete="current-password" required autofocus></label>
        <div class="login-err" id="lg-err"></div>
        <button class="btn primary big" type="submit" id="lg-go">Entrar</button>
        <button class="btn" type="button" id="lg-cancel">Cancelar</button>
      </form>`;
    document.body.appendChild(ov);
    const done = ok => { ov.remove(); resolve(ok); };
    ov.querySelector('#lg-cancel').onclick = () => done(false);
    ov.addEventListener('click', e => { if (e.target === ov) done(false); });
    ov.querySelector('#login-form').onsubmit = async e => {
      e.preventDefault();
      const go = ov.querySelector('#lg-go'); go.textContent = 'Entrando…'; go.disabled = true;
      let r;
      try {
        r = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: ov.querySelector('#lg-user').value.trim(),
            password: ov.querySelector('#lg-pass').value }) });
      } catch {
        ov.querySelector('#lg-err').textContent = 'Sin conexión — revisa la red e intenta de nuevo.';
        go.textContent = 'Entrar'; go.disabled = false;
        return;
      }
      if (r.ok) return done(true);
      ov.querySelector('#lg-err').textContent = 'Correo o contraseña incorrectos.';
      go.textContent = 'Entrar'; go.disabled = false;
      ov.querySelector('#lg-pass').select();
    };
    setTimeout(() => ov.querySelector('#lg-pass').focus(), 50);
  });
}
// POST autenticado vía cookie de sesión; pide login solo si hace falta
async function api(path, body) {
  let r = await fetch(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (r.status === 403) {
    if (!await ensureAuth()) throw new Error('sin sesión');
    r = await fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  return r.json();
}
// compat: código viejo llama getToken() como gate — ahora solo asegura sesión
function getToken() { return 'session'; }
// migración: borra el token que versiones anteriores dejaron en localStorage
localStorage.removeItem('ab_token');
// limpia códigos ANSI/escape que ODM mete en el log
function cleanLog(t) {
  return String(t || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\^?\[\[[0-9;]*m/g, '').trim();
}
const KIND_META = {
  ingest: { ic: 'dl', name: 'Importar SD' },
  '3d': { ic: 'cube', name: 'Modelo 3D' },
  splat: { ic: 'layers', name: 'Gaussian Splat' },
  edit: { ic: 'film', name: 'Edición' },
  upload: { ic: 'dl', name: 'Subida' },
  analyze: { ic: 'spark', name: 'Análisis AI' },
  foto4k: { ic: 'iso', name: 'Foto 4K' },
};
// etapa humana a partir del log/detail de ODM
function humanStage(j) {
  const src = cleanLog(j.log_tail) + ' ' + (j.detail || '');
  // orden inverso al pipeline: la línea MÁS TARDÍA del tail decide la etapa
  const M = [
    [/Step \d+|entrenando/i, 'Entrenando el splat'],
    [/publicando assets|browser gate|gdal_translate.*ortho/i, 'Publicando assets web'],
    [/running odm_orthophoto|orthophoto area/i, 'Generando ortofoto'],
    [/running odm_dem|gapfill|merged\.vrt/i, 'Calculando elevación (DSM)'],
    [/running (mvs_|odm_)texturing|mvstex/i, 'Texturizando el modelo'],
    [/running odm_meshing|PoissonRecon|dem2mesh/i, 'Generando malla 3D'],
    [/running odm_filterpoints/i, 'Filtrando nube de puntos'],
    [/Fused depth-maps/i, 'Fusionando depthmaps (GPU)'],
    [/Point visibility/i, 'Verificando visibilidad de puntos'],
    [/Estimated depth-maps|DensifyPointCloud|running openmvs/i, 'Calculando depthmaps'],
    [/Undistorting image/i, 'Undistorsionando imágenes'],
    [/resection inliers|incremental reconstruction/i, 'Reconstruyendo cámaras 3D'],
    [/Matching f_|pairs matching/i, 'Emparejando imágenes'],
    [/Extracting ROOT_|detect_features/i, 'Extrayendo características'],
    [/geotag|exiftool/i, 'Geoetiquetando con tu GPS'],
    [/frames: \d+/, 'Extrayendo frames del video'],
  ];
  for (const [re, label] of M) if (re.test(src)) return label;
  return j.detail || '';
}
function jobDuration(seconds) {
  seconds = Number(seconds || 0);
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return seconds ? `${Math.round(seconds)} s` : '—';
}
function jobTimingLabel(j) {
  if (j?.status === 'queued') return 'esperando turno';
  const duration = jobDuration(j?.elapsed_s);
  return j?.status === 'running' ? `${duration} transcurridos` : `${duration} total`;
}
function presetLabel(value) {
  return ({ rapido: 'Rápido', estandar: 'Estándar', alta: 'Alta', extra: 'Extra',
    ultra: 'Ultra 15K', ultra20: 'Ultra+ 20K', frontier: 'Frontier 30K',
    grandmaster: 'Grandmaster 40K', medium: 'Medium 2K', cinematic: 'Cinematic 7K',
    fast: 'Fast 1K' })[value] || value || '—';
}
function backendBadge(backend) {
  if (!backend) return '';
  const b = String(backend);
  const kind = /cuda|nvidia/i.test(b) ? 'cuda' : /metal|mps/i.test(b) ? 'metal' : 'cpu';
  const label = { cuda: 'NVIDIA CUDA', metal: 'Apple Metal', cpu: 'CPU' }[kind];
  const chip = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6 4V1.5M10 4V1.5M6 14.5V12M10 14.5V12M4 6H1.5M4 10H1.5M14.5 6H12M14.5 10H12"/></svg>';
  return `<span class="jc-backend ${kind}" title="Backend de cómputo: ${esc(b)}">${chip}${label}</span>`;
}
const PHASES_3D = [
  ['frames', 'Frames', 'extracción del video + geotag GPS', 0.05, 0.16],
  ['odm', 'Fotogrametría', 'features → SfM → depthmaps → malla', 0.16, 0.96],
  ['publish', 'Publicar', 'ortofoto, DSM y visor web', 0.96, 1.0],
];
function fmtDur(sec) {
  if (sec == null || sec < 0) return '—';
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.round(sec % 3600 / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.round(sec)}s`;
}
function phaseKey(stage) {
  const value = String(stage || '').trim().toLowerCase();
  if (value === 'frames') return 'frames';
  if (value === 'publish' || value === 'browser-qa') return 'publish';
  if (value === 'odm' || value.startsWith('odm-')) return 'odm';
  return value;
}
function phaseDash(j, pct) {
  if (j.kind !== '3d') return '';
  const hist = j.stage_history || [];
  const now = Date.now() / 1000;
  const starts = {};
  hist.forEach(h => { const k = phaseKey(h.stage); if (!(k in starts)) starts[k] = h.ts; });
  if (j.started && !('frames' in starts)) starts.frames = j.started;
  const activeKey = phaseKey(j.stage);
  // done/act por ORDEN de pipeline — los timestamps solo aportan duraciones:
  // un job anterior al tracking de stages no debe mostrar fases pasadas como pendientes
  const activeIdx = Math.max(0, PHASES_3D.findIndex(ph => ph[0] === activeKey));
  const rows = PHASES_3D.map(([key, name, sub, lo, hi], i) => {
    const st = starts[key];
    const nextSt = PHASES_3D.slice(i + 1).map(ph => starts[ph[0]]).find(Boolean);
    const done = j.status === 'done' || i < activeIdx;
    const act = !done && i === activeIdx && ['running', 'queued'].includes(j.status);
    const end = nextSt ?? (j.status === 'done' ? (j.finished || now) : null);
    const dur = st != null ? ((done ? end : now) != null ? (done ? end : now) - st : null) : null;
    const width = done ? 100 : act && pct != null
      ? Math.round(100 * Math.min(1, Math.max(0, (pct / 100 - lo) / (hi - lo)))) : 0;
    return `<div class="jc-ph-row ${done ? 'done' : act ? 'act' : 'pend'}">
      <span class="jc-ph-dot"></span>
      <div class="jc-ph-main"><b>${name}</b><span>${sub}</span></div>
      <div class="jc-ph-bar"><div style="width:${width}%"></div></div>
      <span class="jc-ph-time mono">${done ? (st != null ? fmtDur(dur) : '✓')
        : act ? `<b>${width}%</b>${st != null ? ' · ' + fmtDur(dur) : ''}` : '—'}</span>
    </div>`;
  }).join('');
  return `<div class="jc-ph">${rows}</div>`;
}
function phaseRateText(j) {
  const units = { cameras: 'cámaras', features: 'features', images: 'imágenes', points: 'puntos' };
  const unit = units[j.phase_unit] || 'elementos';
  return `${Number(j.phase_items_per_minute).toFixed(1)} ${unit}/min`;
}
function jobDataGrid(j) {
  const cells = [];
  if (j.input_mb) cells.push(['PESO ENTRADA', j.input_mb >= 1024
    ? (j.input_mb / 1024).toFixed(1) + ' GB' : j.input_mb + ' MB']);
  // backend del row cuando existe; si no, el detail del worker es autoritativo
  // ("...en NVIDIA CUDA") — jamás asumir Mac por defecto en un job remoto
  const cudaJob = /cuda|nvidia/i.test(j.effective_backend || j.backend || j.requested_backend || '') ||
    (['running', 'queued'].includes(j.status) && /NVIDIA CUDA/i.test(j.detail || ''));
  const hw = cudaJob ? 'RTX 4060 Ti · 8c WSL'
    : j.backend ? 'Mac M4 · 10 cores'
    : ['3d', 'splat'].includes(j.kind) && !['running', 'queued'].includes(j.status)
      ? 'Mac M4 · 10 cores' : null;
  if (hw) cells.push(['PROCESADOR', hw]);
  if (j.images_total) cells.push(['IMÁGENES', j.images_total]);
  else if (j.cameras_registered != null)
    cells.push(['CÁMARAS', `${j.cameras_registered}/${j.cameras_total || '?'}`, 'registered-cameras']);
  if (j.active_sources != null && j.total_sources)
    cells.push(['FUENTES ACTIVAS', `${j.active_sources}/${j.total_sources}`, 'active-sources']);
  if (j.good_tracks)
    cells.push(['TRACKS ROBUSTOS', Number(j.good_tracks).toLocaleString(), 'good-tracks']);
  const iterations = j.iterations || j.requested_iterations;
  if (iterations) cells.push(['ITERACIONES', iterations >= 1000
    ? (iterations / 1000) + 'k' : iterations]);
  if (j.current_iteration != null && j.target_iterations)
    cells.push(['PASO EN VIVO', `${Number(j.current_iteration).toLocaleString()} / ${Number(j.target_iterations).toLocaleString()}`, 'iteration']);
  if (j.phase_completed != null && j.phase_total)
    cells.push(['FASE EN VIVO', `${Number(j.phase_completed).toLocaleString()} / ${Number(j.phase_total).toLocaleString()}`, 'phase-count']);
  if (j.iterations_per_second)
    cells.push(['RITMO MEDIDO', `${Number(j.iterations_per_second).toFixed(1)} iter/s`, 'rate']);
  if (j.phase_items_per_minute)
    cells.push(['RITMO FASE', phaseRateText(j), 'phase-rate']);
  if (j.eta_remaining_s != null)
    cells.push([j.eta_source === 'trainer_live' ? 'ETA TRAINER' : 'ETA FASE',
      fmtDur(j.eta_remaining_s), 'eta']);
  if (j.image_cache_device) {
    const cacheMiB = Number(j.decoded_image_cache_mib || 0);
    const cacheSize = cacheMiB >= 1024 ? `${(cacheMiB / 1024).toFixed(1)} GB`
      : cacheMiB ? `${Math.round(cacheMiB)} MiB` : '';
    cells.push(['CACHE IMÁGENES', `${String(j.image_cache_device).toUpperCase()}${cacheSize ? ` · ${cacheSize}` : ''}`]);
  }
  if (j.resumed_from_step)
    cells.push([j.status === 'queued' ? 'REANUDARÁ DESDE' : 'REANUDADO DESDE',
      `Paso ${Number(j.resumed_from_step).toLocaleString()}`]);
  else if (j.resume_available && j.checkpoint_step)
    cells.push(['CHECKPOINT SEGURO', `Paso ${Number(j.checkpoint_step).toLocaleString()}`]);
  if (j.gaussians) cells.push(['GAUSSIANAS', j.gaussians >= 1e6
    ? (j.gaussians / 1e6).toFixed(2) + ' M' : Math.round(j.gaussians / 1000) + ' k']);
  if (!cells.length) return '';
  return `<div class="jc-data">${cells.map(([lb, v, field]) =>
    `<div class="jc-data-cell"${field ? ` data-live-field="${field}"` : ''}><span>${lb}</span><b class="mono">${v}</b></div>`).join('')}</div>`;
}
function jobCard(j, flightsIdx, entering = true) {
  const meta = KIND_META[j.kind] || { ic: 'activity', name: j.kind };
  const f = flightsIdx?.[j.label];
  const subject = j.title || (f ? (f.label || fmt.date(f.date) + ' ' + f.time) : j.label || 'trabajo');
  const titleText = `${meta.name} · ${subject}`;
  const title = esc(titleText);
  const stLabel = { running: 'procesando', queued: 'en cola', done: 'listo',
    error: 'falló', cancelled: 'cancelado', cancel_failed: 'cancel falló' }[j.status] || j.status;
  const outcomeLabel = j.outcome === 'completed_with_fallback' ? 'listo con fallback' : stLabel;
  const pct = Number.isFinite(+j.progress) ? Math.round(+j.progress * 100) : null;
  const lastLog = cleanLog((j.log_tail || '').split('\n').pop());
  const quality = [];
  if (j.requested_preset) quality.push(`<span><b>${j.kind === 'splat' ? 'Splat' : 'ODM'}</b> · ${esc(presetLabel(j.requested_preset))} solicitada</span>`);
  if (j.effective_preset) quality.push(`<span><b>Efectiva</b> · ${esc(presetLabel(j.effective_preset))}</span>`);
  if (j.dense_quality) quality.push(`<span><b>Nube densa</b> · ${esc(presetLabel(j.dense_quality))}${j.dense_quality_requested && j.dense_quality_requested !== j.dense_quality ? ` (solicitada ${esc(j.dense_quality_requested)})` : ''}</span>`);
  if (j.input_scale > 1) quality.push(`<span><b>Entrada</b> · -d ${esc(j.input_scale)}</span>`);
  if (j.kind === 'splat' && j.requested_resolution)
    quality.push(`<span><b>Resolución solicitada</b> · ${esc({ auto: 'Auto · completa primero', full: 'Completa', half: '½ resolución' }[j.requested_resolution] || j.requested_resolution)}</span>`);
  if (j.kind === 'splat' && j.effective_resolution)
    quality.push(`<span><b>Resolución efectiva</b> · ${esc(j.effective_resolution === 'half' ? '½ resolución' : 'Completa')}</span>`);
  if (j.kind === 'splat' && /cuda/i.test(j.requested_backend || ''))
    quality.push('<span><b>Política</b> · CUDA estricto</span>');
  if (j.kind === 'splat' && j.image_cache_device)
    quality.push(`<span title="La resolución de entrada no cambia"><b>Cache</b> · ${String(j.image_cache_device).toUpperCase()}${j.image_cache_device === 'cpu' ? ' · VRAM libre para gaussianas' : ' · acceso rápido en GPU'}</span>`);
  if (j.kind === 'splat' && j.resume_available && j.checkpoint_step)
    quality.push(`<span><b>Recuperación</b> · checkpoint ${Number(j.checkpoint_step).toLocaleString()} verificado</span>`);
  if (j.kind === 'splat' && j.resumed_from_step)
    quality.push(`<span><b>Continuidad</b> · ${j.status === 'queued' ? 'preparado para reanudar desde' : 'reanudado desde'} ${Number(j.resumed_from_step).toLocaleString()}</span>`);
  const attempts = Array.isArray(j.attempts) ? j.attempts : [];
  const attemptScales = [...new Set(attempts.map(a => Number(a.d)).filter(Boolean))];
  const facts = [
    j.cameras_registered != null ? `${j.cameras_registered}/${j.cameras_total || j.cameras_registered} cámaras` : '',
    j.source_count ? `${j.source_count} video${j.source_count === 1 ? '' : 's'}` : '',
    j.photo_count ? `${j.photo_count} foto${j.photo_count === 1 ? '' : 's'}` : '',
    j.product_mode ? String(j.product_mode).replaceAll('_', ' ') : '',
    j.iterations ? `${j.iterations >= 1000 && j.iterations % 1000 === 0 ? `${j.iterations / 1000}k` : j.iterations} iteraciones` : '',
    j.peak_mib ? `pico ${j.peak_mib} MiB${j.memory_cap_mib ? ` / ${j.memory_cap_mib}` : ''}` : '',
    attemptScales.length > 1 ? 'OOM CUDA: completa → ½ resolución' :
      attempts.length ? `${attempts.length} intento${attempts.length === 1 ? '' : 's'} CUDA` : '',
  ].filter(Boolean);
  const search = `${titleText} ${j.kind} ${j.status} ${j.backend || ''} ${j.detail || ''} ${quality.join(' ')}`.toLowerCase();
  return `
  <article class="job-card${entering ? '' : ' upd'}" data-jid="${esc(j.id)}" data-kind="${esc(j.kind)}" data-status="${esc(j.status)}" data-search="${esc(search)}">
    <div class="jc-eyebrow">${icon(meta.ic)}<span>${esc(meta.name)}</span>
      <span class="spacer"></span>
      ${backendBadge(j.effective_backend || j.backend || j.requested_backend)}
      <span class="jc-status ${esc(j.status)}${j.fallback ? ' fallback' : ''}">${['running','queued'].includes(j.status) ? '<i class="jc-pulse"></i>' : ''}${esc(outcomeLabel)}${pct != null && j.status === 'running' ? ` ${pct}%` : ''}</span></div>
    <div class="jc-head"><span class="jc-title">${esc(subject)}</span></div>
    ${quality.length ? `<div class="jc-quality">${quality.join('')}</div>` : ''}
    ${['running', 'queued'].includes(j.status) ? `
      <div class="jc-run">
        ${phaseDash(j, pct)}
        <div class="jc-run-top">
          <span class="jc-run-stage">${esc(humanStage(j) || 'procesando\u2026')}</span>
          <b class="jc-run-pct mono">${pct != null ? pct + '%' : ''}</b>
        </div>
        ${j.detail && humanStage(j) !== j.detail ? `<div class="jc-run-detail">${esc(j.detail)}</div>` : ''}
        ${pct != null ? `<div class="jc-bar" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>` : ''}
        ${lastLog && j.status === 'running' ? `<button class="jc-ticker mono" data-job-log="${esc(j.id)}" title="Abrir log completo"><span class="jc-tick-dot"></span>${esc(lastLog.slice(0, 160))}</button>` : ''}
        ${jobDataGrid(j)}
      </div>` : ''}
    ${facts.length ? `<div class="jc-facts">${facts.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    ${!['running', 'queued'].includes(j.status) ? jobDataGrid(j) : ''}
    <div class="jc-meta"><span>${esc(j.id)}</span><span>${jobTimingLabel(j)}</span></div>
    ${lastLog && !['running', 'queued'].includes(j.status) ? `<button class="jc-log" data-job-log="${esc(j.id)}" title="Abrir log completo">${esc(lastLog)}</button>` : ''}
    ${j.status === 'queued' ? `<div class="jc-stage">Esperando turno — el worker procesa un trabajo pesado a la vez.</div>` : ''}
    ${j.detail && !['running', 'queued'].includes(j.status) ? `<div class="jc-result ${j.status === 'error' ? 'error' : ''}">${esc(j.detail)}</div>` : ''}
    <div class="jc-actions">
      <button class="btn" data-job-log="${esc(j.id)}">${icon('list')} Logs completos</button>
      ${j.status === 'done' && ['3d', 'splat'].includes(j.kind) ? `<a class="btn primary" href="tresd.html">${j.kind === '3d' ? 'Ver escena' : 'Ver splat'}</a>` : ''}
      ${j.status === 'done' && !['3d', 'splat'].includes(j.kind) && j.artifact && j.artifact_exists ? `<a class="btn primary" href="data/${esc(j.artifact)}" target="_blank">Abrir</a>` : ''}
      ${['running', 'queued'].includes(j.status) && ['3d', 'splat'].includes(j.kind) ? `<button class="btn danger" data-cancel="${esc(j.id)}">Cancelar</button>` : ''}
    </div>
  </article>`;
}

let jobLogState = null;
function renderJobLog() {
  const drawer = document.getElementById('job-log-drawer');
  if (!drawer || !jobLogState) return;
  const q = (drawer.querySelector('[data-log-search]')?.value || '').toLowerCase();
  const level = drawer.querySelector('[data-log-level]')?.value || 'all';
  const classify = line => /error|traceback|failed|falló|oom/i.test(line) ? 'error'
    : /warn|warning|aviso|fallback|retry/i.test(line) ? 'warning' : 'info';
  const visible = jobLogState.lines.filter(line => (!q || line.toLowerCase().includes(q))
    && (level === 'all' || classify(line) === level));
  const pre = drawer.querySelector('.jl-pre');
  pre.textContent = visible.join('\n') || 'Sin líneas para este filtro.';
  drawer.querySelector('.jl-count').textContent = `${visible.length}/${jobLogState.lines.length} líneas cargadas`;
  if (jobLogState.autoscroll) pre.scrollTop = pre.scrollHeight;
}
async function fetchJobLogChunk() {
  if (!jobLogState || jobLogState.loading || jobLogState.eof || jobLogState.paused) return;
  jobLogState.loading = true;
  try {
    const r = await fetch(`/api/job_log?id=${encodeURIComponent(jobLogState.id)}&after=${jobLogState.cursor}&limit=500`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const chunk = await r.json();
    jobLogState.lines.push(...(chunk.lines || []));
    jobLogState.cursor = chunk.next || jobLogState.cursor;
    jobLogState.eof = !!chunk.eof;
    renderJobLog();
  } finally { jobLogState.loading = false; }
}
async function openJobLog(jid) {
  document.getElementById('job-log-drawer')?.remove();
  const detail = await (await fetch(`/api/job?id=${encodeURIComponent(jid)}`)).json();
  const job = detail.job || {};
  jobLogState = { id: jid, cursor: 0, lines: [], eof: false, paused: false,
    autoscroll: true, loading: false, timer: 0 };
  const drawer = document.createElement('section');
  drawer.id = 'job-log-drawer';
  drawer.className = 'job-log-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', `Logs de ${jid}`);
  const requested = presetLabel(job.requested_preset);
  const effective = presetLabel(job.effective_preset);
  drawer.innerHTML = `<div class="jl-head"><div><b>${esc(job.title || job.label || jid)}</b>
      <span>${esc(job.kind || '')} · solicitada ${esc(requested)}${job.effective_preset ? ` · efectiva ${esc(effective)}` : ''}</span></div>
      <button class="btn" data-log-close aria-label="Cerrar logs">Cerrar</button></div>
    <div class="jl-events">${(job.events || []).map(e => `<span class="${esc(e.level)}"><b>${esc(e.event)}</b>${esc(e.message || '')}</span>`).join('')}</div>
    <div class="jl-tools">
      <div class="search">${icon('search')}<input type="search" data-log-search placeholder="Buscar en logs…" aria-label="Buscar en logs"></div>
      <select class="ctl" data-log-level aria-label="Nivel del log"><option value="all">Todos</option><option value="info">Info</option><option value="warning">Avisos</option><option value="error">Errores</option></select>
      <button class="btn" data-log-wrap>Ajustar líneas</button>
      <button class="btn" data-log-pause>Pausar</button>
      <button class="btn on" data-log-autoscroll>Autoscroll</button>
      <button class="btn" data-log-copy>Copiar</button>
      <button class="btn" data-log-download>Descargar</button>
    </div>
    <div class="jl-meta"><span class="jl-count">0 líneas</span><button class="linklike" data-log-more>Cargar más</button></div>
    <pre class="jl-pre" tabindex="0"></pre>`;
  document.body.appendChild(drawer);
  drawer.querySelector('[data-log-close]').focus();
  await fetchJobLogChunk();
  if (!jobLogState.lines.length && job.log_tail) {
    jobLogState.lines = ['[histórico] Este trabajo es anterior al log completo.', ...job.log_tail.split('\n')];
    renderJobLog();
  }
  jobLogState.timer = setInterval(() => { if (!jobLogState?.paused) { jobLogState.eof = false; fetchJobLogChunk(); } }, 2500);
}
function closeJobLog() {
  if (jobLogState?.timer) clearInterval(jobLogState.timer);
  jobLogState = null;
  document.getElementById('job-log-drawer')?.remove();
}
function orderJobsForDisplay(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const running = rows.filter(j => j.status === 'running')
    .sort((a, b) => Number(b.started || 0) - Number(a.started || 0));
  const queued = rows.filter(j => j.status === 'queued')
    .sort((a, b) => Number(a.started || 0) - Number(b.started || 0));
  const history = rows.filter(j => !['running', 'queued'].includes(j.status));
  return [...running, ...queued, ...history];
}
async function pollJobs(el, every = 2500, onDone = null) {
  let flightsIdx = null;
  try {
    const fl = await getFlights();
    flightsIdx = Object.fromEntries(fl.map(f => [f.clip_id, f]));
  } catch {}
  let busy = false;
  const prevStatus = {};   // detectar transición running/queued → done (hook onDone)
  const paint = async () => {
    if (busy) return;                                     // guard de overlap: polls lentos no se pisan (#44)
    busy = true;
    try {
      const res = await fetch('/api/jobs');
      if (res.status === 403) { el.innerHTML = '<p class="footer-note">Inicia sesión para ver trabajos.</p>'; return; }
      const { jobs = [], counts = {} } = await res.json(); // respuesta sin jobs → [] (no crash) (#46)
      if (onDone) {
        for (const j of jobs) {
          if (j.status === 'done' && ['running', 'queued'].includes(prevStatus[j.id])) {
            try { onDone(j); } catch { /* el hook jamás rompe el poller */ }
          }
          prevStatus[j.id] = j.status;
        }
      }
      if (!jobs.length) { el.innerHTML = '<p class="footer-note">Sin trabajos aún.</p>'; return; }
      // El operador necesita ver primero lo que realmente consume el worker. Las campañas
      // pueden llevar timestamps futuros para preservar su orden de claim; el orden crudo
      // DESC del API las pondría delante del job en ejecución y además invertiría la cola.
      const list = orderJobsForDisplay(jobs);
      // hash ESTRUCTURAL: solo lo que cambia la forma de la card. Los valores vivos
      // (progreso, ticker, tiempos) se parchan in-place — reemplazar el nodo cada poll
      // re-disparaba animaciones y producía el jitter de 1s en la card activa
      const hash = j => [j.status, j.stage, j.requested_preset,
        j.effective_preset, j.outcome, j.backend,
        j.resume_available ? j.checkpoint_step : '', j.resumed_from_step || '',
        j.current_iteration != null ? 'live-iterations' : '',
        j.phase_items_per_minute != null ? 'counted_phase_live' : '',
        j.cameras_registered != null ? 'registered-cameras' : '',
        j.active_sources != null ? 'active-sources' : '',
        j.good_tracks != null ? 'good-tracks' : '',
        (j.stage_history || []).length].join('|');
      const patchLive = (node, j) => {
        const pct = Number.isFinite(+j.progress) ? Math.round(+j.progress * 100) : null;
        const setTxt = (sel, v) => { const n = node.querySelector(sel);
          if (n && v != null && n.textContent !== String(v)) n.textContent = v; };
        setTxt('.jc-run-pct', pct != null ? pct + '%' : '');
        setTxt('.jc-status', (node.querySelector('.jc-status')?.textContent || '')
          .replace(/\d+%$/, pct + '%'));
        const bar = node.querySelector('.jc-bar > div');
        if (bar && pct != null) bar.style.width = pct + '%';
        const tick = node.querySelector('.jc-ticker');
        const last = cleanLog((j.log_tail || '').split('\n').pop()).slice(0, 160);
        if (tick && last && tick.dataset.t !== last) {
          tick.dataset.t = last;
          tick.lastChild.textContent = last;                 // el dot span queda intacto
        }
        setTxt('.jc-run-stage', humanStage(j) || 'procesando\u2026');
        setTxt('.jc-run-detail', j.detail || '');
        setTxt('[data-live-field="iteration"] b', j.current_iteration != null && j.target_iterations
          ? `${Number(j.current_iteration).toLocaleString()} / ${Number(j.target_iterations).toLocaleString()}` : null);
        setTxt('[data-live-field="phase-count"] b', j.phase_completed != null && j.phase_total
          ? `${Number(j.phase_completed).toLocaleString()} / ${Number(j.phase_total).toLocaleString()}` : null);
        setTxt('[data-live-field="rate"] b', j.iterations_per_second
          ? `${Number(j.iterations_per_second).toFixed(1)} iter/s` : null);
        setTxt('[data-live-field="phase-rate"] b', j.phase_items_per_minute
          ? phaseRateText(j) : null);
        setTxt('[data-live-field="registered-cameras"] b', j.cameras_registered != null
          ? `${Number(j.cameras_registered).toLocaleString()} / ${Number(j.cameras_total).toLocaleString()}` : null);
        setTxt('[data-live-field="active-sources"] b', j.active_sources != null
          ? `${Number(j.active_sources).toLocaleString()} / ${Number(j.total_sources).toLocaleString()}` : null);
        setTxt('[data-live-field="good-tracks"] b', j.good_tracks != null
          ? Number(j.good_tracks).toLocaleString() : null);
        setTxt('[data-live-field="eta"] b', j.eta_remaining_s != null
          ? fmtDur(j.eta_remaining_s) : null);
        const meta = node.querySelectorAll('.jc-meta span')[1];
        if (meta) meta.textContent = jobTimingLabel(j);
        // dashboard de fases: solo anchos y tiempos (misma estructura)
        node.querySelectorAll('.jc-ph-row').forEach((row, i) => {
          const tmp = document.createElement('div');
          tmp.innerHTML = phaseDash(j, pct);
          const fresh = tmp.querySelectorAll('.jc-ph-row')[i];
          if (!fresh) return;
          if (row.className !== fresh.className) { row.replaceWith(fresh); return; }
          const b1 = row.querySelector('.jc-ph-bar > div'), b2 = fresh.querySelector('.jc-ph-bar > div');
          if (b1 && b2) b1.style.width = b2.style.width;
          const t1 = row.querySelector('.jc-ph-time'), t2 = fresh.querySelector('.jc-ph-time');
          if (t1 && t2 && t1.textContent !== t2.textContent) t1.textContent = t2.textContent;
        });
      };
      const ids = list.map(j => j.id).join(',');
      if (el.dataset.ids !== ids) {
        el.dataset.ids = ids;
        el.innerHTML = list.map(j => jobCard(j, flightsIdx)).join('');
        list.forEach(j => { el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`)?.setAttribute('data-h', hash(j)); });
      } else {
        list.forEach(j => {
          const node = el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`);
          if (!node) return;
          if (node.dataset.h === hash(j)) {
            if (['running', 'queued'].includes(j.status)) patchLive(node, j);
            return;
          }
          const tmp = document.createElement('div');
          tmp.innerHTML = jobCard(j, flightsIdx, false);
          const next = tmp.firstElementChild;
          next.dataset.h = hash(j);
          node.replaceWith(next);
        });
      }
      el.dispatchEvent(new CustomEvent('jobs:paint', { detail: { jobs, counts } }));
    } catch {} finally { busy = false; }
  };
  paint();
  if (!el._pollBound) {                                   // listener idempotente (no lo dupliques por llamada) (#47)
    el._pollBound = true;
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-cancel]');
      if (c) api('/api/job_cancel', { id: c.dataset.cancel }).catch(() => {});   // no unhandled rejection (#68)
      const logs = e.target.closest('[data-job-log]');
      if (logs) openJobLog(logs.dataset.jobLog).catch(err => alert(`No se pudo abrir el log: ${err.message}`));
    });
  }
  clearInterval(el._pollTimer);                           // no acumules intervalos si se re-llama (#47)
  el._pollTimer = setInterval(paint, every);
  return el._pollTimer;
}

document.addEventListener('click', async e => {
  const drawer = e.target.closest('#job-log-drawer');
  if (e.target.closest('[data-log-close]')) return closeJobLog();
  if (!drawer || !jobLogState) return;
  if (e.target.closest('[data-log-wrap]')) drawer.classList.toggle('wrap');
  if (e.target.closest('[data-log-pause]')) {
    jobLogState.paused = !jobLogState.paused;
    e.target.closest('[data-log-pause]').textContent = jobLogState.paused ? 'Continuar' : 'Pausar';
  }
  if (e.target.closest('[data-log-autoscroll]')) {
    jobLogState.autoscroll = !jobLogState.autoscroll;
    e.target.closest('[data-log-autoscroll]').classList.toggle('on', jobLogState.autoscroll);
  }
  if (e.target.closest('[data-log-more]')) { jobLogState.eof = false; await fetchJobLogChunk(); }
  if (e.target.closest('[data-log-copy]')) await navigator.clipboard.writeText(jobLogState.lines.join('\n'));
  if (e.target.closest('[data-log-download]')) {
    while (!jobLogState.eof) await fetchJobLogChunk();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([jobLogState.lines.join('\n')], { type: 'text/plain' }));
    a.download = `${jobLogState.id}.log`; a.click(); URL.revokeObjectURL(a.href);
  }
});
document.addEventListener('input', e => { if (e.target.matches('[data-log-search], [data-log-level]')) renderJobLog(); });

// tema: aplicar ANTES de pintar para evitar flash
document.documentElement.dataset.theme = localStorage.getItem('ab_theme') || 'dark';
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('ab_theme', t);
  document.querySelectorAll('.theme-lb').forEach(e => { e.textContent = t === 'light' ? 'Oscuro' : 'Claro'; });
}

document.addEventListener('click', async e => {
  if (e.target.closest('[data-theme-toggle]')) toggleTheme();
  if (e.target.closest('#auth-link')) {
    e.preventDefault();
    if ((await fetch('/api/whoami')).ok) { await fetch('/api/logout', { method: 'POST' }); alert('Sesión cerrada.'); }
    else await loginModal();
  }
});
function renderShell(active) {
  const cur = location.pathname.split('/').pop() || 'index.html';
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="index.html">
          <span class="mark">${icon('drone')}</span>
          <span><b>AeroBrain</b><span>Flight Intelligence</span></span>
        </a>
        ${NAV.map(n => `
          <a class="nav-item ${n.href === (active || cur) ? 'active' : ''}" href="${n.href}">
            ${icon(n.ic)}<span>${n.label}</span>
          </a>`).join('')}
        <button class="nav-item" data-theme-toggle>${icon('sun')}<span class="theme-lb">${document.documentElement.dataset.theme === 'light' ? 'Oscuro' : 'Claro'}</span></button>
        <div class="foot">
          <span class="foot-status"><span class="dot"></span>Mac Mini M4 · vault local</span>
          <div class="foot-btns">
            <a class="fbtn" href="guia.html">${icon('list')} Guía</a>
            <a class="fbtn" href="#" id="auth-link">${icon('iso')} Sesión</a>
          </div>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`);
  // rail móvil (≤820px, scroll-x): centra el tab ACTIVO al cargar — sin esto, en las tabs del
  // final (3D/Splat Lab/Sistema) la barra arranca mostrando Inicio y no ves dónde estás
  const bar = document.querySelector('.sidebar');
  const act = bar?.querySelector('.nav-item.active');
  if (bar && act && bar.scrollWidth > bar.clientWidth + 1) {
    bar.scrollLeft = act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2;
  }
  return document.getElementById('main');
}

const fmt = {
  // Math.floor en los segundos también (no Math.round) → nunca "0:60"/"1:60"; guard de NaN
  dur: s => {
    s = Math.max(0, Math.round(+s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  km: m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
  gb: b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`,
  date: d => {
    if (!d || typeof d !== 'string') return '';        // fmt.date(undefined) ya no tumba la página
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const [y, m, day] = d.split('-');
    return `${+day} ${M[+m - 1]} ${y}`;
  },
  hours: s => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`,
};

let _flights = null;
async function getFlights() {
  if (!_flights) {
    try {
      const r = await fetch(`${DATA}/manifest/flights.json`);
      _flights = (await r.json()).flights || [];        // manifest vacío/malo → [] (no undefined)
    } catch { return []; }                               // no cachea el fallo: reintentará
  }
  return _flights;
}
// AI viene embebido en flights.json (0 requests extra — clave en móvil)
async function getAI(cid) {
  // la página de detalle lee el JSON completo (director_notes, edit_suggestions…);
  // el embebido de flights.json es solo el resumen para las listas
  try {
    const r = await fetch(`${DATA}/ai/${encodeURIComponent(cid)}.json`);
    if (r.ok) return await r.json();
  } catch {}
  const fl = await getFlights();
  return fl.find(f => f.clip_id === cid)?.ai || null;
}
async function getAIAll(flights) {
  const out = {};
  flights.forEach(f => { out[f.clip_id] = f.ai || null; });
  return out;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// maxzoom 19 en el source: más allá, MapLibre sobre-escala la tile en vez de
// mostrar "Map data not available" (vuelos cortos fuerzan zoom 20+)
// satelite: maxzoom 17 — mas alla MapLibre ESCALA el tile (suave) en vez de
// pedir niveles que Esri no tiene en zonas rurales (tiles "not available");
// la ortofoto del dron va encima con su propia nitidez de todos modos
// paneles colapsables: click en el titulo (no en sus botones) pliega el cuerpo
document.addEventListener('click', e => {
  const ph = e.target.closest('.panel > .ph');
  if (!ph || e.target.closest('button, a, input, select, label, .seg, .chip')) return;
  const panel = ph.parentElement;
  const collapsed = panel.classList.contains('clpsd');
  const from = panel.offsetHeight;
  panel.classList.toggle('clpsd');
  const to = panel.offsetHeight;
  panel.style.overflow = 'hidden';
  panel.animate([{ height: from + 'px' }, { height: to + 'px' }],
                { duration: 230, easing: 'cubic-bezier(.25,.1,.25,1)' })
       .finished.then(() => { panel.style.overflow = ''; });
});

const SAT_STYLE = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Esri World Imagery' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const FIT_OPTS = { padding: 50, maxZoom: 17.5 };
const DARK_STYLE = {
  version: 8,
  sources: { c: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: 'CARTO · OSM' } },
  layers: [{ id: 'c', type: 'raster', source: 'c' }],
};
