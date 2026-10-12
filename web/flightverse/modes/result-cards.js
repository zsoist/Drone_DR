// flightverse/modes/result-cards.js — tarjetas de VICTORIA y medalla de Gate Rush (WS D).
// Fallback mientras A (ui/screens.js) no expone showVictory(): misma clase de tarjeta
// (.vl-result-card.v2) y jerarquía. Si ctx.ui.screens.showVictory existe, se usa ese y esto no corre.
import { MEDAL_LABEL, nextMedalTarget, formatRecordRows, RECORD_COLUMNS, shortTime } from '/flightverse/modes/rules.js?v=390';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MEDAL_COLOR = { bronze: '#C58A5A', silver: '#C3CCD8', gold: '#E0B24A' };

export function medalBadge(medal) {
  if (!medal) return '';
  return `<div class="vl-medal" data-medal="${medal}" style="display:inline-flex;align-items:center;gap:8px;margin:6px auto 2px;padding:4px 12px;border:1px solid ${MEDAL_COLOR[medal]};border-radius:999px;font:600 13px var(--font,system-ui);color:${MEDAL_COLOR[medal]}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>${MEDAL_LABEL[medal]}</div>`;
}

/** Añade medalla, par y top-10 a la tarjeta de Gate Rush ya renderizada por A (no toca su jerarquía). */
export function decorateGateRushResult(root, vm) {
  const card = root?.querySelector?.('.vl-result-card, .hx-result');
  if (!card) return;
  if (card.querySelector('.vl-medal, .hx-medal, .hx-par')) return;      // la tarjeta v2 ya trae medalla y par
  const next = nextMedalTarget({ par: vm.par, medal: vm.medal });
  const block = document.createElement('div');
  block.className = 'vl-medal-block';
  block.style.cssText = 'margin:8px 0 4px;text-align:center';
  block.innerHTML = `${medalBadge(vm.medal)}
    <div style="font:500 12px var(--mono,monospace);color:var(--on-media-2,#B7C2D0);margin-top:4px">Par ${shortTime(vm.par)}${vm.misses ? ` · ${vm.misses} ${vm.misses === 1 ? 'fallo' : 'fallos'}` : ' · sin fallos'}${next?.time ? ` · ${MEDAL_LABEL[next.medal]} ≤ ${shortTime(next.time)}` : ''}</div>
    ${''}`;
  const grid = card.querySelector('.vl-result-grid') || card.querySelector('.vl-result-btns') || card.querySelector('.hx-stats');
  if (grid) grid.before(block); else card.append(block);
}

/**
 * Tabla de récords con la MISMA marca que ui/screens2.js (`.hx-top10.hx-rec`, estilos en css/screens.css): sin estilos
 * en línea. Los datos salen de formatRecordRows/RECORD_COLUMNS (modes/rules.js). Sólo la usa la tarjeta de respaldo;
 * la tarjeta v2 de F3 pinta su propia tabla con las mismas filas.
 */
export function topList(top, kind = 'inv') {
  if (!top?.length) return '';
  const cols = RECORD_COLUMNS[kind] || RECORD_COLUMNS.inv;
  const rows = formatRecordRows(top, kind).map(r =>
    `<tr><td>${r.rank}</td><td>${esc(r.value)}</td><td>${esc(r.date)}</td><td>${r.medal ? `<i class="dot" data-medal="${r.medal}" aria-hidden="true"></i>` : ''}${esc(r.medalLabel)}</td></tr>`).join('');
  return `<div class="hx-top10 hx-rec"><h3>Mejores marcas</h3><table><thead><tr>${cols.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
      ${topList(run.top || [], 'inv')}
      <div class="vl-result-btns">
        <button data-act="inv-retry">Jugar de nuevo</button>
        <button data-act="inv-config">Cambiar modo</button>
        <a href="mundo.html">Mundo</a>
      </div>
    </div>`;
  ctx.ui.overlay.open('result');
}
