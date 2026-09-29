// Sistema — inventario, rendimiento en vivo, nodo GPU, actividad, storage y base de contenido.
const main = renderShell('system.html');
main.classList.add('sy-page');
// escribe innerHTML solo si cambió: los polls de 1–30 s no reconstruyen (ni re-animan) nada igual
const setHTML = (el, html) => { if (el && el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } };
const panelHead = (ic, title, sub = '', extra = '') => `
  <div class="ph sy-ph">${icon(ic)}<span class="sy-ph-t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${extra}</div>`;

main.innerHTML = `
  ${pageHead('Sistema', 'Inventario, rendimiento, procesamiento y costos del vault.')}
  <div class="sy-stats" id="top">${'<div class="sk" style="height:76px"></div>'.repeat(8)}</div>

  <div class="panel sy-panel">
    ${panelHead('gauge', 'Rendimiento del Mac Mini', 'En vivo · muestreo cada segundo · ventana de 2 min',
      '<span class="chip sm" id="pf-therm">Térmica</span>')}
    <div class="pb">
      <div class="perf-grid sy-perf">
        <div class="perf-cell"><div class="perf-lb">CPU <b id="pf-cpu">—</b></div><canvas id="pfc-cpu" height="72"></canvas><span class="perf-wait" hidden>Recopilando muestras…</span></div>
        <div class="perf-cell"><div class="perf-lb">GPU <b id="pf-gpu">—</b></div><canvas id="pfc-gpu" height="72"></canvas><span class="perf-wait" hidden>Recopilando muestras…</span></div>
        <div class="perf-cell"><div class="perf-lb">RAM <b id="pf-ram">—</b></div><canvas id="pfc-ram" height="72"></canvas><span class="perf-wait" hidden>Recopilando muestras…</span></div>
      </div>
      <div class="perf-chips" id="pf-chips"></div>
      <div id="pf-jobs"></div>
      <details class="perf-errs" id="pf-errwrap">
        <summary>${icon('warn')} Errores y reporte AI <span class="count" id="pf-errcount"></span></summary>
        <div class="pb sy-errs">
          <div class="sy-errs-a">
            <button class="btn sm" id="pf-genreport">${icon('spark')} Generar reporte AI</button>
            <span class="sy-hint">DeepSeek redacta el triage; Codex o Claude lo validan después.</span>
          </div>
          <div id="pf-reports"></div>
          <pre class="job-log-output" id="pf-report-body" hidden></pre>
          <div id="pf-errors"></div>
        </div>
      </details>
    </div>
  </div>

  <div class="panel sy-panel">
    ${panelHead('cpu', 'Nodo GPU', 'PC remoto · RTX 4060 Ti · SSH y Wake-on-LAN',
      '<span class="chip sm" id="gn-status">Consultando</span>')}
    <div class="pb">
      <div class="gn-grid" id="gn-body"><div class="sk" style="height:56px"></div></div>
      <div class="gn-actions">
        <button class="btn sm" id="gn-wake">Despertar</button>
        <button class="btn sm ghost" id="gn-sleep">Dormir</button>
        <span class="sy-hint" id="gn-note">El estado sale de un sondeo SSH real.</span>
      </div>
    </div>
  </div>

  <div class="sy-cols">
    <div class="panel">
      ${panelHead('activity', 'Actividad', 'Trabajos por estado y duración media')}
      <div class="pb" id="activity"><div class="sk" style="height:120px"></div></div>
    </div>
    <div class="panel">
      ${panelHead('clock', 'Trabajos recientes', 'Los últimos 9')}
      <div class="pb" id="feed"></div>
    </div>
    <div class="panel">
      ${panelHead('db', 'Storage del vault', 'Espacio por categoría')}
      <div class="pb" id="storage"><div class="sk" style="height:120px"></div></div>
    </div>
    <div class="panel">
      ${panelHead('wifi', 'Servicios', 'Procesos locales y dominio')}
      <div class="pb"><dl class="sy-kv">
        <div><dt>Web server</dt><dd class="mono">com.aerobrain.web · :8790</dd></div>
        <div><dt>Worker 3D</dt><dd class="mono">com.aerobrain.worker</dd></div>
        <div><dt>Túnel Cloudflare</dt><dd class="mono">com.metislab.tunnel</dd></div>
        <div><dt>Dominio</dt><dd class="mono">vuelos.metislab.work</dd></div>
        <div><dt>Compute</dt><dd>Mac Mini M4 · VideoToolbox</dd></div>
      </dl></div>
    </div>
    <div class="panel sy-wide">
      ${panelHead('check', 'Modelo de costos', 'Todo corre local salvo el análisis AI')}
      <div class="pb"><dl class="sy-kv sy-kv2">
        <div><dt>Hosting y streaming</dt><dd>$0 (túnel + SSD)</dd></div>
        <div><dt>Storage</dt><dd>$0 (vault local)</dd></div>
        <div><dt>Fotogrametría y splats</dt><dd>$0 (ODM + OpenSplat)</dd></div>
        <div><dt>AI vision (Gemini)</dt><dd>~$0.002 por clip</dd></div>
        <div><dt>Síntesis (DeepSeek)</dt><dd>centavos al mes</dd></div>
        <div class="total"><dt>Total mensual</dt><dd>≈ $0</dd></div>
      </dl></div>
    </div>
  </div>

  <div class="panel sy-panel" id="db-panel">
    ${panelHead('grid', 'Base de datos de contenido', '<span id="db-count">Clips indexados</span>',
      `<label class="search sy-q">${icon('search')}<input id="db-q" type="search" placeholder="Buscar clip" aria-label="Buscar clip" autocomplete="off"></label>`)}
    <div class="pb sy-filters">
      <div class="seg" id="db-tier" role="group" aria-label="Filtrar por tier">
        <button class="on" data-tier="">Todos</button>
        <button data-tier="full">Full</button>
        <button data-tier="standard">Standard</button>
        <button data-tier="skim">Skim</button>
      </div>
      <div class="sy-flags">
        <button class="chip" data-has="model" aria-pressed="false">Con 3D</button>
        <button class="chip" data-has="ai" aria-pressed="false">Con AI</button>
        <button class="chip" data-has="gps" aria-pressed="false">Con GPS</button>
      </div>
    </div>
    <div class="sy-tablewrap"><table class="dtable sy-table" id="db-table"></table></div>
    <div class="sy-more" id="db-more"></div>
  </div>`;

