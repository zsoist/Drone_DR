// Studio v5 — motor de medios: 4 módulos en tabs (Editor · Reels · Fotos · Trabajos).
// El editor de video v4 (carrusel, timeline arrastrable, Momentos AI, exportbar) vive
// intacto dentro del módulo Editor; Reels/Fotos gestionan la biblioteca vía /api/media_op.
const main = renderShell('studio.html');
main.classList.add('st-page');
main.innerHTML = `
  ${pageHead('Studio', 'Motor de medios — edita, gestiona y comparte', '<span class="gchip" id="st-count">cargando…</span>')}

  <div class="pm-tabs st-tabs rise" id="st-tabs" role="tablist" aria-label="Módulos de Studio">
    <button class="on" data-tab="editor" role="tab" aria-selected="true">${icon('film')} Editor</button>
    <button data-tab="reels" role="tab" aria-selected="false">${icon('play')} Reels</button>
    <button data-tab="fotos" role="tab" aria-selected="false">${icon('iso')} Fotos</button>
    <button data-tab="jobs" role="tab" aria-selected="false">${icon('activity')} Trabajos</button>
    <span class="pm-ink"></span>
  </div>

  <div class="st-up" id="up-zone">
    <button class="st-up-cta" id="up-pick">
      <span class="st-up-ic">${icon('dl')}</span>
      <span class="st-up-t"><b>Subir desde tu teléfono</b><small>Videos y fotos del carrete — se procesan solos al llegar</small></span>
      <span class="st-up-go">${icon('chevR')}</span>
    </button>
    <input type="file" id="up-file" accept="video/*,image/*" multiple hidden>
    <div class="st-up-list" id="up-list" hidden></div>
  </div>

  <section class="st-mod" data-mod="editor">
    <div class="tl-editor" id="tl-editor">

      <div class="panel st-panel">
        <!-- encabezado del editor: título + contador + proyecto (nuevo · guardar · abrir) -->
        <div class="ph st-ph" data-no-collapse>
          <span class="st-ph-t">${icon('film')} Editor</span>
          <span class="gchip" id="tl-stat">0 clips · 0:00</span>
          <span class="spacer"></span>
          <div class="st-ph-actions">
            <button class="btn sm ghost" id="ed-new" data-tip="Nuevo proyecto: vaciar y empezar de cero" aria-label="Nuevo proyecto">${icon('plusFile')}<span class="st-hide-sm">Nuevo</span></button>
            <button class="btn sm ghost" id="ed-save" data-tip="Guardar este proyecto" aria-label="Guardar proyecto">${icon('save')}<span class="st-hide-sm">Guardar</span></button>
            <button class="btn sm ghost" id="ed-open" data-tip="Abrir proyectos guardados" aria-label="Proyectos guardados">${icon('folder')}<span class="st-hide-sm">Proyectos</span></button>
            <span class="st-vsep" aria-hidden="true"></span>
            <button class="btn sm ghost" id="ed-keys" aria-label="Atajos de teclado" aria-expanded="false" aria-controls="tl-help" data-tip="Atajos de teclado">${icon('keyboard')}<span class="st-hide-sm">Atajos</span></button>
          </div>
        </div>
        <!-- 48 · ayuda de atajos -->
        <div class="st-help" id="tl-help" hidden>
          <span><kbd>Espacio</kbd> reproducir / pausa</span>
          <span><kbd>S</kbd> cortar en el playhead</span>
          <span><kbd>T</kbd> añadir texto</span>
          <span><kbd>Supr</kbd> eliminar clip</span>
          <span><kbd>←</kbd><kbd>→</kbd> mover playhead (<kbd>Shift</kbd> = 1 s)</span>
          <span><kbd>Alt</kbd><kbd>←</kbd><kbd>→</kbd> reordenar clip</span>
          <span><kbd>Cmd</kbd><kbd>Z</kbd> deshacer</span>
          <span><kbd>Cmd</kbd><kbd>Shift</kbd><kbd>Z</kbd> rehacer</span>
        </div>
        <div class="pb st-pb">

          <!-- 28-35 · escenario del compositor -->
          <div class="tl-stage" id="tl-stage">
            <video class="tl-video" id="tl-video" playsinline webkit-playsinline preload="auto" muted></video>
            <canvas class="tl-hold" id="tl-hold" aria-hidden="true"></canvas>
            <div class="tl-aspect-mask" id="tl-mask" data-aspect="16:9" hidden></div>
            <div class="tl-empty" id="tl-empty">
              ${icon('film')}
              <p><b>Tu timeline está vacío</b></p>
              <p>Toca un clip de la biblioteca para añadirlo, o usa <b>Momentos AI</b> para autoarmar el reel.</p>
            </div>
          </div>

          <!-- 32-35 + 12-17 · UNA barra: transporte · edición · IA · historial · vista -->
          <div class="tb" id="tl-toolbar" role="toolbar" aria-label="Herramientas del editor">
            <div class="tb-g">
              <button class="btn icon sm ghost" data-tp="start" data-tip="Ir al inicio" aria-label="Ir al inicio">${icon('skipStart')}</button>
              <button class="btn icon sm ghost" data-tp="prev" data-tip="Clip anterior" aria-label="Clip anterior">${icon('prev')}</button>
              <button class="btn sm primary tb-play" data-tp="play" data-tip="Reproducir / Pausa (Espacio)" aria-label="Reproducir o pausar">${icon('play')}<span>Play</span></button>
              <button class="btn icon sm ghost" data-tp="next" data-tip="Clip siguiente" aria-label="Clip siguiente">${icon('next')}</button>
              <button class="btn icon sm ghost" data-tp="end" data-tip="Ir al final" aria-label="Ir al final">${icon('skipEnd')}</button>
            </div>
            <span class="tb-time mono" id="tl-time">0:00 / 0:00</span>
            <div class="tb-g">
              <button class="btn icon sm ghost" data-tp="mute" data-tip="Activar / silenciar audio" aria-label="Audio">${icon('volume')}</button>
              <button class="btn icon sm ghost" data-tp="loop" data-tip="Repetir en bucle" aria-label="Bucle">${icon('loop')}</button>
            </div>
            <div class="tb-g">
              <button class="btn sm ghost" data-tool="razor" data-tip="Cortar en playhead (S)" aria-label="Cortar">${icon('scissors')}<span>Cortar</span></button>
              <button class="btn icon sm ghost" data-tool="dup" data-tip="Duplicar clip" aria-label="Duplicar clip">${icon('copy')}</button>
              <button class="btn icon sm ghost" data-tool="left" data-tip="Mover antes (⌥←)" aria-label="Mover clip antes">${icon('chevL')}</button>
              <button class="btn icon sm ghost" data-tool="right" data-tip="Mover después (⌥→)" aria-label="Mover clip después">${icon('chevR')}</button>
              <button class="btn icon sm ghost" data-tool="del" data-tip="Eliminar clip (Supr)" aria-label="Eliminar clip">${icon('trash')}</button>
              <button class="btn icon sm ghost" data-tool="clear" data-tip="Vaciar todo el timeline" aria-label="Vaciar timeline">${icon('broom')}</button>
            </div>
            <div class="tb-g">
              <button class="btn sm ghost tb-ai" data-tool="magic" id="btn-magic" data-tip="Autoarmar el reel con los mejores momentos" aria-label="Momentos AI">${icon('spark')}<span>Momentos AI</span></button>
              <button class="btn icon sm ghost" data-tool="music" id="btn-music" data-tip="Ponle música al reel (tu biblioteca)" aria-label="Música">${icon('volume')}</button>
              <button class="btn icon sm ghost" data-tool="text" id="btn-text" data-tip="Añadir texto en el playhead (T)" aria-label="Añadir texto">${icon('tag')}</button>
            </div>
            <div class="tb-g">
              <button class="btn icon sm ghost" data-tool="undo" data-tip="Deshacer (⌘Z)" aria-label="Deshacer">${icon('undo')}</button>
              <button class="btn icon sm ghost" data-tool="redo" data-tip="Rehacer (⌘⇧Z)" aria-label="Rehacer">${icon('redo')}</button>
            </div>
            <div class="tb-g tb-end">
              <button class="btn icon sm ghost" data-tool="zoomout" data-tip="Alejar timeline" aria-label="Alejar timeline">${icon('zoomOut')}</button>
              <button class="btn icon sm ghost" data-tool="zoomin" data-tip="Acercar timeline" aria-label="Acercar timeline">${icon('zoomIn')}</button>
              <button class="btn icon sm ghost" data-tool="fit" data-tip="Ajustar todo a la ventana" aria-label="Ajustar a la ventana">${icon('fit')}</button>
            </div>
          </div>

          <!-- 3,4,7 · regla + track con scroll horizontal -->
          <div class="tl-scroll" id="tl-scroll">
            <div class="tl-ruler" id="tl-ruler"></div>
            <div class="tl-track" id="tl-track"></div>
            <div class="tl-textlane" id="tl-textlane"></div>
            <div class="tl-playhead" id="tl-playhead"></div>
          </div>

          <!-- 18-23 · inspector del clip seleccionado (v7 · secciones agrupadas) -->
          <div class="tl-inspect" id="tl-inspect" hidden>
            <div class="tl-io">
              <dl class="tl-io-vals" id="tli-io"></dl>
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
              <div class="chip-row" id="tli-speed" role="group" aria-label="Velocidad"></div>
              <div class="tl-inspect-row tl-sp-row">
                <label for="tli-speed-range">Ajuste fino</label>
                <input class="tl-range" id="tli-speed-range" type="range" min="0.1" max="100" step="0.05">
                <span class="tl-numx"><input class="ctl" id="tli-speed-num" type="number" min="0.1" max="100" step="0.05" aria-label="Velocidad (x)"><span class="mono">x</span></span>
              </div>
              <div class="tl-sp-opts">
                <label class="tl-fld tl-fld-chk"><input type="checkbox" id="tli-reverse"><span>Reversa</span></label>
                <label class="tl-fld"><span>Congelar</span>
                  <span class="tl-numx"><input class="ctl" id="tli-freeze" type="number" min="0" max="10" step="0.1" value="0"><span class="mono">s</span></span></label>
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
                  <input class="u-f1 tl-range" id="tli-bright" type="range" min="50" max="150" step="1" value="100">
                  <span class="mono" id="tli-bright-v">100</span></div>
                <div class="tl-inspect-row"><label>Contraste</label>
                  <input class="u-f1 tl-range" id="tli-contrast" type="range" min="50" max="150" step="1" value="100">
                  <span class="mono" id="tli-contrast-v">100</span></div>
                <div class="tl-inspect-row"><label>Saturación</label>
                  <input class="u-f1 tl-range" id="tli-sat" type="range" min="0" max="200" step="1" value="100">
                  <span class="mono" id="tli-sat-v">100</span></div>
                <div class="tl-inspect-row"><label>Temperatura</label>
                  <input class="u-f1 tl-range" id="tli-temp" type="range" min="-100" max="100" step="1" value="0">
                  <span class="mono" id="tli-temp-v">0</span></div>
              </div>
            </div>

            <!-- sección Look (LUT) -->
            <div class="tl-sec" data-sec="look">
              <div class="tl-seclabel">${icon('layers')} Look</div>
              <div class="tl-inspect-row">
                <select class="u-f1 ctl" id="tli-filter">
                  <option value="none">Sin look</option>
                  <optgroup label="Cine">
                    <option value="nolan">Nolan — naturalista, sombras densas</option>
                    <option value="deakins">Deakins — desaturado, alto contraste</option>
                    <option value="malick">Malick — luz natural, suave</option>
                    <option value="fincher">Fincher — frío, digital limpio</option>
                    <option value="kodak">Kodak 2383 — copia de película + grano</option>
                    <option value="goldenhour">Golden Hour — atardecer cálido</option>
                  </optgroup>
                  <optgroup label="Comercial">
                    <option value="tealorange">Teal &amp; Orange — trailer</option>
                    <option value="cine">Cine</option><option value="vivid">Vivid</option>
                    <option value="warm">Cálido</option><option value="moody">Moody</option>
                    <option value="bw">B&amp;N</option>
                  </optgroup>
                </select>
              </div>
            </div>

            <!-- sección Título con estilo -->
            <div class="tl-sec" data-sec="title">
              <div class="tl-seclabel">${icon('tag')} Título</div>
              <div class="tl-inspect-row">
                <input class="u-f1 ctl" id="tli-title" placeholder="Título de este corte…" maxlength="60">
              </div>
              <div class="tl-inspect-row">
                <label>Estilo</label>
                <select class="ctl" id="tli-title-style" data-tip="Cada estilo trae su propia animación de entrada">
                  <option value="clean">Limpio</option>
                  <option value="bold">Bold · mayúsculas</option>
                  <option value="kinetic">Kinético · sube</option>
                  <option value="lower">Lower third · entra</option>
                  <option value="minimal">Minimal</option>
                </select>
                <label>Fuente</label>
                <select class="ctl" id="tli-title-font" data-tip="Fuentes del sistema, se renderizan en el Mac">
                  <option value="sans">Helvetica Neue</option>
                  <option value="condensed">Avenir Condensed</option>
                  <option value="avenir">Avenir Next</option>
                  <option value="optima">Optima</option>
                  <option value="serif">Georgia</option>
                  <option value="mono">Menlo</option>
                </select>
              </div>
              <div class="tl-inspect-row">
                <label>Posición</label>
                <select class="ctl" id="tli-title-pos">
                  <option value="top">Arriba</option><option value="mid">Centro</option><option value="bottom">Abajo</option>
                </select>
                <label>Tamaño</label>
                <input class="u-f1 u-minw70 tl-range" id="tli-title-size" type="range" min="1" max="100" step="1" value="40">
              </div>
              <div class="tl-inspect-row">
                <label>Color</label>
                <input class="u-color ctl" id="tli-title-color" type="color" value="#ffffff">
                <span class="spacer"></span>
                <label class="u-chk"><input type="checkbox" id="tli-title-box"> Fondo</label>
              </div>
            </div>

            <!-- sección Transición de entrada (librería) -->
            <div class="tl-sec" data-sec="trans">
              <div class="tl-seclabel">${icon('activity')} Transición de entrada</div>
              <div class="tl-inspect-row">
                <select class="u-f1 ctl" id="tli-trans">
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
                <input class="u-f1 tl-range" id="tli-trans-dur" type="range" min="0.2" max="1.5" step="0.1" value="0.4">
                <span class="mono" id="tli-trans-dur-v">0.4s</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 24-27 · biblioteca de clips fuente -->
      <div class="tl-lib panel">
        <div class="ph" data-no-collapse>${icon('film')} Paso 1 · Elige tu video
          <span class="spacer"></span>
          <span class="st-note">Toca = añadir al final · + = insertar en el playhead</span>
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
            <button class="modal-x" type="button" id="ex-close" aria-label="Cerrar" data-tip="Cerrar">${icon('close')}</button>
          </div>
          <div class="ex-body">
            <div class="ex-row">
              <label class="eb-field"><span>Preset</span>
              <select class="ctl" id="ed-preset">
                <option value="">Manual…</option>
                <option value="tiktok">TikTok</option>
                <option value="reels">Instagram Reels</option>
                <option value="shorts">YouTube Shorts</option>
                <option value="feed45">Feed 4:5</option>
                <option value="square">Cuadrado</option>
                <option value="yt1080">YouTube 1080</option>
                <option value="yt4k">YouTube 4K</option>
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
            <div class="ex-sec" id="ex-vfit-sec">
              <span class="ex-lb">Cómo llenar el vertical <b class="mono" id="ed-vfit-v">recorte</b></span>
              <div class="tl-chips" id="ed-vfit">
                <button class="chip on" data-vfit="crop" data-tip="Recorta a lo alto: se pierde lo que no cabe, pero llena la pantalla">Recorte</button>
                <button class="chip" data-vfit="blur" data-tip="Conserva el encuadre completo sobre un fondo difuminado — el look de los reels">Fondo difuminado</button>
                <button class="chip" data-vfit="bars" data-tip="Barras negras arriba y abajo, sin perder nada">Barras</button>
              </div>
              <div class="ex-frame" id="ex-frame-row">
                <span>Punto focal</span>
                <input class="tl-range" id="ed-framing" type="range" min="-1" max="1" step="0.05" value="0">
                <b class="mono" id="ed-framing-v">centro</b>
              </div>
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
                <option value="none">Sin look</option>
                <optgroup label="Cine">
                  <option value="nolan">Nolan</option>
                  <option value="deakins">Deakins</option>
                  <option value="malick">Malick</option>
                  <option value="fincher">Fincher</option>
                  <option value="kodak">Kodak 2383</option>
                  <option value="goldenhour">Golden Hour</option>
                </optgroup>
                <optgroup label="Comercial">
                  <option value="tealorange">Teal &amp; Orange</option>
                  <option value="cine">Cine</option><option value="vivid">Vivid</option></optgroup>
                <optgroup label="Más">
                  <option value="warm">Cálido</option><option value="moody">Moody</option>
                  <option value="bw">B&amp;N</option>
                </optgroup>
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
            <div class="ex-row" id="ed-replace-row" style="display:none">
              <label class="ex-check" data-tip="El reel original se sustituye por esta versión al exportar">
                <input type="checkbox" id="ed-replace" checked>
                Reemplazar <b id="ed-replace-name" class="mono"></b></label>
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
            <button class="modal-x" type="button" id="proj-close" aria-label="Cerrar" data-tip="Cerrar">${icon('close')}</button>
          </div>
          <div class="pb" id="proj-list"></div>
        </div>
      </div>

    </div>
  </section>

  <section class="st-mod" data-mod="reels" style="display:none">
    <div class="rm-ctas">
      <button class="rm-cta" id="rm-open">
        <span class="rm-cta-ic">${icon('film')}</span>
        <span class="rm-cta-t"><b>Crear reel</b><small>Elige tus tomas y AeroBrain arma el montaje; luego lo editas</small></span>
        <span class="rm-cta-go">${icon('chevR')}</span>
      </button>
      <div class="rm-auto">
        <div class="rm-auto-h"><b>${icon('spark')} Reel automático</b><small>Un toque y listo: elige la sesión y la duración</small></div>
        <label class="rm-daypick"><span>Sesión</span>
          <select class="ctl" id="rm-day"><option value="">Mejor día automático</option></select></label>
        <div class="rm-auto-b">
          <button class="rm-autobtn" data-auto="15"><b>15s</b><span>gancho</span></button>
          <button class="rm-autobtn primary" data-auto="30"><b>30s</b><span>el punto dulce</span></button>
          <button class="rm-autobtn" data-auto="60"><b>60s</b><span>historia</span></button>
        </div>
      </div>
    </div>
    <div class="media-toolbar">
      <label class="search u-f1 u-minw150"><input id="q-reels" type="search" placeholder="Buscar reel…" aria-label="Buscar reel"></label>
      <select class="ctl" id="s-reels" aria-label="Ordenar por">
        <option value="recientes">Más recientes</option>
        <option value="tamano">Más pesados</option>
        <option value="nombre">Nombre A–Z</option>
      </select>
      <button class="btn" id="btn-ord" data-tip="Modo reordenar: mueve los reels con las flechas y guarda el orden" aria-pressed="false">${icon('swap')} Reordenar</button>
    </div>
    <div class="media-grid" id="grid-reels"><div class="sk-card sk"></div><div class="sk-card sk"></div></div>
  </section>

  <section class="st-mod" data-mod="fotos" style="display:none">
    <div class="td-jobbar" id="fotos-sub" aria-label="Origen de fotos">
      <button class="chip on" data-fsub="fotos">Capturas</button>
      <button class="chip" data-fsub="dron">Del dron <span class="mono" id="dron-count"></span></button>
    </div>
    <div class="media-toolbar">
      <label class="search u-f1 u-minw150"><input id="q-fotos" type="search" placeholder="Buscar foto…" aria-label="Buscar foto"></label>
      <select class="ctl" id="s-fotos" aria-label="Ordenar por">
        <option value="recientes">Más recientes</option>
        <option value="tamano">Más pesados</option>
        <option value="nombre">Nombre A–Z</option>
      </select>
    </div>
    <div class="media-grid" id="grid-fotos"><div class="sk-card sk"></div><div class="sk-card sk"></div></div>
    <div class="media-grid" id="grid-dron" style="display:none"><div class="sk-card sk"></div><div class="sk-card sk"></div></div>
  </section>

  <section class="st-mod" data-mod="jobs" style="display:none">
    <div class="panel">
      <div class="ph" data-no-collapse>${icon('activity')} Trabajos recientes
        <span class="spacer"></span>
        <span class="gchip" id="jobs-count" hidden></span>
      </div>
      <div class="pb st-jobs" id="jobs"></div>
      <div class="st-more" id="jobs-more" hidden>
        <button class="btn sm" id="jobs-more-btn"></button>
      </div>
    </div>
  </section>`;

