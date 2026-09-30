// flightverse/tour/default-ui.js — chrome MÍNIMO de Tour / Foto / borde (WS E, ?fv=2).
// Es el respaldo funcional hasta que A dibuje el chrome definitivo desde ctx.tour.* / ctx.photo.* /
// ctx.edge.* y los eventos del bus: si A marca `ctx.ui.external = { tour, photo, edge }` (o pone
// `ctx.tour.externalUi = true`), este módulo no crea nada. Tokens HUD del spec §2.1, sin glow ni emoji.
const CSS = `
/* Chrome de Tour / Foto / borde con el lenguaje de A (hud.css): tokens --h-*, placas grafito, hairline 1 px, radio 8/12,
   mono tabular 12-14 px, un solo acento (--h-friend), rojo sólo para aviso (--h-hostile, borde discontinuo). */
.fv-ui{position:fixed;z-index:30;font-family:var(--hx-sans,var(--font,system-ui,sans-serif));color:var(--h-ink,#E6EBF2);pointer-events:none}
.fv-plate{background:var(--h-plate,rgba(8,10,14,.72));border:1px solid var(--h-line,rgba(255,255,255,.14));border-radius:8px;padding:4px 8px}
.fv-card{background:var(--h-plate-2,rgba(8,10,14,.86));border:1px solid var(--h-line,rgba(255,255,255,.14));border-radius:12px}
.fv-label{left:calc(var(--hx-sl,0px) + var(--hx-g,12px));bottom:calc(var(--hx-sb,0px) + 64px);width:min(calc(100vw - 2 * var(--hx-g,12px) - var(--hx-sl,0px) - var(--hx-sr,0px) - 128px),340px);
  padding:10px 14px;opacity:0;transform:translateY(4px);transition:opacity 150ms var(--hx-ease,ease-out),transform 150ms var(--hx-ease,ease-out)}
.fv-label.on{opacity:1;transform:none}
.fv-label b{display:block;font:600 16px/22px var(--hx-sans,system-ui)}
.fv-label span{display:block;font:500 12px/16px var(--hx-sans,system-ui);color:var(--h-ink-2,#B7C2D0);margin-top:2px}
.fv-label small{display:block;font:500 12px/16px var(--hx-mono,ui-monospace,monospace);color:var(--h-ink-2,#B7C2D0);margin-top:4px;font-variant-numeric:tabular-nums}
.fv-bar{right:calc(var(--hx-sr,0px) + var(--hx-g,12px));bottom:calc(var(--hx-sb,0px) + 64px);display:flex;gap:8px;pointer-events:auto}
.fv-btn{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;border-radius:8px;background:var(--h-plate,rgba(8,10,14,.72));
  border:1px solid var(--h-line,rgba(255,255,255,.14));color:var(--h-ink,#E6EBF2);cursor:pointer;-webkit-tap-highlight-color:transparent;font:600 12px var(--hx-sans,system-ui)}
.fv-btn.txt{width:auto;min-width:44px;padding:0 14px}
.fv-btn.primary{background:var(--h-friend,#45A0E6);border-color:var(--h-friend,#45A0E6);color:#06111C}
.fv-btn:active{transform:scale(.96)}
@media (hover:hover){.fv-btn:hover{border-color:rgba(69,160,230,.6)}.fv-btn.primary:hover{background:#5AB0F0}}
.fv-btn:focus-visible{outline:2px solid var(--h-friend,#45A0E6);outline-offset:2px}
.fv-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fv-edge{left:50%;bottom:calc(var(--hx-sb,0px) + 64px);transform:translate(-50%,4px);padding:4px 14px;white-space:nowrap;
  background:var(--h-plate-2,rgba(8,10,14,.86));border:1px dashed var(--h-hostile,#D96A6A);color:var(--h-hostile,#D96A6A);
  font:600 14px/20px var(--hx-mono,ui-monospace,monospace);opacity:0;transition:opacity 150ms var(--hx-ease,ease-out),transform 150ms var(--hx-ease,ease-out)}
.fv-edge.on{opacity:1;transform:translate(-50%,0)}
.fv-photo{left:50%;transform:translateX(-50%);bottom:calc(var(--hx-sb,0px) + var(--hx-g,12px));width:min(calc(100vw - 2 * var(--hx-g,12px)),480px);pointer-events:auto;padding:8px 14px 12px}
.fv-photo .grid{display:grid;grid-template-columns:1fr;column-gap:20px}
.fv-photo .row{display:flex;align-items:center;gap:10px;min-height:44px}
.fv-photo label{flex:0 0 72px;font:500 12px/16px var(--hx-sans,system-ui);color:var(--h-ink-2,#B7C2D0)}
.fv-photo output{flex:0 0 60px;text-align:right;font:600 12px/16px var(--hx-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:var(--h-ink,#E6EBF2)}
.fv-photo input[type=range]{flex:1;min-width:0;height:44px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;touch-action:pan-y}
.fv-photo input[type=range]::-webkit-slider-runnable-track{height:2px;border-radius:1px;background:var(--h-line,rgba(255,255,255,.22))}
.fv-photo input[type=range]::-moz-range-track{height:2px;border-radius:1px;background:var(--h-line,rgba(255,255,255,.22))}
.fv-photo input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-7px;border-radius:50%;background:var(--h-ink,#E6EBF2);border:2px solid var(--h-friend,#45A0E6)}
.fv-photo input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--h-ink,#E6EBF2);border:2px solid var(--h-friend,#45A0E6)}
.fv-photo .btns{display:flex;gap:8px;margin-top:6px;justify-content:flex-end}
@media (orientation:landscape) and (max-height:520px){
  .fv-photo{width:min(calc(100vw - 2 * var(--hx-g,12px) - var(--hx-sl,0px) - var(--hx-sr,0px)),640px);padding:6px 14px 8px}
  .fv-photo .grid{grid-template-columns:1fr 1fr}
  .fv-photo .row{min-height:40px}.fv-photo input[type=range]{height:40px}
  .fv-label{bottom:calc(var(--hx-sb,0px) + 12px)}.fv-bar{bottom:calc(var(--hx-sb,0px) + 12px)}
}
body:has(.fv-photo) .fv-edge{bottom:auto;top:calc(var(--hx-st,0px) + 76px)}
@media (prefers-reduced-motion:reduce){.fv-label,.fv-edge{transition:none;transform:none}.fv-edge.on{transform:translateX(-50%)}}
html[data-rm="1"] .fv-label,html[data-rm="1"] .fv-edge{transition:none;transform:none}
html[data-rm="1"] .fv-edge{transform:translateX(-50%)}
`;
const ICON = {
  prev: '<path d="M14 5l-7 7 7 7"/>', next: '<path d="M10 5l7 7-7 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const mk = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const btn = (k, label, fn, txt = '', primary = false) => {
  const b = mk('button', 'fv-btn' + (txt ? ' txt' : '') + (primary ? ' primary' : ''), txt || svg(k));
  b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn);
  return b;
};

