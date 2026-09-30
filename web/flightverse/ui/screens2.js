// flightverse/ui/screens2.js — pantallas del HUD v2 (WS A, ?fv=2): «Toca para empezar» (desbloqueo de audio +
// háptica), onboarding, resultados de Gate Rush / derrota / victoria (UNA tarjeta, botones apilados a ancho
// completo en móvil), selectores de Invasión y dificultad, guía, director/cine y toast. La LÓGICA (récords,
// medallas, par, oleadas) es de D; aquí solo se presenta lo que D publica en vm/run.
import { ICON } from '/flightverse/ui/icons2.js?v=368';
import { createOnboarding, shouldOnboard } from '/flightverse/ui/onboarding.js?v=368';
import { MEDAL_TEXT, formatTime } from '/flightverse/ui/records.js?v=368';
import { guideBody } from '/flightverse/ui/menu2.js?v=368';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DIFF_LB = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
const TYPES = [['zombie', 'Zombis'], ['arquero', 'Arqueros'], ['soldado', 'Soldados'], ['avion', 'Aviones'], ['ufo', 'OVNIs'], ['dragon', 'Dragón'], ['gigante', 'Gigante']];

const medalBadge = medal => medal ? `<div class="hx-medal" data-medal="${medal}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="10" r="6"/>${medal !== 'bronze' ? '<circle cx="12" cy="10" r="3"/>' : ''}${medal === 'gold' ? '<circle cx="12" cy="10" r="0.9" fill="currentColor"/>' : ''}<path d="M8.500 15.500L7 21l5-2.500 5 2.500-1.500-5.500"/></svg><b>${MEDAL_TEXT[medal]}</b></div>` : '';

export const screensV2Markup = () => `    <div class="hx-toast" id="vl-toast" role="status" aria-live="polite"></div>
    <div class="hx-coach" id="hx-coach" data-where="left" role="status"><span class="hx-coach-t"></span><button type="button" class="hx-coach-x" aria-label="Omitir introducción">${ICON.close}</button></div>
    <section class="hx-start" id="hx-start" aria-labelledby="hx-start-t">
      <button type="button" class="hx-start-hit" id="hx-start-go">
        <small>FLIGHTVERSE</small>
        <b id="hx-start-t">Toca para empezar</b>
        <span>Activa sonido y vibración</span>
      </button>
      <button type="button" class="hx-btn ghost" id="hx-start-fs" hidden>Pantalla completa</button>
    </section>
    <section class="hx-sheet hx-center" id="vl-result"></section>
    <section class="hx-sheet hx-center" id="vl-inv" aria-labelledby="hx-inv-t">
      <div class="hx-sheet-card">
        <header class="hx-sh"><div class="hx-sh-t"><h2 id="hx-inv-t">Invasión</h2><small>Elige a tus enemigos</small></div><button type="button" class="hx-ibtn sm" id="hx-inv-x" aria-label="Cerrar">${ICON.close}</button></header>
        <div class="hx-chips wrap" role="group" aria-label="Enemigos">${TYPES.map(([k, t], i) => `<button type="button" class="hx-chip${i === 0 ? ' sel' : ''}" data-e="${k}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
        <p class="hx-lab">Dificultad</p>
        <div class="hx-seg" role="radiogroup" aria-label="Dificultad de invasión">${Object.entries(DIFF_LB).map(([k, t]) => `<button type="button" role="radio" data-inv-d="${k}" class="${k === 'media' ? 'sel' : ''}" aria-checked="${k === 'media'}">${t}</button>`).join('')}</div>
        <button type="button" class="hx-btn primary" id="vl-inv-go">Iniciar invasión</button>
      </div>
    </section>
    <section class="hx-sheet hx-center" id="vl-diff" aria-labelledby="hx-diff-t">
      <div class="hx-sheet-card">
        <header class="hx-sh"><div class="hx-sh-t"><h2 id="hx-diff-t">Gate Rush</h2><small>Elige dificultad</small></div><button type="button" class="hx-ibtn sm" id="hx-diff-x" aria-label="Cerrar">${ICON.close}</button></header>
        <div class="hx-list">
          <button type="button" class="hx-row" data-d="facil"><span class="hx-row-l">Fácil</span><span class="hx-row-v">8 aros · 9 m</span></button>
          <button type="button" class="hx-row" data-d="media"><span class="hx-row-l">Media</span><span class="hx-row-v">10 aros · 6.5 m</span></button>
          <button type="button" class="hx-row" data-d="dificil"><span class="hx-row-l">Difícil</span><span class="hx-row-v">13 aros · 4.2 m</span></button>
        </div>
      </div>
    </section>
    <section class="hx-sheet hx-center" id="vl-guide" aria-labelledby="hx-guide-t">
      <div class="hx-sheet-card">
        <header class="hx-sh"><div class="hx-sh-t"><h2 id="hx-guide-t">Cómo jugar</h2></div><button type="button" class="hx-ibtn sm" id="hx-guide-x" aria-label="Cerrar">${ICON.close}</button></header>
        <div class="hx-pages">${guideBody(matchMedia('(pointer:coarse)').matches)}</div>
        <button type="button" class="hx-btn primary" id="vl-guide-go">Entendido</button>
      </div>
    </section>
    <section class="hx-director" id="vl-director" aria-label="Director">
      <div class="hx-btnrow">
        <button type="button" class="hx-btn primary" id="dir-key">+ Keyframe</button>
        <button type="button" class="hx-btn" id="dir-play">Vista previa</button>
        <button type="button" class="hx-btn" id="dir-rec">Grabar toma</button>
        <button type="button" class="hx-btn" id="dir-hd">Exportar 1080p</button>
        <button type="button" class="hx-btn" id="dir-exit">Salir</button>
      </div>
      <input type="range" id="dir-scrub" min="0" max="1" step="0.001" value="0" aria-label="Línea de tiempo">
      <div class="hx-dirkeys" id="dir-keys"></div>
    </section>
    <div class="hx-cine" id="vl-cine">
      <label>Velocidad<input type="range" id="cine-v" min="0.03" max="0.5" step="0.01" value="0.14"></label>
      <label>Ángulo<input type="range" id="cine-a" min="0.12" max="0.6" step="0.01" value="0.24"></label>
    </div>
