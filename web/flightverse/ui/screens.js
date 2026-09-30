// flightverse/ui/screens.js — pantallas y overlays de pantalla completa (WS A):
// carga/arranque (boot + error), guía, selector de invasión, selector de
// dificultad, tarjeta de resultado de Gate Rush y pantalla de derrota, toast.
// La LÓGICA de juego (récords, oleadas) vive en modes/*; aquí solo presentación.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.

export const bootMarkup = () => `    <div class="vl-boot" id="vl-boot">
      <small>FLIGHTVERSE</small><b id="vb-name">Cargando escena…</b>
      <div class="vb-bar"><b></b></div>
      <small id="vb-stage" aria-live="polite">Preparando · 0%</small>
      <div class="vb-steps"><i id="vb-terreno">TERRENO</i><i id="vb-malla">MALLA</i><i id="vb-splat">SPLAT</i></div>
    </div>
`;
export const invasionPickerMarkup = () => `    <div class="vl-inv" id="vl-inv">
      <b>INVASIÓN · elige enemigos</b>
      <div class="vl-inv-grid">
        <button data-e="zombie" class="sel">Zombies</button>
        <button data-e="arquero">Arqueros</button>
        <button data-e="soldado">Soldados</button>
        <button data-e="ufo">OVNIs</button>
        <button data-e="avion">Aviones</button>
        <button data-e="dragon">Dragón</button>
        <button data-e="gigante">Gigantes</button>
      </div>
      <div class="vl-inv-diff" role="group" aria-label="Dificultad de invasión">
        <button data-inv-d="facil">FÁCIL</button>
        <button data-inv-d="media" class="sel">MEDIA</button>
        <button data-inv-d="dificil">DIFÍCIL</button>
      </div>
      <button id="vl-inv-go">INICIAR INVASIÓN</button>
    </div>
`;
export const difficultyMarkup = () => `    <div class="vl-diff" id="vl-diff">
      <button data-d="facil">Fácil<span>8 aros · 9m</span></button>
      <button data-d="media">Media<span>10 aros · 6.5m</span></button>
      <button data-d="dificil">Difícil<span>13 aros · 4.2m</span></button>
    </div>
`;
export const resultMarkup = () => `    <div class="vl-result" id="vl-result"></div>
`;
/** Guía de vuelo: variante táctil (palancas) o teclado. */
export const guideMarkup = touchGuide => `    <div class="vl-guide" id="vl-guide">
      <div class="vl-guide-card">
        <div class="vl-guide-k">GUÍA DE VUELO</div>
        <div class="vl-guide-rows">${touchGuide ? `
          <div class="vl-guide-row"><span class="vl-gi">01</span><div><b>Volar</b>
            <p>Palanca izquierda: subir, bajar y girar. Palanca derecha: avanzar y moverte de lado.</p></div></div>
          <div class="vl-guide-row"><span class="vl-gi">02</span><div><b>Modos y cámaras</b>
            <p>Abre <b>Menú</b> para cambiar el modo (Cine · Normal · Arcade · Dios), la cámara y la vista.</p></div></div>
          <div class="vl-guide-row"><span class="vl-gi">03</span><div><b>Jugar y grabar</b>
            <p>En el Menú: Gate Rush (aros sobre tu ruta real), Modo Invasión, grabar video y sonido.</p></div></div>` : `
          <div class="vl-guide-row"><span class="vl-gi">01</span><div><b>Volar</b>
            <div class="vl-keys">
              <span class="vl-kv"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>mover</span>
              <span class="vl-kv"><kbd>R</kbd><kbd>F</kbd>subir/bajar</span>
              <span class="vl-kv"><kbd>Q</kbd><kbd>E</kbd>girar</span>
              <span class="vl-kv"><kbd>Shift</kbd>turbo</span>
              <span class="vl-kv"><kbd>Espacio</kbd>freno</span>
              <span class="vl-kv"><kbd class="vl-kmouse">Rueda</kbd>inclinar cámara</span>
            </div></div></div>
          <div class="vl-guide-row"><span class="vl-gi">02</span><div><b>Modos y cámaras</b>
            <div class="vl-keys">
              <span class="vl-kv"><kbd>1</kbd>–<kbd>4</kbd>modo (Cine · Normal · Arcade · Dios)</span>
              <span class="vl-kv"><kbd>C</kbd>cámara</span>
              <span class="vl-kv"><kbd>P</kbd>vista</span>
              <span class="vl-kv"><kbd>G</kbd>fantasma</span>
            </div></div></div>
          <div class="vl-guide-row"><span class="vl-gi">03</span><div><b>Jugar y grabar</b>
            <div class="vl-keys">
              <span class="vl-kv"><kbd>T</kbd>Gate Rush (aros sobre tu ruta real)</span>
              <span class="vl-kv"><kbd>V</kbd>grabar video</span>
              <span class="vl-kv"><kbd>M</kbd>sonido</span>
            </div></div></div>`}
          <div class="vl-guide-row"><span class="vl-gi">04</span><div><b>Vistas</b>
            <p>3D = malla del terreno · foto-real = fotografías reconstruidas · mixta = malla 3D con foto-real encima.</p></div></div>
          <div class="vl-guide-row"><span class="vl-gi">05</span><div><b>Calidad</b>
            <p>Auto ajusta la fluidez sola (recomendado al volar). HD y Ultra dibujan más nítido: ideales para fotos y tomas.</p></div></div>
        </div>
        <div class="vl-guide-foot"><button id="vl-guide-go" class="btn primary big">¡A volar!</button></div>
      </div>
    </div>
`;
export const helpMarkup = () => `    <div class="vl-help" id="vl-help">
      <b>Controles</b><br>
      WASD mover · R/F subir/bajar · Q/E girar · mouse mirar (click captura)<br>
      Shift turbo · Space freno · 1-5 modo · C cámara · G ghost · P foto-real · V grabar · H ayuda
    </div>
`;

