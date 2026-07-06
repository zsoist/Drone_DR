// Sistema — dashboard completo: inventario, actividad de procesamiento,
// base de datos de contenido con filtros, storage, servicios y costos.
const main = renderShell('system.html');
main.innerHTML = `
  <div class="page-head"><h1>Sistema</h1><span class="count">inventario · actividad · contenido · costos</span></div>
  <div class="statgrid" id="top">${'<div class="sk" style="height:74px"></div>'.repeat(8)}</div>

  <div class="fl-layout">
    <div>
      <div class="panel rise">
        <div class="ph">${icon('activity')} Actividad de procesamiento</div>
        <div class="pb" id="activity"><div class="sk" style="height:120px"></div></div>
      </div>
      <div class="panel rise" style="margin-top:16px">
        <div class="ph">${icon('clock')} Trabajos recientes</div>
        <div class="pb" id="feed"></div>
      </div>
    </div>
    <div>
      <div class="panel rise">
        <div class="ph">${icon('db')} Storage del vault</div>
        <div class="pb" id="storage"><div class="sk" style="height:120px"></div></div>
      </div>
      <div class="panel rise" style="margin-top:16px">
        <div class="ph">${icon('wifi')} Servicios</div>
        <div class="pb"><table class="kv">
          <tr><td>Web server</td><td>com.aerobrain.web · :8790</td></tr>
          <tr><td>Worker 3D</td><td>com.aerobrain.worker · cola SQLite</td></tr>
          <tr><td>Túnel Cloudflare</td><td>com.metislab.tunnel</td></tr>
          <tr><td>Dominio</td><td>vuelos.metislab.work</td></tr>
          <tr><td>Compute</td><td>Mac Mini M4 · VideoToolbox</td></tr>
        </table></div>
      </div>
      <div class="panel rise" style="margin-top:16px">
        <div class="ph">${icon('check')} Modelo de costos</div>
        <div class="pb"><table class="kv">
          <tr><td>Hosting + streaming</td><td>$0 (túnel + SSD)</td></tr>
          <tr><td>Storage</td><td>$0 (vault local)</td></tr>
          <tr><td>Fotogrametría + splats</td><td>$0 (ODM + OpenSplat locales)</td></tr>
          <tr><td>AI vision (Gemini)</td><td>~$0.002 / clip</td></tr>
          <tr><td>Síntesis (DeepSeek)</td><td>centavos / mes</td></tr>
          <tr><td><b>Total mensual</b></td><td><b style="color:var(--mint)">≈ $0</b></td></tr>
        </table></div>
      </div>
    </div>
  </div>

  <div class="panel rise" style="margin-top:16px">
    <div class="ph">${icon('grid')} Base de datos de contenido
      <span class="count" id="db-count"></span>
      <span class="spacer" style="flex:1"></span>
      <input class="ctl" id="db-q" placeholder="Buscar…" style="width:170px;font-size:12px">
    </div>
    <div class="pb" style="padding-bottom:8px">
      <div class="tool-row" style="padding-top:0"><span class="tool-lb">Tier</span>
        <button class="chip on" data-tier="">Todos</button>
        <button class="chip" data-tier="full">Full</button>
        <button class="chip" data-tier="standard">Standard</button>
        <button class="chip" data-tier="skim">Skim</button>
        <span style="flex:1"></span>
        <button class="chip" data-has="model">Con 3D</button>
        <button class="chip" data-has="ai">Con AI</button>
        <button class="chip" data-has="gps">Con GPS</button>
      </div>
    </div>
    <div style="overflow-x:auto"><table class="dtable" id="db-table"></table></div>
  </div>`;

