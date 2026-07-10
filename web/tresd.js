  import * as THREE from '/vendor/three.module.js';
  import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';
  import { OBJLoader } from '/vendor/three-addons/loaders/OBJLoader.js';
  import { MTLLoader } from '/vendor/three-addons/loaders/MTLLoader.js';
  import { PLYLoader } from '/vendor/three-addons/loaders/PLYLoader.js';
  import { mountSplatViewer } from '/splatview.js';

  const SPLAT_EXT = /\.(ksplat|splat|ply)$/i;
  const SPLAT_RANK = { ksplat: 0, splat: 1, ply: 2 };
  const splatKey = s => s.path || s.name;
  const splatUrl = s => 'data/splats/' + splatKey(s).split('/').map(encodeURIComponent).join('/');
  function splatAssetsFor(clipId) {
    return (sys.splats || [])
      .filter(s => SPLAT_EXT.test(s.name) && s.name.replace(SPLAT_EXT, '') === clipId)
      .concat((sys.splats || []).filter(s => SPLAT_EXT.test(s.name) && s.clip_id === clipId
        && s.name.replace(SPLAT_EXT, '') !== clipId))
      .sort((a, b) => (b.iters || 0) - (a.iters || 0)
        || (b.current ? 1 : 0) - (a.current ? 1 : 0)
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
    <div class="td-pipeline-grid">
      <article class="td-pipe-card">
        <div class="td-pipe-top">${icon('map')}<span>ODM / Ortofoto</span><b>Base survey</b></div>
        <p>Extrae frames, geoetiqueta con SRT, reconstruye cámaras, DSM/DTM, ortofoto feathered y nube densa.</p>
        <div class="td-pipe-steps"><span>Frames</span><span>OpenSfM</span><span>DSM</span><span>Publicar</span></div>
        <button class="btn primary" data-open-run3d>${icon('cube')} Configurar ODM</button>
      </article>
      <article class="td-pipe-card">
        <div class="td-pipe-top">${icon('layers')}<span>Nube / Malla</span><b>Inspección</b></div>
        <p>La nube sale del ODM y es el visor principal para vuelos nadir; malla texturizada se usa cuando la captura tiene oblicuos.</p>
        <div class="td-pipe-steps"><span>PLY</span><span>COPC</span><span>Viewer</span><span>QA</span></div>
        <button class="btn" data-open-run3d>${icon('activity')} Crear con ODM</button>
      </article>
      <article class="td-pipe-card td-pipe-hot">
        <div class="td-pipe-top">${icon('spark')}<span>Gaussian Splatting</span><b>MPS</b></div>
        <p>Entrena Medium, Cinematic o Ultra sobre poses ODM. Puede partir de un proyecto existente o crear base ODM desde video.</p>
        <div class="td-pipe-steps"><span>Poses</span><span>Train</span><span>.ksplat</span><span>Gate</span></div>
        <button class="btn primary" data-open-splat>${icon('spark')} Configurar splat</button>
      </article>
    </div>
    <div class="fl-layout" style="margin-top:16px">
      <div>
        <div class="panel">
          <div class="ph">${icon('activity')} Procesar un vuelo en 3D</div>
          <div class="pb">
            <button class="btn primary" id="btn-run3d" style="width:100%;justify-content:center;padding:10px 0;font-size:13px">${icon('cube')} Procesar un vuelo…</button>
            <p class="footer-note" style="margin:10px 0 0">El asistente te deja elegir el vuelo con
            vista previa, ponerle nombre al proyecto y escoger la calidad.</p>
            <details class="explain">
              <summary>¿Cómo funciona el procesamiento?</summary>
              <p><b>1 · Frames + geotag</b> — extrae fotos 2K del video y les inyecta el GPS de tu
              telemetría DJI (sin esto la fotogrametría no sabe dónde está nada).</p>
              <p><b>2 · Fotogrametría ODM</b> — encuentra miles de puntos comunes entre fotos,
              triangula la posición 3D de cada uno (nube densa) y reconstruye malla, ortofoto y
              modelo de elevación. Es la etapa larga.</p>
              <p><b>3 · Publicar</b> — genera los assets web: ortofoto con bordes fundidos, nube
              para el visor, DSM con curvas de nivel y reporte de calidad.</p>
              <p><b>Presets</b> — <b>Rápido</b>: nube ligera y ortofoto 8 cm/px para revisar
              cobertura. <b>Estándar</b>: 5 cm/px, el equilibrio para casi todo. <b>Alta</b>: nube
              densa y 3 cm/px para entregas profesionales y splats premium.</p>
            </details>
          </div>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="ph">${icon('cube')} Gaussian Splats
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="btn-splat" style="padding:5px 14px;font-size:11.5px">${icon('spark')} Generar splat…</button>
          </div>
          <div class="pb" id="splats"></div>
          <div class="pb" style="border-top:1px solid var(--line)">
            <details class="explain">
              <summary>¿Qué es un gaussian splat?</summary>
              <p>Reconstruye la escena como millones de <b>manchas 3D translúcidas</b> en vez de
              triángulos — se ve fotorrealista desde cualquier ángulo y no deja los huecos típicos
              de la malla en vuelos nadir. Se entrena sobre las poses del proyecto ODM
              (procesa el vuelo primero).</p>
              <p><b>Iteraciones = calidad</b> — cada iteración refina posición, color y opacidad de
              las manchas. 1k es un boceto, 2k ya luce, 7k es cinemático, 15k exprime el detalle
              (más iteraciones = más horas de CPU).</p>
              <p><b>Formatos</b> — el entrenamiento genera .splat; si existe una conversión .ksplat,
              la app la prefiere automáticamente por ser más ligera para web móvil.</p>
            </details>
          </div>
        </div>
      </div>
    </div>
    </section>

    <section class="td-mod" data-mod="jobs" style="display:none">
    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('activity')} Cola de procesamiento</div>
      <div class="pb">
        <div class="td-jobbar">
          <button class="chip on" data-job-filter="all">Todos</button>
          <button class="chip" data-job-filter="running">Activos</button>
          <button class="chip" data-job-filter="done">Listos</button>
          <button class="chip" data-job-filter="error">Errores</button>
        </div>
        <p class="footer-note" style="margin:0 0 10px">El worker procesa un trabajo pesado a la
        vez y sobrevive a que cierres la app o se reinicie el servidor — vuelve cuando quieras.</p>
        <div id="jobs3d"></div>
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
      <div class="ph">${icon('gauge')} Reporte de calidad & descargas</div>
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

  document.querySelector('.td-pipeline-grid')?.addEventListener('click', e => {
    if (e.target.closest('[data-open-run3d]')) document.getElementById('btn-run3d')?.click();
    if (e.target.closest('[data-open-splat]')) document.getElementById('btn-splat')?.click();
  });

  const jobsBox = document.getElementById('jobs3d');
  document.querySelector('.td-jobbar')?.addEventListener('click', e => {
    const b = e.target.closest('[data-job-filter]');
    if (!b || !jobsBox) return;
    document.querySelectorAll('[data-job-filter]').forEach(x => x.classList.toggle('on', x === b));
    jobsBox.dataset.filter = b.dataset.jobFilter;
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
        const r = await api('/api/model_update', { clip_id: cid, title });
        if (!r.error) m.title = r.title;
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
      const r = await api('/api/model_delete', { clip_id: cid, purge_source: true });
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
  function openModal(title, body) {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal">
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
      { k: 'alta', n: 'Alta', t: '~2-4 h', d: 'Nube densa · 3 cm/px' },
      { k: 'extra', n: 'Extra', t: '~4-7 h', d: 'Malla 600k · octree 12 · 2 cm/px' },
      { k: 'ultra', n: 'Ultra', t: '~8-14 h', d: 'pc-quality ultra · malla 800k · máx M4' },
    ];
    const { ov, close } = openModal(`${icon('cube')} Procesar un vuelo en 3D`, `
      <p class="mlb">Vuelo</p>
      <div class="mflights">${candidates.map((f, i) => `
        <div class="mflight${i === 0 ? ' on' : ''}" data-cid="${esc(f.clip_id)}">
          <img src="data/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="">
          <div class="mf-t"><b>${esc(f.label) || fmt.date(f.date) + ' ' + f.time}</b>
          <span class="mono">${fmt.dur(f.duration_s)} · ${Math.round(f.stats?.max_rel_alt_m || 0)} m alt</span></div>
        </div>`).join('')}</div>
      <video id="m-prev" class="m-prev" muted playsinline controls preload="none"></video>
      <div id="m-score"></div>
      <p class="mlb">Nombre del proyecto <span style="text-transform:none;letter-spacing:0;color:var(--text-3)">(opcional)</span></p>
      <input class="ctl" id="m-title" maxlength="80" placeholder="p. ej. Casa 4 Julio — órbita 60 m" style="width:100%">
      <p class="mlb">Calidad</p>
      <div class="mpresets">${PRE.map(p => `
        <div class="mpreset${p.k === 'estandar' ? ' on' : ''}" data-k="${p.k}">
          <b>${p.n}</b><span class="mono">${p.t}</span><small>${p.d}</small></div>`).join('')}</div>
      <button class="btn primary" id="m-go" style="width:100%;justify-content:center;margin-top:16px;padding:10px 0">${icon('cube')} Encolar procesamiento</button>`);
    const prev = ov.querySelector('#m-prev');
    const scoreBox = ov.querySelector('#m-score');
    async function loadScore(cid) {
      scoreBox.innerHTML = '<div class="sk" style="height:34px;border-radius:8px;margin-top:10px"></div>';
      try {
        const r = await fetch(`/api/capture_report?clip_id=${encodeURIComponent(cid)}`);
        const rep = await r.json();
        if (rep.error) { scoreBox.innerHTML = ''; return; }
        const su = rep.suitability || {};
        const col = v => v >= 7 ? 'var(--mint)' : v >= 4 ? 'var(--amber)' : 'var(--red)';
        scoreBox.innerHTML = `
          <div class="tool-row" style="margin-top:10px;padding:0">
            <span class="tool-lb">Captura</span>
            <span class="chip" style="color:${col(su.ortho_dsm)}">Ortho ${su.ortho_dsm}/10</span>
            <span class="chip" style="color:${col(su.mesh)}">Malla ${su.mesh}/10</span>
            <span class="chip" style="color:${col(su.splat)}">Splat ${su.splat}/10</span>
            <span class="chip">${rep.recommended_frames} frames</span>
          </div>
          ${(rep.warnings || []).slice(0, 2).map(w =>
            `<p class="footer-note" style="margin:6px 0 0;color:var(--amber)">${esc(w)}</p>`).join('')}`;
      } catch { scoreBox.innerHTML = ''; }
    }
    const setPrev = cid => { prev.poster = `data/thumbs/${cid}.jpg`; prev.src = `data/proxies/${cid}.mp4`; loadScore(cid); };
    setPrev(candidates[0].clip_id);
    ov.querySelector('.mflights').addEventListener('click', e => {
      const c = e.target.closest('.mflight');
      if (!c) return;
      ov.querySelectorAll('.mflight').forEach(x => x.classList.toggle('on', x === c));
      setPrev(c.dataset.cid);
    });
    ov.querySelector('.mpresets').addEventListener('click', e => {
      const c = e.target.closest('.mpreset');
      if (!c) return;
      ov.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
    });
    ov.querySelector('#m-go').addEventListener('click', async e2 => {
      const btn = e2.currentTarget;
      btn.disabled = true;                          // doble clic = doble job (el guard es server-side pero feo)
      try {
        const r = await api('/api/odm', {
          clip_id: ov.querySelector('.mflight.on')?.dataset.cid,
          preset: ov.querySelector('.mpreset.on')?.dataset.k || 'estandar',
          title: ov.querySelector('#m-title').value.trim(),
        });
        if (r.error) return alert(r.error);
        close();
        showTdMod('jobs');                          // feedback: te lleva a VER el job encolado (antes: silencio)
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
      renderCards();
      renderSplatList();
      if (cur) {
        const fresh = models.find(m => m.clip_id === cur.clip_id);
        if (fresh) { cur = fresh; setProject(cur.clip_id, { keepTab: true }); }
      }
    } catch { /* siguiente poll lo reintenta */ }
  });

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
        ${cur.cloud_copc_asset ? `<a class="exp" href="${base}/${cur.cloud_copc_asset}" download>${icon('database')}<div><b>Nube optimizada</b><span>COPC · ${(cur.cloud_copc_bytes / 1e6).toFixed(0)} MB · GIS</span></div></a>` : ''}
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
      autoloadTimer = setTimeout(() => document.getElementById('load-cloud-main')?.click(), 300);
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
    if (!cur?.dsm_corners || omap.getLayer('contours')) return;
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
    box.innerHTML = `<p class="footer-note" style="margin:0">${msg}</p>`;
    document.getElementById(btnId).style.display = '';
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
      <p class="mlb">Calidad del entrenamiento</p>
      <div class="mpresets splat-presets">${Q.map(q => `
        <div class="mpreset${q.p === 'medium' ? ' on' : ''}" data-preset="${q.p}">
          <b>${q.n}</b><span class="mono">${q.t}</span><small>${q.d}</small></div>`).join('')}</div>
      <button class="btn primary" id="m-go" style="width:100%;justify-content:center;margin-top:16px;padding:10px 0">${icon('spark')} Entrenar splat</button>`);
    ov.querySelector('.mflights').addEventListener('click', e => {
      const c = e.target.closest('.mflight');
      if (!c) return;
      ov.querySelectorAll('.mflight').forEach(x => x.classList.toggle('on', x === c));
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
        });
        if (r.error) return alert(r.error);
        close();
        showTdMod('jobs');                          // feedback inmediato del encolado
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
      document.querySelectorAll('#splats .splat-item').forEach(el => {
        if (el.dataset.cid === scid) el.remove();
      });
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
