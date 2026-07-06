// Studio v5 — motor de medios: 4 módulos en tabs (Editor · Reels · Fotos · Trabajos).
// El editor de video v4 (carrusel, timeline arrastrable, Momentos AI, exportbar) vive
// intacto dentro del módulo Editor; Reels/Fotos gestionan la biblioteca vía /api/media_op.
const main = renderShell('studio.html');
main.innerHTML = `
  <div class="st-hero rise">
    <h1>Studio</h1>
    <p style="color:var(--text-2);font-size:14px;margin:0 0 12px">Motor de medios — edita, gestiona y comparte</p>
    <span class="gchip" id="st-count">cargando…</span>
  </div>

  <div class="pm-tabs rise" id="st-tabs" style="margin-bottom:14px">
    <button class="on" data-tab="editor">${icon('film')} Editor</button>
    <button data-tab="reels">${icon('play')} Reels</button>
    <button data-tab="fotos">${icon('iso')} Fotos</button>
    <button data-tab="jobs">${icon('activity')} Trabajos</button>
    <span class="pm-ink"></span>
  </div>

  <section class="st-mod" data-mod="editor">
    <div class="tl-editor" id="tl-editor">

      <!-- encabezado del editor: contador de clips + longitud del reel -->
      <div class="panel" style="margin-bottom:14px">
        <div class="ph">${icon('film')} Editor
          <span class="spacer"></span>
          <span class="gchip" id="tl-stat">0 clips · 0:00</span>
        </div>
        <div class="pb">

          <!-- 28-35 · escenario del compositor -->
          <div class="tl-stage" id="tl-stage">
            <video class="tl-video" id="tl-video" playsinline webkit-playsinline preload="auto" muted></video>
            <div class="tl-aspect-mask" id="tl-mask" data-aspect="16:9"></div>
            <div class="tl-empty" id="tl-empty">
              ${icon('film')}
              <p><b>Tu timeline está vacío</b></p>
              <p>Toca un clip de la biblioteca para añadirlo, o usa <b>Momentos AI</b> para autoarmar el reel.</p>
            </div>
          </div>

          <!-- 32-35 · transporte -->
          <div class="tl-transport" id="tl-transport">
            <button class="tl-tool" data-tp="start" data-tip="Inicio">⏮</button>
            <button class="tl-tool" data-tp="prev" data-tip="Clip anterior">◁</button>
            <button class="tl-tool" data-tp="play" data-tip="Reproducir / Pausa">${icon('play')}</button>
            <button class="tl-tool" data-tp="next" data-tip="Clip siguiente">▷</button>
            <button class="tl-tool" data-tp="end" data-tip="Final">⏭</button>
            <button class="tl-tool" data-tp="mute" data-tip="Silenciar">🔊</button>
            <button class="tl-tool" data-tp="loop" data-tip="Bucle">↻</button>
            <span class="spacer"></span>
            <span class="tl-time mono" id="tl-time">0:00 / 0:00</span>
          </div>

          <!-- 12,14,15,16,17 + zoom 5,6 · barra de herramientas -->
          <div class="tl-toolbar" id="tl-toolbar">
            <button class="tl-tool" data-tool="razor" data-tip="Cortar en playhead (S)">${icon('layers')} Cortar</button>
            <button class="tl-tool" data-tool="dup" data-tip="Duplicar clip">${icon('copy')}</button>
            <button class="tl-tool" data-tool="left" data-tip="Mover ← (⌥←)">←</button>
            <button class="tl-tool" data-tool="right" data-tip="Mover → (⌥→)">→</button>
            <button class="tl-tool" data-tool="del" data-tip="Eliminar (Supr)">${icon('warn')}</button>
            <span class="spacer"></span>
            <button class="tl-tool" data-tool="magic" id="btn-magic" data-tip="Autoarmar highlights">${icon('spark')} Momentos AI</button>
            <button class="tl-tool" data-tool="clear" data-tip="Limpiar timeline">Limpiar</button>
            <span style="width:8px"></span>
            <button class="tl-tool" data-tool="zoomout" data-tip="Alejar">−</button>
            <button class="tl-tool" data-tool="zoomin" data-tip="Acercar">+</button>
            <button class="tl-tool" data-tool="fit" data-tip="Ajustar a ventana">${icon('grid')} Ajustar</button>
          </div>

          <!-- 3,4,7 · regla + track con scroll horizontal -->
          <div class="tl-scroll" id="tl-scroll">
            <div class="tl-ruler" id="tl-ruler"></div>
            <div class="tl-track" id="tl-track"></div>
            <div class="tl-playhead" id="tl-playhead"></div>
          </div>

          <!-- 18-23 · inspector del clip seleccionado -->
          <div class="tl-inspect" id="tl-inspect" style="display:none">
            <div class="tl-inspect-row">
              <span class="mono" id="tli-io">—</span>
              <span class="spacer"></span>
              <button class="btn" id="tli-goto" data-tip="Ir al clip">${icon('play')} Ir al clip</button>
            </div>
            <div class="tl-inspect-row">
              <label>Velocidad</label>
              <span id="tli-speed" class="tl-chips"></span>
            </div>
            <div class="tl-inspect-row">
              <label>Look</label>
              <select class="ctl" id="tli-filter">
                <option value="none">Sin look</option><option value="cine">Cine</option>
                <option value="vivid">Vivid</option><option value="warm">Cálido</option>
                <option value="moody">Moody</option><option value="bw">B&amp;N</option>
              </select>
              <label>Transición</label>
              <select class="ctl" id="tli-trans">
                <option value="none">Ninguna</option><option value="fade">Fade</option><option value="crossfade">Crossfade</option>
              </select>
            </div>
            <div class="tl-inspect-row">
              <label>Título</label>
              <input class="ctl" id="tli-title" placeholder="Título de este corte…" maxlength="60" style="flex:1">
            </div>
          </div>
        </div>
      </div>

      <!-- 24-27 · biblioteca de clips fuente -->
      <div class="tl-lib panel" style="margin-bottom:14px">
        <div class="ph">${icon('layers')} Clips fuente
          <span class="spacer"></span>
          <span class="footer-note" style="font-size:11px">Toca = añadir al final · ⊕ = insertar en playhead</span>
        </div>
        <div class="pb"><div class="clip-rail" id="rail"></div></div>
      </div>

      <!-- 47 · barra de export -->
      <div class="exportbar" id="exportbar" style="display:none">
        <select class="ctl" id="ed-aspect">
          <option value="16:9">16:9</option><option value="9:16">9:16 Reels</option>
          <option value="1:1">1:1</option><option value="4:5">4:5</option>
        </select>
        <select class="ctl" id="ed-lut" data-tip="Look de respaldo global">
          <option value="none">Sin look</option><option value="cine">Cine</option>
          <option value="vivid">Vivid</option><option value="warm">Cálido</option>
          <option value="moody">Moody</option><option value="bw">B&amp;N</option>
        </select>
        <select class="ctl" id="ed-trans" data-tip="Transición por defecto">
          <option value="none">Sin transición</option><option value="fade">Fade</option><option value="crossfade" selected>Crossfade</option>
        </select>
        <select class="ctl" id="ed-audio" data-tip="Audio del reel">
          <option value="none">Silencio</option><option value="original">Audio original</option>
        </select>
        <input class="ctl" id="ed-title" placeholder="Título…" style="flex:1;min-width:110px" maxlength="60">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ed-fade" checked>Fades</label>
        <button class="btn primary big" id="ed-export">${icon('check')} Exportar</button>
      </div>

      <!-- 48 · ayuda de atajos -->
      <details class="tl-help" id="tl-help">
        <summary>${icon('clock')} Atajos de teclado</summary>
        <div class="tl-help-body">
          <span><kbd>Espacio</kbd> reproducir/pausa</span>
          <span><kbd>S</kbd> cortar en playhead</span>
          <span><kbd>Supr</kbd> eliminar clip</span>
          <span><kbd>←</kbd><kbd>→</kbd> mover playhead · <kbd>⇧</kbd> = 1s</span>
          <span><kbd>⌥←</kbd><kbd>⌥→</kbd> reordenar clip</span>
          <span><kbd>⌘Z</kbd> deshacer · <kbd>⌘⇧Z</kbd> rehacer</span>
        </div>
      </details>

      <!-- panel Mejores momentos (lógica intacta) -->
      <div class="panel" style="margin-top:16px;max-width:640px">
        <div class="ph">${icon('spark')} Mejores momentos</div>
        <div class="pb" id="moments"><div class="sk" style="height:80px"></div></div>
      </div>
    </div>
  </section>

  <section class="st-mod" data-mod="reels" style="display:none">
    <div class="media-toolbar">
      <input class="ctl" id="q-reels" type="search" placeholder="Buscar reel…" style="flex:1;min-width:150px">
      <select class="ctl" id="s-reels">
        <option value="recientes">Recientes</option>
        <option value="tamano">Tamaño</option>
        <option value="nombre">Nombre</option>
      </select>
    </div>
    <div class="media-grid" id="grid-reels"><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div></div>
  </section>

  <section class="st-mod" data-mod="fotos" style="display:none">
    <div class="media-toolbar">
      <input class="ctl" id="q-fotos" type="search" placeholder="Buscar foto…" style="flex:1;min-width:150px">
      <select class="ctl" id="s-fotos">
        <option value="recientes">Recientes</option>
        <option value="tamano">Tamaño</option>
        <option value="nombre">Nombre</option>
      </select>
    </div>
    <div class="media-grid" id="grid-fotos"><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div></div>
  </section>

  <section class="st-mod" data-mod="jobs" style="display:none">
    <div class="panel">
      <div class="ph">${icon('activity')} Trabajos</div>
      <div class="pb" id="jobs"></div>
    </div>
  </section>`;

