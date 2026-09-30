// flightverse/fx/fpv-static.js — FPV "señal perdida" al chocar (WS B, ?fv=2; spec §5 "Crash feedback").
//   prop strike  -> estática 250 ms
//   crash        -> estática 400 ms + 200 ms de fotograma congelado (el ruido se queda quieto y opaco), luego 120 ms de salida
//   reduced-motion -> borde rojo sólido 300 ms (sin ruido)
// Sólo se ve con la cámara FPV (en el resto de cámaras la cámara de restos ya cuenta el choque). Lo dispara el
// evento `crash` del bus (C) y se mantiene coherente con ctx.phys.crash.phase: si la física ya no está en
// 'wreck'/'fade' y el overlay sigue, se apaga. Un <canvas> pequeño de ruido (160x90, escalado pixelado) sin DOM pesado;
// su bucle rAF vive SÓLO mientras dura el efecto.
const CSS = `
.fv-static{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;width:100%;height:100%;image-rendering:pixelated;mix-blend-mode:normal}
.fv-static-red{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;box-shadow:inset 0 0 0 6px #D64545,inset 0 0 60px 10px rgba(214,69,69,.55)}
`;
const W = 160;
let H = 90;

export function createFpvStatic({ ctx, bus, reduced = () => false }) {
  if (!document.getElementById('fv-static-css')) {
    const st = document.createElement('style'); st.id = 'fv-static-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'fv-static'; canvas.width = W; canvas.height = H; canvas.setAttribute('aria-hidden', 'true');
  const red = document.createElement('div'); red.className = 'fv-static-red'; red.setAttribute('aria-hidden', 'true');
  document.body.append(canvas, red);
  const g = canvas.getContext('2d');
  let img = g.createImageData(W, H);
  const stats = { shown: 0, last: null, lastMs: 0, skipped: 0 };
  let until = 0, freezeAt = 0, endAt = 0, raf = 0, startedAt = 0, kind = 'none';
  const isFpv = () => (ctx.controls?.cameraController?.snapshot?.().key || ctx.report?.camera?.rig) === 'fpv';

  function noise() {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    // bandas horizontales de sincronía: 3 líneas más claras desplazadas (lectura de señal analógica)
    for (let b = 0; b < 3; b++) {
      const y = (Math.random() * H) | 0, row = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) { d[row + x] = d[row + x + 1] = d[row + x + 2] = 235; }
    }
    g.putImageData(img, 0, 0);
  }
  function tick(now) {
    raf = 0;
    if (now >= endAt) { hide(); return; }
    // alfa: entra en 40 ms; se mantiene; tras `freezeAt` el ruido no se actualiza (congelado) y sale en los últimos 120 ms
    const a = Math.min(1, (now - startedAt) / 40) * Math.min(1, (endAt - now) / 120);
    canvas.style.opacity = (0.92 * a).toFixed(3);
    if (now < freezeAt) noise();
    raf = requestAnimationFrame(tick);
  }
  function hide() {
    canvas.style.opacity = '0'; red.style.opacity = '0';
    if (raf) cancelAnimationFrame(raf);
    raf = 0; kind = 'none';
  }
  function show(energyClass, now = performance.now()) {
    if (energyClass !== 'prop' && energyClass !== 'crash') return false;
    if (!isFpv()) { stats.skipped += 1; return false; }
    const staticMs = energyClass === 'crash' ? 400 : 250;
    const freezeMs = energyClass === 'crash' ? 200 : 0;
    stats.shown += 1; stats.last = energyClass;
    if (reduced()) {                                       // movimiento reducido: borde rojo sólido 300 ms
      kind = 'red'; stats.lastMs = 300;
      red.style.opacity = '1';
      clearTimeout(show.t); show.t = setTimeout(hide, 300);
      return true;
    }
    const hh = Math.max(40, Math.min(360, Math.round(W * innerHeight / Math.max(1, innerWidth))));   // píxeles cuadrados en vertical y apaisado
    if (hh !== H) { H = hh; canvas.height = H; img = g.createImageData(W, H); }
    kind = 'static'; stats.lastMs = staticMs + freezeMs + 120;
    startedAt = now; freezeAt = now + staticMs; endAt = now + staticMs + freezeMs + 120; until = endAt;
    if (!raf) raf = requestAnimationFrame(tick);
    return true;
  }

  const offs = [
    bus.on('crash', d => { show(String(d?.energyClass || '')); }),
    bus.on('respawn', () => { if (kind !== 'none') hide(); }),     // el respawn corta cualquier resto
  ];
  return {
    show, hide,
    get active() { return kind !== 'none'; },
    get kind() { return kind; },
    stats: () => ({ ...stats, active: kind !== 'none', kind, until }),
    dispose() { offs.forEach(o => o()); hide(); canvas.remove(); red.remove(); },
  };
}
