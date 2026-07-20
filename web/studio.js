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
    <button class="rm-cta" id="rm-open">
      <span class="rm-cta-ic">${icon('spark')}</span>
      <span class="rm-cta-t"><b>Crear reel</b><small>Elige tus tomas y AeroBrain arma el montaje — luego lo editas</small></span>
      <span class="rm-cta-go">${icon('chevR')}</span>
    </button>
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
    <div class="td-jobbar" id="fotos-sub" style="margin-bottom:10px" aria-label="Origen de fotos">
      <button class="chip on" data-fsub="fotos">Capturas</button>
      <button class="chip" data-fsub="dron">Del dron <span class="mono" id="dron-count"></span></button>
    </div>
    <div class="media-toolbar">
      <input class="ctl" id="q-fotos" type="search" placeholder="Buscar foto…" style="flex:1;min-width:150px">
      <select class="ctl" id="s-fotos">
        <option value="recientes">Recientes</option>
        <option value="tamano">Tamaño</option>
        <option value="nombre">Nombre</option>
      </select>
    </div>
    <div class="media-grid" id="grid-fotos"><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div></div>
    <div class="media-grid" id="grid-dron" style="display:none"><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div></div>
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
    } else if (!show) {
      // teardown SPA: los <video> del grid siguen decodificando si no se pausan al ocultar el tab
      m.querySelectorAll('.media-grid video').forEach(v => { try { v.pause(); } catch {} });
      if (m.dataset.mod === 'editor' || m.querySelector('#tl-video')) { try { document.getElementById('tl-video')?.pause(); } catch {} }
      m.style.display = 'none';
    }
  });
}
stTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showMod(b.dataset.tab);
});

// ---- motor de medios: biblioteca de reels y fotos ----
let media = null;   // {reels:[{name,bytes,mtime}], photos:[...]}
const mstate = { reels: { q: '', sort: 'recientes' }, fotos: { q: '', sort: 'recientes' },
                 dron: { q: '', sort: 'recientes' } };
let dronePhotos = null;      // fotos NATIVAS de la cámara del dron (raw/, JPG+DNG)
let fotosSub = 'fotos';      // sub-tab activo dentro de Fotos

async function loadDronePhotos() {
  if (dronePhotos) return;
  try {
    const r = await authFetch('/api/drone_photos');
    if (r.status !== 200) throw 0;
    dronePhotos = (await r.json()).photos || [];
  } catch { dronePhotos = []; }
  const c = document.getElementById('dron-count');
  if (c) c.textContent = dronePhotos.length;
  renderGrid('dron');
}

function mdate(mtime) {
  const d = new Date(mtime * 1000);
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

async function loadMedia() {
  let r = null;
  try { r = await authFetch('/api/studio_media'); } catch { return; }
  if (!r.ok) {
    document.getElementById('st-count').textContent = 'No se pudo cargar la biblioteca';
    return;
  }
  media = await r.json();
  document.getElementById('st-count').textContent =
    `${(media.reels || []).length} reels · ${(media.photos || []).length} fotos`;
  renderGrid('reels');
  renderGrid('fotos');
}

// sub-tabs de Fotos: Capturas (biblioteca) vs Del dron (nativas raw/)
document.getElementById('fotos-sub')?.addEventListener('click', e => {
  const b = e.target.closest('[data-fsub]');
  if (!b) return;
  fotosSub = b.dataset.fsub;
  document.querySelectorAll('#fotos-sub .chip').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('grid-fotos').style.display = fotosSub === 'fotos' ? '' : 'none';
  document.getElementById('grid-dron').style.display = fotosSub === 'dron' ? '' : 'none';
  if (fotosSub === 'dron') loadDronePhotos();
});
document.getElementById('grid-dron')?.addEventListener('click', e => {
  const card = e.target.closest('.m-card');
  if (!card) return;
  const rel = encodeURIComponent(card.dataset.rel);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'dl') {
    const a = document.createElement('a');
    a.href = `/api/photo_thumb?rel=${rel}&w=0`;      // w=0 = original (JPG o DNG)
    a.download = card.dataset.name; a.click();
    return;
  }
  // tap o botón editor → photoeditor con preview 2048 (el DNG no abre nativo en browser)
  if (act === 'edit' || e.target.closest('.m-prevbox'))
    openPhotoEditor({ url: `/api/photo_thumb?rel=${rel}&w=2048`, name: card.dataset.name });
});

