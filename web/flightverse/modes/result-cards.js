// flightverse/modes/result-cards.js — tarjetas de VICTORIA y medalla de Gate Rush (WS D).
// Fallback mientras A (ui/screens.js) no expone showVictory(): misma clase de tarjeta
// (.vl-result-card.v2) y jerarquía. Si ctx.ui.screens.showVictory existe, se usa ese y esto no corre.
import { MEDAL_LABEL, nextMedalTarget, timeText } from '/flightverse/modes/rules.js?v=368';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MEDAL_COLOR = { bronze: '#C58A5A', silver: '#C3CCD8', gold: '#E0B24A' };

export function medalBadge(medal) {
  if (!medal) return '';
  return `<div class="vl-medal" data-medal="${medal}" style="display:inline-flex;align-items:center;gap:8px;margin:6px auto 2px;padding:4px 12px;border:1px solid ${MEDAL_COLOR[medal]};border-radius:999px;font:600 13px var(--font,system-ui);color:${MEDAL_COLOR[medal]}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>${MEDAL_LABEL[medal]}</div>`;
}

/** Añade medalla, par y top-10 a la tarjeta de Gate Rush ya renderizada por A (no toca su jerarquía). */
export function decorateGateRushResult(root, vm) {
  const card = root?.querySelector?.('.vl-result-card');
  if (!card || card.querySelector('.vl-medal')) return;
  const next = nextMedalTarget({ par: vm.par, medal: vm.medal });
  const block = document.createElement('div');
  block.className = 'vl-medal-block';
  block.style.cssText = 'margin:8px 0 4px;text-align:center';
  block.innerHTML = `${medalBadge(vm.medal)}
    <div style="font:500 12px var(--mono,monospace);color:var(--on-media-2,#B7C2D0);margin-top:4px">par ${timeText(vm.par)}${vm.misses ? ` · ${vm.misses} ${vm.misses === 1 ? 'fallo' : 'fallos'}` : ' · sin fallos'}${next?.time ? ` · ${MEDAL_LABEL[next.medal]} ≤ ${next.time.toFixed(1)}s` : ''}</div>
    ${topList(vm.top)}`;
  const grid = card.querySelector('.vl-result-grid') || card.querySelector('.vl-result-btns');
  if (grid) grid.before(block); else card.append(block);
}

function topList(top) {
  if (!top?.length) return '';
  const rows = top.slice(0, 5).map((r, i) =>
    `<p style="margin:0;white-space:pre">${String(i + 1).padStart(2)}  ${r.time != null ? timeText(r.time) + '  ' : ''}${String(r.score).padStart(6)}${r.medal ? '  ' + MEDAL_LABEL[r.medal] : ''}</p>`).join('');
  return `<div class="vl-top" style="margin:10px auto 14px;font:500 12px var(--mono,monospace);color:var(--on-media-2,#B7C2D0);text-align:center"><p style="margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em;font-size:11px">Top ${Math.min(5, top.length)}</p>${rows}</div>`;
}

const INV_LB = { facil: 'FÁCIL', media: 'MEDIA', dificil: 'DIFÍCIL' };
export function showVictoryFallback(ctx, run) {
  const { $ } = ctx;
  $('#vl-fpv')?.classList.remove('show');
  $('#vl-result').innerHTML = `
    <div class="vl-result-card v2" role="alertdialog" aria-labelledby="vl-vic-k">
      <div class="vl-result-k" id="vl-vic-k">INVASIÓN · ${INV_LB[run.difficulty] || ''}
        ${run.newBest ? '<em class="vl-newrec">NUEVO RÉCORD</em>' : ''}</div>
      <div class="vl-result-time">VICTORIA</div>
      ${medalBadge(run.medal)}
      <div class="vl-result-sub">${esc(run.livesLost ? `ciudad defendida · ${run.livesLost} ${run.livesLost === 1 ? 'vida perdida' : 'vidas perdidas'}` : 'ciudad defendida sin perder una vida')}</div>
      <div class="vl-result-grid">
        <div><b>${run.wave}</b><span>oleadas</span></div>
        <div><b>${run.killed}</b><span>abatidos</span></div>
        <div><b>${run.score}</b><span>puntos</span></div>
        <div><b>${run.rank ? `#${run.rank}` : '—'}</b><span>top 10</span></div>
      </div>
      ${topList((run.top || []).map(r => ({ ...r, time: null })))}
      <div class="vl-result-btns">
        <button data-act="inv-retry">Jugar de nuevo</button>
        <button data-act="inv-config">Cambiar modo</button>
        <a href="mundo.html">Mundo</a>
      </div>
    </div>`;
  ctx.ui.overlay.open('result');
}
