// flightverse/ui/menu.js — menú de vuelo (dock/FAB), paneles y sus manejadores (WS A).
// Marcado: dock, herramientas de vuelo izquierda (cámara/menú), gimbal, panel de
// imagen (grade), cine + director. Wiring: chips del dock, coordinador de
// overlays, paneles arrastrables, grade/presets, sonido, compartir, grabar.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { MODES } from '/flightverse/runtime.js?v=369';
import { makeDraggablePanel } from '/flightverse/panels.js?v=369';
import { createOverlayCoordinator } from '/flightverse/touch.js?v=369';
import { installGrade } from '/flightverse/ui/grade.js?v=369';

export const dockMarkup = () => `    <div class="vl-corner bl">
      <button class="vl-dockmin vl-solo-fino" id="vl-dockmin" title="Ocultar panel">«</button>
      <div class="vl-dock" id="vl-dock" role="dialog" aria-modal="false" aria-labelledby="vl-dock-title">
        <div class="vl-dock-head vl-panel-drag"><b id="vl-dock-title">MENÚ DE VUELO <small>ARRASTRAR</small></b><button id="vl-dock-close">Cerrar</button></div>
        <button class="vl-chip sec-nav" id="vl-mode"></button>
        <button class="vl-chip sec-nav" id="vl-rig" aria-label="Cambiar cámara"></button>
        <button class="vl-chip sec-juego vl-mobile-action" id="vl-armamento"
          aria-controls="vl-combat">Armamento</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-mundo" id="vl-vista">vista · 3D</button>
        <button class="vl-chip sec-mundo" id="vl-cielo">cielo · día</button>
        <button class="vl-chip sec-mundo" id="vl-calidad">calidad · auto</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-juego" id="vl-reto">Gate Rush</button>
        <button class="vl-chip sec-juego" id="vl-zombies">Modo Invasión</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-media" id="vl-sound">Sonido</button>
        <button class="vl-chip sec-media" id="vl-ajustes">Imagen</button>
        <button class="vl-rec sec-media" id="vl-rec">● Grabar</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-ayuda" id="vl-ayuda">Guía <kbd>H</kbd></button>
      </div>
    </div>
`;
export const toolsLeftMarkup = () => `    <div class="vl-flight-tools-left" id="vl-flight-tools-left" aria-label="Herramientas de vuelo">
      <button class="vl-camera-toggle" id="vl-camera-toggle"
        aria-label="Cambiar cámara" aria-controls="vl-camera-picker">
        <span>CAM</span><output>FPV</output>
      </button>
      <button class="vl-camera-picker-toggle" id="vl-camera-picker-toggle"
        aria-label="Elegir cámara" aria-controls="vl-camera-picker"
        aria-haspopup="listbox" aria-expanded="false"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 8L10 13.5 15.5 8"/></svg></button>
      <div class="vl-camera-picker" id="vl-camera-picker"
        role="listbox" aria-label="Seleccionar cámara" hidden>
        <button role="option" data-camera="muycerca">Muy cerca</button>
        <button role="option" data-camera="cerca">Cerca</button>
        <button role="option" data-camera="lejos">Lejos</button>
        <button role="option" data-camera="fpv">FPV</button>
        <button role="option" data-camera="top">Cenital</button>
        <button role="option" data-camera="orbit">Órbita</button>
        <button role="option" data-camera="lado">Lateral</button>
      </div>
      <button class="vl-fab" id="vl-fab" aria-label="Abrir menú de vuelo"
        aria-controls="vl-dock" aria-expanded="false">Menú</button>
    </div>
`;
export const gimbalToolsMarkup = () => `    <div class="vl-gimbal-tools" id="vl-gimbal-tools">
      <button class="vl-gimbal-toggle" id="vl-gimbal-toggle"
        aria-controls="vl-gimbal-tray" aria-expanded="false">
        <span>GIMBAL</span><output>-7°</output>
      </button>
      <div class="vl-gimbal-tray" id="vl-gimbal-tray" role="group"
        aria-label="Ajustar inclinación del gimbal" hidden>
        <label for="vl-gimbal-range">INCLINACIÓN <output id="vl-gimbal-value">-7°</output></label>
        <input type="range" id="vl-gimbal-range" min="-90" max="25" step="1" value="-7">
        <div>
          <button data-gimbal="-5" aria-label="Bajar gimbal cinco grados">−5°</button>
          <button data-gimbal-reset aria-label="Restablecer gimbal">0°</button>
          <button data-gimbal="5" aria-label="Subir gimbal cinco grados">+5°</button>
        </div>
      </div>
    </div>
`;
export const gradeMarkup = () => `    <div class="vl-grade" id="vl-grade">
      <div class="vl-grade-head vl-grade-drag"><span class="vl-grade-k">IMAGEN <small>ARRASTRAR</small></span>
        <div class="vl-grade-actions">
          <button class="vl-grade-expand" id="gr-expand" aria-expanded="false"
            aria-controls="vl-grade-body">Ajustes</button>
          <button class="vl-grade-x" id="gr-close" aria-label="cerrar"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg></button>
        </div>
      </div>
      <div class="vl-presets">
        <button data-pr="natural">Natural</button>
        <button data-pr="vivo">Vivo</button>
        <button data-pr="cine">Cine</button>
      </div>
      <div class="vl-grade-body" id="vl-grade-body">
        <label>Brillo Gaussian <output id="o-b">0.88</output><input type="range" id="gr-b" min="0.35" max="1.6" step="0.01" value="0.88"></label>
        <label>Brillo 3D <output id="o-t">1.00</output><input type="range" id="gr-t" min="0.3" max="2.2" step="0.01" value="1"></label>
        <label>Contraste <output id="o-c">0.06</output><input type="range" id="gr-c" min="-0.15" max="0.55" step="0.01" value="0.06"></label>
        <label>Saturación <output id="o-s">0.06</output><input type="range" id="gr-s" min="-1" max="1" step="0.01" value="0.06"></label>
        <label>Bloom <output id="o-g">0.25</output><input type="range" id="gr-g" min="0" max="2" step="0.02" value="0.25"></label>
        <label>Viñeta <output id="o-v">0.42</output><input type="range" id="gr-v" min="0" max="1" step="0.02" value="0.42"></label>
        <label>Tono <output id="o-h">0.00</output><input type="range" id="gr-h" min="-0.5" max="0.5" step="0.01" value="0"></label>
        <button id="gr-reset">Restablecer</button>
      </div>
    </div>
`;
/** goto + cine + director (paneles del tour/replay; su lógica vive en tour/*). */
export const panelsMarkup = () => `    <button class="vl-goto" id="vl-goto">Ir al inicio de la ruta »</button>
    <div class="vl-cine" id="vl-cine">
      <label>Velocidad<input type="range" id="cine-v" min="0.03" max="0.5" step="0.01" value="0.14"></label>
      <label>Ángulo<input type="range" id="cine-a" min="0.12" max="0.6" step="0.01" value="0.24"></label>
    </div>
    <div class="vl-director" id="vl-director">
      <div class="vl-dir-row">
        <button id="dir-key">+ Keyframe</button>
        <button id="dir-play">Vista previa</button>
        <button id="dir-rec">Grabar toma</button>
        <button id="dir-hd">Exportar 1080p</button>
        <button id="dir-exit">Salir</button>
      </div>
      <input type="range" id="dir-scrub" min="0" max="1" step="0.001" value="0">
      <div class="vl-dir-keys" id="dir-keys"></div>
    </div>
`;