function viewOf(kind) {
  const list = (kind === 'dron' ? (dronePhotos || [])
    : (kind === 'reels' ? media.reels : media.photos) || []).slice();
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
  if (kind === 'dron') {
    const rel = encodeURIComponent(it.rel);
    return `<div class="m-card" data-name="${esc(it.name)}" data-rel="${esc(it.rel)}" data-kind="${esc(it.kind)}">
      <div class="m-prevbox">
        <img loading="lazy" src="/api/photo_thumb?rel=${rel}&w=512" alt="${esc(base)}" style="cursor:pointer">
        <span class="m-fmt ${it.kind === 'DNG' ? 'dng' : ''}">${esc(it.kind)}</span>
      </div>
      <div class="m-name">${esc(base)}</div>
      <div class="m-meta mono">${fmt.gb(it.bytes)} · ${it.date ? esc(it.date) : mdate(it.mtime)}</div>
      <div class="m-actions">
        <button data-act="dl" data-tip="Descargar original ${esc(it.kind)}">${icon('dl')}</button>
        <button data-act="edit" data-tip="Abrir en el editor">${icon('iso')}</button>
      </div>
    </div>`;
  }
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
  // libera los decoders de los <video> previos antes de reemplazar el grid (si no, quedan
  // huérfanos decodificando hasta el GC)
  grid.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} });
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
  // la barra de Fotos gobierna el SUB-TAB activo (biblioteca o dron)
  const target = () => kind === 'fotos' && fotosSub === 'dron' ? 'dron' : kind;
  document.getElementById(`q-${kind}`).addEventListener('input', e => {
    mstate[target()].q = e.target.value;
    if (media || target() === 'dron') renderGrid(target());
  });
  document.getElementById(`s-${kind}`).addEventListener('change', e => {
    mstate[target()].sort = e.target.value;
    if (media || target() === 'dron') renderGrid(target());
  });
  document.getElementById(`grid-${kind}`).addEventListener('click', e => onCardClick(kind, e));
}
loadMedia();