(async () => {
  let sys = {}, jobs = [];
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  try { jobs = (await (await fetch('/api/jobs')).json()).jobs || []; } catch {}
  let flights = [];
  try { flights = await getFlights(); } catch {}   // fallo de flights.json NO debe congelar el tab entero
  const st = sys.storage || {};
  const models = new Set((sys.models || []).map(m => m.clip_id));

  // ---------- stats con count-up ----------
  const doneJobs = jobs.filter(j => j.status === 'done');
  const cpuMin = Math.round(doneJobs.reduce((a, j) => a + (j.mins || 0), 0));
  const stats = [
    ['drone', 'Clips', flights.length],
    ['db', 'Raw 4K', fmt.gb(st.raw || 0), true],
    ['cube', 'Modelos 3D', (sys.models || []).length],
    ['spark', 'Splats', (sys.splats || []).filter(s => /\.splat$/.test(s.name)).length],
    ['film', 'Fotos 4K', (sys.photos || []).length],
    ['play', 'Reels', (sys.reels || []).length],
    ['check', 'Jobs completados', doneJobs.length],
    ['clock', 'CPU de procesos', cpuMin >= 90 ? (cpuMin / 60).toFixed(1) + ' h' : cpuMin + ' min', true],
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
                  edit: 'Edición', upload: 'Subida', analyze: 'Análisis AI' };
  const durs = {};
  doneJobs.forEach(j => { if (j.mins) (durs[j.kind] ??= []).push(j.mins); });
  const durRows = Object.entries(durs).map(([k, v]) =>
    [KINDS[k] || k, v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]);
  const maxDur = Math.max(...durRows.map(r => r[1]), 1);
  const PILL = { done: ['listos', 'var(--mint)'], running: ['en proceso', 'var(--accent)'],
                 queued: ['en cola', 'var(--text-3)'], error: ['fallidos', 'var(--red)'],
                 cancelled: ['cancelados', 'var(--amber)'] };
  document.getElementById('activity').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${Object.entries(PILL).filter(([k]) => byStatus[k]).map(([k, [lb, c]]) =>
        `<span class="chip" style="color:${c};border-color:color-mix(in srgb, ${c} 40%, transparent)">
         ${byStatus[k]} ${lb}</span>`).join('') || '<span class="footer-note">Sin trabajos aún.</span>'}
    </div>
    <p class="mlb" style="margin-top:0">Duración media por tipo</p>
    ${durRows.map(([lb, avg, n]) => `
      <div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="color:var(--text-2)">${esc(lb)} <span style="color:var(--text-3)">×${n}</span></span>
          <span class="mono" style="color:var(--text-3)">${avg < 1 ? '<1 min' : avg >= 90 ? (avg / 60).toFixed(1) + ' h' : Math.round(avg) + ' min'}</span>
        </div>
        <div class="sbar"><div style="width:${(avg / maxDur * 100).toFixed(1)}%"></div></div>
      </div>`).join('') || '<p class="footer-note">Aún no hay trabajos completados.</p>'}`;

  // ---------- feed de trabajos recientes ----------
  const rel = ms => {
    const m = (Date.now() - ms) / 60000;
    return m < 60 ? `hace ${Math.max(1, Math.round(m))} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
  };
  document.getElementById('feed').innerHTML = jobs.slice(0, 9).map(j => {
    const ts = +((j.id || '').split('-').pop() || NaN);   // job sin id no rompe el feed (mismo blast radius que label)
    const stc = { done: 'var(--mint)', running: 'var(--accent)', queued: 'var(--text-3)',
                  error: 'var(--red)', cancelled: 'var(--amber)', cancel_failed: 'var(--red)' }[j.status] || 'var(--text-3)';
    return `<div class="act-row">
      <span class="act-dot" style="background:${stc}"></span>
      <span class="act-k">${esc(KINDS[j.kind] || j.kind)}</span>
      <span class="act-l mono">${esc((j.label || j.id || "job").length > 26 ? (j.label || "").slice(-16) : (j.label || j.id || "job"))}</span>
      <span class="spacer" style="flex:1"></span>
      ${j.mins ? `<span class="mono" style="color:var(--text-3);font-size:11px">${j.mins} min</span>` : ''}
      <span class="mono" style="color:var(--text-3);font-size:11px">${Number.isFinite(ts) ? rel(ts) : ''}</span>
    </div>`;
  }).join('') || '<p class="footer-note">Sin actividad todavía.</p>';

  // ---------- storage con barras animadas ----------
  const cats = [['raw', 'Originales 4K (intocables)'], ['proxies', 'Proxies 1080p'], ['frames', 'Keyframes AI'],
                ['thumbs', 'Thumbnails'], ['tracks', 'Tracks GPS'], ['reels', 'Reels'], ['splats', 'Splats']];
  const maxB = Math.max(...cats.map(([k]) => st[k] || 0), 1);
  document.getElementById('storage').innerHTML = cats.map(([k, lb], i) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--text-2)">${lb}</span>
        <span class="mono" style="color:var(--text-3)">${fmt.gb(st[k] || 0)}</span>
      </div>
      <div class="sbar"><div style="width:${((st[k] || 0) / maxB * 100).toFixed(1)}%;animation-delay:${i * 60}ms"></div></div>
    </div>`).join('') + `
    <p class="footer-note" style="margin:4px 0 0">Ingesta: ${sys.last_ingest ? `${sys.last_ingest.files} archivos · ${fmt.gb(sys.last_ingest.bytes)}` : '—'}
    · índice ${sys.generated_at || '—'}</p>`;

  // ---------- base de datos de contenido (filtros + tabla) ----------
  const state = { q: '', tier: '', has: new Set() };
  function renderTable() {
    const rows = flights.filter(f => {
      if (state.tier && f.tier !== state.tier) return false;
      if (state.has.has('model') && !models.has(f.clip_id)) return false;
      if (state.has.has('ai') && !f.ai) return false;
      if (state.has.has('gps') && !f.has_srt) return false;
      const hay = `${f.label || ''} ${f.clip_id} ${f.date || ''}`.toLowerCase();
      return !state.q || hay.includes(state.q);
    });
    document.getElementById('db-count').textContent = `(${rows.length} de ${flights.length})`;
    const chk = on => on ? '<span style="color:var(--mint)">✓</span>' : '<span style="color:var(--text-3)">·</span>';
    document.getElementById('db-table').innerHTML = `
      <thead><tr><th>Fecha</th><th>Nombre</th><th>Dur</th><th>Tamaño</th><th>Res</th>
      <th>Tier</th><th>GPS</th><th>AI</th><th>3D</th></tr></thead>
      <tbody>${rows.map(f => `
        <tr data-cid="${esc(f.clip_id)}">
          <td class="mono">${fmt.date(f.date)} ${f.time || ''}</td>
          <td>${esc(f.label) || '<span style="color:var(--text-3)">—</span>'}</td>
          <td class="mono">${fmt.dur(f.duration_s)}</td>
          <td class="mono">${fmt.gb(f.size_bytes || 0)}</td>
          <td class="mono">${esc((f.resolution || '').replace('3840x2160', '4K'))}</td>
          <td><span class="chip" style="padding:1px 9px;font-size:10.5px">${esc(f.tier || '—')}</span></td>
          <td>${chk(f.has_srt)}</td><td>${chk(!!f.ai)}</td><td>${chk(models.has(f.clip_id))}</td>
        </tr>`).join('')}</tbody>`;
  }
  renderTable();
  document.getElementById('db-q').addEventListener('input', e => { state.q = e.target.value.toLowerCase(); renderTable(); });
  main.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-tier]').forEach(x => x.classList.toggle('on', x === b));
    state.tier = b.dataset.tier;
    renderTable();
  }));
  main.querySelectorAll('[data-has]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    state.has.has(b.dataset.has) ? state.has.delete(b.dataset.has) : state.has.add(b.dataset.has);
    renderTable();
  }));
  document.getElementById('db-table').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-cid]');
    if (tr) location.href = `flight.html?id=${encodeURIComponent(tr.dataset.cid)}`;
  });
})();
