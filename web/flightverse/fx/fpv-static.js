// flightverse/fx/fpv-static.js — FPV "señal perdida" al chocar (WS B, ?fv=2; spec §5/§11 "Crash feedback").
// Iteración 2: un corte de señal BREVE y sutil, no una pantalla de TV rota. Total <= 400 ms:
//   prop strike  -> 260 ms      crash -> 400 ms     (entra en ~50 ms, sale con la última tercera parte)
// Capas (todas sobre el mundo, que sigue visible debajo):
//   · viñeta oscura de bordes (CSS) con franjas cromáticas laterales (rojo / cian, desplazadas)
//   · ruido ligero a <= 22 % de opacidad (canvas de baja resolución)
//   · 2-3 líneas de desgarro horizontales que saltan de sitio cada ~45 ms, con separación cromática
//   · indicador "SEÑAL" (placa HUD, borde discontinuo hostil)
// movimiento reducido: sólo un borde rojo 300 ms (sin ruido, sin desgarros).
// Sólo con la cámara FPV. Lo dispara el evento `crash` del bus (C). El bucle rAF vive SÓLO mientras dura el efecto.
const CSS = `
.fv-sig{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;contain:strict}
.fv-sig-vig{position:absolute;inset:0;opacity:0;
  background:radial-gradient(ellipse at 50% 50%,rgba(8,10,14,0) 52%,rgba(8,10,14,.46) 82%,rgba(8,10,14,.74) 100%);
  box-shadow:inset 7px 0 0 rgba(217,106,106,.22),inset -7px 0 0 rgba(108,200,255,.20)}
.fv-sig canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated}
.fv-sig-tag{position:absolute;left:50%;top:max(72px,calc(env(safe-area-inset-top) + 64px));transform:translateX(-50%);
  display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;
  background:rgba(8,10,14,.72);border:1px dashed #D96A6A;color:#E6EBF2;
  font:600 12px/1.3 var(--mono,ui-monospace,monospace);letter-spacing:.12em}
.fv-sig-tag i{width:8px;height:8px;border-radius:50%;background:#D96A6A;display:block}
.fv-sig-red{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;
  box-shadow:inset 0 0 0 5px rgba(217,106,106,.92),inset 0 0 48px 6px rgba(217,106,106,.35)}
`;
const W = 96;                 // resolución del ruido; se escala pixelado (barato: 96 x ~208)
const NOISE_ALPHA = 0.22;     // tope de opacidad del ruido
let H = 208;

export function createFpvStatic({ ctx, bus, reduced = () => false }) {
  if (!document.getElementById('fv-static-css')) {
    const st = document.createElement('style'); st.id = 'fv-static-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = document.createElement('div'); root.className = 'fv-sig'; root.setAttribute('aria-hidden', 'true');
  const vig = document.createElement('div'); vig.className = 'fv-sig-vig';
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const tag = document.createElement('div'); tag.className = 'fv-sig-tag'; tag.innerHTML = '<i></i>SEÑAL';
  const tcv = document.createElement('canvas'); tcv.width = W; tcv.height = H;
  root.append(vig, canvas, tcv, tag);
  const tg = tcv.getContext('2d');
  const red = document.createElement('div'); red.className = 'fv-static-red fv-sig-red'; red.setAttribute('aria-hidden', 'true');
  document.body.append(root, red);
  const g = canvas.getContext('2d');
  let img = g.createImageData(W, H);
  const stats = { shown: 0, last: null, lastMs: 0, skipped: 0, maxNoiseAlpha: NOISE_ALPHA };
  let raf = 0, startedAt = 0, endAt = 0, kind = 'none', lastJump = 0, tears = [];
  const isFpv = () => (ctx.controls?.cameraController?.snapshot?.().key || ctx.report?.camera?.rig) === 'fpv';

  function noise() {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 90 + ((Math.random() * 150) | 0);
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  function rollTears() {
    const n = 2 + ((Math.random() * 2) | 0);
    tears = [];
    for (let i = 0; i < n; i++) tears.push({ y: (Math.random() * H) | 0, h: 1 + ((Math.random() * 3) | 0), dx: ((Math.random() * 10) | 0) - 5 });
  }
  function drawTears() {
    // línea clara + copias roja y cian desplazadas (separación cromática del desgarro)
    tg.clearRect(0, 0, W, H);
    for (const t of tears) {
      tg.fillStyle = 'rgba(230,235,242,.85)'; tg.fillRect(0, t.y, W, t.h);
      tg.fillStyle = 'rgba(255,70,70,.9)'; tg.fillRect(t.dx, t.y + t.h, W, 1);
      tg.fillStyle = 'rgba(70,200,255,.9)'; tg.fillRect(-t.dx, t.y - 1, W, 1);
    }
  }
  function tick(now) {
    raf = 0;
    if (now >= endAt) { hide(); return; }
    const dur = endAt - startedAt, p = (now - startedAt) / dur;
    const a = Math.min(1, (now - startedAt) / 50) * Math.min(1, (endAt - now) / (dur * 0.35));
    root.style.opacity = '1';
    vig.style.opacity = a.toFixed(3);
    tag.style.opacity = a.toFixed(3);
    canvas.style.opacity = (NOISE_ALPHA * a).toFixed(3);
    tcv.style.opacity = (0.55 * a).toFixed(3);
    if (now - lastJump > 45) { lastJump = now; noise(); rollTears(); drawTears(); }
    if (p < 1) raf = requestAnimationFrame(tick);
  }
  function hide() {
    root.style.opacity = '0'; red.style.opacity = '0';
    if (raf) cancelAnimationFrame(raf);
    raf = 0; kind = 'none';
  }
  function show(energyClass, now = performance.now()) {
    if (energyClass !== 'prop' && energyClass !== 'crash') return false;
    if (!isFpv()) { stats.skipped += 1; return false; }
    const ms = energyClass === 'crash' ? 400 : 260;
    stats.shown += 1; stats.last = energyClass;
    if (reduced()) {                                       // movimiento reducido: sólo borde rojo 300 ms
      kind = 'red'; stats.lastMs = 300;
      red.style.opacity = '1';
      clearTimeout(show.t); show.t = setTimeout(hide, 300);
      return true;
    }
    const hh = Math.max(40, Math.min(300, Math.round(W * innerHeight / Math.max(1, innerWidth))));   // píxeles cuadrados en vertical y apaisado
    if (hh !== H) { H = hh; canvas.height = H; tcv.height = H; img = g.createImageData(W, H); }
    kind = 'static'; stats.lastMs = ms;
    startedAt = now; endAt = now + ms; lastJump = 0;
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
    stats: () => ({ ...stats, active: kind !== 'none', kind, until: endAt }),
    dispose() { offs.forEach(o => o()); hide(); root.remove(); red.remove(); },
  };
}