const $ = s => document.querySelector(s);
// Ventana compacta con puntero fino (móvil emulado, ventana estrecha): el dock arranca plegado
const COMPACT_FINE = matchMedia('(pointer:fine) and (max-width:640px), (pointer:fine) and (max-height:520px)');

export function createMenu(ctx) {
  const { state: S, actions: A, bus, flags } = ctx;
  const gradePanel = $('#vl-grade');
  const recBtn = $('#vl-rec');
  let overlayCoordinator = null;
  let movable = null;

  /** Panel de imagen compacto en táctil (preferencia persistida). Se llama al montar. */
  function initGradePanel() {
    if (flags.coarse && localStorage.getItem('ab.fv.grade.expanded') !== '1') {
      gradePanel.classList.add('compact');
    }
  }

  const toggleSound = () => {
    const m = ctx.audio.toggleMute();
    $('#vl-sound').textContent = m ? 'Sonido off' : 'Sonido';
    $('#vl-sound').classList.toggle('off', m);
  };

  // ── Quick Record (WebM del canvas — camino instantáneo del Video Studio) ──
  const toggleRec = async () => {
    const recorder = ctx.tour.recorder;
    if (!recorder.supported) { recBtn.textContent = 'grabación no soportada'; return; }
    if (recorder.recording) {
      const blob = await recorder.stop();
      recBtn.classList.remove('on'); recBtn.textContent = '● Grabar';
      if (blob) recorder.download(blob, `volar_${ctx.CID}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
    } else if (recorder.start()) { recBtn.classList.add('on'); ctx.audio.rec(true); }
  };
  /** onError del recorder: restaura el botón y avisa. */
  function recorderFailed() {
    recBtn.classList.remove('on'); recBtn.textContent = '● Grabar';
    ctx.audio.rec?.(false);
    ctx.ui.screens.toast('La grabación se detuvo por un error. Prueba de nuevo.');
  }
  /** Etiqueta viva '■ REC Ns' mientras graba (por frame). */
  function tickRec() {
    const recorder = ctx.tour.recorder;
    if (recorder.recording) recBtn.textContent = `■ REC ${recorder.seconds.toFixed(0)}s`;
  }

  /** Cablea el menú. Requiere ctx.{sky,terrain,post,renderer,input,controls,fx,ui.weapons} ya instalados. */
  function install() {
    const { sky, terrain, post: fx, renderer, man } = ctx;
    const CIELO_LB = { dia: 'día', atardecer: 'atardecer', noche: 'noche' };
    $('#vl-cielo').addEventListener('click', () => {
      const preset = sky.cycle();
      ctx.syncLook();
      $('#vl-cielo').textContent = 'cielo · ' + CIELO_LB[preset];
      bus.emit('tod', { key: preset, elev: ctx.sky.elevation });
    });
    $('#vl-cielo').textContent = 'cielo · ' + (CIELO_LB[sky.preset] || 'día');
    $('#vl-mode').addEventListener('click', () => {
      // Arcade (autopiloto) solo existe con ruta real: sin ella setMode() volvía a 'Normal' y el ciclo
      // nunca llegaba a Cine ni a Dios. Se salta lo no disponible.
      const ks = Object.keys(MODES).filter(k => !MODES[k].autopilot || S.ghost);
      A.setMode(ks[(ks.indexOf(S.modeKey) + 1) % ks.length]);
    });
    $('#vl-rig').addEventListener('click', () => A.cycleRig());
    $('#vl-reto').addEventListener('click', () => A.startReto());   // sin dificultad → abre el selector
    $('#vl-ayuda').addEventListener('click', () => {
      overlayCoordinator.open('guide');
    });
    $('#vl-ajustes').addEventListener('click', e => {
      e.stopPropagation();
      const opening = overlayCoordinator.active() !== 'image';
      overlayCoordinator.toggle('image');
      if (opening) movable.image.clamp();
    });
    $('#gr-close').addEventListener('click', () => overlayCoordinator.close('image'));
    $('#gr-expand').addEventListener('click', e => {
      e.stopPropagation();
      const compact = gradePanel.classList.toggle('compact');
      $('#gr-expand').setAttribute('aria-expanded', String(!compact));
      localStorage.setItem('ab.fv.grade.expanded', compact ? '0' : '1');
      if (!compact) movable.image.clamp();
    });
    const mobileSheets = {
      menu: { panel: $('#vl-dock'), trigger: $('#vl-fab') },
      combat: { panel: $('#vl-combat'), trigger: $('#vl-armamento') },
    };
    movable = {
      menu: makeDraggablePanel($('#vl-dock'), $('#vl-dock .vl-panel-drag'), 'ab.fv.panel.menu'),
      combat: makeDraggablePanel($('#vl-combat'), $('#vl-combat .vl-panel-drag'), 'ab.fv.panel.combat'),
      image: makeDraggablePanel($('#vl-grade'), $('#vl-grade .vl-grade-drag'), 'ab.fv.panel.image'),
    };
    const touchUi = matchMedia('(pointer:coarse)').matches;
    overlayCoordinator = createOverlayCoordinator({
      eventRoot: document,
      scrim: touchUi ? $('#vl-overlay-scrim') : null,
      inertTargets: [
        renderer.domElement,
        $('#vl-command-hud'),
        $('#vl-flight-tools-left'),
        $('#vl-gimbal-tools'),
      ],
      overlays: {
        ...(touchUi ? {
          menu: { ...mobileSheets.menu, openClass: 'open' },
          combat: { ...mobileSheets.combat, openClass: 'open' },
        } : {}),
        image: { panel: gradePanel, trigger: $('#vl-ajustes'), openClass: 'show' },
        guide: { panel: $('#vl-guide'), trigger: $('#vl-ayuda'), openClass: 'show' },
        invasion: { panel: $('#vl-inv'), trigger: $('#vl-zombies'), openClass: 'show' },
        difficulty: { panel: $('#vl-diff'), trigger: $('#vl-reto'), openClass: 'show' },
        result: { panel: $('#vl-result'), openClass: 'show' },
        director: { panel: $('#vl-director'), openClass: 'show', dismissible: false },
      },
      onChange: active => {
        if (active) {
          ctx.ui.weapons.picker.close('overlay');
          ctx.controls.flightTools.closeAll('overlay');
          ctx.controls.firePointers.cancel('overlay');
          A.releaseFiring();
        }
        ctx.input.setEnabled(!active);
        document.body.classList.toggle('vl-overlay-open', !!active);
        document.body.dataset.vlOverlay = active || '';
        document.body.classList.toggle('vl-mobile-sheet-open', active === 'menu' || active === 'combat');
        ctx.controls.sticks?.setEnabled(!active);
        if (active && (active === 'image' || !touchUi) && movable[active]) movable[active].clamp();
        bus.emit('pause', { active: !!active, overlay: active || null });
      },
    });
    ctx.ui.overlay = overlayCoordinator;
    if (!touchUi) {
      for (const sheet of Object.values(mobileSheets)) sheet.panel.setAttribute('aria-hidden', 'false');
    }
    $('#vl-fab').addEventListener('click', () => overlayCoordinator.toggle('menu'));
    $('#vl-armamento').addEventListener('click', () => {
      if (touchUi) overlayCoordinator.toggle('combat');
    });
    $('#vl-dock-close').addEventListener('click', () => overlayCoordinator.close('menu'));
    $('#vl-combat-close').addEventListener('click', () => overlayCoordinator.close('combat'));
    const syncDockMin = () => {
      const min = $('#vl-dock').classList.contains('min');
      $('#vl-dockmin').textContent = COMPACT_FINE.matches ? (min ? 'Menú' : 'Cerrar') : (min ? '»' : '«');
      $('#vl-dockmin').setAttribute('aria-expanded', String(!min));
      $('#vl-dockmin').title = min ? 'Mostrar panel' : 'Ocultar panel';
    };
    // compacto: dock plegado por defecto; se abre como hoja inferior con el botón Menú
    if (COMPACT_FINE.matches && !touchUi) $('#vl-dock').classList.add('min');
    syncDockMin();
    COMPACT_FINE.addEventListener?.('change', () => {
      if (!touchUi) $('#vl-dock').classList.toggle('min', COMPACT_FINE.matches);
      syncDockMin();
    });
    $('#vl-dockmin').addEventListener('click', () => {
      $('#vl-dock').classList.toggle('min');
      syncDockMin();
    });
    $('#vl-dock').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      b.classList.remove('zap'); void b.offsetWidth; b.classList.add('zap');
    });

    // ── grade (imagen): sliders + presets, persistido (ui/grade.js) ──
    installGrade(ctx, {
      inputRoot: document.getElementById('vl-grade'),
      presetsRoot: document.querySelector('.vl-presets'),
      resetBtn: $('#gr-reset'),
    });

    $('#vl-sound').addEventListener('pointerdown', e => {
      e.preventDefault();
      toggleSound();
    });
    $('#vl-share').addEventListener('click', async () => {
      const url = `${location.origin}/volar.html?m=${encodeURIComponent(ctx.CID)}`;
      try {
        if (navigator.share) await navigator.share({ title: `Vuela ${man.name} — AeroBrain`, url });
        else { await navigator.clipboard.writeText(url); $('#vl-share').textContent = 'Copiado'; setTimeout(() => { $('#vl-share').textContent = 'Compartir'; }, 1600); }
      } catch { /* usuario canceló */ }
    });

    // chips que despachan a acciones del mundo/juego (definidas en volar.js / módulos)
    $('#vl-vista').addEventListener('click', () => A.cycleVista());
    $('#vl-calidad').addEventListener('click', () => A.cycleCalidad());
    $('#vl-zombies').addEventListener('click', () => ctx.enemies.onButton());
    recBtn.addEventListener('click', toggleRec);

    Object.assign(A, { toggleSound, toggleRec });
  }

  return {
    install, initGradePanel, toggleSound, toggleRec, recorderFailed, tickRec,
    get movable() { return movable; },
    dispose() { overlayCoordinator?.dispose(); },
  };
}