// ---- tabs de módulo con tinta deslizante (mismo patrón que el photo editor) ----
const stTabs = document.getElementById('st-tabs');
const stInk = stTabs.querySelector('.pm-ink');
function moveInk() {
  const on = stTabs.querySelector('button.on');
  stInk.style.left = on.offsetLeft + 'px';
  stInk.style.width = on.offsetWidth + 'px';
}
setTimeout(moveInk, 30);   // tras layout; rAF no dispara con tab oculto
window.addEventListener('resize', () => setTimeout(moveInk, 30));

function showMod(name) {
  stTabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  moveInk();
  document.querySelectorAll('.st-mod').forEach(m => {
    const show = m.dataset.mod === name;
    if (show && m.style.display === 'none') {
      m.style.display = '';
      m.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'translateX(0)' }],
                { duration: 220, easing: 'ease-out' });
    } else if (!show) m.style.display = 'none';
  });
}
stTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showMod(b.dataset.tab);
});

// ---- motor de medios: biblioteca de reels y fotos ----
let media = null;   // {reels:[{name,bytes,mtime}], photos:[...]}
const mstate = { reels: { q: '', sort: 'recientes' }, fotos: { q: '', sort: 'recientes' } };

function mdate(mtime) {
  const d = new Date(mtime * 1000);
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

async function loadMedia() {
  let r = null;
  try { r = await fetch('/api/studio_media'); } catch {}   // cookie de sesión viaja sola
  if (!r || r.status !== 200) { authGate(); return; }
  media = await r.json();
  document.getElementById('st-count').textContent =
    `${(media.reels || []).length} reels · ${(media.photos || []).length} fotos`;
  renderGrid('reels');
  renderGrid('fotos');
}

function authGate() {
  const html = `<div class="empty" style="grid-column:1/-1">
    <p>Inicia sesión para gestionar medios</p>
    <button class="btn primary" data-login style="margin-top:12px">Iniciar sesión</button></div>`;
  document.getElementById('grid-reels').innerHTML = html;
  document.getElementById('grid-fotos').innerHTML = html;
  document.getElementById('st-count').textContent = 'sesión requerida';
}
main.addEventListener('click', async e => {
  if (e.target.closest('[data-login]') && await ensureAuth()) loadMedia();
});

function viewOf(kind) {
  const list = ((kind === 'reels' ? media.reels : media.photos) || []).slice();
  const st = mstate[kind], q = st.q.trim().toLowerCase();
  const out = q ? list.filter(x => x.name.toLowerCase().includes(q)) : list;
  if (st.sort === 'tamano') out.sort((a, b) => b.bytes - a.bytes);
  else if (st.sort === 'nombre') out.sort((a, b) => a.name.localeCompare(b.name));
  else out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function cardHTML(kind, it) {
  const enc = encodeURIComponent(it.name);
  const base = it.name.replace(/\.[^.]+$/, '');
  const prev = kind === 'reels'
    ? `<video src="/data/reels/${enc}#t=0.5" preload="metadata" muted playsinline loop></video>
       <span class="gchip m-dur" style="display:none"></span>`
    : `<img loading="lazy" src="/data/photos/${enc}" alt="${esc(base)}" style="cursor:pointer">`;
  return `<div class="m-card" data-name="${esc(it.name)}">
    <div class="m-prevbox">${prev}</div>
    <div class="m-name">${esc(base)}</div>
    <div class="m-meta mono">${fmt.gb(it.bytes)} · ${mdate(it.mtime)}</div>
    <div class="m-actions">
      <button data-act="share" data-tip="Compartir">${icon('ext')}</button>
      <button data-act="dl" data-tip="Descargar">${icon('dl')}</button>
      <button data-act="dup" data-tip="Duplicar">${icon('copy')}</button>
      <button data-act="ren" data-tip="Renombrar">${icon('tag')}</button>
      <button class="danger" data-act="del" data-tip="Eliminar">${icon('warn')}</button>
    </div>
  </div>`;
}

function renderGrid(kind) {
  const grid = document.getElementById(`grid-${kind}`);
  const items = viewOf(kind);
  grid.innerHTML = items.map(it => cardHTML(kind, it)).join('') ||
    `<div class="empty" style="grid-column:1/-1">${kind === 'reels' ? 'Aún no hay reels — exporta uno desde el Editor.' : 'Aún no hay fotos capturadas.'}</div>`;
  if (kind === 'reels') grid.querySelectorAll('video').forEach(v => {
    v.addEventListener('loadedmetadata', () => {
      const chip = v.parentElement.querySelector('.m-dur');
      if (chip && isFinite(v.duration)) { chip.textContent = fmt.dur(v.duration); chip.style.display = ''; }
    });
    // preview al pasar el mouse; al salir vuelve al frame de portada
    v.addEventListener('mouseenter', () => v.play().catch(() => {}));
    v.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0.5; });
  });
}

