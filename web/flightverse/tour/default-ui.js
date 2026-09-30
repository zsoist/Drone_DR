// flightverse/tour/default-ui.js — chrome MÍNIMO de Tour / Foto / borde (WS E, ?fv=2).
// Es el respaldo funcional hasta que A dibuje el chrome definitivo desde ctx.tour.* / ctx.photo.* /
// ctx.edge.* y los eventos del bus: si A marca `ctx.ui.external = { tour, photo, edge }` (o pone
// `ctx.tour.externalUi = true`), este módulo no crea nada. Tokens HUD del spec §2.1, sin glow ni emoji.
const CSS = `
.fv-ui{position:fixed;z-index:30;font-family:var(--font,system-ui,sans-serif);color:#E6EBF2;pointer-events:none}
.fv-plate{background:rgba(8,10,14,.72);border:1px solid rgba(230,235,242,.14);border-radius:8px;padding:4px 10px}
.fv-label{left:max(12px,env(safe-area-inset-left));bottom:max(96px,calc(env(safe-area-inset-bottom) + 72px));max-width:min(78vw,360px);
  opacity:0;transform:translateY(4px);transition:opacity .28s ease-out,transform .28s ease-out}
.fv-label.on{opacity:1;transform:none}
.fv-label b{display:block;font-size:16px;font-weight:600;line-height:1.3}
.fv-label span{display:block;font-size:12px;font-weight:500;color:#B7C2D0;line-height:1.35;margin-top:1px}
.fv-label small{display:block;font:500 12px var(--mono,ui-monospace,monospace);color:#B7C2D0;margin-top:2px}
.fv-bar{right:max(12px,env(safe-area-inset-right));bottom:max(96px,calc(env(safe-area-inset-bottom) + 72px));display:flex;gap:8px;pointer-events:auto}
.fv-btn{width:44px;height:44px;border-radius:8px;background:rgba(8,10,14,.72);border:1px solid rgba(230,235,242,.18);color:#E6EBF2;
  display:grid;place-items:center;cursor:pointer;padding:0;font:600 12px var(--font,system-ui)}
.fv-btn.txt{width:auto;padding:0 12px}
.fv-btn:focus-visible{outline:2px solid #45A0E6;outline-offset:2px}
.fv-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fv-edge{left:50%;transform:translateX(-50%);bottom:max(150px,calc(env(safe-area-inset-bottom) + 130px));font-size:13px;font-weight:600;
  opacity:0;transition:opacity .15s ease-out;white-space:nowrap}
.fv-edge.on{opacity:1}
.fv-photo{left:50%;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom));width:min(94vw,520px);pointer-events:auto;padding:10px 12px}
.fv-photo .row{display:flex;align-items:center;gap:10px;margin:4px 0}
.fv-photo label{flex:0 0 76px;font-size:12px;font-weight:500;color:#B7C2D0}
.fv-photo output{flex:0 0 58px;text-align:right;font:600 12px var(--mono,ui-monospace,monospace)}
.fv-photo input[type=range]{flex:1;min-width:0;height:28px;accent-color:#45A0E6}
.fv-photo .btns{display:flex;gap:8px;margin-top:8px;justify-content:flex-end}
@media (max-width:520px){.fv-label{bottom:max(152px,calc(env(safe-area-inset-bottom) + 128px));max-width:calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))}}
@media (prefers-reduced-motion:reduce){.fv-label,.fv-edge{transition:none;transform:none}}
`;
const ICON = {
  prev: '<path d="M14 5l-7 7 7 7"/>', next: '<path d="M10 5l7 7-7 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const mk = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const btn = (k, label, fn, txt = '') => {
  const b = mk('button', 'fv-btn' + (txt ? ' txt' : ''), txt || svg(k));
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
  const label = mk('div', 'fv-ui fv-plate fv-label'); label.setAttribute('aria-live', 'polite');
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
  const plate = mk('div', 'fv-ui fv-plate fv-edge', 'Borde de la zona · gira');
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
      panel = mk('div', 'fv-ui fv-plate fv-photo'); panel.setAttribute('data-fv-photo-ui', '');
      const o = photo.opts;
      const defs = [
        ['focal', 'Focal', 18, 85, 1, o.focalMm, v => `${v} mm`, v => photo.set({ focalMm: +v })],
        ['fstop', 'Apertura', 1.8, 16, 0.1, o.fstop, v => `f/${(+v).toFixed(1)}`, v => photo.set({ fstop: +v })],
        ['ev', 'Exposición', -2, 2, 0.1, o.ev, v => `${v > 0 ? '+' : ''}${(+v).toFixed(1)} EV`, v => photo.set({ ev: +v })],
        ['hora', 'Hora', -5, 70, 1, ctx.sky.elevation > 70 ? 55 : Math.max(-5, ctx.sky.elevation), v => `${v}°`, v => photo.set({ tod: +v })],
      ];
      for (const [id, text, mn, mx, st, val, fmt, fn] of defs) {
        const r = row(id, text, mn, mx, st, val, fmt);
        const inp = r.querySelector('input'), out = r.querySelector('output');
        inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); fn(inp.value); });
        panel.append(r);
      }
      const b = mk('div', 'btns');
      b.append(btn('eye', 'Ocultar interfaz', () => photo.set({ hideHud: !photo.opts.hideHud }), 'HUD'),
        btn('cam', 'Guardar foto PNG', () => photo.capture({ download: true }), 'Foto'),
        btn('x', 'Salir del modo foto', () => photo.exit()));
      panel.append(b);
      document.body.append(panel);
    } else if (!d.active && panel) { panel.remove(); panel = null; }
  });
  return { label, bar, plate };
}