const $ = s => document.querySelector(s);

// Progreso de carga determinista: cada etapa real (manifiesto, terreno, dron...) fija
// un porcentaje y una etiqueta. La barra deja de ser indeterminada en el primer paso.
export function bootProgress(pct, label) {
  const bar = document.querySelector('#vl-boot .vb-bar b');
  if (bar) {
    bar.style.animation = 'none';
    bar.style.width = '100%';
    bar.style.transformOrigin = 'left center';
    bar.style.transition = 'transform .35s ease';
    bar.style.transform = `scaleX(${Math.max(0, Math.min(1, pct / 100))})`;
  }
  const st = $('#vb-stage');
  if (st) st.textContent = `${label} · ${pct}%`;
}
// Pastillas de capas que esta escena no tiene: se atenúan para no parecer "pendientes".
export function markLayerUnavailable(id) {
  const el = $('#' + id);
  if (el) { el.style.opacity = '0.35'; el.title = 'No disponible en esta escena'; el.dataset.na = '1'; }
}
export function bootError(e) {
  console.error('[volar] no se pudo iniciar:', e);
  const missing = e?.status === 404;
  const title = missing ? 'Esta isla aún no tiene escena 3D' : 'No se pudo cargar la isla';
  const help = missing
    ? 'Todavía no se ha procesado esta zona. Vuelve al Mundo y elige otra isla.'
    : 'Revisa tu conexión e inténtalo de nuevo, o elige otra isla en el Mundo.';
  let host = $('#vl-boot');
  if (!host) {                                     // el overlay ya se retiró: crear uno
    host = document.createElement('div');
    host.className = 'vl-boot';
    host.style.zIndex = '80';
    document.body.appendChild(host);
  }
  host.classList.remove('hide');
  host.style.pointerEvents = 'auto';
  host.style.padding = '24px 16px';
  host.style.overflowY = 'auto';
  host.textContent = '';
  const pills = document.createElement('div');
  pills.className = 'vb-steps';
  for (const t of ['TERRENO', 'MALLA', 'SPLAT']) {
    const i = document.createElement('i'); i.textContent = t; pills.appendChild(i);
  }
  const card = document.createElement('div');
  card.className = 'vl-err-card';
  card.setAttribute('role', 'alert');
  Object.assign(card.style, { display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '12px', maxWidth: '360px', textAlign: 'center' });
  const h = document.createElement('b'); h.textContent = title;
  const p = document.createElement('p');
  p.textContent = help;
  Object.assign(p.style, { margin: '0', font: '400 14px/1.5 var(--font)', color: '#B7C2D0' });
  const a = document.createElement('a');
  a.href = 'mundo.html';
  a.className = 'btn primary big';
  a.textContent = 'Volver al Mundo';
  Object.assign(a.style, { minHeight: '44px', justifyContent: 'center', textDecoration: 'none' });
  card.append(h, p, a);
  host.append(pills, card);
  const sc = $('#vl-scene'); if (sc) sc.textContent = '';
}