async function onCardClick(kind, e) {
  const card = e.target.closest('.m-card');
  if (!card) return;
  const name = card.dataset.name;
  const type = kind === 'reels' ? 'reel' : 'photo';
  const url = `/data/${kind === 'reels' ? 'reels' : 'photos'}/${encodeURIComponent(name)}`;
  const btn = e.target.closest('[data-act]');

  if (!btn) {
    // fotos: tap en la imagen abre el editor premium (photoeditor.js)
    if (kind === 'fotos' && e.target.closest('.m-prevbox')) openPhotoEditor({ url, name });
    return;
  }
  const act = btn.dataset.act;

  if (act === 'dl') {
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    return;
  }
  if (act === 'share') {
    let file = null;
    try {
      const blob = await (await fetch(url)).blob();
      file = new File([blob], name, { type: blob.type || (kind === 'reels' ? 'video/mp4' : 'image/jpeg') });
    } catch {}
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch {}   // cancelar no es error
      return;
    }
    const a = document.createElement('a');   // fallback sin Web Share: descarga
    a.href = url; a.download = name; a.click();
    return;
  }

  let body = null;
  if (act === 'dup') body = { op: 'duplicate', type, name };
  if (act === 'del') {
    if (!confirm(`Se moverá a la papelera. ¿Eliminar "${name}"?`)) return;
    body = { op: 'delete', type, name };
  }
  if (act === 'ren') {
    const dot = name.lastIndexOf('.');
    const nn = prompt('Nuevo nombre:', dot > 0 ? name.slice(0, dot) : name);
    if (!nn || !nn.trim()) return;
    body = { op: 'rename', type, name, new_name: nn.trim() };
  }
  if (!body) return;
  const r = await api('/api/media_op', body);
  if (r.error) { alert(r.error); return; }
  await loadMedia();
}

