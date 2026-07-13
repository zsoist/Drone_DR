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
  const M = [
    [/frames: \d+/, 'Extrayendo frames del video'],
    [/geotag|exiftool/i, 'Geoetiquetando con tu GPS'],
    [/feature|opensfm.*extract/i, 'Detectando características'],
    [/match/i, 'Emparejando imágenes'],
    [/reconstruct|bundle/i, 'Reconstruyendo cámaras 3D'],
    [/Densify|depthmap|openmvs/i, 'Densificando nube de puntos'],
    [/filterpoints/i, 'Filtrando nube de puntos'],
    [/meshing|PoissonRecon|dem2mesh/i, 'Generando malla 3D'],
    [/texturing|mvstex|texture/i, 'Texturizando el modelo'],
    [/dem|dsm|dtm|tiles\.tif|merged\.vrt/i, 'Calculando elevación (DSM)'],
    [/orthophoto/i, 'Generando ortofoto'],
    [/publicando|publish|gdal_translate.*ortho/i, 'Publicando assets web'],
    [/entrenando|Step \d+/i, 'Entrenando el splat'],
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
function presetLabel(value) {
  return ({ rapido: 'Rápido', estandar: 'Estándar', alta: 'Alta', extra: 'Extra',
    ultra: 'Ultra', medium: 'Medium', cinematic: 'Cinemático', fast: 'Fast' })[value] || value || '—';
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
  const facts = [
    j.cameras_registered != null ? `${j.cameras_registered}/${j.cameras_total || j.cameras_registered} cámaras` : '',
    j.source_count ? `${j.source_count} video${j.source_count === 1 ? '' : 's'}` : '',
    j.photo_count ? `${j.photo_count} foto${j.photo_count === 1 ? '' : 's'}` : '',
    j.product_mode ? String(j.product_mode).replaceAll('_', ' ') : '',
    j.iterations ? `${j.iterations >= 1000 && j.iterations % 1000 === 0 ? `${j.iterations / 1000}k` : j.iterations} iteraciones` : '',
    j.backend || '',
    j.peak_mib ? `pico ${j.peak_mib} MiB${j.memory_cap_mib ? ` / ${j.memory_cap_mib}` : ''}` : '',
  ].filter(Boolean);
  const search = `${titleText} ${j.kind} ${j.status} ${j.detail || ''} ${quality.join(' ')}`.toLowerCase();
  return `
  <article class="job-card${entering ? '' : ' upd'}" data-jid="${esc(j.id)}" data-kind="${esc(j.kind)}" data-status="${esc(j.status)}" data-search="${esc(search)}">
    <div class="jc-head">${icon(meta.ic)}<span class="jc-title">${title}</span>
      <span class="jc-status ${esc(j.status)}${j.fallback ? ' fallback' : ''}">${esc(outcomeLabel)}${pct != null && j.status === 'running' ? ` ${pct}%` : ''}</span></div>
    ${quality.length ? `<div class="jc-quality">${quality.join('')}</div>` : ''}
    ${['running', 'queued'].includes(j.status) ? `
      ${j.kind === '3d' ? (() => {
        const steps = [['frames', 'Frames'], ['odm', 'Fotogrametr\u00eda'], ['publish', 'Publicar']];
        const at = steps.findIndex(s => s[0] === j.stage);
        return `<div class="jc-steps">${steps.map(([, lb], i) =>
          `<span class="jc-step${i < at ? ' done' : i === at ? ' act' : ''}">${i < at ? '\u2713 ' : ''}${lb}</span>`).join('')}</div>`;
      })() : ''}
      <div class="jc-stage">${esc(humanStage(j))}</div>
      ${pct != null ? `<div class="jc-bar" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>` : ''}` : ''}
    ${facts.length ? `<div class="jc-facts">${facts.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    <div class="jc-meta"><span>${esc(j.id)}</span><span>${jobDuration(j.elapsed_s)} transcurridos</span></div>
    ${lastLog ? `<button class="jc-log" data-job-log="${esc(j.id)}" title="Abrir log completo">${esc(lastLog)}</button>` : ''}
    ${j.status === 'queued' ? `<div class="jc-stage">Esperando turno — el worker procesa un trabajo pesado a la vez.</div>` : ''}
    ${j.detail ? `<div class="jc-result ${j.status === 'error' ? 'error' : ''}">${esc(j.detail)}</div>` : ''}
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
      const active = jobs.filter(j => ['running', 'queued'].includes(j.status));
      const history = jobs.filter(j => !['running', 'queued'].includes(j.status));
      const list = [...active, ...history];
      const hash = j => [j.status, j.progress, j.elapsed_s, j.detail, j.stage,
        j.requested_preset, j.effective_preset, j.outcome, (j.log_tail || '').slice(-80)].join('|');
      const ids = list.map(j => j.id).join(',');
      if (el.dataset.ids !== ids) {
        el.dataset.ids = ids;
        el.innerHTML = list.map(j => jobCard(j, flightsIdx)).join('');
        list.forEach(j => { el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`)?.setAttribute('data-h', hash(j)); });
      } else {
        list.forEach(j => {
          const node = el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`);
          if (!node || node.dataset.h === hash(j)) return;
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