function jobRelativeTime(job, now) {
  if (job?.status === 'queued') return 'en cola';
  const terminal = ['done', 'error', 'cancelled', 'cancel_failed'].includes(job?.status);
  const seconds = Number(terminal ? (job?.finished || job?.started) : job?.started);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(0, (Number(now) - seconds * 1000) / 60000);
  return minutes < 60 ? `hace ${Math.max(1, Math.round(minutes))} min`
    : minutes < 1440 ? `hace ${Math.round(minutes / 60)} h`
      : `hace ${Math.round(minutes / 1440)} d`;
}

(async () => {
  let sys = {}, jobs = [];
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  try { jobs = (await (await authFetch('/api/jobs')).json()).jobs || []; } catch {}
  let flights = [];
  try { flights = await getFlights(); } catch {}   // fallo de flights.json NO debe congelar el tab entero
  const st = sys.storage || {};
  const models = new Set((sys.models || []).map(m => m.clip_id));

  // ---------- stats (etiquetas cortas, misma altura) ----------
  const doneJobs = jobs.filter(j => j.status === 'done');
  // duración real de un trabajo terminado (s): started/finished; el campo `mins` es opcional
  const durOf = j => {
    if (j.mins > 0) return j.mins * 60;
    const d = Number(j.finished) - Number(j.started);
    return Number.isFinite(d) && d > 0 ? d : 0;
  };
  const fmtSpan = s => s < 60 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
  const totalSec = doneJobs.reduce((a, j) => a + durOf(j), 0);
  const stats = [
    ['drone', 'Clips', flights.length],
    ['db', 'Raw 4K', fmt.gb(st.raw || 0), true],
    ['cube', 'Modelos 3D', (sys.models || []).length],
    ['spark', 'Splats', (sys.splats || []).filter(s => /\.(splat|ksplat|ply)$/i.test(s.name)).length],
    ['film', 'Fotos 4K', (sys.photos || []).length],
    ['play', 'Reels', (sys.reels || []).length],
    ['check', 'Completados', doneJobs.length],
    ['clock', 'Tiempo de proceso', totalSec ? fmtSpan(totalSec) : '—', true],
  ];
  document.getElementById('top').innerHTML = stats.map(([ic, lb, v, raw]) => `
    <div class="stat rise"><div class="lb">${icon(ic)} ${lb}</div>
    <div class="v" ${raw ? '' : `data-count="${v}"`}>${raw ? v : 0}</div></div>`).join('');
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = +el.dataset.count, t0 = performance.now();
    (function tick(t) {
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  });

  // ---------- actividad: status + duración media por tipo ----------
  const byStatus = {};
  jobs.forEach(j => { byStatus[j.status] = (byStatus[j.status] || 0) + 1; });
  const KINDS = { '3d': 'Fotogrametría 3D', splat: 'Gaussian splat', foto4k: 'Foto 4K',
                  edit: 'Edición', upload: 'Subida', analyze: 'Análisis AI', ingest: 'Importar SD' };
  const durs = {};
  doneJobs.forEach(j => { const d = durOf(j); if (d) (durs[j.kind] ??= []).push(d); });
  const durRows = Object.entries(durs).map(([k, v]) =>
    [KINDS[k] || k, v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]);
  const maxDur = Math.max(...durRows.map(r => r[1]), 1);
  const PILL = { done: ['listos', 'ok'], running: ['en proceso', 'on'],
                 queued: ['en cola', ''], error: ['fallidos', 'err'],
                 cancelled: ['cancelados', 'warn'] };
  const durHTML = durRows.length ? `
    <p class="sy-sublb">Duración media por tipo</p>
    ${durRows.map(([lb, avg, n]) => `
      <div class="sy-bar">
        <div class="sy-bar-h">
          <span>${esc(lb)} <small>×${n}</small></span>
          <span class="mono">${fmtSpan(avg)}</span>
        </div>
        <div class="sbar"><div style="--p:${(avg / maxDur).toFixed(3)}"></div></div>
      </div>`).join('')}` : '';
  document.getElementById('activity').innerHTML = `
    <div class="sy-pills">
      ${Object.entries(PILL).filter(([k]) => byStatus[k]).map(([k, [lb, c]]) =>
        `<span class="chip sm ${c}">${byStatus[k]} ${lb}</span>`).join('') || '<span class="sy-hint">Sin trabajos aún.</span>'}
    </div>
    ${durHTML}`;

  // ---------- feed de trabajos recientes ----------
  document.getElementById('feed').innerHTML = orderJobsForDisplay(jobs).slice(0, 9).map(j => {
    const lbl = String(j.label || j.id || 'job').replace(/^untitled\b/i, 'SD');
    return `<div class="act-row">
      <span class="act-dot ${esc(j.status)}"></span>
      <span class="act-k">${esc(KINDS[j.kind] || j.kind)}</span>
      <span class="act-l mono">${esc(lbl.length > 26 ? lbl.slice(-16) : lbl)}</span>
      <span class="spacer" style="flex:1"></span>
      ${durOf(j) ? `<span class="mono act-t">${fmtSpan(durOf(j))}</span>` : ''}
      <span class="mono act-t">${jobRelativeTime(j, Date.now())}</span>
    </div>`;
  }).join('') || '<p class="sy-hint">Sin actividad todavía.</p>';

  // ---------- storage con barras ----------
  const cats = [['raw', 'Originales 4K (intocables)'], ['proxies', 'Proxies 1080p'], ['frames', 'Keyframes AI'],
                ['thumbs', 'Miniaturas'], ['tracks', 'Tracks GPS'], ['reels', 'Reels'], ['splats', 'Splats']];
  const maxB = Math.max(...cats.map(([k]) => st[k] || 0), 1);
  document.getElementById('storage').innerHTML = cats.map(([k, lb], i) => `
    <div class="sy-bar">
      <div class="sy-bar-h"><span>${lb}</span><span class="mono">${fmt.gb(st[k] || 0)}</span></div>
      <div class="sbar"><div style="--p:${((st[k] || 0) / maxB).toFixed(3)};animation-delay:${i * 60}ms"></div></div>
    </div>`).join('') + `
    <p class="sy-hint sy-foot">Última ingesta: ${sys.last_ingest ? `${sys.last_ingest.files} archivos · ${fmt.gb(sys.last_ingest.bytes)}` : '—'}
    · índice ${esc(sys.generated_at || '—')}</p>`;

  // ---------- base de datos de contenido (filtros + tabla paginada) ----------
  const PAGE = 25;
  const state = { q: '', tier: '', has: new Set(), shown: PAGE };
  const ok = on => on ? `<span class="sy-yes" aria-label="sí">${icon('check')}</span>` : '<span class="sy-no" aria-label="no">·</span>';
  function renderTable() {
    const rows = flights.filter(f => {
      if (state.tier && f.tier !== state.tier) return false;
      if (state.has.has('model') && !models.has(f.clip_id)) return false;
      if (state.has.has('ai') && !f.ai) return false;
      if (state.has.has('gps') && !f.has_srt) return false;
      const hay = `${f.label || ''} ${f.clip_id} ${f.date || ''}`.toLowerCase();
      return !state.q || hay.includes(state.q);
    });
    const visible = rows.slice(0, state.shown);
    document.getElementById('db-count').textContent = `${rows.length} de ${flights.length} clips`;
    const showName = rows.some(f => f.label);            // la columna Nombre solo existe si algún clip tiene nombre
    const resOf = f => esc((f.resolution || '').replace('3840x2160', '4K'));
    document.getElementById('db-table').innerHTML = `
      <thead><tr><th>Fecha</th>${showName ? '<th>Nombre</th>' : ''}<th class="n">Duración</th><th class="n">Tamaño</th><th class="c-res">Res.</th>
      <th>Tier</th><th class="c">GPS</th><th class="c">AI</th><th class="c">3D</th></tr></thead>
      <tbody>${visible.map(f => `
        <tr data-cid="${esc(f.clip_id)}" tabindex="0">
          <td class="mono c-date">${fmt.date(f.date)} <span>${esc(f.time || '')}</span></td>
          ${showName ? `<td class="c-name">${esc(f.label) || ''}</td>` : ''}
          <td class="mono n c-dur">${fmt.dur(f.duration_s)}</td>
          <td class="mono n c-size">${fmt.gb(f.size_bytes || 0)}</td>
          <td class="mono c-res">${resOf(f)}</td>
          <td class="c-tier"><span class="chip sm">${esc(f.tier || '—')}</span></td>
          <td class="c c-flag${f.has_srt ? ' on' : ''}" data-l="GPS">${ok(f.has_srt)}</td>
          <td class="c c-flag${f.ai ? ' on' : ''}" data-l="AI">${ok(!!f.ai)}</td>
          <td class="c c-flag${models.has(f.clip_id) ? ' on' : ''}" data-l="3D">${ok(models.has(f.clip_id))}</td>
        </tr>`).join('') || `<tr class="empty-row"><td colspan="9">Ningún clip coincide con estos filtros.</td></tr>`}</tbody>`;
    document.getElementById('db-more').innerHTML = rows.length > visible.length
      ? `<button class="btn sm" id="db-showmore">Mostrar ${Math.min(PAGE, rows.length - visible.length)} más</button>
         <span class="sy-hint">${visible.length} de ${rows.length}</span>` : '';
  }
  renderTable();
  const reset = () => { state.shown = PAGE; renderTable(); };
  document.getElementById('db-q').addEventListener('input', e => { state.q = e.target.value.toLowerCase(); reset(); });
  main.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-tier]').forEach(x => x.classList.toggle('on', x === b));
    state.tier = b.dataset.tier;
    reset();
  }));
  main.querySelectorAll('[data-has]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on'));
    state.has.has(b.dataset.has) ? state.has.delete(b.dataset.has) : state.has.add(b.dataset.has);
    reset();
  }));
  document.getElementById('db-more').addEventListener('click', e => {
    if (e.target.closest('#db-showmore')) { state.shown += PAGE; renderTable(); }
  });
  const openRow = tr => { if (tr) location.href = `flight.html?id=${encodeURIComponent(tr.dataset.cid)}`; };
  const tbl = document.getElementById('db-table');
  tbl.addEventListener('click', e => openRow(e.target.closest('tr[data-cid]')));
  tbl.addEventListener('keydown', e => { if (e.key === 'Enter') openRow(e.target.closest('tr[data-cid]')); });
})();