// ---- tabs de módulo con tinta deslizante (mismo patrón que el photo editor) ----
const stTabs = document.getElementById('st-tabs');
const stInk = stTabs.querySelector('.pm-ink');
function moveInk() {
  const on = stTabs.querySelector('button.on');
  stInk.style.setProperty('--ink-x', on.offsetLeft + 'px');
  stInk.style.setProperty('--ink-w', on.offsetWidth + 'px');
}
setTimeout(moveInk, 30);   // tras layout; rAF no dispara con tab oculto
window.addEventListener('resize', () => setTimeout(moveInk, 30));

const seenMods = new Set(['editor']);
function showMod(name) {
  stTabs.querySelectorAll('button').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  const upz = document.getElementById('up-zone');
  if (upz) upz.hidden = name === 'jobs';
  moveInk();
  document.querySelectorAll('.st-mod').forEach(m => {
    const show = m.dataset.mod === name;
    if (show && m.style.display === 'none') {
      m.style.display = '';
      // la entrada corre UNA vez por módulo (primer montaje), no en cada cambio de tab
      if (!seenMods.has(name)) {
        seenMods.add(name);
        m.classList.add('st-enter');
        m.addEventListener('animationend', () => m.classList.remove('st-enter'), { once: true });
      }
    } else if (!show) {
      // teardown SPA: los <video> del grid siguen decodificando si no se pausan al ocultar el tab
      m.querySelectorAll('.media-grid video').forEach(v => { try { v.pause(); } catch {} });
      if (m.dataset.mod === 'editor' || m.querySelector('#tl-video')) {
        try { document.getElementById('tl-video')?.pause(); } catch {}
        try { window.__abEditorPause?.(); } catch {}   // corta también la música y el rAF de reproducción
      }
      m.style.display = 'none';
    }
  });
}
stTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showMod(b.dataset.tab);
});
// deep-link: studio.html?tab=jobs|reels|fotos|editor (Dron enlaza a Trabajos)
{
  const want = new URLSearchParams(location.search).get('tab');
  if (want && want !== 'editor' && stTabs.querySelector(`[data-tab="${CSS.escape(want)}"]`)) showMod(want);
}

// ---- atajos de teclado: botón fantasma en la cabecera del editor ----
document.getElementById('ed-keys')?.addEventListener('click', e => {
  const help = document.getElementById('tl-help');
  help.hidden = !help.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
  e.currentTarget.classList.toggle('on', !help.hidden);
});

// ---- I7 · compartir sin perder el gesto del usuario ----
// El archivo se descarga a un File cacheado en cuanto el dedo TOCA el botón; para cuando
// llega el 'click', navigator.share() puede llamarse de inmediato (iOS exige que share()
// ocurra dentro de la activación del usuario, y un await previo la invalida).
const shareCache = new Map();
const SHARE_MAX = 180 * 1024 * 1024;    // guardia anti-OOM en móvil
// iPadOS se declara 'MacIntel': hay que mirar también los puntos táctiles
const IS_IOS = /iP(hone|ad|od)/.test(navigator.platform)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function primeShare(url, name, mime) {
  const hit = shareCache.get(url);
  if (hit) return hit;
  const p = fetch(url)
    .then(r => {
      const len = +r.headers.get('Content-Length') || 0;
      if (len > SHARE_MAX) throw new Error('demasiado grande para compartir');
      return r.blob();
    })
    .then(b => {
      const f = new File([b], name, { type: b.type || mime });
      p._file = f;              // marca de "ya está listo" para el click síncrono
      return f;
    });
  shareCache.set(url, p);
  setTimeout(() => shareCache.delete(url), 120000);   // no retener blobs eternamente
  return p;
}
// liberar memoria al salir de la pestaña (iOS mata la página si acumulas blobs)
addEventListener('visibilitychange', () => { if (document.hidden) shareCache.clear(); });

// ================= SUBIDA DESDE EL TELÉFONO =================
// Un input file con accept="video/*,image/*" abre el CARRETE en iOS. Se sube archivo a
// archivo (no en paralelo): el túnel y el iPhone rinden mejor así, y el progreso es honesto.
(() => {
  const zone = document.getElementById('up-zone');
  if (!zone) return;
  const input = document.getElementById('up-file');
  const list = document.getElementById('up-list');
  const VID = /\.(mp4|mov|m4v|mkv|avi|mts|webm)$/i;
  const IMG = /\.(jpe?g|png|heic|heif|webp|dng)$/i;

  const row = f => {
    const el = document.createElement('div');
    el.className = 'st-up-row';
    el.innerHTML = `<span class="st-up-n">${esc(f.name)}</span>
      <span class="st-up-sz mono">${fmt.gb(f.size)}</span>
      <span class="st-up-bar"><i></i></span>
      <span class="st-up-st mono">en cola</span>`;
    list.appendChild(el);
    return el;
  };

  async function send(file, el) {
    const isVid = VID.test(file.name);
    const isImg = IMG.test(file.name);
    if (!isVid && !isImg) {
      el.querySelector('.st-up-st').textContent = 'formato no soportado';
      el.classList.add('bad');
      return null;
    }
    const url = isVid ? `/upload?name=${encodeURIComponent(file.name)}`
      : `/api/photo_upload?name=${encodeURIComponent(file.name)}`;
    // XHR (no fetch): es la única forma de tener progreso REAL de subida
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', e => {
        if (!e.lengthComputable) return;
        const p = e.loaded / e.total;
        el.querySelector('.st-up-bar i').style.setProperty('--p', p.toFixed(3));
        el.querySelector('.st-up-st').textContent = `${Math.round(p * 100)}%`;
      });
      xhr.addEventListener('load', () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 400 || d.error) {
          el.classList.add('bad');
          el.querySelector('.st-up-st').textContent = (d.error || `error ${xhr.status}`).slice(0, 40);
        } else {
          el.classList.add('ok');
          el.querySelector('.st-up-bar i').style.setProperty('--p', '1');
          el.querySelector('.st-up-st').textContent = isVid ? 'procesando…' : 'listo';
        }
        resolve(d);
      });
      xhr.addEventListener('error', () => {
        el.classList.add('bad');
        el.querySelector('.st-up-st').textContent = 'falló la red';
        resolve(null);
      });
      xhr.send(file);
    });
  }

  async function handle(files) {
    const arr = [...files];
    if (!arr.length) return;
    list.hidden = false;
    let vids = 0, imgs = 0;
    for (const f of arr) {
      const el = row(f);
      const r = await send(f, el);          // secuencial a propósito
      if (r && !r.error) { VID.test(f.name) ? vids++ : imgs++; }
    }
    await loadMedia();
    toast(`Subida lista: ${vids} video${vids === 1 ? '' : 's'} y ${imgs} foto${imgs === 1 ? '' : 's'}`
      + (vids ? ' — los videos se están procesando, míralos en Trabajos' : ''));
    setTimeout(() => { list.innerHTML = ''; list.hidden = true; }, 9000);
  }

  document.getElementById('up-pick').addEventListener('click', () => input.click());
  input.addEventListener('change', e => { handle(e.target.files); e.target.value = ''; });
  ['dragover', 'dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    zone.classList.toggle('hot', ev === 'dragover');
    if (ev === 'drop') handle(e.dataTransfer.files);
  }));
})();

// ================= VISOR DE REELS (R2) =================
// Pantalla dedicada para ver un reel terminado: reproductor grande sobre el póster
// difuminado, ficha con datos reales, navegación entre reels y acciones sin salir.
function reelFormatLabel(it) {
  const ar = it?.w && it?.h ? it.w / it.h : 0;
  if (!ar) return '';
  return ar < 0.65 ? '9:16 · Reels · TikTok · Shorts'
    : ar < 0.9 ? '4:5 · Feed'
      : ar < 1.1 ? '1:1 · Cuadrado'
        : '16:9 · YouTube · web';
}
function openReelViewer(name) {
  const list = (media?.reels || []);
  let idx = list.findIndex(r => r.name === name);
  if (idx < 0) return;
  const ov = document.createElement('div');
  ov.className = 'rv-ov';
  let armedDelete = false;
  let edit = false;                       // panel de edición desplegado
  let trim = { a: 0, b: null };           // recorte en curso

  const render = () => {
    const it = list[idx];
    if (!it) { ov.remove(); return; }
    const base = it.name.replace(/\.[^.]+$/, '');
    const url = `/data/reels/${encodeURIComponent(it.name)}`;
    const poster = `/data/reel-posters/${encodeURIComponent(base)}.jpg`;
    const vert = it.w && it.h && it.w / it.h < 0.9;
    ov.innerHTML = `
      <div class="rv-bg" style="background-image:url('${poster}')"></div>
      <div class="rv-shell">
        <div class="rv-head">
          <div class="rv-title">
            <b id="rv-name">${esc(base)}</b>
            <span class="mono">${list.length > 1 ? `${idx + 1} / ${list.length} · ` : ''}${mdate(it.mtime)}</span>
          </div>
          <span class="u-f1 spacer"></span>
          <button class="btn icon ghost rv-x" data-rv="close" aria-label="Cerrar">${icon('close')}</button>
        </div>
        <div class="rv-stage${vert ? ' vert' : ''}">
          ${list.length > 1 ? `<button class="rv-nav prev" data-rv="prev" aria-label="Anterior">${icon('chevL')}</button>` : ''}
          <video src="${url}" poster="${poster}" controls autoplay playsinline preload="metadata"></video>
          ${list.length > 1 ? `<button class="rv-nav next" data-rv="next" aria-label="Siguiente">${icon('chevR')}</button>` : ''}
        </div>
        <div class="rv-facts">
          ${it.duration_s ? `<span><i>${icon('clock')}</i><b>${fmt.dur(it.duration_s)}</b><em>duración</em></span>` : ''}
          ${it.h ? `<span><i>${icon('film')}</i><b>${it.w}×${it.h}</b><em>resolución</em></span>` : ''}
          <span><i>${icon('db')}</i><b>${fmt.gb(it.bytes)}</b><em>peso</em></span>
          ${it.has_audio !== undefined ? `<span><i>${icon('volume')}</i><b>${it.has_audio ? 'Sí' : 'No'}</b><em>audio</em></span>` : ''}
          ${reelFormatLabel(it) ? `<span class="wide"><i>${icon('layers')}</i><b>${reelFormatLabel(it)}</b><em>formato</em></span>` : ''}
        </div>
        <div class="rv-edit" id="rv-edit" ${edit ? '' : 'hidden'}>
          <div class="rv-edit-row">
            <span class="rv-elb">${icon('scissors')} Recortar</span>
            <input type="range" id="rv-a" min="0" max="${(it.duration_s || 1).toFixed(1)}" step="0.1" value="${trim.a}">
            <input type="range" id="rv-b" min="0" max="${(it.duration_s || 1).toFixed(1)}" step="0.1" value="${trim.b ?? it.duration_s ?? 1}">
            <span class="mono" id="rv-trimlb">${fmt.dur(trim.a)} – ${fmt.dur(trim.b ?? it.duration_s ?? 1)}</span>
            <button class="btn sm" data-rv="trim">Crear recorte</button>
          </div>
          <div class="rv-edit-row">
            <span class="rv-elb">${icon('layers')} Reencuadrar</span>
            ${['9:16', '1:1', '4:5', '16:9'].map(a => `<button class="chip" data-reframe="${a}">${a}</button>`).join('')}
            <span class="rm-hint">crea una copia en ese formato</span>
          </div>
          <div class="rv-edit-row">
            <span class="rv-elb">${icon('iso')} Portada</span>
            <button class="btn sm" data-rv="poster">Usar el fotograma actual</button>
            <span class="rm-hint">toma el segundo donde tengas pausado el video</span>
            <span class="u-f1 spacer"></span>
            <button class="btn sm" data-rv="dup">${icon('copy')} Duplicar</button>
          </div>
        </div>
        <div class="rv-actions">
          <div class="rv-grp">
            <button class="btn primary" data-rv="share">${icon('ext')} Compartir</button>
            <button class="btn" data-rv="dl">${icon('dl')} ${window.showSaveFilePicker ? 'Guardar como' : 'Descargar'}</button>
          </div>
          <div class="rv-grp">
            <button class="btn${edit ? ' on' : ''}" data-rv="edit" aria-pressed="${edit}">${icon('scissors')} Editar</button>
            ${it.has_recipe ? `<button class="btn" data-rv="studio" data-tip="Reabre este reel en el editor con sus tomas, textos y música">${icon('film')} Estudio</button>` : ''}
            <button class="btn" data-rv="txts" data-tip="Añade textos sobre este reel sin re-montarlo">${icon('tag')} Textos</button>
            <button class="btn icon" data-rv="more" data-tip="Más acciones" aria-label="Más acciones" aria-haspopup="menu">${icon('more')}<span class="rv-lb">Más</span></button>
          </div>
          <span class="spacer"></span>
          <button class="btn danger rv-del" data-rv="del">${icon('trash')} Borrar</button>
        </div>
        <div class="rv-kbd"><span><kbd>←</kbd><kbd>→</kbd> cambiar reel</span><span><kbd>Espacio</kbd> pausa</span><span><kbd>Esc</kbd> cerrar</span></div>
      </div>`;
    // cebar el compartir en cuanto se abre: el gesto del click no se pierde
    primeShare(url, it.name, 'video/mp4').catch(() => {});
  };
  render();

  const go = d => {
    ov.querySelector('video')?.pause();
    idx = (idx + d + list.length) % list.length;
    armedDelete = false;
    render();
  };
  // openModal: role=dialog, foco atrapado, Esc por la pila de capas (solo cierra la capa de arriba)
  const close = openModal(ov, { label: 'Visor de reel', closeOnBackdrop: false, initialFocus: '[data-rv="share"]',
    onClose: () => { ov.querySelector('video')?.pause(); removeEventListener('keydown', onKey); } });
  const onKey = ev => {
    if (_modalStack[_modalStack.length - 1] !== ov) return;   // un modal (p. ej. Textos) o menú manda sobre el visor
    if (ev.target.tagName === 'INPUT' || document.querySelector('.pop')) return;
    if (ev.key === 'ArrowRight' && list.length > 1) go(1);
    else if (ev.key === 'ArrowLeft' && list.length > 1) go(-1);
    else if (ev.key === ' ') {
      ev.preventDefault();
      const v = ov.querySelector('video');
      if (v) v.paused ? v.play().catch(() => {}) : v.pause();
    }
  };
  addEventListener('keydown', onKey);

  // móvil: sin flechas — deslizar horizontalmente sobre el video cambia de reel
  let swipe = null;
  ov.addEventListener('touchstart', ev => {
    const st = ev.target.closest('.rv-stage');
    if (!st || list.length < 2 || ev.touches.length !== 1) { swipe = null; return; }
    const r = st.getBoundingClientRect(), t = ev.touches[0];
    // la franja inferior del <video> es la barra de controles: ahí el gesto es de seek
    swipe = t.clientY < r.bottom - 64 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  ov.addEventListener('touchend', ev => {
    if (!swipe) return;
    const t = ev.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  ov.addEventListener('input', ev => {
    if (ev.target.id !== 'rv-a' && ev.target.id !== 'rv-b') return;
    const A = +ov.querySelector('#rv-a').value, B = +ov.querySelector('#rv-b').value;
    trim = { a: Math.min(A, B - 0.3), b: Math.max(B, A + 0.3) };
    ov.querySelector('#rv-trimlb').textContent = `${fmt.dur(trim.a)} – ${fmt.dur(trim.b)}`;
    const v = ov.querySelector('video');
    if (v) v.currentTime = ev.target.id === 'rv-a' ? trim.a : trim.b;   // scrub en vivo
  });
  ov.addEventListener('click', async ev => {
    const rf = ev.target.closest('[data-reframe]');
    if (rf) {
      const it0 = list[idx];
      rf.disabled = true;
      const r = await api('/api/reel_edit', { op: 'reframe', name: it0.name, aspect: rf.dataset.reframe });
      rf.disabled = false;
      if (r?.error) { toast(r.error); return; }
      await loadMedia();
      const fresh = (media?.reels || []).find(x => x.name === r.name);
      toast(`Copia en ${rf.dataset.reframe} lista`);
      if (fresh) { list.splice(idx + 1, 0, fresh); idx += 1; edit = false; render(); }
      return;
    }
    const b = ev.target.closest('[data-rv]');
    if (!b) { if (ev.target === ov || ev.target.classList.contains('rv-bg')) close(); return; }
    const a = b.dataset.rv, it = list[idx];
    const url = `/data/reels/${encodeURIComponent(it.name)}`;
    if (a === 'more') {
      // openMenu() canónico; la acción elegida vuelve a este mismo handler vía un proxy [data-rv]
      const fire = act => { const t = document.createElement('button'); t.dataset.rv = act; t.hidden = true; ov.appendChild(t); t.click(); t.remove(); };
      openMenu(b, [{ id: 'copy', label: 'Copiar link', icon: 'link' }, { id: 'ren', label: 'Renombrar', icon: 'tag' }],
        { label: 'Más acciones del reel', onSelect: fire });
      return;
    }
    if (a === 'close') return close();
    if (a === 'prev') return go(-1);
    if (a === 'next') return go(1);
    if (a === 'edit') { edit = !edit; trim = { a: 0, b: it.duration_s || null }; render(); return; }
    if (a === 'studio') {
      // T2 · reabrir la receta en el editor (timeline + textos + música vivos)
      b.disabled = true;
      let r = null;
      try { r = await (await authFetch(`/api/reel_recipe?name=${encodeURIComponent(it.name)}`)).json(); }
      catch { /* cae al toast de abajo */ }
      b.disabled = false;
      if (!r?.recipe) { toast(r?.error || 'Este reel no tiene receta guardada'); return; }
      const ok = await window.__abLoadRecipe?.(r.recipe, it.name);
      if (ok) {
        close();
        document.querySelector('#st-tabs [data-tab="editor"]')?.click();
      }
      return;
    }
    if (a === 'txts') { openBurnTexts(it, () => { close(); }); return; }
    if (a === 'trim' || a === 'poster' || a === 'dup') {
      const label = b.textContent;
      b.disabled = true; b.textContent = 'Procesando…';
      const body = a === 'trim' ? { op: 'trim', name: it.name, a: trim.a, b: trim.b }
        : a === 'poster' ? { op: 'poster', name: it.name, t: ov.querySelector('video')?.currentTime || 0.5 }
          : { op: 'duplicate', name: it.name };
      const r = await api('/api/reel_edit', body);
      b.disabled = false; b.textContent = label;
      if (r?.error) { toast(r.error); return; }
      await loadMedia();
      if (a === 'poster') { toast('Portada actualizada'); render(); return; }
      const fresh = (media?.reels || []).find(x => x.name === r.name);
      toast(a === 'trim' ? `Recorte creado: ${r.name}` : `Copia creada: ${r.name}`);
      if (fresh) { list.splice(idx + 1, 0, fresh); idx += 1; edit = false; render(); }
      return;
    }
    if (a === 'share') {
      const ready = shareCache.get(url)?._file;
      if (ready && navigator.canShare?.({ files: [ready] })) {
        try { await navigator.share({ files: [ready] }); }
        catch (err) { if (err?.name !== 'AbortError') toast('No se pudo compartir — usa Descargar'); }
        return;
      }
      try {
        const f = await primeShare(url, it.name, 'video/mp4');
        if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f] }); return; }
      } catch (err) { if (err?.name === 'AbortError') return; }
      toast('Toca Compartir otra vez — el video ya está listo');
      return;
    }
    if (a === 'dl') {
      if (window.showSaveFilePicker) {
        try {
          const h = await showSaveFilePicker({ suggestedName: it.name });
          await (await fetch(url)).body.pipeTo(await h.createWritable());
          toast('Guardado en tu disco'); return;
        } catch (err) { if (err?.name === 'AbortError') return; }
      }
      const el = document.createElement('a'); el.href = url; el.download = it.name; el.click();
      return;
    }
    if (a === 'copy') {
      const full = location.origin + url;
      try { await navigator.clipboard.writeText(full); toast('Link copiado'); }
      catch { prompt('Copia el link:', full); }
      return;
    }
    if (a === 'ren') {
      const host = ov.querySelector('#rv-name');
      const old = it.name.replace(/\.[^.]+$/, '');
      host.innerHTML = `<input class="m-ipt rv-ipt" value="${esc(old)}" maxlength="60">`;
      const inp = host.querySelector('input');
      inp.focus(); inp.select();
      // Esc dentro del campo cancela el renombrado (capa propia: no cierra el visor)
      const lay = pushLayer({ onKey: k => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); popLayer(lay); render(); } } });
      const save = async () => {
        popLayer(lay);
        const nn = inp.value.trim();
        if (!nn || nn === old) return render();
        const r = await api('/api/media_op', { op: 'rename', type: 'reel', name: it.name, new_name: nn });
        if (r?.error) { toast(r.error); return render(); }
        it.name = r.name || it.name;
        await loadMedia();
        render();
      };
      inp.addEventListener('keydown', k => { if (k.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', save);
      return;
    }
    if (a === 'del') {
      if (!armedDelete) {          // confirmación en dos pasos, sin confirm() nativo
        armedDelete = true;
        b.innerHTML = `${icon('warn')} ¿Seguro? Toca otra vez`;
        b.classList.add('armed');
        return;
      }
      const r = await api('/api/media_op', { op: 'delete', type: 'reel', name: it.name });
      if (r?.error) { toast(r.error); return; }
      toast('Reel movido a la papelera');
      list.splice(idx, 1);
      await loadMedia();
      if (!list.length) return close();
      idx = Math.min(idx, list.length - 1);
      armedDelete = false;
      render();
    }
  });
}