`;

export function createScreens2(ctx) {
  const { state: S, actions: A, flags } = ctx;
  let toastTimer = 0;
  let onboarding = null;

  const toast = (msg, ms = 3200) => {
    const el = $('#vl-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  };

  /** Quita el splash de carga cuando el juego ya corre (una vez) y lanza la entrada (plato de inicio → onboarding / modos). */
  function tickBoot() {
    if (!window.__bootHidden && S.simT > 0.5) {
      window.__bootHidden = true;
      const bar = document.querySelector('#vl-boot .vb-bar b');
      if (bar) bar.style.transform = 'scaleX(1)';
      const bo = $('#vl-boot');
      bo.classList.add('hide');
      setTimeout(() => bo.remove(), 700);
      enterWorld();
    }
    onboarding?.tick();
  }

  // ── entrada al mundo: «Toca para empezar» → onboarding (1ª vez) o selector de modo ──
  let entered = false;
  function enterWorld() {
    if (entered) return; entered = true;
    const skipStart = ctx.AT || ctx.Q.get('nostart') === '1';
    if (skipStart) return afterStart();
    ctx.ui.overlay.open('start');
    $('#hx-start-go').focus({ preventScroll: true });
    if (document.fullscreenEnabled && !flags.coarse) $('#hx-start-fs').hidden = false;
  }
  function afterStart() {
    const Q = ctx.Q;
    if (shouldOnboard(ctx)) { onboarding = onboarding || createOnboarding(ctx); onboarding.start(); return; }
    if (!ctx.AT && !Q.get('reto') && !Q.get('invasion') && !Q.get('modo') && Q.get('menu') !== '0' && Q.get('nostart') !== '1') ctx.ui.menu.openModes();
  }
  function unlock() {
    // gesto del usuario: audio (iOS/Safari exigen touchend/click), háptica y reanudación
    try { ctx.audio.unlock?.(); } catch { /* sin API */ }
    if (!ctx.audio.armed) { try { ctx.audio.toggleMute(); } catch { /* sin audio */ } }
    addEventListener('touchend', function retry() { if (ctx.audio.armed) removeEventListener('touchend', retry); else ctx.audio.unlock?.(); }, { passive: true });
    ctx.ui.haptics?.init?.();
  }

  const clearResult = () => { $('#vl-result').innerHTML = ''; };

  // ── tarjetas de resultado: UN componente ──
  const stat = (v, l) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  const topList = (top, mode) => {
    if (!Array.isArray(top) || !top.length) return '';
    const rows = top.slice(0, 5).map((r, i) => `<li><span>${i + 1}</span><span>${mode === 'gr' && r.time != null ? formatTime(r.time) : esc(r.score)}</span><span>${esc(r.date || '')}</span><span>${r.medal ? MEDAL_TEXT[r.medal] || '' : ''}</span></li>`).join('');
    return `<div class="hx-top10"><h3>Mejores marcas</h3><ol>${rows}</ol></div>`;
  };
  const card = (inner, labelId) => `<div class="hx-sheet-card hx-result" role="alertdialog" aria-labelledby="${labelId}">${inner}</div>`;

  /** vm = { st, t, retoMode, isNew, best, prev, delta, dist, [medal, par, misses, rank, top] } */
  function showGateRushResult(vm) {
    const { st, t, retoMode, isNew, best, prev, delta, dist } = vm;
    $('#vl-fpv')?.classList.remove('show');
    const segs = st.splits.map((s2, i) => i ? s2 - st.splits[i - 1] : s2);
    const bestSeg = Math.min(...segs);
    const splits = segs.map((s2, i) => `<div class="hx-split${s2 === bestSeg ? ' best' : ''}"><i>${i + 1}</i><b>${s2.toFixed(2)}s</b></div>`).join('');
    const sub = isNew
      ? (prev == null ? 'Primera marca de esta dificultad' : `Mejoras tu récord (${prev.toFixed(2)} s) por ${(prev - t).toFixed(2)} s`)
      : `Récord ${best.toFixed(2)} s · <b class="delta">+${delta.toFixed(2)} s</b>`;
    const parLine = vm.par ? `Par ${formatTime(vm.par)} · ${vm.misses ? `${vm.misses} ${vm.misses === 1 ? 'fallo' : 'fallos'}` : 'sin fallos'}` : '';
    $('#vl-result').innerHTML = card(`
      <div class="hx-res-head">
      <p class="hx-k" id="hx-res-k">Gate Rush · ${DIFF_LB[st.difficulty] || ''}${retoMode === 'dios' ? ' · Dios (récord aparte)' : ''}${isNew ? '<em>Nuevo récord</em>' : ''}</p>
      <div class="hx-big">${t.toFixed(2)}<small> s</small></div>
      <p class="hx-sub">${sub}</p>
      ${medalBadge(vm.medal)}${parLine ? `<p class="hx-par">${parLine}</p>` : ''}
      </div>
      <div class="hx-res-body">
      <div class="hx-stats">${stat(st.total, 'aros')}${stat(st.topSpeed.toFixed(1), 'vel máx m/s')}${stat(t > 0 ? (dist / t).toFixed(1) : '—', 'vel media m/s')}${stat(Math.round(dist), 'metros')}</div>
      <div class="hx-splits">${splits}</div>
      ${topList(vm.top, 'gr')}
      </div>
      <div class="hx-actions-col">
        <button type="button" class="hx-btn primary" data-act="retry">Reintentar</button>
        <button type="button" class="hx-btn" data-act="diff">Dificultad</button>
        <button type="button" class="hx-btn" data-act="replay">Ver replay</button>
        <button type="button" class="hx-btn" data-act="director">Director</button>
        <a class="hx-btn" href="mundo.html">Mundo</a>
      </div>`, 'hx-res-k');
    ctx.ui.overlay.open('result');
  }

  function invasionCard(run, kind) {
    const victory = kind === 'victory';
    $('#vl-fpv')?.classList.remove('show');
    const parts = ['<div class="hx-res-head">'];
    parts.push(`<p class="hx-k" id="hx-res-k">Invasión · ${DIFF_LB[run.difficulty] || ''}${run.newBest ? '<em>Nuevo récord</em>' : ''}</p>`);
    parts.push(`<div class="hx-big ${victory ? '' : 'def'}">${victory ? 'VICTORIA' : 'DERRIBADO'}</div>`);
    parts.push(`<p class="hx-sub">${victory
      ? (run.livesLost ? `Ciudad defendida · ${run.livesLost} ${run.livesLost === 1 ? 'vida perdida' : 'vidas perdidas'}` : 'Ciudad defendida sin perder una vida')
      : (run.best != null && !run.newBest ? `Récord ${run.best} pts` : 'Tu dron cayó bajo el fuego enemigo')}</p>`);
    parts.push(medalBadge(run.medal));
    parts.push('</div><div class="hx-res-body">');
    parts.push(`<div class="hx-stats">${stat(run.wave, victory ? 'oleadas' : 'oleada')}${stat(run.killed, 'abatidos')}${stat(run.score, 'puntos')}${stat(run.rank ? `#${run.rank}` : (run.types?.length ?? '—'), run.rank ? 'top 10' : 'tipos')}</div>`);
    parts.push(topList(run.top, 'inv'));
    parts.push('</div>');
    parts.push(`<div class="hx-actions-col">
        <button type="button" class="hx-btn primary" data-act="inv-retry">${victory ? 'Jugar de nuevo' : 'Reintentar'}</button>
        <button type="button" class="hx-btn" data-act="modes">Cambiar modo</button>
        <button type="button" class="hx-btn" data-act="inv-config">Cambiar enemigos</button>
        <a class="hx-btn" href="mundo.html">Mundo</a>
      </div>`);
    $('#vl-result').innerHTML = card(parts.join(''), 'hx-res-k');
    ctx.ui.overlay.open('result');
  }
  const showDefeat = run => invasionCard(run, 'defeat');
  const showVictory = run => invasionCard(run, 'victory');

  function install() {
    const oc = ctx.ui.overlay;
    $('#hx-start-go').addEventListener('click', () => {
      unlock();
      oc.close('start');
      afterStart();
    });
    $('#hx-start-fs').addEventListener('click', e => { e.stopPropagation(); document.documentElement.requestFullscreen?.().catch(() => {}); });
    // picker de Invasión
    const inv = $('#vl-inv');
    inv.addEventListener('click', e => {
      const chip = e.target.closest('button[data-e]');
      if (chip) { const on = chip.classList.toggle('sel'); chip.setAttribute('aria-pressed', String(on)); return; }
      const d = e.target.closest('button[data-inv-d]');
      if (d) { inv.querySelectorAll('button[data-inv-d]').forEach(b => { const on = b === d; b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on)); }); return; }
      if (e.target.closest('#vl-inv-go')) {
        const sel = [...inv.querySelectorAll('button[data-e].sel')].map(b => b.dataset.e);
        const diff = inv.querySelector('button[data-inv-d].sel')?.dataset.invD || 'media';
        ctx.enemies.startFromPicker(sel.length ? sel : ['zombie'], diff);
      }
      if (e.target.closest('#hx-inv-x')) oc.close();
    });
    $('#vl-diff').addEventListener('click', e => {
      const b = e.target.closest('button[data-d]'); if (b) A.startReto(b.dataset.d);
      if (e.target.closest('#hx-diff-x')) oc.close();
    });
    $('#hx-guide-x').addEventListener('click', () => oc.close('guide'));
    $('#vl-guide-go').addEventListener('click', () => oc.close('guide'));
    $('#vl-result').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'inv-retry' && S.lastInvasionRun) { A.startInvasionRun(S.lastInvasionRun.types, S.lastInvasionRun.difficulty); return; }
      if (act === 'inv-config') { oc.open('invasion'); return; }
      if (act === 'modes') { oc.open('modes'); return; }
      if (act === 'retry') A.startReto(S.reto.state.difficulty);
      if (act === 'diff') oc.open('difficulty');
      if (act === 'replay') A.startReplay();
      if (act === 'director') A.enterDirector();
    });
  }
  ctx.ui.startGameplay = afterStart;
  return { toast, tickBoot, clearResult, showGateRushResult, showDefeat, showVictory, install, get onboarding() { return onboarding; } };
}