// ═══════════ Rendimiento en vivo — poll 1Hz, render 60fps (interpolación temporal) ═══════════
(() => {
  const $ = id => document.getElementById(id);
  const charts = {
    cpu: { cv: $('pfc-cpu'), tok: '--accent', max: 100, get: s => s.cpu },
    gpu: { cv: $('pfc-gpu'), tok: '--ok', max: 100, get: s => s.gpu },
    ram: { cv: $('pfc-ram'), tok: '--warn', max: 16, get: s => s.ram_used_gb },
  };
  const MIN_PTS = 10;                                  // muestras mínimas dentro de la ventana para dibujar
  for (const c of Object.values(charts)) c.wait = c.cv?.parentElement.querySelector('.perf-wait');
  let hist = [], now = null, dead = false;
  // colores desde tokens (cambian con el tema): se releen solo cuando cambia data-theme
  let palette = {};
  const readPalette = () => {
    const cs = getComputedStyle(document.documentElement);
    palette = { grid: cs.getPropertyValue('--line-strong').trim() || '#2E3846' };
    for (const c of Object.values(charts)) palette[c.tok] = cs.getPropertyValue(c.tok).trim() || '#45A0E6';
  };
  readPalette();
  new MutationObserver(readPalette).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  async function poll() {
    if (document.hidden) return;
    try {
      const r = await authFetch('/api/perf');
      if (!r.ok) return;
      const d = await r.json();
      // el historial arranca con muestras sintéticas a 0 en el primer arranque: se descartan
      hist = (d.history || []).filter(s => !(s.cpu === 0 && s.gpu === 0 && !s.ram_used_gb));
      now = d.now;
      charts.ram.max = (now?.ram_total_gb) || 16;
      paintStatics(d);
    } catch { /* red caída: el último frame queda en pantalla */ }
  }

  function paintStatics(d) {
    if (!now) return;
    $('pf-cpu').textContent = now.cpu.toFixed(0) + '%';
    $('pf-gpu').textContent = now.gpu.toFixed(0) + '%';
    $('pf-ram').textContent = `${now.ram_used_gb.toFixed(1)} / ${now.ram_total_gb} GB`;
    const th = now.thermal || {};
    const t = $('pf-therm');
    t.textContent = th.throttling ? `Limitado por temperatura · ${th.speed_limit}%` : 'Térmica nominal';
    t.classList.toggle('warn', !!th.throttling);
    t.classList.toggle('ok', !th.throttling);
    setHTML($('pf-chips'), [
      `Carga ${now.load1.toFixed(2)}`,
      `Swap ${(now.swap_used_mb / 1024).toFixed(1)} GB`,
      `Disco libre ${now.disk_free_gb ?? '—'} GB`,
      `${d.ncpu} núcleos`,
    ].map(x => `<span class="chip sm">${x}</span>`).join(''));
    // uso por job: cpu/rss/etapa/eta en vivo
    setHTML($('pf-jobs'), (now.jobs || []).length ? `<div class="sy-scrollx"><table class="kv perf-jobs">
      <tr><th>Job</th><th>Etapa</th><th>CPU</th><th>RAM</th><th>Lleva</th><th>Progreso</th></tr>
      ${now.jobs.map(j => `<tr>
        <td class="mono">${esc(j.kind)} · ${esc((j.label || '').slice(-14))}</td>
        <td>${esc(j.stage || '—')} <span class="count">${esc(j.detail || '')}</span></td>
        <td class="mono">${j.cpu_pct}%</td><td class="mono">${(j.rss_mb / 1024).toFixed(1)}G</td>
        <td class="mono">${j.elapsed_s >= 3600 ? (j.elapsed_s / 3600).toFixed(1) + 'h' : Math.round(j.elapsed_s / 60) + 'm'}</td>
        <td><div class="pf-bar"><i style="--p:${(j.progress || 0).toFixed(3)}"></i></div></td>
      </tr>`).join('')}</table></div>` : '');
  }

  function draw() {
    if (dead) return;
    requestAnimationFrame(draw);
    if (document.hidden) return;
    const tNow = Date.now() / 1000;
    for (const c of Object.values(charts)) {
      const cv = c.cv; if (!cv) { dead = true; return; }
      const dpr = devicePixelRatio || 1;
      const W = cv.width = Math.round(cv.clientWidth * dpr) || 600;
      const H = cv.height = Math.round(72 * dpr);
      const g = cv.getContext('2d');
      g.clearRect(0, 0, W, H);
      // escala fija 0–max con línea tenue al 50%
      g.strokeStyle = palette.grid; g.globalAlpha = .45; g.lineWidth = 1; g.setLineDash([3 * dpr, 4 * dpr]);
      g.beginPath(); g.moveTo(0, Math.round(H / 2) + .5); g.lineTo(W, Math.round(H / 2) + .5); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      const SPAN = 120;                                  // ventana de 2 min
      const x = ts => W - ((tNow - ts) / SPAN) * W;      // el tiempo REAL fija x → scroll suave a 60fps
      const pts = [];
      for (const s of hist) {
        const px = x(s.ts);
        if (px < -4) continue;
        pts.push([px, H - Math.min(1, Math.max(0, c.get(s) / c.max)) * (H - 6 * dpr) - 3 * dpr]);
      }
      const wait = pts.length < MIN_PTS;                 // pocas muestras: estado «Recopilando…» en vez de línea plana + pico
      if (c.wait) c.wait.hidden = !wait;
      cv.style.visibility = wait ? 'hidden' : '';
      if (wait) continue;
      const col = palette[c.tok];
      g.beginPath();
      pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
      g.strokeStyle = col; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.stroke();
      // relleno solo bajo el tramo real de la línea (sin rampa desde el borde)
      g.lineTo(pts[pts.length - 1][0], H); g.lineTo(pts[0][0], H); g.closePath();
      g.globalAlpha = 0.12; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
    }
  }

  async function loadErrors() {
    try {
      const r = await authFetch('/api/error_reports');
      if (!r.ok) return;
      const d = await r.json();
      $('pf-errcount').textContent = d.recent_errors?.length ? `${d.recent_errors.length} recientes` : 'sin errores recientes';
      $('pf-reports').innerHTML = (d.reports || []).slice(0, 5).map(rep => `
        <button class="pf-report" type="button" data-report="${esc(rep.name)}">
          ${icon('list')} ${esc(rep.name)} <span class="count">${esc(rep.ts)}</span></button>`).join('')
        || '<p class="sy-hint">Aún no hay reportes. Genera el primero.</p>';
      $('pf-errors').innerHTML = (d.recent_errors || []).map(e2 => `
        <div class="pf-err mono"><span class="count">${esc((e2.ts || '').slice(5, 16))}</span>
        <b>[${esc(e2.source || '?')}]</b> ${esc((e2.msg || '').slice(0, 110))}</div>`).join('');
    } catch { /* silencioso */ }
  }

  async function loadReport(name) {
    const body = $('pf-report-body');
    if (!body) return;
    body.hidden = false;
    body.textContent = 'Cargando reporte…';
    try {
      const r = await authFetch(`/api/error_report_content?name=${encodeURIComponent(name)}`);
      const d = await r.json();
      body.textContent = r.ok ? d.content : (d.error || 'No se pudo abrir el reporte');
    } catch (err) {
      body.textContent = `No se pudo abrir el reporte: ${err.message}`;
    }
  }

  $('pf-reports')?.addEventListener('click', ev => {
    const button = ev.target.closest('[data-report]');
    if (button) loadReport(button.dataset.report);
  });

  $('pf-genreport')?.addEventListener('click', async e => {
    e.target.closest('button').disabled = true;
    try {
      const r = await api('/api/error_report', {});
      if (r.error) alert(r.error);
      else setTimeout(loadErrors, 8000);           // el reporte tarda unos s (DeepSeek)
    } finally {
      setTimeout(() => { const b = $('pf-genreport'); if (b) b.disabled = false; }, 9000);
    }
  });
  $('pf-errwrap')?.addEventListener('toggle', ev => { if (ev.target.open) loadErrors(); });

  poll();
  const pollId = setInterval(poll, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });  // al volver al tab: dato fresco YA
  window.__abReloadOnRestore = true;  // shell.js recarga si Safari restaura desde bfcache
  addEventListener('pagehide', () => { clearInterval(pollId); dead = true; }, { once: true });
  draw();
})();