export function installDefaultUi(ctx) {
  const ext = () => ctx.ui?.external || {};
  if (!document.getElementById('fv-default-ui-css')) {
    const st = document.createElement('style'); st.id = 'fv-default-ui-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const { tour, photo, edge } = ctx;

  // ── Tour: tarjeta de etiqueta (4 s) + anterior/siguiente/salir ──
  const label = mk('div', 'fv-ui fv-card fv-label'); label.setAttribute('aria-live', 'polite');
  const bar = mk('div', 'fv-ui fv-bar'); bar.hidden = true;
  bar.append(btn('prev', 'POI anterior', () => tour.prev()), btn('next', 'Siguiente POI', () => tour.next()),
    btn('x', 'Salir del tour', () => tour.stop()));
  let labelTimer = 0;
  ctx.tour.events.on('tour', d => {
    if (ext().tour || tour.externalUi) { label.remove(); bar.remove(); return; }
    if (!label.isConnected) document.body.append(label, bar);
    if (d.state === 'start') bar.hidden = false;
    if (d.state === 'stop') { bar.hidden = true; label.classList.remove('on'); return; }
    if (d.state === 'poi' || d.state === 'start') {
      const p = d.poi;
      label.innerHTML = `<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.short)}</span><small>${p.index + 1}/${p.n}</small>`;
      label.classList.add('on');
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => label.classList.remove('on'), 4000);
    }
  });

  // ── borde: placa "Borde de la zona · gira" ──
  const plate = mk('div', 'fv-ui fv-edge', 'Borde de la zona · gira');
  plate.setAttribute('role', 'status');
  ctx.tour.events.on('edge', d => {
    if (ext().edge || edge.externalUi) { plate.remove(); return; }
    if (!plate.isConnected) document.body.append(plate);
    plate.classList.toggle('on', !!d.warn);
  });

  // ── Foto: panel de parámetros ──
  let panel = null;
  const row = (id, text, min, max, step, val, fmt) => {
    const r = mk('div', 'row');
    r.innerHTML = `<label for="fvp-${id}">${text}</label><input id="fvp-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt(val)}</output>`;
    return r;
  };
  ctx.tour.events.on('photo', d => {
    if (ext().photo || photo.externalUi) { panel?.remove(); panel = null; return; }
    if (d.active && !panel) {
      panel = mk('div', 'fv-ui fv-card fv-photo'); panel.setAttribute('data-fv-photo-ui', '');
      const o = photo.opts;
      const defs = [
        ['focal', 'Focal', 18, 85, 1, o.focalMm, v => `${v} mm`, v => photo.set({ focalMm: +v })],
        ['fstop', 'Apertura', 1.8, 16, 0.1, o.fstop, v => `f/${(+v).toFixed(1)}`, v => photo.set({ fstop: +v })],
        ['ev', 'Exposición', -2, 2, 0.1, o.ev, v => `${v > 0 ? '+' : ''}${(+v).toFixed(1)} EV`, v => photo.set({ ev: +v })],
        ['hora', 'Hora', -5, 70, 1, ctx.sky.elevation > 70 ? 55 : Math.max(-5, ctx.sky.elevation), v => `${v}°`, v => photo.set({ tod: +v })],
      ];
      const grid = mk('div', 'grid'); panel.append(grid);
      for (const [id, text, mn, mx, st, val, fmt, fn] of defs) {
        const r = row(id, text, mn, mx, st, val, fmt);
        const inp = r.querySelector('input'), out = r.querySelector('output');
        inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); fn(inp.value); });
        grid.append(r);
      }
      const b = mk('div', 'btns');
      b.append(btn('eye', 'Ocultar interfaz', () => photo.set({ hideHud: !photo.opts.hideHud }), 'HUD'),
        btn('cam', 'Guardar foto PNG', () => photo.capture({ download: true }), 'Foto', true),
        btn('x', 'Salir del modo foto', () => photo.exit()));
      panel.append(b);
      document.body.append(panel);
    } else if (!d.active && panel) { panel.remove(); panel = null; }
  });
  return { label, bar, plate };
}
