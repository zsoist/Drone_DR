// Splat Lab — SuperSplat (MIT, self-hosted en /supersplat/) integrado al shell.
// Flujo completo: elegir splat → editar (floaters/crop/transform) → File > Export
// → SUBIR AQUÍ MISMO (drag&drop o botón) → se publica versionado (history/) y el
// viewer/manifest se actualizan solos. El original nunca se pierde.
const main = renderShell('splatlab.html');
main.classList.add('lab-main');

(async () => {
  let sys = {}, splats = [], cur = 0;
  const load_sys = async () => {
    sys = await (await fetch(`${DATA}/manifest/system.json`, { cache: 'no-store' })).json();
    // solo versiones ACTUALES: Limpiar publicado / Revertir / Subir actúan sobre el archivo
    // vigente del clip, no sobre una copia archivada en history/ (que el picker mostraba sin etiqueta)
    splats = (sys.splats || []).filter(s => s.current !== false);
  };
  try { await load_sys(); } catch {}
  const models = () => sys.models || [];
  const title = s => {
    const m = models().find(x => x.clip_id === s.clip_id);
    if (m && m.title) return m.title;
    const ts = ((s.clip_id || '').split('_')[1] || '');
    return ts ? `${fmt.date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`)} · ${ts.slice(8, 10)}:${ts.slice(10, 12)}` : s.clip_id;
  };
  const splatKey = s => s.path || s.name;
  const splatUrl = s => 'data/splats/' + splatKey(s).split('/').map(encodeURIComponent).join('/');
  const editorUrl = s =>
    `/supersplat/?load=${encodeURIComponent('/' + splatUrl(s))}&filename=${encodeURIComponent(s.name)}`;

  main.innerHTML = `
    ${pageHead('Splat Lab', 'Edición de gaussian splats · SuperSplat', '<div class="sl-switch" id="lab-picker"></div>')}
    <div class="sl-bar" role="toolbar" aria-label="Herramientas del splat">
      <div class="sl-files" id="lab-actions" role="group" aria-label="Archivo del splat"></div>
      <div class="sl-clean" id="lab-clean" role="group" aria-label="Auto-Clean del splat"></div>
      <button class="btn icon sl-full" id="lab-full" title="Editor a pantalla completa (Esc para salir)" aria-label="Editor a pantalla completa">${icon('fit')}</button>
    </div>
    <div class="sl-status" role="status" aria-live="polite"><span id="lab-status"></span><span id="lab-clean-status"></span></div>
    <div class="lab-frame-wrap" id="lab-drop">
    <div class="sl-tune" id="lab-tune-panel" inert role="group" aria-label="Ajustes finos del Auto-Clean">
      ${[['op', 'Neblina', 'Gaussianas casi transparentes = niebla. Desmarca para conservarlas', 'Umbral neblina', 0.5, 20, 3.5, 0.5, '3.5%'],
         ['k', 'Picos', 'Gaussianas gigantes vs la mediana = picos y manchas. Más bajo = más agresivo', 'Umbral picos', 2, 10, 6, 0.5, '6.0×'],
         ['an', 'Agujas', 'Agujas: eje máximo >> eje intermedio (no toca discos-superficie). Más bajo = más agujas fuera', 'Umbral agujas', 5, 25, 15, 1, '15'],
         ['rad', 'Borde', 'Spray radial más allá del footprint de vuelo. Desmarca si tu escena es alargada', 'Umbral borde', 95, 99.9, 99.5, 0.1, 'P99.5']]
        .map(([k, lb, tip, aria, mn, mx, v, st, txt]) => `
      <div class="tn-stage" title="${tip}">
        <label class="tn-lb"><input type="checkbox" id="tn-${k}-on" checked>${lb}</label>
        <input type="range" id="tn-${k}" aria-label="${aria}" min="${mn}" max="${mx}" value="${v}" step="${st}">
        <b class="mono" id="tn-${k}-v">${txt}</b>
        <em class="mono tn-count" id="tn-${k}-c"></em></div>`).join('')}
      <p class="sl-tune-note">Cada limpieza es UN paso de undo — prueba, mira los contadores por etapa, deshaz y ajusta.</p>
    </div>
      <iframe id="lab-frame" class="lab-frame" allow="fullscreen" title="Editor SuperSplat"></iframe>
      <button class="btn lab-exit" id="lab-exit" hidden aria-label="Salir de pantalla completa">${icon('close')} Salir</button>
      <div class="lab-drophint" id="lab-drophint" hidden>Suelta el splat editado (.ply / .splat / .ksplat) para publicarlo</div>
    </div>
    <p class="page-foot lab-tip"><b>Flujo:</b> limpia floaters con pincel/lazo + borrar · recorta con crop ·
      <b>File → Export</b> descarga el resultado · súbelo aquí (botón o arrástralo) y queda publicado —
      la versión anterior se archiva en <span class="mono">splats/history/</span>.</p>
    <input type="file" id="lab-file" accept=".ply,.splat,.ksplat" hidden aria-hidden="true">`;

  const frame = document.getElementById('lab-frame');
  const picker = document.getElementById('lab-picker');
  const actions = document.getElementById('lab-actions');
  const fileIn = document.getElementById('lab-file');
  const drop = document.getElementById('lab-drop');
  const hint = document.getElementById('lab-drophint');
  // ajustes finos: el panel es estático (no se re-crea con cada load) → listeners una sola vez
  [['tn-op', v => v + '%'], ['tn-k', v => (+v).toFixed(1) + '×'], ['tn-an', v => v],
   ['tn-rad', v => 'P' + v]].forEach(([id, f]) => {
    document.getElementById(id).addEventListener('input', e2 =>
      document.getElementById(id + '-v').textContent = f(e2.target.value));
  });

  // ---- puente con el editor (same-origin): origen fijo, nunca '*' ----
  const toEditor = msg => { try { frame.contentWindow?.postMessage(msg, location.origin); return true; } catch { return false; } };
  const fromEditor = e => e.origin === location.origin && e.source === frame.contentWindow;
  // ¿hay ediciones sin exportar? SuperSplat responde a 'supersplat:is-scene-dirty' (iframe-api.ts)
  const editorDirty = () => new Promise(res => {
    if (!frame.getAttribute('src')) { res(false); return; }   // editor aún no cargado (móvil lazy)
    let done = false;
    const fin = v => { if (done) return; done = true; window.removeEventListener('message', on); clearTimeout(t); res(v); };
    const on = e => { if (fromEditor(e) && e.data?.type === 'supersplat:is-scene-dirty') fin(!!e.data.result); };
    const t = setTimeout(() => fin(false), 600);          // editor aún cargando / sin API → no bloquear
    window.addEventListener('message', on);
    if (!toEditor({ type: 'supersplat:is-scene-dirty' })) fin(false);
  });
  const okToDiscard = async () =>
    !(await editorDirty()) || confirm('Hay ediciones sin exportar en el editor. ¿Descartarlas?');

  // Ajustes: panel flotante sobre el editor (opacity/transform) → el editor no salta de sitio
  const setTune = on => {
    const panel = document.getElementById('lab-tune-panel');
    panel.classList.toggle('open', on);
    panel.inert = !on;
    const b = document.getElementById('lab-tune');
    if (b) { b.setAttribute('aria-expanded', String(on)); b.classList.toggle('on', on); }
  };
  const sizeMB = s => `${((s.bytes || 0) / 1e6).toFixed(1)} MB`;
  const itersK = s => s.iters ? `${s.iters >= 1000 ? s.iters / 1000 + 'K' : s.iters} iters` : '';
  let pickerQ = '';
  const renderList = () => {
    const list = document.getElementById('lab-list');
    if (!list) return;
    const q = pickerQ.trim().toLowerCase();
    const rows = splats.map((x, i) => [x, i]).filter(([x]) => !q || `${title(x)} ${x.clip_id}`.toLowerCase().includes(q));
    list.onscroll = () => fadeList(list);
    list.innerHTML = rows.map(([x, i]) => `
      <button type="button" class="sl-opt${i === cur ? ' on' : ''}" role="option" data-i="${i}" aria-selected="${i === cur}" title="${esc(x.name)}">
        <span class="sl-opt-t">${esc(title(x))}</span>
        <span class="sl-opt-m mono">${esc([sizeMB(x), itersK(x)].filter(Boolean).join(' · '))}</span>
        ${i === cur ? icon('check') : ''}
      </button>`).join('') || '<p class="sl-empty-list">Sin resultados</p>';
    fadeList(list);
    list.querySelector('.sl-opt.on')?.scrollIntoView({ block: 'nearest' });
  };
  // desvanecido de borde: avisa que la lista continúa (sin cortar una fila a medias en seco)
  const fadeList = list => {
    list.classList.toggle('fade-b', list.scrollHeight - list.scrollTop - list.clientHeight > 4);
    list.classList.toggle('fade-t', list.scrollTop > 4);
  };
  const renderPicker = () => {
    const s = splats[cur];
    if (!s) {
      picker.innerHTML = '<span class="footer-note sl-none">Sin splats aún — entrena uno en el tab 3D.</span>';
      return;
    }
    pickerQ = '';
    picker.innerHTML = `
      <button type="button" class="btn sl-switch-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Cambiar splat (${splats.length})">
        ${icon('cube')}<span class="sl-sw-name">${esc(title(s))}</span><span class="sl-sw-meta mono">${sizeMB(s)}</span>${icon('chevD')}
      </button>`;
  };
  // selector de splat: popover canónico (openPopover) con búsqueda + listbox
  const openPicker = btn => {
    pickerQ = '';
    const box = document.createElement('div');
    box.innerHTML = `
      <div class="search sl-pop-search">${icon('search')}<input type="search" id="lab-pq" placeholder="Buscar…" aria-label="Buscar splat" autocomplete="off"></div>
      <div class="sl-list" id="lab-list" role="listbox" aria-label="Splats disponibles"></div>`;
    const pop = openPopover(btn, box, {
      haspopup: 'listbox', className: 'pop-pad sl-pop-list', focus: '#lab-pq',
      onKey: e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = [...box.querySelectorAll('.sl-opt')];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : i - 1;
        (n < 0 ? box.querySelector('#lab-pq') : items[n]).focus();
      },
    });
    if (!pop) return;
    box.addEventListener('input', e => { if (e.target.id === 'lab-pq') { pickerQ = e.target.value; renderList(); } });
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      pop.close({ refocus: true });
      if (+b.dataset.i !== cur && !(await okToDiscard())) return;
      load(+b.dataset.i, true);
    });
    renderList();
  };
  const renderActions = () => {
    const s = splats[cur];
    if (!s) { actions.innerHTML = ''; return; }
    actions.innerHTML = `
      <a class="btn ghost" href="${splatUrl(s)}" download title="Descarga el .splat actual tal cual está publicado" aria-label="Descargar splat actual">${icon('dl')} Descargar</a>
      <button class="btn ghost" id="lab-upload" title="Sube un splat editado (.ply/.splat/.ksplat) — la versión anterior se archiva en history/" aria-label="Subir splat editado">${icon('save')} Subir editado</button>
      <a class="btn ghost" href="share.html?m=${encodeURIComponent(s.clip_id)}" target="_blank" rel="noopener" title="Abre el visor privado de este modelo" aria-label="Abrir visor privado">${icon('ext')} Abrir visor</a>
      <a class="btn ghost" href="tresd.html" title="Abre el proyecto en el tab 3D (mapa, malla, nube)" aria-label="Ver en el tab 3D">${icon('cube')} Ver en 3D</a>`;
    document.getElementById('lab-upload').addEventListener('click', () => fileIn.click());
    renderClean();
    renderLazy();
  };
  const rawUrl = s => 'data/splats/' + encodeURIComponent(`${s.clip_id}.raw.splat`);
  let abRaw = false;                       // A/B: viendo el crudo pre-clean en el editor
  const rawOk = {};                        // clip_id → ¿existe <cid>.raw.splat? (solo hay tras un Auto-Clean)
  function renderClean() {
    const s = splats[cur];
    const box = document.getElementById('lab-clean');
    if (!s || !box) { if (box) box.innerHTML = ''; return; }
    const tuneOpen = document.getElementById('lab-tune-panel').classList.contains('open');
    box.innerHTML = `
      <select class="ctl sl-preset" id="lab-preset" aria-label="Preset de Auto-Clean" title="Preset de limpieza — aéreo conserva estructuras dispersas legítimas; agresivo quita más spray de borde">
        <option value="aerial">Aéreo (seguro)</option>
        <option value="aerial_aggressive">Aéreo agresivo</option>
        <option value="object">Objeto / interior</option>
      </select>
      <button class="btn primary" id="lab-ac-ed" title="Limpia DENTRO del editor: selecciona flotantes/neblina/agujas y los borra como pasos de undo (Ctrl+Z ×2 deshace; Edit→Reset restaura todo). Luego File→Export para publicar">${icon('spark')} Limpiar en editor</button>
      <div class="btn-group" role="group" aria-label="Historial del editor">
        <button class="btn icon" id="lab-undo" title="Deshace el último paso dentro del editor (el Auto-Clean es UN solo paso)" aria-label="Deshacer en el editor">${icon('undo')}</button>
        <button class="btn icon" id="lab-redo" title="Rehace el paso deshecho dentro del editor" aria-label="Rehacer en el editor">${icon('redo')}</button>
      </div>
      <button class="btn${abRaw ? ' on' : ''}" id="lab-ab" title="Alterna el editor entre el crudo y la versión actual para comparar antes/después (requiere un crudo pre-clean)" aria-pressed="${abRaw}"${rawOk[s.clip_id] === false && !abRaw ? ' disabled' : ''}>${abRaw ? 'Viendo: crudo' : 'A/B'}</button>
      <button class="btn${tuneOpen ? ' on' : ''}" id="lab-tune" title="Ajustes finos del Auto-Clean: umbral de neblina, factor de picos y agujas — se aplican al próximo Limpiar" aria-expanded="${tuneOpen}" aria-controls="lab-tune-panel">${icon('gauge')} Ajustes</button>
      <button class="btn icon" id="lab-more" aria-haspopup="menu" aria-expanded="false" aria-label="Más acciones sobre el archivo publicado" title="Más acciones">${icon('more')}</button>`;
    if (rawOk[s.clip_id] === undefined && typeof s.has_raw === 'boolean') rawOk[s.clip_id] = s.has_raw;
    if (rawOk[s.clip_id] === undefined) {
      const cid = s.clip_id;
      rawOk[cid] = null;                                   // consulta en vuelo
      fetch(rawUrl(s), { method: 'HEAD', cache: 'no-store' })
        .then(r => r.ok, () => true)                       // error de red: no bloquear el botón
        .then(ok => {
          rawOk[cid] = ok;
          const ab = document.getElementById('lab-ab');
          if (ab && splats[cur]?.clip_id === cid && !abRaw) ab.disabled = !ok;
        });
    }
    const cst = t => { const el = document.getElementById('lab-clean-status'); if (el) { el.textContent = t; el.classList.toggle('err', /^Error/.test(t)); } };
    // limpieza IN-EDITOR: postMessage al iframe (fork src/aerobrain) — undo nativo de SuperSplat
    const tuneOverrides = () => {
      const panel = document.getElementById('lab-tune-panel');
      if (!panel || !panel.classList.contains('open')) return undefined;          // solo si el usuario abrió Ajustes
      const on = id => document.getElementById(id).checked;
      const v = id => +document.getElementById(id).value;
      return { opacityMin: on('tn-op-on') ? v('tn-op') / 100 : 0,
               scaleK: on('tn-k-on') ? v('tn-k') : 0,
               anisoMax: on('tn-an-on') ? v('tn-an') : 0,
               radialPct: on('tn-rad-on') ? v('tn-rad') / 100 : 0 };
    };
    document.getElementById('lab-ac-ed').addEventListener('click', () => {
      const preset = document.getElementById('lab-preset').value;
      cst('limpiando en el editor…');
      if (!toEditor({ type: 'aerobrain:autoclean', preset, overrides: tuneOverrides() })) cst('Error: el editor no respondió');
    });
    document.getElementById('lab-more').addEventListener('click', e2 => openMenu(e2.currentTarget, [
      { id: 'ac', label: 'Limpiar publicado', hint: 'Aplica el preset al archivo del servidor', icon: 'save' },
      { id: 'revert', label: 'Revertir al crudo', hint: 'La versión limpia queda en history/', icon: 'undo', danger: true },
    ], { label: 'Archivo publicado', onSelect: id => (id === 'ac' ? runAc() : runRevert()) }));
    document.getElementById('lab-tune').addEventListener('click', e2 => {
      setTune(!document.getElementById('lab-tune-panel').classList.contains('open'));
    });
    const runAc = async () => {
      const btn = document.getElementById('lab-more'); btn.disabled = true;
      if (!(await okToDiscard())) { btn.disabled = false; return; }
      const preset = document.getElementById('lab-preset').value;
      cst('limpiando…');
      try {
        const r = await authFetch(`/api/splat_autoclean?cid=${encodeURIComponent(s.clip_id)}&preset=${preset}`, { method: 'POST' });
        const out = await r.json();
        if (!r.ok || out.error) throw new Error(out.error || r.status);
        const rep = out.report, rm = rep.removed;
        cst(`${rep.input.toLocaleString()} → ${rep.output.toLocaleString()} (${rep.kept_pct}%) · neblina ${rm.opacity} · picos ${rm.scale} · agujas ${rm.aniso} · voxel ${rm.voxel}`);
        delete rawOk[s.clip_id];                          // el clean crea el crudo
        await load_sys(); abRaw = false; load(cur);
      } catch (err) { cst(`Error: ${String(err.message || err).slice(0, 90)}`); }
      finally { btn.disabled = false; }
    };
    document.getElementById('lab-undo').addEventListener('click', () => toEditor({ type: 'aerobrain:undo' }));
    document.getElementById('lab-redo').addEventListener('click', () => toEditor({ type: 'aerobrain:redo' }));
    const runRevert = async () => {
      if (!(await okToDiscard())) return;
      cst('revirtiendo al crudo…');
      try {
        const r = await authFetch(`/api/splat_revert?cid=${encodeURIComponent(s.clip_id)}&to=raw`, { method: 'POST' });
        const out = await r.json();
        if (!r.ok || out.error) throw new Error(out.error || r.status);
        cst('crudo restaurado como actual · la limpia quedó en history/');
        await load_sys(); abRaw = false; load(cur);
      } catch (err) { cst(`Error: ${String(err.message || err).slice(0, 90)}`); }
    };
    document.getElementById('lab-ab').addEventListener('click', async () => {
      if (!(await okToDiscard())) return;
      abRaw = !abRaw;
      armed = true; lazyBox.hidden = true; wrapEmpty(false);
      const src = abRaw
        ? `/supersplat/?load=${encodeURIComponent('/' + rawUrl(s))}&filename=${encodeURIComponent(s.clip_id + '.raw.splat')}`
        : editorUrl(s);
      frame.src = src;
      renderClean();
    });
  }
  // móvil/táctil: el editor pesa ~25 MB (index.js + .sog) y el iframe queda bajo el pliegue →
  // no fijamos src hasta que el usuario toque "Cargar editor" o elija un splat
  const LAZY = matchMedia('(max-width: 800px), (pointer: coarse)').matches;
  let armed = !LAZY;
  const lazyBox = document.createElement('div');
  lazyBox.className = 'lab-lazy empty sl-empty';
  const wrapEmpty = on => drop.classList.toggle('is-empty', on);
  const renderLazy = () => {
    const s = splats[cur];
    lazyBox.innerHTML = `
      ${icon('cube')}
      <b>Editor SuperSplat · ~25 MB</b>
      <p>Se descarga solo cuando vayas a editar.</p>
      ${s ? `<span class="sl-empty-stats"><span class="chip sm">${esc(title(s))}</span>
        <span class="chip sm mono">${sizeMB(s)}</span>${s.iters ? `<span class="chip sm mono">${esc(itersK(s))}</span>` : ''}</span>` : ''}
      <button class="btn primary" id="lab-load-ed" aria-label="Cargar editor SuperSplat">${icon('cube')} Cargar editor</button>`;
    lazyBox.querySelector('button').addEventListener('click', arm);
  };
  lazyBox.hidden = armed;
  wrapEmpty(!armed);
  drop.appendChild(lazyBox);
  const arm = () => {
    if (armed) return;
    armed = true; lazyBox.hidden = true; wrapEmpty(false);
    const s = splats[cur];
    if (s) frame.src = abRaw
      ? `/supersplat/?load=${encodeURIComponent('/' + rawUrl(s))}&filename=${encodeURIComponent(s.clip_id + '.raw.splat')}`
      : editorUrl(s);
  };
  const load = (i, user) => {
    if (!splats[i]) return;
    cur = i;
    if (user && !armed) { armed = true; lazyBox.hidden = true; wrapEmpty(false); }
    if (armed) frame.src = editorUrl(splats[i]);
    renderPicker(); renderActions(); renderClean();
  };

  picker.addEventListener('click', e => {
    const t = e.target.closest('.sl-switch-btn');
    if (t) openPicker(t);
  });

  // ---- subida del splat editado (botón o drag&drop) ----
  const statusEl = () => document.getElementById('lab-status');
  // setStatus re-consulta el nodo cada vez (load() re-renderiza las acciones → el span cambia) (#35)
  const setStatus = t => { const el = statusEl(); if (el) { el.textContent = t; el.classList.toggle('err', /^Error|^formato/.test(t)); } };
  async function publish(file) {
    const s = splats[cur];                                // captura el clip fijo (#34)
    if (!s || !file) return;
    if (!/\.(ply|splat|ksplat)$/i.test(file.name)) { setStatus('formato no soportado (.ply/.splat/.ksplat)'); return; }
    if (!(await okToDiscard())) return;
    setStatus(`Subiendo ${file.name} (${(file.size / 1e6).toFixed(1)}MB)…`);
    try {
      const r = await authFetch(`/api/splat_upload?cid=${encodeURIComponent(s.clip_id)}&name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file });
      const out = await r.json();
      if (!r.ok || out.error) throw new Error(out.error || r.status);
      await load_sys();                                   // manifest fresco
      const idx = splats.findIndex(x => x.clip_id === s.clip_id);
      if (idx >= 0) cur = idx;                            // no forces 0 si no se encuentra (#41)
      load(cur);                                          // editor recarga la versión nueva
      setStatus(`publicado ${out.published}${out.ksplat ? ' + ' + out.ksplat : ''} · anterior en history/`);  // DESPUÉS de load (#37/#40)
    } catch (err) {
      setStatus(`Error: ${String(err.message || err).slice(0, 80)}`);
    }
  }
  fileIn.addEventListener('change', () => { publish(fileIn.files[0]); fileIn.value = ''; });
  // drag&drop: contador de profundidad (dragleave dispara al cruzar hijos → parpadeo sin él) (#33/#36/#43)
  // el <iframe> (same-origin /supersplat/) se traga los eventos de drag y jamás llegan a #lab-drop:
  // mientras hay un drag de ARCHIVOS activo le quitamos pointer-events para que dragover/drop caigan
  // en la zona de abajo. Sólo para 'Files' → no rompe el DnD interno de SuperSplat (capas/paneles).
  let dragDepth = 0;
  const isFileDrag = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  const armFrame = () => { frame.style.pointerEvents = 'none'; };
  const disarmFrame = () => { frame.style.pointerEvents = ''; };
  drop.addEventListener('dragenter', e => { e.preventDefault(); if (isFileDrag(e)) armFrame(); if (dragDepth++ === 0) hint.hidden = false; });
  drop.addEventListener('dragover', e => e.preventDefault());
  drop.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; hint.hidden = true; disarmFrame(); } });
  drop.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; hint.hidden = true; disarmFrame();
    if (e.dataTransfer?.files[0]) publish(e.dataTransfer.files[0]);
  });
  // un drag que entra DIRECTO sobre el editor dispara dragenter dentro del iframe (same-origin):
  // lo detectamos ahí y desarmamos el iframe → el siguiente dragover ya cae en #lab-drop.
  frame.addEventListener('load', () => {
    try {
      const idoc = frame.contentDocument;
      if (!idoc) return;
      idoc.addEventListener('dragenter', e => { if (isFileDrag(e)) { armFrame(); hint.hidden = false; } }, true);
      idoc.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); }, true);
    } catch { /* cross-origin: no aplica en el mismo host */ }
  });

  // ---- pantalla completa CSS (el Fullscreen API de iOS Safari solo funciona en <video>)
  //      con botón de salida siempre visible + Esc en desktop ----
  const exitBtn = document.getElementById('lab-exit');
  const setFull = on => {
    drop.classList.toggle('lab-fullscreen', on);
    exitBtn.hidden = !on;
    document.documentElement.classList.toggle('lab-noscroll', on);
  };
  document.getElementById('lab-full').addEventListener('click', () => { arm(); setFull(true); });
  exitBtn.addEventListener('click', () => setFull(false));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tp = document.getElementById('lab-tune-panel');
    if (tp.classList.contains('open') && tp.contains(document.activeElement)) { setTune(false); document.getElementById('lab-tune')?.focus(); return; }
    setFull(false);
  });

  // ---- ajuste fino del editor (same-origin): el cubo de vista y la barra derecha de SuperSplat
  //      se pisaban cuando el marco es bajo → cubo más compacto y barra siempre por debajo ----
  frame.addEventListener('load', () => {
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById('ab-lab-css')) return;
      const st = doc.createElement('style');
      st.id = 'ab-lab-css';
      st.textContent = `body:not(.ab-mobile) #view-cube-container { transform: scale(.72); transform-origin: top right; }
        body:not(.ab-mobile) #right-toolbar { top: max(50%, 300px) !important; }`;
      doc.head.appendChild(st);
    } catch { /* mismo origen: no debería fallar */ }
  });

  // ---- capa móvil: inyecta CSS + pestaña del drawer DENTRO del iframe (same-origin).
  //      SuperSplat es desktop-first; en <768px su panel izquierdo tapa el canvas ----
  const MOBILE = matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 1024px)');
  frame.addEventListener('load', () => {
    if (!MOBILE.matches) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById('ab-mobile-css')) return;
      const link = doc.createElement('link');
      link.id = 'ab-mobile-css'; link.rel = 'stylesheet';
      link.href = '/supersplat-mobile.css?v=' + Date.now();
      doc.head.appendChild(link);
      doc.body.classList.add('ab-mobile');
      // nota: el drawer del panel izquierdo NO se duplica — SuperSplat ya trae su
      // colapso responsive nativo (body.collapsed + botón ">")
    } catch { /* cross-origin imposible aquí (mismo host), pero por si acaso */ }
  });

  // primera vez en táctil: hint de gestos (el modelo mental Google Earth)
  if (matchMedia('(pointer: coarse)').matches && !localStorage.getItem('ab.lab.gestures')) {
    const g = document.createElement('div');
    g.className = 'lab-gestures';
    g.innerHTML = '<b>1 dedo</b> orbitar · <b>pellizco</b> zoom · <b>2 dedos</b> mover · <b>Auto-Clean</b> limpia con un tap<button aria-label="Entendido">Entendido</button>';
    document.querySelector('.lab-frame-wrap')?.appendChild(g);
    g.querySelector('button').addEventListener('click', () => {
      localStorage.setItem('ab.lab.gestures', '1'); g.remove();
    });
  }

  window.addEventListener('message', e => {
    if (!fromEditor(e)) return;
    const d = e.data;
    if (!d || d.type !== 'aerobrain:autoclean:done') return;
    const el = document.getElementById('lab-clean-status');
    if (!el) return;
    const r = d.result || {};
    if (r.error) { el.textContent = `Error: ${r.error}`; el.classList.add('err'); return; }
    el.classList.remove('err');
    const rm = r.removed || {};
    el.textContent = r.note ? `${r.note}` :
      `${(r.selected || 0).toLocaleString()} gaussianas borradas (un undo lo deshace) · neblina ${rm.opacity || 0} · picos ${rm.scale || 0} · agujas ${rm.aniso || 0} · borde ${rm.radial || 0} — File→Export y súbelo para publicar`;
    // contadores vivos por etapa en el wizard
    [['tn-op-c', rm.opacity], ['tn-k-c', (rm.scale || 0) + (rm.bbox || 0)],
     ['tn-an-c', rm.aniso], ['tn-rad-c', rm.radial]].forEach(([id, n]) => {
      const c = document.getElementById(id);
      if (c) c.textContent = n ? `−${(+n).toLocaleString()}` : '';
    });
  });

  renderPicker(); renderActions();
  if (splats.length) load(0);
})();