// ═══════════ Nodo GPU (PC remoto) — poll 30s, acciones reales ═══════════
(() => {
  const $g = id => document.getElementById(id);
  const ago = ts => {
    const m = Math.max(0, Math.round((Date.now() / 1000 - Number(ts)) / 60));
    return !Number.isFinite(m) ? '' : m < 1 ? 'hace menos de 1 min' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
  };
  const paint = d => {
    const st = $g('gn-status');
    if (!st) return;
    const awake = d.status === 'awake', asleep = d.status === 'asleep';
    st.textContent = awake ? 'Despierto' : asleep ? 'Dormido' : 'Sin datos';
    st.className = `chip sm ${awake ? 'ok' : ''}`;
    $g('gn-sleep').disabled = !awake;
    $g('gn-wake').disabled = awake;
    if (!awake) {
      setHTML($g('gn-body'), `
        <div class="gn-off">
          <span class="gn-off-ic">${icon('cpu')}</span>
          <div><b>${asleep ? 'PC apagado' : 'Sin respuesta del nodo'}</b>
          <p>${asleep ? 'Se despierta solo al encolar un trabajo pesado (splat o 3D). También puedes despertarlo ahora; tarda unos 30 s.'
            : 'El sondeo SSH no obtuvo datos. Revisa que el PC esté en la red y vuelve a intentarlo.'}${d.ts ? ` <span class="gn-when">Último sondeo ${ago(d.ts)}.</span>` : ''}</p></div>
        </div>`);
      return;
    }
    const vramPct = d.vram_total_mb ? d.vram_used_mb / d.vram_total_mb : 0;
    setHTML($g('gn-body'), [
      ['GPU', d.gpu || '—', ''],
      ['VRAM', d.vram_total_mb ? `${(d.vram_used_mb / 1024).toFixed(1)} / ${(d.vram_total_mb / 1024).toFixed(0)} GB` : '—', `<i class="gn-bar"><b style="--p:${vramPct.toFixed(3)}"></b></i>`],
      ['Uso GPU', d.util_pct != null ? `${d.util_pct}%` : '—', `<i class="gn-bar"><b style="--p:${((d.util_pct || 0) / 100).toFixed(3)}"></b></i>`],
      ['Temperatura', d.temp_c != null ? `${d.temp_c} °C` : '—', ''],
      ['Potencia', d.power_w != null ? `${d.power_w} W` : '—', ''],
      ['Driver', d.driver || '—', ''],
    ].map(([lb, v, extra]) => `<div class="gn-cell"><span>${lb}</span><b>${esc(v)}</b>${extra}</div>`).join(''));
  };
  const poll = async (force = false) => {
    try { paint(await (await authFetch('/api/gpu_node' + (force ? '?force=1' : ''))).json()); }
    catch { const st = $g('gn-status'); if (st) { st.textContent = 'Error de sondeo'; st.className = 'chip sm err'; } }
  };
  $g('gn-wake')?.addEventListener('click', async () => {
    $g('gn-note').textContent = 'Señal enviada. Despertando, tarda unos 30 s…';
    await authFetch('/api/gpu_node/wake', { method: 'POST' });
    setTimeout(() => poll(true), 25000);
  });
  $g('gn-sleep')?.addEventListener('click', async () => {
    const r = await (await authFetch('/api/gpu_node/sleep', { method: 'POST' })).json();
    $g('gn-note').textContent = r.ok ? 'Suspendido. Despertar lo revive.' : `No se durmió: ${r.reason}`;
    setTimeout(() => poll(true), 4000);
  });
  poll();
  setInterval(poll, 30000);
})();