// ---- motor de medios: biblioteca de reels y fotos ----
let media = null;   // {reels:[{name,bytes,mtime}], photos:[...]}
let orderMode = false;   // T4 · modo reordenar la librería de reels (flechas en las tarjetas)
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

// ================= TEXTOS SOBRE UN REEL YA EXPORTADO (T3) =================
// Para reels sin receta (los viejos) o retoques rápidos: compone bloques de texto y los
// quema server-side sobre el MP4 existente (op=texts) — sin re-montar el proyecto.
function openBurnTexts(it, onDone) {
  const dur = +it.duration_s || 10;
  const items = [{ text: '', start: +(dur * 0.06).toFixed(1), end: +Math.min(dur, dur * 0.06 + 3.2).toFixed(1),
                   style: { pos: 'bottom', size: 46, color: 'ffffff', box: true, style: 'clean', font: 'din' } }];
  const ov = document.createElement('div');
  ov.className = 'modal-ov modal-ov-top';   // por encima del visor (.rv-ov z 350)
  const STYLES = [['clean', 'Limpio'], ['bold', 'Bold · MAYÚS'], ['kinetic', 'Kinético · cine'],
                  ['lower', 'Lower third'], ['minimal', 'Minimal']];
  const FONTS = [['din', 'DIN · cine'], ['sansbold', 'Arial Bold'], ['black', 'Arial Black'],
                 ['sans', 'Helvetica'], ['condensed', 'Avenir Cond.'], ['avenir', 'Avenir'],
                 ['optima', 'Optima'], ['serif', 'Georgia'], ['mono', 'Menlo']];
  ov.innerHTML = '<div class="m-w560 modal"></div>';   // contenedor estable: openModal le pone el rol
  const mdl = ov.firstElementChild;
  const render = () => {
    mdl.innerHTML = `
      <div class="modal-h"><b>${icon('tag')} Textos sobre «${esc(it.name.replace(/\.[^.]+$/, ''))}»</b>
        <button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        ${items.map((t, i) => `<div class="bt-item" data-bt="${i}">
          <div class="tx-row">
            <input class="u-f1 m-ipt" data-f="text" maxlength="120"
                   placeholder="Texto ${i + 1}…" value="${esc(t.text)}">
            ${items.length > 1 ? `<button class="btn icon sm ghost" data-btx="${i}" aria-label="Quitar texto" data-tip="Quitar texto">${icon('close')}</button>` : ''}
          </div>
          <div class="tx-row bt-time"><span>Aparece</span>
            <input type="number" class="u-w76 ctl" data-f="start" min="0" max="${dur}" step="0.1" value="${t.start}" aria-label="Inicio (s)">
            <span class="u-wauto">a</span>
            <input type="number" class="u-w76 ctl" data-f="end" min="0.3" max="${dur}" step="0.1" value="${t.end}" aria-label="Fin (s)">
            <span class="u-wauto">s</span></div>
          <div class="tx-row">
            <select class="u-f1 ctl" data-f="pos" aria-label="Posición">
              <option value="top"${t.style.pos === 'top' ? ' selected' : ''}>Arriba</option>
              <option value="mid"${t.style.pos === 'mid' ? ' selected' : ''}>Centro</option>
              <option value="bottom"${t.style.pos === 'bottom' ? ' selected' : ''}>Abajo</option>
            </select>
            <select class="u-f1 ctl" data-f="style" aria-label="Estilo">
              ${STYLES.map(([k, l]) => `<option value="${k}"${t.style.style === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <select class="u-f1 ctl" data-f="font" aria-label="Fuente">
              ${FONTS.map(([k, l]) => `<option value="${k}"${t.style.font === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="tx-row"><span>Tamaño</span>
            <input type="range" data-f="size" min="10" max="100" value="${t.style.size}" class="u-f1" aria-label="Tamaño">
            <label class="u-chk">
              <input type="checkbox" data-f="box"${t.style.box ? ' checked' : ''}> Fondo</label>
          </div>
        </div>`).join('')}
        <button class="u-w100 btn" id="bt-add">+ Otro texto</button>
      </div>
      <div class="rm-foot">
        <label class="ex-check" data-tip="Sin copia: el reel original queda con los textos">
          <input type="checkbox" id="bt-replace"> Reemplazar original</label>
        <span class="u-f1 spacer"></span>
        <button class="btn primary" id="bt-burn">${icon('check')} Quemar textos</button>
      </div>`;
  };
  render();
  const collect = () => {
    ov.querySelectorAll('.bt-item').forEach(el => {
      const t = items[+el.dataset.bt];
      const F = f => el.querySelector(`[data-f="${f}"]`);
      t.text = F('text').value;
      t.start = Math.max(0, Math.min(+F('start').value || 0, dur - 0.3));
      t.end = Math.max(t.start + 0.3, Math.min(+F('end').value || t.start + 3, dur));
      t.style = { ...t.style, pos: F('pos').value, style: F('style').value,
                  font: F('font').value, size: +F('size').value, box: F('box').checked };
    });
  };
  const closeOv = openModal(ov, { initialFocus: '[data-f="text"]' });
  ov.addEventListener('click', async e => {
    const del = e.target.closest('[data-btx]');
    if (del) { collect(); items.splice(+del.dataset.btx, 1); render(); return; }
    if (e.target.closest('#bt-add')) {
      collect();
      const last = items[items.length - 1];
      items.push({ text: '', start: +Math.min(dur - 3.5, last.end + 0.5).toFixed(1),
                   end: +Math.min(dur, last.end + 3.7).toFixed(1), style: { ...last.style } });
      render(); return;
    }
    const burn = e.target.closest('#bt-burn');
    if (burn) {
      collect();
      const valid = items.filter(t => t.text.trim());
      if (!valid.length) { toast('Escribe al menos un texto'); return; }
      burn.disabled = true;
      burn.textContent = 'Quemando… (según la duración, hasta 1 min)';
      const r = await api('/api/reel_edit', {
        op: 'texts', name: it.name, replace: ov.querySelector('#bt-replace').checked,
        texts: valid.map(t => ({ text: t.text, start: t.start, end: t.end, style: t.style })),
      }).catch(() => ({ error: 'falló la conexión (el reel puede seguir procesándose)' }));
      if (r?.error) { burn.disabled = false; burn.textContent = 'Quemar textos'; toast(r.error); return; }
      await loadMedia();
      toast(`Textos quemados: ${r.name}`);
      closeOv();
      onDone?.(r.name);
    }
  });
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
  const fresh = await r.json();
  if (orderMode && media) {
    // ordenando: no pisar el orden sin guardar — conserva el local, quita borrados y pone lo nuevo al frente
    const srv = new Map((fresh.reels || []).map(x => [x.name, x]));
    const have = new Set((media.reels || []).map(x => x.name));
    fresh.reels = [...(fresh.reels || []).filter(x => !have.has(x.name)),
                   ...(media.reels || []).filter(x => srv.has(x.name)).map(x => srv.get(x.name))];
  }
  media = fresh;
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

// .m-prevbox es role=button: Enter / Espacio equivalen al clic (teclado)
document.addEventListener('keydown', e => {
  const pb = e.target?.classList?.contains('m-prevbox') ? e.target : null;
  if (pb && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pb.click(); }
});

function viewOf(kind) {
  const list = (kind === 'dron' ? (dronePhotos || [])
    : (kind === 'reels' ? media.reels : media.photos) || []).slice();
  const st = mstate[kind], q = st.q.trim().toLowerCase();
  const out = q ? list.filter(x => x.name.toLowerCase().includes(q)) : list;
  if (st.sort === 'tamano') out.sort((a, b) => b.bytes - a.bytes);
  else if (st.sort === 'nombre') out.sort((a, b) => a.name.localeCompare(b.name));
  // reels en "Recientes": respetar el orden del SERVER (nuevos primero + orden manual
  // de .order.json). Re-ordenar por mtime aquí pisaba el "Ordenar" del usuario.
  else if (kind !== 'reels') out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// I8 · badge de formato: dice para qué red sirve el reel, no solo sus píxeles
function fmtBadgeOf(it) {
  const ar = it.w && it.h ? it.w / it.h : 0;
  if (!ar) return '';
  return ar < 0.65 ? '<span class="chip sm on" data-tip="Vertical: Reels, TikTok, Shorts">9:16</span>'
    : ar < 0.9 ? '<span class="chip sm" data-tip="Feed vertical">4:5</span>'
      : ar < 1.1 ? '<span class="chip sm" data-tip="Cuadrado">1:1</span>'
        : '<span class="chip sm" data-tip="Horizontal: YouTube, web">16:9</span>';
}
// menú "⋯" de las tarjetas: qué acciones van detrás del overflow según el tipo
const CARD_MENU = {
  reels: [['dl', 'dl', 'Descargar'], ['dup', 'copy', 'Duplicar'], ['ren', 'tag', 'Renombrar'], ['del', 'trash', 'Eliminar', 'danger']],
  fotos: [['share', 'ext', 'Compartir'], ['dl', 'dl', 'Descargar'], ['dup', 'copy', 'Duplicar'], ['ren', 'tag', 'Renombrar'], ['del', 'trash', 'Eliminar', 'danger']],
};

function cardHTML(kind, it) {
  const enc = encodeURIComponent(it.name);
  const base = it.name.replace(/\.[^.]+$/, '');
  if (kind === 'dron') {
    const rel = encodeURIComponent(it.rel);
    return `<div class="m-card" data-name="${esc(it.name)}" data-rel="${esc(it.rel)}" data-kind="${esc(it.kind)}">
      <div class="m-prevbox" role="button" tabindex="0" aria-label="Abrir ${esc(base)} en el editor">
        <img loading="lazy" src="/api/photo_thumb?rel=${rel}&w=512" alt="" class="u-ptr">
        <span class="m-fmt ${it.kind === 'DNG' ? 'dng' : ''}">${esc(it.kind)}</span>
      </div>
      <div class="m-head"><div class="m-name" title="${esc(base)}">${esc(base)}</div></div>
      <div class="m-meta mono">${fmt.gb(it.bytes)} · ${it.date ? esc(it.date) : mdate(it.mtime)}</div>
      <div class="m-actions">
        <button class="btn sm primary" data-act="edit" aria-label="Abrir en el editor">${icon('iso')} Editar</button>
        <button class="btn sm icon" data-act="dl" data-tip="Descargar original ${esc(it.kind)}" aria-label="Descargar original ${esc(it.kind)}">${icon('dl')}</button>
      </div>
    </div>`;
  }
  const prev = kind === 'reels'
    // preload="none" + póster server-side: el tile pinta con ~20KB en vez de bajar el MP4.
    // El <video> solo carga cuando el hover/tap lo pide (ver onMediaHover).
    ? `<video src="/data/reels/${enc}#t=0.5" preload="none" muted playsinline loop
              poster="/data/reel-posters/${encodeURIComponent(it.name.replace(/\.[^.]+$/, ''))}.jpg"></video>
       <span class="gchip m-dur" style="display:none"></span>`
    : `<img loading="lazy" src="/data/photos/${enc}" alt="" class="u-ptr">`;
  const fmtBadge = kind === 'reels' ? fmtBadgeOf(it) : '';
  return `<div class="m-card${kind === 'reels' ? ' m-reel' : ''}" data-name="${esc(it.name)}">
    <div class="m-prevbox" role="button" tabindex="0" aria-label="${kind === 'reels' ? 'Reproducir' : 'Abrir'} ${esc(base)}">${prev}
      ${kind === 'reels' && it.duration_s ? `<span class="m-time mono">${fmt.dur(it.duration_s)}</span>` : ''}
      ${kind === 'reels' && it.has_audio === false ? `<span class="m-mute" data-tip="Sin audio" role="img" aria-label="Sin audio">${icon('volumeOff')}</span>` : ''}
      ${kind === 'reels' && orderMode ? `<div class="m-ordbtns">
        <button data-ord="-1" aria-label="Mover antes">${icon('chevL')}</button>
        <button data-ord="1" aria-label="Mover después">${icon('chevR')}</button>
      </div>` : ''}
    </div>
    <div class="m-head">
      <div class="m-name" title="${esc(base)}">${esc(base)}</div>
      ${fmtBadge}
    </div>
    <div class="m-meta mono">${fmt.gb(it.bytes)} · ${mdate(it.mtime)}${it.h ? ` · ${it.h}p` : ''}</div>
    <div class="m-actions">
      ${kind === 'reels'
        ? `<button class="btn sm primary" data-act="share" aria-label="Compartir">${icon('ext')} ${IS_IOS ? 'Guardar o compartir' : 'Compartir'}</button>`
        : `<button class="btn sm primary" data-act="edit" aria-label="Abrir en el editor">${icon('iso')} Editar</button>`}
      <button class="btn sm icon" data-act="more" data-tip="Más acciones" aria-label="Más acciones" aria-haspopup="menu">${icon('more')}</button>
    </div>
  </div>`;
}

// ---- menú "⋯" de las tarjetas: openMenu() canónico (shell.js) ----
function openCardMenu(kind, card, anchor) {
  const name = card.dataset.name;
  if (kind === 'fotos') primeShare(`/data/photos/${encodeURIComponent(name)}`, name, 'image/jpeg').catch(() => {});
  openMenu(anchor, (CARD_MENU[kind] || []).map(([act, ic, label, tone]) =>
    ({ id: act, icon: ic, label, danger: tone === 'danger' })),
    { label: 'Acciones', onSelect: act => runCardAct(kind, name, act) });
}

function renderGrid(kind) {
  const grid = document.getElementById(`grid-${kind}`);
  // libera los decoders de los <video> previos antes de reemplazar el grid (si no, quedan
  // huérfanos decodificando hasta el GC)
  grid.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} });
  const items = viewOf(kind);
  grid.innerHTML = items.map(it => cardHTML(kind, it)).join('') ||
    emptyState(kind === 'reels' ? { icon: 'play', title: 'Aún no hay reels', help: 'Exporta uno desde el Editor.', cls: 'u-span-all' } : { icon: 'iso', title: 'Aún no hay fotos', help: 'Captura fotos desde un video del editor.', cls: 'u-span-all' });
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
  if (kind === 'reels' && orderMode) {
    const ordBtn = e.target.closest('[data-ord]');
    if (ordBtn) {
      const list = media?.reels || [];
      const i = list.findIndex(x => x.name === name);
      const j = i + (+ordBtn.dataset.ord);
      if (i >= 0 && j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j], list[i]];
        renderGrid('reels');
      }
    }
    return;   // en modo ordenar no se abre el visor ni corren otras acciones
  }
  const btn = e.target.closest('[data-act]');
  if (btn?.dataset.act === 'more') { openCardMenu(kind, card, btn); return; }
  if (!btn) {
    // fotos: tap en la imagen abre el editor premium (photoeditor.js)
    if (kind === 'fotos' && e.target.closest('.m-prevbox')) openPhotoEditor({ url: `/data/photos/${encodeURIComponent(name)}`, name });
    // reels: tap en la tarjeta abre el VISOR dedicado (R2)
    if (kind === 'reels' && e.target.closest('.m-prevbox')) openReelViewer(name);
    return;
  }
  return runCardAct(kind, name, btn.dataset.act);
}

async function runCardAct(kind, name, act) {
  const type = kind === 'reels' ? 'reel' : 'photo';
  const url = `/data/${kind === 'reels' ? 'reels' : 'photos'}/${encodeURIComponent(name)}`;
  if (act === 'edit') { openPhotoEditor({ url, name }); return; }

  if (act === 'dl') {
    // desktop moderno: diálogo "Guardar como" real con streaming a disco (sin blob en RAM)
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: name });
        const res = await fetch(url);
        await res.body.pipeTo(await h.createWritable());
        toast('Guardado en tu disco');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;    // el usuario canceló: no es error
        /* sin permisos / no soportado → cae a la descarga clásica */
      }
    }
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    return;
  }
  if (act === 'share') {
    // El fetch ANTES de share() consumía la activación del usuario: en iPhone eso lanza
    // NotAllowedError con archivos grandes y el catch mudo lo escondía. Ahora el archivo
    // se va cebando desde el pointerdown y share() es la PRIMERA sentencia si ya está listo.
    const primed = shareCache.get(url);
    const ready = primed?._file;
    if (ready && navigator.canShare?.({ files: [ready] })) {
      try { await navigator.share({ files: [ready] }); }
      catch (err) {
        if (err?.name !== 'AbortError') toast('No se pudo abrir el menú de compartir — usa Descargar');
      }
      return;
    }
    let file = null;
    try { file = await primeShare(url, name, kind === 'reels' ? 'video/mp4' : 'image/jpeg'); }
    catch {}
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (err) {
        if (err?.name === 'AbortError') return;
        // iOS invalidó el gesto mientras se preparaba: el archivo YA está en caché,
        // así que un segundo toque sí abre la hoja de compartir.
        toast('Toca Compartir otra vez — el video ya está listo');
        return;
      }
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

// T4 · Ordenar: primer tap entra al modo (flechas en cada tarjeta), segundo tap
// guarda el orden completo en el server (.order.json) y sale. Flechas > drag: cero
// conflicto con el scroll táctil del iPhone.
document.getElementById('btn-ord')?.addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!orderMode) {
    orderMode = true;
    mstate.reels.q = ''; mstate.reels.sort = 'recientes';
    const qr = document.getElementById('q-reels'), sr = document.getElementById('s-reels');
    qr.value = ''; sr.value = 'recientes';
    qr.disabled = sr.disabled = true;   // filtrar/ordenar mientras se reordena mostraría un subconjunto
    b.innerHTML = `${icon('check')} Guardar orden`;
    b.setAttribute('aria-pressed', 'true');
    b.classList.add('primary');
    renderGrid('reels');
    toast('Mueve los reels con las flechas y toca Guardar');
    return;
  }
  b.disabled = true;
  let r = null;
  try { r = await api('/api/reel_order', { names: (media?.reels || []).map(x => x.name) }); }
  catch (err) { r = { error: String(err?.message || err || 'falló la conexión') }; }
  finally {
    b.disabled = false;
    orderMode = false;
    b.innerHTML = `${icon('swap')} Reordenar`; b.setAttribute('aria-pressed', 'false');
    b.classList.remove('primary');
    document.getElementById('q-reels').disabled = false;
    document.getElementById('s-reels').disabled = false;
  }
  if (r?.error) { toast(r.error); loadMedia(); return; }
  toast(`Orden guardado (${r.count} reels)`);
  renderGrid('reels');
});

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
  const g = document.getElementById(`grid-${kind}`);
  g.addEventListener('click', e => onCardClick(kind, e));
  // ceba la descarga en cuanto el dedo toca Compartir (ver primeShare)
  g.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-act="share"]');
    const card = e.target.closest('.m-card');
    if (!b || !card) return;
    const n = card.dataset.name;
    primeShare(`/data/${kind === 'reels' ? 'reels' : 'photos'}/${encodeURIComponent(n)}`,
               n, kind === 'reels' ? 'video/mp4' : 'image/jpeg').catch(() => {});
  }, { passive: true });
}
loadMedia();

