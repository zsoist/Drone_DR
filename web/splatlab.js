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
    splats = sys.splats || [];
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
    <div class="deck-greet mono" style="margin-bottom:2px">edición de gaussian splats · SuperSplat</div>
    <div class="lab-bar" role="toolbar" aria-label="Splats disponibles">
      <h1 class="lab-h">Splat Lab</h1>
      <div class="lab-picker" id="lab-picker"></div>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="lab-full" title="Editor a pantalla completa (Esc para salir)" aria-label="Editor a pantalla completa">${icon('fit')} Completo</button>
    </div>
    <div class="lab-actions" id="lab-actions" role="toolbar" aria-label="Acciones del splat"></div>
    <div class="lab-clean" id="lab-clean" role="toolbar" aria-label="Auto-Clean del splat"></div>
    <div class="lab-frame-wrap" id="lab-drop">
      <iframe id="lab-frame" class="lab-frame" allow="fullscreen" title="Editor SuperSplat"></iframe>
      <button class="btn lab-exit" id="lab-exit" hidden aria-label="Salir de pantalla completa">✕ Salir</button>
      <div class="lab-drophint" id="lab-drophint" hidden>Suelta el splat editado (.ply / .splat / .ksplat) para publicarlo</div>
    </div>
    <p class="footer-note lab-tip"><b>Flujo:</b> limpia floaters con pincel/lazo + borrar · recorta con crop ·
      <b>File → Export</b> descarga el resultado · súbelo aquí (botón o arrástralo) y queda publicado —
      la versión anterior se archiva en <span class="mono">splats/history/</span>.</p>
    <input type="file" id="lab-file" accept=".ply,.splat,.ksplat" hidden aria-hidden="true">`;

  const frame = document.getElementById('lab-frame');
  const picker = document.getElementById('lab-picker');
  const actions = document.getElementById('lab-actions');
  const fileIn = document.getElementById('lab-file');
  const drop = document.getElementById('lab-drop');
  const hint = document.getElementById('lab-drophint');

  const renderPicker = () => {
    picker.innerHTML = splats.map((s, i) => `
      <button class="chip ${i === cur ? 'on' : ''}" data-i="${i}" title="${esc(s.name)}"
              aria-pressed="${i === cur}">
        ${esc(title(s))} <span class="mono" style="opacity:.6">${(s.bytes / 1e6).toFixed(1)}MB</span>
      </button>`).join('') ||
      '<span class="footer-note">Sin splats aún — entrena uno en el tab 3D.</span>';
  };
  const renderActions = () => {
    const s = splats[cur];
    if (!s) { actions.innerHTML = ''; return; }
    actions.innerHTML = `
      <a class="btn" href="${splatUrl(s)}" download title="Descarga el .splat actual tal cual está publicado" aria-label="Descargar splat actual">${icon('dl')} Descargar</a>
      <button class="btn" id="lab-upload" title="Sube un splat editado (.ply/.splat/.ksplat) — la versión anterior se archiva en history/" aria-label="Subir splat editado">${icon('save')} Subir editado</button>
      <a class="btn" href="share.html?m=${encodeURIComponent(s.clip_id)}" target="_blank" title="Abre el visor privado de este modelo" aria-label="Abrir visor privado">${icon('ext')} Abrir visor</a>
      <a class="btn" href="tresd.html" title="Abre el proyecto en el tab 3D (mapa, malla, nube)" aria-label="Ver en el tab 3D">${icon('cube')} Ver en 3D</a>
      <span class="footer-note mono" id="lab-status" role="status" aria-live="polite"></span>`;
    document.getElementById('lab-upload').addEventListener('click', () => fileIn.click());
    renderClean();
  };
  const rawUrl = s => 'data/splats/' + encodeURIComponent(`${s.clip_id}.raw.splat`);
  let abRaw = false;                       // A/B: viendo el crudo pre-clean en el editor
  function renderClean() {
    const s = splats[cur];
    const box = document.getElementById('lab-clean');
    if (!s || !box) { if (box) box.innerHTML = ''; return; }
    box.innerHTML = `
      <span class="lab-clean-lb mono">AUTO-CLEAN</span>
      <select class="ctl" id="lab-preset" title="Preset de limpieza — aéreo conserva estructuras dispersas legítimas; agresivo quita más spray de borde">
        <option value="aerial">Aéreo (seguro)</option>
        <option value="aerial_aggressive">Aéreo agresivo</option>
        <option value="object">Objeto / interior</option>
      </select>
      <button class="btn primary" id="lab-ac-ed" title="Limpia DENTRO del editor: selecciona floaters/haze/agujas y los borra como pasos de undo (Ctrl+Z ×2 deshace; Edit→Reset restaura todo). Luego File→Export para publicar">${icon('spark')} Limpiar en editor</button>
      <button class="btn" id="lab-ac" title="Limpia el archivo PUBLICADO en el servidor (mismo motor) — reversible con Revertir">${icon('save')} Limpiar publicado</button>
      <button class="btn" id="lab-revert" title="Restaura el crudo pre-clean como versión actual (la limpia queda en history/) — nada se pierde">${icon('undo')} Revertir</button>
      <button class="btn" id="lab-undo" title="Deshace el último paso dentro del editor (el Auto-Clean es UN solo paso)" aria-label="Deshacer en el editor">${icon('undo')}</button>
      <button class="btn" id="lab-redo" title="Rehace el paso deshecho dentro del editor" aria-label="Rehacer en el editor" style="transform:scaleX(-1)">${icon('undo')}</button>
      <button class="btn" id="lab-ab" title="Alterna el editor entre el crudo y la versión actual para comparar antes/después" aria-pressed="${abRaw}">${abRaw ? 'Viendo: crudo' : 'A/B crudo'}</button>
      <button class="btn" id="lab-tune" title="Ajustes finos del Auto-Clean: umbral de haze, factor de spikes y agujas — se aplican al próximo Limpiar" aria-expanded="false">${icon('gauge')} Ajustes</button>
      <span class="footer-note mono" id="lab-clean-status" role="status" aria-live="polite"></span>
      <div class="lab-tune-panel" id="lab-tune-panel" hidden>
        <div class="tn-stage" title="Gaussianas casi transparentes = niebla/haze. Desmarca para conservarlas">
          <input type="checkbox" id="tn-op-on" checked><span class="tn-lb">HAZE</span>
          <input type="range" id="tn-op" min="0.5" max="20" value="3.5" step="0.5"><b class="mono" id="tn-op-v">3.5%</b>
          <em class="mono tn-count" id="tn-op-c"></em></div>
        <div class="tn-stage" title="Gaussianas gigantes vs la mediana = spikes/blobs. Más bajo = más agresivo">
          <input type="checkbox" id="tn-k-on" checked><span class="tn-lb">SPIKES</span>
          <input type="range" id="tn-k" min="2" max="10" value="6" step="0.5"><b class="mono" id="tn-k-v">6.0×</b>
          <em class="mono tn-count" id="tn-k-c"></em></div>
        <div class="tn-stage" title="Agujas: eje máximo >> eje intermedio (no toca discos-superficie). Más bajo = más agujas fuera">
          <input type="checkbox" id="tn-an-on" checked><span class="tn-lb">AGUJAS</span>
          <input type="range" id="tn-an" min="5" max="25" value="15" step="1"><b class="mono" id="tn-an-v">15</b>
          <em class="mono tn-count" id="tn-an-c"></em></div>
        <div class="tn-stage" title="Spray radial más allá del footprint de vuelo. Desmarca si tu escena es alargada">
          <input type="checkbox" id="tn-rad-on" checked><span class="tn-lb">BORDE</span>
          <input type="range" id="tn-rad" min="95" max="99.9" value="99.5" step="0.1"><b class="mono" id="tn-rad-v">P99.5</b>
          <em class="mono tn-count" id="tn-rad-c"></em></div>
        <p class="footer-note" style="flex-basis:100%;margin:2px 0 0">Cada limpieza es UN paso de undo — prueba, mira los contadores por etapa, deshaz y ajusta.</p>
      </div>`;
    const cst = t => { const el = document.getElementById('lab-clean-status'); if (el) el.textContent = t; };
    // limpieza IN-EDITOR: postMessage al iframe (fork src/aerobrain) — undo nativo de SuperSplat
    const tuneOverrides = () => {
      const panel = document.getElementById('lab-tune-panel');
      if (!panel || panel.hidden) return undefined;          // solo si el usuario abrió Ajustes
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
      try { frame.contentWindow.postMessage({ type: 'aerobrain:autoclean', preset, overrides: tuneOverrides() }, '*'); }
      catch { cst('✗ el editor no respondió'); }
    });
    document.getElementById('lab-tune').addEventListener('click', e2 => {
      const panel = document.getElementById('lab-tune-panel');
      panel.hidden = !panel.hidden;
      e2.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
    });
    [['tn-op', v => v + '%'], ['tn-k', v => (+v).toFixed(1) + '×'], ['tn-an', v => v],
     ['tn-rad', v => 'P' + v]].forEach(([id, f]) => {
      document.getElementById(id).addEventListener('input', e2 =>
        document.getElementById(id + '-v').textContent = f(e2.target.value));
    });
    document.getElementById('lab-ac').addEventListener('click', async e2 => {
      const btn = e2.currentTarget; btn.disabled = true;
      const preset = document.getElementById('lab-preset').value;
      cst('limpiando…');
      try {
        const r = await authFetch(`/api/splat_autoclean?cid=${encodeURIComponent(s.clip_id)}&preset=${preset}`, { method: 'POST' });
        const out = await r.json();
        if (!r.ok || out.error) throw new Error(out.error || r.status);
        const rep = out.report, rm = rep.removed;
        cst(`✓ ${rep.input.toLocaleString()} → ${rep.output.toLocaleString()} (${rep.kept_pct}%) · haze ${rm.opacity} · spikes ${rm.scale} · agujas ${rm.aniso} · voxel ${rm.voxel}`);
        await load_sys(); abRaw = false; load(cur);
      } catch (err) { cst(`✗ ${String(err.message || err).slice(0, 90)}`); }
      finally { btn.disabled = false; }
    });
    document.getElementById('lab-undo').addEventListener('click', () =>
      frame.contentWindow?.postMessage({ type: 'aerobrain:undo' }, '*'));
    document.getElementById('lab-redo').addEventListener('click', () =>
      frame.contentWindow?.postMessage({ type: 'aerobrain:redo' }, '*'));
    document.getElementById('lab-revert').addEventListener('click', async () => {
      cst('revirtiendo al crudo…');
      try {
        const r = await authFetch(`/api/splat_revert?cid=${encodeURIComponent(s.clip_id)}&to=raw`, { method: 'POST' });
        const out = await r.json();
        if (!r.ok || out.error) throw new Error(out.error || r.status);
        cst('✓ crudo restaurado como actual · la limpia quedó en history/');
        await load_sys(); abRaw = false; load(cur);
      } catch (err) { cst(`✗ ${String(err.message || err).slice(0, 90)}`); }
    });
    document.getElementById('lab-ab').addEventListener('click', () => {
      abRaw = !abRaw;
      const src = abRaw
        ? `/supersplat/?load=${encodeURIComponent('/' + rawUrl(s))}&filename=${encodeURIComponent(s.clip_id + '.raw.splat')}`
        : editorUrl(s);
      frame.src = src;
      renderClean();
    });
  }
  const load = i => {
    if (!splats[i]) return;
    cur = i;
    frame.src = editorUrl(splats[i]);
    renderPicker(); renderActions(); renderClean();
  };

  picker.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) load(+b.dataset.i);
  });

  // ---- subida del splat editado (botón o drag&drop) ----
  const statusEl = () => document.getElementById('lab-status');
  // setStatus re-consulta el nodo cada vez (load() re-renderiza las acciones → el span cambia) (#35)
  const setStatus = t => { const el = statusEl(); if (el) el.textContent = t; };
  async function publish(file) {
    const s = splats[cur];                                // captura el clip fijo (#34)
    if (!s || !file) return;
    if (!/\.(ply|splat|ksplat)$/i.test(file.name)) { setStatus('formato no soportado (.ply/.splat/.ksplat)'); return; }
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
      setStatus(`✓ publicado ${out.published}${out.ksplat ? ' + ' + out.ksplat : ''} · anterior en history/`);  // DESPUÉS de load (#37/#40)
    } catch (err) {
      setStatus(`✗ ${String(err.message || err).slice(0, 80)}`);
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
  document.getElementById('lab-full').addEventListener('click', () => setFull(true));
  exitBtn.addEventListener('click', () => setFull(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setFull(false); });

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
    g.innerHTML = '<b>1 dedo</b> orbitar · <b>pellizco</b> zoom · <b>2 dedos</b> mover · <b>⚡ Auto-Clean</b> limpia con un tap<button aria-label="Entendido">Entendido</button>';
    document.querySelector('.lab-frame-wrap')?.appendChild(g);
    g.querySelector('button').addEventListener('click', () => {
      localStorage.setItem('ab.lab.gestures', '1'); g.remove();
    });
  }

  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'aerobrain:autoclean:done') return;
    const el = document.getElementById('lab-clean-status');
    if (!el) return;
    const r = d.result || {};
    if (r.error) { el.textContent = `✗ ${r.error}`; return; }
    const rm = r.removed || {};
    el.textContent = r.note ? `✓ ${r.note}` :
      `✓ ${(r.selected || 0).toLocaleString()} gaussianas borradas (un undo lo deshace) · haze ${rm.opacity || 0} · spikes ${rm.scale || 0} · agujas ${rm.aniso || 0} · borde ${rm.radial || 0} — File→Export y súbelo para publicar`;
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
