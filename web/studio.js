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

      <!-- barra de proyecto: nuevo · guardar · abrir -->
      <div class="tl-projbar">
        <button class="btn" id="ed-new" data-tip="Vaciar y empezar de cero">${icon('plusFile')} Nuevo proyecto</button>
        <span class="spacer"></span>
        <button class="btn" id="ed-save" data-tip="Guardar este proyecto">${icon('save')} Guardar</button>
        <button class="btn" id="ed-open" data-tip="Abrir proyectos guardados">${icon('folder')} Proyectos</button>
      </div>

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
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool" data-tp="start" data-tip="Ir al inicio">${icon('skipStart')}<span class="tl-lb">Inicio</span></button>
                <button class="tl-tool" data-tp="prev" data-tip="Clip anterior">${icon('prev')}<span class="tl-lb">Atrás</span></button>
                <button class="tl-tool big" data-tp="play" data-tip="Reproducir / Pausa (Espacio)">${icon('play')}<span class="tl-lb">Play</span></button>
                <button class="tl-tool" data-tp="next" data-tip="Clip siguiente">${icon('next')}<span class="tl-lb">Sig.</span></button>
                <button class="tl-tool" data-tp="end" data-tip="Ir al final">${icon('skipEnd')}<span class="tl-lb">Final</span></button>
              </div>
              <span class="tl-group-lb">Reproducción</span>
            </div>
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool" data-tp="mute" data-tip="Activar / silenciar audio">${icon('volume')}<span class="tl-lb">Audio</span></button>
                <button class="tl-tool" data-tp="loop" data-tip="Repetir en bucle">${icon('loop')}<span class="tl-lb">Bucle</span></button>
              </div>
              <span class="tl-group-lb">Sonido</span>
            </div>
            <span class="spacer"></span>
            <span class="tl-time mono" id="tl-time">0:00 / 0:00</span>
          </div>

          <!-- 12,14,15,16,17 + zoom 5,6 · barra de herramientas -->
          <div class="tl-toolbar" id="tl-toolbar">
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool" data-tool="razor" data-tip="Cortar en playhead (S)">${icon('scissors')}<span class="tl-lb">Cortar</span></button>
                <button class="tl-tool" data-tool="dup" data-tip="Duplicar clip">${icon('copy')}<span class="tl-lb">Duplicar</span></button>
                <button class="tl-tool" data-tool="left" data-tip="Mover antes (⌥←)">${icon('chevL')}<span class="tl-lb">Antes</span></button>
                <button class="tl-tool" data-tool="right" data-tip="Mover después (⌥→)">${icon('chevR')}<span class="tl-lb">Después</span></button>
                <button class="tl-tool" data-tool="del" data-tip="Eliminar clip (Supr)">${icon('trash')}<span class="tl-lb">Eliminar</span></button>
                <button class="tl-tool" data-tool="clear" data-tip="Vaciar todo el timeline">${icon('broom')}<span class="tl-lb">Vaciar</span></button>
              </div>
              <span class="tl-group-lb">Edición</span>
            </div>
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool ai" data-tool="magic" id="btn-magic" data-tip="Autoarmar el reel con los mejores momentos">${icon('spark')}<span class="tl-lb">Momentos</span></button>
              </div>
              <span class="tl-group-lb">IA</span>
            </div>
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool" data-tool="undo" data-tip="Deshacer (⌘Z)">${icon('undo')}<span class="tl-lb">Deshacer</span></button>
                <button class="tl-tool" data-tool="redo" data-tip="Rehacer (⌘⇧Z)">${icon('redo')}<span class="tl-lb">Rehacer</span></button>
              </div>
              <span class="tl-group-lb">Historial</span>
            </div>
            <span class="spacer"></span>
            <div class="tl-group">
              <div class="tl-group-btns">
                <button class="tl-tool" data-tool="zoomout" data-tip="Alejar timeline">${icon('zoomOut')}<span class="tl-lb">Alejar</span></button>
                <button class="tl-tool" data-tool="zoomin" data-tip="Acercar timeline">${icon('zoomIn')}<span class="tl-lb">Acercar</span></button>
                <button class="tl-tool" data-tool="fit" data-tip="Ajustar todo a la ventana">${icon('fit')}<span class="tl-lb">Ajustar</span></button>
              </div>
              <span class="tl-group-lb">Vista</span>
            </div>
          </div>

          <!-- 3,4,7 · regla + track con scroll horizontal -->
          <div class="tl-scroll" id="tl-scroll">
            <div class="tl-ruler" id="tl-ruler"></div>
            <div class="tl-track" id="tl-track"></div>
            <div class="tl-playhead" id="tl-playhead"></div>
          </div>

          <!-- 18-23 · inspector del clip seleccionado (v7 · secciones agrupadas) -->
          <div class="tl-inspect" id="tl-inspect" style="display:none">
            <div class="tl-io">
              <span class="mono" id="tli-io">—</span>
              <button class="btn" id="tli-goto" data-tip="Saltar el playhead a este clip">${icon('play')} Ir al clip</button>
            </div>

            <!-- copiar/pegar atributos entre clips -->
            <div class="tl-copybar">
              <button class="btn" id="tli-copy" data-tip="Copiar estilo de este clip">${icon('copy')} Copiar estilo</button>
              <button class="btn" id="tli-paste-sel" data-tip="Pegar al clip seleccionado">${icon('check')} Pegar</button>
              <button class="btn" id="tli-paste-all" data-tip="Pegar a todos los clips">${icon('layers')} Pegar a todos</button>
            </div>

            <!-- sección Velocidad + reversa + congelar -->
            <div class="tl-sec" data-sec="speed">
              <div class="tl-seclabel">${icon('gauge')} Velocidad</div>
              <div class="tl-inspect-row">
                <span id="tli-speed" class="tl-chips"></span>
              </div>
              <div class="tl-inspect-row">
                <input class="ctl tl-range" id="tli-speed-range" type="range" min="0.1" max="100" step="0.05" style="flex:1">
                <input class="ctl" id="tli-speed-num" type="number" min="0.1" max="100" step="0.05" style="width:74px">
                <span class="mono">x</span>
              </div>
              <div class="tl-inspect-row">
                <label style="display:flex;align-items:center;gap:5px"><input type="checkbox" id="tli-reverse"> Reversa</label>
                <span class="spacer"></span>
                <label>Congelar</label>
                <input class="ctl" id="tli-freeze" type="number" min="0" max="10" step="0.1" value="0" style="width:74px">
                <span class="mono">s</span>
              </div>
            </div>

            <!-- sección Color (grade) -->
            <div class="tl-sec" data-sec="color">
              <div class="tl-seclabel">${icon('sun')} Color
                <span class="spacer"></span>
                <button class="btn" id="tli-grade-reset" data-tip="Restablecer color">Reset color</button>
              </div>
              <div class="tl-grade">
                <div class="tl-inspect-row"><label>Brillo</label>
                  <input class="tl-range" id="tli-bright" type="range" min="50" max="150" step="1" value="100" style="flex:1">
                  <span class="mono" id="tli-bright-v">100</span></div>
                <div class="tl-inspect-row"><label>Contraste</label>
                  <input class="tl-range" id="tli-contrast" type="range" min="50" max="150" step="1" value="100" style="flex:1">
                  <span class="mono" id="tli-contrast-v">100</span></div>
                <div class="tl-inspect-row"><label>Saturación</label>
                  <input class="tl-range" id="tli-sat" type="range" min="0" max="200" step="1" value="100" style="flex:1">
                  <span class="mono" id="tli-sat-v">100</span></div>
                <div class="tl-inspect-row"><label>Temperatura</label>
                  <input class="tl-range" id="tli-temp" type="range" min="-100" max="100" step="1" value="0" style="flex:1">
                  <span class="mono" id="tli-temp-v">0</span></div>
              </div>
            </div>

            <!-- sección Look (LUT) -->
            <div class="tl-sec" data-sec="look">
              <div class="tl-seclabel">${icon('layers')} Look</div>
              <div class="tl-inspect-row">
                <select class="ctl" id="tli-filter" style="flex:1">
                  <option value="none">Sin look</option><option value="cine">Cine</option>
                  <option value="vivid">Vivid</option><option value="warm">Cálido</option>
                  <option value="moody">Moody</option><option value="bw">B&amp;N</option>
                </select>
              </div>
            </div>

            <!-- sección Título con estilo -->
            <div class="tl-sec" data-sec="title">
              <div class="tl-seclabel">${icon('tag')} Título</div>
              <div class="tl-inspect-row">
                <input class="ctl" id="tli-title" placeholder="Título de este corte…" maxlength="60" style="flex:1">
              </div>
              <div class="tl-inspect-row">
                <label>Posición</label>
                <select class="ctl" id="tli-title-pos">
                  <option value="top">Arriba</option><option value="mid">Centro</option><option value="bottom">Abajo</option>
                </select>
                <label>Tamaño</label>
                <input class="tl-range" id="tli-title-size" type="range" min="1" max="100" step="1" value="40" style="flex:1;min-width:70px">
              </div>
              <div class="tl-inspect-row">
                <label>Color</label>
                <input class="ctl" id="tli-title-color" type="color" value="#ffffff" style="width:52px;padding:2px">
                <span class="spacer"></span>
                <label style="display:flex;align-items:center;gap:5px"><input type="checkbox" id="tli-title-box"> Fondo</label>
              </div>
            </div>

            <!-- sección Transición de entrada (librería) -->
            <div class="tl-sec" data-sec="trans">
              <div class="tl-seclabel">${icon('activity')} Transición de entrada</div>
              <div class="tl-inspect-row">
                <select class="ctl" id="tli-trans" style="flex:1">
                  <option value="none">Ninguna</option>
                  <option value="fade">Fundido</option>
                  <option value="crossfade">Crossfade</option>
                  <option value="dissolve">Disolver</option>
                  <option value="wipeleft">Cortina izq.</option>
                  <option value="wiperight">Cortina der.</option>
                  <option value="slideup">Deslizar arriba</option>
                  <option value="slidedown">Deslizar abajo</option>
                  <option value="circleopen">Círculo abre</option>
                  <option value="circleclose">Círculo cierra</option>
                  <option value="radial">Radial</option>
                  <option value="smoothleft">Suave izq.</option>
                  <option value="pixelize">Pixelar</option>
                  <option value="fadeblack">A negro</option>
                  <option value="fadewhite">A blanco</option>
                </select>
              </div>
              <div class="tl-inspect-row">
                <label>Duración</label>
                <input class="tl-range" id="tli-trans-dur" type="range" min="0.2" max="1.5" step="0.1" value="0.4" style="flex:1">
                <span class="mono" id="tli-trans-dur-v">0.4s</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 24-27 · biblioteca de clips fuente -->
      <div class="tl-lib panel" style="margin-bottom:14px">
        <div class="ph">${icon('film')} Paso 1 · Elige tu video
          <span class="spacer"></span>
          <span class="footer-note" style="font-size:11px">Toca = añadir al final · botón + = insertar en playhead</span>
        </div>
        <div class="pb"><div class="clip-rail" id="rail"></div></div>
      </div>

      <!-- 47 · barra de export (v7 · presets + resolución + proyectos) -->
      <div class="exportbar" id="exportbar" style="display:none">
        <span class="mono" id="eb-sum">—</span>
        <span class="spacer"></span>
        <button class="btn primary big" id="eb-open">${icon('check')} Exportar</button>
      </div>

      <!-- hoja de export estilo CapCut: ajustes agrupados + estimación en vivo -->
      <div class="ex-sheet" id="ex-sheet" style="display:none">
        <div class="ex-card">
          <div class="ph">${icon('dl')} Exportar reel
            <span class="spacer"></span>
            <button class="btn" id="ex-close" data-tip="Cerrar">${icon('close')}</button>
          </div>
          <div class="ex-body">
            <div class="ex-row">
              <label class="eb-field"><span>Preset</span>
              <select class="ctl" id="ed-preset">
                <option value="">Manual…</option>
                <option value="yt4k">YouTube 4K</option>
                <option value="yt1080">YouTube 1080</option>
                <option value="reels">Reels/TikTok</option>
                <option value="square">Cuadrado</option>
                <option value="feed45">Feed 4:5</option>
              </select></label>
              <label class="eb-field"><span>Aspecto</span>
              <select class="ctl" id="ed-aspect">
                <option value="16:9">16:9</option><option value="9:16">9:16 Reels</option>
                <option value="1:1">1:1</option><option value="4:5">4:5</option>
              </select></label>
              <label class="eb-field"><span>Resolución</span>
              <select class="ctl" id="ed-res">
                <option value="1080">1080p</option><option value="2160">2160p (4K)</option>
              </select></label>
            </div>
            <div class="ex-sec">
              <span class="ex-lb">Cuadros por segundo</span>
              <div class="tl-chips" id="ed-fps">
                <button class="chip on" data-fps="">Fuente</button>
                <button class="chip" data-fps="24">24</button>
                <button class="chip" data-fps="30">30</button>
                <button class="chip" data-fps="60">60</button>
              </div>
            </div>
            <div class="ex-sec">
              <span class="ex-lb">Bitrate <b class="mono" id="ed-bitrate-v">10 Mbps</b></span>
              <input class="tl-range" id="ed-bitrate" type="range" min="5" max="50" step="1" value="10">
            </div>
            <div class="ex-row">
              <label class="eb-field"><span>Look global</span>
              <select class="ctl" id="ed-lut">
                <option value="none">Sin look</option><option value="cine">Cine</option>
                <option value="vivid">Vivid</option><option value="warm">Cálido</option>
                <option value="moody">Moody</option><option value="bw">B&amp;N</option>
              </select></label>
              <label class="eb-field"><span>Transición por defecto</span>
              <select class="ctl" id="ed-trans">
                <option value="none">Sin transición</option>
                <option value="fade">Fundido</option>
                <option value="crossfade" selected>Crossfade</option>
                <option value="dissolve">Disolver</option>
                <option value="wipeleft">Cortina izq.</option>
                <option value="wiperight">Cortina der.</option>
                <option value="slideup">Deslizar arriba</option>
                <option value="slidedown">Deslizar abajo</option>
                <option value="circleopen">Círculo abre</option>
                <option value="circleclose">Círculo cierra</option>
                <option value="radial">Radial</option>
                <option value="pixelize">Pixelar</option>
                <option value="fadeblack">A negro</option>
                <option value="fadewhite">A blanco</option>
              </select></label>
              <label class="eb-field"><span>Audio</span>
              <select class="ctl" id="ed-audio">
                <option value="none">Silencio</option><option value="original">Audio original</option>
              </select></label>
            </div>
            <div class="ex-row">
              <label class="eb-field grow"><span>Título del reel</span>
              <input class="ctl" id="ed-title" placeholder="Escríbelo aquí…" maxlength="60"></label>
              <label class="ex-check"><input type="checkbox" id="ed-fade" checked> Fades de entrada/salida</label>
            </div>
            <div class="ex-est mono" id="ex-est">—</div>
          </div>
          <div class="ex-foot">
            <button class="btn primary big" id="ed-export">${icon('check')} Exportar ahora</button>
          </div>
        </div>
      </div>

      <!-- v7 · modal de proyectos guardados (localStorage) -->
      <div class="tl-projmodal" id="tl-projmodal" style="display:none">
        <div class="tl-projcard">
          <div class="ph">${icon('db')} Proyectos guardados
            <span class="spacer"></span>
            <button class="btn" id="proj-close" data-tip="Cerrar">${icon('close')}</button>
          </div>
          <div class="pb" id="proj-list"></div>
        </div>
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
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

  // v7 · defaults de color/título (neutro) — un {} vacío en export = sin grade
  const GRADE_NEUTRAL = { bright: 100, contrast: 100, sat: 100, temp: 0 };
  const isNeutralGrade = g => !g || (g.bright === 100 && g.contrast === 100 && g.sat === 100 && g.temp === 0);
  const TITLE_DEFAULT = { pos: 'bottom', size: 40, color: 'ffffff', box: false };

  // combina LUT + grade → filtro CSS para el preview del compositor.
  // temp: -100(frío)→+100(cálido) se aproxima con sepia + hue-rotate.
  function cssFilterFor(s) {
    let out = CSS_LUTS[s.filter] || '';
    const g = s.grade;
    if (g && !isNeutralGrade(g)) {
      out += ` brightness(${(g.bright ?? 100) / 100}) contrast(${(g.contrast ?? 100) / 100}) saturate(${(g.sat ?? 100) / 100})`;
      const t = g.temp || 0;
      if (t) out += ` sepia(${Math.min(1, Math.abs(t) / 100 * 0.5).toFixed(3)}) hue-rotate(${(t < 0 ? 12 : -8) * Math.abs(t) / 100}deg)`;
    }
    return out.trim();
  }

  // v7 · portapapeles de estilo entre clips (Copiar/Pegar atributos)
  let styleClip = null;

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

  // sliders con relleno de progreso (mismo look que el editor de fotos)
  function paintR(r) {
    const p = ((+r.value) - (+r.min)) / ((+r.max) - (+r.min)) * 100;
    r.style.background = `linear-gradient(90deg, var(--accent) ${p}%, var(--surface-2) ${p}%)`;
  }
  const paintAllRanges = () => document.querySelectorAll('.tl-inspect .tl-range').forEach(paintR);
  document.getElementById('tl-inspect').addEventListener('input', e => {
    if (e.target.classList.contains('tl-range')) paintR(e.target);
  });

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
    phEl.style.display = tl.length ? '' : 'none';
    scroll.classList.toggle('empty', !tl.length);
    paintPlayhead();
    if (!tl.length) { video.removeAttribute('src'); video.load?.(); curCid = null; preloadClip(null); }
    paintAllRanges();
  }

  // 3,4 · regla de tiempo con marcas
  function renderRuler() {
    const T = total(), W = Math.max(T * pps, scroll.clientWidth || 320);
    ruler.style.width = W + 'px';
    track.style.width = W + 'px';
    // tres niveles de marca según zoom: mayor (etiqueta) / media / menor
    const major = pps >= 90 ? 1 : pps >= 45 ? 2 : pps >= 22 ? 5 : 10;
    const minor = major / 5;
    let html = '';
    for (let t = 0; t <= T + 0.001; t += minor) {
      const x = Math.round(t * pps) + 0.5;              // píxel exacto = línea nítida
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 0.001;
      const isMid = !isMajor && Math.abs(t / (major / 2) - Math.round(t / (major / 2))) < 0.001;
      html += isMajor
        ? `<span class="tl-tick major" style="left:${x}px" data-t="${fmt.dur(t)}"></span>`
        : `<span class="tl-tick ${isMid ? 'mid' : 'minor'}" style="left:${x}px"></span>`;
    }
    // 50 · markers de highlights AI sobre la regla
    tl.forEach((s, i) => {
      if (s._mark) html += `<span class="tl-tick mark" style="left:${offset(i) * pps}px" data-tip="Highlight AI">${icon('marker')}</span>`;
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
        s.reverse ? `<span class="tl-badge rev" data-tip="Reversa">${icon('reverse')}</span>` : '',
        s.freeze > 0 ? `<span class="tl-badge freeze" data-tip="Congelar ${s.freeze}s">${icon('freeze')}</span>` : '',
        s.filter && s.filter !== 'none' ? `<span class="tl-badge filter">${esc(s.filter)}</span>` : '',
        (s.grade && !isNeutralGrade(s.grade)) ? `<span class="tl-badge grade" data-tip="Color ajustado">${icon('sun')}</span>` : '',
        s.title ? `<span class="tl-badge title">${icon('tag')}</span>` : '',
      ].join('');
      const trans = (i > 0 && s.transition && s.transition !== 'none')
        ? `<span class="tl-trans" data-tip="${esc(s.transition)}">${s.transition === 'crossfade' || s.transition === 'dissolve' ? '⋈' : '⧗'}</span>` : '';
      const lb = esc(f?.label) || fmt.date(f?.date || 0);
      return `${trans}<div class="tl-clip${i === sel ? ' sel' : ''}" data-i="${i}" data-cid="${s.clip_id}"
                style="width:${w}px" draggable="false">
          <div class="tl-thumbs">${thumbs}</div>
          <span class="tl-clip-lb">${lb} · ${(s.b - s.a).toFixed(1)}s</span>
          <span class="tl-badges">${badges}</span>
          <div class="tl-handle l" data-i="${i}"></div>
          <div class="tl-handle r" data-i="${i}"></div>
        </div>`;
    }).join('') + (tl.length
      ? `<button class="tl-add" data-tip="Añadir más clips">${icon('plus')}</button>` : '');
  }

  // 18-23 · inspector del clip seleccionado (v7 · velocidad+color+título+transición)
  function renderInspector() {
    if (sel < 0 || !tl[sel]) { inspect.style.display = 'none'; return; }
    const s = tl[sel];
    // normaliza campos v7 por si el seg viene de un proyecto viejo
    s.grade = s.grade && Object.keys(s.grade).length ? { ...GRADE_NEUTRAL, ...s.grade } : { ...GRADE_NEUTRAL };
    s.titleStyle = { ...TITLE_DEFAULT, ...(s.titleStyle || {}) };
    if (s.transDur == null) s.transDur = 0.4;
    if (s.reverse == null) s.reverse = false;
    if (s.freeze == null) s.freeze = 0;
    const g = (id) => document.getElementById(id);
    inspect.style.display = '';
    g('tli-io').textContent =
      `In ${fmt.dur(s.a)} · Out ${fmt.dur(s.b)} · dur ${segDur(s).toFixed(1)}s (fuente ${(s.b - s.a).toFixed(1)}s)`;
    // velocidad: chips + slider + input numérico sincronizados
    g('tli-speed').innerHTML = SPEEDS.map(v =>
      `<button class="chip${s.speed === v ? ' on' : ''}" data-spd="${v}">${v}x</button>`).join('');
    g('tli-speed-range').value = s.speed;
    g('tli-speed-num').value = s.speed;
    g('tli-reverse').checked = !!s.reverse;
    g('tli-freeze').value = s.freeze || 0;
    // color grade
    g('tli-bright').value = s.grade.bright;   g('tli-bright-v').textContent = s.grade.bright;
    g('tli-contrast').value = s.grade.contrast; g('tli-contrast-v').textContent = s.grade.contrast;
    g('tli-sat').value = s.grade.sat;         g('tli-sat-v').textContent = s.grade.sat;
    g('tli-temp').value = s.grade.temp;       g('tli-temp-v').textContent = s.grade.temp;
    // look
    g('tli-filter').value = s.filter || 'none';
    // título + estilo
    g('tli-title').value = s.title || '';
    g('tli-title-pos').value = s.titleStyle.pos;
    g('tli-title-size').value = s.titleStyle.size;
    g('tli-title-color').value = '#' + (s.titleStyle.color || 'ffffff');
    g('tli-title-box').checked = !!s.titleStyle.box;
    // transición
    g('tli-trans').value = s.transition || 'none';
    g('tli-trans-dur').value = s.transDur;
    g('tli-trans-dur-v').textContent = (+s.transDur).toFixed(1) + 's';
  }

  function updateStat() {
    statEl.textContent = `${tl.length} clip${tl.length === 1 ? '' : 's'} · ${fmt.dur(total())}`;
    if (typeof updateExportUI === 'function') try { updateExportUI(); } catch {}
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
    set('undo', undoStack.length > 0); set('redo', redoStack.length > 0);
    document.querySelector('.tl-tool[data-tp="mute"]').innerHTML = (muted ? icon('volumeOff') : icon('volume')) + '<span class="tl-lb">Audio</span>';
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

  // srcFor: elige el proxy adecuado al editar — 720p móvil si existe, si no 1080p.
  // Editar no necesita 1080p: bajar de escalón alivia iPhone/iPad y el túnel.
  const srcFor = cid => `${DATA}/${byId[cid]?.has_proxy720 ? 'proxies720' : 'proxies'}/${cid}.mp4`;

  // <video> oculto reutilizable: precarga (calienta la caché HTTP) del PRÓXIMO clip
  // distinto. No reproduce — solo carga bytes para que el swap en la frontera sea
  // casi instantáneo (adiós flash negro). En iOS preload="auto" puede limitarse,
  // pero el objetivo es calentar la caché, no reproducir.
  const preVideo = document.createElement('video');
  preVideo.preload = 'auto';
  preVideo.muted = true;
  preVideo.setAttribute('muted', '');
  preVideo.setAttribute('playsinline', '');
  preVideo.setAttribute('webkit-playsinline', '');
  preVideo.style.display = 'none';
  stage.appendChild(preVideo);
  let preCid = null;   // cid actualmente precargado (evita recargar el mismo)

  // apunta la precarga al cid dado; limpia si es null o coincide con el clip actual
  function preloadClip(cid) {
    if (!cid || cid === curCid) {   // nada que precargar (o es el mismo del compositor)
      if (preCid !== null) { preCid = null; preVideo.removeAttribute('src'); preVideo.load?.(); }
      return;
    }
    if (cid === preCid) return;   // ya está caliente
    preCid = cid;
    preVideo.src = srcFor(cid);
    preVideo.load();
  }
  // precarga el clip idx+1 relativo a un índice (el "siguiente" en el timeline)
  function preloadNextOf(idx) {
    const next = (idx >= 0 && idx + 1 < tl.length) ? tl[idx + 1].clip_id : null;
    preloadClip(next);
  }

  let pendingCancel = null;   // aborta el ciclo de carga en curso (listeners + timeout)
  function seek(gt, andPlay) {
    gt = Math.max(0, Math.min(total(), gt));
    playhead = gt;
    paintPlayhead();
    if (!tl.length) return;
    const at = clipAt(gt);                       // una sola pasada por el timeline
    const clip = at.clip, idx = at.idx;
    const target = clip.a + at.local * clip.speed;
    video.playbackRate = clip.speed;
    video.style.filter = cssFilterFor(clip);
    // recarga SOLO si cambia el clip fuente; el mismo clip (scrub, trim, arrastre del
    // playhead dentro del corte) solo reposiciona currentTime → sin stalls ni flash.
    if (curCid !== clip.clip_id) {
      if (pendingCancel) { pendingCancel(); pendingCancel = null; }   // cancela el ciclo anterior
      curCid = clip.clip_id;
      video.src = srcFor(clip.clip_id);
      // arranca con 'canplay' (readyState>=3) para evitar stutter; fija currentTime solo
      // con metadata; fallback a 'loadeddata' + timeout por si canplay no dispara.
      let done = false, safety = 0;
      const cleanup = () => {
        video.removeEventListener('canplay', start);
        video.removeEventListener('loadeddata', onData);
        clearTimeout(safety);
        pendingCancel = null;
      };
      const start = () => {
        if (done) return; done = true; cleanup();
        if (video.readyState >= 1) { try { video.currentTime = target; } catch {} }
        if (andPlay) video.play().catch(() => {});
      };
      const onData = () => {   // fallback: fija el tiempo aunque aún no haya canplay
        if (done) return;
        if (video.readyState >= 1) { try { video.currentTime = target; } catch {} }
        if (video.readyState >= 3) start();
      };
      pendingCancel = () => { done = true; cleanup(); };   // abortar sin ejecutar start
      video.addEventListener('canplay', start);
      video.addEventListener('loadeddata', onData);
      safety = setTimeout(start, 1500);
      video.load();
    } else {
      try { video.currentTime = target; } catch {}
      if (andPlay) video.play().catch(() => {});
    }
    // mantén caliente el clip siguiente al del playhead
    preloadNextOf(idx);
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
    b.innerHTML = (playing ? icon('pause') : icon('play')) + '<span class="tl-lb">Play</span>';
  }

  // ---- añadir / insertar clips ----
  function makeSeg(cid, a, b, extra = {}) {
    const f = byId[cid];
    return { id: uid(), clip_id: cid, a: +Math.max(0, a).toFixed(2),
      b: +Math.min(f.duration_s, b).toFixed(2), speed: 1, filter: 'none',
      title: '', transition: document.getElementById('ed-trans').value,
      transDur: 0.4, reverse: false, freeze: 0,
      grade: { ...GRADE_NEUTRAL }, titleStyle: { ...TITLE_DEFAULT }, ...extra };
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
  // clona un seg copiando en profundidad grade/titleStyle (objetos mutables)
  const cloneSeg = s => ({ ...s, id: uid(), grade: { ...(s.grade || GRADE_NEUTRAL) }, titleStyle: { ...(s.titleStyle || TITLE_DEFAULT) } });
  function dupClip(i = sel) { if (i < 0) return; pushUndo(); const c = cloneSeg(tl[i]); tl.splice(i + 1, 0, c); sel = i + 1; renderAll(); }
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
    const right = { ...cloneSeg(clip), a: +cutSrc.toFixed(2), transition: 'none' };
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
      <button class="cr-ins" data-ins="${f.clip_id}" data-tip="Insertar en playhead">${icon('plus')}</button>
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
    sel = i; renderInspector(); preloadNextOf(i); track.querySelectorAll('.tl-clip').forEach(c => c.classList.toggle('sel', +c.dataset.i === i));
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
      seek(offset(action.i) + (action.type === 'trim-l' ? 0 : segDur(s) - 0.05));   // 49 · scrub en vivo (mismo clip = sin recarga)
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
    if (action && action.type === 'reorder') { renderAll(); preloadNextOf(sel); }
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
  function seekPaused(gt) { pause(); seek(gt); syncTools(); }

  // 4 · playhead arrastrable
  phEl.addEventListener('pointerdown', e => {
    e.stopPropagation(); pause();
    phEl.setPointerCapture(e.pointerId);
    const drag = ev => {
      const r = track.getBoundingClientRect();
      const gt = Math.max(0, Math.min(total(), (ev.clientX - r.left + scroll.scrollLeft) / pps));
      seek(gt); syncTools();   // seek recarga solo si cruza a otro clip; dentro del mismo = fluido
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
    else if (t === 'undo') undo();
    else if (t === 'redo') redo();
  });
  // pinch con dos dedos = zoom del timeline (móvil)
  let pinch = null;
  const pdist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY);
  scroll.addEventListener('touchstart', e => {
    if (e.touches.length === 2) pinch = { d: pdist(e), pps0: pps };
  }, { passive: true });
  scroll.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      pps = Math.max(8, Math.min(240, pinch.pps0 * (pdist(e) / pinch.d)));
      renderAll();
    }
  }, { passive: false });
  scroll.addEventListener('touchend', () => { pinch = null; });

  function fit() {   // 6 · ajustar a ventana
    const T = total(); if (!T) return;
    pps = Math.max(8, Math.min(240, (scroll.clientWidth - 24) / T));
    renderAll(); scroll.scrollLeft = 0;
  }

  // ================= inspector: ajustes por clip (18-23 · v7) =================
  const $ = id => document.getElementById(id);
  const selSeg = () => (sel >= 0 && tl[sel]) ? tl[sel] : null;
  // aplica solo el filtro CSS en vivo sin re-renderizar el track (preview fluido)
  const livePreview = () => { const s = selSeg(); if (s) video.style.filter = cssFilterFor(s); };

  // --- velocidad: chips + slider + input numérico (0.1..100) ---
  function setSpeed(v, doSeek = true) {
    const s = selSeg(); if (!s) return;
    v = Math.max(0.1, Math.min(100, +v || 1));
    pushUndo(); s.speed = +v.toFixed(2); renderAll(); if (doSeek) seek(offset(sel));
  }
  $('tli-speed').addEventListener('click', e => {
    const b = e.target.closest('[data-spd]'); if (b) setSpeed(+b.dataset.spd);
  });
  $('tli-speed-range').addEventListener('input', e => { $('tli-speed-num').value = e.target.value; });
  $('tli-speed-range').addEventListener('change', e => setSpeed(e.target.value));
  $('tli-speed-num').addEventListener('change', e => setSpeed(e.target.value));
  $('tli-reverse').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.reverse = e.target.checked; renderTrack(); } });
  $('tli-freeze').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.freeze = Math.max(0, +e.target.value || 0); renderTrack(); } });

  // --- color grade: 4 sliders + reset; preview en vivo ---
  const gradeBind = (id, key, vId) => $(id).addEventListener('input', e => {
    const s = selSeg(); if (!s) return;
    s.grade[key] = +e.target.value;
    $(vId).textContent = e.target.value;
    livePreview(); renderTrack();
  });
  gradeBind('tli-bright', 'bright', 'tli-bright-v');
  gradeBind('tli-contrast', 'contrast', 'tli-contrast-v');
  gradeBind('tli-sat', 'sat', 'tli-sat-v');
  gradeBind('tli-temp', 'temp', 'tli-temp-v');
  // pushUndo una sola vez al empezar a arrastrar cualquier slider de grade
  ['tli-bright', 'tli-contrast', 'tli-sat', 'tli-temp'].forEach(id =>
    $(id).addEventListener('pointerdown', () => { if (selSeg()) pushUndo(); }));
  $('tli-grade-reset').addEventListener('click', () => {
    const s = selSeg(); if (!s) return;
    pushUndo(); s.grade = { ...GRADE_NEUTRAL }; renderInspector(); livePreview(); renderTrack();
  });

  // --- look (LUT) ---
  $('tli-filter').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.filter = e.target.value; renderTrack(); livePreview(); } });

  // --- título + estilo ---
  $('tli-title').addEventListener('input', e => { const s = selSeg(); if (s) { s.title = e.target.value; renderTrack(); } });
  $('tli-title-pos').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.pos = e.target.value; } });
  $('tli-title-size').addEventListener('input', e => { const s = selSeg(); if (s) s.titleStyle.size = +e.target.value; });
  $('tli-title-size').addEventListener('change', () => { if (selSeg()) pushUndo(); });
  $('tli-title-color').addEventListener('input', e => { const s = selSeg(); if (s) s.titleStyle.color = e.target.value.replace('#', ''); });
  $('tli-title-box').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.box = e.target.checked; } });

  // --- transición de entrada (librería) + duración ---
  $('tli-trans').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.transition = e.target.value; renderTrack(); } });
  $('tli-trans-dur').addEventListener('input', e => { const s = selSeg(); if (s) { s.transDur = +e.target.value; $('tli-trans-dur-v').textContent = (+e.target.value).toFixed(1) + 's'; } });
  $('tli-trans-dur').addEventListener('change', () => { if (selSeg()) pushUndo(); });

  // --- copiar / pegar atributos entre clips ---
  const STYLE_KEYS = ['speed', 'filter', 'grade', 'titleStyle', 'transition', 'transDur', 'reverse', 'freeze'];
  function grabStyle(s) {
    const o = {};
    STYLE_KEYS.forEach(k => { o[k] = (k === 'grade' || k === 'titleStyle') ? { ...(s[k] || {}) } : s[k]; });
    return o;
  }
  function applyStyle(s) {
    if (!styleClip) return;
    STYLE_KEYS.forEach(k => { s[k] = (k === 'grade' || k === 'titleStyle') ? { ...styleClip[k] } : styleClip[k]; });
  }
  $('tli-copy').addEventListener('click', () => { const s = selSeg(); if (s) { styleClip = grabStyle(s); flashBtn('tli-copy'); } });
  $('tli-paste-sel').addEventListener('click', () => { const s = selSeg(); if (s && styleClip) { pushUndo(); applyStyle(s); renderAll(); seek(offset(sel)); } });
  $('tli-paste-all').addEventListener('click', () => { if (!styleClip || !tl.length) return; pushUndo(); tl.forEach(applyStyle); renderAll(); seek(offset(Math.max(0, sel))); });
  function flashBtn(id) { const b = $(id); b.classList.add('ok'); setTimeout(() => b.classList.remove('ok'), 700); }

  $('tli-goto').addEventListener('click', () => { if (sel >= 0) seekPaused(offset(sel)); });

  // ================= aspecto en vivo =================
  document.getElementById('ed-aspect').addEventListener('change', applyAspect);
  applyAspect();

  // ================= presets de export (v7) =================
  // cada preset fija aspect + resolution; el usuario puede sobreescribir manual
  const PRESETS = {
    yt4k:   { aspect: '16:9', res: '2160' },
    yt1080: { aspect: '16:9', res: '1080' },
    reels:  { aspect: '9:16', res: '1080' },
    square: { aspect: '1:1',  res: '1080' },
    feed45: { aspect: '4:5',  res: '1080' },
  };
  document.getElementById('ed-preset').addEventListener('change', e => {
    const p = PRESETS[e.target.value]; if (!p) return;
    document.getElementById('ed-aspect').value = p.aspect;
    document.getElementById('ed-res').value = p.res;
    applyAspect();
  });

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

  // botón + del track: lleva a la biblioteca y la resalta
  track.addEventListener('click', e => {
    if (!e.target.closest('.tl-add')) return;
    const lib = document.querySelector('.tl-lib');
    lib.scrollIntoView({ behavior: 'smooth', block: 'center' });
    lib.classList.add('pulse');
    setTimeout(() => lib.classList.remove('pulse'), 1400);
  });

  // ================= hoja de export (CapCut-style) =================
  const exSheet = document.getElementById('ex-sheet');
  let edFps = '';
  function openExSheet() { exSheet.style.display = 'flex'; updateExportUI();
    exSheet.querySelector('.ex-card').animate(
      [{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(.22,1.2,.36,1)' }); }
  function closeExSheet() { exSheet.style.display = 'none'; }
  document.getElementById('eb-open').addEventListener('click', openExSheet);
  document.getElementById('ex-close').addEventListener('click', closeExSheet);
  exSheet.addEventListener('click', e => { if (e.target === exSheet) closeExSheet(); });
  document.getElementById('ed-fps').addEventListener('click', e => {
    const b = e.target.closest('[data-fps]'); if (!b) return;
    edFps = b.dataset.fps;
    document.querySelectorAll('#ed-fps .chip').forEach(x => x.classList.toggle('on', x === b));
    updateExportUI();
  });
  document.getElementById('ed-bitrate').addEventListener('input', updateExportUI);
  document.getElementById('ed-res').addEventListener('change', updateExportUI);
  function updateExportUI() {
    const br = +document.getElementById('ed-bitrate').value;
    document.getElementById('ed-bitrate-v').textContent = `${br} Mbps`;
    const mb = (br * total()) / 8;
    document.getElementById('ex-est').textContent =
      tl.length ? `≈ ${mb < 1000 ? mb.toFixed(0) + ' MB' : (mb / 1000).toFixed(2) + ' GB'} estimados · ${fmt.dur(total())} · ${document.getElementById('ed-res').value}p${edFps ? ' · ' + edFps + ' fps' : ''}` : '—';
    const sum = document.getElementById('eb-sum');
    if (sum) sum.textContent = `${tl.length} clip${tl.length === 1 ? '' : 's'} · ${fmt.dur(total())} · ${document.getElementById('ed-aspect').value} · ${document.getElementById('ed-res').value}p`;
  }

  // ================= export (46,47) =================
  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!tl.length) return;
    if (!getToken()) return;   // gate
    const segments = tl.map(s => {
      const seg = {
        clip_id: s.clip_id, a: +s.a.toFixed(2), b: +s.b.toFixed(2), speed: s.speed,
        filter: s.filter || 'none', title: s.title || '', transition: s.transition || 'none',
        transDur: +(s.transDur ?? 0.4), reverse: !!s.reverse, freeze: +(s.freeze || 0),
        titleStyle: { ...TITLE_DEFAULT, ...(s.titleStyle || {}) },
      };
      // grade: {} u omitido = sin grade (contrato v7). Solo mandar si no es neutro.
      seg.grade = isNeutralGrade(s.grade) ? {} : { ...GRADE_NEUTRAL, ...s.grade };
      return seg;
    });
    const r = await api('/api/edit', {
      segments,
      aspect: document.getElementById('ed-aspect').value,
      resolution: document.getElementById('ed-res').value,
      filter: document.getElementById('ed-lut').value,
      title: document.getElementById('ed-title').value.trim(),
      fade: document.getElementById('ed-fade').checked,
      audio: document.getElementById('ed-audio').value,
      fps: edFps ? +edFps : undefined,
      bitrate: +document.getElementById('ed-bitrate').value,
    });
    closeExSheet();
    if (r && r.error) { alert(r.error); return; }
    pushUndo(); tl = []; sel = -1; playhead = 0; curCid = null; renderAll();
    loadMedia();   // el reel exportado aparecerá en el módulo Reels al terminar el job
  });

  // ================= guardar / cargar proyectos (localStorage · v7) =================
  const PROJ_KEY = 'ab.studio.projects';
  const loadProjects = () => { try { return JSON.parse(localStorage.getItem(PROJ_KEY)) || []; } catch { return []; } };
  const saveProjects = list => { try { localStorage.setItem(PROJ_KEY, JSON.stringify(list)); } catch (e) { alert('No se pudo guardar (almacenamiento lleno).'); } };
  // snapshot completo: clips del timeline + ajustes globales del exportbar
  function projectPayload() {
    const G = id => document.getElementById(id);
    return {
      tl: JSON.parse(JSON.stringify(tl)),
      globals: {
        aspect: G('ed-aspect').value, resolution: G('ed-res').value, preset: G('ed-preset').value,
        lut: G('ed-lut').value, trans: G('ed-trans').value, audio: G('ed-audio').value,
        fps: edFps, bitrate: G('ed-bitrate').value,
        title: G('ed-title').value, fade: G('ed-fade').checked,
      },
    };
  }
  function restoreProject(p) {
    tl = (p.tl || []).map(s => ({ ...s, id: uid() }));   // ids frescos para evitar colisiones
    const g = p.globals || {};
    const set = (id, v, chk) => { const el = document.getElementById(id); if (el && v != null) { if (chk) el.checked = !!v; else el.value = v; } };
    set('ed-aspect', g.aspect); set('ed-res', g.resolution); set('ed-preset', g.preset);
    set('ed-lut', g.lut); set('ed-trans', g.trans); set('ed-audio', g.audio);
    set('ed-title', g.title); set('ed-fade', g.fade, true);
    set('ed-bitrate', g.bitrate); if (g.fps != null) edFps = g.fps;
    sel = tl.length ? 0 : -1; playhead = 0; curCid = null;
    applyAspect(); undoStack = []; redoStack = [];
    renderAll(); if (tl.length) { fit(); seek(0); }
  }
  document.getElementById('ed-new').addEventListener('click', () => {
    if (tl.length) clearTL(); else { document.getElementById('ed-title').value = ''; }
  });
  document.getElementById('ed-save').addEventListener('click', () => {
    if (!tl.length) { alert('Timeline vacío — nada que guardar.'); return; }
    const name = prompt('Nombre del proyecto:', 'Proyecto ' + new Date().toLocaleDateString('es'));
    if (!name || !name.trim()) return;
    const list = loadProjects();
    list.unshift({ name: name.trim(), date: Date.now(), payload: projectPayload() });
    saveProjects(list.slice(0, 40));   // tope razonable
    flashBtn('ed-save');
  });
  // modal de proyectos: listar / cargar / borrar
  const projModal = document.getElementById('tl-projmodal');
  function renderProjList() {
    const list = loadProjects();
    const box = document.getElementById('proj-list');
    box.innerHTML = list.length ? list.map((p, i) => `
      <div class="tl-projrow" data-i="${i}">
        <div class="tl-projmeta">
          <b>${esc(p.name)}</b>
          <span class="mono">${(p.payload?.tl?.length || 0)} clips · ${mdate(p.date / 1000)}</span>
        </div>
        <span class="spacer"></span>
        <button class="btn" data-proj="load" data-i="${i}">${icon('play')} Cargar</button>
        <button class="btn danger" data-proj="del" data-i="${i}" data-tip="Borrar">${icon('warn')}</button>
      </div>`).join('') : `<div class="empty">Aún no has guardado proyectos.</div>`;
  }
  function openProjModal() { renderProjList(); projModal.style.display = 'flex'; }
  function closeProjModal() { projModal.style.display = 'none'; }
  document.getElementById('ed-open').addEventListener('click', openProjModal);
  document.getElementById('proj-close').addEventListener('click', closeProjModal);
  projModal.addEventListener('click', e => {
    if (e.target === projModal) { closeProjModal(); return; }   // click fuera de la tarjeta
    const b = e.target.closest('[data-proj]'); if (!b) return;
    const i = +b.dataset.i, list = loadProjects();
    if (b.dataset.proj === 'load') {
      const p = list[i]; if (!p) return;
      if (tl.length && !confirm('Se reemplazará el timeline actual. ¿Cargar proyecto?')) return;
      restoreProject(p.payload); closeProjModal();
    } else if (b.dataset.proj === 'del') {
      if (!confirm(`¿Borrar "${list[i]?.name}"?`)) return;
      list.splice(i, 1); saveProjects(list); renderProjList();
    }
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

})();
