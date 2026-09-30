// flightverse/ui/menu2.js — menús del HUD v2 (WS A, ?fv=2): hoja de PAUSA (Reanudar · Cámara · Vista · Imagen ·
// Sonido · Controles · Foto · Grabar · Salir, subpáginas con flecha atrás) y selector de MODO (4 tarjetas:
// Explorar / Tour / Gate Rush / Invasión). Reusa el coordinador de overlays de touch.js (inert + foco atrapado +
// Esc) y las mismas acciones (ctx.actions) que el menú legado; NO hay ciclo de modos: cada modo se elige.
import { MODES, RIGS } from '/flightverse/runtime.js?v=368';
import { createOverlayCoordinator } from '/flightverse/touch.js?v=368';
import { installGrade } from '/flightverse/ui/grade.js?v=368';
import { ICON } from '/flightverse/ui/icons2.js?v=368';

const s24 = b => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const MODE_ICON = {
  explorar: s24('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  tour: s24('<path d="M5 19c0-5 5-3 7-7s-3-6 2-8"/><circle cx="5" cy="19" r="1.6"/><circle cx="16" cy="4" r="1.6"/>'),
  gaterush: s24('<ellipse cx="12" cy="12" rx="5" ry="8.5"/><path d="M12 3.5v17"/>'),
  invasion: s24('<path d="M12 3l7.5 3v5.5c0 4.5-3 7.5-7.5 9.5-4.5-2-7.5-5-7.5-9.5V6z"/>'),
};
const ROW_ICON = {
  cam: s24('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.3"/>'),
};
const DIFF = [['facil', 'Fácil'], ['media', 'Media'], ['dificil', 'Difícil']];
const RIG_DESC = { muycerca: 'Sobre el dron', cerca: 'Seguimiento cercano', lejos: 'Seguimiento amplio', fpv: 'Vista del piloto', top: 'Desde arriba', orbit: 'Órbita automática', lado: 'Perfil lateral' };

export const hudMenuMarkup = () => `    <div class="hx-scrim-ov" id="vl-overlay-scrim" aria-hidden="true"></div>
    <section class="hx-sheet" id="hx-psheet" aria-labelledby="hx-pause-title">${pauseMarkup(matchMedia('(pointer:coarse)').matches)}</section>
    <section class="hx-sheet hx-modes" id="hx-modes" aria-labelledby="hx-modes-title"></section>
`.replace('', '');


/** Contenido de «Cómo jugar» (táctil o teclado). Lo reusa la hoja de la tecla H (screens2.js). */
export function guideBody(touch) {
  return touch ? `
      <ol class="hx-steps">
        <li><b>Volar</b><span>Arrastra con el pulgar izquierdo para moverte; con el derecho para mirar.</span></li>
        <li><b>Disparar</b><span>Botón grande a la derecha. Toca el chip de arma para cambiar; mantén para ver las seis.</span></li>
        <li><b>Modos y cámaras</b><span>Pausa &gt; Modo de juego y Cámara. Toca la brújula para cambiar de cámara.</span></li>
        <li><b>Vistas</b><span>3D = malla del terreno · foto-real = fotografías reconstruidas · malla = 3D fotogramétrico.</span></li>
      </ol>` : `
      <ol class="hx-steps">
        <li><b>Volar</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> mover · <kbd>R</kbd><kbd>F</kbd> subir/bajar · <kbd>Q</kbd><kbd>E</kbd> girar · <kbd>Shift</kbd> turbo · <kbd>Espacio</kbd> freno</span></li>
        <li><b>Armas</b><span><kbd>1</kbd>–<kbd>6</kbd> elegir · <kbd>X</kbd> o clic disparar · <kbd>Tab</kbd> última arma</span></li>
        <li><b>Cámara</b><span><kbd>C</kbd> cambiar · rueda: inclinar gimbal · clic captura el mouse, <kbd>Esc</kbd> lo suelta y pausa</span></li>
        <li><b>Juego</b><span><kbd>T</kbd> Gate Rush · <kbd>P</kbd> vista · <kbd>V</kbd> grabar · <kbd>M</kbd> sonido · <kbd>Esc</kbd> pausa</span></li>
      </ol>`;
}


/** Esqueleto COMPLETO de la hoja de pausa. Debe existir desde mountUi: installControls (C) busca #vl-camera-picker / #vl-gimbal-* antes de installUi. */
export function pauseMarkup(touch) {
  const camCards = RIGS.map((r, i) => `<button type="button" role="option" class="hx-card-i" data-camera="${r.key}" data-ix="${i}" aria-selected="false"><b>${r.label}</b><small>${RIG_DESC[r.key] || ''}</small></button>`).join('');
  const extra = `<button type="button" role="option" class="hx-card-i" data-fmode="cinematico" aria-selected="false"><b>Cinemático</b><small>Cámara automática</small></button>
      <button type="button" role="option" class="hx-card-i" data-fmode="dios" aria-selected="false"><b>Dios</b><small>Vuelo libre sin colisión</small></button>`;
  return `
      <div class="hx-sheet-card">
        <header class="hx-sh">
          <button type="button" class="hx-ibtn sm" id="hx-back-pg" aria-label="Atrás" hidden>${ICON.back}</button>
          <div class="hx-sh-t"><h2 id="hx-pause-title">Pausa</h2><small class="hx-scene-slot"></small></div>
          <button type="button" class="hx-ibtn sm" id="hx-pause-x" aria-label="Cerrar">${ICON.close}</button>
        </header>
        <div class="hx-pages">
          <div class="hx-page" data-page="root">
            <button type="button" class="hx-btn primary" id="hx-resume">Reanudar</button>
            <div class="hx-list">
              ${row('modes', 'Modo de juego', '')}
              ${row('cam', 'Cámara', '')}
              ${row('vista', 'Vista', '')}
              ${row('img', 'Imagen', '')}
              ${row('snd', 'Sonido', '')}
              ${row('ctl', 'Controles', '')}
              ${row('photo', 'Foto', '')}
              <button type="button" class="hx-row" id="hx-rec-row"><span class="hx-row-l">Grabar</span><span class="hx-row-v" id="hx-rec-v">Detenida</span></button>
              ${row('guide', 'Cómo jugar', '')}
              <a class="hx-row" href="mundo.html"><span class="hx-row-l">Salir al Mundo</span></a>
            </div>
          </div>
          <div class="hx-page" data-page="cam" hidden>
            <div class="hx-cards" id="vl-camera-picker" role="listbox" aria-label="Seleccionar cámara" data-embedded>${camCards}${extra}</div>
            <div class="hx-group" id="vl-gimbal-tray" role="group" aria-label="Ajustar inclinación del gimbal" data-embedded>
              <label class="hx-sld"><span>Inclinación del gimbal <output id="vl-gimbal-value">-7°</output></span>
                <input type="range" id="vl-gimbal-range" min="-90" max="25" step="1" value="-7"></label>
              <div class="hx-btnrow">
                <button type="button" class="hx-btn" data-gimbal="-5" aria-label="Bajar gimbal cinco grados">−5°</button>
                <button type="button" class="hx-btn" data-gimbal-reset aria-label="Restablecer gimbal">0°</button>
                <button type="button" class="hx-btn" data-gimbal="5" aria-label="Subir gimbal cinco grados">+5°</button>
              </div>
              <p class="hx-note" id="hx-gimbal-note">El gimbal solo actúa en la cámara FPV.</p>
            </div>
          </div>
          <div class="hx-page" data-page="vista" hidden>
            <h3 class="hx-h">Vista</h3>
            <div id="hx-vista-seg">${seg('data-vista', [['terrain', 'Terreno'], ['mesh', 'Malla 3D'], ['splat', 'Foto-real']], 'splat', 'Vista')}</div>
            <p class="hx-note" id="hx-vista-note"></p>
            <h3 class="hx-h">Hora del día</h3>
            <div id="hx-tod-seg"></div>
            <h3 class="hx-h">Calidad</h3>
            <button type="button" class="hx-row" id="hx-calidad-row"><span class="hx-row-l">Calidad de imagen</span><span class="hx-row-v" id="hx-calidad-v">auto</span></button>
          </div>
          <div class="hx-page" data-page="img" hidden>
            <div class="hx-chips vl-presets" id="hx-presets">
              <button type="button" class="hx-chip" data-pr="natural">Natural</button>
              <button type="button" class="hx-chip" data-pr="vivo">Vivo</button>
              <button type="button" class="hx-chip" data-pr="cine">Cine</button>
            </div>
            <div id="hx-grade">
              <label class="hx-sld"><span>Brillo de foto-real <output id="o-b">0.88</output></span><input type="range" id="gr-b" min="0.35" max="1.6" step="0.01" value="0.88"></label>
              <label class="hx-sld"><span>Brillo 3D <output id="o-t">1.00</output></span><input type="range" id="gr-t" min="0.3" max="2.2" step="0.01" value="1"></label>
              <details class="hx-adv"><summary>Ajustes avanzados</summary>
                <label class="hx-sld"><span>Contraste <output id="o-c">0.06</output></span><input type="range" id="gr-c" min="-0.15" max="0.55" step="0.01" value="0.06"></label>
                <label class="hx-sld"><span>Saturación <output id="o-s">0.06</output></span><input type="range" id="gr-s" min="-1" max="1" step="0.01" value="0.06"></label>
                <label class="hx-sld"><span>Bloom <output id="o-g">0.25</output></span><input type="range" id="gr-g" min="0" max="2" step="0.02" value="0.25"></label>
                <label class="hx-sld"><span>Viñeta <output id="o-v">0.42</output></span><input type="range" id="gr-v" min="0" max="1" step="0.02" value="0.42"></label>
                <label class="hx-sld"><span>Tono <output id="o-h">0.00</output></span><input type="range" id="gr-h" min="-0.5" max="0.5" step="0.01" value="0"></label>
              </details>
              <button type="button" class="hx-btn" id="gr-reset">Restablecer imagen</button>
            </div>
          </div>
          <div class="hx-page" data-page="snd" hidden>
            ${toggle('soundOn', 'Sonido', 'Motor, armas y efectos')}
            ${slider('volMaster', 'Maestro', 0, 1, 0.05)}
            ${slider('volSfx', 'Efectos', 0, 1, 0.05)}
            ${slider('volMusic', 'Música', 0, 1, 0.05)}
            ${toggle('vibration', 'Vibración', 'Respuesta háptica al disparar y al recibir daño')}
            <p class="hx-note">Los controles de volumen se aplican cuando el motor de audio los admite.</p>
          </div>
          <div class="hx-page" data-page="ctl" hidden>
            <h3 class="hx-h">Mirar y volar</h3>
            ${slider('lookSens', 'Sensibilidad', 0.5, 2, 0.05)}
            ${slider('expo', 'Curva de palancas', 0, 0.6, 0.05)}
            ${toggle('invertY', 'Invertir eje Y')}
            ${toggle('leftHanded', 'Modo zurdo', 'Intercambia palancas y botones')}
            ${toggle('rcMode2', 'RC Modo 2', 'Izquierda: acelerador y guiñada')}
            ${toggle('autoFire', 'Disparo automático', 'Dispara al retículo mientras tocas la zona de mirar')}
            ${toggle('holdBoost', 'Turbo: mantener', 'Apagado = alternar')}
            ${toggle('holdFire', 'Fuego: mantener', 'Apagado = alternar')}
            <h3 class="hx-h">Viento</h3>
            ${seg('data-pref-seg="windPreset" data-v', [['calmo', 'Calmo'], ['brisa', 'Brisa'], ['racheado', 'Racheado']], 'brisa', 'Viento')}
            <h3 class="hx-h">Accesibilidad</h3>
            <p class="hx-lab">Tamaño de texto</p>
            ${seg('data-pref-seg="textScale" data-v', [[100, '100 %'], [115, '115 %'], [130, '130 %']], 100, 'Tamaño de texto')}
            <p class="hx-lab">Reducir movimiento</p>
            ${seg('data-pref-seg="reducedMotion" data-v', [['auto', 'Sistema'], ['on', 'Sí'], ['off', 'No']], 'auto', 'Reducir movimiento')}
          </div>
          <div class="hx-page" data-page="photo" hidden>
            <p class="hx-note" id="hx-photo-note">El modo foto permite cámara libre, distancia focal, hora del día y guardar en PNG.</p>
            <button type="button" class="hx-btn primary" id="hx-photo-go">Abrir modo foto</button>
          </div>
          <div class="hx-page" data-page="guide" hidden>${guideBody(touch)}</div>
        </div>
      </div>`;
}

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const seg = (attr, opts, value, label) => `<div class="hx-seg" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, t]) => `<button type="button" role="radio" ${attr}="${v}" aria-checked="${String(v) === String(value)}">${t}</button>`).join('')}</div>`;
const row = (id, label, value = '', extra = '') => `<button type="button" class="hx-row" data-go="${id}" ${extra}><span class="hx-row-l">${label}</span><span class="hx-row-v" data-val="${id}">${value}</span>${ICON.chev}</button>`;
const toggle = (key, label, hint = '') => `<label class="hx-tog"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-pref="${key}" role="switch"><i aria-hidden="true"></i></label>`;
const slider = (key, label, min, max, step, id) => `<label class="hx-sld"><span>${label}<output data-out="${key}"></output></span><input type="range" ${id ? `id="${id}"` : ''} data-pref="${key}" min="${min}" max="${max}" step="${step}"></label>`;

export function createMenu2(ctx) {
  const { state: S, actions: A, bus, flags } = ctx;
  const pause = $('#hx-psheet'), modes = $('#hx-modes');
  const prefs = ctx.ui.prefs;
  let overlayCoordinator = null;
  let page = 'root';
  const pages = {};
  const PAGE_TITLE = { root: 'Pausa', cam: 'Cámara', vista: 'Vista', img: 'Imagen', snd: 'Sonido', ctl: 'Controles', photo: 'Foto', guide: 'Cómo jugar' };

  // ── construcción ──────────────────────────────────────────────────────────
  function buildPause() {
    pause.setAttribute('role', 'dialog');
    pause.querySelector('.hx-scene-slot').replaceWith($('#vl-scene'));   // volar.js escribe aquí el estado de carga
    for (const k of ['cam', 'vista', 'img', 'snd', 'ctl', 'photo', 'guide']) pages[k] = pause.querySelector(`[data-page="${k}"]`);
    pages.root = pause.querySelector('[data-page="root"]');
  }

  function buildModes() {
    modes.setAttribute('role', 'dialog');
    const ghostOn = ctx.enemies?.gaterush?.ghostEnabled;
    modes.innerHTML = `
      <div class="hx-sheet-card wide">
        <header class="hx-sh">
          <div class="hx-sh-t"><h2 id="hx-modes-title">Elige cómo volar</h2><small>Bogotá, tal como es</small></div>
          <button type="button" class="hx-ibtn sm" id="hx-modes-x" aria-label="Cerrar">${ICON.close}</button>
        </header>
        <div class="hx-mcards">
          <article class="hx-mcard" data-card="explorar">
            <button type="button" class="hx-mcard-hit" data-mode="explorar" aria-label="Explorar. Recorre Bogotá a tu ritmo">${MODE_ICON.explorar}<span><b>Explorar</b><small>Recorre Bogotá a tu ritmo</small></span></button>
            <div class="hx-mcard-chips" role="group" aria-label="Variante de Explorar">
              <button type="button" class="hx-chip" data-explore="asistido" aria-pressed="true">Normal</button>
              ${ctx.actions.setProfile ? '<button type="button" class="hx-chip" data-explore="cine" aria-pressed="false">Cine</button>' : ''}
              <button type="button" class="hx-chip" data-explore="dios" aria-pressed="false">Sin colisión</button>
            </div>
          </article>
          <article class="hx-mcard" data-card="tour">
            <button type="button" class="hx-mcard-hit" data-mode="tour" aria-label="Tour. Un recorrido guiado">${MODE_ICON.tour}<span><b>Tour</b><small>Un recorrido guiado</small></span></button>
          </article>
          <article class="hx-mcard" data-card="gaterush">
            <button type="button" class="hx-mcard-hit" data-mode="gaterush" aria-label="Gate Rush. Aros sobre tu ruta real">${MODE_ICON.gaterush}<span><b>Gate Rush</b><small>Aros sobre tu ruta real</small></span></button>
            <div class="hx-mcard-chips" role="group" aria-label="Dificultad de Gate Rush">
              ${DIFF.map(([k, t]) => `<button type="button" class="hx-chip" data-gr="${k}">${t}</button>`).join('')}
              ${ctx.enemies?.gaterush?.setGhostEnabled ? `<button type="button" class="hx-chip" data-ghost aria-pressed="${!!ghostOn}">Fantasma</button>` : ''}
            </div>
          </article>
          <article class="hx-mcard" data-card="invasion">
            <button type="button" class="hx-mcard-hit" data-mode="invasion" aria-label="Invasión. Defiende la ciudad">${MODE_ICON.invasion}<span><b>Invasión</b><small>Defiende la ciudad</small></span></button>
            <div class="hx-mcard-chips" role="group" aria-label="Dificultad de Invasión">
              ${DIFF.map(([k, t]) => `<button type="button" class="hx-chip" data-inv="${k}">${t}</button>`).join('')}
            </div>
          </article>
        </div>
      </div>`;
  }

  // ── estado de las páginas ─────────────────────────────────────────────────
  const rigIndex = () => ctx.controls.camera?.rigIx ?? 0;
  const vistaNow = () => ctx.report.representation?.requested || 'terrain';
  const VISTA_LB = { terrain: 'Terreno', mesh: 'Malla 3D', splat: 'Foto-real' };
  const MODE_LB = () => {
    if (S.reto) return 'Gate Rush';
    if (ctx.enemies?.invasion?.state.on) return 'Invasión';
    return S.modeKey === 'dios' ? 'Explorar · sin colisión' : S.modeKey === 'cinematico' ? 'Tour' : 'Explorar';
  };
  function syncRoot() {
    const set = (k, v) => { const n = pause.querySelector(`[data-val="${k}"]`); if (n) n.textContent = v; };
    set('modes', MODE_LB());
    set('cam', RIGS[rigIndex()]?.label || '');
    set('vista', VISTA_LB[vistaNow()] || '');
    set('img', '');
    set('snd', ctx.audio?.armed ? '' : 'Sin activar');
    const rec = ctx.tour.recorder;
    $('#hx-rec-v').textContent = rec?.recording ? `Grabando ${Math.floor(rec.seconds || 0)} s` : rec?.supported === false ? 'No disponible' : 'Detenida';
    $('#hx-rec-row').classList.toggle('on', !!rec?.recording);
    const photoOk = !!(A.enterPhoto || ctx.tour.photo?.enter);
    const pr = pause.querySelector('[data-go="photo"]'); pr.disabled = !photoOk; set('photo', photoOk ? '' : 'Próximamente');
  }
  function syncCam() {
    const cur = rigIndex();
    for (const b of pause.querySelectorAll('[data-camera]')) b.setAttribute('aria-selected', String(+b.dataset.ix === cur && S.modeKey !== 'dios' && S.modeKey !== 'cinematico'));
    for (const b of pause.querySelectorAll('[data-fmode]')) b.setAttribute('aria-selected', String(b.dataset.fmode === S.modeKey));
    const fpv = !!RIGS[cur]?.hideDrone;
    $('#vl-gimbal-tray').classList.toggle('dim', !fpv);
    $('#vl-gimbal-tray').querySelectorAll('input,button').forEach(n => { n.disabled = !fpv; });
  }
  function syncVista() {
    const cur = vistaNow(), act = ctx.report.representation?.active;
    for (const b of pause.querySelectorAll('[data-vista]')) b.setAttribute('aria-checked', String(b.dataset.vista === cur));
    const mm = ctx.report.visualMeshState;
    $('#hx-vista-note').textContent = cur !== act ? `Mostrando ${VISTA_LB[act]}: ${ctx.report.representation?.fallbackReason || 'la capa aún carga'}.`
      : cur === 'mesh' && mm === 'loading' ? 'Cargando malla fotogramétrica…' : '';
    const keys = ctx.sky.v2 ? ['dia', 'dorada', 'atardecer', 'noche'] : ['dia', 'atardecer', 'noche'];
    const LB = { dia: 'Día', dorada: 'Dorada', atardecer: 'Atardecer', noche: 'Noche' };
    $('#hx-tod-seg').innerHTML = seg('data-tod', keys.map(k => [k, LB[k]]), ctx.sky.preset, 'Hora del día');
    $('#hx-calidad-v').textContent = ctx.report.calidad?.k || 'auto';
  }
  function syncPrefs() {
    for (const n of pause.querySelectorAll('[data-pref]')) {
      const k = n.dataset.pref;
      if (k === 'soundOn') { n.checked = !soundMuted(); continue; }
      if (n.type === 'checkbox') n.checked = !!prefs.get(k);
      else { n.value = prefs.get(k); const o = pause.querySelector(`[data-out="${k}"]`); if (o) o.textContent = fmtPref(k, prefs.get(k)); }
    }
    for (const g of pause.querySelectorAll('[data-pref-seg]')) {
      const k = g.dataset.prefSeg;
      g.setAttribute('aria-checked', String(String(g.dataset.v) === String(prefs.get(k))));
    }
  }
  const fmtPref = (k, v) => (k.startsWith('vol') ? `${Math.round(v * 100)} %` : k === 'lookSens' ? `×${(+v).toFixed(2)}` : (+v).toFixed(2));
  let muted = false;
  const soundMuted = () => muted;

  function go(target) {
    const back = target !== 'root';
    page = target;
    for (const [k, p] of Object.entries(pages)) p.hidden = k !== target;
    $('#hx-pause-title').textContent = PAGE_TITLE[target] || 'Pausa';
    $('#hx-back-pg').hidden = !back;
    if (target === 'root') syncRoot();
    if (target === 'cam') syncCam();
    if (target === 'vista') syncVista();
    if (target === 'snd' || target === 'ctl') syncPrefs();
    if (target === 'photo') $('#hx-photo-go').disabled = !(A.enterPhoto || ctx.tour.photo?.enter);
    pause.querySelector('.hx-pages').scrollTop = 0;
    const first = pages[target].querySelector('button:not([disabled]),input:not([disabled]),a');
    first?.focus({ preventScroll: true });
  }

  // ── acciones de modo ──────────────────────────────────────────────────────
  const close = () => overlayCoordinator.close();
  const stopOthers = () => {
    if (ctx.enemies?.invasion?.state.on) ctx.enemies.onButton();           // apaga Invasión
    if (S.reto) { S.reto.dispose?.(); S.reto = null; S.retoFly = null; S.resultShown = false; ctx.ui.screens.clearResult(); }
  };
  function startMode(kind, opt) {
    if (kind === 'explorar') {
      stopOthers();
      const k = opt === 'dios' ? 'dios' : 'asistido';
      A.setMode(k);
      if (opt === 'cine') A.setProfile?.('cine'); else if (k === 'asistido') A.setProfile?.('normal');
      close();
    } else if (kind === 'tour') {
      stopOthers();
      if (A.startTour) A.startTour(); else if (ctx.tour.startTour) ctx.tour.startTour(); else A.setMode('cinematico');
      close();
    } else if (kind === 'gaterush') {
      const d = opt || localStorage.getItem('ab.fv.gr.diff') || 'media';
      close(); A.startReto(d);
    } else if (kind === 'invasion') {
      if (ctx.enemies?.invasion?.state.on) { close(); return; }
      if (opt) { close(); ctx.enemies.startFromPicker(pickerTypes(), opt); }
      else overlayCoordinator.open('invasion');
    }
  }
  const pickerTypes = () => {
    const sel = [...document.querySelectorAll('#vl-inv button[data-e].sel')].map(b => b.dataset.e);
    return sel.length ? sel : ['zombie'];
  };
  function syncModes() {
    const cur = S.reto ? 'gaterush' : ctx.enemies?.invasion?.state.on ? 'invasion' : S.modeKey === 'cinematico' ? 'tour' : 'explorar';
    for (const c of modes.querySelectorAll('.hx-mcard')) c.classList.toggle('sel', c.dataset.card === cur);
    for (const b of modes.querySelectorAll('[data-explore]')) b.setAttribute('aria-pressed', String(b.dataset.explore === (S.modeKey === 'dios' ? 'dios' : 'asistido')));
    const last = localStorage.getItem('ab.fv.gr.diff') || 'media';
    for (const b of modes.querySelectorAll('[data-gr]')) b.classList.toggle('last', b.dataset.gr === last);
    for (const b of modes.querySelectorAll('[data-inv]')) b.classList.toggle('last', b.dataset.inv === (ctx.enemies?.invasion?.state.difficulty || 'media'));
  }

  // ── cableado ──────────────────────────────────────────────────────────────
  function install(extraOverlays) {
    const { renderer } = ctx;
    buildPause(); buildModes();
    installGrade(ctx, { inputRoot: $('#hx-grade'), presetsRoot: $('#hx-presets'), resetBtn: $('#gr-reset') });
    const touchUi = flags.coarse;
    overlayCoordinator = createOverlayCoordinator({
      eventRoot: document,
      scrim: $('#vl-overlay-scrim'),
      inertTargets: [renderer.domElement, $('#hx-actions'), $('#hx-wstrip'), $('#hx-left'), document.querySelector('.hx-top'), $('.hx-tape.l'), $('.hx-tape.r')],
      overlays: {
        menu: { panel: pause, trigger: $('#hx-pause'), openClass: 'open', initialFocus: '#hx-resume' },
        modes: { panel: modes, openClass: 'open', initialFocus: modes },
        ...extraOverlays,
      },
      onChange: active => {
        if (active) {
          ctx.ui.weapons.picker?.close('overlay');
          ctx.controls.flightTools?.closeAll('overlay');
          ctx.controls.firePointers.cancel('overlay');
          A.releaseFiring();
          if (active === 'menu') go('root'); else if (active === 'modes') syncModes();
          try { document.exitPointerLock?.(); } catch { /* sin lock */ }
        }
        ctx.input.setEnabled(!active);
        document.body.classList.toggle('vl-overlay-open', !!active);
        document.body.dataset.vlOverlay = active || '';
        ctx.controls.sticks?.setEnabled(!active);
        $('#hx-pause').setAttribute('aria-expanded', String(active === 'menu'));
        bus.emit('pause', { active: !!active, overlay: active || null });
      },
    });
    ctx.ui.overlay = overlayCoordinator;
    void touchUi;

    $('#hx-pause').addEventListener('click', () => overlayCoordinator.toggle('menu'));
    $('#hx-pause-x').addEventListener('click', close);
    $('#hx-modes-x').addEventListener('click', close);
    $('#hx-resume').addEventListener('click', close);
    $('#hx-back-pg').addEventListener('click', () => go('root'));
    pause.addEventListener('keydown', e => { if (e.key === 'Escape' && page !== 'root') { e.stopPropagation(); e.preventDefault(); go('root'); } });
    pause.addEventListener('click', e => {
      const t = e.target;
      const nav = t.closest('[data-go]');
      if (nav && !nav.disabled) {
        if (nav.dataset.go === 'modes') overlayCoordinator.open('modes'); else go(nav.dataset.go);
        return;
      }
      const cam = t.closest('[data-camera]');
      if (cam) { A.setRig(+cam.dataset.ix); if (S.modeKey === 'dios' || S.modeKey === 'cinematico') A.setMode('asistido'); syncCam(); return; }
      const fm = t.closest('[data-fmode]');
      if (fm) { A.setMode(fm.dataset.fmode); close(); return; }
      const v = t.closest('[data-vista]');
      if (v) {
        for (let i = 0; i < 3 && vistaNow() !== v.dataset.vista; i++) A.cycleVista();
        setTimeout(syncVista, 50); syncVista(); return;
      }
      const tod = t.closest('[data-tod]');
      if (tod) { ctx.sky.setPreset(tod.dataset.tod); ctx.syncLook(); bus.emit('tod', { key: tod.dataset.tod }); syncVista(); return; }
      if (t.closest('#hx-calidad-row')) { A.cycleCalidad(); setTimeout(syncVista, 30); return; }
      if (t.closest('#hx-rec-row')) { A.toggleRec(); setTimeout(syncRoot, 60); return; }
      const sg = t.closest('[data-pref-seg]');
      if (sg) { prefs.set(sg.dataset.prefSeg, sg.dataset.v); syncPrefs(); return; }
      if (t.closest('#hx-photo-go')) { close(); (A.enterPhoto || ctx.tour.photo?.enter)?.(); }
    });
    pause.addEventListener('input', e => {
      const n = e.target.closest('[data-pref]'); if (!n) return;
      const k = n.dataset.pref;
      if (k === 'soundOn') return;
      prefs.set(k, n.type === 'checkbox' ? n.checked : +n.value);
      const o = pause.querySelector(`[data-out="${k}"]`); if (o && n.type !== 'checkbox') o.textContent = fmtPref(k, +n.value);
    });
    pause.addEventListener('change', e => {
      const n = e.target.closest('[data-pref="soundOn"]'); if (!n) return;
      muted = ctx.audio.toggleMute();
      n.checked = !muted;
    });
    modes.addEventListener('click', e => {
      const t = e.target;
      const ex = t.closest('[data-explore]'); if (ex) { startMode('explorar', ex.dataset.explore); return; }
      const gr = t.closest('[data-gr]'); if (gr) { startMode('gaterush', gr.dataset.gr); return; }
      const inv = t.closest('[data-inv]'); if (inv) { startMode('invasion', inv.dataset.inv); return; }
      const gh = t.closest('[data-ghost]');
      if (gh) { const on = gh.getAttribute('aria-pressed') !== 'true'; ctx.enemies.gaterush.setGhostEnabled(on); gh.setAttribute('aria-pressed', String(on)); return; }
      const hit = t.closest('[data-mode]'); if (hit) startMode(hit.dataset.mode);
    });
    // Esc abre la pausa (y al soltar el puntero capturado, spec §6)
    addEventListener('keydown', e => {
      if (e.code !== 'Escape' || e.defaultPrevented || overlayCoordinator.active() || S.replay) return;
      overlayCoordinator.open('menu');
    });
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (wasLocked && !locked && !overlayCoordinator.active() && !document.hidden) overlayCoordinator.open('menu');
      wasLocked = locked;
    });
    // acciones que otros módulos / el menú legado usaban
    const toggleRec = async () => {
      const rec = ctx.tour.recorder;
      if (!rec.supported) { ctx.ui.screens.toast('Este navegador no puede grabar video.'); return; }
      if (rec.recording) {
        const blob = await rec.stop();
        if (blob) rec.download(blob, `volar_${ctx.CID}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
      } else if (rec.start()) { ctx.audio.rec?.(true); close(); }
    };
    Object.assign(A, { toggleSound: () => { muted = ctx.audio.toggleMute(); return muted; }, toggleRec });
    return overlayCoordinator;
  }

  return {
    install, go, startMode, syncModes,
    initGradePanel() {},
    toggleSound: () => A.toggleSound(), toggleRec: () => A.toggleRec(),
    recorderFailed() { ctx.ui.screens.toast('La grabación se detuvo por un error. Prueba de nuevo.'); ctx.audio.rec?.(false); },
    tickRec() {},
    get movable() { return null; },
    dispose() { overlayCoordinator?.dispose(); },
    openModes: () => overlayCoordinator.open('modes'),
    openPause: (pg = 'root') => { overlayCoordinator.open('menu'); if (pg !== 'root') go(pg); },
    MODES,
  };
}
