// flightverse/modes/overlay.js — capa de dibujo MÍNIMA de los modos (WS D) para ?fv=2.
// Dibuja los datos que los modos publican: marcadores de enemigos (rombo 10 px + distancia),
// flechas de borde (nearest 3), barra de jefe, cronómetro/contador de Gate Rush en T-centro,
// banner de oleada y aviso "Muévete". A (ui/hud.js) puede asumir el dibujo poniendo
// ctx.ui.drawsModeHud = true: esta capa se vuelve transparente y solo deja los datos.
// Un único canvas 2D, un redibujado por frame.
const INK = '#E6EBF2', INK2 = '#B7C2D0', HOSTILE = '#D96A6A', FRIEND = '#45A0E6', CAND = '#E0A458';
const PLATE = 'rgba(8,10,14,.72)';

export function createModeOverlay(ctx) {
  const canvas = document.createElement('canvas');
  canvas.id = 'fv-modes-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
  document.body.appendChild(canvas);
  const c2 = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, safeTop = 0, topBottom = 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top);visibility:hidden';
  document.body.appendChild(probe);

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  }
  resize();
  addEventListener('resize', resize);

  const plate = (x, y, w, h, r = 8) => {
    c2.fillStyle = PLATE; c2.beginPath();
    c2.roundRect ? c2.roundRect(x, y, w, h, r) : c2.rect(x, y, w, h);
    c2.fill();
  };
  const mono = (px, wt = 600) => `${wt} ${px}px ui-monospace,SFMono-Regular,Menlo,monospace`;

  function diamond(x, y, half, stroke, fill, lw = 1.5) {
    c2.beginPath(); c2.moveTo(x, y - half); c2.lineTo(x + half, y); c2.lineTo(x, y + half); c2.lineTo(x - half, y); c2.closePath();
    if (fill) { c2.fillStyle = fill; c2.fill(); }
    c2.lineWidth = lw; c2.strokeStyle = stroke; c2.stroke();
  }

  function drawMarkers(m, t) {
    for (const k of m.markers) {
      const x = k.x * W, y = k.y * H - (k.boss ? 26 : 18);
      const tele = k.telegraphing && (Math.floor(t * 8) % 2 === 0);
      diamond(x, y, k.boss ? 8 : 6, tele ? '#fff' : HOSTILE, tele ? HOSTILE : 'rgba(217,106,106,.18)');
      c2.font = mono(12, 500); c2.textAlign = 'center'; c2.textBaseline = 'top';
      c2.fillStyle = 'rgba(8,10,14,.72)'; const label = `${k.dist} m`;
      const tw = c2.measureText(label).width + 8;
      c2.fillRect(x - tw / 2, y + 9, tw, 15);
      c2.fillStyle = INK; c2.fillText(label, x, y + 10);
      if (k.hpFrac < 0.999 && !k.boss) {           // barra 48×4 solo si está dañado
        c2.fillStyle = PLATE; c2.fillRect(x - 24, y + 27, 48, 4);
        c2.fillStyle = HOSTILE; c2.fillRect(x - 24, y + 27, 48 * k.hpFrac, 4);
      }
    }
    for (const e of m.edges) {
      const x = e.x * W, y = e.y * H;
      c2.save(); c2.translate(x, y); c2.rotate(-e.angle); c2.globalAlpha = e.opacity;
      c2.beginPath(); c2.moveTo(9, 0); c2.lineTo(-7, -8); c2.lineTo(-7, 8); c2.closePath();   // 14 px
      c2.fillStyle = e.telegraphing ? '#ff8f82' : HOSTILE; c2.fill(); c2.lineWidth = e.telegraphing ? 2.5 : 1.5; c2.strokeStyle = e.telegraphing ? '#fff' : 'rgba(8,10,14,.85)'; c2.stroke();
      c2.restore();
    }
    const boss = m.markers.find(k => k.boss) || null;
    if (m.boss) {
      const bw = Math.min(220, W - 48), x = (W - bw) / 2, y = topBottom + 20;
      c2.font = mono(12, 600); c2.textAlign = 'center'; c2.textBaseline = 'bottom';
      c2.fillStyle = INK; c2.fillText(m.boss.name, W / 2, y - 3);
      c2.fillStyle = PLATE; c2.fillRect(x, y, bw, 6);
      c2.fillStyle = HOSTILE; c2.fillRect(x, y, bw * m.boss.hpFrac, 6);
      c2.fillStyle = 'rgba(8,10,14,.9)';                                        // segmentos de 25 %
      for (let i = 1; i < 4; i++) c2.fillRect(x + (bw * i) / 4 - 0.5, y, 1, 6);
    }
    void boss;
  }

  function drawArcs(arcs, nowMs) {
    const R = Math.min(W, H) * 0.32;
    for (const a of arcs) {
      const k = 1 - (nowMs - a.t0) / 1200;
      if (k <= 0) continue;
      c2.save(); c2.globalAlpha = Math.min(1, k * 1.4); c2.lineWidth = 4; c2.strokeStyle = HOSTILE; c2.lineCap = 'butt';
      if (a.kind === 'telegraph') c2.setLineDash([10, 5]);
      c2.beginPath();
      const cx = W / 2, cy = H / 2, th = -a.angle;          // canvas y crece hacia abajo
      c2.arc(cx, cy, R, th - Math.PI / 6, th + Math.PI / 6);
      c2.stroke(); c2.restore();
    }
  }

  function topPlate(lines) {
    c2.font = mono(14, 600);
    const maxW = W - 2 * 68;                                  // deja libres el botón atrás (izq.) y pausa (der.)
    let w = Math.max(...lines.map(l => c2.measureText(l.text).width)) + 20;
    let shrink = 1;
    if (w > maxW) { shrink = Math.max(0.8, maxW / w); w = maxW; }
    const h = lines.length * 20 + 8;
    const x = (W - w) / 2, y = safeTop + 8;
    plate(x, y, w, h);
    topBottom = y + h;
    lines.forEach((l, i) => {
      c2.font = mono(Math.max(12, Math.round((l.size || 14) * shrink)), l.weight || 600); c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillStyle = l.color || INK; c2.fillText(l.text, W / 2, y + 14 + i * 20);
    });
  }

  function banner(b, nowMs) {
    const age = (nowMs - b.t0) / 1000;
    if (age > b.dur) return;
    const a = Math.min(1, age / 0.25) * Math.min(1, (b.dur - age) / 0.4);
    c2.globalAlpha = Math.max(0, a);
    const y = H * 0.27;
    plate(W / 2 - 150, y - 34, 300, b.sub ? 76 : 52, 12);
    c2.textAlign = 'center'; c2.textBaseline = 'middle';
    c2.font = '600 20px system-ui,sans-serif'; c2.fillStyle = b.color || INK; c2.fillText(b.text, W / 2, y - (b.sub ? 10 : -0));
    if (b.sub) { c2.font = '500 13px system-ui,sans-serif'; c2.fillStyle = INK2; c2.fillText(b.sub, W / 2, y + 18); }
    c2.globalAlpha = 1;
  }

  return {
    canvas,
    /** model = { markers:{markers,edges,boss}, top:[lines]|null, banner, warn } */
    draw(model, nowMs) {
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.clearRect(0, 0, W, H);
      if (ctx.ui?.drawsModeHud) return;
      topBottom = safeTop + 8;
      if (model.top?.length) topPlate(model.top);
      if (model.markers) drawMarkers(model.markers, nowMs / 1000);
      if (model.arcs?.length) drawArcs(model.arcs, nowMs);
      if (model.banner) banner(model.banner, nowMs);
      if (model.warn) {
        c2.font = mono(14, 600); c2.textAlign = 'center';
        const w = c2.measureText(model.warn).width + 24;
        plate(W / 2 - w / 2, H * 0.62, w, 28); c2.fillStyle = CAND; c2.textBaseline = 'middle';
        c2.fillText(model.warn, W / 2, H * 0.62 + 14);
      }
    },
    dispose() { removeEventListener('resize', resize); canvas.remove(); probe.remove(); },
    FRIEND,
  };
}