for (const kind of ['reels', 'fotos']) {
  document.getElementById(`q-${kind}`).addEventListener('input', e => {
    mstate[kind].q = e.target.value;
    if (media) renderGrid(kind);
  });
  document.getElementById(`s-${kind}`).addEventListener('change', e => {
    mstate[kind].sort = e.target.value;
    if (media) renderGrid(kind);
  });
  document.getElementById(`grid-${kind}`).addEventListener('click', e => onCardClick(kind, e));
}
loadMedia();

// ---- módulo Trabajos ----
pollJobs(document.getElementById('jobs'));

// ---- módulo Editor (v5 · timeline horizontal tipo CapCut/Premiere) ----
(async () => {
  const flights = await getFlights();
  const ai = await getAIAll(flights);
  const editable = flights.filter(f => f.has_proxy && !f.archived);
  const byId = Object.fromEntries(editable.map(f => [f.clip_id, f]));

  // filtros CSS por LUT (idénticos al backend/export)
  const CSS_LUTS = { none: '', cine: 'contrast(1.07) saturate(1.1) hue-rotate(-6deg)',
    vivid: 'saturate(1.35) contrast(1.1)', warm: 'sepia(0.18) saturate(1.2)',
    moody: 'contrast(1.16) brightness(0.94) saturate(0.82)', bw: 'grayscale(1) contrast(1.2)' };
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

  // ---- estado (MODELO magnético: un track, sin huecos) ----
  let tl = [];                 // [{id,clip_id,a,b,speed,filter,title,transition}]
  let sel = -1;                // índice del clip seleccionado
  let pps = 60;                // px por segundo (zoom)
  let playhead = 0;            // tiempo global (s)
  let playing = false, rafId = null;
  let loop = false, muted = true;
  let undoStack = [], redoStack = [];
  let uidN = 0;
  const uid = () => `c${++uidN}_${Date.now().toString(36)}`;

  // refs
  const video   = document.getElementById('tl-video');
  const stage   = document.getElementById('tl-stage');
  const mask    = document.getElementById('tl-mask');
  const emptyEl = document.getElementById('tl-empty');
  const scroll  = document.getElementById('tl-scroll');
  const ruler   = document.getElementById('tl-ruler');
  const track   = document.getElementById('tl-track');
  const phEl    = document.getElementById('tl-playhead');
  const inspect = document.getElementById('tl-inspect');
  const statEl  = document.getElementById('tl-stat');
  const timeEl  = document.getElementById('tl-time');
  const exportbar = document.getElementById('exportbar');

  video.muted = muted;
  video.loop = false;   // el bucle lo maneja el compositor, no el <video>

  // ---- geometría del compositor ----
  const segDur = s => (s.b - s.a) / s.speed;                 // duración en timeline
  const total  = () => tl.reduce((a, s) => a + segDur(s), 0);
  const offset = i => { let o = 0; for (let k = 0; k < i; k++) o += segDur(tl[k]); return o; };
  function clipAt(gt) {                                       // {clip,idx,local}
    let o = 0;
    for (let i = 0; i < tl.length; i++) {
      const d = segDur(tl[i]);
      if (gt < o + d || i === tl.length - 1) return { clip: tl[i], idx: i, local: Math.max(0, Math.min(d, gt - o)) };
      o += d;
    }
    return null;
  }

  // ---- historial ----
  const snap = () => JSON.parse(JSON.stringify(tl));
  function pushUndo() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); tl = undoStack.pop(); clampSel(); renderAll(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); tl = redoStack.pop(); clampSel(); renderAll(); }
  function clampSel() { if (sel >= tl.length) sel = tl.length - 1; }

  // ---- render maestro ----
  function renderAll() {
    renderRuler();
    renderTrack();
    renderInspector();
    updateStat();
    syncTools();
    exportbar.style.display = tl.length ? 'flex' : 'none';
    emptyEl.style.display = tl.length ? 'none' : 'flex';
    playhead = Math.min(playhead, total());
    paintPlayhead();
    if (!tl.length) { video.removeAttribute('src'); video.load?.(); }
  }

  // 3,4 · regla de tiempo con marcas
  function renderRuler() {
    const T = total(), W = Math.max(T * pps, scroll.clientWidth || 320);
    ruler.style.width = W + 'px';
    track.style.width = W + 'px';
    // paso de marca legible según zoom
    const step = pps >= 90 ? 1 : pps >= 45 ? 2 : pps >= 22 ? 5 : 10;
    let html = '';
    for (let t = 0; t <= T + 0.001; t += step) {
      html += `<span class="tl-tick" style="left:${t * pps}px">${fmt.dur(t)}</span>`;
    }
    // 50 · markers de highlights AI sobre la regla
    tl.forEach((s, i) => {
      if (s._mark) html += `<span class="tl-tick mark" style="left:${offset(i) * pps}px" data-tip="Highlight AI">◆</span>`;
    });
    ruler.innerHTML = html;
  }

  // 1,2,10,11 · track con clips end-to-end + tira de miniaturas + manijas
  function renderTrack() {
    track.innerHTML = tl.map((s, i) => {
      const f = byId[s.clip_id];
      const w = segDur(s) * pps;
      const n = f?.frame_count || 0;
      // tira de miniaturas: frames del clip repartidos por el rango [a,b]
      const nThumbs = Math.max(1, Math.min(8, Math.round(w / 90)));
      let thumbs = '';
      for (let k = 0; k < nThumbs; k++) {
        const tt = s.a + (s.b - s.a) * ((k + 0.5) / nThumbs);
        const fi = n ? Math.max(1, Math.min(n, Math.round((tt / f.duration_s) * n))) : 0;
        const src = fi ? `${DATA}/frames/${s.clip_id}/f_${String(fi).padStart(4, '0')}.jpg`
                       : `${DATA}/thumbs/${s.clip_id}.jpg`;
        thumbs += `<img src="${src}" loading="lazy" alt="">`;
      }
      const badges = [
        s.speed !== 1 ? `<span class="tl-badge speed">${s.speed}x</span>` : '',
        s.filter && s.filter !== 'none' ? `<span class="tl-badge filter">${esc(s.filter)}</span>` : '',
        s.title ? `<span class="tl-badge title">${icon('tag')}</span>` : '',
      ].join('');
      const trans = (i > 0 && s.transition && s.transition !== 'none')
        ? `<span class="tl-trans" data-tip="${esc(s.transition)}">${s.transition === 'crossfade' ? '⋈' : '⧗'}</span>` : '';
      const lb = esc(f?.label) || fmt.date(f?.date || 0);
      return `${trans}<div class="tl-clip${i === sel ? ' sel' : ''}" data-i="${i}" data-cid="${s.clip_id}"
                style="width:${w}px" draggable="false">
          <div class="tl-thumbs">${thumbs}</div>
          <span class="tl-clip-lb">${lb} · ${(s.b - s.a).toFixed(1)}s</span>
          <span class="tl-badges">${badges}</span>
          <div class="tl-handle l" data-i="${i}"></div>
          <div class="tl-handle r" data-i="${i}"></div>
        </div>`;
    }).join('');
  }

  // 18-23 · inspector del clip seleccionado
  function renderInspector() {
    if (sel < 0 || !tl[sel]) { inspect.style.display = 'none'; return; }
    const s = tl[sel];
    inspect.style.display = '';
    document.getElementById('tli-io').textContent =
      `In ${fmt.dur(s.a)} · Out ${fmt.dur(s.b)} · dur ${segDur(s).toFixed(1)}s (fuente ${(s.b - s.a).toFixed(1)}s)`;
    document.getElementById('tli-speed').innerHTML = SPEEDS.map(v =>
      `<button class="chip${s.speed === v ? ' on' : ''}" data-spd="${v}">${v}x</button>`).join('');
    document.getElementById('tli-filter').value = s.filter || 'none';
    document.getElementById('tli-trans').value = s.transition || 'none';
    document.getElementById('tli-title').value = s.title || '';
  }

  function updateStat() {
    statEl.textContent = `${tl.length} clip${tl.length === 1 ? '' : 's'} · ${fmt.dur(total())}`;
  }

  // 44 · deshabilitar herramientas según contexto
  function syncTools() {
    const has = tl.length > 0, hasSel = sel >= 0;
    const at = clipAt(playhead);
    const canRazor = has && at && at.local > 0.1 && at.local < segDur(at.clip) - 0.1;
    const set = (name, on) => {
      const b = document.querySelector(`.tl-tool[data-tool="${name}"]`);
      if (b) b.toggleAttribute('disabled', !on);
    };
    set('razor', canRazor);
    set('dup', hasSel); set('del', hasSel); set('left', hasSel && sel > 0); set('right', hasSel && sel < tl.length - 1);
    set('clear', has); set('fit', has);
    document.querySelector('.tl-tool[data-tp="mute"]').textContent = muted ? '🔇' : '🔊';
    document.querySelector('.tl-tool[data-tp="loop"]').classList.toggle('on', loop);
  }

  // ---- máscara de aspecto (31) ----
  function applyAspect() {
    const a = document.getElementById('ed-aspect').value;
    mask.dataset.aspect = a;
  }

  // ---- playhead visual (4) ----
  function paintPlayhead() {
    const x = playhead * pps;
    phEl.style.left = x + 'px';
    // autoscroll para mantener el playhead visible
    const vw = scroll.clientWidth;
    if (x < scroll.scrollLeft + 40) scroll.scrollLeft = Math.max(0, x - 40);
    else if (x > scroll.scrollLeft + vw - 40) scroll.scrollLeft = x - vw + 40;
    timeEl.textContent = `${fmt.dur(playhead)} / ${fmt.dur(total())}`;
  }

  // ---- COMPOSITOR: seek/play a través de los clips ----
  let curCid = null;
  function seek(gt, andPlay) {
    gt = Math.max(0, Math.min(total(), gt));
    playhead = gt;
    paintPlayhead();
    if (!tl.length) return;
    const { clip } = clipAt(gt);
    const target = clip.a + clipAt(gt).local * clip.speed;
    video.playbackRate = clip.speed;
    video.style.filter = CSS_LUTS[clip.filter] || '';
    if (curCid !== clip.clip_id) {
      curCid = clip.clip_id;
      video.src = `${DATA}/proxies/${clip.clip_id}.mp4`;
      const onReady = () => {
        video.removeEventListener('loadeddata', onReady);
        try { video.currentTime = target; } catch {}
        if (andPlay) video.play().catch(() => {});
      };
      video.addEventListener('loadeddata', onReady);
      video.load();
    } else {
      try { video.currentTime = target; } catch {}
      if (andPlay) video.play().catch(() => {});
    }
  }

  function play() {
    if (!tl.length) return;
    if (playhead >= total() - 0.02) playhead = 0;
    playing = true;
    setPlayIcon();
    seek(playhead, true);
    const tick = () => {
      if (!playing) return;
      const at = clipAt(playhead);
      if (at && curCid === at.clip.clip_id) {
        // gt = offset del clip actual + progreso local escalado por speed
        const gt = offset(at.idx) + (video.currentTime - at.clip.a) / at.clip.speed;
        playhead = Math.max(playhead, gt);
        // fin del corte actual → salta al siguiente
        if (video.currentTime >= at.clip.b - 0.03) {
          if (at.idx < tl.length - 1) {
            seek(offset(at.idx + 1) + 0.001, true);
          } else {
            if (loop) { seek(0, true); }
            else { pause(); playhead = total(); paintPlayhead(); return; }
          }
        } else {
          paintPlayhead();
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false; setPlayIcon();
    if (rafId) cancelAnimationFrame(rafId), rafId = null;
    video.pause();
  }
  function togglePlay() { playing ? pause() : play(); }
  function setPlayIcon() {
    const b = document.querySelector('.tl-tool[data-tp="play"]');
    b.innerHTML = playing ? '⏸' : icon('play');
  }

  // ---- añadir / insertar clips ----
  function makeSeg(cid, a, b, extra = {}) {
    const f = byId[cid];
    return { id: uid(), clip_id: cid, a: +Math.max(0, a).toFixed(2),
      b: +Math.min(f.duration_s, b).toFixed(2), speed: 1, filter: 'none',
      title: '', transition: document.getElementById('ed-trans').value, ...extra };
  }
  function addClip(cid, atPlayhead) {
    const f = byId[cid]; if (!f) return;
    pushUndo();
    const seg = makeSeg(cid, 0, Math.min(5, f.duration_s));   // 25 · primeros ~5s o clip completo
    if (atPlayhead && tl.length) {
      const { idx, local } = clipAt(playhead);
      const insertAt = local < segDur(tl[idx]) / 2 ? idx : idx + 1;   // 26
      tl.splice(insertAt, 0, seg); sel = insertAt;
    } else { tl.push(seg); sel = tl.length - 1; }
    renderAll();
    curCid = null; seek(offset(sel));
  }

  // ---- edición de clips ----
  function delClip(i = sel) { if (i < 0) return; pushUndo(); tl.splice(i, 1); if (sel >= tl.length) sel = tl.length - 1; renderAll(); curCid = null; seek(playhead); }
  function dupClip(i = sel) { if (i < 0) return; pushUndo(); const c = { ...tl[i], id: uid() }; tl.splice(i + 1, 0, c); sel = i + 1; renderAll(); }
  function moveClip(dir) {
    const i = sel, j = i + dir;
    if (i < 0 || j < 0 || j >= tl.length) return;
    pushUndo(); [tl[i], tl[j]] = [tl[j], tl[i]]; sel = j; renderAll(); seek(offset(sel));
  }
  // 12 · razor: corta el clip bajo el playhead en dos
  function razor() {
    if (!tl.length) return;
    const { clip, idx, local } = clipAt(playhead);
    if (local < 0.1 || local > segDur(clip) - 0.1) return;
    pushUndo();
    const cutSrc = clip.a + local * clip.speed;             // punto de corte en tiempo fuente
    const right = { ...clip, id: uid(), a: +cutSrc.toFixed(2), transition: 'none' };
    const left  = { ...clip, b: +cutSrc.toFixed(2) };
    tl.splice(idx, 1, left, right);
    sel = idx + 1; renderAll();
  }
  function clearTL() {
    if (!tl.length) return;
    if (!confirm('¿Vaciar el timeline?')) return;
    pushUndo(); tl = []; sel = -1; playhead = 0; curCid = null; renderAll();
  }

  // ---- 45 · Momentos AI: llena el timeline con highlights ----
  function magic() {
    const magicSegs = [];
    editable.forEach(f => (ai[f.clip_id]?.highlights || []).forEach(h =>
      magicSegs.push({ cid: f.clip_id, t: +h.t, dur: f.duration_s, score: ai[f.clip_id].travel_score || 0 })));
    magicSegs.sort((x, y) => y.score - x.score);
    const top = magicSegs.slice(0, 10);
    top.sort((x, y) => x.cid.localeCompare(y.cid) || x.t - y.t);
    if (!top.length) return;
    pushUndo();
    tl = top.map(h => {
      const s = makeSeg(h.cid, Math.max(0, h.t - 2.5), Math.min(h.dur, h.t + 2.5),
        { speed: 1, transition: 'crossfade' });
      s._mark = true;   // 50 · marker en la regla
      return s;
    });
    sel = 0; playhead = 0; curCid = null; renderAll(); seek(0);
  }

  // ================= carrusel de clips fuente (24-27) =================
  const rail = document.getElementById('rail');
  rail.innerHTML = editable.map(f => `
    <div class="cr-item" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" loading="lazy" alt="">
      <span class="scrub-line"></span>
      <span class="cr-lb">${esc(f.label) || fmt.date(f.date)} · ${fmt.dur(f.duration_s)}</span>
      <button class="cr-ins" data-ins="${f.clip_id}" data-tip="Insertar en playhead">⊕</button>
    </div>`).join('') || `<div class="empty">No hay clips con proxy disponibles.</div>`;
  rail.querySelectorAll('.cr-item').forEach(el => el.classList.add('scrub'));
  attachScrub(rail);   // 27 · scrub por hover reutilizando el helper del repo
  rail.addEventListener('click', e => {
    const ins = e.target.closest('[data-ins]');
    if (ins) { addClip(ins.dataset.ins, true); return; }
    const it = e.target.closest('.cr-item');
    if (it) addClip(it.dataset.cid, false);   // 25 · tap = añadir al final
  });

  // ================= interacción del track =================
  // selección + drag para recorte de bordes / reordenar
  let action = null;   // {type:'trim-l'|'trim-r'|'reorder', i, startX, ...}
  track.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.tl-handle');
    const clip = e.target.closest('.tl-clip');
    if (!clip) return;
    const i = +clip.dataset.i;
    sel = i; renderInspector(); track.querySelectorAll('.tl-clip').forEach(c => c.classList.toggle('sel', +c.dataset.i === i));
    track.setPointerCapture(e.pointerId);
    if (handle) {
      action = { type: handle.classList.contains('l') ? 'trim-l' : 'trim-r', i, startX: e.clientX, orig: { ...tl[i] } };
      pushUndo();
    } else {
      action = { type: 'reorder', i, startX: e.clientX, moved: false };
      clip.classList.add('drag');
    }
  });
  track.addEventListener('pointermove', e => {
    if (!action) return;
    const dx = e.clientX - action.startX;
    const s = tl[action.i];
    if (action.type === 'trim-l' || action.type === 'trim-r') {
      const dSec = (dx / pps) * s.speed;   // px→segundos fuente
      if (action.type === 'trim-l') s.a = Math.max(0, Math.min(action.orig.b - 0.3, action.orig.a + dSec));
      else s.b = Math.min(byId[s.clip_id].duration_s, Math.max(action.orig.a + 0.3, action.orig.b + dSec));
      renderTrack(); renderInspector(); updateStat();
      track.querySelector(`.tl-clip[data-i="${action.i}"]`)?.classList.add('sel');
      curCid = null; seek(offset(action.i) + (action.type === 'trim-l' ? 0 : segDur(s) - 0.05));   // 49 · scrub en vivo
    } else if (action.type === 'reorder') {
      if (Math.abs(dx) > 12) action.moved = true;
      // reordenar cuando cruza el centro del vecino
      const w = segDur(s) * pps;
      if (dx > w * 0.6 && action.i < tl.length - 1) {
        pushUndo(); [tl[action.i], tl[action.i + 1]] = [tl[action.i + 1], tl[action.i]];
        action.i++; sel = action.i; action.startX = e.clientX; renderTrack();
        track.querySelector(`.tl-clip[data-i="${action.i}"]`)?.classList.add('drag', 'sel');
      } else if (dx < -w * 0.6 && action.i > 0) {
        pushUndo(); [tl[action.i], tl[action.i - 1]] = [tl[action.i - 1], tl[action.i]];
        action.i--; sel = action.i; action.startX = e.clientX; renderTrack();
        track.querySelector(`.tl-clip[data-i="${action.i}"]`)?.classList.add('drag', 'sel');
      }
    }
  });
  track.addEventListener('pointerup', () => {
    if (action && (action.type === 'trim-l' || action.type === 'trim-r')) { renderAll(); track.querySelector(`.tl-clip[data-i="${action.i}"]`)?.classList.add('sel'); }
    if (action && action.type === 'reorder') renderAll();
    action = null;
  });

  // 8 · click en la regla mueve el playhead (con snap a bordes de clip)
  scroll.addEventListener('pointerdown', e => {
    if (e.target.closest('.tl-clip') || e.target.closest('.tl-handle')) return;
    if (!e.target.closest('.tl-ruler') && !e.target.closest('.tl-track') && e.target !== scroll) return;
    const r = track.getBoundingClientRect();
    let gt = (e.clientX - r.left + scroll.scrollLeft) / pps;
    // snap a bordes de clip si está cerca
    for (let i = 0; i <= tl.length; i++) {
      const edge = offset(i);
      if (Math.abs(edge - gt) * pps < 8) { gt = edge; break; }
    }
    seekPaused(gt);
  });
  function seekPaused(gt) { pause(); curCid = null; seek(gt); syncTools(); }

  // 4 · playhead arrastrable
  phEl.addEventListener('pointerdown', e => {
    e.stopPropagation(); pause();
    phEl.setPointerCapture(e.pointerId);
    const drag = ev => {
      const r = track.getBoundingClientRect();
      const gt = Math.max(0, Math.min(total(), (ev.clientX - r.left + scroll.scrollLeft) / pps));
      curCid = null; seek(gt); syncTools();
    };
    const up = () => { phEl.removeEventListener('pointermove', drag); phEl.removeEventListener('pointerup', up); };
    phEl.addEventListener('pointermove', drag);
    phEl.addEventListener('pointerup', up);
  });

  // ================= transporte (32-34) =================
  document.getElementById('tl-transport').addEventListener('click', e => {
    const b = e.target.closest('[data-tp]'); if (!b) return;
    const tp = b.dataset.tp;
    if (tp === 'play') togglePlay();
    else if (tp === 'start') seekPaused(0);
    else if (tp === 'end') seekPaused(total());
    else if (tp === 'prev') { const at = clipAt(playhead); if (at) seekPaused(offset(Math.max(0, at.local < 0.4 ? at.idx - 1 : at.idx))); }
    else if (tp === 'next') { const at = clipAt(playhead); if (at) seekPaused(offset(Math.min(tl.length - 1, at.idx + 1))); }
    else if (tp === 'mute') { muted = !muted; video.muted = muted; syncTools(); }
    else if (tp === 'loop') { loop = !loop; syncTools(); }
  });

  // ================= barra de herramientas (5,6,12,14-17,45) =================
  document.getElementById('tl-toolbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]'); if (!b || b.hasAttribute('disabled')) return;
    const t = b.dataset.tool;
    if (t === 'razor') razor();
    else if (t === 'dup') dupClip();
    else if (t === 'del') delClip();
    else if (t === 'left') moveClip(-1);
    else if (t === 'right') moveClip(1);
    else if (t === 'clear') clearTL();
    else if (t === 'magic') magic();
    else if (t === 'zoomin') { pps = Math.min(240, pps * 1.4); renderAll(); }
    else if (t === 'zoomout') { pps = Math.max(8, pps / 1.4); renderAll(); }
    else if (t === 'fit') fit();
  });
  function fit() {   // 6 · ajustar a ventana
    const T = total(); if (!T) return;
    pps = Math.max(8, Math.min(240, (scroll.clientWidth - 24) / T));
    renderAll(); scroll.scrollLeft = 0;
  }

  // ================= inspector: ajustes por clip (18-23) =================
  document.getElementById('tli-speed').addEventListener('click', e => {
    const b = e.target.closest('[data-spd]'); if (b && sel >= 0) { pushUndo(); tl[sel].speed = +b.dataset.spd; renderAll(); seek(offset(sel)); }
  });
  document.getElementById('tli-filter').addEventListener('change', e => { if (sel >= 0) { pushUndo(); tl[sel].filter = e.target.value; renderAll(); video.style.filter = CSS_LUTS[e.target.value] || ''; } });
  document.getElementById('tli-trans').addEventListener('change', e => { if (sel >= 0) { pushUndo(); tl[sel].transition = e.target.value; renderTrack(); } });
  document.getElementById('tli-title').addEventListener('input', e => { if (sel >= 0) { tl[sel].title = e.target.value; renderTrack(); } });
  document.getElementById('tli-goto').addEventListener('click', () => { if (sel >= 0) seekPaused(offset(sel)); });

  // ================= aspecto en vivo =================
  document.getElementById('ed-aspect').addEventListener('change', applyAspect);
  applyAspect();

  // ================= atajos de teclado (36-40) =================
  function editorVisible() { return document.querySelector('.st-mod[data-mod="editor"]')?.style.display !== 'none'; }
  window.addEventListener('keydown', e => {
    if (!editorVisible()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); razor(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delClip(); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.altKey) moveClip(-1);
      else seekPaused(Math.max(0, playhead - (e.shiftKey ? 1 : 1 / 30)));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.altKey) moveClip(1);
      else seekPaused(Math.min(total(), playhead + (e.shiftKey ? 1 : 1 / 30)));
    }
  });

  // ================= export (46,47) =================
  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!tl.length) return;
    if (!getToken()) return;   // gate
    const segments = tl.map(s => ({
      clip_id: s.clip_id, a: +s.a.toFixed(2), b: +s.b.toFixed(2), speed: s.speed,
      filter: s.filter || 'none', title: s.title || '', transition: s.transition || 'none',
    }));
    const r = await api('/api/edit', {
      segments,
      aspect: document.getElementById('ed-aspect').value,
      filter: document.getElementById('ed-lut').value,
      title: document.getElementById('ed-title').value.trim(),
      fade: document.getElementById('ed-fade').checked,
      audio: document.getElementById('ed-audio').value,
    });
    if (r && r.error) { alert(r.error); return; }
    pushUndo(); tl = []; sel = -1; playhead = 0; curCid = null; renderAll();
    loadMedia();   // el reel exportado aparecerá en el módulo Reels al terminar el job
  });

  // ================= deep-link (?clip=&a=&b=) =================
  const params = new URLSearchParams(location.search);
  const pClip = params.get('clip');
  if (pClip && byId[pClip]) {
    showMod('editor');
    setTimeout(() => {
      const f = byId[pClip];
      const a = params.get('a') != null ? Math.max(0, +params.get('a')) : 0;
      const b = params.get('b') != null ? Math.min(f.duration_s, +params.get('b')) : Math.min(a + 5, f.duration_s);
      tl.push(makeSeg(pClip, a, b));
      sel = 0; renderAll(); seek(0);
      document.querySelector(`.cr-item[data-cid="${pClip}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }, 100);
  }

  // pintado inicial (setTimeout: rAF no dispara con el tab oculto, patrón del repo)
  setTimeout(() => { renderAll(); fit(); }, 30);

  // ================= Mejores momentos (lógica intacta) =================
  const moments = [];
  flights.forEach(f => (ai[f.clip_id]?.highlights || []).forEach(h =>
    moments.push({ f, h, score: ai[f.clip_id].travel_score || 0 })));
  moments.sort((a, b) => b.score - a.score);
  document.getElementById('moments').innerHTML = moments.slice(0, 6).map(m => `
    <div class="hl-item">
      <a class="tc" href="flight.html?id=${m.f.clip_id}">${fmt.date(m.f.date)} · ${fmt.dur(m.h.t)}</a>
      <p>${esc(m.h.reason)}</p>
    </div>`).join('') || `<p class="footer-note">Corre el análisis AI primero.</p>`;
})();