const DIFF_LB = { facil: 'FÁCIL', media: 'MEDIA', dificil: 'DIFÍCIL' };
const INV_DIFF_LB = DIFF_LB;

export function createScreens(ctx) {
  const { state: S, actions: A } = ctx;

  // aviso efímero mínimo (no hay overlay de resultados de invasión): estilos por CSSOM, compatible con CSP
  let toastTimer = 0;
  const toast = msg => {
    let el = document.getElementById('vl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vl-toast';
      el.setAttribute('role', 'status');
      Object.assign(el.style, {
        position: 'fixed', left: '50%', top: '22%', transform: 'translateX(-50%)', zIndex: '70',
        padding: '10px 18px', borderRadius: '10px', background: 'rgba(10,14,20,.82)', color: '#ffb36b',
        font: '700 13px ui-monospace, monospace', letterSpacing: '.12em', textAlign: 'center',
        pointerEvents: 'none', transition: 'opacity .3s',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3200);
  };

  /** Quita el splash de carga cuando el juego ya corre (por frame; una sola vez). */
  function tickBoot() {
    if (!window.__bootHidden && S.simT > 0.5) {
      window.__bootHidden = true;
      bootProgress(100, 'Listo');
      const bo = $('#vl-boot');
      bo.classList.add('hide');
      setTimeout(() => bo.remove(), 700);
    }
  }

  const clearResult = () => { $('#vl-result').innerHTML = ''; };

  /** Tarjeta de resultado de Gate Rush. vm = { st, t, retoMode, isNew, best, prev, delta, dist }. */
  function showGateRushResult(vm) {
    const { st, t, retoMode, isNew, best, prev, delta, dist } = vm;
    $('#vl-fpv').classList.remove('show');       // el OSD FPV no pisa el modal
    // splits por gate con el mejor tramo resaltado
    const segs = st.splits.map((s2, i) => i ? s2 - st.splits[i - 1] : s2);
    const bestSeg = Math.min(...segs);
    const splitsHtml = segs.map((s2, i) => `
      <div class="vl-split${s2 === bestSeg ? ' best' : ''}">
        <i>${i + 1}</i><b>${s2.toFixed(2)}s</b>
      </div>`).join('');
    $('#vl-result').innerHTML = `
      <div class="vl-result-card v2">
        <div class="vl-result-k">GATE RUSH · ${DIFF_LB[st.difficulty] || ''}${retoMode === 'dios' ? ' · DIOS (récord aparte)' : ''}
          ${isNew ? '<em class="vl-newrec">NUEVO RÉCORD</em>' : ''}</div>
        <div class="vl-result-time">${t.toFixed(2)}<small>s</small></div>
        <div class="vl-result-sub">${isNew
          ? (prev == null ? 'primera marca de esta dificultad' : `mejoras tu récord anterior (${prev.toFixed(2)}s) por ${(prev - t).toFixed(2)}s`)
          : `récord ${best.toFixed(2)}s · <b class="vl-delta">+${delta.toFixed(2)}s</b>`}</div>
        <div class="vl-result-grid">
          <div><b>${st.total}</b><span>gates</span></div>
          <div><b>${st.topSpeed.toFixed(1)}</b><span>vel máx m/s</span></div>
          <div><b>${t > 0 ? (dist / t).toFixed(1) : '—'}</b><span>vel media m/s</span></div>
          <div><b>${Math.round(dist)}</b><span>metros</span></div>
        </div>
        <div class="vl-result-splits">${splitsHtml}</div>
        <div class="vl-result-btns">
          <button data-act="retry">Reintentar</button>
          <button data-act="diff">Dificultad</button>
          <button data-act="replay">Ver replay</button>
          <button data-act="director">Director</button>
          <a href="mundo.html">Mundo</a>
        </div>
      </div>`;
    ctx.ui.overlay.open('result');
  }

  /** Pantalla de derrota de Invasión. run = summarizeInvasionRun(...). */
  function showDefeat(run) {
    $('#vl-fpv').classList.remove('show');
    $('#vl-result').innerHTML = `
      <div class="vl-result-card v2" role="alertdialog" aria-labelledby="vl-def-k">
        <div class="vl-result-k" id="vl-def-k">INVASIÓN · ${INV_DIFF_LB[run.difficulty] || ''}
          ${run.newBest ? '<em class="vl-newrec">NUEVO RÉCORD</em>' : ''}</div>
        <div class="vl-result-time vl-def">DERRIBADO</div>
        <div class="vl-result-sub">${run.best != null && !run.newBest
          ? `récord ${run.best} pts` : 'tu dron cayó bajo el fuego enemigo'}</div>
        <div class="vl-result-grid">
          <div><b>${run.wave}</b><span>oleada</span></div>
          <div><b>${run.killed}</b><span>abatidos</span></div>
          <div><b>${run.score}</b><span>puntos</span></div>
          <div><b>${run.types.length}</b><span>tipos</span></div>
        </div>
        <div class="vl-result-btns">
          <button data-act="inv-retry">Reintentar</button>
          <button data-act="inv-config">Cambiar enemigos</button>
          <a href="mundo.html">Mundo</a>
        </div>
      </div>`;
    ctx.ui.overlay.open('result');
  }

  /** Cablea los overlays de pantalla: selector de invasión/dificultad, resultado, guía. */
  function install() {
    const overlayCoordinator = ctx.ui.overlay;
    const invModal = $('#vl-inv');
    invModal.addEventListener('click', e => {
      const chip = e.target.closest('button[data-e]');
      if (chip) { chip.classList.toggle('sel'); return; }
      const difficulty = e.target.closest('button[data-inv-d]');
      if (difficulty) {
        invModal.querySelectorAll('button[data-inv-d]').forEach(button => button.classList.toggle('sel', button === difficulty));
        return;
      }
      if (e.target.closest('#vl-inv-go')) {
        const sel = [...invModal.querySelectorAll('button[data-e].sel')].map(b => b.dataset.e);
        const diff = invModal.querySelector('button[data-inv-d].sel')?.dataset.invD || 'media';
        ctx.enemies.startFromPicker(sel.length ? sel : ['zombie'], diff);
      }
    });
    $('#vl-diff').addEventListener('click', e => {
      const b = e.target.closest('button[data-d]');
      if (b) A.startReto(b.dataset.d);
    });
    $('#vl-result').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'inv-retry' && S.lastInvasionRun) {
        A.startInvasionRun(S.lastInvasionRun.types, S.lastInvasionRun.difficulty);
        return;
      }
      if (act === 'inv-config') { overlayCoordinator.open('invasion'); return; }
      if (act === 'retry') A.startReto(S.reto.state.difficulty);
      if (act === 'diff') overlayCoordinator.open('difficulty');
      if (act === 'replay') A.startReplay();
      if (act === 'director') A.enterDirector();
    });
    const guidedBefore = () => { try { return !!localStorage.getItem('ab.fv.guided'); } catch { return false; } };
    $('#vl-guide-go').addEventListener('click', () => {
      overlayCoordinator.close('guide');
      try { localStorage.setItem('ab.fv.guided', '1'); } catch { /* almacenamiento bloqueado */ }
    });
    if (!guidedBefore() && !ctx.AT) overlayCoordinator.open('guide');
  }

  return { toast, tickBoot, clearResult, showGateRushResult, showDefeat, install };
}
