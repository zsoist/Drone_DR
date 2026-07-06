  import * as THREE from '/vendor/three.module.js';
  import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';
  import { OBJLoader } from '/vendor/three-addons/loaders/OBJLoader.js';
  import { MTLLoader } from '/vendor/three-addons/loaders/MTLLoader.js';
  import { PLYLoader } from '/vendor/three-addons/loaders/PLYLoader.js';

  const SPLAT_EXT = /\.(ksplat|splat|ply)$/i;
  const SPLAT_RANK = { ksplat: 0, splat: 1, ply: 2 };
  function splatAssetFor(clipId) {
    return (sys.splats || [])
      .filter(s => SPLAT_EXT.test(s.name) && s.name.replace(SPLAT_EXT, '') === clipId)
      .sort((a, b) => (SPLAT_RANK[(a.format || a.name.split('.').pop()).toLowerCase()] ?? 9)
        - (SPLAT_RANK[(b.format || b.name.split('.').pop()).toLowerCase()] ?? 9))[0] || null;
  }

  const main = renderShell('tresd.html');
  main.innerHTML = `
    <div class="page-head"><h1>3D</h1><span class="count">fotogrametría · nube de puntos · splats</span></div>

    <div class="panel">
      <div class="ph">${icon('layers')} Proyectos 3D <span class="count" id="proj-count"></span></div>
      <div class="pb"><div class="proj-grid" id="proj-grid"></div></div>
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

    <div class="panel" style="margin-top:16px">
      <div class="ph">${icon('activity')} Cola de procesamiento</div>
      <div class="pb">
        <p class="footer-note" style="margin:0 0 10px">El worker procesa un trabajo pesado a la
        vez y sobrevive a que cierres la app o se reinicie el servidor — vuelve cuando quieras.</p>
        <div id="jobs3d"></div>
      </div>
    </div>

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
            <p class="footer-note" style="margin:0">Nube de ~800k puntos con color real — arrastra para orbitar.</p>
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

  // ---------- estado ----------
  let sys = {}, models = [], cur = null;
  try { sys = await (await fetch('data/manifest/system.json')).json(); } catch {}
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
  const titleFor = m => {
    const f = flights.find(x => x.clip_id === m.clip_id);
    return m.title || (f ? (f.label || fmt.date(f.date) + ' ' + f.time) : m.clip_id);
  };
  function renderCards() {
    const grid = document.getElementById('proj-grid');
    document.getElementById('proj-count').textContent = models.length ? `(${models.length})` : '';
    grid.innerHTML = models.length ? models.map(m => {
      const q = m.qa || {};
      const ha = q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(1) + ' ha' : Math.round(q.area_m2 || 0) + ' m²';
      return `<div class="proj-card${cur?.clip_id === m.clip_id ? ' on' : ''}" data-cid="${esc(m.clip_id)}">
        <img src="data/models/${esc(m.clip_id)}/${esc(m.ortho_asset || 'ortho.jpg')}" loading="lazy" alt="" width="320" height="180">
        <div class="pc-body">
          <p class="pc-title">${esc(titleFor(m))}</p>
          <p class="pc-meta mono">${q.gsd_cm_px ? q.gsd_cm_px + ' cm/px · ' : ''}${q.area_m2 ? ha : ''}${m.has_dsm ? ' · DSM' : ''}</p>
          <div class="pc-actions">
            <button class="btn primary" data-act="open">Abrir</button>
            <button class="btn" data-act="rename">Renombrar</button>
            <button class="btn" data-act="share">Compartir</button>
            <button class="btn pc-del" data-act="del">Borrar</button>
          </div>
        </div>
      </div>`;
    }).join('') : `<p class="footer-note" style="margin:0">Sin proyectos 3D aún — procesa un vuelo abajo para crear el primero.</p>`;
  }
  document.getElementById('proj-grid').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.proj-card');
    if (!card) return;
    const cid = card.dataset.cid;
    const m = models.find(x => x.clip_id === cid);
    if (!btn) { setProject(cid); return; }                      // tap en la tarjeta = abrir
    if (btn.dataset.act === 'open') setProject(cid);
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
    ov.querySelector('#m-go').addEventListener('click', async () => {
      const r = await api('/api/odm', {
        clip_id: ov.querySelector('.mflight.on')?.dataset.cid,
        preset: ov.querySelector('.mpreset.on')?.dataset.k || 'estandar',
        title: ov.querySelector('#m-title').value.trim(),
      });
      if (r.error) return alert(r.error);
      close();
    });
  });
  pollJobs(document.getElementById('jobs3d'));

  // ---------- ortofoto en MapLibre ----------
  let omap = null;
  function setProject(cid) {
    cur = models.find(m => m.clip_id === cid);
    if (!cur) return;
    localStorage.setItem(PROJ_KEY, cid);
    document.getElementById('proj-view').style.display = '';
    document.querySelectorAll('.proj-card').forEach(c => c.classList.toggle('on', c.dataset.cid === cid));
    const base = `data/models/${cid}`;
    const q = cur.qa || {};
    const reproj = q.reprojection_error_px;
    const grade = reproj == null ? '—' : reproj < 1.5 ? 'excelente' : reproj < 2.5 ? 'buena' : 'aceptable';
    const sp = splatAssetFor(cid);
    const spFmt = (sp?.format || sp?.name.split('.').pop() || 'splat').toUpperCase();
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
        <a class="exp" href="${base}/${cur.model_obj}" download>${icon('cube')}<div><b>Malla texturizada</b><span>OBJ · Blender / 3D</span></div></a>
        ${sp ? `<a class="exp" href="data/splats/${encodeURIComponent(sp.name)}" download>${icon('spark')}<div><b>Gaussian splat</b><span>${spFmt} · SuperSplat</span></div></a>` : ''}
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
    const rc = document.createElement('button');
    rc.className = 'map-recenter';
    rc.title = 'Recentrar en el proyecto';
    rc.innerHTML = icon('pin');
    rc.addEventListener('click', () => omap.fitBounds(b, { padding: 40 }));
    document.getElementById('omap').appendChild(rc);
    document.getElementById('op').oninput = e => {
      omap.getLayer('ortho') && omap.setPaintProperty('ortho', 'raster-opacity', +e.target.value / 100);
    };
    const spMeta = splatAssetFor(cid);
    const spStatusFmt = (spMeta?.format || spMeta?.name.split('.').pop() || 'splat').toUpperCase();
    document.getElementById('sp-status').textContent = spMeta ? `${(spMeta.bytes / 1e6).toFixed(1)} MB · ${spStatusFmt}` : 'sin entrenar';
    document.getElementById('load-splat').style.display = spMeta ? '' : 'none';
    const sbox = document.getElementById('splat-box');
    if (sbox._viewer) { try { sbox._viewer.dispose(); } catch {} sbox._viewer = null; }
    sbox.innerHTML = `<p class="footer-note" style="margin:0" id="splat-note">${spMeta
      ? 'Splat entrenado y listo — pulsa Cargar para el render foto-real.'
      : 'Este proyecto aún no tiene splat — entrénalo con "Generar splat…" arriba.'}</p>`;
    const cloudMB = (cur.cloud_bytes || 0) / 1e6;
    document.getElementById('mesh-q').textContent =
      { rapido: 'calidad rápida', alta: 'calidad alta' }[cur.preset] || 'calidad estándar';
    resetViewer('cloud-box', `Nube de puntos${cloudMB ? ` · ${cloudMB.toFixed(0)} MB` : ''}`, 'load-cloud-main');
    resetViewer('mesh-box', 'Modelo sólido con textura foto-real.', 'load-mesh');
    // auto-carga la estrella — salvo nubes pesadas en móvil (datos + memoria)
    if (!(matchMedia('(max-width: 700px)').matches && cloudMB > 25))
      setTimeout(() => document.getElementById('load-cloud-main')?.click(), 300);
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
    controls.zoomSpeed = 0.9;
    new ResizeObserver(() => {
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H);
      cam.aspect = W / H; cam.updateProjectionMatrix();
    }).observe(box);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(1, 2, 1.5);
    scene.add(dl);
    (function loop() {
      if (!renderer.domElement.isConnected) { renderer.dispose(); return; }  // visor reemplazado
      requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam);
    })();
    return { scene, cam, controls, renderer };
  }
  function frameObject(obj, cam, controls) {
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z);
    obj.position.sub(c);                       // centra en el origen
    // distancia para que el objeto LLENE ~80% del viewport (fov-aware)
    const fov = cam.fov * Math.PI / 180;
    const dist = (maxDim / 2) / Math.tan(fov / 2) / 0.8;
    cam.position.set(dist * 0.15, dist * 0.92, dist * 0.28);  // casi cenital: data nadir se ve densa
    cam.near = maxDim / 1000; cam.far = dist * 8; cam.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 3;
    controls.update();
  }
  function fitSplatViewer(viewer) {
    const mesh = viewer?.splatMesh;
    const center = mesh?.calculatedSceneCenter || new THREE.Vector3();
    const radius = Math.max(mesh?.maxSplatDistanceFromSceneCenter || mesh?.visibleRegionRadius || 1, 1);
    const dist = radius * 3.2;
    const dir = new THREE.Vector3(0.18, 0.78, 0.62).normalize();
    viewer.camera.position.copy(center).addScaledVector(dir, dist);
    viewer.camera.near = Math.max(radius / 800, 0.01);
    viewer.camera.far = Math.max(radius * 80, dist * 8);
    viewer.camera.updateProjectionMatrix();
    if (viewer.controls) {
      viewer.controls.target.copy(center);
      viewer.controls.minDistance = Math.max(radius * 0.55, 0.25);
      viewer.controls.maxDistance = Math.max(radius * 18, 20);
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
      <button data-vt="rot" title="Auto-rotar">${icon('route')}</button>` : ''}
      <button data-vt="fs" title="Pantalla completa">${icon('ext')}</button>`;
    box.style.position = 'relative';
    box.appendChild(bar);
    const cam0 = cam ? cam.position.clone() : null;
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-vt]');
      if (!b) return;
      if (b.dataset.vt === 'center') { cam.position.copy(cam0); controls.target.set(0, 0, 0); }
      if (b.dataset.vt === 'rot') {
        controls.autoRotate = !controls.autoRotate;
        controls.autoRotateSpeed = 1.1;
        b.classList.toggle('on', controls.autoRotate);
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
    if (!cur) return;
    e.currentTarget.style.display = 'none';
    const box = document.getElementById('mesh-box');
    const stM = spin(box, 'Cargando malla texturizada…');
    const base = `data/models/${cur.clip_id}/model/`;
    const mtl = await new MTLLoader().setPath(base).loadAsync('odm_textured_model_geo.mtl');
    mtl.preload();
    const meshFile = (cur.model_viewer || cur.model_obj || 'model/odm_textured_model_geo.obj').split('/').pop();
    const obj = await new OBJLoader().setMaterials(mtl).setPath(base).loadAsync(meshFile,
      ev => { if (ev.loaded) stM.textContent = `Malla · ${(ev.loaded / 1e6).toFixed(0)} MB descargados`; });
    const { scene, cam, controls, renderer } = makeScene(box);
    // dos renders intercambiables: Foto (unlit — la textura ya trae la luz real)
    // y Relieve (con luces — revela la profundidad de la geometría)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const sets = { foto: [], relieve: [] };
    obj.traverse(n => {
      if (!n.isMesh) return;
      n.geometry.computeVertexNormals();          // sombreado suave en modo Relieve
      const src = Array.isArray(n.material) ? n.material : [n.material];
      src.forEach(m => { if (m.map) { m.map.anisotropy = maxAniso; m.map.needsUpdate = true; } });
      const mk = C => src.map(m => new C({ map: m.map || null, color: m.map ? 0xffffff : 0x8a97a8, side: THREE.DoubleSide }));
      const foto = mk(THREE.MeshBasicMaterial), rel = mk(THREE.MeshLambertMaterial);
      sets.foto.push([n, foto]);
      sets.relieve.push([n, rel]);
      n.material = foto.length === 1 ? foto[0] : foto;
    });
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    frameObject(obj, cam, controls);
    attachViewerTools(box, cam, controls);
    const mhud = document.createElement('div');
    mhud.className = 'viewer-hud';
    mhud.innerHTML = `<label>Render <button class="chip on" data-mr="foto">Foto</button>
      <button class="chip" data-mr="relieve">Relieve</button></label>`;
    box.appendChild(mhud);
    mhud.addEventListener('click', ev => {
      const bt = ev.target.closest('[data-mr]');
      if (!bt) return;
      mhud.querySelectorAll('[data-mr]').forEach(c => c.classList.toggle('on', c === bt));
      sets[bt.dataset.mr].forEach(([n, m]) => { n.material = m.length === 1 ? m[0] : m; });
    });
  });

  document.getElementById('load-cloud-main').addEventListener('click', async e => {
    if (!cur) return;
    e.currentTarget.style.display = 'none';
    const box = document.getElementById('cloud-box');
    const stC = spin(box, 'Descargando nube de puntos…');
    const geo = await new PLYLoader().loadAsync(`data/models/${cur.clip_id}/cloud.ply`,
      ev => { stC.textContent = ev.total ? `Nube · ${Math.round(ev.loaded / ev.total * 100)}%`
                                         : `Nube · ${(ev.loaded / 1e6).toFixed(0)} MB`; });
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
    });
  });

  // splats: listar + ver inline + generar
  const splats = (sys.splats || []).filter(s => SPLAT_EXT.test(s.name));
  document.getElementById('splats').innerHTML = splats.length ? splats.map(s => {
    const scid = s.name.replace(SPLAT_EXT, '');
    const sf = flights.find(x => x.clip_id === scid);
    const sm = models.find(x => x.clip_id === scid);
    const sFmt = (s.format || s.name.split('.').pop()).toUpperCase();
    const title = (sm && sm.title) || (sf && (sf.label || fmt.date(sf.date) + ' · ' + sf.time)) || scid.slice(-11);
    return `
    <div class="splat-item">
      <div class="si-t"><b>${esc(title)}</b>
        <span class="mono">${(s.bytes / 1e6).toFixed(1)} MB · formato .${sFmt.toLowerCase()}</span></div>
      <span class="spacer" style="flex:1"></span>
      <a class="btn" href="data/splats/${encodeURIComponent(s.name)}" download title="Descargar">${icon('dl')}</a>
      <button class="btn primary" data-view="${esc(s.name)}" style="padding:5px 16px">Ver</button>
    </div>`;
  }).join('') :
    `<p class="footer-note">Sin splats aún — "Generar splat…" entrena uno sobre las poses
    del proyecto que elijas. El resultado se ve aquí mismo.</p>`;
  document.getElementById('btn-splat').addEventListener('click', () => {
    if (!models.length) return alert('Procesa primero un vuelo en 3D — el splat entrena sobre sus fotos y poses.');
    const Q = [
      { v: 1000, n: 'Rápido', t: '~15-25 min', d: 'Boceto para previsualizar' },
      { v: 2000, n: 'Balanceado', t: '~30-50 min', d: 'Buen detalle general' },
      { v: 7000, n: 'Cinemático', t: '~2-3 h', d: 'Nítido, para compartir' },
      { v: 15000, n: 'Ultra', t: '~5-7 h', d: 'Máximo detalle (déjalo de noche)' },
    ];
    const { ov, close } = openModal(`${icon('spark')} Generar gaussian splat`, `
      <p class="footer-note" style="margin:0 0 12px">Entrena un archivo <b>.splat</b> nuevo con las
      fotos y poses del proyecto elegido — <b>no modifica</b> la nube ni la malla. Al terminar
      aparece en la lista, en el visor y en la página pública.</p>
      <p class="mlb">Proyecto base</p>
      <div class="mflights">${models.map((m, i) => `
        <div class="mflight${(cur ? m.clip_id === cur.clip_id : i === 0) ? ' on' : ''}" data-cid="${esc(m.clip_id)}">
          <img src="data/models/${esc(m.clip_id)}/${esc(m.ortho_asset || 'ortho.jpg')}" loading="lazy" alt="">
          <div class="mf-t"><b>${esc(titleFor(m))}</b>
          <span class="mono">${m.qa?.cameras_reconstructed || '?'} cámaras</span></div>
        </div>`).join('')}</div>
      <p class="mlb">Calidad del entrenamiento</p>
      <div class="mpresets">${Q.map(q => `
        <div class="mpreset${q.v === 2000 ? ' on' : ''}" data-v="${q.v}">
          <b>${q.n}</b><span class="mono">${q.t}</span><small>${q.d}</small></div>`).join('')}</div>
      <button class="btn primary" id="m-go" style="width:100%;justify-content:center;margin-top:16px;padding:10px 0">${icon('spark')} Entrenar splat</button>`);
    ov.querySelector('.mflights').addEventListener('click', e => {
      const c = e.target.closest('.mflight');
      if (!c) return;
      ov.querySelectorAll('.mflight').forEach(x => x.classList.toggle('on', x === c));
    });
    ov.querySelector('.mpresets').addEventListener('click', e => {
      const c = e.target.closest('.mpreset');
      if (!c) return;
      ov.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
    });
    ov.querySelector('#m-go').addEventListener('click', async () => {
      const r = await api('/api/splat', {
        clip_id: ov.querySelector('.mflight.on')?.dataset.cid,
        iters: +(ov.querySelector('.mpreset.on')?.dataset.v || 2000),
      });
      if (r.error) return alert(r.error);
      close();
    });
  });
  document.getElementById('splats').addEventListener('click', e => {
    const name = e.target.dataset.view;
    if (!name) return;
    const scid = name.replace(SPLAT_EXT, '');
    if (!models.some(m => m.clip_id === scid)) return alert('Este splat no tiene proyecto 3D publicado.');
    setProject(scid);
    document.getElementById('load-splat').click();
    setTimeout(() => document.getElementById('splat-box').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  });

  document.getElementById('load-splat').addEventListener('click', async () => {
    if (!cur) return;
    const asset = splatAssetFor(cur.clip_id);
    if (!asset) return;
    const name = asset.name;
    const box = document.getElementById('splat-box');
    // visor anterior fuera ANTES de crear otro (workers + GPU buffers liberados)
    if (box._viewer) { try { box._viewer.dispose(); } catch {} box._viewer = null; }
    box.style.position = 'relative';
    box.innerHTML = `<div class="splat-load"><div class="sk" style="height:10px;border-radius:5px"></div>
      <p class="footer-note splat-st" style="margin:10px 0 0">Descargando splat…</p></div>`;
    const st = box.querySelector('.splat-st');
    const GaussianSplats3D = await import('/vendor/gaussian-splats-3d.module.min.js');
    // perf: covarianzas half-precision en GPU + antialiased + descarte de splats
    // casi-invisibles; spinner propio (el built-in es feo y no respeta el theme)
    // escena OpenSfM es Z-up: rotamos a Y-up y arrancamos con vista aerea —
    // sin esto el splat aparece torcido y navegar es una pesadilla
    const SPLAT_ROT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const viewer = new GaussianSplats3D.Viewer({
      rootElement: box, sharedMemoryForWorkers: false, antialiased: true,
      halfPrecisionCovariancesOnGPU: true, showLoadingUI: false,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
      cameraUp: [0, 1, 0],
      initialCameraPosition: [0, 5, 4],
      initialCameraLookAt: [0, 0, 0],
    });
    box._viewer = viewer;
    try {
      // progressiveLoad:false — hang conocido de .splat en iOS ("Processing splats")
      await Promise.race([
        viewer.addSplatScene(`data/splats/${name}`, {
          progressiveLoad: false, showLoadingUI: false,
          // umbral de alpha agresivo: mata la "suciedad" de manchas fantasma
          // de los entrenamientos cortos (estilo Polycam)
          splatAlphaRemovalThreshold: 40,
          rotation: SPLAT_ROT,
          onProgress: p => { if (st) st.textContent = `Splat · ${Math.round(p)}%`; },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout de 45s procesando el splat')), 45000)),
      ]);
    } catch (err) {
      box.querySelector('.splat-load').innerHTML =
        `<p class="footer-note">No se pudo cargar ${esc(name)} · ${esc(String(err && err.message || err).slice(0, 90))}</p>`;
      return;
    }
    fitSplatViewer(viewer);
    viewer.start();
    // navegacion domada: damping suave, nunca por debajo del suelo, zoom acotado
    const c = viewer.controls;
    if (c) {
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.rotateSpeed = 0.5;
      c.zoomSpeed = 0.8;
      c.maxPolarAngle = Math.PI * 0.49;
    }
    box.querySelector('.splat-load')?.remove();
    // HUD premium: auto-rotar + pantalla completa
    const bar = document.createElement('div');
    bar.className = 'viewer-tools';
    bar.innerHTML = `<button data-svt="rot" title="Auto-rotar">${icon('route')}</button>
      <button data-svt="fs" title="Pantalla completa">${icon('ext')}</button>`;
    box.appendChild(bar);
    bar.addEventListener('click', ev => {
      const b = ev.target.closest('[data-svt]');
      if (!b) return;
      if (b.dataset.svt === 'rot' && viewer.controls) {
        viewer.controls.autoRotate = !viewer.controls.autoRotate;
        viewer.controls.autoRotateSpeed = 0.9;
        b.classList.toggle('on', viewer.controls.autoRotate);
      }
      if (b.dataset.svt === 'fs') {
        const on = box.classList.toggle('viewer-fs');
        b.innerHTML = on ? icon('chevL') : icon('ext');
        document.body.style.overflow = on ? 'hidden' : '';
        window.dispatchEvent(new Event('resize'));
      }
    });
  });

  // sin auto-abrir: solo se restaura una selección previa del usuario
  renderCards();
  const saved = localStorage.getItem(PROJ_KEY);
  if (saved && models.some(m => m.clip_id === saved)) setProject(saved);