// ---- módulo Trabajos ----
pollJobs(document.getElementById('jobs'), 2500, j => {
  // el reel exportado aparece SOLO al terminar (antes: recargar la página a mano)
  if (j.kind === 'edit') { loadMedia(); }
});

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
  // freeze REEMPLAZA la duración: el exporter usa out_dur = freeze (congela el frame 'a');
  // ver aerobrain_server.py:709. Sumarlo desincronizaría timeline vs. reel exportado.
  const segDur = s => s.freeze > 0 ? s.freeze : (s.b - s.a) / s.speed;   // duración en timeline
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
  // catálogo de transiciones = exactamente lo que el export ffmpeg (XFADE_MAP) renderiza
  const TX_LABELS = {
    none: 'Corte', fade: 'Fundido', dissolve: 'Disolver', fadeblack: 'A negro',
    fadewhite: 'A blanco', wipeleft: 'Cortina ←', wiperight: 'Cortina →',
    slideup: 'Deslizar ↑', slidedown: 'Deslizar ↓', circleopen: 'Círculo abre',
    circleclose: 'Círculo cierra', radial: 'Radial', smoothleft: 'Suave ←', pixelize: 'Pixel',
    crossfade: 'Fundido',
  };
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
      // nodo de UNIÓN clicable entre clips: cómo pasa una toma a la otra (antes: glifo
      // minúsculo no interactivo + select enterrado en el inspector que nadie encontraba)
      const txSet = s.transition && s.transition !== 'none';
      const trans = i > 0
        ? `<button class="tl-junction${txSet ? ' set' : ''}" data-j="${i}"
             data-tip="${txSet ? esc((TX_LABELS[s.transition] || s.transition) + ' · ' + (s.transDur || 0.4) + 's — click para cambiar') : 'Corte seco — click para elegir transición'}">${txSet ? '⋈' : '+'}</button>` : '';
      const lb = esc(f?.label) || fmt.date(f?.date || 0);
      return `${trans}<div class="tl-clip${i === sel ? ' sel' : ''}" data-i="${i}" data-cid="${s.clip_id}"
                style="width:${w}px" draggable="false">
          <div class="tl-thumbs">${thumbs}</div>
          <span class="tl-clip-lb">${lb} · ${(s.b - s.a).toFixed(1)}s</span>
          <span class="tl-badges">${badges}</span>
          <button class="tl-x" data-x="${i}" data-tip="Quitar del timeline">✕</button>
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
    const eff = hasSel ? sel : (at ? at.idx : -1);   // sin selección → clip bajo el playhead
    set('dup', eff >= 0); set('del', eff >= 0); set('left', eff > 0); set('right', eff >= 0 && eff < tl.length - 1);
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
    // marca visual del clip EN REPRODUCCIÓN (solo togglea al cambiar de clip)
    const nowAt = clipAt(playhead);
    const ni = nowAt ? nowAt.idx : -1;
    if (ni !== _nowIdx) {
      _nowIdx = ni;
      track.querySelectorAll('.tl-clip.now').forEach(c => c.classList.remove('now'));
      if (ni >= 0) track.querySelector(`.tl-clip[data-i="${ni}"]`)?.classList.add('now');
    }
  }
  let _nowIdx = -1;

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
  let pendingTarget = 0, pendingPlay = false;   // target/andPlay VIGENTES del ciclo (no capturados)
  const cancelSeek = () => { if (pendingCancel) { pendingCancel(); pendingCancel = null; } };
  function seek(gt, andPlay) {
    gt = Math.max(0, Math.min(total(), gt));
    playhead = gt;
    paintPlayhead();
    if (!tl.length) return;
    const at = clipAt(gt);                       // una sola pasada por el timeline
    const clip = at.clip, idx = at.idx;
    // freeze fija el frame 'a' (coincide con el exporter); si no, tiempo fuente escalado por speed
    const target = clip.freeze > 0 ? clip.a : clip.a + at.local * clip.speed;
    video.playbackRate = clip.speed;
    video.style.filter = cssFilterFor(clip);
    // recarga SOLO si cambia el clip fuente; el mismo clip (scrub, trim, arrastre del
    // playhead dentro del corte) solo reposiciona currentTime → sin stalls ni flash.
    if (curCid !== clip.clip_id) {
      cancelSeek();   // cancela el ciclo anterior
      curCid = clip.clip_id;
      pendingTarget = target; pendingPlay = !!andPlay;
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
        // el timeline pudo vaciarse/cambiar de clip durante la carga (pause/clearTL/delClip)
        if (!tl.length || curCid !== clip.clip_id) return;
        if (video.readyState >= 1) { try { video.currentTime = pendingTarget; } catch {} }
        if (pendingPlay && playing) video.play().catch(() => {});   // no reanudar si el usuario pausó
      };
      const onData = () => {   // fallback: fija el tiempo aunque aún no haya canplay
        if (done) return;
        if (video.readyState >= 1) { try { video.currentTime = pendingTarget; } catch {} }
        if (video.readyState >= 3) start();
      };
      pendingCancel = () => { done = true; cleanup(); };   // abortar sin ejecutar start
      video.addEventListener('canplay', start);
      video.addEventListener('loadeddata', onData);
      safety = setTimeout(start, 1500);
      video.load();
    } else {
      // mismo clip: reposiciona ya y, si el ciclo inicial sigue cargando, actualiza su target
      // (si no, un scrub/trim durante la carga aplicaría el target viejo al llegar canplay/safety)
      if (pendingCancel) { pendingTarget = target; pendingPlay = pendingPlay || !!andPlay; }
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
  // sin selección explícita, las herramientas actúan sobre el clip BAJO EL PLAYHEAD
  // ("no puedo borrar": Eliminar exigía seleccionar primero y nadie lo descubría)
  const effSel = () => sel >= 0 ? sel : (clipAt(playhead)?.idx ?? -1);
  function delClip(i = effSel()) { if (i < 0) return; pushUndo(); tl.splice(i, 1); if (sel >= tl.length) sel = tl.length - 1; renderAll(); curCid = null; seek(playhead); }
  // clona un seg copiando en profundidad grade/titleStyle (objetos mutables)
  const cloneSeg = s => ({ ...s, id: uid(), grade: { ...(s.grade || GRADE_NEUTRAL) }, titleStyle: { ...(s.titleStyle || TITLE_DEFAULT) } });
  function dupClip(i = effSel()) { if (i < 0) return; pushUndo(); const c = cloneSeg(tl[i]); tl.splice(i + 1, 0, c); sel = i + 1; renderAll(); }
  function moveClip(dir) {
    const i = effSel(), j = i + dir;
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
    cancelSeek();   // aborta cualquier ciclo de carga en vuelo antes de vaciar
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

  // ================= REELS MAKER (I1) =================
  // "de una toma a un reel": el usuario elige tomas + una receta, y esto arma el montaje.
  // Reparto de tiempo PONDERADO por score AI (las mejores tomas salen más) pero garantizando
  // que TODA toma elegida aparezca al menos una vez — si no, la selección mentiría.
  const RM_RHYTHM = {
    rapido: { seg: 1.3, trans: 'none', dur: 0.25, lb: 'Rápido', sub: 'cortes secos, energía' },
    medio: { seg: 2.2, trans: 'crossfade', dur: 0.35, lb: 'Medio', sub: 'equilibrado, versátil' },
    cine: { seg: 3.6, trans: 'dissolve', dur: 0.6, lb: 'Cine', sub: 'planos largos, respirado' },
  };
  const RM_FORMATS = {
    '9:16': { lb: 'Vertical', sub: 'Reels · TikTok · Shorts', res: '1080' },
    '1:1': { lb: 'Cuadrado', sub: 'Feed clásico', res: '1080' },
    '4:5': { lb: 'Retrato', sub: 'Feed alto', res: '1080' },
    '16:9': { lb: 'Horizontal', sub: 'YouTube · web', res: '1080' },
  };

  // momentos de un clip: usa los highlights de la AI si existen; si no, reparte uniforme
  // evitando los bordes (los primeros/últimos frames del dron suelen ser despegue/aterrizaje)
  function rmMoments(cid, n) {
    const f = byId[cid];
    const dur = f?.duration_s || 0;
    if (!dur || n <= 0) return [];
    const hl = (ai[cid]?.highlights || [])
      .map(h => +h.t).filter(t => Number.isFinite(t) && t >= 0 && t <= dur)
      .sort((a, b) => a - b);
    if (hl.length >= n) {
      const step = hl.length / n;                       // reparte a lo largo del clip
      return Array.from({ length: n }, (_, k) => hl[Math.floor(k * step)]);
    }
    const pts = [...hl];
    const need = n - pts.length;
    const lo = Math.min(0.4, dur * 0.05), hi = Math.max(dur - 0.4, dur * 0.95);
    for (let k = 0; k < need; k++) pts.push(lo + ((hi - lo) * (k + 0.5)) / need);
    return pts.sort((a, b) => a - b);
  }

  function rmBuild(cids, opts) {
    const R = RM_RHYTHM[opts.rhythm] || RM_RHYTHM.medio;
    const clips = cids.map(c => byId[c]).filter(Boolean);
    if (!clips.length) return 0;
    const target = +opts.target || 30;
    // cuántos cortes caben: el tope duro del servidor son 24
    let nSeg = Math.max(clips.length, Math.min(24, Math.round(target / R.seg)));
    const scoreOf = c => Math.max(1, ai[c.clip_id]?.travel_score || 5);
    const totScore = clips.reduce((a, c) => a + scoreOf(c), 0);
    // cuota por clip: proporcional al score, mínimo 1, y nunca más cortes que segundos útiles
    const quota = clips.map(c => Math.max(1,
      Math.min(Math.round((nSeg * scoreOf(c)) / totScore), Math.floor((c.duration_s || 1) / 0.7) || 1)));
    let over = quota.reduce((a, b) => a + b, 0) - 24;   // recorta si el redondeo se pasó del tope
    for (let i = quota.length - 1; i >= 0 && over > 0; i--) {
      const cut = Math.min(over, quota[i] - 1);
      quota[i] -= cut; over -= cut;
    }
    const segs = [];
    clips.forEach((c, ci) => {
      const dur = c.duration_s || 0;
      // el corte no puede pasar de lo que el clip da de sí (ni del tope de 120s del server)
      const segDur = Math.min(R.seg, Math.max(0.7, dur / quota[ci]), 120);
      rmMoments(c.clip_id, quota[ci]).forEach(t => {
        let a = t - segDur / 2;
        a = Math.max(0, Math.min(a, Math.max(0, dur - segDur)));
        const b = Math.min(dur, a + segDur);
        if (b - a < 0.35) return;
        segs.push(makeSeg(c.clip_id, a, b, {
          filter: opts.look || 'none',
          transition: segs.length === 0 ? 'none' : R.trans,
          transDur: R.dur,
        }));
      });
    });
    if (!segs.length) return 0;
    // ajuste fino a la duración objetivo: escala uniforme respetando el mínimo por corte
    const total = () => segs.reduce((a, s) => a + (s.b - s.a), 0);
    const k = target / total();
    if (k < 1) segs.forEach(s => {
      const nd = Math.max(0.6, (s.b - s.a) * k);
      s.b = +(s.a + nd).toFixed(2);
    });
    pushUndo();
    tl = segs;
    sel = 0; playhead = 0; curCid = null;
    const fmtSel = RM_FORMATS[opts.aspect] || RM_FORMATS['9:16'];
    const asp = document.getElementById('ed-aspect');
    const res = document.getElementById('ed-res');
    if (asp) { asp.value = opts.aspect; applyAspect(); }
    if (res) res.value = fmtSel.res;
    const lut = document.getElementById('ed-lut');
    if (lut && opts.look) lut.value = opts.look;
    renderAll(); seek(0);
    return segs.length;
  }

  function openReelMaker() {
    const ovr = document.createElement('div');
    ovr.className = 'modal-ov';
    const pick = new Set();
    const st = { step: 1, q: '', target: 30, rhythm: 'medio', look: 'cine', aspect: '9:16' };
    const pool = () => editable.slice().sort((a, b) =>
      (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    const visible = () => pool().filter(f => {
      if (!st.q) return true;
      const hay = `${f.label || ''} ${f.date} ${fmt.date(f.date)} ${f.time || ''} ${(ai[f.clip_id]?.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(st.q.toLowerCase());
    });
    const estimate = () => {
      const R = RM_RHYTHM[st.rhythm];
      const n = Math.max(pick.size, Math.min(24, Math.round(st.target / R.seg)));
      return `~${n} cortes · ${st.target}s`;
    };
    // pie (contador + estado del botón) — lo único que cambia al marcar/desmarcar una toma
    const syncFoot = () => {
      const c = ovr.querySelector('.rm-count');
      if (c) c.textContent = pick.size
        ? `${pick.size} toma${pick.size === 1 ? '' : 's'} · ${estimate()}` : 'Elige al menos una toma';
      ovr.querySelector('#rm-go')?.toggleAttribute('disabled', !pick.size);
    };
    const render = () => {
      const vis = visible();
      ovr.innerHTML = `<div class="modal rm-modal">
        <div class="modal-h"><b>${icon('spark')} Crear reel</b>
          <span class="rm-steps"><i class="${st.step === 1 ? 'on' : ''}">1 · Tomas</i><i class="${st.step === 2 ? 'on' : ''}">2 · Receta</i></span>
          <button class="modal-x" aria-label="Cerrar">✕</button></div>
        <div class="modal-b">
        ${st.step === 1 ? `
          <div class="rm-bar">
            <label class="search" style="flex:1"><input id="rm-q" placeholder="Buscar toma, fecha o tag AI…" value="${esc(st.q)}"></label>
            <button class="btn sm" id="rm-all">Todas (${vis.length})</button>
            <button class="btn sm" id="rm-none">Ninguna</button>
          </div>
          <div class="rm-grid">${vis.map(f => {
            const sc = ai[f.clip_id]?.travel_score;
            return `<button class="rm-clip${pick.has(f.clip_id) ? ' on' : ''}" data-pick="${esc(f.clip_id)}">
              <img src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="">
              <span class="rm-check">${pick.has(f.clip_id) ? '✓' : ''}</span>
              ${sc ? `<span class="rm-sc ${sc >= 7 ? 'ok' : sc >= 4 ? 'mid' : 'bad'}">✨${sc}</span>` : ''}
              <span class="rm-lb">${esc((f.label || fmt.date(f.date)).slice(0, 22))}<em>${fmt.dur(f.duration_s)}</em></span>
            </button>`;
          }).join('') || '<p class="footer-note">Nada coincide con esa búsqueda.</p>'}</div>` : `
          <div class="mlb">Duración objetivo</div>
          <div class="rm-opts">${[15, 30, 60].map(t => `
            <button class="rm-opt${st.target === t ? ' on' : ''}" data-target="${t}"><b>${t}s</b><small>${t === 15 ? 'gancho rápido' : t === 30 ? 'el punto dulce' : 'historia completa'}</small></button>`).join('')}</div>
          <div class="mlb">Ritmo</div>
          <div class="rm-opts">${Object.entries(RM_RHYTHM).map(([k, v]) => `
            <button class="rm-opt${st.rhythm === k ? ' on' : ''}" data-rhythm="${k}"><b>${v.lb}</b><small>${v.sub}</small></button>`).join('')}</div>
          <div class="mlb">Formato</div>
          <div class="rm-opts">${Object.entries(RM_FORMATS).map(([k, v]) => `
            <button class="rm-opt${st.aspect === k ? ' on' : ''}" data-aspect="${k}"><span class="rm-ar ar${k.replace(':', '')}"></span><b>${v.lb}</b><small>${v.sub}</small></button>`).join('')}</div>
          <div class="mlb">Look</div>
          <div class="rm-opts look">${[['none', 'Sin look'], ['cine', 'Cine'], ['vivid', 'Vivid'], ['warm', 'Cálido'], ['moody', 'Moody'], ['bw', 'B&N']].map(([k, lb]) => `
            <button class="rm-opt sm${st.look === k ? ' on' : ''}" data-look="${k}"><b>${lb}</b></button>`).join('')}</div>`}
        </div>
        <div class="rm-foot">
          <span class="rm-count mono">${pick.size ? `${pick.size} toma${pick.size === 1 ? '' : 's'} · ${estimate()}` : 'Elige al menos una toma'}</span>
          <span class="spacer" style="flex:1"></span>
          ${st.step === 2 ? '<button class="btn" id="rm-back">‹ Tomas</button>' : ''}
          <button class="btn primary" id="rm-go" ${pick.size ? '' : 'disabled'}>${st.step === 1 ? 'Continuar ›' : `${icon('spark')} Crear reel`}</button>
        </div>
      </div>`;
    };
    render();
    document.body.appendChild(ovr);
    ovr.addEventListener('click', e => {
      if (e.target === ovr || e.target.closest('.modal-x')) { ovr.remove(); return; }
      const p = e.target.closest('[data-pick]');
      if (p) {
        // patch EN SITIO: re-renderizar el grid entero por cada click recargaba 113 <img>,
        // perdía el scroll y parpadeaba (misma lección que las tarjetas de Trabajos)
        const cid = p.dataset.pick;
        pick.has(cid) ? pick.delete(cid) : pick.add(cid);
        p.classList.toggle('on', pick.has(cid));
        const chk = p.querySelector('.rm-check');
        if (chk) chk.textContent = pick.has(cid) ? '✓' : '';
        syncFoot();
        return;
      }
      if (e.target.closest('#rm-all')) { visible().forEach(f => pick.add(f.clip_id)); render(); return; }
      if (e.target.closest('#rm-none')) { pick.clear(); render(); return; }
      const o = e.target.closest('[data-target],[data-rhythm],[data-aspect],[data-look]');
      if (o) {
        const d = o.dataset;
        if (d.target) st.target = +d.target;
        if (d.rhythm) st.rhythm = d.rhythm;
        if (d.aspect) st.aspect = d.aspect;
        if (d.look) st.look = d.look;
        render(); return;
      }
      if (e.target.closest('#rm-back')) { st.step = 1; render(); return; }
      if (e.target.closest('#rm-go')) {
        if (!pick.size) return;
        if (st.step === 1) { st.step = 2; render(); return; }
        const n = rmBuild([...pick], st);
        ovr.remove();
        if (n) {
          showMod('editor');
          scrollTo({ top: 0, behavior: 'smooth' });
          toast(`Reel armado: ${n} cortes de ${pick.size} toma${pick.size === 1 ? '' : 's'} — ahora edítalo`);
        }
      }
    });
    ovr.addEventListener('input', e => {
      if (e.target.id === 'rm-q') {
        st.q = e.target.value;
        const car = e.target.selectionStart;
        render();
        const nx = ovr.querySelector('#rm-q');
        if (nx) { nx.focus(); try { nx.setSelectionRange(car, car); } catch {} }
      }
    });
  }
  document.getElementById('rm-open')?.addEventListener('click', openReelMaker);

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
    if (e.target.closest('.tl-x')) return;   // la ⨯ no inicia drag/selección
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
    if (e.target.closest('.tl-clip') || e.target.closest('.tl-handle') || e.target.closest('.tl-junction')) return;
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
  function seekPaused(gt) {
    pause(); seek(gt);
    // la selección SIGUE al playhead: el inspector y las herramientas siempre
    // apuntan al clip que estás viendo (antes: seleccionar era un paso aparte oculto)
    const at = clipAt(playhead);
    if (at && at.idx !== sel) {
      sel = at.idx;
      renderInspector();
      track.querySelectorAll('.tl-clip').forEach(c => c.classList.toggle('sel', +c.dataset.i === sel));
    }
    syncTools();
  }

  // 4 · playhead arrastrable
  phEl.addEventListener('pointerdown', e => {
    e.stopPropagation(); pause();
    phEl.setPointerCapture(e.pointerId);
    const drag = ev => {
      const r = track.getBoundingClientRect();
      const gt = Math.max(0, Math.min(total(), (ev.clientX - r.left + scroll.scrollLeft) / pps));
      seek(gt); syncTools();   // seek recarga solo si cruza a otro clip; dentro del mismo = fluido
    };
    // pointercancel (touch interrumpido) también debe soltar los listeners, si no se acumulan (#20)
    const up = () => { phEl.removeEventListener('pointermove', drag); phEl.removeEventListener('pointerup', up); phEl.removeEventListener('pointercancel', up); };
    phEl.addEventListener('pointermove', drag);
    phEl.addEventListener('pointerup', up);
    phEl.addEventListener('pointercancel', up);
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
  // rueda sobre el timeline: scroll vertical → desplazamiento horizontal (natural en
  // timelines); ⌘/Ctrl+rueda = zoom anclado al cursor. "la barra es difícil de navegar".
  scroll.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = track.getBoundingClientRect();
      const tAtCursor = (e.clientX - r.left + scroll.scrollLeft) / pps;
      pps = Math.max(8, Math.min(240, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      renderAll();
      scroll.scrollLeft = Math.max(0, tAtCursor * pps - (e.clientX - scroll.getBoundingClientRect().left));
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scroll.scrollLeft += e.deltaY;
    }
  }, { passive: false });

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

  // --- undo de ediciones continuas (texto/slider/color): una instantánea ANTES del primer
  // cambio de la sesión (bug: el snapshot en 'change' se tomaba DESPUÉS de mutar → undo no
  // revertía). Se re-arma en cada focus; commitEdit sólo empuja en el primer input real.
  let editArmed = false;
  const armEdit = () => { editArmed = true; };
  const commitEdit = () => { if (editArmed) { editArmed = false; if (selSeg()) pushUndo(); } };
  ['tli-title', 'tli-title-size', 'tli-title-color', 'tli-trans-dur'].forEach(id => $(id).addEventListener('focus', armEdit));

  // --- título + estilo ---
  $('tli-title').addEventListener('input', e => { const s = selSeg(); if (!s) return; commitEdit(); s.title = e.target.value; renderTrack(); });
  $('tli-title-pos').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.pos = e.target.value; } });
  $('tli-title-size').addEventListener('input', e => { const s = selSeg(); if (!s) return; commitEdit(); s.titleStyle.size = +e.target.value; });
  $('tli-title-color').addEventListener('input', e => { const s = selSeg(); if (!s) return; commitEdit(); s.titleStyle.color = e.target.value.replace('#', ''); });
  $('tli-title-box').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.box = e.target.checked; } });

  // --- transición de entrada (librería) + duración ---
  $('tli-trans').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.transition = e.target.value; renderTrack(); } });
  $('tli-trans-dur').addEventListener('input', e => { const s = selSeg(); if (!s) return; commitEdit(); s.transDur = +e.target.value; $('tli-trans-dur-v').textContent = (+e.target.value).toFixed(1) + 's'; });

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
  // ---- picker de transiciones (popover en la unión) ----
  function openTxPicker(j, anchor) {
    document.querySelector('.tx-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'tx-pop';
    const cur = () => tl[j]?.transition || 'none';
    const curDur = () => tl[j]?.transDur || 0.4;
    const OPTS = ['none', 'fade', 'dissolve', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight',
                  'slideup', 'slidedown', 'circleopen', 'circleclose', 'radial', 'smoothleft', 'pixelize'];
    pop.innerHTML = `
      <div class="tx-pop-h"><b>Transición entre toma ${j} y ${j + 1}</b><button class="modal-x">✕</button></div>
      <div class="tx-grid">${OPTS.map(t => `
        <button class="tx-opt${cur() === t || (t === 'fade' && cur() === 'crossfade') ? ' on' : ''}" data-tx="${t}">
          <span class="tx-demo tx-${t}"><i></i></span><b>${TX_LABELS[t]}</b>
        </button>`).join('')}</div>
      <div class="tx-dur">
        <label>Duración</label>
        <input type="range" min="0.2" max="1.5" step="0.1" value="${curDur()}">
        <span class="mono">${curDur().toFixed(1)}s</span>
      </div>
      <button class="btn tx-all">${icon('layers')} Aplicar a todas las uniones</button>`;
    document.body.appendChild(pop);
    // posicionar junto al nodo, contenido en el viewport
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, phh = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    pop.style.top = (r.top - phh - 10 > 8 ? r.top - phh - 10 : r.bottom + 10) + 'px';
    const paint = () => {
      pop.querySelectorAll('.tx-opt').forEach(b =>
        b.classList.toggle('on', b.dataset.tx === cur() || (b.dataset.tx === 'fade' && cur() === 'crossfade')));
      pop.querySelector('.tx-dur .mono').textContent = curDur().toFixed(1) + 's';
    };
    pop.addEventListener('click', e => {
      if (e.target.closest('.modal-x')) { pop.remove(); return; }
      const o = e.target.closest('.tx-opt');
      if (o) {
        pushUndo(); tl[j].transition = o.dataset.tx; if (!tl[j].transDur) tl[j].transDur = 0.4;
        renderTrack(); paint();
        if (sel === j) renderInspector();
        // preview inmediato: salta al último medio segundo del clip anterior
        seekPaused(Math.max(0, offset(j) - 0.6));
        return;
      }
      if (e.target.closest('.tx-all')) {
        pushUndo();
        for (let i = 1; i < tl.length; i++) { tl[i].transition = cur(); tl[i].transDur = curDur(); }
        renderTrack();
        pop.querySelector('.tx-all').textContent = '✓ Aplicada a todas';
        setTimeout(() => pop.remove(), 700);
      }
    });
    pop.querySelector('.tx-dur input').addEventListener('input', e => {
      tl[j].transDur = +e.target.value; paint();
    });
    const away = e => { if (!pop.contains(e.target) && !e.target.closest('.tl-junction')) { pop.remove(); removeEventListener('pointerdown', away, true); } };
    addEventListener('pointerdown', away, true);
  }

  track.addEventListener('click', e => {
    const jn = e.target.closest('.tl-junction');
    if (jn) { e.stopPropagation(); openTxPicker(+jn.dataset.j, jn); return; }
    const x = e.target.closest('.tl-x');
    if (x) { e.stopPropagation(); delClip(+x.dataset.x); return; }
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
  function syncFpsChips() {   // refleja edFps en el chip activo (evita desync tras restore)
    document.querySelectorAll('#ed-fps .chip').forEach(x => x.classList.toggle('on', (x.dataset.fps || '') === String(edFps ?? '')));
  }
  document.getElementById('ed-fps').addEventListener('click', e => {
    const b = e.target.closest('[data-fps]'); if (!b) return;
    edFps = b.dataset.fps;
    syncFpsChips();
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
  function toast(msg) {   // aviso no-bloqueante (alert() rompe el flujo en móvil)
    const t = document.createElement('div');
    t.className = 'ed-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 350); }, 3600);
  }
  document.getElementById('ed-title')?.addEventListener('focus', e2 =>
    setTimeout(() => e2.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));  // el teclado iOS tapaba el input (sheet fija)
  document.getElementById('ed-export').addEventListener('click', async e => {
    if (!tl.length) return;
    const exBtn = e.currentTarget;
    if (exBtn.disabled) return;
    exBtn.disabled = true;     // doble tap móvil = 2 exports concurrentes que se pisaban
    setTimeout(() => { exBtn.disabled = false; }, 4000);
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
    // NO vaciar el timeline aquí: el job apenas se ENCOLÓ. Si el export falla (fps mezclados,
    // ffmpeg, cancel), vaciarlo destruía la edición del usuario — solo la rescataba un undo
    // que muere al recargar. El reel aparece solo vía el hook onDone de pollJobs.
    toast('Export encolado — míralo en Trabajos. Tu timeline sigue intacto.');
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
    // descarta segmentos cuyo clip_id ya no existe (proyecto viejo / clip archivado / manipulado):
    // uno huérfano rompería byId[cid] en makeSeg/render y dejaría el editor inconsistente
    tl = (p.tl || []).filter(s => s && byId[s.clip_id]).map(s => ({ ...s, id: uid() }));   // ids frescos
    const g = p.globals || {};
    const set = (id, v, chk) => { const el = document.getElementById(id); if (el && v != null) { if (chk) el.checked = !!v; else el.value = v; } };
    set('ed-aspect', g.aspect); set('ed-res', g.resolution); set('ed-preset', g.preset);
    set('ed-lut', g.lut); set('ed-trans', g.trans); set('ed-audio', g.audio);
    set('ed-title', g.title); set('ed-fade', g.fade, true);
    set('ed-bitrate', g.bitrate); if (g.fps != null) edFps = g.fps;
    syncFpsChips();   // alinea el chip de fps con edFps restaurado
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
  function openProjModal() { renderProjList(); projModal.style.display = 'grid'; }
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
      // ?a=/?b= no numéricos (+'abc' = NaN) insertarían un segmento con rango NaN → rompe la geometría
      const finite = (v, d) => Number.isFinite(v) ? v : d;
      const a = Math.max(0, Math.min(f.duration_s, finite(+params.get('a'), 0)));
      let b = Math.max(a, Math.min(f.duration_s, finite(+params.get('b'), Math.min(a + 5, f.duration_s))));
      if (b <= a) b = Math.min(f.duration_s, a + 5);
      tl.push(makeSeg(pClip, a, b));
      sel = 0; renderAll(); seek(0);
      document.querySelector(`.cr-item[data-cid="${pClip}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }, 100);
  }

  // pintado inicial (setTimeout: rAF no dispara con el tab oculto, patrón del repo)
  setTimeout(() => { renderAll(); fit(); }, 30);

})();