// ---- módulo Trabajos ----
const JOBS_CAP = 6;      // los más recientes; el resto tras "Ver más"
let jobsAll = false;
const jobsEl = document.getElementById('jobs');
function capJobs() {
  const cards = [...jobsEl.children].filter(c => c.dataset?.jid);
  cards.forEach((c, i) => { c.hidden = !jobsAll && i >= JOBS_CAP; });
  const hidden = Math.max(0, cards.length - JOBS_CAP);
  const more = document.getElementById('jobs-more');
  const cnt = document.getElementById('jobs-count');
  cnt.hidden = !cards.length;
  cnt.textContent = `${cards.length} en total`;
  more.hidden = !hidden;
  document.getElementById('jobs-more-btn').textContent = jobsAll ? 'Ver menos' : `Ver ${hidden} más`;
}
jobsEl.addEventListener('jobs:paint', capJobs);
document.getElementById('jobs-more-btn').addEventListener('click', () => { jobsAll = !jobsAll; capJobs(); });
pollJobs(jobsEl, 2500, j => {
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
  // Aproximación CSS de cada look para el PREVIEW. Sin esto, elegir "Nolan" mostraba el
  // material crudo y el look solo aparecía al exportar — editabas a ciegas.
  // Los valores replican la firma medida de cada cadena ffmpeg (saturación/contraste).
  const CSS_LUTS = {
    none: '',
    // saturate() calibrado contra la salida REAL de ffmpeg, no contra el valor nominal
    // del grading: las curvas por canal separan más los colores de lo que sugiere el
    // eq=saturation, así que un "0.82 desaturado" mide como 14.6 y el CSS debe igualarlo.
    nolan: 'contrast(1.06) saturate(0.74) brightness(0.98) sepia(0.06) hue-rotate(-4deg)',
    deakins: 'contrast(1.14) saturate(1.00) brightness(0.96) sepia(0.10) hue-rotate(-6deg)',
    malick: 'contrast(0.98) saturate(1.20) brightness(1.00) sepia(0.08) hue-rotate(-5deg)',
    fincher: 'contrast(1.18) saturate(1.10) brightness(0.94) hue-rotate(6deg)',
    kodak: 'contrast(1.04) saturate(1.16) sepia(0.06)',
    goldenhour: 'contrast(1.08) saturate(1.40) sepia(0.12) hue-rotate(-8deg) brightness(0.88)',
    tealorange: 'contrast(1.12) saturate(1.35) sepia(0.06) hue-rotate(-3deg)',
    cine: 'contrast(1.07) saturate(1.1) hue-rotate(-6deg)',
    vivid: 'saturate(1.35) contrast(1.1)',
    warm: 'sepia(0.18) saturate(1.2)',
    moody: 'contrast(1.16) brightness(0.94) saturate(0.82)',
    bw: 'grayscale(1) contrast(1.22) brightness(0.96)',
  };
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

  // v7 · defaults de color/título (neutro) — un {} vacío en export = sin grade
  const GRADE_NEUTRAL = { bright: 100, contrast: 100, sat: 100, temp: 0 };
  const isNeutralGrade = g => !g || (g.bright === 100 && g.contrast === 100 && g.sat === 100 && g.temp === 0);
  const TITLE_DEFAULT = { pos: 'bottom', size: 40, color: 'ffffff', box: false, style: 'clean', font: 'sans' };

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
  // ---- E3 · continuidad visual al cambiar de clip fuente ----
  // Cambiar video.src deja el elemento en NEGRO hasta que hay fotograma: eso es el
  // parpadeo entre cortes. Pintamos el último fotograma en un canvas encima y lo
  // soltamos cuando el clip nuevo ya está colocado — el ojo no ve el hueco.
  const hold = document.getElementById('tl-hold');
  let holdT = null;
  function holdFrame() {
    if (!hold || !video.videoWidth) return;
    try {
      hold.width = video.videoWidth;
      hold.height = video.videoHeight;
      hold.getContext('2d').drawImage(video, 0, 0);
      hold.style.filter = getComputedStyle(video).filter;   // conserva el look aplicado
      hold.classList.add('on');
      clearTimeout(holdT);
      holdT = setTimeout(releaseFrame, 1600);               // nunca dejarlo pegado
    } catch { /* canvas sucio o clip sin datos: seguimos sin congelar */ }
  }
  function releaseFrame() {
    clearTimeout(holdT);
    hold?.classList.remove('on');
  }
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
  // el snapshot incluye textos y música: deshacer un montaje/receta no debe dejar textos huérfanos
  const snap = () => ({ tl: JSON.parse(JSON.stringify(tl)), texts: JSON.parse(JSON.stringify(texts)),
                        music: music ? { ...music } : null });
  function applySnap(o) {
    tl = o.tl; texts = o.texts; textSel = -1;
    const changed = (music?.name || null) !== (o.music?.name || null);
    music = o.music;
    if (changed) syncMusicEl();
    musicChip();
  }
  function pushUndo() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); applySnap(undoStack.pop()); clampSel(); renderAll(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); applySnap(redoStack.pop()); clampSel(); renderAll(); }
  function syncMusicEl() {
    try {
      if (music) musicEl.src = `${DATA}/audio/${encodeURIComponent(music.name)}`;
      else { musicEl.pause(); musicEl.removeAttribute('src'); }
    } catch {}
  }
  // un proyecto NUEVO (vaciar, cargar, Momentos AI, montaje) no hereda el reel reabierto ni sus textos/música
  function resetProjectState({ keepMusic = false } = {}) {
    replaceTarget = null;
    const row = document.getElementById('ed-replace-row');
    if (row) row.style.display = 'none';
    texts = []; textSel = -1;
    if (!keepMusic) { music = null; syncMusicEl(); musicChip(); }
  }
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
    renderTextLane();
    renderInspector();
    updateStat();
    syncTools();
    exportbar.style.display = tl.length ? 'flex' : 'none';
    if (typeof autosave === 'function') autosave();   // cada cambio queda a salvo de un F5
    emptyEl.hidden = tl.length > 0;
    layoutMask();
    playhead = Math.min(playhead, total());
    phEl.style.display = tl.length ? '' : 'none';
    scroll.classList.toggle('is-empty', !tl.length);
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
    // I3 · pulso de la música sobre la regla (solo si el zoom lo hace legible)
    if (music?.beats?.length && pps >= 14) {
      const off = music.startAt || 0;
      music.beats.forEach(b => {
        const t = b - off;
        if (t >= 0 && t <= T) html += `<span class="tl-beat" style="left:${Math.round(t * pps)}px"></span>`;
      });
    }
    ruler.innerHTML = html;
  }

  // 1,2,10,11 · track con clips end-to-end + tira de miniaturas + manijas
  // catálogo de transiciones = exactamente lo que el export ffmpeg (XFADE_MAP) renderiza
  const TX_LABELS = {
    none: 'Corte', fade: 'Fundido', dissolve: 'Disolver', fadeblack: 'A negro',
    fadewhite: 'A blanco', wipeleft: 'Cortina izq.', wiperight: 'Cortina der.',
    slideup: 'Deslizar arriba', slidedown: 'Deslizar abajo', circleopen: 'Círculo abre',
    circleclose: 'Círculo cierra', radial: 'Radial', smoothleft: 'Suave izq.', pixelize: 'Pixel',
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
             data-tip="${txSet ? esc((TX_LABELS[s.transition] || s.transition) + ' · ' + (s.transDur || 0.4) + 's — click para cambiar') : 'Corte seco — click para elegir transición'}" aria-label="Transición entre tomas">${txSet ? icon('layers') : icon('plus')}</button>` : '';
      const lb = esc(f?.label) || fmt.date(f?.date || 0);
      return `${trans}<div class="tl-clip${i === sel ? ' sel' : ''}" data-i="${i}" data-cid="${s.clip_id}"
                style="width:${w}px" draggable="false">
          <div class="tl-thumbs">${thumbs}</div>
          <span class="tl-clip-lb">${lb} · ${(s.b - s.a).toFixed(1)}s</span>
          <span class="tl-badges">${badges}</span>
          <button class="tl-x" data-x="${i}" data-tip="Quitar del timeline" aria-label="Quitar del timeline">${icon('close')}</button>
          <button class="tl-expand" data-expand="${i}" data-tip="Abrir en grande y elegir el tramo (doble click)" aria-label="Abrir en grande">${icon('fit')}</button>
          <div class="tl-handle l" data-i="${i}"></div>
          <div class="tl-handle r" data-i="${i}"></div>
        </div>`;
    }).join('') + (tl.length
      ? `<button class="tl-add" data-tip="Añadir más clips">${icon('plus')}</button>` : '');
  }

  // 18-23 · inspector del clip seleccionado (v7 · velocidad+color+título+transición)
  function renderInspector() {
    if (sel < 0 || !tl[sel]) { inspect.hidden = true; return; }
    const s = tl[sel];
    // normaliza campos v7 por si el seg viene de un proyecto viejo
    s.grade = s.grade && Object.keys(s.grade).length ? { ...GRADE_NEUTRAL, ...s.grade } : { ...GRADE_NEUTRAL };
    s.titleStyle = { ...TITLE_DEFAULT, ...(s.titleStyle || {}) };
    if (s.transDur == null) s.transDur = 0.4;
    if (s.reverse == null) s.reverse = false;
    if (s.freeze == null) s.freeze = 0;
    const g = (id) => document.getElementById(id);
    inspect.hidden = false;
    g('tli-io').innerHTML = [['In', fmt.dur(s.a)], ['Out', fmt.dur(s.b)], ['Duración', `${segDur(s).toFixed(1)}s`],
      ['Fuente', `${(s.b - s.a).toFixed(1)}s`]].map(([k, v]) => `<div><dt>${k}</dt><dd class="mono">${v}</dd></div>`).join('');
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
    g('tli-title-style').value = s.titleStyle.style || 'clean';
    g('tli-title-font').value = s.titleStyle.font || 'sans';
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
      const b = document.querySelector(`.tb [data-tool="${name}"]`);
      if (b) b.toggleAttribute('disabled', !on);
    };
    set('razor', canRazor);
    const eff = hasSel ? sel : (at ? at.idx : -1);   // sin selección → clip bajo el playhead
    set('dup', eff >= 0); set('del', eff >= 0); set('left', eff > 0); set('right', eff >= 0 && eff < tl.length - 1);
    set('clear', has); set('fit', has);
    set('undo', undoStack.length > 0); set('redo', redoStack.length > 0);
    const muteBtn = document.querySelector('[data-tp="mute"]');
    muteBtn.innerHTML = muted ? icon('volumeOff') : icon('volume');
    muteBtn.classList.toggle('on', !muted);
    muteBtn.setAttribute('aria-pressed', String(!muted));
    const loopBtn = document.querySelector('[data-tp="loop"]');
    loopBtn.classList.toggle('on', loop);
    loopBtn.setAttribute('aria-pressed', String(loop));
  }

  // ---- máscara de aspecto (31) ----
  function applyAspect() {
    const a = document.getElementById('ed-aspect').value;
    mask.dataset.aspect = a;
    layoutMask();
  }
  // Marco de salida: solo se dibuja cuando el aspecto de salida != aspecto de la fuente; entonces es el
  // rectángulo EXACTO (px) del encuadre dentro del video visible (object-fit: contain), contorno 1px, sin relleno.
  let frameF = 0;
  function layoutMask() {
    const v = document.getElementById('tl-video');
    const [aw, ah] = (document.getElementById('ed-aspect')?.value || '16:9').split(':').map(Number);
    const out = aw / ah, sw = stage.clientWidth, sh = stage.clientHeight;
    const src = v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    if (!tl.length || !sw || !sh || Math.abs(out - src) < 0.02) { mask.hidden = true; return; }
    // rect del contenido del video dentro del escenario
    let cw = sw, ch = sw / src;
    if (ch > sh) { ch = sh; cw = sh * src; }
    const cx = (sw - cw) / 2, cy = (sh - ch) / 2;
    let w, h;
    if (out < src) { h = ch; w = ch * out; } else { w = cw; h = cw / out; }
    const crop = (mask.dataset.fit || 'crop') === 'crop';
    const left = cx + (cw - w) / 2 * (1 + (crop ? frameF : 0));
    mask.style.cssText = `left:${left.toFixed(1)}px;top:${(cy + (ch - h) / 2).toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px`;
    mask.hidden = false;
  }
  document.getElementById('tl-video')?.addEventListener('loadedmetadata', layoutMask);
  window.addEventListener('resize', layoutMask);

  // ---- playhead visual (4) ----
  function paintPlayhead() {
    const x = playhead * pps;
    phEl.style.left = x + 'px';
    // autoscroll para mantener el playhead visible
    const vw = scroll.clientWidth;
    if (x < scroll.scrollLeft + 40) scroll.scrollLeft = Math.max(0, x - 40);
    else if (x > scroll.scrollLeft + vw - 40) scroll.scrollLeft = x - vw + 40;
    timeEl.textContent = `${fmt.dur(playhead)} / ${fmt.dur(total())}`;
    paintTextOverlay();     // el texto aparece/desaparece siguiendo al playhead
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
    musicSync(gt, !!andPlay);      // la música sigue al playhead como una pista más
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
      holdFrame();    // congela el último fotograma: sin esto el <video> parpadea en negro
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
        if (!tl.length || curCid !== clip.clip_id) { releaseFrame(); return; }
        if (video.readyState >= 1) { try { video.currentTime = pendingTarget; } catch {} }
        if (pendingPlay && playing) video.play().catch(() => {});   // no reanudar si el usuario pausó
        // suelta el fotograma congelado cuando el nuevo clip YA está posicionado
        if (video.readyState >= 2) requestAnimationFrame(releaseFrame);
        else video.addEventListener('seeked', () => requestAnimationFrame(releaseFrame), { once: true });
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
    let lastW = performance.now();
    const tick = () => {
      if (!playing) return;
      const now = performance.now(), dt = Math.min(0.1, (now - lastW) / 1000);
      lastW = now;
      const at = clipAt(playhead);
      if (at && curCid === at.clip.clip_id) {
        // false = fin del timeline sin bucle (ya pausado)
        const advance = () => {
          if (at.idx < tl.length - 1) seek(offset(at.idx + 1) + 0.001, true);
          else if (loop) seek(0, true);
          else { pause(); playhead = total(); paintPlayhead(); return false; }
          return true;
        };
        if (at.clip.freeze > 0) {
          // freeze: el <video> NO manda el tiempo (seguiría reproduciendo la fuente); se sostiene el
          // fotograma 'a' y el playhead avanza por reloj hasta cumplir la duración del segmento
          if (!video.paused) video.pause();
          if (video.readyState >= 1 && !video.seeking && Math.abs(video.currentTime - at.clip.a) > 0.05) {
            try { video.currentTime = at.clip.a; } catch {}
          }
          playhead += dt;
          if (playhead >= offset(at.idx) + segDur(at.clip) - 0.02) { if (!advance()) return; }
          else paintPlayhead();
        } else {
          // gt = offset del clip actual + progreso local escalado por speed
          const gt = offset(at.idx) + (video.currentTime - at.clip.a) / at.clip.speed;
          playhead = Math.max(playhead, gt);
          // fin del corte actual → salta al siguiente
          if (video.currentTime >= at.clip.b - 0.03) { if (!advance()) return; }
          else paintPlayhead();
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
    try { musicEl.pause(); } catch {}
  }
  function togglePlay() { playing ? pause() : play(); }
  window.__abEditorPause = () => { if (playing) pause(); else { try { musicEl.pause(); } catch {} } };
  function setPlayIcon() {
    const b = document.querySelector('[data-tp="play"]');
    b.innerHTML = (playing ? icon('pause') : icon('play')) + `<span>${playing ? 'Pausa' : 'Play'}</span>`;
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
    // el título se queda en la mitad izquierda (si no, se dibuja dos veces); un freeze reparte su duración
    const frz = clip.freeze > 0;
    const right = { ...cloneSeg(clip), a: frz ? clip.a : +cutSrc.toFixed(2), transition: 'none', title: '',
                    freeze: frz ? +(segDur(clip) - local).toFixed(2) : 0 };
    const left  = frz ? { ...clip, freeze: +local.toFixed(2) } : { ...clip, b: +cutSrc.toFixed(2) };
    tl.splice(idx, 1, left, right);
    sel = idx + 1; renderAll();
  }
  function clearTL() {
    if (!tl.length) return;
    if (!confirm('¿Vaciar el timeline?')) return;
    cancelSeek();   // aborta cualquier ciclo de carga en vuelo antes de vaciar
    pushUndo(); tl = []; resetProjectState(); sel = -1; playhead = 0; curCid = null; renderAll();
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
    resetProjectState({ keepMusic: !replaceTarget });   // la música elegida a mano se conserva salvo que venga de un reel reabierto
    tl = top.map(h => {
      const s = makeSeg(h.cid, Math.max(0, h.t - 2.5), Math.min(h.dur, h.t + 2.5),
        { speed: 1, transition: 'crossfade' });
      s._mark = true;   // 50 · marker en la regla
      return s;
    });
    sel = 0; playhead = 0; curCid = null; renderAll(); seek(0);
  }

  // ================= PISTA DE TEXTO =================
  // Los títulos viven PEGADOS a un corte: si mueves el corte, el título se va con él y no
  // puedes escribir a caballo entre dos planos. Esta pista es independiente: cada bloque
  // ocupa el tramo del reel que tú decidas, y así se quema en el export (enable=between).
  let texts = [];      // [{id, text, start, end, style}]
  let textSel = -1;
  const TEXT_DEF = { pos: 'bottom', size: 46, color: 'ffffff', box: false, style: 'clean', font: 'sans' };

  function addText() {
    if (!tl.length) return toast('Primero añade tomas al timeline');
    const start = Math.min(playhead, Math.max(0, total() - 1));
    pushUndo();
    const t = { id: uid(), text: 'Tu texto', start: +start.toFixed(2),
                end: +Math.min(total(), start + 3).toFixed(2), style: { ...TEXT_DEF } };
    texts.push(t);
    textSel = texts.length - 1;
    renderTextLane();
    openTextEditor(textSel, true);
  }

  function renderTextLane() {
    const lane = document.getElementById('tl-textlane');
    if (!lane) return;
    const T = total();
    lane.style.width = `${Math.max(T * pps, scroll?.clientWidth || 320)}px`;
    lane.innerHTML = texts.map((t, i) => {
      const L = t.start * pps, W = Math.max(24, (t.end - t.start) * pps);
      return `<div class="tl-txt${i === textSel ? ' on' : ''}" data-txt="${i}"
                   style="left:${L}px;width:${W}px" data-tip="${esc(t.text)} · ${fmt.dur(t.start)}–${fmt.dur(t.end)}">
        <span class="tl-txt-h l" data-txth="l"></span>
        <b>${esc(t.text.slice(0, 26))}</b>
        <button class="tl-txt-x" data-txtx="${i}" aria-label="Quitar texto">${icon('close')}</button>
        <span class="tl-txt-h r" data-txth="r"></span>
      </div>`;
    }).join('');
    lane.classList.toggle('is-empty', !texts.length);
    paintTextOverlay();
    // el texto se edita SIN pasar por renderAll, así que hay que guardar aquí también
    if (typeof autosave === 'function') autosave();
  }

  // lo que se ve encima del video mientras editas — misma tipografía y posición que el export
  function paintTextOverlay() {
    let ov = document.getElementById('tl-txtov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'tl-txtov';
      ov.className = 'tl-txtov';
      document.getElementById('tl-stage')?.appendChild(ov);
    }
    const vis = texts.filter(t => playhead >= t.start && playhead <= t.end);
    // se llama en cada frame de reproducción: reconstruir el DOM reiniciaba la animación CSS de entrada
    const key = vis.map(t => `${t.id}|${t.text}|${JSON.stringify(t.style)}`).join('¦');
    if (ov._key === key) return;
    ov._key = key;
    const FONTS = { sans: '"Helvetica Neue",system-ui,sans-serif',
                    sansbold: 'Arial,system-ui,sans-serif', black: '"Arial Black",Arial,sans-serif',
                    din: '"DIN Condensed","Avenir Next Condensed",sans-serif',
                    condensed: '"Avenir Next Condensed",system-ui,sans-serif',
                    avenir: '"Avenir Next",system-ui,sans-serif', optima: 'Optima,Georgia,serif',
                    serif: 'Georgia,serif', mono: 'Menlo,monospace' };
    // PARIDAD con el motor px del server: wrap real (max-width), anclaje al borde
    // inferior en 'bottom' (el bloque crece hacia arriba), tracking en kinetic corto
    ov.innerHTML = vis.map(t => {
      const s = { ...TEXT_DEF, ...(t.style || {}) };
      const up = s.style === 'bold' || s.style === 'kinetic';
      const track = s.style === 'kinetic' && t.text.length <= 14;
      const dy = (+s.dy || 0);
      const anchor = s.pos === 'top' ? `top:${8 + dy}%;transform:translateX(-50%);`
        : s.pos === 'mid' ? `top:${50 + dy}%;transform:translate(-50%,-50%);`
          : `bottom:${10 - dy}%;transform:translateX(-50%);`;
      return `<span style="${anchor}font-family:${FONTS[s.font] || FONTS.sans};
        font-size:${(s.size / 100 * 8).toFixed(1)}cqh;color:#${esc(s.color)};
        max-width:88%;white-space:normal;text-align:center;line-height:1.26;
        ${s.font === 'sansbold' || s.font === 'black' ? 'font-weight:800;' : ''}
        ${up ? 'text-transform:uppercase;' : ''}${track ? 'letter-spacing:.30em;margin-right:-.30em;' : ''}
        ${s.box ? `background:rgba(0,0,0,${(+s.boxAlpha || 0.45).toFixed(2)});padding:.3em .65em;border-radius:.18em;` : ''}
        ">${esc(t.text)}</span>`;
    }).join('');
  }

  function openTextEditor(i, alreadyUndone = false) {
    const t = texts[i];
    if (!t) return;
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const S = { ...TEXT_DEF, ...(t.style || {}) };
    ov.innerHTML = `<div class="m-w520 modal">
      <div class="modal-h"><b>${icon('tag')} Texto</b><button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        <input class="u-w100 m-ipt" id="tx-t" maxlength="120" value="${esc(t.text)}">
        <div class="mlb">Cuándo aparece</div>
        <div class="tx-row tx-sl"><span>Entra</span>
          <input type="range" id="tx-a" min="0" max="${total().toFixed(1)}" step="0.1" value="${t.start}">
          <b class="mono" id="tx-av">${fmt.dur(t.start)}</b></div>
        <div class="tx-row tx-sl"><span>Sale</span>
          <input type="range" id="tx-b" min="0" max="${total().toFixed(1)}" step="0.1" value="${t.end}">
          <b class="mono" id="tx-bv">${fmt.dur(t.end)}</b></div>
        <div class="mlb">Estilo</div>
        <div class="tx-row"><span>Estilo</span>
          <select class="u-f1 ctl" id="tx-style">
            ${[['clean', 'Limpio'], ['bold', 'Bold · mayúsculas'], ['kinetic', 'Kinético · cine'],
               ['lower', 'Lower third'], ['minimal', 'Minimal']].map(([k, l]) =>
              `<option value="${k}"${S.style === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <select class="u-f1 ctl" id="tx-anim" data-tip="Cómo entra el texto">
            ${[['', 'Anim · auto'], ['fade', 'Fundido'], ['pop', 'Pop'], ['slide', 'Sube'],
               ['slideL', 'Desliza lateral'], ['none', 'Sin animación']].map(([k, l]) =>
              `<option value="${k}"${(S.anim || '') === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select></div>
        <div class="tx-row"><span>Fuente</span>
          <select class="u-f1 ctl" id="tx-font">
            ${[['din', 'DIN Condensed · cine'], ['sansbold', 'Arial Bold · impacto'],
               ['black', 'Arial Black · máximo'], ['sans', 'Helvetica Neue'],
               ['condensed', 'Avenir Condensed'], ['avenir', 'Avenir Next'],
               ['optima', 'Optima'], ['serif', 'Georgia'], ['mono', 'Menlo']].map(([k, l]) =>
              `<option value="${k}"${S.font === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select></div>
        <div class="tx-row"><span>Posición</span>
          <select class="u-f1 ctl" id="tx-pos">
            <option value="top"${S.pos === 'top' ? ' selected' : ''}>Arriba</option>
            <option value="mid"${S.pos === 'mid' ? ' selected' : ''}>Centro</option>
            <option value="bottom"${S.pos === 'bottom' ? ' selected' : ''}>Abajo</option>
          </select></div>
        <div class="mlb">Tamaño y color</div>
        <div class="tx-row tx-sl"><span>Tamaño</span>
          <input type="range" id="tx-size" min="10" max="100" step="1" value="${S.size}">
          <b class="mono" id="tx-sizev">${S.size}</b></div>
        <div class="tx-row tx-sl"><span>Ajuste vertical</span>
          <input type="range" id="tx-dy" min="-20" max="20" step="1" value="${+S.dy || 0}"
                 data-tip="Sube o baja el texto en pasos del 1% de la pantalla">
          <b class="mono" id="tx-dyv">${(+S.dy || 0)}%</b></div>
        <div class="tx-row tx-sl"><span>Color</span>
          <input type="color" class="u-color ctl" id="tx-color" value="#${esc(S.color)}">
          <span></span></div>
        <div class="tx-row tx-sl"><span>Fondo</span>
          <label class="tx-switch" data-tip="Caja oscura detrás del texto"><input type="checkbox" id="tx-box" role="switch"${S.box ? ' checked' : ''}><i aria-hidden="true"></i><em class="sr-only">Fondo</em></label>
          <span></span></div>
        <div class="tx-row tx-sl"><span>Opacidad</span>
          <input type="range" id="tx-boxa" min="0.1" max="0.85" step="0.05" value="${+S.boxAlpha || 0.45}"
                 ${S.box ? '' : 'disabled'} data-tip="Opacidad del fondo">
          <b class="mono" id="tx-boxav">${Math.round((+S.boxAlpha || 0.45) * 100)}%</b></div>
      </div>
      <div class="rm-foot">
        <span class="rm-count">Se quema en el video al exportar</span>
        <span class="u-f1 spacer"></span>
        <button class="btn rv-del" data-tx="del">${icon('trash')} Quitar</button>
        <button class="btn primary" data-tx="ok">Listo</button>
      </div></div>`;
    let deleted = false;
    let undone = alreadyUndone;   // un solo paso de historial por sesión del editor (no por tecla)
    const undoOnce = () => { if (!undone) { undone = true; pushUndo(); } };
    const apply = () => {
      t.text = ov.querySelector('#tx-t').value || 'Texto';
      const A = +ov.querySelector('#tx-a').value, B = +ov.querySelector('#tx-b').value;
      t.start = +Math.min(A, B - 0.3).toFixed(2);
      t.end = +Math.max(B, A + 0.3).toFixed(2);
      t.style = { pos: ov.querySelector('#tx-pos').value, size: +ov.querySelector('#tx-size').value,
                  color: ov.querySelector('#tx-color').value.replace('#', ''),
                  box: ov.querySelector('#tx-box').checked,
                  style: ov.querySelector('#tx-style').value, font: ov.querySelector('#tx-font').value,
                  anim: ov.querySelector('#tx-anim').value || undefined,
                  dy: +ov.querySelector('#tx-dy').value || undefined,
                  boxAlpha: +ov.querySelector('#tx-boxa').value };
      ov.querySelector('#tx-av').textContent = fmt.dur(t.start);
      ov.querySelector('#tx-bv').textContent = fmt.dur(t.end);
      ov.querySelector('#tx-dyv').textContent = `${+ov.querySelector('#tx-dy').value}%`;
      ov.querySelector('#tx-sizev').textContent = String(+ov.querySelector('#tx-size').value);
      ov.querySelector('#tx-boxav').textContent = `${Math.round(+ov.querySelector('#tx-boxa').value * 100)}%`;
      ov.querySelector('#tx-boxa').disabled = !ov.querySelector('#tx-box').checked;
      renderTextLane();
    };
    ov.addEventListener('input', () => { undoOnce(); apply(); });
    ov.addEventListener('change', () => { undoOnce(); apply(); });
    ov.addEventListener('click', e => {
      if (e.target.closest('[data-tx="del"]')) { undoOnce(); deleted = true; texts.splice(i, 1); textSel = -1; ov.remove(); renderTextLane(); return; }
      if (e.target.closest('[data-tx="ok"]')) ov.remove();
    });
    // Esc / × / fondo / Listo: todos cierran vía openModal y aplican los cambios
    openModal(ov, { initialFocus: '#tx-t', onClose: () => { if (!deleted) apply(); } });
    ov.querySelector('#tx-t').select();
  }

  // arrastrar el bloque y sus bordes sobre la pista
  (() => {
    const lane = document.getElementById('tl-textlane');
    if (!lane) return;
    let drag = null, tapIdx = null;
    lane.addEventListener('pointerdown', e => {
      tapIdx = null;
      const blk = e.target.closest('[data-txt]');
      if (!blk) return;
      if (e.target.closest('[data-txtx]')) return;
      const i = +blk.dataset.txt;
      textSel = i;
      // sin re-render aquí: reemplazar los hijos mataría el objetivo del click/pointerup
      lane.querySelectorAll('.tl-txt').forEach(el => el.classList.toggle('on', +el.dataset.txt === i));
      const h = e.target.closest('[data-txth]');
      drag = { i, mode: h ? h.dataset.txth : 'move', x0: e.clientX, a0: texts[i].start, b0: texts[i].end, moved: false };
      try { lane.setPointerCapture(e.pointerId); } catch {}
    });
    lane.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.x0) <= 3) return;
        drag.moved = true;
        pushUndo();   // una sola vez al empezar a arrastrar
      }
      const d = (e.clientX - drag.x0) / pps;
      const t = texts[drag.i];
      const T = total();
      if (drag.mode === 'move') {
        const w = drag.b0 - drag.a0;
        t.start = +Math.max(0, Math.min(T - w, drag.a0 + d)).toFixed(2);
        t.end = +(t.start + w).toFixed(2);
      } else if (drag.mode === 'l') {
        t.start = +Math.max(0, Math.min(drag.b0 - 0.3, drag.a0 + d)).toFixed(2);
      } else {
        t.end = +Math.min(T, Math.max(drag.a0 + 0.3, drag.b0 + d)).toFixed(2);
      }
      renderTextLane();
    });
    lane.addEventListener('pointerup', () => {
      const d = drag; drag = null;
      if (d && !d.moved && d.mode === 'move' && texts[d.i]) tapIdx = d.i;   // tap: se abre en el click (abrirlo aquí dejaba el modal recibir el click fantasma)
    });
    lane.addEventListener('pointercancel', () => { drag = null; tapIdx = null; });
    lane.addEventListener('click', e => {
      const x = e.target.closest('[data-txtx]');
      if (x) { tapIdx = null; pushUndo(); texts.splice(+x.dataset.txtx, 1); textSel = -1; renderTextLane(); return; }
      // con setPointerCapture el click llega al carril, no al bloque: por eso se usa el índice del pointerdown
      if (tapIdx != null) { const i = tapIdx; tapIdx = null; if (texts[i]) openTextEditor(i); }
    });
  })();

  // ================= REABRIR RECETA (T2) =================
  // Cada export guarda su spec junto al reel. Esto lo trae de vuelta VIVO al editor:
  // timeline, textos, música y ajustes — editas y re-exportas (o reemplazas el original).
  let replaceTarget = null;
  async function loadRecipeIntoEditor(recipe, reelName) {
    const segs = (recipe.segments || []).filter(s => byId[s.clip_id]);
    if (!segs.length) { toast('Los clips de este reel ya no están en la biblioteca'); return false; }
    if (segs.length < (recipe.segments || []).length)
      toast(`${(recipe.segments || []).length - segs.length} toma(s) ya no existen — se omiten`);
    pushUndo();
    tl = segs.map(s => ({
      id: uid(), clip_id: s.clip_id, a: +s.a, b: +s.b, speed: +s.speed || 1,
      filter: s.filter || 'none', title: s.title || '', transition: s.transition || 'none',
      transDur: +(s.transDur ?? 0.4), reverse: !!s.reverse, freeze: +(s.freeze || 0),
      titleStyle: { ...TITLE_DEFAULT, ...(s.titleStyle || {}) },
      grade: s.grade && Object.keys(s.grade).length ? s.grade : undefined,
    }));
    texts = (recipe.texts || []).map(t => ({
      id: uid(), text: String(t.text || ''), start: +t.start || 0, end: +t.end || 3,
      style: { ...TEXT_DEF, ...(t.style || {}) },
    }));
    textSel = -1;
    sel = 0; playhead = 0; curCid = null;
    const G = id => document.getElementById(id);
    if (recipe.aspect && G('ed-aspect').querySelector(`option[value="${recipe.aspect}"]`)) {
      G('ed-aspect').value = recipe.aspect;
      G('ed-aspect').dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (recipe.resolution) G('ed-res').value = recipe.resolution;
    if (recipe.filter) G('ed-lut').value = recipe.filter;
    G('ed-title').value = recipe.title || '';
    G('ed-fade').checked = recipe.fade !== false;
    if (recipe.audio) G('ed-audio').value = recipe.audio;
    if (recipe.bitrate) G('ed-bitrate').value = recipe.bitrate;
    if (recipe.framing != null && G('ed-framing')) G('ed-framing').value = recipe.framing;
    if (recipe.vfit) document.querySelector(`[data-vfit="${recipe.vfit}"]`)?.click();
    music = null;
    if (recipe.music?.name) {
      try {
        const tr = ((await (await authFetch('/api/audio_list')).json()).tracks || [])
          .find(x => x.name === recipe.music.name);
        if (tr) music = { ...MUSIC_DEFAULTS, ...recipe.music,
                          duration_s: tr.duration_s, peaks: tr.peaks || [] };
        else toast(`La pista "${recipe.music.name}" ya no está en tu biblioteca`);
      } catch { /* sin música: el resto de la receta sigue siendo válido */ }
    }
    syncMusicEl();
    musicChip();
    if (music && !music.beats) loadBeats(music.name);
    replaceTarget = reelName || null;
    const row = G('ed-replace-row');
    if (row) {
      row.style.display = replaceTarget ? '' : 'none';
      if (replaceTarget) G('ed-replace-name').textContent = replaceTarget;
    }
    renderAll();
    fit(); seek(0);
    toast(`Reel reabierto: ${tl.length} tomas · ${texts.length} texto(s)`);
    return true;
  }
  // el visor vive fuera de este closure: puente explícito
  window.__abLoadRecipe = loadRecipeIntoEditor;

  // ================= MÚSICA (I2) =================
  // La pista se OYE mientras editas (mismo elemento <audio> alineado al playhead) y viaja
  // al export en spec.music, donde ffmpeg la mezcla con ducking, fades y loudnorm.
  // NOTA HONESTA: no hay integración con Spotify — su catálogo está bajo DRM y su ToS
  // prohíbe extraer audio para mezclarlo en un video. Aquí suena TU biblioteca.
  let music = null;      // {name, duration_s, peaks, volume, duck, fadeIn, fadeOut, startAt, originalVolume}
  const musicEl = new Audio();
  musicEl.preload = 'auto';
  const MUSIC_DEFAULTS = { volume: 0.65, duck: true, fadeIn: 0.8, fadeOut: 1.2, startAt: 0, originalVolume: 0.35 };

  function musicSync(t = playhead, andPlay = false) {
    if (!music) { try { musicEl.pause(); } catch {} return; }
    const want = (music.startAt || 0) + Math.max(0, t);
    // la pista se repite si el reel dura más que la canción (igual que en el export)
    const d = music.duration_s || 1;
    const at = d > 0 ? want % d : want;
    if (Math.abs(musicEl.currentTime - at) > 0.25) { try { musicEl.currentTime = at; } catch {} }
    musicEl.volume = Math.max(0, Math.min(1, music.volume ?? 0.65));
    if (andPlay) musicEl.play().catch(() => {});
  }

  // I3 · re-cronometra el timeline para que CADA corte caiga en un golpe de la música.
  // Mantiene el punto de entrada (a) de cada toma y ajusta la salida (b) — el montaje no
  // cambia, cambia su respiración. Si una toma no da para el hueco, usa lo que tenga.
  function beatSync(every = 2) {
    if (!music?.beats?.length || !tl.length) return 0;
    const off = music.startAt || 0;
    const rel = music.beats.map(b => b - off).filter(b => b > 0.15);
    if (rel.length < 2) return 0;
    const grid = rel.filter((_, i) => i % every === every - 1);   // cada N golpes
    if (grid.length < 1) return 0;
    pushUndo();
    let t = 0, hit = 0;
    tl.forEach((s, i) => {
      const target = grid.find(g => g > t + 0.3);
      if (target === undefined) return;
      const want = target - t;                       // duración de salida deseada
      const src = byId[s.clip_id];
      const maxOut = src ? (src.duration_s - s.a) / (s.speed || 1) : want;
      const out = Math.max(0.35, Math.min(want, maxOut, 120));
      s.b = +Math.min(src ? src.duration_s : s.b, s.a + out * (s.speed || 1)).toFixed(2);
      if (Math.abs(out - want) < 0.08) hit++;        // cortes que sí calzaron en el golpe
      t += segDur(s);
    });
    renderAll(); seek(0);
    return hit;
  }

  // el pulso se analiza en el server (cacheado); al llegar, repinta la regla (y opciones si hay modal)
  function loadBeats(name, after) {
    authFetch(`/api/audio_beats?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => {
        if (!music || music.name !== name || d.error) return;
        music.beats = d.beats || []; music.bpm = d.bpm || 0;
        renderRuler(); after?.();
      }).catch(() => {});
  }

  function musicChip() {
    const b = document.getElementById('btn-music');
    if (!b) return;
    b.classList.toggle('on', !!music);
    b.dataset.tip = music ? `Música: ${music.name} · ${Math.round((music.volume ?? .65) * 100)}%`
      : 'Ponle música al reel (tu biblioteca)';
  }

  const wavePath = (peaks, w = 560, h = 42) => {
    if (!peaks || !peaks.length) return '';
    const n = peaks.length, mid = h / 2;
    let up = `M0,${mid}`, dn = '';
    peaks.forEach((p, i) => {
      const x = (i / (n - 1)) * w, y = Math.max(0.6, p * mid);
      up += `L${x.toFixed(1)},${(mid - y).toFixed(1)}`;
    });
    for (let i = n - 1; i >= 0; i--) {
      const x = (i / (n - 1)) * w, y = Math.max(0.6, peaks[i] * mid);
      dn += `L${x.toFixed(1)},${(mid + y).toFixed(1)}`;
    }
    return up + dn + 'Z';
  };

  async function openMusic() {
    const ovr = document.createElement('div');
    ovr.className = 'modal-ov';
    let tracks = [];
    let busy = false;
    const load = async () => {
      try { tracks = (await (await authFetch('/api/audio_list')).json()).tracks || []; }
      catch { tracks = []; }
    };
    ovr.innerHTML = '<div class="modal mus-modal"></div>';   // contenedor estable: openModal le pone el rol
    const mdl = ovr.firstElementChild;
    const render = () => {
      const m = music || {};
      mdl.innerHTML = `
        <div class="modal-h"><b>${icon('volume')} Música del reel</b><button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
        <div class="modal-b">
          <div class="mus-drop" id="mus-drop">
            <b>${icon('dl')} Sube tu pista</b>
            <small>MP3, M4A, WAV, FLAC u OGG — arrastra aquí o toca para elegir</small>
            <input type="file" id="mus-file" accept="audio/*" hidden>
          </div>
          <p class="footer-note mus-note">${icon('warn')} Spotify y Apple Music no permiten extraer audio (DRM + condiciones de uso).
            Usa pistas tuyas o libres de derechos. Si vas a publicar en Instagram/TikTok, lo más seguro
            es exportar sin música y ponerla desde la app: así usas su catálogo con licencia.</p>
          <div class="mlb">Biblioteca ${tracks.length ? `<span class="mono">(${tracks.length})</span>` : ''}</div>
          <div class="mus-list">${tracks.map(t => `
            <div class="mus-item${music?.name === t.name ? ' on' : ''}" data-track="${esc(t.name)}">
              <button class="mus-play" data-prev="${esc(t.name)}" data-tip="Escuchar">${icon('play')}</button>
              <div class="mus-t">
                <b>${esc(t.name.replace(/\.[^.]+$/, ''))}</b>
                <svg class="mus-wave" viewBox="0 0 560 42" preserveAspectRatio="none"><path d="${wavePath(t.peaks)}"/></svg>
              </div>
              <span class="mono mus-d">${fmt.dur(t.duration_s)}</span>
              <button class="mus-del" data-del="${esc(t.name)}" data-tip="Quitar de la biblioteca" aria-label="Quitar de la biblioteca">${icon('close')}</button>
            </div>`).join('') || '<p class="footer-note">Todavía no hay pistas — sube una arriba.</p>'}
          </div>
          ${music ? `
          <div class="mlb">Ajustes de "${esc(music.name.replace(/\.[^.]+$/, ''))}"</div>
          <div class="mus-ctl">
            <label><span>Volumen música</span>
              <input type="range" id="mu-vol" min="0" max="1" step="0.05" value="${m.volume ?? .65}">
              <b class="mono">${Math.round((m.volume ?? .65) * 100)}%</b></label>
            <label><span>Audio del dron</span>
              <input type="range" id="mu-orig" min="0" max="1" step="0.05" value="${m.originalVolume ?? .35}">
              <b class="mono">${Math.round((m.originalVolume ?? .35) * 100)}%</b></label>
            <label><span>Entrada</span>
              <input type="range" id="mu-fi" min="0" max="5" step="0.1" value="${m.fadeIn ?? .8}">
              <b class="mono">${(m.fadeIn ?? .8).toFixed(1)}s</b></label>
            <label><span>Salida</span>
              <input type="range" id="mu-fo" min="0" max="5" step="0.1" value="${m.fadeOut ?? 1.2}">
              <b class="mono">${(m.fadeOut ?? 1.2).toFixed(1)}s</b></label>
            <label><span>Empezar en</span>
              <input type="range" id="mu-st" min="0" max="${Math.max(1, Math.floor((music.duration_s || 30) - 1))}" step="0.5" value="${m.startAt ?? 0}">
              <b class="mono">${fmt.dur(m.startAt ?? 0)}</b></label>
            <label class="mus-check"><input type="checkbox" id="mu-duck" ${m.duck !== false ? 'checked' : ''}>
              <span>Bajar la música cuando hay sonido del dron <em>(ducking)</em></span></label>
          </div>
          <div class="mlb">Cortar al ritmo ${music.bpm ? `<span class="mono">${music.bpm} BPM · ${(music.beats || []).length} golpes</span>` : ''}</div>
          <div class="mus-beat">
            ${music.beats?.length ? `
              <div class="rm-opts">
                <button class="rm-opt sm" data-beat="1"><b>Cada golpe</b><small>frenético</small></button>
                <button class="rm-opt sm" data-beat="2"><b>Cada 2</b><small>enérgico</small></button>
                <button class="rm-opt sm" data-beat="4"><b>Cada compás</b><small>respirado</small></button>
                <button class="rm-opt sm" data-beat="8"><b>Cada 2 compases</b><small>cinemático</small></button>
              </div>
              <p class="footer-note">Ajusta la duración de cada toma para que el corte caiga en el golpe. Se puede deshacer (Ctrl+Z).</p>`
              : '<p class="footer-note">Analizando el pulso de la pista…</p>'}
          </div>` : ''}
        </div>
        <div class="rm-foot">
          <span class="rm-count mono">${music ? `${esc(music.name)} · se mezcla al exportar` : 'Sin música — el reel usará solo el audio original'}</span>
          <span class="u-f1 spacer"></span>
          ${music ? '<button class="btn" id="mu-clear">Quitar música</button>' : ''}
          <button class="btn primary" id="mu-ok">Listo</button>
        </div>`;
    };
    await load();
    render();
    openModal(ovr, { initialFocus: '#mu-ok', onClose: () => { try { musicEl.pause(); } catch {} } });

    const upload = async file => {
      if (!file || busy) return;
      busy = true;
      const drop = ovr.querySelector('#mus-drop');
      drop.classList.add('busy');
      drop.querySelector('b').textContent = `Subiendo ${file.name}…`;
      try {
        const r = await authFetch(`/api/audio_upload?name=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        await load();
        pushUndo();
        music = { ...MUSIC_DEFAULTS, ...d.track };
        musicEl.src = `${DATA}/audio/${encodeURIComponent(d.track.name)}`;
        musicChip();
        render();
      } catch (e) {
        drop.classList.remove('busy');
        drop.querySelector('b').textContent = `No se pudo subir: ${String(e.message || e).slice(0, 50)}`;
      }
      busy = false;
    };

    let musEdit = false;   // un pushUndo por gesto de slider, no por tick
    ovr.addEventListener('change', e => {
      if (e.target.id === 'mus-file') upload(e.target.files?.[0]);
      musEdit = false;
      if (e.target.id === 'mu-duck' && music) { pushUndo(); music.duck = e.target.checked; }
    });
    ovr.addEventListener('input', e => {
      if (!music) return;
      const map = { 'mu-vol': 'volume', 'mu-orig': 'originalVolume', 'mu-fi': 'fadeIn', 'mu-fo': 'fadeOut', 'mu-st': 'startAt' };
      const key = map[e.target.id];
      if (!key) return;
      if (!musEdit) { musEdit = true; pushUndo(); }
      music[key] = +e.target.value;
      const out = e.target.parentElement.querySelector('b');
      if (out) out.textContent = key === 'volume' || key === 'originalVolume'
        ? `${Math.round(music[key] * 100)}%`
        : key === 'startAt' ? fmt.dur(music[key]) : `${music[key].toFixed(1)}s`;
      if (key === 'volume') musicEl.volume = music.volume;
      if (key === 'startAt') musicSync(playhead);
      musicChip();
    });
    ovr.addEventListener('click', async e => {
      if (e.target.closest('#mu-ok')) { ovr.remove(); return; }
      if (e.target.closest('#mus-drop')) { ovr.querySelector('#mus-file').click(); return; }
      const pv = e.target.closest('[data-prev]');
      if (pv) {
        e.stopPropagation();
        const src = `${DATA}/audio/${encodeURIComponent(pv.dataset.prev)}`;
        if (musicEl.src.endsWith(encodeURIComponent(pv.dataset.prev)) && !musicEl.paused) { musicEl.pause(); return; }
        musicEl.src = src; musicEl.currentTime = 0; musicEl.volume = 0.8;
        musicEl.play().catch(() => {});
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const name = del.dataset.del;
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = '¿seguro?'; return; }
        await api('/api/audio_op', { op: 'delete', name });
        if (music?.name === name) { pushUndo(); music = null; musicChip(); }
        await load(); render();
        return;
      }
      const bt = e.target.closest('[data-beat]');
      if (bt) {
        const n = beatSync(+bt.dataset.beat);
        toast(n ? `${n} cortes alineados al ritmo — Ctrl+Z si no te gusta` : 'No pude alinear: la pista no tiene golpes claros ahí');
        return;
      }
      const it = e.target.closest('[data-track]');
      if (it) {
        const t = tracks.find(x => x.name === it.dataset.track);
        if (!t) return;
        pushUndo();
        music = { ...MUSIC_DEFAULTS, ...(music?.name === t.name ? music : {}), ...t };
        musicEl.src = `${DATA}/audio/${encodeURIComponent(t.name)}`;
        musicSync(playhead);
        musicChip(); render();
        loadBeats(t.name, render);
        return;
      }
      if (e.target.closest('#mu-clear')) {
        pushUndo();
        music = null;
        try { musicEl.pause(); musicEl.removeAttribute('src'); } catch {}
        musicChip(); render();
      }
    });
    const drop = ovr.querySelector('#mus-drop');
    ['dragover', 'dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.toggle('hot', ev === 'dragover');
      if (ev === 'drop') upload(e.dataTransfer?.files?.[0]);
    }));
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
    // Los bordes de una toma de dron son despegue, estabilización del gimbal y aterrizaje:
    // ahí es donde salían los "momentos malos". Se descarta el 12% de cada extremo
    // (entre 0.5s y 2s) y se reparte por el cuerpo útil del clip.
    const margen = Math.max(0.5, Math.min(2.0, dur * 0.12));
    const lo = Math.min(margen, dur * 0.35);
    const hi = Math.max(dur - margen, dur * 0.65);
    for (let k = 0; k < need; k++) pts.push(lo + ((hi - lo) * (k + 0.5)) / need);
    return pts.sort((a, b) => a - b);
  }

  // ---- gramática de planos: la ALTURA de vuelo es el tamaño de plano en aéreo ----
  // >45m ves el lugar entero (situación), 20-45 el conjunto, 10-20 medio, <10 detalle.
  const shotScale = f => {
    const a = f?.stats?.max_rel_alt_m || 0;
    return a >= 45 ? 0 : a >= 20 ? 1 : a >= 10 ? 2 : 3;   // 0 = más abierto
  };
  const SCALE_LB = ['situación', 'general', 'medio', 'detalle'];
  // rumbo medio de la toma: dos planos con el mismo rumbo Y la misma escala seguidos
  // se ven como el mismo plano repetido — el clásico "collage" amateur.
  const headOf = f => {
    const b = f?.stats?.bbox;
    if (!Array.isArray(b) || b.length < 4) return 0;
    return Math.round((Math.atan2(b[2] - b[0], b[3] - b[1]) * 180 / Math.PI + 360) % 360);
  };

  // Cuántos planos entran y cuánto aporta cada toma (lo usa rmBuild y el texto del wizard).
  function rmQuota(clips, target) {
    // DURACIÓN MEDIA DE PLANO del cine, no "los cortes que quepan". Investigación: 3.0s
    // para 15s, 3.3s para 30s, 4.0s para 60s. Antes metía 16 cortes en 30s (1.9s cada uno)
    // — eso es exactamente lo que se siente picado y barato.
    const ASL = target <= 15 ? 3.0 : target <= 30 ? 3.3 : 4.0;
    const nSeg = Math.max(3, Math.min(18, Math.round(target / ASL)));
    // selección ELIMINATORIA: se descarta material, no se rellena cuota por clip. Un clip
    // aporta 2 planos como mucho (3 si es largo) para que no domine el montaje.
    const scoreOf = c => Math.max(1, ai[c.clip_id]?.travel_score || 5);
    const ranked = clips.slice().sort((x, y) => scoreOf(y) - scoreOf(x));
    const quotaMap = new Map();
    let left = nSeg;
    for (let pass = 0; left > 0 && pass < 3; pass++) {
      for (const c of ranked) {
        if (left <= 0) break;
        const cap = Math.min((c.duration_s || 0) > 120 ? 3 : 2,
                             Math.max(1, Math.floor((c.duration_s || 1) / 1.2)));
        const cur = quotaMap.get(c.clip_id) || 0;
        if (cur >= cap) continue;
        quotaMap.set(c.clip_id, cur + 1);
        left--;
      }
    }
    return { nSeg, quotaMap };
  }

  function rmBuild(cids, opts) {
    const R = RM_RHYTHM[opts.rhythm] || RM_RHYTHM.medio;
    const clips = cids.map(c => byId[c]).filter(Boolean);
    if (!clips.length) return 0;
    const target = +opts.target || 30;
    const { quotaMap } = rmQuota(clips, target);
    const quota = clips.map(c => quotaMap.get(c.clip_id) || 0);
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

    // ================= MONTAJE CINEMATOGRÁFICO =================
    // 1) ORDEN: abre con el plano más abierto (el espectador necesita saber DÓNDE está),
    //    luego alterna escalas y evita dos planos parecidos seguidos, y CIERRA abriendo
    //    otra vez (sensación de final, no de "se acabó la cinta").
    const meta = s => { const f = byId[s.clip_id]; return { sc: shotScale(f), hd: headOf(f), f }; };
    const pool2 = segs.slice();
    const opened = pool2.splice(pool2.reduce((best, s, i, arr) =>
      meta(s).sc < meta(arr[best]).sc ? i : best, 0), 1)[0];         // el más abierto abre
    let closer = null;
    if (pool2.length > 2) {                                          // y otro abierto cierra
      const ci = pool2.reduce((best, s, i, arr) => meta(s).sc < meta(arr[best]).sc ? i : best, 0);
      closer = pool2.splice(ci, 1)[0];
    }
    const ordered = [opened];
    while (pool2.length) {
      const prev = meta(ordered[ordered.length - 1]);
      // penaliza repetir escala y repetir rumbo: eso es lo que hace que parezca un collage
      let bi = 0, bs = -1e9;
      pool2.forEach((s, i) => {
        const m = meta(s);
        const dScale = Math.abs(m.sc - prev.sc);
        const dHead = Math.min(Math.abs(m.hd - prev.hd), 360 - Math.abs(m.hd - prev.hd));
        const score = (dScale === 0 ? -6 : dScale === 1 ? 3 : 1.5) + Math.min(dHead, 90) / 30
          + (ai[s.clip_id]?.travel_score || 4) * 0.35;
        if (score > bs) { bs = score; bi = i; }
      });
      ordered.push(pool2.splice(bi, 1)[0]);
    }
    if (closer) ordered.push(closer);

    // 2) RITMO EN TRES ACTOS (no una campana simétrica): acto 1 respira (1.30×), el cuerpo
    //    ACELERA de 1.00× a 0.68×, y el cierre rompe la serie con un hold largo (1.6-2.2×).
    //    La tensión la crea el CONTRASTE, no la velocidad sostenida.
    const n = ordered.length;
    const actWeight = t =>
      t < 0.25 ? 1.30
        : t < 0.80 ? 1.00 - 0.32 * ((t - 0.25) / 0.55)
          : 1.6 + 0.6 * ((t - 0.80) / 0.20);
    // un plano abierto necesita más tiempo para leerse que un detalle
    const scaleTime = [1.35, 1.12, 0.95, 0.85];
    // mínimos por tipo de movimiento: una órbita de 1.5s no se lee como órbita
    const minFor = s => {
      const f2 = byId[s.clip_id];
      const mo = (ai[s.clip_id]?.camera_motion || '').toLowerCase();
      if (/órbita|orbita|orbit/.test(mo)) return 2.5;
      if (/avance|dolly|forward|seguimiento/.test(mo)) return 2.0;
      if ((f2?.stats?.distance_m || 0) < 6) return 1.2;      // casi estático
      return 1.6;
    };
    const weights = ordered.map((s, i) => actWeight(n === 1 ? 0.5 : i / (n - 1)) * scaleTime[meta(s).sc]);
    const wSum = weights.reduce((a, b) => a + b, 0);
    ordered.forEach((s, i) => {
      const want = target * (weights[i] / wSum);
      const src = byId[s.clip_id];
      const maxOut = src ? src.duration_s - s.a : want;
      const d = Math.max(minFor(s), Math.min(want, maxOut, 120));
      s.b = +Math.min(src ? src.duration_s : s.b, s.a + d * (s.speed || 1)).toFixed(2);
    });
    // GATE ANTI-METRÓNOMO: si la variación de duraciones es baja, el montaje suena a
    // metrónomo por mucho que las tomas sean buenas. CV = desviación/media debe ser ≥0.25.
    const durs = ordered.map(s => (s.b - s.a) / (s.speed || 1));
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
    const cv = Math.sqrt(durs.reduce((a, d) => a + (d - mean) ** 2, 0) / durs.length) / (mean || 1);
    if (cv < 0.25 && n > 3) {
      // exagera el contraste: alarga los extremos y acorta el pico
      ordered.forEach((s, i) => {
        const t = i / (n - 1);
        const k = t < 0.2 || t > 0.82 ? 1.35 : 0.82;
        const src = byId[s.clip_id];
        const d = Math.max(minFor(s), Math.min(((s.b - s.a) * k), src ? src.duration_s - s.a : 99));
        s.b = +Math.min(src ? src.duration_s : s.b, s.a + d).toFixed(2);
      });
    }

    // 3) TRANSICIONES: corte seco por defecto (un crossfade en CADA unión es justo lo que
    //    abarata un montaje). Solo se funde cuando el salto de escala es grande, y el
    //    último corte entra con un fundido más largo para cerrar.
    const R2 = RM_RHYTHM[opts.rhythm] || RM_RHYTHM.medio;
    ordered.forEach((s, i) => {
      if (i === 0) { s.transition = 'none'; return; }
      const jump = Math.abs(meta(s).sc - meta(ordered[i - 1]).sc);
      const last = i === n - 1;
      s.transition = last ? 'dissolve' : jump >= 2 ? R2.trans : 'none';
      s.transDur = last ? Math.min(0.9, R2.dur + 0.35) : R2.dur;
    });
    // un plano por debajo de ~1s no se lee: se percibe como un parpadeo/glitch. Si la
    // fuente no da para el mínimo, el plano SOBRA — mejor 8 cortes buenos que 9 con uno roto.
    const clean = ordered.filter((s, i) => (s.b - s.a) / (s.speed || 1) >= 1.0 || i === 0);
    if (clean.length >= 3 && clean.length < ordered.length) {
      const falta = target - clean.reduce((a, s) => a + (s.b - s.a) / (s.speed || 1), 0);
      if (falta > 0.2) {          // reparte lo que sobraba entre los planos de cierre
        const tail = clean.slice(-2);
        tail.forEach(s => {
          const src = byId[s.clip_id];
          const d = (s.b - s.a) + falta / tail.length;
          s.b = +Math.min(src ? src.duration_s : s.b, s.a + d).toFixed(2);
        });
      }
    }
    segs.length = 0;
    segs.push(...(clean.length >= 3 ? clean : ordered));

    pushUndo();
    tl = segs;
    // montaje NUEVO = pista de texto nueva: sin esto los textos del reel anterior se
    // acumulaban (3, 6, 9…) y se exportaban duplicados encima de los del siguiente
    resetProjectState({ keepMusic: !replaceTarget });   // un montaje nuevo nunca debe pisar un reel reabierto
    sel = 0; playhead = 0; curCid = null;
    const fmtSel = RM_FORMATS[opts.aspect] || RM_FORMATS['9:16'];
    const asp = document.getElementById('ed-aspect');
    const res = document.getElementById('ed-res');
    // asignar .value por código NO dispara 'change': hay que avisar a quien escucha
    // (por eso la sección de relleno vertical quedaba oculta en un reel 9:16)
    if (asp) { asp.value = opts.aspect; applyAspect(); asp.dispatchEvent(new Event('change', { bubbles: true })); }
    if (res) res.value = fmtSel.res;
    const lut = document.getElementById('ed-lut');
    if (lut && opts.look) lut.value = opts.look;
    renderAll(); seek(0);
    return segs.length;
  }

  // vistazo rápido a una toma dentro del Reels Maker (sin salir del wizard)
  function openClipPeek(cid) {
    const f = byId[cid];
    if (!f) return;
    const pk = document.createElement('div');
    pk.className = 'rm-peek';
    pk.innerHTML = `<div class="rm-peek-card">
      <video src="${DATA}/proxies/${encodeURIComponent(cid)}.mp4" controls autoplay muted playsinline
             poster="${DATA}/thumbs/${encodeURIComponent(cid)}.jpg"></video>
      <div class="rm-peek-f">
        <b>${esc(f.label) || fmt.date(f.date) + ' · ' + (f.time || '')}</b>
        <span class="mono">${fmt.dur(f.duration_s)} · ${Math.round(f.stats?.max_rel_alt_m || 0)} m</span>
        <span class="u-f1 spacer"></span>
        <button class="btn sm" data-peek-close>Cerrar</button>
      </div>
    </div>`;
    openModal(pk, { label: 'Vista rápida de toma', initialFocus: '[data-peek-close]',
      onClose: () => pk.querySelector('video')?.pause() });
  }

  function openReelMaker() {
    const ovr = document.createElement('div');
    ovr.className = 'modal-ov';
    const pick = new Set();
    const st = { step: 1, q: '', only: '', target: 30, rhythm: 'medio', look: 'nolan', aspect: '9:16' };
    const pool = () => editable.slice().sort((a, b) =>
      (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    const visible = () => pool().filter(f => {
      const a = ai[f.clip_id];
      if (st.only === 'top' && !(a?.travel_score >= 7)) return false;
      if (st.only === 'ai' && !a?.travel_score) return false;
      if (st.only === 'long' && (f.duration_s || 0) < 10) return false;
      if (!st.q) return true;
      const hay = `${f.label || ''} ${f.date} ${fmt.date(f.date)} ${f.time || ''} ${(a?.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(st.q.toLowerCase());
    });
    // agrupar por día: 113 tarjetas planas no se navegan; por fecha sí
    const groupsOf = list => {
      const m = new Map();
      list.forEach(f => { const d = f.date || '—'; (m.get(d) || m.set(d, []).get(d)).push(f); });
      return [...m.entries()];
    };
    // el número del check refleja el ORDEN del montaje, y cambia al quitar tomas del medio
    const syncChecks = () => {
      const order = [...pick];
      ovr.querySelectorAll('.rm-clip').forEach(c => {
        const i = order.indexOf(c.dataset.pick);
        c.classList.toggle('on', i >= 0);
        c.setAttribute('aria-pressed', i >= 0);
        const chk = c.querySelector('.rm-check');
        if (chk) chk.textContent = i >= 0 ? i + 1 : '';
      });
    };
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
    ovr.innerHTML = '<div class="modal rm-modal"></div>';   // contenedor estable: openModal le pone el rol
    const mdl = ovr.firstElementChild;
    const render = () => {
      const vis = visible();
      mdl.innerHTML = `
        <div class="modal-h"><b>${icon('spark')} Crear reel</b>
          <span class="rm-steps"><i class="${st.step === 1 ? 'on' : ''}">1 · Tomas</i><i class="${st.step === 2 ? 'on' : ''}">2 · Receta</i></span>
          <button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
        <div class="modal-b">
        ${st.step === 1 ? `
          <div class="rm-bar">
            <label class="u-f1 search"><input id="rm-q" placeholder="Buscar toma, fecha o tag AI…" value="${esc(st.q)}"></label>
          </div>
          <div class="chip-row rm-filters" role="toolbar" aria-label="Filtros y selección">
            <button class="chip${st.only === 'top' ? ' on' : ''}" data-only="top" aria-pressed="${st.only === 'top'}">${icon('star')} Score 7+</button>
            <button class="chip${st.only === 'ai' ? ' on' : ''}" data-only="ai" aria-pressed="${st.only === 'ai'}">Con análisis AI</button>
            <button class="chip${st.only === 'long' ? ' on' : ''}" data-only="long" aria-pressed="${st.only === 'long'}">Más de 10s</button>
            <span class="chip-div"></span>
            <button class="chip" id="rm-all">Todas (${vis.length})</button>
            <button class="chip" id="rm-none">Ninguna</button>
            <span class="rm-hint mono">${vis.length} de ${pool().length}</span>
          </div>
          ${groupsOf(vis).map(([day, fs]) => `
          <div class="rm-day">
            <div class="rm-day-h">
              <b>${fmt.date(day)}</b>
              <span class="mono">${fs.length} toma${fs.length === 1 ? '' : 's'} · ${fmt.dur(fs.reduce((a, x) => a + (x.duration_s || 0), 0))}</span>
              <button class="rm-day-all" data-day="${esc(day)}">Elegir el día</button>
            </div>
            <div class="rm-grid">${fs.map(f => {
            const sc = ai[f.clip_id]?.travel_score;
            const ord = [...pick].indexOf(f.clip_id) + 1;
            // OJO: la caja con proporción NO puede ser el <button> — Safari no aplica
            // aspect-ratio a los botones y las tarjetas colapsaban unas sobre otras.
            return `<div class="rm-clip${pick.has(f.clip_id) ? ' on' : ''}" data-pick="${esc(f.clip_id)}"
                         role="button" tabindex="0" aria-pressed="${pick.has(f.clip_id)}">
              <div class="rm-thumb" data-hover="${esc(f.clip_id)}">
                <img src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="" width="320" height="180">
                <span class="rm-check">${ord > 0 ? ord : ''}</span>
                ${sc ? `<span class="rm-sc ${sc >= 7 ? 'ok' : sc >= 4 ? 'mid' : 'bad'}">${icon('star')}${sc}</span>` : ''}
                <button class="rm-eye" data-eye="${esc(f.clip_id)}" aria-label="Ver toma">${icon('play')}</button>
              </div>
              <div class="rm-lb"><b>${esc((f.label || f.time || fmt.date(f.date)).slice(0, 24))}</b><em>${fmt.dur(f.duration_s)}</em></div>
            </div>`;
          }).join('')}</div>
          </div>`).join('') || '<p class="footer-note">Nada coincide con esos filtros.</p>'}` : `
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
          <div class="rm-opts look">${[['nolan', 'Nolan'], ['deakins', 'Deakins'], ['malick', 'Malick'],
            ['kodak', 'Kodak'], ['cine', 'Cine'], ['warm', 'Cálido'], ['bw', 'B&N'], ['none', 'Sin look']].map(([k, lb]) => `
            <button class="rm-opt sm${st.look === k ? ' on' : ''}" data-look="${k}"><b>${lb}</b></button>`).join('')}</div>
          <div class="rm-plan">
            <b>${icon('spark')} Lo que va a pasar</b>
            <p>${(() => {
              const R = RM_RHYTHM[st.rhythm];
              const { quotaMap } = rmQuota([...pick].map(c => byId[c]).filter(Boolean), st.target);
              const n = [...quotaMap.values()].reduce((a, b) => a + b, 0) || 1;
              const used = quotaMap.size;
              const per = (st.target / n).toFixed(1);
              const who = used >= pick.size
                ? `repartidos entre tus <b>${pick.size} toma${pick.size === 1 ? '' : 's'}</b>, dando más espacio a las de mejor score AI
                pero sin dejar ninguna fuera`
                : `de las <b>${used} mejores</b> de tus <b>${pick.size} tomas</b> (por score AI): las otras ${pick.size - used}
                no tienen cupo en ${st.target}s y quedan fuera — sube la duración o elige menos`;
              return `Se arman <b>${n} cortes</b> de ~<b>${per}s</b> ${who}. Unión: <b>${TX_LABELS[R.trans] || R.trans}</b>.
                Al terminar se abre en el Editor para que lo retoques.`;
            })()}</p>
          </div>`}
        </div>
        <div class="rm-foot">
          <span class="rm-count mono">${pick.size ? `${pick.size} toma${pick.size === 1 ? '' : 's'} · ${estimate()}` : 'Elige al menos una toma'}</span>
          <span class="u-f1 spacer"></span>
          ${st.step === 2 ? `<button class="btn" id="rm-back">${icon('chevL')} Tomas</button>` : ''}
          <button class="btn primary" id="rm-go" ${pick.size ? '' : 'disabled'}>${st.step === 1 ? `Continuar ${icon('chevR')}` : `${icon('spark')} Crear reel`}</button>
        </div>`;
    };
    render();
    openModal(ovr, { initialFocus: '#rm-q' });
    ovr.addEventListener('click', e => {
      const eye = e.target.closest('[data-eye]');
      if (eye) {   // ver la toma sin seleccionarla
        e.stopPropagation();
        openClipPeek(eye.dataset.eye);
        return;
      }
      const p = e.target.closest('[data-pick]');
      if (p) {
        // patch EN SITIO: re-renderizar el grid entero por cada click recargaba 113 <img>,
        // perdía el scroll y parpadeaba (misma lección que las tarjetas de Trabajos)
        const cid = p.dataset.pick;
        pick.has(cid) ? pick.delete(cid) : pick.add(cid);
        syncChecks();
        syncFoot();
        return;
      }
      const only = e.target.closest('[data-only]');
      if (only) { st.only = st.only === only.dataset.only ? '' : only.dataset.only; render(); return; }
      const day = e.target.closest('[data-day]');
      if (day) {
        const fs = visible().filter(f => f.date === day.dataset.day);
        const allIn = fs.every(f => pick.has(f.clip_id));
        fs.forEach(f => allIn ? pick.delete(f.clip_id) : pick.add(f.clip_id));
        syncChecks(); syncFoot();
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
    // preview al pasar el cursor: un solo <video> vivo a la vez (113 serían inviables)
    let hoverV = null;
    ovr.addEventListener('pointerover', e => {
      const th = e.target.closest('[data-hover]');
      if (!th || th === hoverV?.parentElement) return;
      if (hoverV) { hoverV.pause(); hoverV.remove(); hoverV = null; }
      if (matchMedia('(pointer: coarse)').matches) return;   // en táctil manda el ojo, no el hover
      const v = document.createElement('video');
      v.src = `${DATA}/proxies/${encodeURIComponent(th.dataset.hover)}.mp4`;
      v.muted = true; v.loop = true; v.playsInline = true; v.className = 'rm-hovervid';
      th.appendChild(v);
      v.play().catch(() => {});
      hoverV = v;
    });
    ovr.addEventListener('pointerout', e => {
      const th = e.target.closest('[data-hover]');
      if (th && hoverV && th.contains(hoverV) && !th.contains(e.relatedTarget)) {
        hoverV.pause(); hoverV.remove(); hoverV = null;
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

  // ⚡ REEL AUTOMÁTICO: sin wizard. Elige el mejor DÍA (el que suma más score AI), toma
  // sus mejores clips y arma el montaje. Un toque = reel editable en el Editor.
  // ---- filtro de usabilidad: un clip nocturno es NEGRO, no "un plano oscuro" ----
  // El reel automático elegía tomas de las 22:54 con brillo 17/255 (tramos enteros a 0-3)
  // porque, sin análisis AI, recibían la puntuación neutra por defecto. Se mide el brillo
  // de la miniatura — una imagen diminuta por clip, y se cachea.
  // El brillo se mide SOBRE EL VIDEO ENTERO en el servidor (backfill_luma.py) y viaja en
  // el manifiesto. Medirlo sobre la miniatura no servía: se desvía hasta ±25 porque la
  // miniatura sale del 25% de la duración y puede caer en el único momento iluminado.
  const LUMA_MIN = 45;      // por debajo, el material no se ve por mucho grading que le eches
  const DARK_MAX = 0.35;    // y si más de un tercio de las muestras son negro puro, sobra
  const usableClip = f => f.avg_luma === undefined
    || (f.avg_luma >= LUMA_MIN && (f.dark_frac ?? 0) <= DARK_MAX);

  function autoReel(target) {
    // descartar lo inservible ANTES de puntuar: sin esto una toma nocturna gana un hueco
    const usable = editable.filter(usableClip);
    const descartadas = editable.length - usable.length;
    const pool0 = usable.length >= 3 ? usable : editable;   // si casi todo es oscuro, no bloqueamos
    const byDay = new Map();
    pool0.forEach(f => {
      const d = f.date || '—';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(f);
    });
    if (!byDay.size) return toast('No hay tomas con video disponible todavía');
    // Mejor día = CALIDAD MEDIA × LUZ, no volumen. Sumar puntuaciones hacía ganar al día
    // con más tomas aunque fueran mediocres — por eso salía siempre la sesión del
    // atardecer, que tenía muchos clips a 50 de luma en vez de los buenos a 110.
    const dayScore = fs => {
      const q = fs.reduce((a, f) => a + (ai[f.clip_id]?.travel_score || 5), 0) / fs.length;
      const lum = fs.reduce((a, f) => a + (f.avg_luma ?? 90), 0) / fs.length;
      const luz = Math.min(1, lum / 95);                 // 95+ = luz plena; 50 = penaliza fuerte
      const cuerpo = Math.min(1, fs.length / 6);         // un día de 1 toma no da para un reel
      return q * luz * (0.65 + 0.35 * cuerpo);
    };
    // el usuario puede FIJAR la sesión: antes el automático siempre ganaba el mismo día y
    // las salidas de otros viajes (La Mesa, marzo…) eran inalcanzables desde aquí
    const forz = document.getElementById('rm-day')?.value || '';
    const elegido = forz && byDay.has(forz) ? [forz, byDay.get(forz)] : null;
    const [bestDay, pool] = elegido || [...byDay.entries()]
      .sort((A, B) => dayScore(B[1]) - dayScore(A[1]) || B[0].localeCompare(A[0]))[0];
    // dentro del día, la luz también manda: un plano bien expuesto vale más que uno turbio
    const clipScore = f => (ai[f.clip_id]?.travel_score || 5) * Math.min(1.15, (f.avg_luma ?? 90) / 95);
    const ranked = pool.slice().sort((a, b) => clipScore(b) - clipScore(a));
    // más tomas para reels largos, pero nunca tantas que cada corte quede en un parpadeo
    const want = Math.max(2, Math.min(ranked.length, Math.round(target / 4)));
    const picks = ranked.slice(0, want).map(f => f.clip_id);
    const n = rmBuild(picks, { target, rhythm: target <= 15 ? 'rapido' : target >= 60 ? 'cine' : 'medio',
                               look: 'nolan', aspect: '9:16' });
    if (!n) return toast('No pude armar el reel con esas tomas');
    showMod('editor');
    scrollTo({ top: 0, behavior: 'smooth' });
    toast(`Reel de ${target}s listo: ${n} cortes de las ${picks.length} mejores tomas del ${fmt.date(bestDay)}`
      + (descartadas ? ` · ${descartadas} toma${descartadas === 1 ? '' : 's'} descartada${descartadas === 1 ? '' : 's'} por estar demasiado oscura${descartadas === 1 ? '' : 's'}` : ''));
  }
  // llena el selector de sesión con TODOS los días que tienen material usable
  (() => {
    const sel2 = document.getElementById('rm-day');
    if (!sel2) return;
    const byDay = new Map();
    editable.filter(usableClip).forEach(f => {
      const d = f.date || '—';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(f);
    });
    [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, fs]) => {
      const min = Math.round(fs.reduce((a, f) => a + (f.duration_s || 0), 0) / 60);
      const o = document.createElement('option');
      o.value = d;
      o.textContent = `${fmt.date(d)} · ${fs.length} toma${fs.length === 1 ? '' : 's'}${min ? ` · ${min} min` : ''}`;
      sel2.appendChild(o);
    });
  })();

  document.querySelector('.rm-auto-b')?.addEventListener('click', e => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    b.classList.add('busy');
    setTimeout(() => { autoReel(+b.dataset.auto); b.classList.remove('busy'); }, 40);
  });

  // ================= carrusel de clips fuente (24-27) =================
  const rail = document.getElementById('rail');
  rail.innerHTML = editable.map(f => `
    <div class="cr-item" draggable="true" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" loading="lazy" alt="" width="320" height="180">
      <span class="scrub-line"></span>
      <span class="cr-lb">${esc(f.label) || fmt.date(f.date)} · ${fmt.dur(f.duration_s)}</span>
      <button class="cr-ins" data-ins="${f.clip_id}" data-tip="Insertar en playhead" aria-label="Insertar en el playhead">${icon('plus')}</button>
    </div>`).join('') || emptyState({ icon: 'film', title: 'Sin clips disponibles', help: 'Ningún clip tiene proxy todavía.' });
  rail.querySelectorAll('.cr-item').forEach(el => el.classList.add('scrub'));
  attachScrub(rail);   // 27 · scrub por hover reutilizando el helper del repo
  rail.addEventListener('click', e => {
    const ins = e.target.closest('[data-ins]');
    if (ins) { addClip(ins.dataset.ins, true); return; }
    const it = e.target.closest('.cr-item');
    if (it) addClip(it.dataset.cid, false);   // 25 · tap = añadir al final
  });

  // ---- arrastrar una toma de la biblioteca AL TIMELINE (drop en la posición exacta) ----
  let dropIdx = -1;
  rail.addEventListener('dragstart', e => {
    const it = e.target.closest('.cr-item');
    if (!it) return;
    e.dataTransfer.setData('text/ab-clip', it.dataset.cid);
    e.dataTransfer.effectAllowed = 'copy';
    it.classList.add('dragging');
  });
  rail.addEventListener('dragend', e => e.target.closest('.cr-item')?.classList.remove('dragging'));

  // índice de inserción según dónde suelte el cursor (mitad izquierda = antes de ese corte)
  const dropIndexAt = clientX => {
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left + scroll.scrollLeft;
    let acc = 0;
    for (let i = 0; i < tl.length; i++) {
      const w = segDur(tl[i]) * pps;
      if (x < acc + w / 2) return i;
      acc += w;
    }
    return tl.length;
  };
  const paintDropMark = i => {
    track.querySelectorAll('.tl-dropmark').forEach(m => m.remove());
    if (i < 0) return;
    const m = document.createElement('span');
    m.className = 'tl-dropmark';
    m.style.left = `${offset(i) * pps}px`;
    track.appendChild(m);
  };
  ['dragover', 'dragenter'].forEach(ev => scroll.addEventListener(ev, e => {
    if (!e.dataTransfer?.types?.includes('text/ab-clip')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropIdx = dropIndexAt(e.clientX);
    paintDropMark(dropIdx);
  }));
  scroll.addEventListener('dragleave', e => {
    if (!scroll.contains(e.relatedTarget)) { dropIdx = -1; paintDropMark(-1); }
  });
  scroll.addEventListener('drop', e => {
    const cid = e.dataTransfer?.getData('text/ab-clip');
    if (!cid || !byId[cid]) return;
    e.preventDefault();
    const at = dropIdx < 0 ? tl.length : dropIdx;
    dropIdx = -1; paintDropMark(-1);
    pushUndo();
    const f = byId[cid];
    tl.splice(at, 0, makeSeg(cid, 0, Math.min(5, f.duration_s)));
    sel = at;
    renderAll();
    seek(offset(at));
    toast(`Toma insertada en el corte ${at + 1}`);
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
    // un toque cancelado (o un pointer ya liberado) hace que esto lance y mate el drag
    try { track.setPointerCapture(e.pointerId); } catch {}
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
  document.getElementById('tl-toolbar').addEventListener('click', e => {
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
    else if (t === 'music') openMusic();
    else if (t === 'text') addText();
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
  $('tli-title-style').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.style = e.target.value; renderTrack(); } });
  $('tli-title-font').addEventListener('change', e => { const s = selSeg(); if (s) { pushUndo(); s.titleStyle.font = e.target.value; } });
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
  // Presets con los números REALES de cada plataforma (2026). Notas de la investigación:
  // ninguna sirve vertical por encima de 1080x1920, y subir de ~10 Mbps no mejora nada
  // porque la plataforma recomprime igual. maxDur = límite práctico, no el máximo absoluto.
  const PRESETS = {
    tiktok:  { aspect: '9:16', res: '1080', fps: '30', bitrate: 12, maxDur: 60,  safe: 'tiktok', lb: 'TikTok' },
    reels:   { aspect: '9:16', res: '1080', fps: '30', bitrate: 9,  maxDur: 90,  safe: 'reels',  lb: 'Instagram Reels' },
    shorts:  { aspect: '9:16', res: '1080', fps: '',   bitrate: 10, maxDur: 180, safe: 'shorts', lb: 'YouTube Shorts' },
    yt1080:  { aspect: '16:9', res: '1080', fps: '',   bitrate: 12, maxDur: 0,   safe: '',       lb: 'YouTube 1080' },
    yt4k:    { aspect: '16:9', res: '2160', fps: '',   bitrate: 40, maxDur: 0,   safe: '',       lb: 'YouTube 4K' },
    square:  { aspect: '1:1',  res: '1080', fps: '30', bitrate: 9,  maxDur: 60,  safe: '',       lb: 'Cuadrado' },
    feed45:  { aspect: '4:5',  res: '1080', fps: '30', bitrate: 9,  maxDur: 60,  safe: 'reels',  lb: 'Feed 4:5' },
  };
  // zonas seguras en % sobre 1080x1920 (dónde tapa la UI de cada app). Fuente: guías de Meta
  // (14% arriba / 35% abajo / 6% lados) y valores de consenso para TikTok y Shorts.
  const SAFE = {
    tiktok: { top: 6.8, bottom: 25.2, left: 4.1, right: 13.0 },
    reels:  { top: 14.0, bottom: 35.0, left: 6.0, right: 6.0 },
    shorts: { top: 7.5, bottom: 18.0, left: 5.5, right: 11.0 },
  };
  document.getElementById('ed-preset').addEventListener('change', e => {
    const p = PRESETS[e.target.value];
    safeMode = p?.safe || '';
    applySafe();
    if (!p) return;
    document.getElementById('ed-aspect').value = p.aspect;
    document.getElementById('ed-res').value = p.res;
    // el preset ahora también fija fps y bitrate reales de la plataforma
    edFps = p.fps || '';
    syncFpsChips();
    const br = document.getElementById('ed-bitrate');
    if (br) { br.value = p.bitrate; document.getElementById('ed-bitrate-v').textContent = `${p.bitrate} Mbps`; }
    applyAspect();
    if (typeof updateExportUI === 'function') try { updateExportUI(); } catch {}
    // aviso honesto si el reel se pasa del largo que la plataforma premia
    if (p.maxDur && total() > p.maxDur) {
      toast(`Ojo: ${p.lb} rinde mejor hasta ${p.maxDur}s y tu reel dura ${fmt.dur(total())}`);
    }
  });
  // ---- modo de relleno vertical + punto focal (E2) ----
  let edVfit = localStorage.getItem('ab.ed.vfit') || 'crop';
  const VFIT_LB = { crop: 'recorte', blur: 'fondo difuminado', bars: 'barras' };
  function syncVfit() {
    document.querySelectorAll('#ed-vfit .chip').forEach(c =>
      c.classList.toggle('on', c.dataset.vfit === edVfit));
    const v = document.getElementById('ed-vfit-v');
    if (v) v.textContent = VFIT_LB[edVfit] || edVfit;
    // el punto focal SOLO tiene sentido recortando: con fondo o barras no se pierde nada
    const row = document.getElementById('ex-frame-row');
    if (row) row.style.display = edVfit === 'crop' ? '' : 'none';
    // el preview muestra el modo elegido, no siempre un recorte
    const mask = document.getElementById('tl-mask');
    if (mask) { mask.dataset.fit = edVfit; layoutMask(); }
    const sec = document.getElementById('ex-vfit-sec');
    const vertical = ['9:16', '1:1', '4:5'].includes(document.getElementById('ed-aspect')?.value);
    if (sec) sec.style.display = vertical ? '' : 'none';   // en 16:9 no hay nada que rellenar
  }
  document.getElementById('ed-vfit')?.addEventListener('click', e => {
    const c = e.target.closest('[data-vfit]');
    if (!c) return;
    edVfit = c.dataset.vfit;
    localStorage.setItem('ab.ed.vfit', edVfit);
    syncVfit();
  });
  document.getElementById('ed-framing')?.addEventListener('input', e => {
    const f = +e.target.value;
    document.getElementById('ed-framing-v').textContent =
      Math.abs(f) < 0.06 ? 'centro' : f < 0 ? `izquierda ${Math.round(-f * 100)}%` : `derecha ${Math.round(f * 100)}%`;
    frameF = f; layoutMask();
  });
  document.getElementById('ed-aspect')?.addEventListener('change', syncVfit);
  syncVfit();

  // ---- overlay de zonas seguras (I4): dónde tapa la UI de cada app ----
  let safeMode = '';
  function applySafe() {
    const st = document.getElementById('tl-stage');
    let el = document.getElementById('tl-safe');
    if (!safeMode || !SAFE[safeMode]) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'tl-safe';
      el.className = 'tl-safe';
      el.innerHTML = '<i class="ts-box"></i><span class="ts-lb"></span>';
      st.appendChild(el);
    }
    const s = SAFE[safeMode];
    const box = el.querySelector('.ts-box');
    box.style.inset = `${s.top}% ${s.right}% ${s.bottom}% ${s.left}%`;
    el.querySelector('.ts-lb').textContent = `zona segura · ${PRESETS[document.getElementById('ed-preset').value]?.lb || safeMode}`;
  }

  // ================= atajos de teclado (36-40) =================
  function editorVisible() { return document.querySelector('.st-mod[data-mod="editor"]')?.style.display !== 'none'; }
  window.addEventListener('keydown', e => {
    if (!editorVisible()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    // con un modal/hoja/visor encima los atajos del timeline no deben actuar por debajo
    if (document.querySelector('.modal-ov, .ce-ov, .rv-ov, .tx-pop, .rm-peek')) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if ((e.key === 's' || e.key === 'S') && !meta && !e.altKey) { e.preventDefault(); razor(); }
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
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', `Transición entre toma ${j} y ${j + 1}`);
    const cur = () => tl[j]?.transition || 'none';
    const curDur = () => tl[j]?.transDur || 0.4;
    const OPTS = ['none', 'fade', 'dissolve', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight',
                  'slideup', 'slidedown', 'circleopen', 'circleclose', 'radial', 'smoothleft', 'pixelize'];
    pop.innerHTML = `
      <div class="tx-pop-h"><b>Transición entre toma ${j} y ${j + 1}</b><button class="modal-x" type="button" aria-label="Cerrar">${icon('close')}</button></div>
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
    // capa propia en la pila: Esc cierra SOLO este popover (foco vuelve a la unión), Tab queda dentro
    let popClosed = false;
    const closePop = (refocus = true) => {
      if (popClosed) return;
      popClosed = true;
      popLayer(layer);
      removeEventListener('pointerdown', away, true);
      pop.remove();
      if (refocus && anchor.isConnected) { try { anchor.focus({ preventScroll: true }); } catch {} }
    };
    const layer = pushLayer({ onKey: e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
      if (e.key !== 'Tab') return;
      const f = [...pop.querySelectorAll('button:not([disabled]),input')];
      if (!f.length) return;
      const cur = document.activeElement;
      if (!pop.contains(cur)) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && cur === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && cur === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    } });
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
      if (e.target.closest('.modal-x')) { closePop(); return; }
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
        pop.querySelector('.tx-all').textContent = 'Aplicada a todas';
        setTimeout(() => closePop(false), 700);
      }
    });
    pop.querySelector('.tx-dur input').addEventListener('input', e => {
      tl[j].transDur = +e.target.value; paint();
    });
    function away(e) { if (!pop.contains(e.target) && !e.target.closest('.tl-junction')) closePop(false); }
    addEventListener('pointerdown', away, true);
    (pop.querySelector('.tx-opt.on') || pop.querySelector('.tx-opt')).focus({ preventScroll: true });
  }

  // ---- E1 · inspector expandible: doble click en un corte lo abre en grande ----
  // El panel de abajo obliga a editar el in/out con sliders diminutos sobre un preview
  // de 100px. Aquí ves el clip ENTERO y eliges el tramo mirándolo.
  function openClipEditor(i) {
    const s = tl[i];
    const f = byId[s?.clip_id];
    if (!s || !f) return;
    const a0 = s.a, b0 = s.b;                       // por si cancela
    // el historial debe guardar el corte ANTERIOR: s.a/s.b ya se mutaron durante el arrastre
    const commitUndo = () => {
      if (s.a === a0 && s.b === b0) return;
      const na = s.a, nb = s.b;
      s.a = a0; s.b = b0; pushUndo(); s.a = na; s.b = nb;
    };
    const ov = document.createElement('div');
    ov.className = 'ce-ov';
    const A = ai[s.clip_id] || {};
    ov.innerHTML = `<div class="ce-card">
      <div class="ce-h">
        <div class="ce-t">
          <b>${esc(f.label) || fmt.date(f.date) + ' · ' + (f.time || '')}</b>
          <span class="mono">corte ${i + 1} de ${tl.length} · fuente ${fmt.dur(f.duration_s)}</span>
        </div>
        <span class="u-f1 spacer"></span>
        <button class="btn icon ghost rv-x" data-ce="close" aria-label="Cerrar">${icon('close')}</button>
      </div>
      <div class="ce-stage">
        <video src="${DATA}/proxies/${encodeURIComponent(s.clip_id)}.mp4" playsinline preload="auto" muted></video>
        <div class="ce-mask" data-aspect="${document.getElementById('ed-aspect')?.value || '16:9'}"></div>
      </div>
      <div class="ce-scrub" id="ce-scrub">
        <div class="ce-sel" id="ce-sel"></div>
        <span class="ce-h1" data-ce="ha"></span>
        <span class="ce-h2" data-ce="hb"></span>
        <span class="ce-ph" id="ce-ph"></span>
      </div>
      <div class="ce-times mono">
        <span>In <b id="ce-a">${fmt.dur(s.a)}</b></span>
        <span class="ce-dur">dura <b id="ce-d">${(s.b - s.a).toFixed(1)}s</b></span>
        <span>Out <b id="ce-b">${fmt.dur(s.b)}</b></span>
      </div>
      <div class="ce-facts">
        <span><i>${icon('mountain')}</i><b>${Math.round(f.stats?.max_rel_alt_m || 0)} m</b><em>altura</em></span>
        <span><i>${icon('route')}</i><b>${fmt.km(f.stats?.distance_m || 0)}</b><em>recorrido</em></span>
        <span><i>${icon('clock')}</i><b>${esc(f.time || '—')}</b><em>hora</em></span>
        ${A.travel_score ? `<span><i>${icon('spark')}</i><b>${A.travel_score}/10</b><em>AI vision</em></span>` : ''}
        <span><i>${icon('layers')}</i><b>${SCALE_LB[shotScale(f)]}</b><em>tipo de plano</em></span>
      </div>
      ${A.summary ? `<p class="ce-sum">${esc(A.summary)}</p>` : ''}
      ${(A.highlights || []).length ? `<div class="ce-hl">
        <span class="ce-hl-lb">Momentos que la AI marcó:</span>
        ${(A.highlights || []).slice(0, 5).map(h =>
          `<button class="chip" data-jump="${(+h.t || 0).toFixed(1)}" data-tip="${esc(h.reason || '')}">${fmt.dur(+h.t || 0)} · ${esc(h.type || 'momento')}</button>`).join('')}
      </div>` : ''}
      <div class="ce-f">
        <button class="btn" data-ce="prev" ${i === 0 ? 'disabled' : ''}>${icon('chevL')} Corte anterior</button>
        <span class="u-f1 spacer"></span>
        <button class="btn" data-ce="cancel">Cancelar</button>
        <button class="btn primary" data-ce="ok">Aplicar</button>
        <button class="btn" data-ce="next" ${i === tl.length - 1 ? 'disabled' : ''}>Siguiente corte ${icon('chevR')}</button>
      </div>
    </div>`;
    let committed = false;   // Esc / × / Cancelar / fondo revierten el corte (onClose); Aplicar y navegar lo confirman
    openModal(ov, { label: 'Editar corte', initialFocus: '[data-ce="ok"]',
      onClose: () => { removeEventListener('keydown', ck); if (!committed) { s.a = a0; s.b = b0; renderAll(); } } });
    const v = ov.querySelector('video');
    const scrub = ov.querySelector('#ce-scrub');
    const D = f.duration_s || 1;
    const paint = () => {
      const L = (s.a / D) * 100, W = ((s.b - s.a) / D) * 100;
      ov.querySelector('#ce-sel').style.cssText = `left:${L}%;width:${W}%`;
      ov.querySelector('[data-ce="ha"]').style.left = `${L}%`;
      ov.querySelector('[data-ce="hb"]').style.left = `${L + W}%`;
      ov.querySelector('#ce-a').textContent = fmt.dur(s.a);
      ov.querySelector('#ce-b').textContent = fmt.dur(s.b);
      ov.querySelector('#ce-d').textContent = `${(s.b - s.a).toFixed(1)}s`;
    };
    paint();
    v.addEventListener('loadedmetadata', () => { v.currentTime = s.a; }, { once: true });
    // reproduce SOLO el tramo elegido, en bucle: así juzgas el corte, no el clip
    v.addEventListener('timeupdate', () => {
      if (v.currentTime >= s.b - 0.02 || v.currentTime < s.a - 0.3) v.currentTime = s.a;
      ov.querySelector('#ce-ph').style.left = `${(v.currentTime / D) * 100}%`;
    });
    v.play().catch(() => {});
    let drag = null;
    const tAt = clientX => {
      const r = scrub.getBoundingClientRect();
      return Math.max(0, Math.min(D, ((clientX - r.left) / r.width) * D));
    };
    scrub.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-ce="ha"],[data-ce="hb"]');
      drag = h ? h.dataset.ce : 'seek';
      try { scrub.setPointerCapture(e.pointerId); } catch {}
      if (drag === 'seek') { v.currentTime = tAt(e.clientX); return; }
    });
    scrub.addEventListener('pointermove', e => {
      if (!drag || drag === 'seek') return;
      const t = tAt(e.clientX);
      if (drag === 'ha') s.a = +Math.min(t, s.b - 0.4).toFixed(2);
      else s.b = +Math.max(t, s.a + 0.4).toFixed(2);
      v.currentTime = drag === 'ha' ? s.a : Math.max(s.a, s.b - 0.4);
      paint();
    });
    scrub.addEventListener('pointerup', () => { drag = null; });
    ov.addEventListener('click', e => {
      const j = e.target.closest('[data-jump]');
      if (j) {                       // centrar el tramo en el momento que marcó la AI
        const t = +j.dataset.jump, half = Math.max(0.6, (s.b - s.a) / 2);
        s.a = +Math.max(0, Math.min(t - half, D - 0.8)).toFixed(2);
        s.b = +Math.min(D, s.a + half * 2).toFixed(2);
        v.currentTime = s.a; paint();
        return;
      }
      const b = e.target.closest('[data-ce]');
      if (!b) return;
      const act = b.dataset.ce;
      if (act === 'close' || act === 'cancel') { ov.remove(); return; }
      if (act === 'ok') { commitUndo(); committed = true; ov.remove(); renderAll(); seek(offset(i)); toast('Corte actualizado'); return; }
      if (act === 'prev' || act === 'next') {
        commitUndo(); committed = true;
        const ni = i + (act === 'next' ? 1 : -1);
        ov.remove(); renderAll();
        if (tl[ni]) openClipEditor(ni);
      }
    });
    function ck(ev) {
      if (_modalStack[_modalStack.length - 1] !== ov) return;
      if (ev.key === 'Enter' && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
        commitUndo(); committed = true; ov.remove(); renderAll();
      }
    }
    addEventListener('keydown', ck);
  }

  track.addEventListener('dblclick', e => {
    const c = e.target.closest('.tl-clip');
    if (c) { e.preventDefault(); openClipEditor(+c.dataset.i); }
  });

  track.addEventListener('click', e => {
    const exp = e.target.closest('.tl-expand');
    if (exp) { e.stopPropagation(); openClipEditor(+exp.dataset.expand); return; }
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
  const exHome = exSheet.parentNode;
  let exClose = null;
  function openExSheet() {
    if (exClose) return;
    delete exSheet.remove;   // quita el ov.remove de una apertura anterior (openModal lo envuelve cada vez)
    exSheet.style.display = 'flex';
    updateExportUI();
    exClose = openModal(exSheet, { label: 'Exportar reel', initialFocus: '#ed-preset',
      onClose: () => {
        exClose = null;
        // la hoja es DOM fijo de la página (updateExportUI la consulta por id): vuelve a su sitio, oculta
        queueMicrotask(() => { exSheet.style.display = 'none'; delete exSheet.remove; exHome.appendChild(exSheet); });
      } });
    exSheet.querySelector('.ex-card').animate(
      [{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(.22,1.2,.36,1)' });
  }
  function closeExSheet() { exClose?.(); }
  document.getElementById('eb-open').addEventListener('click', openExSheet);
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
      replace: (replaceTarget && document.getElementById('ed-replace')?.checked)
        ? replaceTarget : undefined,
      vfit: edVfit,
      framing: +document.getElementById('ed-framing').value,
      texts: texts.length ? texts.map(t => ({ text: t.text, start: t.start, end: t.end, style: t.style })) : undefined,
      music: music ? { name: music.name, volume: music.volume, duck: music.duck,
                       fadeIn: music.fadeIn, fadeOut: music.fadeOut, startAt: music.startAt,
                       originalVolume: music.originalVolume } : undefined,
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
    if (r) {   // el reemplazo se consumió con este export: el siguiente no debe pisar el mismo reel
      replaceTarget = null;
      const rr = document.getElementById('ed-replace-row');
      if (rr) rr.style.display = 'none';
    }
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
      texts: JSON.parse(JSON.stringify(texts || [])),
      music: music ? { ...music } : null,
      globals: {
        aspect: G('ed-aspect').value, resolution: G('ed-res').value, preset: G('ed-preset').value,
        lut: G('ed-lut').value, trans: G('ed-trans').value, audio: G('ed-audio').value,
        fps: edFps, bitrate: G('ed-bitrate').value, vfit: edVfit,
        framing: G('ed-framing')?.value,
        title: G('ed-title').value, fade: G('ed-fade').checked,
      },
    };
  }
  // ---- AUTOGUARDADO: el timeline se perdía entero al recargar la pestaña ----
  // Guardar era manual, así que un F5 (o el bump de versión de la app) borraba el montaje.
  const AUTO_KEY = 'ab.studio.autosave';
  let autoT = null;
  function autosave() {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      try {
        if (!tl.length && !(texts || []).length) { localStorage.removeItem(AUTO_KEY); return; }
        localStorage.setItem(AUTO_KEY, JSON.stringify({ ...projectPayload(), ts: Date.now() }));
      } catch { /* almacenamiento lleno: el guardado manual sigue disponible */ }
    }, 700);
  }
  function restoreProject(p) {
    // descarta segmentos cuyo clip_id ya no existe (proyecto viejo / clip archivado / manipulado):
    // uno huérfano rompería byId[cid] en makeSeg/render y dejaría el editor inconsistente
    cancelSeek(); pause();
    resetProjectState();
    tl = (p.tl || []).filter(s => s && byId[s.clip_id]).map(s => ({ ...s, id: uid() }));   // ids frescos
    const g = p.globals || {};
    const set = (id, v, chk) => { const el = document.getElementById(id); if (el && v != null) { if (chk) el.checked = !!v; else el.value = v; } };
    set('ed-aspect', g.aspect); set('ed-res', g.resolution); set('ed-preset', g.preset);
    set('ed-lut', g.lut); set('ed-trans', g.trans); set('ed-audio', g.audio);
    set('ed-title', g.title); set('ed-fade', g.fade, true);
    set('ed-bitrate', g.bitrate); if (g.fps != null) edFps = g.fps;
    set('ed-framing', g.framing);
    if (g.vfit) { edVfit = g.vfit; try { syncVfit(); } catch {} }
    // texto y música también forman parte del proyecto
    texts = Array.isArray(p.texts) ? p.texts.map(t => ({ ...t, id: uid() })) : [];
    textSel = -1;
    if (p.music && p.music.name) {
      music = { ...p.music };
      syncMusicEl();
      try { musicChip(); } catch {}
    }
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
      </div>`).join('') : emptyState({ icon: 'folder', title: 'Sin proyectos guardados', help: 'Guarda un montaje desde el editor para reabrirlo aquí.' });
  }
  const projHome = projModal.parentNode;
  let projClose = null;
  function openProjModal() {
    if (projClose) return;
    delete projModal.remove;
    renderProjList();
    projModal.style.display = 'grid';
    projClose = openModal(projModal, { label: 'Proyectos guardados',
      onClose: () => {
        projClose = null;
        queueMicrotask(() => { projModal.style.display = 'none'; delete projModal.remove; projHome.appendChild(projModal); });
      } });
  }
  function closeProjModal() { projClose?.(); }
  document.getElementById('ed-open').addEventListener('click', openProjModal);
  projModal.addEventListener('click', e => {
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
  setTimeout(() => {
    // recupera el montaje si la pestaña se recargó (F5, cambio de versión de la app…)
    try {
      const raw = localStorage.getItem(AUTO_KEY);
      if (raw && !tl.length) {
        const p = JSON.parse(raw);
        const n = (p.tl || []).length;
        if (n) {
          restoreProject(p);
          const min = Math.round((Date.now() - (p.ts || Date.now())) / 60000);
          toast(`Recuperado tu montaje de hace ${min < 1 ? 'un momento' : min + ' min'}: `
            + `${n} corte${n === 1 ? '' : 's'}`);
        }
      }
    } catch { /* autosave corrupto: se ignora y se empieza limpio */ }
    renderAll(); fit();
  }, 30);

})();
