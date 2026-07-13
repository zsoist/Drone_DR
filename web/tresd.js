  import * as THREE from '/vendor/three180.module.js?v=146';
  import { OrbitControls } from '/vendor/three-addons180/controls/OrbitControls.js?v=146';
  import { OBJLoader } from '/vendor/three-addons180/loaders/OBJLoader.js?v=146';
  import { MTLLoader } from '/vendor/three-addons180/loaders/MTLLoader.js?v=146';
  import { PLYLoader } from '/vendor/three-addons180/loaders/PLYLoader.js?v=146';
  import { mountSplatViewer } from '/splatview.js?v=146';

  const SPLAT_EXT = /\.(sog|spz|ksplat|splat|ply)$/i;
  const SPLAT_RANK = { sog: 0, spz: 1, ksplat: 2, splat: 3, ply: 4 };
  const splatKey = s => s.path || s.name;
  const splatUrl = s => 'data/splats/' + splatKey(s).split('/').map(encodeURIComponent).join('/');

  // ═══ ESCÁNER DE CAPTURA (tarjeta premium compartida por los modales 3D y splat) ═══
  // Analiza el video ANTES de quemar horas: aptitud por producto (barras), riesgo de
  // memoria del gaussian (predicción por footprint + historial OOM real) y consejos.
  const _scanCache = {};
  async function renderScanCard(box, cid) {
    if (!box) return;
    box._scanCid = cid;   // currency: dos clicks rápidos → el fetch viejo NO pinta bajo la selección nueva
    box.innerHTML = '<div class="scan-card"><div class="sk" style="height:96px;border-radius:12px"></div></div>';
    let rep = _scanCache[cid];
    try {
      if (!rep) {
        rep = await (await fetch(`/api/capture_report?clip_id=${encodeURIComponent(cid)}`)).json();
        if (!rep.error) _scanCache[cid] = rep;
      }
    } catch { rep = { error: 'red' }; }
    if (box._scanCid !== cid) return;             // la selección cambió mientras descargaba
    if (rep.error) { box.innerHTML = ''; return; }
    const su = rep.suitability || {};
    const mem = rep.memory_risk || {};
    const cls = v => v >= 7 ? 'ok' : v >= 4 ? 'mid' : 'bad';
    const num = v => Number.isFinite(+v) ? +v : 0;   // el reporte viene del server, pero un meta corrupto no debe inyectar HTML
    const bar = (lb, v) => `
      <div class="scan-row"><span class="scan-lb">${lb}</span>
        <div class="scan-bar"><i class="${cls(v)}" style="width:${v * 10}%"></i></div>
        <b class="scan-v ${cls(v)}">${v}</b></div>`;
    const memCls = { bajo: 'ok', medio: 'mid', alto: 'bad' }[mem.level] || 'ok';
    const verdictV = Math.max(su.ortho_dsm || 0, su.mesh || 0, su.splat || 0);
    const verdict = verdictV >= 7 ? 'Captura sólida' : verdictV >= 4 ? 'Captura útil' : 'Captura débil';
    box.innerHTML = `
      <div class="scan-card">
        <div class="scan-hd">${icon('activity')} ESCÁNER DE CAPTURA
          <span class="scan-verdict ${cls(verdictV)}">${verdict}</span>
          <span class="count mono">${num(rep.recommended_frames) || '—'} frames</span></div>
        ${bar('Ortofoto/DSM', num(su.ortho_dsm))}${bar('Malla 3D', num(su.mesh))}${bar('Gaussian', num(su.splat))}
        ${mem.level ? `<div class="scan-mem ${memCls}">${icon(mem.level === 'bajo' ? 'check' : 'warn')}
          <span><b>Memoria (gaussian): ${esc(mem.level)}</b>${mem.oom_previos ? ` · ${mem.oom_previos} OOM previos` : ''}
          · ${esc(mem.advice || '')}</span></div>` : ''}
        ${(rep.warnings || []).slice(0, 3).map(w => `<div class="scan-warn">${icon('warn')}<span>${esc(w)}</span></div>`).join('')}
      </div>`;
  }
  function splatAssetsFor(clipId) {
    return (sys.splats || [])
      .filter(s => SPLAT_EXT.test(s.name) && s.name.replace(SPLAT_EXT, '') === clipId)
      .concat((sys.splats || []).filter(s => SPLAT_EXT.test(s.name) && s.clip_id === clipId
        && s.name.replace(SPLAT_EXT, '') !== clipId))
      .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0)   // la versión ACTUAL manda: re-entrenar Medium tras Ultra debe reflejarse (antes ganaba iters y 'el entrenamiento no hizo nada')
        || (b.iters || 0) - (a.iters || 0)
        || (SPLAT_RANK[(a.format || a.name.split('.').pop()).toLowerCase()] ?? 9)
        - (SPLAT_RANK[(b.format || b.name.split('.').pop()).toLowerCase()] ?? 9)
        || String(b.archived_at || '').localeCompare(String(a.archived_at || '')));
  }
  function splatAssetFor(clipId) {
    const chosen = selectedSplatByClip[clipId];
    const all = splatAssetsFor(clipId);
    return all.find(s => splatKey(s) === chosen) || all[0] || null;
  }

  const main = renderShell('tresd.html');
  main.classList.add('page-3d');
  main.innerHTML = `
    <div class="page-head"><h1>3D</h1><span class="count">fotogrametría · nube de puntos · splats</span></div>

    <div class="pm-tabs rise td-tabs" id="td-tabs" style="margin-bottom:14px">
      <i class="pm-ink"></i>
      <button class="on" data-tab="projects">${icon('layers')} Proyectos</button>
      <button data-tab="process">${icon('activity')} Procesamiento</button>
      <button data-tab="jobs">${icon('cpu')} Trabajos</button>
    </div>

    <section class="td-mod" data-mod="projects">
    <div class="panel">
      <div class="ph">${icon('layers')} Proyectos 3D <span class="count" id="proj-count"></span></div>
      <div class="pb">
        <div class="td-browserbar">
          <div class="search td-search">${icon('search')}<input id="proj-q" type="search" placeholder="Buscar proyecto, fecha, ubicación…" autocomplete="off"></div>
          <select class="ctl" id="proj-filter" aria-label="Filtrar proyectos">
            <option value="all">Todos</option>
            <option value="dsm">Con DSM</option>
            <option value="splat">Con splat</option>
            <option value="weak">Malla débil</option>
          </select>
          <div class="seg td-viewseg" aria-label="Modo de vista">
            <button class="on" data-proj-mode="cards">${icon('grid')} Tarjetas</button>
            <button data-proj-mode="list">${icon('list')} Lista</button>
          </div>
        </div>
        <div class="td-project-hint">Finder 3D: selecciona un proyecto para abrir mapa, visores, metadata, descargas y enlaces públicos.</div>
        <div class="proj-grid" id="proj-grid"></div>
      </div>
    </div>
    </section>

    <section class="td-mod" data-mod="process" style="display:none">
    <div class="panel td-flow">
      <div class="ph">${icon('activity')} Pipeline de procesamiento
        <span class="spacer" style="flex:1"></span>
        <button class="linklike" id="td-how">¿Cómo funciona?</button>
      </div>
      <div class="pb">
        <div class="td-stepper">
          ${[['film', 'Video', 'DJI + SRT'], ['pin', 'Frames + GPS', 'geotag'], ['map', 'ODM', 'SfM · DSM · orto'],
             ['layers', 'Nube / Malla', 'visor'], ['spark', 'Splat', '<span id="td-splat-dev">Metal/MPS</span>'], ['ext', 'Publicar', 'share']]
            .map(([ic, t, s], i, a) => `
            <div class="td-step"><i>${icon(ic)}</i><b>${t}</b><span>${s}</span></div>
            ${i < a.length - 1 ? '<div class="td-step-arrow">›</div>' : ''}`).join('')}
        </div>
        <div class="td-actions">
          <button class="btn primary td-cta" id="btn-run3d" data-open-run3d>
            ${icon('cube')}<span><b>Procesar un vuelo…</b><small>frames + geotag + fotogrametría · combina tomas del mismo lugar</small></span></button>
          <button class="btn td-cta" id="btn-splat" data-open-splat>
            ${icon('spark')}<span><b>Generar splat…</b><small>foto-realista sobre poses de un proyecto existente</small></span></button>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="ph">${icon('cube')} Gaussian Splats <span class="count" id="splat-count"></span>
        <span class="spacer" style="flex:1"></span>
        <button class="linklike" id="td-what-splat">¿Qué es un splat?</button>
      </div>
      <div class="pb td-splats-wide" id="splats"></div>
    </div>
    </section>

    <section class="td-mod" data-mod="jobs" style="display:none">
    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('activity')} Trabajos y procesamiento</div>
      <div class="pb">
        <div class="job-summary" id="job-summary" aria-label="Resumen de trabajos">
          <button data-summary-filter="all"><span>Todos</span><b data-job-count="all">0</b></button>
          <button data-summary-filter="running"><span>Activos</span><b data-job-count="active">0</b></button>
          <button data-summary-filter="done"><span>Completados</span><b data-job-count="done">0</b></button>
          <button data-summary-filter="error"><span>Fallidos</span><b data-job-count="error">0</b></button>
        </div>
        <div class="job-toolbar">
          <div class="search">${icon('search')}<input id="job-search" type="search" placeholder="Buscar proyecto, ID, calidad o error…" autocomplete="off"></div>
          <div class="td-jobbar" aria-label="Estado">
            <button class="chip on" data-job-filter="all">Todos</button>
            <button class="chip" data-job-filter="running">Activos</button>
            <button class="chip" data-job-filter="done">Listos</button>
            <button class="chip" data-job-filter="error">Errores</button>
          </div>
          <div class="td-jobkinds" aria-label="Tipo">
            <button class="chip on" data-job-kind="all">Todo tipo</button>
            <button class="chip" data-job-kind="3d">ODM</button>
            <button class="chip" data-job-kind="splat">Gaussian</button>
            <button class="chip" data-job-kind="ingest">Importación</button>
          </div>
        </div>
        <p class="footer-note job-note">Una tarea pesada a la vez. Solicitada y efectiva se muestran por separado;
        cada retry, fallback y diagnóstico queda en el historial.</p>
        <div id="jobs3d" class="job-console"></div>
      </div>
    </div>
    </section>

    <div id="proj-view" style="display:none">
    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('map')} Mapa del proyecto
        <span class="spacer" style="flex:1"></span>
        <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-2)">
          Opacidad <input type="range" id="op" min="0" max="100" value="82" style="width:110px"></label>
      </div>
      <div class="pb" style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <div class="tool-row"><span class="tool-lb">Capas</span>
          <button class="chip on" data-layer="ortho">Ortofoto</button>
          <button class="chip" data-layer="dsm">Elevación</button>
          <button class="chip" data-layer="hills">Relieve</button>
          <button class="chip" data-layer="contours">Curvas</button>
        </div>
        <div class="tool-row"><span class="tool-lb">Medir</span>
          <button class="chip" data-tool="dist">Distancia</button>
          <button class="chip" data-tool="area">Área</button>
          <button class="chip" data-tool="volume">Volumen</button>
          <button class="chip" data-tool="profile">Perfil</button>
          <button class="chip" data-tool="compare">Comparar</button>
          <select class="ctl" id="cmp-date" style="display:none;font-size:12px"></select>
          <button class="btn" id="m-clear" style="padding:4px 11px;font-size:11px;margin-left:auto">Limpiar</button>
        </div>
      </div>
      <div id="omap" style="height:56dvh;min-height:340px"></div>
      <div class="pb" id="m-result" style="display:none;border-top:1px solid var(--line)"></div>
    </div>

    <div class="fl-layout" style="margin-top:16px">
      <div>
        <div class="panel">
          <div class="ph">${icon('cube')} Nube de puntos 3D
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="load-cloud-main" style="padding:4px 12px;font-size:11.5px">Cargar</button>
          </div>
          <div id="cloud-box" style="height:54dvh;min-height:360px;display:grid;place-items:center">
            <p class="footer-note" style="margin:0">Nube de ~800k puntos con color real — arrastra para mover, click-derecho rota, doble-click enfoca.</p>
          </div>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="ph">${icon('cube')} Malla texturizada
            <span class="chip" id="mesh-q" style="font-size:10.5px;padding:2px 9px"></span>
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="load-mesh" style="padding:4px 12px;font-size:11.5px">Cargar</button>
          </div>
          <div id="mesh-box" style="height:54dvh;min-height:360px;display:grid;place-items:center">
            <p class="footer-note" style="margin:0">Modelo sólido con textura foto-real — brilla con vuelos en órbita/oblicuos.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('spark')} Gaussian splat del proyecto
        <span class="chip" id="sp-status" style="font-size:10.5px;padding:2px 9px"></span>
        <span class="spacer" style="flex:1"></span>
        <select id="sp-select" title="Versión del splat" style="display:none;max-width:260px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:11.5px"></select>
        <button class="btn primary" id="load-splat" style="padding:4px 12px;font-size:11.5px">Cargar</button>
      </div>
      <div id="splat-box" style="height:56dvh;min-height:360px;display:grid;place-items:center;position:relative">
        <p class="footer-note" style="margin:0" id="splat-note"></p>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('gauge')} Reporte de calidad & descargas
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary" id="improve-scene">${icon('layers')} Mejorar esta escena</button>
      </div>
      <div class="pb" id="dls"></div>
    </div>
    </div>`;

  const projView = document.getElementById('proj-view');
  main.querySelector('.panel')?.after(projView);

  const tdTabs = document.getElementById('td-tabs');
  const tdInk = tdTabs?.querySelector('.pm-ink');
  function moveTdInk() {
    const on = tdTabs?.querySelector('button.on');
    if (!on || !tdInk) return;
    tdInk.style.left = on.offsetLeft + 'px';
    tdInk.style.width = on.offsetWidth + 'px';
  }
  function showTdMod(name) {
    tdTabs?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.td-mod').forEach(m => {
      const show = m.dataset.mod === name;
      if (show && m.style.display === 'none') {
        m.style.display = '';
        m.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 190, easing: 'ease-out' });
      } else if (!show) {
        m.style.display = 'none';
      }
    });
    requestAnimationFrame(moveTdInk);
  }
  tdTabs?.addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) showTdMod(b.dataset.tab);
  });
  window.addEventListener('resize', () => setTimeout(moveTdInk, 30));
  setTimeout(moveTdInk, 30);

  // ── NODO GPU: chip vivo en la barra del pipeline + modal rico ──
  (() => {
    const bar = document.querySelector('.td-stepper')?.parentElement;
    if (!bar) return;
    const chip = document.createElement('button');
    chip.className = 'td-gpu-chip mono';
    chip.id = 'td-gpu-chip';
    chip.innerHTML = 'nodo GPU · <b>consultando…</b>';
    bar.appendChild(chip);
    let last = null;
    const poll = async () => {
      try {
        last = await (await fetch('/api/gpu_node')).json();
        const awake = last.status === 'awake';
        chip.innerHTML = awake
          ? `nodo GPU · <b class="ok">RTX 4060 Ti despierto</b>${last.util_pct ? ` · ${last.util_pct}%` : ''}`
          : 'nodo GPU · <b class="dim">dormido · WoL</b>';
        const dev = document.getElementById('td-splat-dev');
        if (dev) dev.textContent = awake ? 'Metal/MPS · CUDA listo' : 'Metal/MPS';
      } catch { chip.innerHTML = 'nodo GPU · <b class="dim">sin datos</b>'; }
    };
    poll(); setInterval(poll, 30000);
    chip.addEventListener('click', () => {
      const d = last || {};
      const awake = d.status === 'awake';
      openModal('Nodo GPU — PC remoto', `
        <p class="footer-note">RTX 4060 Ti (8GB) en la LAN, invocable por SSH desde este Mac.
        Desbloquea gsplat CUDA: pose refinement y SH-desde-0 — las dos palancas que
        Metal/MPS no expone. Probe real: nada de estos datos se inventa.</p>
        <div class="gn-grid" style="margin:14px 0">
          ${[['ESTADO', awake ? 'despierto' : 'dormido'],
             ['GPU', d.gpu || '—'],
             ['VRAM', d.vram_total_mb ? `${(d.vram_used_mb/1024).toFixed(1)} / ${(d.vram_total_mb/1024).toFixed(0)} GB` : '—'],
             ['USO', d.util_pct != null ? d.util_pct + '%' : '—'],
             ['TEMP', d.temp_c != null ? d.temp_c + '°C' : '—'],
             ['DRIVER', d.driver || '—']]
            .map(([lb, v]) => `<div class="gn-cell"><span>${lb}</span><b>${v}</b></div>`).join('')}
        </div>
        <p class="footer-note">Entrenos splat en CUDA: <b>lane en integración (F3)</b> — el nodo ya está
        comisionado y verificado (gsplat 1.4.0, torch cu124). Gestión completa en la pestaña Sistema.</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          ${awake ? '' : '<button class="btn" id="gnm-wake">Despertar (WoL)</button>'}
          <a class="btn ghost" href="system.html">Abrir Sistema</a>
        </div>`);
      document.getElementById('gnm-wake')?.addEventListener('click', async e2 => {
        e2.target.textContent = 'magic packet enviado…';
        await fetch('/api/gpu_node/wake', { method: 'POST' });
      });
    });
  })();

  document.querySelector('.td-pipeline-grid')?.addEventListener('click', e => {
    if (e.target.closest('[data-open-run3d]')) document.getElementById('btn-run3d')?.click();
    if (e.target.closest('[data-open-splat]')) document.getElementById('btn-splat')?.click();
  });

  const jobsBox = document.getElementById('jobs3d');
  const applyJobFilters = () => {
    if (!jobsBox) return;
    const status = document.querySelector('[data-job-filter].on')?.dataset.jobFilter || 'all';
    const kind = document.querySelector('[data-job-kind].on')?.dataset.jobKind || 'all';
    const q = (document.getElementById('job-search')?.value || '').trim().toLowerCase();
    let visible = 0;
    jobsBox.querySelectorAll('.job-card').forEach(card => {
      const statusOk = status === 'all'
        || (status === 'running' && ['running', 'queued'].includes(card.dataset.status))
        || (status === 'done' && card.dataset.status === 'done')
        || (status === 'error' && ['error', 'cancel_failed', 'cancelled'].includes(card.dataset.status));
      const kindOk = kind === 'all' || card.dataset.kind === kind;
      const searchOk = !q || (card.dataset.search || '').includes(q);
      const show = statusOk && kindOk && searchOk;
      card.hidden = !show;
      if (show) visible++;
    });
    let note = jobsBox.parentElement.querySelector('.jf-empty');
    if (!visible && jobsBox.children.length) {
      if (!note) { note = document.createElement('p'); note.className = 'footer-note jf-empty'; jobsBox.after(note); }
      note.textContent = 'No hay trabajos que coincidan con estos filtros.';
    } else note?.remove();
  };
  document.querySelector('.td-jobbar')?.addEventListener('click', e => {
    const b = e.target.closest('[data-job-filter]');
    if (!b || !jobsBox) return;
    document.querySelectorAll('[data-job-filter]').forEach(x => x.classList.toggle('on', x === b));
    applyJobFilters();
  });
  document.querySelector('.td-jobkinds')?.addEventListener('click', e => {
    const b = e.target.closest('[data-job-kind]'); if (!b) return;
    document.querySelectorAll('[data-job-kind]').forEach(x => x.classList.toggle('on', x === b));
    applyJobFilters();
  });
  document.getElementById('job-search')?.addEventListener('input', applyJobFilters);
  document.getElementById('job-summary')?.addEventListener('click', e => {
    const b = e.target.closest('[data-summary-filter]'); if (!b) return;
    document.querySelector(`[data-job-filter="${b.dataset.summaryFilter}"]`)?.click();
  });
  jobsBox?.addEventListener('jobs:paint', e => {
    for (const [key, value] of Object.entries(e.detail.counts || {})) {
      const out = document.querySelector(`[data-job-count="${key}"]`); if (out) out.textContent = value;
    }
    applyJobFilters();
  });

  // ---------- estado ----------
  let sys = {}, models = [], cur = null;
  const selectedSplatByClip = JSON.parse(localStorage.getItem('ab_splat_versions') || '{}');
  const saveSplatChoice = () => localStorage.setItem('ab_splat_versions', JSON.stringify(selectedSplatByClip));
  const fmtRun = sec => !sec ? ''
    : sec < 180 ? `${Math.round(sec)}s`
      : sec < 7200 ? `${Math.round(sec / 60)}min`
        : `${(sec / 3600).toFixed(1)}h`;
  const splatVersionLabel = s => [
    s.current ? 'Actual' : (s.archived_at || 'Historial'),
    s.preset_label || (s.preset ? s.preset[0].toUpperCase() + s.preset.slice(1) : ''),
    s.iters ? `${s.iters >= 1000 ? (s.iters / 1000) + 'k' : s.iters} iters` : '',
    s.backend || '',
    fmtRun(s.duration_s),
    s.loss != null ? `loss ${s.loss}` : '',
    `${(s.bytes / 1e6).toFixed(1)} MB`,
    (s.format || s.name.split('.').pop() || 'splat').toUpperCase(),
  ].filter(Boolean).join(' · ');
  let sysErr = false;   // distinguir "no hay proyectos" de "no se pudo CARGAR el índice"
  try { sys = await (await fetch('data/manifest/system.json')).json(); } catch { sysErr = true; }
  models = sys.models || [];
  const flights = await getFlights();
  function bboxFromCorners(corners) {
    if (!Array.isArray(corners) || !corners.length) return null;
    const lons = corners.map(p => Number(p?.[0])).filter(Number.isFinite);
    const lats = corners.map(p => Number(p?.[1])).filter(Number.isFinite);
    return lons.length && lats.length ? [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] : null;
  }
  function footprintFor(model) {
    const f = flights.find(x => x.clip_id === model.clip_id);
    return f?.stats?.bbox || bboxFromCorners(model.dsm_corners || model.corners);
  }

  // ---------- tarjetas de proyecto (abrir / renombrar / compartir / borrar) ----------
  const PROJ_KEY = 'ab.proj3d';
  let projQ = '';
  let projFilter = 'all';
  let projMode = localStorage.getItem('ab.3d.projectMode') || 'cards';
  const titleFor = m => {
    const f = flights.find(x => x.clip_id === m.clip_id);
    return m.title || (f ? (f.label || fmt.date(f.date) + ' ' + f.time) : m.clip_id);
  };
  const flightFor = m => flights.find(x => x.clip_id === m.clip_id);
  const splatQualityLabel = loss => loss == null ? 'calidad pendiente'
    : loss <= 0.05 ? 'excelente'
      : loss <= 0.09 ? 'buena'
        : loss <= 0.15 ? 'media'
          : 'básica';
  function projectVisible(m) {
    const f = flightFor(m);
    const splats = splatAssetsFor(m.clip_id);
    if (projFilter === 'dsm' && !m.has_dsm) return false;
    if (projFilter === 'splat' && !splats.length) return false;
    if (projFilter === 'weak' && m.mesh_ok !== false) return false;
    const hay = [
      m.clip_id, titleFor(m), f?.label, f?.date, f?.time,
      m.has_dsm ? 'dsm elevacion curvas' : '',
      splats.length ? 'splat gaussian' : '',
    ].filter(Boolean).join(' ').toLowerCase();
    return !projQ || hay.includes(projQ.toLowerCase().trim());
  }
  function renderCards() {
    const grid = document.getElementById('proj-grid');
    const shown = models.filter(projectVisible);
    document.getElementById('proj-count').textContent = models.length ? `(${shown.length}/${models.length})` : '';
    grid.classList.toggle('proj-list', projMode === 'list');
    document.querySelectorAll('[data-proj-mode]').forEach(b => b.classList.toggle('on', b.dataset.projMode === projMode));
    grid.innerHTML = shown.length ? shown.map(m => {
      const f = flightFor(m);
      const q = m.qa || {};
      const splats = splatAssetsFor(m.clip_id);
      const sp = splatAssetFor(m.clip_id);
      const ha = q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(1) + ' ha' : Math.round(q.area_m2 || 0) + ' m²';
      const status = [
        m.has_dsm ? 'DSM' : 'sin DSM',
        m.mesh_ok === false ? 'malla débil' : 'malla',
        splats.length ? `${splats.length} splat${splats.length === 1 ? '' : 's'}` : 'sin splat',
      ];
      return `<div class="proj-card${cur?.clip_id === m.clip_id ? ' on' : ''}" data-cid="${esc(m.clip_id)}">
        <img src="data/models/${esc(m.clip_id)}/${esc(m.ortho_asset || 'ortho.jpg')}" loading="lazy" alt="" width="320" height="180">
        <div class="pc-body">
          <div class="pc-top"><p class="pc-title">${esc(titleFor(m))}</p><span class="pc-date mono">${esc(f ? `${fmt.date(f.date)} ${f.time || ''}` : m.clip_id.slice(-8))}</span></div>
          <p class="pc-meta mono">${f?.duration_s ? fmt.dur(f.duration_s) + ' · ' : ''}${q.gsd_cm_px ? q.gsd_cm_px + ' cm/px · ' : ''}${q.area_m2 ? ha : ''}</p>
          <div class="pc-badges">${status.map(s => `<span>${esc(s)}</span>`).join('')}</div>
          <div class="pc-kpis">
            <span><b>${q.cameras_reconstructed ?? '—'}</b><small>cámaras</small></span>
            <span><b>${sp ? splatQualityLabel(sp.loss) : '—'}</b><small>gaussian</small></span>
            <span><b>${m.cloud_bytes ? (m.cloud_bytes / 1e6).toFixed(0) + 'MB' : '—'}</b><small>nube</small></span>
          </div>
          <div class="pc-actions">
            <button class="btn primary" data-act="open">Abrir</button>
            <button class="btn" data-act="rename">Renombrar</button>
            <button class="btn" data-act="share">Compartir</button>
            <button class="btn pc-del" data-act="del">Borrar</button>
          </div>
        </div>
      </div>`;
    }).join('') : `<p class="footer-note" style="margin:0">${sysErr
      ? 'No se pudo cargar el índice de proyectos — revisa la conexión y <a href="#" onclick="location.reload();return false" style="color:var(--accent)">recarga</a>.'
      : models.length ? 'No hay proyectos que coincidan con ese filtro.'
        : 'Sin proyectos 3D aún — ve a la pestaña <b>Procesamiento</b> (arriba) para crear el primero.'}</p>`;
  }
  document.getElementById('proj-q')?.addEventListener('input', e => { projQ = e.target.value; renderCards(); });
  document.getElementById('proj-filter')?.addEventListener('change', e => { projFilter = e.target.value; renderCards(); });
  document.querySelector('.td-viewseg')?.addEventListener('click', e => {
    const b = e.target.closest('[data-proj-mode]');
    if (!b) return;
    projMode = b.dataset.projMode;
    localStorage.setItem('ab.3d.projectMode', projMode);
    renderCards();
  });
  document.getElementById('proj-grid').addEventListener('click', async e => {
    if (e.target.tagName === 'INPUT') return;      // click DENTRO del input de renombrar ≠ acción de card
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.proj-card');
    if (!card) return;
    const cid = card.dataset.cid;
    const m = models.find(x => x.clip_id === cid);
    const smashOpen = () => {
      card.classList.add('smash');
      setTimeout(() => card.classList.remove('smash'), 420);
      setProject(cid, { scroll: true });
    };
    if (!btn) { smashOpen(); return; }                      // tap en la tarjeta = abrir
    if (btn.dataset.act === 'open') smashOpen();
    if (btn.dataset.act === 'rename') {
      const tEl = card.querySelector('.pc-title');
      tEl.innerHTML = `<input class="ctl" style="width:100%;font-size:12.5px" value="${esc(titleFor(m))}" maxlength="80">`;
      const inp = tEl.querySelector('input');
      inp.focus(); inp.select();
      const save = async () => {
        const title = inp.value.trim();
        try {
          const r = await api('/api/model_update', { clip_id: cid, title });
          if (r.error) alert(r.error);
          else m.title = r.title;
        } catch { /* login cancelado / red: conserva el título anterior sin romper */ }
        renderCards();
      };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') renderCards(); });
      inp.addEventListener('blur', save);
    }
    if (btn.dataset.act === 'share') {
      const url = `${location.origin}/share.html?m=${encodeURIComponent(cid)}`;
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copiado ✓'; }
      catch { prompt('Copia el link:', url); }
      setTimeout(() => { btn.textContent = 'Compartir'; }, 1800);
    }
    if (btn.dataset.act === 'del') {
      if (!confirm(`¿Borrar "${titleFor(m)}"?\n\nSe eliminan el modelo 3D, sus splats y los archivos de procesamiento. El video original NO se toca.`)) return;
      let r;
      try { r = await api('/api/model_delete', { clip_id: cid, purge_source: true }); }
      catch (err) { return alert(String(err?.message || err)); }
      if (r.error) return alert(r.error);
      models = models.filter(x => x.clip_id !== cid);
      if (cur?.clip_id === cid) {
        cur = null;
        localStorage.removeItem(PROJ_KEY);
        document.getElementById('proj-view').style.display = 'none';
      }
      renderCards();
    }
  });

  // ---------- mini-modal reutilizable ----------
  function openModal(title, body, cls = '') {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal ${cls}">
      <div class="modal-h"><b>${title}</b><button class="modal-x" aria-label="Cerrar">✕</button></div>
      <div class="modal-b">${body}</div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.modal-x')) close(); });
    return { ov, close };
  }

  // ---------- asistente: procesar un vuelo ----------
  const candidates = flights.filter(f => f.has_srt && f.stats?.bbox && !f.archived);
  document.getElementById('btn-run3d').addEventListener('click', () => {
    if (!candidates.length) return alert('Sin vuelos con GPS listos para 3D — sube un video con telemetría.');
    const PRE = [
      { k: 'rapido', n: 'Rápido', t: '~25-40 min', d: 'Borrador · 8 cm/px' },
      { k: 'estandar', n: 'Estándar', t: '~45-75 min', d: '5 cm/px · DSM 10 cm' },
      { k: 'alta', n: 'Alta', t: '~15 min-4 h', d: 'Nube densa · 3 cm/px' },
      { k: 'extra', n: 'Extra', t: '~4-7 h', d: 'Malla 600k · octree 11 · 2 cm/px' },
      { k: 'ultra', n: 'Ultra', t: '~8-14 h', d: 'pc-quality ultra · malla 800k · máx M4' },
    ];
    // presets del gaussian para el modo phased (subconjunto compacto)
    const SQ = [
      { p: 'medium', n: 'Medium', t: '~2-4 min' },
      { p: 'cinematic', n: 'Cinemático', t: '~1 h' },
      { p: 'ultra', n: 'Ultra', t: '~2-4 h' },
    ];
    // U1.1: agrupar por CENTROIDE del track (~130 m) — el test #1 refutó "mismo despegue
    // = mismo sujeto" (clip a 1m + vuelo a 90m compartían home y 0 features). El centro
    // del bbox describe QUÉ vio el vuelo; el despegue solo describe de dónde salió.
    const centroid = f => {
      const b = f.stats?.bbox;                     // [minLng,minLat,maxLng,maxLat]
      return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : (f.stats?.home || null);
    };
    const spotKey = f => {
      const c = centroid(f);
      return c ? `${Math.round(c[0] / 0.0012)}:${Math.round(c[1] / 0.0012)}` : 'sin-gps';
    };
    const groups = {};
    candidates.forEach(f => { (groups[spotKey(f)] ||= []).push(f); });
    const spots = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const placeName = fs => fs[0].place || fs[0].stats?.place
      || (centroid(fs[0]) ? `${centroid(fs[0])[1].toFixed(3)}, ${centroid(fs[0])[0].toFixed(3)}` : 'Sin GPS');
    const sel = new Set([candidates[0].clip_id]);   // primer clip pre-seleccionado
    const photoSel = new Set();
    const availPhotos = (sys.photos || []).map(p => p.name);
    const byCid = Object.fromEntries(candidates.map(f => [f.clip_id, f]));
    const altOf = f => Math.round(f.stats?.max_rel_alt_m || 0);
    const groupMeta = fs => {
      const alts = fs.map(altOf).filter(a => a > 0);
      const dates = [...new Set(fs.map(f => f.date))];
      return { alts: alts.length ? `${Math.min(...alts)}–${Math.max(...alts)} m` : '—',
               dates: dates.length === 1 ? fmt.date(dates[0]) : `${dates.length} fechas` };
    };

    const altBand = a => a < 12 ? 'ground' : a < 40 ? 'mid' : 'high';
    const clipRow = f => `
      <label class="pc-clip${sel.has(f.clip_id) ? ' on' : ''}" data-cid="${esc(f.clip_id)}"
             data-alt="${altOf(f)}" data-date="${esc(f.date || '')}"
             data-q="${esc(((f.label || '') + ' ' + (f.date || '') + ' ' + fmt.date(f.date) + ' ' + (f.time || '') + ' ' + (f.place || '')).toLowerCase())}">
        <input type="checkbox" ${sel.has(f.clip_id) ? 'checked' : ''}>
        <span class="pc-thumb" data-preview="${esc(f.clip_id)}" title="Ver preview">
          <img src="data/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="">${icon('play')}</span>
        <div class="pc-meta">
          <b>${esc(f.label) || fmt.date(f.date) + ' ' + f.time}</b>
          <span class="pc-sub mono">${fmt.dur(f.duration_s)} · ${fmt.date(f.date)} ${esc(f.time || '')}</span>
        </div>
        <span class="pc-gps mono" title="Track GPS 1Hz del SRT — geotag real">${icon('pin')} GPS</span>
        <span class="pc-alt ${altBand(altOf(f))}">${altOf(f)} m</span>
        <span class="pc-score" data-score="${esc(f.clip_id)}">·</span>
      </label>`;

    const { ov, close } = openModal(`${icon('cube')} Estudio 3D`, `
      <div class="st-steps"><span class="st-step on" data-st="1">1 · Seleccionar tomas</span>
        <span class="st-sep">›</span><span class="st-step" data-st="2">2 · Configurar y encolar</span></div>

      <div class="st-pane" data-pane="1">
        <div class="st-grid">
          <div class="st-map-wrap"><div id="st-map"></div>
            <div class="st-map-hint">${icon('pin')} Cada pin es un lugar — clic para ver sus tomas</div>
            <button class="st-map-toggle" id="st-map-toggle" title="Ocultar/mostrar mapa">${icon('chevR')} <span>Ocultar mapa</span></button></div>
          <div class="st-list">
            <div class="st-toolbar">
              <div class="search td-search">${icon('search')}<input id="st-q" type="search" placeholder="Buscar por nombre, fecha, lugar…" autocomplete="off"></div>
              <select class="ctl" id="st-sort" aria-label="Ordenar">
                <option value="spot">Por lugar</option><option value="date">Más recientes</option>
                <option value="dur">Más largos</option><option value="alt">Más altos</option>
              </select>
            </div>
            <div class="st-filters">
              <span class="st-fl">Altura</span>
              <button class="chip on" data-alt-band="all">Todas</button>
              <button class="chip" data-alt-band="ground">&lt;12 m</button>
              <button class="chip" data-alt-band="mid">12–40 m</button>
              <button class="chip" data-alt-band="high">40+ m</button>
            </div>
            <div class="st-filters" id="st-dates">
              <span class="st-fl">Fecha</span>
              <button class="chip on" data-date-f="all">Todas</button>
              ${[...new Set(candidates.map(f => f.date).filter(Boolean))].sort().reverse().slice(0, 6)
                .map(d => `<button class="chip" data-date-f="${esc(d)}">${fmt.date(d)}</button>`).join('')}
            </div>
            <div class="st-actions">
              <span class="st-count mono" id="st-count"></span>
              <span class="spacer" style="flex:1"></span>
              <button class="btn sm" id="st-expand">Expandir todo</button>
              <button class="btn sm" id="st-collapse">Plegar</button>
              <button class="btn sm" id="st-clear">Limpiar selección</button>
            </div>
            <div class="proc-groups" id="st-groups">${spots.map(([sk, fs], gi) => {
              const gm = groupMeta(fs);
              return `
              <div class="proc-group${gi > 0 ? ' collapsed' : ''}" data-spot="${esc(sk)}">
                <div class="pg-head" data-pg-toggle>
                  <span class="pg-chev">${icon('chevR')}</span>
                  <span class="pg-place">${icon('pin')} ${esc(placeName(fs))}</span>
                  <span class="pg-chips mono">${fs.length} toma${fs.length === 1 ? '' : 's'} · ${gm.alts} · ${gm.dates}</span>
                  ${fs.length > 1 ? `<button class="pg-all" data-spot-all="${esc(sk)}">Combinar todo</button>` : ''}
                </div>
                <div class="pg-clips">${fs.map(clipRow).join('')}</div>
              </div>`; }).join('')}</div>
            ${availPhotos.length ? `<details class="proc-photos"><summary>${icon('iso')} Añadir fotos sueltas <span class="count">(${availPhotos.length})</span></summary>
              <p class="footer-note" style="margin:6px 0 0">Fotos del dron: heredan el GPS del video del que
              salieron. Probado con fotos del dron de la misma sesión; el reporte del modelo confirma la fusión.</p>
              <div class="pp-grid">${availPhotos.map(n => `
                <label class="pp-item" data-photo="${esc(n)}"><input type="checkbox">
                  <img src="data/photos/${encodeURIComponent(n)}" loading="lazy" alt=""></label>`).join('')}</div></details>` : ''}
          </div>
        </div>
      </div>

      <div class="st-pane" data-pane="2" style="display:none">
        <div id="m-combined" class="proc-combined"></div>
        <div class="st-node mono" id="st-node">
          <span class="st-node-dot"></span>
          <span id="st-node-txt">nodo GPU · consultando…</span>
          <span class="spacer" style="flex:1"></span>
          <span class="st-node-note">3D: ODM local · splat: Metal/MPS · CUDA remoto en integración</span>
        </div>
        <div id="m-preflight"></div>
        <p class="mlb">Nombre del proyecto <span style="text-transform:none;letter-spacing:0;color:var(--text-3)">(opcional)</span></p>
        <div class="st-namer"><input class="ctl" id="m-title" maxlength="80" placeholder="p. ej. Casa 4 Julio — combinado">
          <button class="btn" id="m-suggest" title="Sugerir con IA (DeepSeek)">✨ Sugerir</button></div>
        <p class="mlb">Calidad de la fotogrametría</p>
        <div class="mpresets">${PRE.map(p => `
          <div class="mpreset${p.k === 'estandar' ? ' on' : ''}" data-k="${p.k}">
            <b>${p.n}</b><span class="mono">${p.t}</span><small>${p.d}</small></div>`).join('')}</div>
        <label class="proc-phase"><input type="checkbox" id="m-splat">
          <span>${icon('spark')} <b>También entrenar gaussian splat</b> al terminar el 3D (foto-realista)</span></label>
        <div id="m-splatpreset" class="mpresets" style="display:none">${SQ.map(q => `
          <div class="mpreset${q.p === 'cinematic' ? ' on' : ''}" data-sp="${q.p}"><b>${q.n}</b><span class="mono">${q.t}</span></div>`).join('')}</div>
      </div>

      <div class="st-tray" id="st-tray"></div>
      <div class="st-footer">
        <button class="btn" id="st-back" style="display:none">‹ Atrás</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary" id="st-next">Continuar ›</button>
        <button class="btn primary" id="m-go" style="display:none">${icon('cube')} Encolar procesamiento</button>
      </div>`, 'modal--studio');

    // mapa ocultable (transform/opacity — 60fps) + preferencia persistida
    const stGrid = ov.querySelector('.st-grid');
    const mapToggle = ov.querySelector('#st-map-toggle');
    const applyMapVis = hidden => {
      stGrid.classList.toggle('map-hidden', hidden);
      mapToggle.querySelector('span').textContent = hidden ? 'Mostrar mapa' : 'Ocultar mapa';
      localStorage.setItem('ab.st.maphidden', hidden ? '1' : '0');
      if (!hidden) setTimeout(() => { try { stMap?.resize(); } catch {} }, 260);
    };
    mapToggle?.addEventListener('click', () => applyMapVis(!stGrid.classList.contains('map-hidden')));
    if (localStorage.getItem('ab.st.maphidden') === '1') applyMapVis(true);

    // nodo GPU en vivo dentro del paso 2 (probe real /api/gpu_node)
    (async () => {
      try {
        const d = await (await fetch('/api/gpu_node')).json();
        const el = ov.querySelector('#st-node');
        const tx = ov.querySelector('#st-node-txt');
        if (!el || !tx) return;
        if (d.status === 'awake') {
          el.classList.add('awake');
          tx.textContent = `nodo GPU · ${d.gpu || 'despierto'} · ${d.temp_c ?? '—'}°C`;
        } else tx.textContent = 'nodo GPU · dormido (WoL en Sistema)';
      } catch {}
    })();

    const combinedBox = ov.querySelector('#m-combined');
    // renderCombined() invokes the hoisted renderPreflight(); initialize these controls
    // before the first render so renderPreflight never crosses a const TDZ.
    const splatChk = ov.querySelector('#m-splat'), splatPre = ov.querySelector('#m-splatpreset');
    // chip de score POR CLIP (aptitud individual del escáner — sí está fundamentado). NO predice
    // la fusión: eso solo se sabe DESPUÉS de procesar (el modelo reporta qué fuentes co-registraron).
    async function scoreChip(cid) {
      if (_scanCache[cid]) return paintChip(cid, _scanCache[cid]);
      try {
        const rep = await (await fetch(`/api/capture_report?clip_id=${encodeURIComponent(cid)}`)).json();
        if (!rep.error) _scanCache[cid] = rep;
        return paintChip(cid, rep);
      } catch { return null; }
    }
    function paintChip(cid, rep) {
      const el = ov.querySelector(`[data-score="${CSS.escape(cid)}"]`);
      if (!el) return rep;
      if (!rep || rep.error) { el.textContent = ''; return null; }
      const su = rep.suitability || {};
      const best = Math.max(su.ortho_dsm || 0, su.mesh || 0, su.splat || 0);
      el.textContent = best.toFixed(0);
      el.className = `pc-score ${best >= 7 ? 'ok' : best >= 4 ? 'mid' : 'bad'}`;
      return rep;
    }
    candidates.forEach(f => scoreChip(f.clip_id));   // llena los chips en background

    // panel COMBINADO — señales de COMPATIBILIDAD honestas (no una predicción de éxito falsa).
    // Basado en datos reales del track: altura, sesión, cercanía. Los merges fallan cuando mezclas
    // una toma a ras de suelo con una aérea (0 features comunes) o clips de sesiones distintas
    // (la iluminación cambia). Advertimos ESO; el resultado real lo reporta el modelo tras procesar.
    function renderCombined() {
      const cids = [...sel];
      if (!cids.length) { combinedBox.innerHTML = '<div class="proc-combined-empty">Selecciona al menos un video.</div>'; return; }
      const fs = cids.map(c => byCid[c]).filter(Boolean);
      const alts = fs.map(f => Math.round(f.stats?.max_rel_alt_m || 0));
      const days = new Set(fs.map(f => f.date));
      const multi = cids.length + photoSel.size > 1;
      const warns = [];
      if (multi) {
        const ground = alts.some(a => a < 12), aerial = alts.some(a => a >= 30);
        if (ground && aerial) warns.push(['bad', 'Mezclas una toma a <b>ras de suelo</b> con otra <b>aérea</b> — ven cosas distintas, probablemente NO se fusionen.']);
        if (days.size > 1) warns.push(['mid', 'Videos de <b>fechas distintas</b> — la luz cambia; el emparejamiento puede fallar. Ideal: misma salida.']);
        const amax = Math.max(...alts), amin = Math.min(...alts.filter(a => a > 0), amax);
        if (amax > 0 && amin > 0 && amax / amin > 4 && !(ground && aerial)) warns.push(['mid', `Alturas muy distintas (${amin}–${amax} m) — puede que solo fusione parte.`]);
      }
      const ok = multi && !warns.length;
      combinedBox.innerHTML = `
        <div class="scan-card">
          <div class="scan-hd">${icon('layers')} MODELO COMBINADO
            <span class="scan-verdict ${multi ? (warns.some(w => w[0] === 'bad') ? 'bad' : ok ? 'ok' : 'mid') : 'mid'}">${
              !multi ? 'Toma única' : warns.some(w => w[0] === 'bad') ? 'Posible incompatibilidad' : ok ? 'Compatibles' : 'Revisa avisos'}</span>
          </div>
          <div class="pcm-row">
            <span class="pcm"><b>${cids.length}</b> video${cids.length === 1 ? '' : 's'}${photoSel.size ? ` + <b>${photoSel.size}</b> fotos` : ''}</span>
            <span class="pcm">altura <b>${alts.length ? Math.min(...alts) + '–' + Math.max(...alts) : '—'}</b> m</span>
            <span class="pcm">${days.size === 1 ? 'misma sesión ✓' : days.size + ' fechas'}</span>
          </div>
          ${warns.map(([c, t]) => `<div class="scan-mem ${c}">${icon('warn')}<span>${t}</span></div>`).join('')}
          ${ok ? `<div class="scan-mem ok">${icon('check')}<span>Tomas compatibles (misma salida, alturas parecidas). El modelo reportará qué fuentes fusionaron de verdad.</span></div>` : ''}
        </div>`;
      if (typeof renderTray === 'function') renderTray();
      if (typeof renderPreflight === 'function') renderPreflight();
      try { if (typeof drawTracks === 'function') drawTracks(); } catch { }
    }
    renderCombined();

    const syncClip = cid => {
      const lbl = ov.querySelector(`.pc-clip[data-cid="${CSS.escape(cid)}"]`);
      if (lbl) { lbl.classList.toggle('on', sel.has(cid)); lbl.querySelector('input').checked = sel.has(cid); }
    };
    ov.querySelector('.proc-groups').addEventListener('click', e => {
      const all = e.target.closest('[data-spot-all]');
      if (all) {
        e.preventDefault();
        const fs = groups[all.dataset.spotAll] || [];
        const allOn = fs.every(f => sel.has(f.clip_id));
        fs.forEach(f => { allOn ? sel.delete(f.clip_id) : sel.add(f.clip_id); syncClip(f.clip_id); });
        if (!sel.size && fs[0]) { sel.add(fs[0].clip_id); syncClip(fs[0].clip_id); }   // nunca vacío
        renderCombined();
        return;
      }
      const lbl = e.target.closest('.pc-clip');
      if (!lbl) return;
      const cid = lbl.dataset.cid;
      setTimeout(() => {   // deja que el checkbox nativo togglee primero
        lbl.querySelector('input').checked ? sel.add(cid) : sel.delete(cid);
        if (!sel.size) { sel.add(cid); lbl.querySelector('input').checked = true; }   // mínimo 1
        lbl.classList.toggle('on', sel.has(cid));
        renderCombined();
      }, 0);
    });
    ov.querySelector('.proc-photos')?.addEventListener('change', e => {
      const it = e.target.closest('.pp-item'); if (!it) return;
      const n = it.dataset.photo;
      e.target.checked ? photoSel.add(n) : photoSel.delete(n);
      it.classList.toggle('on', e.target.checked);
      renderCombined();
    });
    ov.querySelector('.mpresets').addEventListener('click', e => {
      const c = e.target.closest('.mpreset'); if (!c) return;
      c.parentElement.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
    });
    splatChk.addEventListener('change', () => { splatPre.style.display = splatChk.checked ? '' : 'none'; renderPreflight(); });
    splatPre.addEventListener('click', e => {
      const c = e.target.closest('.mpreset'); if (!c) return;
      splatPre.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
      renderPreflight();
    });

    // ---------- v2: pasos, tray, mapa, filtros, preview ----------
    const setStep = n => {
      ov.querySelectorAll('.st-pane').forEach(p => p.style.display = p.dataset.pane == n ? '' : 'none');
      ov.querySelectorAll('.st-step').forEach(s => s.classList.toggle('on', s.dataset.st == n));
      ov.querySelector('#st-back').style.display = n === 2 ? '' : 'none';
      ov.querySelector('#st-next').style.display = n === 1 ? '' : 'none';
      ov.querySelector('#m-go').style.display = n === 2 ? '' : 'none';
      if (n === 2) { renderCombined(); renderPreflight(); }
    };
    ov.querySelector('#st-next').addEventListener('click', () => setStep(2));
    ov.querySelector('#st-back').addEventListener('click', () => setStep(1));

    // tray de selección: chips con quitar — visible en ambos pasos
    function renderTray() {
      const tray = ov.querySelector('#st-tray');
      const fs = [...sel].map(c => byCid[c]).filter(Boolean);
      const durTot = fs.reduce((a, f) => a + (f.duration_s || 0), 0);
      tray.innerHTML = fs.length
        ? `<span class="st-tray-l">${icon('layers')} ${fs.length} video${fs.length === 1 ? '' : 's'}${photoSel.size ? ` + ${photoSel.size} fotos` : ''} · ${fmt.dur(durTot)}</span>`
          + fs.map(f => `<span class="st-chip" data-untray="${esc(f.clip_id)}">${esc((f.label || fmt.date(f.date) + ' ' + f.time).slice(0, 22))} ✕</span>`).join('')
        : '<span class="st-tray-l">Selecciona al menos un video</span>';
    }
    ov.querySelector('#st-tray').addEventListener('click', e => {
      const c = e.target.closest('[data-untray]'); if (!c || sel.size <= 1) return;
      sel.delete(c.dataset.untray); syncClip(c.dataset.untray); renderTray(); renderCombined(); applyFilters();
    });
    renderTray();

    // preview del proxy en overlay liviano (clic en el thumb, no togglea el checkbox)
    ov.querySelector('#st-groups').addEventListener('click', e => {
      const th = e.target.closest('[data-preview]');
      if (!th) return;
      e.preventDefault(); e.stopPropagation();
      const cid = th.dataset.preview;
      const pv = document.createElement('div');
      pv.className = 'st-preview-ov';
      pv.innerHTML = `<div class="st-preview"><video src="data/proxies/${encodeURIComponent(cid)}.mp4" controls autoplay muted playsinline></video>
        <button class="modal-x">✕</button></div>`;
      pv.addEventListener('click', ev => { if (ev.target === pv || ev.target.closest('.modal-x')) { pv.querySelector('video').pause(); pv.remove(); } });
      document.body.appendChild(pv);
    }, true);

    // filtros: búsqueda + banda de altura + orden (re-ordena DENTRO de cada grupo; 'spot' = original)
    const applyFilters = () => {
      const q = (ov.querySelector('#st-q').value || '').toLowerCase().trim();
      const band = ov.querySelector('[data-alt-band].on')?.dataset.altBand || 'all';
      const df = ov.querySelector('[data-date-f].on')?.dataset.dateF || 'all';
      const inBand = a => band === 'all' || (band === 'ground' ? a < 12 : band === 'mid' ? a >= 12 && a < 40 : a >= 40);
      let visTot = 0;
      ov.querySelectorAll('.pc-clip').forEach(el => {
        const vis = (!q || el.dataset.q.includes(q)) && inBand(+el.dataset.alt)
          && (df === 'all' || el.dataset.date === df);
        el.style.display = vis ? '' : 'none';
        if (vis) visTot++;
      });
      const filtering = q || band !== 'all' || df !== 'all';
      ov.querySelectorAll('.proc-group').forEach(g => {
        const hay = [...g.querySelectorAll('.pc-clip')].some(c => c.style.display !== 'none');
        g.style.display = hay ? '' : 'none';
        if (filtering && hay) g.classList.remove('collapsed');   // filtrar = mostrar resultados
      });
      const ct = ov.querySelector('#st-count');
      if (ct) ct.textContent = `${sel.size} seleccionada${sel.size === 1 ? '' : 's'} · ${visTot} visibles`;
    };
    // headers con nombre real (barrio · ciudad) — mismo cache que los pins
    ov.querySelectorAll('.proc-group').forEach(async g => {
      const fs = groups[g.dataset.spot]; if (!fs) return;
      const c = centroid(fs[0]); if (!c) return;
      try {
        const r = await (await fetch(`/api/geocode?lat=${c[1]}&lon=${c[0]}`)).json();
        if (r.name) g.querySelector('.pg-place').innerHTML = `${icon('pin')} ${esc(r.name)}`;
      } catch { /* coords como fallback ya visibles */ }
    });
    ov.querySelector('#st-q').addEventListener('input', applyFilters);
    ov.querySelector('.st-filters').addEventListener('click', e => {
      const c = e.target.closest('[data-alt-band]'); if (!c) return;
      ov.querySelectorAll('[data-alt-band]').forEach(x => x.classList.toggle('on', x === c));
      applyFilters();
    });
    ov.querySelector('#st-dates').addEventListener('click', e => {
      const c = e.target.closest('[data-date-f]'); if (!c) return;
      ov.querySelectorAll('[data-date-f]').forEach(x => x.classList.toggle('on', x === c));
      applyFilters();
    });
    // acordeón: el head pliega/expande (los botones internos no)
    ov.querySelector('#st-groups').addEventListener('click', e => {
      if (e.target.closest('.pg-all') || e.target.closest('[data-preview]')) return;
      const h = e.target.closest('[data-pg-toggle]');
      if (h) h.closest('.proc-group').classList.toggle('collapsed');
    });
    ov.querySelector('#st-expand').addEventListener('click', () =>
      ov.querySelectorAll('.proc-group').forEach(g => g.classList.remove('collapsed')));
    ov.querySelector('#st-collapse').addEventListener('click', () =>
      ov.querySelectorAll('.proc-group').forEach(g => g.classList.add('collapsed')));
    ov.querySelector('#st-clear').addEventListener('click', () => {
      [...sel].slice(1).forEach(c => { sel.delete(c); syncClip(c); });   // deja 1 (mínimo del flujo)
      renderTray(); applyFilters();
    });
    applyFilters();
    ov.querySelector('#st-sort').addEventListener('change', e => {
      const mode = e.target.value;
      const key = { date: f => f.date + (f.time || ''), dur: f => f.duration_s || 0, alt: altOf }[mode];
      ov.querySelectorAll('.proc-group').forEach(g => {
        const rows = [...g.querySelectorAll('.pc-clip')];
        if (mode === 'spot') return;
        rows.sort((a, b) => key(byCid[b.dataset.cid]) > key(byCid[a.dataset.cid]) ? 1 : -1)
            .forEach(r => r.parentElement.appendChild(r));
      });
    });

    // mapa premium: pins por lugar, capas (satélite/oscuro/plano), zoom por radio del
    // spot, tracks de la selección dibujados, nombres geocodificados. 60fps nativo de
    // maplibre (flyTo/easeTo); el fitBounds corre en 'load' Y tras el layout del modal
    // (el bug del zoom-mundial: fit con contenedor sin altura calcula zoom 0).
    let stMap = null;
    const PLANO_STYLE = { version: 8, sources: { v: { type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
      tileSize: 256, attribution: 'CARTO · OSM' } }, layers: [{ id: 'v', type: 'raster', source: 'v' }] };
    const mapBounds = new maplibregl.LngLatBounds();
    const fitAll = () => { if (!mapBounds.isEmpty() && stMap) stMap.fitBounds(mapBounds, { padding: 46, maxZoom: 16, duration: 900 }); };
    const selCenter = () => {
      const f = byCid[[...sel][0]]; const c = f && centroid(f);
      return c || (mapBounds.isEmpty() ? null : mapBounds.getCenter().toArray());
    };
    const drawTracks = async () => {
      if (!stMap || !stMap.isStyleLoaded()) return;
      const feats = [];
      for (const cid of sel) {
        try {
          const t = await (await fetch(`data/tracks/${encodeURIComponent(cid)}.flight.json`)).json();
          const pts = (t.points || []).filter(p => p.lon && p.lat).map(p => [p.lon, p.lat]);
          if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts } });
        } catch { }
      }
      const data = { type: 'FeatureCollection', features: feats };
      if (stMap.getSource('sel-tracks')) stMap.getSource('sel-tracks').setData(data);
      else {
        stMap.addSource('sel-tracks', { type: 'geojson', data });
        stMap.addLayer({ id: 'sel-tracks-halo', type: 'line', source: 'sel-tracks',
          paint: { 'line-color': '#0b1220', 'line-width': 5, 'line-opacity': .55 } });
        stMap.addLayer({ id: 'sel-tracks', type: 'line', source: 'sel-tracks',
          paint: { 'line-color': '#4cc2ff', 'line-width': 2.5 } });
      }
    };
    try {
      if (window.maplibregl) {
        stMap = new maplibregl.Map({ container: ov.querySelector('#st-map'), style: SAT_STYLE,
                                     attributionControl: false, cooperativeGestures: true });
        stMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        spots.forEach(([sk, fs]) => {
          const c = centroid(fs[0]); if (!c) return;
          mapBounds.extend(c);
          const el = document.createElement('div');
          el.className = 'st-pin';
          el.innerHTML = `<b>${fs.length}</b>`;
          el.addEventListener('click', () => {
            stMap.flyTo({ center: c, zoom: 15.5, duration: 850, essential: true });
            const g = ov.querySelector(`.proc-group[data-spot="${CSS.escape(sk)}"]`);
            if (g) { g.scrollIntoView({ behavior: 'smooth', block: 'start' }); g.classList.add('flash'); setTimeout(() => g.classList.remove('flash'), 1200); }
          });
          new maplibregl.Marker({ element: el }).setLngLat(c).addTo(stMap);
        });
        stMap.on('load', () => { fitAll(); drawTracks(); });
        stMap.on('style.load', drawTracks);            // las capas geojson mueren al cambiar estilo
        setTimeout(() => { stMap.resize(); fitAll(); }, 120);
        // controles superpuestos: capas + radio del spot
        const ctl = document.createElement('div');
        ctl.className = 'st-map-ctl';
        ctl.innerHTML = `
          <div class="st-mc-row" data-role="layers">
            <button class="on" data-layer="sat">Satélite</button>
            <button data-layer="plano">Plano</button>
            <button data-layer="oscuro">Oscuro</button>
          </div>
          <div class="st-mc-row" data-role="radius">
            <button data-r="200">Spot</button><button data-r="400">S</button>
            <button data-r="800">M</button><button data-r="1500">L</button>
            <button data-r="3000">XL</button><button data-r="all">Todo</button>
          </div>`;
        ov.querySelector('.st-map-wrap').appendChild(ctl);
        ctl.addEventListener('click', e => {
          const L = e.target.closest('[data-layer]');
          if (L) {
            ctl.querySelectorAll('[data-layer]').forEach(b => b.classList.toggle('on', b === L));
            stMap.setStyle({ sat: SAT_STYLE, plano: PLANO_STYLE, oscuro: DARK_STYLE }[L.dataset.layer]);
            return;
          }
          const R = e.target.closest('[data-r]');
          if (!R) return;
          ctl.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b === R));
          if (R.dataset.r === 'all') return fitAll();
          const c = selCenter(); if (!c) return;
          const r = +R.dataset.r;                       // radio en metros → bounds del círculo
          const dLat = r / 111320, dLon = r / (111320 * Math.cos(c[1] * Math.PI / 180));
          stMap.fitBounds([[c[0] - dLon, c[1] - dLat], [c[0] + dLon, c[1] + dLat]],
                          { duration: 850, essential: true });
        });
      }
    } catch { /* sin mapa no se bloquea el flujo */ }
    // nombres humanos por grupo (geocode cacheado server-side): ciudad · barrio,
    // con las coordenadas degradadas a tooltip — premium sin perder precisión
    spots.forEach(async ([sk, fs]) => {
      const c = centroid(fs[0]); if (!c) return;
      try {
        const g = await (await fetch(`/api/geocode?lat=${c[1].toFixed(3)}&lon=${c[0].toFixed(3)}`)).json();
        if (g.name) {
          const el = ov.querySelector(`.proc-group[data-spot="${CSS.escape(sk)}"] .pg-place`);
          if (el) { el.setAttribute('title', el.textContent.trim()); el.innerHTML = `${icon('pin')} ${esc(g.name)}`; }
        }
      } catch { }
    });

    // preflight del splat phased (U1.3 en el modal): estimación de frames del perfil del preset
    // ODM elegido → /api/preflight. Etiquetado como PROYECCIÓN del modelo, jamás promesa.
    async function renderPreflight() {
      const box = ov.querySelector('#m-preflight');
      if (!box) return;
      if (!splatChk.checked) { box.innerHTML = ''; return; }
      const fs = [...sel].map(c => byCid[c]).filter(Boolean);
      const odmK = ov.querySelector('.mpresets .mpreset.on')?.dataset.k || 'estandar';
      const fps = { rapido: 0.33, estandar: 0.5, alta: 1.0, extra: 1.0, ultra: 1.0 }[odmK] || 0.5;
      const width = { rapido: 2048, estandar: 2688, alta: 3072, extra: 3072, ultra: 3072 }[odmK] || 2688;
      const nEst = Math.max(8, Math.round(fs.reduce((a, f) => a + (f.duration_s || 0) * fps, 0) * 0.72) + photoSel.size);
      const sp = splatPre.querySelector('.mpreset.on')?.dataset.sp || 'cinematic';
      try {
        const r = await api('/api/preflight', { n_images: nEst, width, preset: sp });
        if (r.error) { box.innerHTML = ''; return; }
        const cls = { SAFE: 'ok', ELEVATED: 'mid', LIKELY_OOM: 'mid',
          UNVERIFIED_HIGH_RISK: 'mid', INPUT_FLOOR_EXCEEDS_CAP: 'bad', REJECTED: 'bad' }[r.verdict] || 'mid';
        const measured = r.confidence === 'calibrated'
          ? `Pico proyectado Medium: ${r.projected_peak_mib} MiB (${r.pct}% del límite).`
          : `Piso calculado de carga: ${r.input_floor_mib} MiB; a -d 2: ${r.d2_input_floor_mib} MiB.`;
        const action = r.recommended_d > 1 ? ` El worker comenzará directamente en -d ${r.recommended_d}.` : '';
        box.innerHTML = `<div class="scan-mem ${cls}">${icon(r.verdict === 'SAFE' ? 'check' : 'warn')}
          <span><b>Preflight de memoria (${esc(sp)})</b>: ${esc(r.verdict)} · ~${nEst} imágenes. ${measured}
          ${esc(r.note || '')}${action}
          <i class="st-proj-note">${r.confidence === 'calibrated'
            ? 'Estimación Medium calibrada con ejecuciones medidas; conserva incertidumbre.'
            : 'Cinematic/Ultra: riesgo no calibrado; no se inventa un pico ni se declara incapaz al Mac.'}</i></span></div>`;
      } catch { box.innerHTML = ''; }
    }
    ov.querySelector('.mpresets').addEventListener('click', () => renderPreflight());

    // DeepSeek (lane de texto): nombre sugerido desde lugar geocodificado + fecha + tomas
    ov.querySelector('#m-suggest')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '…';
      try {
        const f = byCid[[...sel][0]];
        const gEl = ov.querySelector(`.proc-group[data-spot="${CSS.escape(spotKey(f))}"] .pg-place`);
        const r = await api('/api/suggest_name', {
          place: (gEl?.textContent || f.place || '').trim(),
          date: fmt.date(f.date), n: sel.size });
        if (r.name) { const t = ov.querySelector('#m-title'); t.value = r.name; t.focus(); }
        else if (r.error) alert(r.error);
      } finally { b.disabled = false; b.textContent = '✨ Sugerir'; }
    });

    ov.querySelector('#m-go').addEventListener('click', async e2 => {
      const btn = e2.currentTarget;
      btn.disabled = true;
      try {
        const sources = [...sel];
        const r = await api('/api/odm', {
          clip_id: sources[0],
          sources,
          photos: [...photoSel],
          preset: ov.querySelector('.mpresets .mpreset.on')?.dataset.k || 'estandar',
          title: ov.querySelector('#m-title').value.trim(),
          then_splat: splatChk.checked,
          splat_preset: splatPre.querySelector('.mpreset.on')?.dataset.sp || 'cinematic',
          best_available: true,
        });
        if (r.error) return alert(r.error);
        close();
        showTdMod('jobs');
        document.querySelector('[data-job-filter="all"]')?.click();
      } finally { btn.disabled = false; }
    });
  });
  // REFRESH EN VIVO: al completarse un 3D/splat, re-lee el índice y re-pinta todo sin recargar
  // (antes sys/models se cargaban UNA vez: el proyecto nuevo o el splat recién entrenado eran
  // invisibles hasta un F5 — el usuario creía que el job no hizo nada)
  pollJobs(document.getElementById('jobs3d'), 2500, async job => {
    if (!['3d', 'splat'].includes(job.kind)) return;
    try {
      sys = await (await fetch('data/manifest/system.json')).json();
      models = sys.models || [];
      delete _scanCache[job.label];                // el escáner re-lee estado/historial del clip
      // no re-pintar el grid con un rename en curso (destruiría el input a mitad de tecleo)
      if (!document.querySelector('#proj-grid input')) renderCards();
      renderSplatList();
      // SOLO refrescar el panel si el job era de ESTE proyecto: antes CUALQUIER job terminado
      // destruía los visores/mediciones del proyecto abierto y el autoload re-descargaba la
      // nube (~100MB) — justo cuando más se usa el visor (mirando A mientras entrena B)
      if (cur && job.label === cur.clip_id) {
        const fresh = models.find(m => m.clip_id === cur.clip_id);
        if (fresh) { cur = fresh; setProject(cur.clip_id, { keepTab: true }); }
      }
    } catch { /* siguiente poll lo reintenta */ }
  });

  const modelSourceIds = model => {
    const rows = model?.reconstruction?.sources || model?.sources || [model?.clip_id];
    return rows.map(x => typeof x === 'string' ? x : x?.clip_id).filter(Boolean);
  };
  const modelPhotoIds = model => model?.reconstruction?.photos || model?.source_photos || [];
  const sceneForVersion = (sceneRows, versionId) => (sceneRows || []).find(scene =>
    scene.active_version === versionId || (scene.versions || []).some(v => v.id === versionId));
  const geoCenter = item => {
    const box = item?.stats?.bbox || bboxFromCorners(item?.corners || item?.dsm_corners);
    return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
  };
  const geoDistance = (a, b) => {
    if (!a || !b) return null;
    const r = Math.PI / 180, y = (b[1] - a[1]) * 111320;
    const x = (b[0] - a[0]) * 111320 * Math.cos((a[1] + b[1]) / 2 * r);
    return Math.hypot(x, y);
  };
  const sceneVersionTruth = version => {
    const metrics = version?.metrics || {};
    const splat = metrics.splat || {};
    const requested = version?.requested_preset || metrics.requested_preset;
    const effective = version?.effective_preset || metrics.effective_preset;
    const parts = [version?.status, version?.merge_label || 'pendiente',
      `${(version?.sources || []).length} videos`];
    if (requested) parts.push(`ODM solicitado ${requested}${effective ? ` → ${effective} efectivo` : ''}`);
    if (metrics.dense_quality_requested || metrics.dense_quality) {
      parts.push(`nube ${metrics.dense_quality_requested || '—'} → ${metrics.dense_quality || '—'}`);
    }
    if (metrics.pipeline_mode) parts.push(`producto ${metrics.pipeline_mode}`);
    if (splat.requested_preset) {
      parts.push(`Splat solicitado ${splat.requested_preset}${splat.effective_preset ? ` → ${splat.effective_preset} efectivo` : ''}${splat.input_scale ? ` · -d${splat.input_scale}` : ''}`);
    }
    return parts.filter(Boolean).join(' · ');
  };
  async function openImproveScene(model) {
    if (!model) return;
    let sceneRows = [];
    try { sceneRows = (await (await fetch('/api/scenes')).json()).scenes || []; } catch {}
    let scene = sceneForVersion(sceneRows, model.clip_id);
    const currentSources = scene
      ? ((scene.versions || []).find(v => v.id === (scene.active_version || model.clip_id))?.sources || modelSourceIds(model))
      : modelSourceIds(model);
    const currentPhotos = scene
      ? ((scene.versions || []).find(v => v.id === (scene.active_version || model.clip_id))?.photos || modelPhotoIds(model))
      : modelPhotoIds(model);
    const origin = geoCenter(model);
    const ranked = candidates.map(f => ({ f, distance: geoDistance(origin, geoCenter(f)) }))
      .sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));
    // Never hide an active source merely because 24 nearer flights exist. Losing a checked
    // source here would silently turn an additive version into a replacement on submit.
    const currentChoices = ranked.filter(({ f }) => currentSources.includes(f.clip_id));
    const choices = currentChoices.concat(
      ranked.filter(({ f }) => !currentSources.includes(f.clip_id)).slice(0, Math.max(0, 24 - currentChoices.length)));
    const photoRows = [...(sys.photos || [])];
    currentPhotos.forEach(name => {
      if (!photoRows.some(p => p.name === name)) photoRows.unshift({ name });
    });
    const versions = scene?.versions || [];
    const { ov, close } = openModal(`${icon('layers')} Mejorar esta escena`, `
      <p class="footer-note" style="margin:0 0 12px">Cada mejora crea una versión nueva: combina todas las
      capturas seleccionadas, verifica cada fuente y conserva intacta la versión activa.</p>
      <div class="scene-version-head"><span>Versión activa</span><b>${esc(scene?.active_version || model.clip_id)}</b></div>
      ${versions.length ? `<div class="scene-versions">${versions.map(v => `
        <div><span><b>${esc(v.id)}</b><small>${esc(sceneVersionTruth(v))}</small></span>
        ${v.id === scene.active_version ? '<i>Activa</i>' : v.status === 'ready' && ['FULL', 'SINGLE'].includes(v.merge_label)
          ? `<button class="btn" data-scene-promote="${esc(v.id)}">Promover</button>` : ''}</div>`).join('')}</div>` : ''}
      <p class="mlb">Videos de la nueva versión</p>
      <div class="scene-sources">${choices.map(({ f, distance }) => {
        const selected = currentSources.includes(f.clip_id);
        const alt = Math.round(f.stats?.max_rel_alt_m || 0);
        const dist = distance == null ? 'distancia sin medir' : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
        const risky = distance != null && distance > 500;
        return `<label class="scene-source${selected ? ' on' : ''}${risky ? ' risky' : ''}">
          <input type="checkbox" value="${esc(f.clip_id)}"${selected ? ' checked' : ''}>
          <img src="data/thumbs/${encodeURIComponent(f.clip_id)}.jpg" alt="" loading="lazy">
          <span><b>${esc(f.label || `${fmt.date(f.date)} · ${f.time}`)}</b><small>${esc(dist)} · ${alt || '—'} m${risky ? ' · revisar compatibilidad' : ''}</small></span></label>`;
      }).join('')}</div>
      <p class="footer-note scene-truth">La cercanía solo sugiere compatibilidad. El resultado FULL/PARTIAL se decide después con cámaras registradas por fuente.</p>
      <p class="mlb">Fotos adicionales</p>
      <div class="scene-photos">${photoRows.slice(0, Math.max(24, currentPhotos.length)).map(p => `<label>
        <input type="checkbox" value="${esc(p.name)}"${currentPhotos.includes(p.name) ? ' checked' : ''}>
        <span>${esc(p.name)}</span></label>`).join('') || '<span class="footer-note">Sin fotos sueltas en el vault.</span>'}</div>
      <p class="mlb">ODM de la nueva versión</p>
      <div class="mpresets scene-odm">
        ${[['estandar', 'Estándar', 'poses + mapa estable'], ['alta', 'Alta', 'detalle preferido'], ['extra', 'Extra', 'malla más densa'], ['ultra', 'Ultra', 'máximo ODM local']]
          .map(([k, n, d]) => `<div class="mpreset${k === 'alta' ? ' on' : ''}" data-scene-odm="${k}"><b>${n}</b><small>${d}</small></div>`).join('')}
      </div>
      <label class="proc-phase"><input type="checkbox" data-scene-splat checked>
        <span>${icon('spark')} <b>Entrenar Gaussian al terminar</b> con fallback explícito</span></label>
      <div class="mpresets scene-splat">
        ${[['medium', 'Medium'], ['cinematic', 'Cinemático'], ['ultra', 'Ultra']]
          .map(([k, n]) => `<div class="mpreset${k === 'cinematic' ? ' on' : ''}" data-scene-splat-preset="${k}"><b>${n}</b></div>`).join('')}
      </div>
      <button class="btn primary" data-scene-go style="width:100%;justify-content:center;margin-top:14px">Crear versión mejorada</button>`, 'scene-improve-modal');
    ov.querySelectorAll('.mpresets').forEach(group => group.addEventListener('click', e => {
      const pick = e.target.closest('.mpreset'); if (!pick) return;
      group.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === pick));
    }));
    ov.querySelectorAll('.scene-source input').forEach(input => input.addEventListener('change', e =>
      e.target.closest('.scene-source').classList.toggle('on', e.target.checked)));
    ov.addEventListener('click', async e => {
      const promote = e.target.closest('[data-scene-promote]');
      if (promote && scene) {
        const r = await api('/api/scene_promote', { scene_id: scene.id, version_id: promote.dataset.scenePromote });
        if (r.error) return alert(r.error);
        sys.scenes = (await (await fetch('/api/scenes')).json()).scenes || [];
        return close();
      }
      const go = e.target.closest('[data-scene-go]'); if (!go) return;
      const selectedSources = [...ov.querySelectorAll('.scene-source input:checked')].map(x => x.value);
      const selectedPhotos = [...ov.querySelectorAll('.scene-photos input:checked')].map(x => x.value);
      if (!selectedSources.length) return alert('Selecciona al menos un video con GPS.');
      go.disabled = true;
      try {
        if (!scene) {
          const anchor = origin ? { lon: origin[0], lat: origin[1] } : {};
          const created = await api('/api/scene_create', { title: titleFor(model), anchor,
            sources: currentSources, photos: currentPhotos, existing_version: model.clip_id });
          if (created.error) return alert(created.error);
          scene = created.scene;
        }
        const sameSources = [...selectedSources].sort().join('|') === [...currentSources].sort().join('|');
        const samePhotos = [...selectedPhotos].sort().join('|') === [...currentPhotos].sort().join('|');
        if (sameSources && samePhotos) {
          alert('La escena quedó versionada. Agrega otra captura o foto para crear una mejora nueva.');
          return close();
        }
        const r = await api('/api/scene_improve', {
          scene_id: scene.id, sources: selectedSources, photos: selectedPhotos,
          title: titleFor(model), preset: ov.querySelector('[data-scene-odm].on')?.dataset.sceneOdm || 'alta',
          then_splat: ov.querySelector('[data-scene-splat]')?.checked,
          splat_preset: ov.querySelector('[data-scene-splat-preset].on')?.dataset.sceneSplatPreset || 'cinematic',
          best_available: true,
        });
        if (r.error) return alert(r.error);
        close(); showTdMod('jobs'); document.querySelector('[data-job-filter="all"]')?.click();
      } finally { go.disabled = false; }
    });
  }
  document.getElementById('improve-scene')?.addEventListener('click', () => openImproveScene(cur));

  // ---------- ortofoto en MapLibre ----------
  let omap = null;
  let autoloadTimer = 0;
  function setProject(cid, opts = {}) {
    cur = models.find(m => m.clip_id === cid);
    if (!cur) return;
    if (!opts.keepTab) showTdMod('projects');   // keepTab: refrescar sin teletransportar de tab
    clearTimeout(autoloadTimer);                  // cancela auto-carga del proyecto anterior (#12)
    // invalida cargas mesh/cloud en vuelo del proyecto anterior (#1 currency guard)
    ['mesh-box', 'cloud-box'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b._loadToken = (b._loadToken || 0) + 1;
    });
    localStorage.setItem(PROJ_KEY, cid);
    document.getElementById('proj-view').style.display = '';
    if (opts.scroll) {
      requestAnimationFrame(() => document.getElementById('proj-view')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    document.querySelectorAll('.proj-card').forEach(c => c.classList.toggle('on', c.dataset.cid === cid));
    const base = `data/models/${cid}`;
    const q = cur.qa || {};
    const reproj = q.reprojection_error_px;
    const grade = reproj == null ? '—' : reproj < 1.5 ? 'excelente' : reproj < 2.5 ? 'buena' : 'aceptable';
    const sp = splatAssetFor(cid);
    const spFmt = (sp?.format || sp?.name.split('.').pop() || 'splat').toUpperCase();
    const meshOk = cur.mesh_ok !== false;
    const meshBtn = document.getElementById('load-mesh');
    const meshBox = document.getElementById('mesh-box');
    document.getElementById('mesh-q').textContent = meshOk ? 'lista' : 'no concluyente';
    document.getElementById('mesh-q').style.color = meshOk ? 'var(--mint)' : 'var(--amber)';
    if (meshBtn) meshBtn.style.display = meshOk ? '' : 'none';
    if (!meshOk && meshBox) {
      meshBox.innerHTML = `<p class="footer-note" style="margin:0;color:var(--amber)">
        ${icon('warn')} ODM produjo una malla débil para este vuelo. Usa la nube de puntos o el gaussian splat para inspección cercana.</p>`;
    }
    document.getElementById('dls').innerHTML = `
      ${q.status && q.status !== 'ok' ? `<p class="footer-note" style="margin:0 0 10px;color:var(--amber)">
        ${icon('warn')} Métricas de calidad ${q.status === 'parcial' ? 'parciales' : 'no disponibles'} para esta corrida
        — el modelo es usable, pero re-procesa para el reporte completo.</p>` : ''}
      ${q.cameras_reconstructed != null ? `<table class="kv" style="margin-bottom:12px">
        <tr><td>Cámaras reconstruidas</td><td>${q.cameras_reconstructed}${q.cameras_total ? ' / ' + q.cameras_total : ''}</td></tr>
        ${reproj != null ? `<tr><td>Error de reproyección</td><td>${reproj} px · <span style="color:${reproj < 1.5 ? 'var(--mint)' : 'var(--amber)'}">${grade}</span></td></tr>` : ''}
        ${q.gsd_cm_px != null ? `<tr><td>Resolución (GSD)</td><td>${q.gsd_cm_px} cm/px</td></tr>` : ''}
        ${q.area_m2 != null ? `<tr><td>Área cubierta</td><td>${q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(2) + ' ha' : Math.round(q.area_m2) + ' m²'}</td></tr>` : ''}
      </table>
      <details class="explain" style="margin-bottom:14px">
        <summary>Detalles técnicos</summary>
        <table class="kv">
          <tr><td>Puntos sparse</td><td>${(q.sparse_points || 0).toLocaleString()}</td></tr>
          <tr><td>Nube densa</td><td>${cur.cloud_bytes ? (cur.cloud_bytes / 1e6).toFixed(0) + ' MB · PLY' : '—'}</td></tr>
          <tr><td>Ortofoto fuente</td><td>${(cur.ortho_px || []).join(' × ')} px</td></tr>
          ${cur.dsm_min != null ? `<tr><td>Rango de elevación</td><td>${cur.dsm_min} – ${cur.dsm_max} m</td></tr>
          <tr><td>Curvas de nivel</td><td>cada ${cur.contour_interval} m</td></tr>` : ''}
          <tr><td>Texturas de malla</td><td>${cur.textures || 0}</td></tr>
          <tr><td>Malla</td><td>${meshOk ? 'usable' : 'débil'}${cur.mesh_stats ? ` · ${cur.mesh_stats.vertices || 0} vértices · ${cur.mesh_stats.faces || 0} caras` : ''}</td></tr>
          <tr><td>Borde fundido</td><td>${cur.ortho_feather_px || 0} px</td></tr>
          <tr><td>Datum</td><td>WGS84 · elipsoidal</td></tr>
        </table>
        <p class="footer-note" style="margin:8px 0 0">Sin GCPs: precisión relativa alta, absoluta
        ±GPS del dron (~2-5 m). Para grado topográfico certificable, importa puntos de control.</p>
      </details>` : ''}
      <div class="exp-grid">
        <a class="exp" href="${base}/ortho_full.jpg" target="_blank" rel="noopener">${icon('map')}<div><b>Ortofoto 5K</b><span>JPG · presentaciones</span></div></a>
        <a class="exp" href="${base}/${cur.ortho_asset || 'ortho.png'}" download>${icon('grid')}<div><b>Ortofoto transparente</b><span>WebP · overlays</span></div></a>
        ${cur.has_dsm ? `
        <a class="exp" href="${base}/dsm_4326.tif" download>${icon('mountain')}<div><b>DSM GeoTIFF</b><span>TIF · QGIS / GIS</span></div></a>
        <a class="exp" href="${base}/contours.geojson" download>${icon('route')}<div><b>Curvas de nivel</b><span>GeoJSON · CAD / GIS</span></div></a>
        <a class="exp" href="${base}/hillshade.png" download>${icon('sun')}<div><b>Relieve sombreado</b><span>PNG · mapas</span></div></a>
        <a class="exp" href="${base}/dsm_color.png" download>${icon('gauge')}<div><b>Elevación color</b><span>PNG · mapas</span></div></a>` : ''}
        <a class="exp" href="${base}/cloud.ply" download>${icon('layers')}<div><b>Nube de puntos</b><span>PLY · CloudCompare</span></div></a>
        ${cur.cloud_copc_asset ? `<a class="exp" href="${base}/${cur.cloud_copc_asset}" download>${icon('db')}<div><b>Nube optimizada</b><span>COPC · ${(cur.cloud_copc_bytes / 1e6).toFixed(0)} MB · GIS</span></div></a>` : ''}
        ${meshOk ? `<a class="exp" href="${base}/${cur.model_obj}" download>${icon('cube')}<div><b>Malla texturizada</b><span>OBJ · Blender / 3D</span></div></a>` : ''}
        ${sp ? `<a class="exp" href="${splatUrl(sp)}" download>${icon('spark')}<div><b>Gaussian splat</b><span>${spFmt} · SuperSplat</span></div></a>` : ''}
        <a class="exp" href="share.html?m=${encodeURIComponent(cid)}" target="_blank" rel="noopener">${icon('ext')}<div><b>Página pública</b><span>LINK · compartir</span></div></a>
      </div>`;
    if (omap) omap.remove();
    const b = new maplibregl.LngLatBounds();
    cur.corners.forEach(c => b.extend(c));
    omap = new maplibregl.Map({
      container: 'omap', style: SAT_STYLE, bounds: b,
      fitBoundsOptions: { padding: 40 }, attributionControl: { compact: true },
    });
    omap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    omap.on('load', () => {
      omap.addSource('ortho', { type: 'image', url: `${base}/${cur.ortho_asset || 'ortho.png'}`, coordinates: cur.corners });
      omap.addLayer({ id: 'ortho', type: 'raster', source: 'ortho',
                      paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 } });
      if (cur.dsm_corners) {
        omap.addSource('dsm', { type: 'image', url: `${base}/${cur.dsm_asset || 'dsm_color.png'}`, coordinates: cur.dsm_corners });
        omap.addLayer({ id: 'dsm', type: 'raster', source: 'dsm',
                        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } });
        omap.addSource('hills', { type: 'image', url: `${base}/${cur.hills_asset || 'hillshade.png'}`, coordinates: cur.dsm_corners });
        omap.addLayer({ id: 'hills', type: 'raster', source: 'hills',
                        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } });
      }
      // capa de dibujo para mediciones
      omap.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      omap.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw',
                      filter: ['==', '$type', 'Polygon'],
                      paint: { 'fill-color': '#45A0E6', 'fill-opacity': 0.18 } });
      omap.addLayer({ id: 'draw-line', type: 'line', source: 'draw',
                      paint: { 'line-color': '#45A0E6', 'line-width': 2.5, 'line-dasharray': [1.5, 1] } });
      omap.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw',
                      filter: ['==', '$type', 'Point'],
                      paint: { 'circle-radius': 4.5, 'circle-color': '#45A0E6',
                               'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      omap.on('click', onMapClick);
    });
    // recentrar: volver al encuadre del proyecto cuando te pierdes navegando
    document.querySelectorAll('#omap .map-recenter').forEach(x => x.remove());  // no acumular uno por setProject
    const rc = document.createElement('button');
    rc.className = 'map-recenter';
    rc.title = 'Recentrar en el proyecto';
    rc.innerHTML = icon('pin');
    rc.addEventListener('click', () => omap.fitBounds(b, { padding: 40 }));
    document.getElementById('omap').appendChild(rc);
    document.getElementById('op').oninput = e => {
      omap.getLayer('ortho') && omap.setPaintProperty('ortho', 'raster-opacity', +e.target.value / 100);
    };
    const spList = splatAssetsFor(cid);
    const spSel = document.getElementById('sp-select');
    const spMeta = splatAssetFor(cid);
    const spStatusFmt = (spMeta?.format || spMeta?.name.split('.').pop() || 'splat').toUpperCase();
    spSel.style.display = spList.length > 1 ? '' : 'none';
    spSel.innerHTML = spList.map(s => {
      const label = splatVersionLabel(s);
      return `<option value="${esc(splatKey(s))}"${spMeta && splatKey(s) === splatKey(spMeta) ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    document.getElementById('sp-status').textContent = spMeta
      ? `${spList.length} ${spList.length === 1 ? 'versión' : 'versiones'} · ${(spMeta.bytes / 1e6).toFixed(1)} MB · ${spStatusFmt}`
      : 'sin entrenar';
    document.getElementById('load-splat').style.display = spMeta ? '' : 'none';
    // estado PARCIAL visible: con un splat de ESTE clip en cola/entrenando, decía 'sin entrenar'
    fetch('/api/jobs').then(r => r.ok ? r.json() : null).then(d => {
      if (!d || !cur || cur.clip_id !== cid) return;   // cambió el proyecto mientras respondía
      const act = (d.jobs || []).find(x => x.kind === 'splat' && x.label === cid
        && ['running', 'queued'].includes(x.status));
      if (act) document.getElementById('sp-status').textContent =
        act.status === 'queued' ? 'splat en cola…' : `entrenando… ${Math.round((act.progress || 0) * 100)}%`;
    }).catch(() => {});
    // capas/herramientas que REQUIEREN DSM: deshabilitadas sin él (antes fallaban en silencio)
    [['data-layer', ['dsm', 'hills', 'contours']], ['data-tool', ['volume', 'profile']]].forEach(([attr, keys]) =>
      keys.forEach(k => {
        const el = document.querySelector(`[${attr}="${k}"]`);
        if (el) {
          el.disabled = !cur.has_dsm;
          el.title = cur.has_dsm ? '' : 'Requiere DSM — este proyecto se procesó sin él';
        }
      }));
    // MEDICIÓN y CAPAS no se heredan entre proyectos: el chip activo + puntos del sitio
    // anterior producían distancias/volúmenes ABSURDOS mezclando coordenadas de dos lugares,
    // y los chips de capa quedaban desincronizados del mapa nuevo (ortho@82, dsm oculto)
    tool = null; mpts = [];
    try { result(null); } catch {}
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('[data-layer]').forEach(x => x.classList.toggle('on', x.dataset.layer === 'ortho'));
    const opEl = document.getElementById('op');
    if (opEl) opEl.value = 82;
    const sbox = document.getElementById('splat-box');
    // dispose() del visor de splat es ASYNC y el vendored lanza NotFoundError (removeChild
    // sobre un rootElement anidado) → hay que silenciar el rechazo del promise, no basta try/catch
    sbox._loadToken = (sbox._loadToken || 0) + 1;   // invalida cualquier mount en vuelo (evita 2 viewers)
    if (sbox._splatDispose) { const d = sbox._splatDispose; sbox._splatDispose = null; sbox._viewer = null; try { d(); } catch {} }
    else if (sbox._viewer) { try { const p = sbox._viewer.dispose(); if (p?.catch) p.catch(() => {}); } catch {} sbox._viewer = null; }
    sbox._loading = false;
    sbox.innerHTML = `<p class="footer-note" style="margin:0" id="splat-note">${spMeta
      ? 'Splat entrenado y listo — elige versión y pulsa Cargar para el render foto-real.'
      : 'Este proyecto aún no tiene splat — entrénalo desde la pestaña <b>Procesamiento</b> → "Generar splat…".'}</p>`;
    const cloudMB = (cur.cloud_bytes || 0) / 1e6;
    resetViewer('cloud-box', `Nube de puntos${cloudMB ? ` · ${cloudMB.toFixed(0)} MB` : ''}`, 'load-cloud-main');
    // solo si la malla es usable: con mesh_ok=false el bloque de arriba (línea ~540) ya puso
    // "no concluyente" ámbar + aviso en mesh-box y OCULTÓ el botón — pisarlo aquí dejaba un
    // botón Cargar visible que no hacía nada y el aviso jamás se veía
    if (meshOk) {
      document.getElementById('mesh-q').textContent =
        { rapido: 'calidad rápida', alta: 'calidad alta' }[cur.preset] || 'calidad estándar';
      resetViewer('mesh-box', 'Modelo sólido con textura foto-real.', 'load-mesh');
    }
    // auto-carga la estrella — salvo nubes pesadas en móvil (datos + memoria)
    if (!(matchMedia('(max-width: 700px)').matches && cloudMB > 25))
      autoloadTimer = setTimeout(() => {
        const b = document.getElementById('load-cloud-main');
        if (b && b.style.display !== 'none') b.click();   // si ya lo clickearon (botón oculto), no duplicar la descarga
      }, 300);
  }
  // ---------- capas + mediciones ----------
  let tool = null, mpts = [];
  const R = 6371000, rad = Math.PI / 180;
  const hav = (a, b) => 2 * R * Math.asin(Math.sqrt(
    Math.sin((b[1] - a[1]) * rad / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2));
  function areaM2(pts) {                       // shoelace en metros locales
    const lat0 = pts[0][1] * rad;
    const xy = pts.map(p => [p[0] * rad * R * Math.cos(lat0), p[1] * rad * R]);
    let s = 0;
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s / 2);
  }
  document.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    const id = b.dataset.layer;
    const vis = b.classList.contains('on') ? 'visible' : 'none';
    if (id === 'contours' && vis === 'visible') ensureContours();
    omap.getLayer(id) && omap.setLayoutProperty(id, 'visibility', vis);
  }));
  function ensureContours() {
    if (!cur?.dsm_corners) return;
    if (!omap.loaded() && !omap.isStyleLoaded()) { omap.once('load', ensureContours); return; }  // click durante el ~1s de init lanzaba 'Style is not done loading'
    if (omap.getLayer('contours')) return;
    const base = `data/models/${cur.clip_id}`;
    omap.addSource('contours', { type: 'geojson', data: `${base}/contours.geojson` });
    // Curvas por color de altura (amarillo=alto, ámbar oscuro=bajo). Se cargan
    // sólo a demanda: algunos vuelos generan GeoJSON pesado y no debe frenar el mapa inicial.
    omap.addLayer({ id: 'contours', type: 'line', source: 'contours',
                    layout: { visibility: 'visible' },
                    paint: { 'line-width': 1.1, 'line-opacity': 0.9,
                             'line-color': ['interpolate', ['linear'], ['get', 'elev'],
                               (cur.dsm_min || 0), '#6b4a1f', (cur.dsm_max || 100), '#f2c14e'] } });
  }
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('on'));
    tool = tool === b.dataset.tool ? null : b.dataset.tool;
    if (tool) b.classList.add('on');
    const cmpSel = document.getElementById('cmp-date');
    if (tool === 'compare') {
      const cf = flights.find(x => x.clip_id === cur.clip_id);
      const bboxOverlap = (a, b) => a && b && !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
      const others = models.filter(m => {
        if (m.clip_id === cur.clip_id || m.has_dsm !== true) return false;
        return bboxOverlap(cf?.stats?.bbox || footprintFor(cur), footprintFor(m));
      });
      cmpSel.innerHTML = others.length ? others.map(m => {
        const f = flights.find(x => x.clip_id === m.clip_id);
        return `<option value="${m.clip_id}">vs ${f ? fmt.date(f.date) : m.clip_id}</option>`;
      }).join('') : '<option value="">— sin otra fecha con 3D que solape este sector —</option>';
      cmpSel.style.display = others.length ? '' : 'none';
      if (!others.length) result('Necesitas 2+ fechas procesadas en 3D del mismo sector. Procesa otro vuelo con "Procesar 3D".');
    } else { cmpSel.style.display = 'none'; }
    mpts = []; paintDraw();
    const noSecond = tool === 'compare' && document.getElementById('cmp-date').options.length && !document.getElementById('cmp-date').value;
    if (!noSecond) result(tool ? ({ dist: 'Toca puntos en el mapa para medir distancia.',
      area: 'Toca los vértices del área.', volume: 'Dibuja el polígono sobre el stockpile/edificio y toca "Calcular".',
      profile: 'Toca 2 puntos: inicio y fin del perfil.',
      compare: 'Dibuja el polígono del área a comparar entre las dos fechas y toca "Comparar".' })[tool] : null);
  }));
  document.getElementById('m-clear').addEventListener('click', () => {
    tool = null; mpts = []; paintDraw(); result(null);
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('on'));
  });
  function paintDraw() {
    if (!omap?.getSource('draw')) return;
    const feats = mpts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } }));
    if (mpts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mpts } });
    if (mpts.length > 2 && (tool === 'area' || tool === 'volume' || tool === 'compare'))
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...mpts, mpts[0]]] } });
    omap.getSource('draw').setData({ type: 'FeatureCollection', features: feats });
  }
  function result(html) {
    const el = document.getElementById('m-result');
    el.style.display = html ? 'block' : 'none';
    el.innerHTML = html || '';
  }
  function onMapClick(e) {
    if (!tool) return;
    mpts.push([e.lngLat.lng, e.lngLat.lat]);
    paintDraw();
    if (tool === 'dist' && mpts.length > 1) {
      let d = 0;
      for (let i = 1; i < mpts.length; i++) d += hav(mpts[i - 1], mpts[i]);
      result(`<b class="mono" style="font-size:16px;color:var(--accent)">${d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(1) + ' m'}</b>
        <span class="footer-note" style="margin:0 0 0 10px">distancia · ${mpts.length} puntos</span>`);
    }
    if (tool === 'area' && mpts.length > 2) {
      const a = areaM2(mpts);
      result(`<b class="mono" style="font-size:16px;color:var(--accent)">${a >= 10000 ? (a / 10000).toFixed(2) + ' ha' : Math.round(a).toLocaleString() + ' m²'}</b>
        <span class="footer-note" style="margin:0 0 0 10px">área · ${mpts.length} vértices</span>`);
    }
    if (tool === 'volume' && mpts.length > 2) {
      result(`<button class="btn primary" id="calc-vol">Calcular volumen (${mpts.length} vértices)</button>`);
      document.getElementById('calc-vol').onclick = async () => {
        result('Calculando contra el DSM…');
        const r = await api('/api/measure', { type: 'volume', clip_id: cur.clip_id, points: mpts });
        result(r.error ? `<span style="color:var(--red)">${esc(r.error)}</span>` : `
          <div class="statgrid" style="margin:0">
            <div class="stat"><div class="lb">Volumen (fill)</div><div class="v">${r.volume_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Corte (cut)</div><div class="v">${r.cut_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Área</div><div class="v">${Math.round(r.area_m2).toLocaleString()}<small> m²</small></div></div>
            <div class="stat"><div class="lb">Altura máx</div><div class="v">${r.max_height}<small> m</small></div></div>
          </div><p class="footer-note">Base: ${r.base_elev} m snm (percentil 5 del polígono). Método cut/fill estándar survey.</p>`);
      };
    }
    if (tool === 'compare' && mpts.length > 2) {
      result(`<button class="btn primary" id="calc-cmp">Comparar (${mpts.length} vértices)</button>`);
      document.getElementById('calc-cmp').onclick = async () => {
        const other = document.getElementById('cmp-date').value;
        if (!other) return result('Elige la fecha a comparar.');
        result('Comparando las dos fechas contra el DSM…');
        const r = await api('/api/compare', { clip_a: other, clip_b: cur.clip_id, points: mpts });
        if (r.error) return result(`<span style="color:var(--red)">${esc(r.error)}</span>`);
        const of = flights.find(x => x.clip_id === other);
        const sign = r.net_change_m3 >= 0 ? '+' : '';
        const color = r.net_change_m3 >= 0 ? 'var(--mint)' : 'var(--amber)';
        result(`
          <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Cambio desde ${of ? fmt.date(of.date) : 'fecha A'} → ${fmt.date(cur.dsm_date || (flights.find(x=>x.clip_id===cur.clip_id)||{}).date)}</div>
          <div class="statgrid" style="margin:0">
            <div class="stat"><div class="lb">Cambio neto</div><div class="v" style="color:${color}">${sign}${r.net_change_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Agregado</div><div class="v">${r.added_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Removido</div><div class="v">${r.removed_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Cambio medio</div><div class="v">${r.mean_change_m}<small> m</small></div></div>
          </div>
          <p class="footer-note">Positivo = material agregado (construcción/relleno). Subida máx ${r.max_rise_m}m · bajada máx ${r.max_drop_m}m · ${Math.round(r.area_m2).toLocaleString()} m² comparados.
          Co-registro automático: sesgo vertical de ${r.vertical_bias_corrected_m}m corregido (GPS sin GCPs) · incertidumbre ±${r.uncertainty_m}m — cambios menores a eso no son concluyentes.</p>`);
      };
    }
    if (tool === 'profile' && mpts.length === 2) {
      (async () => {
        result('Muestreando el DSM…');
        const r = await api('/api/measure', { type: 'profile', clip_id: cur.clip_id, points: mpts });
        if (r.error) return result(`<span style="color:var(--red)">${esc(r.error)}</span>`);
        const vals = r.profile.filter(v => v != null);
        if (!vals.length) return result('El perfil cae fuera del DSM — traza la línea dentro de la ortofoto.');
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const W = 600, H = 90;
        const pth = r.profile.map((v, i) =>
          v == null ? null : `${(i / (r.profile.length - 1)) * W},${H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 24)}`)
          .filter(Boolean).join(' ');
        result(`<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3)">
            <span>Perfil de elevación · ${r.distance_m} m</span><span class="mono">${lo.toFixed(1)}–${hi.toFixed(1)} m snm · Δ${(hi - lo).toFixed(1)} m</span></div>
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
            <polyline points="${pth} ${W},${H} 0,${H}" fill="#45A0E6" opacity="0.1"/>
            <polyline points="${pth}" fill="none" stroke="#45A0E6" stroke-width="1.6"/></svg>`);
        mpts = [];
      })();
    }
  }

  function resetViewer(boxId, msg, btnId) {
    const box = document.getElementById(boxId);
    // salir de FULLSCREEN antes de vaciar: el refresh borraba la barra con el botón de salir
    // y dejaba el box position:fixed inset:0 con scroll bloqueado = app "colgada" sin salida
    box.classList.remove('viewer-fs');
    document.body.style.overflow = '';
    box.innerHTML = `<p class="footer-note" style="margin:0">${msg}</p>`;
    const btn = document.getElementById(btnId);
    btn.style.display = '';
    btn.textContent = 'Cargar';                   // deshace el 'Reintentar' pegajoso de un fallo previo
  }

  // ---------- three.js viewers ----------
  function makeScene(box) {
    const w = box.clientWidth, h = box.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.localClippingEnabled = true;   // recorte de suelo/techo en la nube
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    box.innerHTML = '';
    box.appendChild(renderer.domElement);
    const scene = new THREE.Scene();  // fondo transparente → gradiente CSS del box
    const cam = new THREE.PerspectiveCamera(55, w / h, 0.1, 5000);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 1.35;
    // esquema GOOGLE MAPS/EARTH — arrastrar = MOVER el mapa (pan), rueda = zoom al cursor,
    // click-derecho o Ctrl/Shift+arrastrar = rotar/inclinar; táctil: 1 dedo = mover,
    // pellizco = zoom, 2 dedos girando = rotar. Antes arrastrar ORBITABA (default de
    // OrbitControls) — desorientador para cualquiera acostumbrado a mapas.
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.screenSpacePanning = false;   // el pan corre pegado al plano del suelo, como un mapa
    // render ON-DEMAND: dibuja al inicio y ~1.5s tras cada cambio (para captar decodes async
    // de textura), luego se duerme = 0 trabajo de GPU cuando la escena está quieta. wake()
    // lo despiertan interacción, resize, tier-swap y cambio de modo.
    let renderFrames = 90;
    const wake = () => { renderFrames = 90; };
    box._wake = wake;
    box._controls = controls;            // expuesto para QA/HUD (verificar mapping, mover cámara)
    controls.addEventListener('change', wake);
    const ro = new ResizeObserver(() => {
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H);
      cam.aspect = W / H; cam.updateProjectionMatrix();
      wake();
    });
    ro.observe(box);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(1, 2, 1.5);
    scene.add(dl);
    // doble-click / doble-toque = ENFOCAR ese punto (como Google Maps): rayo del cursor al
    // plano del suelo → mueve el target ahí y acerca ~la mitad, con animación suave.
    let fAnim = 0;
    const focusAt = (cx, cy) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      cam.updateMatrixWorld();   // el render-on-demand duerme: sin esto la matriz puede estar
                                 // stale y el rayo desproyectado sale hacia el horizonte
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, cam);
      const p = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y);
      if (!ray.ray.intersectPlane(plane, p)) return;
      if (p.distanceTo(controls.target) > (controls.maxDistance || 1e9)) return;  // rayo rasante → punto absurdo
      const d = cam.position.distanceTo(p);
      const toPos = p.clone().addScaledVector(cam.position.clone().sub(p).normalize(),
        Math.max(d * 0.45, (controls.minDistance || 0.003) * 3));
      const t0 = performance.now(), dur = 420;
      const sT = controls.target.clone(), sP = cam.position.clone();
      cancelAnimationFrame(fAnim);
      (function step() {
        const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - (1 - k) ** 3;
        controls.target.lerpVectors(sT, p, e);
        cam.position.lerpVectors(sP, toPos, e);
        controls.update(); wake();
        if (k < 1) fAnim = requestAnimationFrame(step);
      })();
    };
    renderer.domElement.addEventListener('dblclick', e => { e.preventDefault(); focusAt(e.clientX, e.clientY); });
    let lastTap = 0, lastTX = 0, lastTY = 0;                    // dblclick no dispara fiable en táctil
    renderer.domElement.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse') return;
      if (e.timeStamp - lastTap < 320 && Math.abs(e.clientX - lastTX) < 32 && Math.abs(e.clientY - lastTY) < 32) {
        lastTap = 0; focusAt(e.clientX, e.clientY);
      } else { lastTap = e.timeStamp; lastTX = e.clientX; lastTY = e.clientY; }
    });
    (function loop() {
      // teardown al reemplazar el visor: libera GEOMETRÍA + MATERIALES + TEXTURAS (no solo
      // el renderer) y suelta el contexto WebGL (dispose() no lo hace; el navegador capa ~16).
      if (!renderer.domElement.isConnected) {
        ro.disconnect();
        cancelAnimationFrame(fAnim);
        const freed = new Set();
        scene.traverse(o => {
          o.geometry?.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if (!m) return;
            if (m.map && !freed.has(m.map)) { freed.add(m.map); m.map.dispose(); }
            m.dispose();
          });
        });
        renderer.forceContextLoss(); renderer.dispose();
        return;
      }
      requestAnimationFrame(loop);
      if (controls.update()) renderFrames = Math.max(renderFrames, 2);   // damping activo
      if (renderFrames > 0) { renderer.render(scene, cam); renderFrames--; }
    })();
    return { scene, cam, controls, renderer };
  }
  function frameObject(obj, cam, controls) {
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    let maxDim = Math.max(sz.x, sz.y, sz.z);
    if (!isFinite(maxDim) || maxDim <= 0) maxDim = 1;          // geometría degenerada -> sin NaN
    obj.position.sub(c);                       // centra en el origen
    // distancia para que el objeto LLENE ~80% del viewport (fov-aware)
    const fov = cam.fov * Math.PI / 180;
    const dist = (maxDim / 2) / Math.tan(fov / 2) / 0.8;
    cam.position.set(dist * 0.12, dist * 0.78, dist * 0.22);  // casi cenital, pero más cerca
    cam.near = Math.max(maxDim / 20000, 0.00025); cam.far = dist * 8; cam.updateProjectionMatrix();   // ratio near/far acotado: /50000 daba z-fighting en malla (el splat no usa depth, la malla sí)
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 4;
    // una malla 2.5D no tiene "abajo": orbitar bajo el horizonte muestra el underside
    // (esquirlas de textura con huecos) y el zoom infinito atraviesa la geometría
    controls.maxPolarAngle = Math.PI * 0.42;   // ~75°: rasante en una malla 2.5D = bosque de faldones 'destrozado' (estándar Pix4D/DroneDeploy)
    controls.minDistance = Math.max(maxDim * 0.0025, 0.003);
    if ('zoomToCursor' in controls) controls.zoomToCursor = true;
    controls.update();
  }
  function fitSplatViewer(viewer) {
    const mesh = viewer?.splatMesh;
    const center = mesh?.calculatedSceneCenter || new THREE.Vector3();
    const radius = Math.max(mesh?.maxSplatDistanceFromSceneCenter || mesh?.visibleRegionRadius || 1, 0.5);
    const dist = radius * 1.15;                   // encuadre close-up por defecto
    const dir = new THREE.Vector3(0.2, 0.72, 0.66).normalize();
    viewer.camera.position.copy(center).addScaledVector(dir, dist);
    viewer.camera.near = Math.max(radius / 10000, 0.0005);
    viewer.camera.far = Math.max(radius * 80, dist * 8);
    viewer.camera.updateProjectionMatrix();
    if (viewer.controls) {
      viewer.controls.target.copy(center);
      viewer.controls.minDistance = Math.max(radius * 0.0025, 0.002);
      viewer.controls.maxDistance = radius * 18;
      if ('zoomToCursor' in viewer.controls) viewer.controls.zoomToCursor = true;
      viewer.controls.update();
    }
  }
  const spin = (box, label = 'Cargando…') => {
    box.innerHTML = `<div style="width:80%;text-align:center">
      <div class="sk" style="height:10px;border-radius:5px"></div>
      <p class="footer-note vload-status" style="margin:10px 0 0">${label}</p></div>`;
    return box.querySelector('.vload-status');
  };

  // fullscreen CSS (el Fullscreen API de iOS Safari sólo funciona en <video>)
  function attachViewerTools(box, cam, controls) {
    const bar = document.createElement('div');
    bar.className = 'viewer-tools';
    bar.innerHTML = `
      ${cam ? `<button data-vt="center" title="Centrar">${icon('pin')}</button>
      <button data-vt="zin" title="Acercar">${icon('zoomIn')}</button>
      <button data-vt="zout" title="Alejar">${icon('zoomOut')}</button>
      <button data-vt="rot" title="Auto-rotar">${icon('route')}</button>` : ''}
      <button data-vt="fs" title="Pantalla completa">${icon('ext')}</button>`;
    box.style.position = 'relative';
    box.appendChild(bar);
    const cam0 = cam ? cam.position.clone() : null;
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-vt]');
      if (!b) return;
      const wakeControls = () => { controls.update(); controls.dispatchEvent?.({ type: 'change' }); };
      const dolly = mult => {
        const dir = cam.position.clone().sub(controls.target);
        const d = dir.length();
        if (!Number.isFinite(d) || d <= 0) return;
        const nd = Math.max(controls.minDistance || 0.003, Math.min(controls.maxDistance || d * 4, d * mult));
        cam.position.copy(controls.target).addScaledVector(dir.normalize(), nd);
        wakeControls();
      };
      if (b.dataset.vt === 'center') { cam.position.copy(cam0); controls.target.set(0, 0, 0); wakeControls(); }
      if (b.dataset.vt === 'zin') dolly(0.35);
      if (b.dataset.vt === 'zout') dolly(1.55);
      if (b.dataset.vt === 'rot') {
        controls.autoRotate = !controls.autoRotate;
        controls.autoRotateSpeed = 1.1;
        b.classList.toggle('on', controls.autoRotate);
        wakeControls();
      }
      if (b.dataset.vt === 'fs') {
        const on = box.classList.toggle('viewer-fs');
        b.innerHTML = on ? icon('chevL') : icon('ext');
        document.body.style.overflow = on ? 'hidden' : '';
        // GaussianSplats3D dimensiona con window.resize (no ResizeObserver)
        window.dispatchEvent(new Event('resize'));
      }
    });
  }

  document.getElementById('load-mesh').addEventListener('click', async e => {
    if (!cur || cur.mesh_ok === false) return;
    const meshLoadBtn = e.currentTarget;
    meshLoadBtn.style.display = 'none';
    const box = document.getElementById('mesh-box');
    const stM = spin(box, 'Cargando malla texturizada…');
    const base = `data/models/${cur.clip_id}/model/`;
    try {
      await buildMeshViewer(box, base, cur, stM);
    } catch (err) {
      // sin esto: spinner infinito con el botón ya oculto = pantalla muda sin salida
      box.innerHTML = `<p class="footer-note" style="margin:0;color:var(--amber)">
        ${icon('warn')} No se pudo cargar la malla · ${esc(String(err?.message || err).slice(0, 80))}</p>`;
      meshLoadBtn.style.display = '';
      meshLoadBtn.textContent = 'Reintentar';
    }
  });

  // visor de malla con SWITCH de calidad (bajo=1024/256MB · alto=2048/1024MB) y render
  // (foto/relieve). El default en móvil es "bajo" para no evictar texturas (Safari/iPhone
  // se queda negro con 4096²). Cambiar calidad NO re-descarga el OBJ: solo swapea texturas.
  // 4 tiers de calidad. pr = techo de pixelRatio (supersampling: renderiza interno a Nx
  // y baja = antialiasing por fuerza bruta, gratis en el GPU Metal del M4). extra/ultra
  // son desktop-only (Safari/iPhone evictan >~1GB → pantalla negra). ultra = geo.mtl 4096.
  const TIERS = {
    bajo:  { mtl: 'odm_textured_model_viewer_low.mtl',   pr: 1.5, label: 'Rápido' },
    alto:  { mtl: 'odm_textured_model_viewer.mtl',       pr: 2,   label: 'HD' },
    extra: { mtl: 'odm_textured_model_viewer_extra.mtl', pr: 2,   label: 'Extra', hires: true },
    ultra: { mtl: 'odm_textured_model_geo.mtl',          pr: 3,   label: 'Ultra', hires: true },
  };
  // gate de hardware: coarse pointer (móvil/tablet) o pantalla chica → sin extra/ultra
  const HIRES_OK = !matchMedia('(pointer: coarse)').matches && window.innerWidth >= 900;
  // extra/ultra SUPERSAMPLEAN por encima del nativo (renderiza +px y baja = SSAA, barato en
  // el GPU del M4); bajo/alto no exceden el nativo para no malgastar en equipos flojos.
  const prFor = tier => {
    const dpr = devicePixelRatio || 1;
    if (tier === 'ultra') return Math.min(2.5, dpr + 0.75);   // SSAA capado (pr3+MSAA = framebuffer enorme, redundante) (#11)
    if (tier === 'extra') return Math.min(2.25, dpr + 0.4);
    return Math.min(dpr, TIERS[tier].pr);
  };
  // carga directa del .mtl del tier (sin HEAD: evita TOCTOU + ahorra un request). fallback=true
  // SOLO en la carga inicial y jamás cae al geo.mtl 4096 para 'bajo' (rompería el propósito).
  async function tierMaterials(base, tier, fallback = false) {
    let mc;
    try {
      mc = await new MTLLoader().setPath(base).loadAsync(TIERS[tier].mtl);
    } catch (e) {
      if (!fallback || tier === 'bajo') throw e;      // switchTier / móvil: no degradar a 4096
      mc = await new MTLLoader().setPath(base).loadAsync('odm_textured_model_geo.mtl');
    }
    mc.preload();
    return mc;
  }
  async function buildMeshViewer(box, base, model, stM) {
    const myLoad = box._loadToken;                 // token de currency: si cambia de proyecto, aborta
    let curTier = matchMedia('(max-width: 820px), (pointer: coarse)').matches ? 'bajo' : 'alto';
    const mc0 = await tierMaterials(base, curTier, true);
    if (box._loadToken !== myLoad) return;         // el usuario cambió de proyecto durante la carga
    const meshFile = (model.model_viewer || model.model_obj || 'model/odm_textured_model_geo.obj').split('/').pop();
    const obj = await new OBJLoader().setMaterials(mc0).setPath(base).loadAsync(meshFile,
      ev => { if (ev.loaded) stM.textContent = `Malla · ${(ev.loaded / 1e6).toFixed(0)} MB descargados`; });
    if (box._loadToken !== myLoad) return;         // no montar la malla del proyecto viejo en el box nuevo
    const { scene, cam, controls, renderer } = makeScene(box);
    renderer.setPixelRatio(prFor(curTier));                    // supersampling del tier inicial
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    // por cada submalla guardo su NOMBRE de material (idéntico entre tiers) + los
    // materiales Foto (unlit) y Relieve (con luces) para intercambiar sin reparsear.
    const swatches = [];
    obj.traverse(n => {
      if (!n.isMesh) return;
      // normales NO se computan aquí: solo 'Relieve' (Lambert, con luz) las usa; el default
      // 'Foto' (Basic, unlit) no. Se calculan perezosamente al primer switch a Relieve (#18)
      const src = Array.isArray(n.material) ? n.material : [n.material];
      src.forEach(m => { if (m.map) { m.map.anisotropy = maxAniso; m.map.needsUpdate = true; } });
      const mk = C => src.map(m => new C({ map: m.map || null, color: m.map ? 0xffffff : 0x8a97a8, side: THREE.DoubleSide }));
      swatches.push({ mesh: n, names: src.map(m => m.name), foto: mk(THREE.MeshBasicMaterial), relieve: mk(THREE.MeshLambertMaterial) });
      n.material = swatches[swatches.length - 1].foto.length === 1 ? swatches[swatches.length - 1].foto[0] : swatches[swatches.length - 1].foto;
    });
    let renderMode = 'foto', normalsReady = false;
    const applyMode = () => {
      if (renderMode === 'relieve' && !normalsReady) {       // computa normales una sola vez, al pedirse
        normalsReady = true;
        swatches.forEach(s => s.mesh.geometry.computeVertexNormals());
      }
      swatches.forEach(s => { s.mesh.material = s[renderMode].length === 1 ? s[renderMode][0] : s[renderMode]; });
      box._wake?.();
    };
    async function switchTier(tier) {
      if (tier === curTier) return false;
      let mc;
      try { mc = await tierMaterials(base, tier); }
      catch { return false; }                                 // deja el tier actual intacto
      const freed = new Set();
      swatches.forEach(s => s.names.forEach((nm, i) => {
        const newMap = mc.materials[nm]?.map;
        if (!newMap) return;                                  // tier sin este material: conserva el actual
        newMap.anisotropy = maxAniso;
        const old = s.foto[i].map;                            // foto y relieve comparten el mismo Texture
        s.foto[i].map = s.relieve[i].map = newMap;
        s.foto[i].needsUpdate = s.relieve[i].needsUpdate = true;
        if (old && old !== newMap && !freed.has(old)) { freed.add(old); old.dispose(); }  // una vez
      }));
      renderer.setPixelRatio(prFor(tier));                    // supersampling por tier (Metal)
      curTier = tier;
      box._wake?.();                                          // redibuja con las texturas nuevas
      setTimeout(() => box._wake?.(), 900);                   // re-arma: el upload GPU de un tier grande puede exceder 1.5s (#7)
      return true;
    }
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    frameObject(obj, cam, controls);
    attachViewerTools(box, cam, controls);
    const mhud = document.createElement('div');
    mhud.className = 'viewer-hud';
    const tierBtns = Object.entries(TIERS)
      .filter(([, t]) => !t.hires || HIRES_OK)
      .map(([k, t]) => `<button class="chip${k === curTier ? ' on' : ''}" data-mq="${k}">${t.label}</button>`).join('');
    mhud.innerHTML = `<label>Render <button class="chip on" data-mr="foto">Foto</button>
      <button class="chip" data-mr="relieve">Relieve</button></label>
      <label style="margin-left:10px">Calidad ${tierBtns}</label>`;
    box.appendChild(mhud);
    mhud.addEventListener('click', async ev => {
      const mr = ev.target.closest('[data-mr]'), mq = ev.target.closest('[data-mq]');
      if (mr) {
        mhud.querySelectorAll('[data-mr]').forEach(c => c.classList.toggle('on', c === mr));
        renderMode = mr.dataset.mr; applyMode();
      } else if (mq && !mq.classList.contains('on')) {
        const btns = [...mhud.querySelectorAll('[data-mq]')];
        btns.forEach(b => b.disabled = true);                 // congela TODO el switch en vuelo
        const prevTxt = mq.textContent; mq.textContent = '…';
        const ok = await switchTier(mq.dataset.mq);
        mq.textContent = prevTxt; btns.forEach(b => b.disabled = false);
        if (ok) btns.forEach(c => c.classList.toggle('on', c === mq));
      }
    });
  }

  document.getElementById('load-cloud-main').addEventListener('click', async e => {
    if (!cur) return;
    e.currentTarget.style.display = 'none';
    const box = document.getElementById('cloud-box');
    const myLoad = box._loadToken;                 // currency: bail si cambia de proyecto (#1)
    const cloudBtn = e.currentTarget;
    const stC = spin(box, 'Descargando nube de puntos…');
    let geo;
    try {
      geo = await new PLYLoader().loadAsync(`data/models/${cur.clip_id}/cloud.ply`,
        ev => { stC.textContent = ev.total ? `Nube · ${Math.round(ev.loaded / ev.total * 100)}%`
                                           : `Nube · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
    } catch (err) {
      // 404/red caída: sin esto el skeleton giraba para siempre (y el autoload lo dispara solo)
      if (box._loadToken !== myLoad) return;
      box.innerHTML = `<p class="footer-note" style="margin:0;color:var(--amber)">
        ${icon('warn')} No se pudo cargar la nube · ${esc(String(err?.message || err).slice(0, 80))}</p>`;
      cloudBtn.style.display = '';
      cloudBtn.textContent = 'Reintentar';
      return;
    }
    if (box._loadToken !== myLoad) { geo.dispose(); return; }   // proyecto cambió durante la descarga
    const mat = new THREE.PointsMaterial({ size: 0.18, sizeAttenuation: true, vertexColors: geo.hasAttribute('color') });
    const pts = new THREE.Points(geo, mat);
    const { scene, cam, controls } = makeScene(box);
    pts.rotation.x = -Math.PI / 2;
    scene.add(pts);
    frameObject(pts, cam, controls);
    attachViewerTools(box, cam, controls);
    // suite de limpieza en vivo: tamaño de punto + recorte por altura (quita
    // ruido bajo el suelo y floaters del cielo sin re-procesar nada)
    const bb = new THREE.Box3().setFromObject(pts);
    const yLo = new THREE.Plane(new THREE.Vector3(0, 1, 0), -bb.min.y);
    const yHi = new THREE.Plane(new THREE.Vector3(0, -1, 0), bb.max.y);
    mat.clippingPlanes = [yLo, yHi];
    const span = bb.max.y - bb.min.y;
    const hud = document.createElement('div');
    hud.className = 'viewer-hud';
    hud.innerHTML = `
      <label>Puntos <input type="range" data-h="size" min="4" max="60" value="18"></label>
      <label>Suelo <input type="range" data-h="lo" min="0" max="100" value="0"></label>
      <label>Techo <input type="range" data-h="hi" min="0" max="100" value="100"></label>
      <label>Color <button class="chip on" data-cm="rgb">Real</button>
        <button class="chip" data-cm="alt">Altura</button>
        <button class="chip" data-cm="term">Térmico</button>
        <button class="chip" data-cm="gris">Gris</button></label>`;
    box.appendChild(hud);
    hud.addEventListener('input', ev => {
      const v = +ev.target.value;
      if (ev.target.dataset.h === 'size') mat.size = v / 100;
      if (ev.target.dataset.h === 'lo') yLo.constant = -(bb.min.y + span * v / 100);
      if (ev.target.dataset.h === 'hi') yHi.constant = bb.min.y + span * v / 100;
      box._wake?.();                                          // on-demand: redibuja el cambio (#6)
    });
    // modos de color: RGB real o rampas por altura (elevación / térmico / gris)
    const RAMPS = {
      alt: [[38, 84, 124], [82, 155, 104], [222, 190, 88], [194, 82, 60]],   // paleta DSM
      term: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],  // plasma
      gris: [[28, 30, 34], [120, 124, 130], [236, 239, 243]],
    };
    const colAttr = geo.getAttribute('color');
    const origCol = colAttr ? colAttr.array.slice() : null;
    hud.addEventListener('click', ev => {
      const bt = ev.target.closest('[data-cm]');
      if (!bt) return;
      hud.querySelectorAll('[data-cm]').forEach(c => c.classList.toggle('on', c === bt));
      let arr = geo.getAttribute('color');
      if (bt.dataset.cm === 'rgb') {
        if (arr && origCol) { arr.array.set(origCol); arr.needsUpdate = true; }
        box._wake?.();
        return;
      }
      const pos = geo.getAttribute('position');
      const n = pos.count;
      if (!arr) {
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        arr = geo.getAttribute('color');
        mat.vertexColors = true;
        mat.needsUpdate = true;
      }
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { const z = pos.getZ(i); if (z < lo) lo = z; if (z > hi) hi = z; }
      const mx = arr.array instanceof Uint8Array ? 255 : 1;   // PLY trae uint8 normalizado
      const R = RAMPS[bt.dataset.cm];
      const segs = R.length - 1;
      for (let i = 0; i < n; i++) {
        const t = Math.min(segs - 0.001, ((pos.getZ(i) - lo) / (hi - lo || 1)) * segs);
        const k = Math.floor(t), f = t - k;
        arr.setXYZ(i,
          (R[k][0] + (R[k + 1][0] - R[k][0]) * f) / 255 * mx,
          (R[k][1] + (R[k + 1][1] - R[k][1]) * f) / 255 * mx,
          (R[k][2] + (R[k + 1][2] - R[k][2]) * f) / 255 * mx);
      }
      arr.needsUpdate = true;
      box._wake?.();                                          // redibuja el nuevo color (#6/#17)
    });
  });

  // splats: gestión rica (calidad/gaussianas/cámaras) + ver inline + compartir + borrar + generar
  const gfmt = n => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
    : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  const qOf = loss => loss == null ? null       // umbrales de loss L1 de OpenSplat en escala 0-1
    : loss <= 0.05 ? { c: 'exc', t: 'Excelente' }
      : loss <= 0.09 ? { c: 'good', t: 'Buena' }
        : loss <= 0.15 ? { c: 'mid', t: 'Media' }
          : { c: 'low', t: 'Básica' };
  function renderSplatList() {                  // función (no bloque one-shot): el hook onDone la re-invoca
  const splats = (sys.splats || []).filter(s => SPLAT_EXT.test(s.name));
  document.getElementById('splats').innerHTML = splats.length ? splats.map(s => {
    const scid = s.clip_id || s.name.replace(SPLAT_EXT, '');
    const sf = flights.find(x => x.clip_id === scid);
    const sm = models.find(x => x.clip_id === scid);
    const sFmt = (s.format || s.name.split('.').pop()).toLowerCase();
    const baseTitle = (sm && sm.title) || (sf && (sf.label || fmt.date(sf.date) + ' · ' + sf.time)) || scid.slice(-11);
    const version = s.current ? 'Actual' : (s.archived_at || 'Historial');
    const hasModel = models.some(m => m.clip_id === scid);
    const q = qOf(s.loss);
    // preset+iters NO van aquí: ya viven en la línea si-version (evita duplicar en cada tarjeta)
    const stats = [
      s.gaussians ? `<span title="Gaussianas">${icon('spark')}${gfmt(s.gaussians)}</span>` : '',
      s.cameras ? `<span title="Fotos / cámaras usadas">${icon('film')}${s.cameras}</span>` : '',
      s.backend ? `<span title="Backend de entrenamiento">${icon('cpu')}${esc(s.backend)}</span>` : '',
      s.duration_s ? `<span title="Tiempo de entrenamiento">${icon('clock')}${fmtRun(s.duration_s)}</span>` : '',
      s.loss != null ? `<span title="Loss final">loss ${s.loss}</span>` : '',
      `<span title="Tamaño del archivo">${icon('db')}${(s.bytes / 1e6).toFixed(1)} MB</span>`,
      `<span title="Formato">.${sFmt}</span>`,
    ].filter(Boolean).join('');
    return `
    <div class="splat-item" data-cid="${esc(scid)}">
      <div class="si-main">
        <div class="si-hd"><b>${esc(baseTitle)}</b>${q ? `<span class="si-q q-${q.c}" title="loss ${s.loss}">${q.t}</span>` : ''}</div>
        <div class="si-version">${esc(version)}${s.preset_label || s.preset ? ` · ${esc(s.preset_label || s.preset)}` : ''}${s.iters ? ` · ${s.iters >= 1000 ? (s.iters / 1000) + 'k' : s.iters} iters` : ''}</div>
        <div class="si-stats mono">${stats}</div>
      </div>
      <div class="si-acts">
        <button class="btn primary" data-cid="${esc(scid)}" data-view="${esc(splatKey(s))}"${hasModel ? '' : ' disabled title="Sin proyecto 3D publicado"'} style="padding:5px 16px">Ver</button>
        <a class="btn" href="${splatUrl(s)}" download title="Descargar .${sFmt}">${icon('dl')}</a>
        <a class="btn" target="_blank" rel="noopener" title="Editar en SuperSplat (limpiar floaters, recortar, exportar)"
           href="/supersplat/?load=${encodeURIComponent('/' + splatUrl(s))}&filename=${encodeURIComponent(s.name)}">${icon('broom')}</a>
        ${hasModel ? `<button class="btn" data-share="${esc(scid)}" data-splat="${esc(splatKey(s))}" title="Copiar link público de esta versión">${icon('ext')}</button>` : ''}
        <button class="btn danger" data-del="${esc(scid)}" data-title="${esc(baseTitle)}" title="Borrar todos los splats de este proyecto (a la papelera)">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('') :
    `<p class="footer-note">Sin splats aún — "Generar splat…" entrena uno sobre las poses
    del proyecto que elijas. El resultado se ve aquí mismo.</p>`;
  }
  renderSplatList();
  document.getElementById('btn-splat').addEventListener('click', () => {
    if (!flights.length) return alert('No hay vuelos en el vault.');
    const modelIds = new Set(models.map(m => m.clip_id));
    const modelChoices = models.map((m, i) => ({ kind: 'model', m, f: flights.find(x => x.clip_id === m.clip_id), i }));
    const videoChoices = flights
      // mismo filtro que `candidates` del 3D: sin SRT/bbox el geotag de odm_prep muere a
      // los minutos — no ofrecer videos que garantizan un job fallido
      .filter(f => !modelIds.has(f.clip_id) && f.has_srt && f.stats?.bbox && !f.archived)
      .slice(-18)
      .reverse()
      .map((f, i) => ({ kind: 'video', f, i }));
    const choices = modelChoices.concat(videoChoices);
    const Q = [
      { p: 'medium', n: 'Medium', t: '~4-12 min MPS', d: 'Default estable para inspección fina' },
      { p: 'cinematic', n: 'Cinemático', t: '~45-75 min MPS', d: 'Nítido, para compartir' },
      { p: 'ultra', n: 'Ultra', t: '~2-4 h MPS', d: 'Máximo detalle local' },
    ];
    const { ov, close } = openModal(`${icon('spark')} Generar gaussian splat`, `
      <p class="footer-note" style="margin:0 0 12px">Entrena un archivo <b>.splat</b> nuevo con las
      fotos y poses del proyecto elegido — <b>no modifica</b> la nube ni la malla. Al terminar
      aparece en la lista, en el visor y en la página pública.</p>
      <p class="mlb">Base de captura</p>
      <div class="mflights">${choices.map((c, i) => {
        const m = c.m, f = c.f;
        const cid = (m || f).clip_id;
        const active = cur ? cid === cur.clip_id : i === 0;
        const img = m ? `data/models/${esc(cid)}/${esc(m.ortho_asset || 'ortho.jpg')}` : `data/thumbs/${esc(cid)}.jpg`;
        const title = m ? titleFor(m) : `${fmt.date(f.date)} · ${f.time}`;
        return `
        <div class="mflight${active ? ' on' : ''}" data-cid="${esc(cid)}" data-auto-model="${m ? '0' : '1'}">
          <img src="${img}" loading="lazy" alt="">
          <div class="mf-t"><b>${esc(title)}</b>
          <span class="mono">${m ? `${m.qa?.cameras_reconstructed || '?'} cámaras` : 'video → ODM base → splat'}</span></div>
        </div>`; }).join('')}</div>
      <p class="mlb">Modelo base si partes de video</p>
      <div class="mpresets">
        <div class="mpreset on" data-model-preset="estandar"><b>Estándar</b><span class="mono">poses fiables</span><small>Más rápido para crear la base</small></div>
        <div class="mpreset" data-model-preset="alta"><b>Alta</b><span class="mono">más detalle</span><small>Mejor base, tarda más</small></div>
      </div>
      <div id="ms-score"></div>
      <p class="mlb">Calidad del entrenamiento</p>
      <div class="mpresets splat-presets">${Q.map(q => `
        <div class="mpreset${q.p === 'medium' ? ' on' : ''}" data-preset="${q.p}">
          <b>${q.n}</b><span class="mono">${q.t}</span><small>${q.d}</small></div>`).join('')}</div>
      <button class="btn primary" id="m-go" style="width:100%;justify-content:center;margin-top:16px;padding:10px 0">${icon('spark')} Entrenar splat</button>`);
    const msScore = ov.querySelector('#ms-score');
    renderScanCard(msScore, (ov.querySelector('.mflight.on') || ov.querySelector('.mflight'))?.dataset.cid);
    ov.querySelector('.mflights').addEventListener('click', e => {
      const c = e.target.closest('.mflight');
      if (!c) return;
      ov.querySelectorAll('.mflight').forEach(x => x.classList.toggle('on', x === c));
      renderScanCard(msScore, c.dataset.cid);      // el escáner sigue a la selección
    });
    ov.querySelectorAll('.mpresets').forEach(group => group.addEventListener('click', e => {
      const c = e.target.closest('.mpreset');
      if (!c) return;
      group.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
    }));
    ov.querySelector('#m-go').addEventListener('click', async e2 => {
      const btn = e2.currentTarget;
      btn.disabled = true;
      try {
        const base = ov.querySelector('.mflight.on');
        const r = await api('/api/splat', {
          clip_id: base?.dataset.cid,
          auto_model: base?.dataset.autoModel === '1',
          model_preset: ov.querySelector('[data-model-preset].on')?.dataset.modelPreset || 'estandar',
          preset: ov.querySelector('.splat-presets .mpreset.on')?.dataset.preset || 'medium',
          best_available: true,
        });
        if (r.error) return alert(r.error);
        close();
        showTdMod('jobs');                          // feedback inmediato del encolado
        document.querySelector('[data-job-filter="all"]')?.click();
      } finally { btn.disabled = false; }
    });
  });
  document.getElementById('splats').addEventListener('click', async e => {
    const viewBtn = e.target.closest('[data-view]');
    const shareBtn = e.target.closest('[data-share]');
    const delBtn = e.target.closest('[data-del]');
    if (viewBtn && !viewBtn.disabled) {
      const scid = viewBtn.dataset.cid || viewBtn.dataset.view.replace(SPLAT_EXT, '');
      if (!models.some(m => m.clip_id === scid)) return alert('Este splat no tiene proyecto 3D publicado.');
      selectedSplatByClip[scid] = viewBtn.dataset.view;
      saveSplatChoice();
      setProject(scid);
      document.getElementById('load-splat').click();
      setTimeout(() => document.getElementById('splat-box').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    } else if (shareBtn) {
      const url = `${location.origin}/share.html?m=${encodeURIComponent(shareBtn.dataset.share)}${shareBtn.dataset.splat ? `&s=${encodeURIComponent(shareBtn.dataset.splat)}` : ''}`;
      try { await navigator.clipboard.writeText(url); shareBtn.innerHTML = icon('check'); setTimeout(() => { shareBtn.innerHTML = icon('ext'); }, 1300); }
      catch { prompt('Link público (cópialo):', url); }
    } else if (delBtn) {
      const scid = delBtn.dataset.del, title = delBtn.dataset.title || scid;
      if (!confirm(`¿Borrar el splat "${title}"?\n\nVa a la papelera (reversible). El modelo 3D, la nube y el video NO se tocan.`)) return;
      delBtn.disabled = true;
      let r;
      try {
        r = await api('/api/splat_delete', { clip_id: scid });
      } catch (err) {
        delBtn.disabled = false;                    // login cancelado / red: el botón no queda muerto
        return alert(String(err?.message || err));
      }
      if (r.error) { delBtn.disabled = false; return alert(r.error); }
      // saca el splat del estado del cliente: si no, splatAssetFor lo sigue viendo y RESUCITA
      // (botón "Cargar" reaparece, apunta a un archivo ya en la papelera → 404) al reabrir el proyecto
      if (sys.splats) sys.splats = sys.splats.filter(s => (s.clip_id || s.name.replace(SPLAT_EXT, '')) !== scid);
      const box = document.getElementById('splat-box');
      if (box && box._pcid === scid && box._splatDispose) { try { box._splatDispose(); } catch {} box._splatDispose = null; box._viewer = null; box._pcid = null; }
      // si el proyecto borrado está abierto, refresca su panel de splat (oculta "Cargar")
      // sin sacarte del tab donde estabas (keepTab)
      if (cur && cur.clip_id === scid) setProject(scid, { keepTab: true });
      // el server borra TODAS las versiones del clip: fuera TODAS sus tarjetas, no solo la
      // clickeada (las hermanas quedaban con Descargar/Editar apuntando a la papelera → 404)
      renderSplatList();                          // re-render completo: quita TODAS las versiones y deja empty-state si era el último
      renderCards();   // la proj-card mostraba 'N splats' — refléjalo sin recargar
    }
  });

  document.getElementById('sp-select').addEventListener('change', e => {
    if (!cur) return;
    selectedSplatByClip[cur.clip_id] = e.target.value;
    saveSplatChoice();
    const box = document.getElementById('splat-box');
    if (box._splatDispose) { try { box._splatDispose(); } catch {} box._splatDispose = null; box._viewer = null; }
    box._loadToken = (box._loadToken || 0) + 1;
    box._loading = false;   // sin esto, cambiar de versión a media descarga deja "Cargar" muerto
                            // (el mount invalidado retorna sin resetear el guard de re-entrada)
    const spMeta = splatAssetFor(cur.clip_id);
    const fmtS = (spMeta?.format || spMeta?.name.split('.').pop() || 'splat').toUpperCase();
    document.getElementById('sp-status').textContent = spMeta
      ? `${splatAssetsFor(cur.clip_id).length} ${splatAssetsFor(cur.clip_id).length === 1 ? 'versión' : 'versiones'} · ${(spMeta.bytes / 1e6).toFixed(1)} MB · ${fmtS}`
      : 'sin entrenar';
    box.innerHTML = `<p class="footer-note" style="margin:0">Versión seleccionada — pulsa Cargar para verla.</p>`;
  });

  document.getElementById('load-splat').addEventListener('click', async () => {
    if (!cur) return;
    const asset = splatAssetFor(cur.clip_id);
    if (!asset) return;
    const name = splatKey(asset);
    const box = document.getElementById('splat-box');
    if (box._loading) return;                     // re-entrada: un solo load a la vez (#3)
    box._loading = true;
    const myToken = (box._loadToken = (box._loadToken || 0) + 1);   // currency: gana el último
    // visor anterior fuera ANTES de crear otro (dispose premium del módulo si lo hay)
    if (box._splatDispose) { const d = box._splatDispose; box._splatDispose = null; box._viewer = null; try { d(); } catch {} }
    else if (box._viewer) { const v = box._viewer; box._viewer = null; try { const p = v.dispose(); if (p?.catch) p.catch(() => {}); } catch {} }
    box.style.position = 'relative';
    box.innerHTML = `<div class="splat-load"><div class="sk" style="height:10px;border-radius:5px"></div>
      <p class="footer-note splat-st" style="margin:10px 0 0">Descargando splat…</p></div>`;
    const st = box.querySelector('.splat-st');
    let handle;
    try {
      handle = await mountSplatViewer(box, splatUrl(asset),
        { bytes: asset.bytes, onStatus: t => { if (st) st.textContent = t; } });
    } catch (err) {
      if (box._loadToken === myToken) {
        box._loading = false;
        const el = box.querySelector('.splat-load');
        if (el) el.innerHTML = `<p class="footer-note">No se pudo cargar ${esc(name)} · ${esc(String(err && err.message || err).slice(0, 90))}</p>`;
      }
      return;
    }
    // otro load (o un setProject) arrancó mientras descargábamos → este visor es obsoleto: tíralo
    if (box._loadToken !== myToken) { try { handle.dispose(); } catch {} return; }
    box._loading = false;
    box._viewer = handle.viewer;
    box._splatDispose = handle.dispose;           // dispose premium (HUD + listeners + viewer)
    box._pcid = cur.clip_id;                       // qué clip está en pantalla (para borrar en vivo)
    box.querySelector('.splat-load')?.remove();
  });

  // sin auto-abrir: solo se restaura una selección previa del usuario
  renderCards();
  const saved = localStorage.getItem(PROJ_KEY);
  if (saved && models.some(m => m.clip_id === saved)) setProject(saved);
