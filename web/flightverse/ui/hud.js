// flightverse/ui/hud.js — HUD de vuelo (WS A).
// Marcado base + ensamblado del HUD completo (los fragmentos de menús, armas y
// pantallas viven en sus módulos y se concatenan en el ORDEN DOM original) y la
// actualización por frame: cintas, minimapa, OSD FPV, texto de reto/invasión.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import {
  dockMarkup, toolsLeftMarkup, gimbalToolsMarkup, gradeMarkup, panelsMarkup,
} from '/flightverse/ui/menu.js?v=367';
import { combatMarkup, commandMarkup } from '/flightverse/ui/weapons-ui.js?v=367';
import {
  bootMarkup, invasionPickerMarkup, difficultyMarkup, resultMarkup, guideMarkup, helpMarkup,
} from '/flightverse/ui/screens.js?v=367';

const hudTopMarkup = () => `  <div class="vl-hud" id="vl-hud">
    <div class="vl-corner tl">
      <a class="vl-back" href="mundo.html"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5L6.5 10 12 15.5"/></svg> Mundo</a>
      <button class="vl-chip" id="vl-share">Compartir</button>
      <div class="vl-scene" id="vl-scene"></div>
    </div>
    <div class="vl-corner tr">
      <div class="vl-metric"><span id="vl-agl">—</span><label>ALT AGL</label><i class="vl-bar"><b id="vl-agl-b"></b></i></div>
      <div class="vl-metric"><span id="vl-spd">—</span><label>VEL m/s</label><i class="vl-bar"><b id="vl-spd-b"></b></i></div>
      <div class="vl-metric"><span id="vl-vs">—</span><label>VS m/s</label><i class="vl-bar vs"><b id="vl-vs-b"></b></i></div>
    </div>
`;
const statusMarkup = () => `    <div class="vl-overlay-scrim" id="vl-overlay-scrim" aria-hidden="true"></div>
    <div class="vl-flight-status">
      <div class="vl-ghost" id="vl-ghost"></div>
      <div class="vl-fps" id="vl-fps"></div>
    </div>
`;
const hitfxMarkup = () => `    <div class="vl-hitfx" id="vl-hitfx"></div>
`;
const zhudMarkup = () => `    <div class="vl-zhud" id="vl-zhud">
      <div class="vl-zwave"><span id="vl-zwave">OLEADA 1</span><small id="vl-zkill">0 abatidos</small></div>
      <div class="vl-zscore"><b id="vl-zscore">0 PTS</b><span id="vl-zcombo">COMBO ×1</span></div>
      <div class="vl-zhp"><i id="vl-zhp"></i></div>
    </div>
`;
const challengeMarkup = () => `    <div class="vl-center-top" id="vl-challenge"></div>
`;
const instrumentsMarkup = () => `    <div class="vl-compass tape" id="vl-compass"><canvas id="vl-tape" width="560" height="68"></canvas></div>
    <div class="vl-fpv" id="vl-fpv">
      <div class="vl-fpv-cross"></div>
      <div class="vl-fpv-horizon" id="vl-horizon"><i></i></div>
      <div class="vl-osd tape-l"><div class="vl-osd-ticks" id="osd-vt"></div><b id="osd-v">0.0</b><label>M/S</label></div>
      <div class="vl-osd tape-r"><div class="vl-osd-ticks" id="osd-at"></div><b id="osd-a">0</b><label>AGL</label></div>
      <div class="vl-osd-home" id="osd-home">HOME 0 m</div>
      <div class="vl-osd-gimbal" id="osd-gimbal">GIMBAL -7°</div>
      <div class="vl-fpv-head" id="fpv-head">FLT 00:00 · HS 0.0 · VS +0.0 · DIST 0 m<span class="fh-lnk"> · LNK ●●●</span></div>
      <i class="vl-fpv-br tl"></i><i class="vl-fpv-br tr"></i><i class="vl-fpv-br bl"></i><i class="vl-fpv-br br"></i>
      <div class="vl-fpv-sig" id="fpv-sig"><i></i><i></i><i></i></div>
      <div class="vl-fpv-rec" id="fpv-rec">REC</div>
    </div>
    <div class="vl-flash" id="vl-flash"></div>
    <div class="vl-scrim top"></div><div class="vl-scrim bottom"></div>
    <canvas class="vl-minimap" id="vl-minimap" width="180" height="180"></canvas>
    <div class="vl-count" id="vl-count"></div>
`;

/** HTML completo del HUD (mismo DOM, mismo orden que el volar.js monolítico). */
export function buildHudMarkup({ touchGuide }) {
  return `
` + hudTopMarkup() + dockMarkup() + combatMarkup() + toolsLeftMarkup() + commandMarkup()
    + gimbalToolsMarkup() + statusMarkup() + bootMarkup() + hitfxMarkup() + invasionPickerMarkup()
    + zhudMarkup() + challengeMarkup() + difficultyMarkup() + instrumentsMarkup() + resultMarkup()
    + gradeMarkup() + panelsMarkup() + guideMarkup(touchGuide) + helpMarkup() + '  </div>';
}

export function mountHudMarkup() {
  const touchGuide = matchMedia('(pointer:coarse)').matches;
  document.body.insertAdjacentHTML('beforeend', buildHudMarkup({ touchGuide }));
}

const $ = s => document.querySelector(s);
const CARD8 = ['N','NE','E','SE','S','SO','O','NO'];

export function createHud(ctx) {
  const { state: S, flags } = ctx;

  // brújula de CINTA (heading tape estilo aeronave): ticks cada 5°, cardinales,
  // línea de fe central y lectura numérica — canvas 2D, un draw por frame
  const tapeCv = $('#vl-tape');
  const tapeCtx = tapeCv?.getContext('2d');
  const drawTape = hdg => {
    if (!tapeCtx) return;
    const w = tapeCv.width, h = tapeCv.height, mid = w / 2, PPD = w / 90; // ±45° visibles
    tapeCtx.clearRect(0, 0, w, h);
    tapeCtx.font = '700 20px ui-monospace, monospace';
    tapeCtx.textAlign = 'center';
    for (let d = Math.floor((hdg - 46) / 5) * 5; d <= hdg + 46; d += 5) {
      const x = mid + (d - hdg) * PPD;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 15 === 0, cardinal = dd % 45 === 0;
      tapeCtx.strokeStyle = cardinal ? 'rgba(234,242,251,.95)' : 'rgba(183,194,208,.5)';
      tapeCtx.lineWidth = cardinal ? 3 : 2;
      tapeCtx.beginPath();
      tapeCtx.moveTo(x, h - 6);
      tapeCtx.lineTo(x, h - (cardinal ? 26 : major ? 18 : 12));
      tapeCtx.stroke();
      if (cardinal) {
        tapeCtx.fillStyle = 'rgba(234,242,251,.95)';
        tapeCtx.fillText(CARD8[dd / 45], x, 26);
      } else if (major) {
        tapeCtx.fillStyle = 'rgba(138,151,168,.8)';
        tapeCtx.font = '600 15px ui-monospace, monospace';
        tapeCtx.fillText(String(dd), x, 24);
        tapeCtx.font = '700 20px ui-monospace, monospace';
      }
    }
    // línea de fe + lectura
    tapeCtx.fillStyle = '#7dffc9';
    tapeCtx.beginPath();
    tapeCtx.moveTo(mid, h - 4); tapeCtx.lineTo(mid - 7, h); tapeCtx.lineTo(mid + 7, h);
    tapeCtx.fill();
    tapeCtx.fillRect(mid - 1.5, 30, 3, h - 36);
  };

  // ── minimapa táctico: la ortofoto REAL como radar (dron/ghost/gates) ──
  const mm = { cv: $('#vl-minimap'), img: null, ready: false };
  /** Carga la ortofoto del minimapa (necesita ctx.man; se llama desde installUi). */
  function init() {
    const { man } = ctx;
    if (man.assets?.ortho) {
      const im = new Image();
      im.onload = () => { mm.img = im; mm.ready = true; };
      im.src = man.assets.ortho;
    }
  }
  const mmXY = (x, z) => [
    (x / ctx.W.size_m[0] + 0.5) * mm.cv.width,
    (z / ctx.W.size_m[1] + 0.5) * mm.cv.height,
  ];
  function drawMinimap() {
    if (!mm.ready) return;
    const { drone } = ctx;
    const reto = S.reto, ghost = S.ghost;
    const c = mm.cv.getContext('2d');
    c.clearRect(0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 0.92;
    c.drawImage(mm.img, 0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 1;
    if (reto?.gates) for (let i = 0; i < reto.gates.length; i++) {
      const g = reto.gates[i];
      const [gx, gz] = mmXY(g.center.x, g.center.z);
      c.beginPath(); c.arc(gx, gz, 3, 0, 7);
      c.strokeStyle = g.passed ? '#52C79A' : (i === reto.state.idx ? '#45A0E6' : '#566274');
      c.lineWidth = 1.6; c.stroke();
    }
    if (ghost?.on) {
      const [gx, gz] = mmXY(ghost.marker.position.x, ghost.marker.position.z);
      c.fillStyle = '#52C79A'; c.beginPath(); c.arc(gx, gz, 2.4, 0, 7); c.fill();
    }
    const [dx, dz] = mmXY(drone.pos.x, drone.pos.z);
    c.save(); c.translate(dx, dz); c.rotate(-drone.yaw);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }

  const hitFlash = () => {
    const hx = $('#vl-hitfx'); hx.classList.remove('go'); void hx.offsetWidth; hx.classList.add('go');
  };
  const gateFlash = () => {
    const fl = $('#vl-flash');
    fl.classList.remove('hit'); void fl.offsetWidth; fl.classList.add('hit');
  };

  /** Panel de oleada/puntos/vida de Invasión (solo mientras la invasión está activa). */
  function updateInvasionHud(inv, health) {
    $('#vl-zwave').textContent = inv.phase === 'loading'
      ? 'PREPARANDO INVASIÓN'
      : inv.phase === 'countdown'
        ? `OLEADA ${inv.wave + 1} · ${Math.max(1, Math.ceil(inv.countdown))}`
        : `OLEADA ${inv.wave || 1}`;
    $('#vl-zkill').textContent = `${inv.killed} abatidos · ${inv.alive + inv.queue.length} restantes`;
    $('#vl-zscore').textContent = `${inv.score} PTS`;
    $('#vl-zcombo').textContent = `COMBO ×${Math.max(1, inv.combo)}`;
    $('#vl-zcombo').classList.toggle('hot', inv.combo > 1);
    $('#vl-zhp').style.transform = `scaleX(${health.hp / 100})`;
  }

  /** Actualización por frame del HUD (llamar tras el render de la escena). */
  function update({ o, spd }) {
    const { drone, loop } = ctx;
    const director = S.director, replay = S.replay, reto = S.reto, retoFly = S.retoFly;
    drawMinimap();
    // HUD (barato: texto directo, sin re-layout)
    $('#vl-agl').textContent = drone.agl == null ? 'fuera' : `${drone.agl.toFixed(1)} m`;
    $('#vl-spd').textContent = spd.toFixed(1);
    $('#vl-spd-b').style.transform = `scaleX(${Math.min(1, spd / 40)})`;
    $('#vl-agl-b').style.transform = `scaleX(${drone.agl == null ? 0 : Math.min(1, drone.agl / 160)})`;
    const fpsNow = Math.round(loop.fps() || 0);
    $('#vl-fps').textContent = `${fpsNow} fps`;
    $('#vl-fps').classList.toggle('low', fpsNow > 0 && fpsNow < 45);
    if (ctx.controls.cameraController.snapshot().hideDrone) {
      const rollV = new ctx.THREE.Vector3(1, 0, 0).applyQuaternion(drone.quat).y;
      $('#vl-horizon').style.transform =
        `translateY(${(-o.pitch * 260).toFixed(1)}px) rotate(${(-rollV * 40).toFixed(1)}deg)`;
      $('#osd-v').textContent = spd.toFixed(1);
      $('#osd-a').textContent = drone.agl == null ? '—' : drone.agl.toFixed(0);
      $('#osd-vt').style.transform = `translateY(${(spd * 9) % 18}px)`;
      $('#osd-at').style.transform = `translateY(${((drone.agl || 0) * 4) % 18}px)`;
      $('#osd-home').textContent = `HOME ${Math.hypot(drone.pos.x, drone.pos.z).toFixed(0)} m`;
      const f = loop.fps() || 60;
      $('#fpv-sig').dataset.n = f > 50 ? 3 : f > 32 ? 2 : 1;   // señal honesta = fps
      $('#fpv-rec').classList.toggle('on', ctx.tour.recorder.recording);
      const mm2 = Math.floor(S.simT / 60), ss2 = Math.floor(S.simT % 60);
      const hs = Math.hypot(drone.vel.x, drone.vel.z), vs = drone.vel.y;
      // LNK va en su propio span: en móvil vertical (≤430px) se oculta (la señal ya se ve en el corchete) y la tira no se trunca
      $('#fpv-head').innerHTML =
        `FLT ${String(mm2).padStart(2,'0')}:${String(ss2).padStart(2,'0')} · HS ${hs.toFixed(1)} · VS ${vs >= 0 ? '+' : ''}${vs.toFixed(1)} · DIST ${Math.hypot(drone.pos.x, drone.pos.z).toFixed(0)} m<span class="fh-lnk"> · LNK ${'●'.repeat(+($('#fpv-sig').dataset.n || 3))}</span>`;
    }
    const hdg = ((-o.yaw * 180 / Math.PI) % 360 + 360) % 360;
    drawTape(hdg);
    $('#vl-vs').textContent = (drone.vel.y >= 0 ? '+' : '') + drone.vel.y.toFixed(1);
    const vsb = $('#vl-vs-b');
    vsb.style.transform = `scaleX(${Math.min(1, Math.abs(drone.vel.y) / 10)})`;
    vsb.classList.toggle('down', drone.vel.y < -0.2);
    const ch = $('#vl-challenge'), cnt = $('#vl-count');
    if (director) {
      ch.textContent = director.playing ? 'DIRECTOR · reproduciendo' : 'DIRECTOR · edición';
      cnt.classList.remove('show');
    } else if (replay) {
      ch.textContent = 'REPLAY · ESC para salir'; cnt.classList.remove('show');
    } else if (reto) {
      const st = reto.state;
      if (retoFly) {
        ch.textContent = '→ volando al circuito…'; cnt.classList.remove('show');
      } else {
      if (st.phase === 'countdown') {
        cnt.textContent = String(Math.ceil(st.countdown)); cnt.classList.add('show');
        ch.textContent = `GATE RUSH · ${st.difficulty.toUpperCase()}`;
      } else cnt.classList.remove('show');
      if (st.phase === 'running') {
        const sp = st.lastSplit && (st.t - st.lastSplit.at) < 1.6
          ? ` · +${st.lastSplit.delta.toFixed(1)}s` : '';
        ch.textContent = `T ${st.t.toFixed(1)}s · gate ${Math.min(st.idx + 1, st.total)}/${st.total}${sp}`;
      }
      if (st.phase === 'finished') ch.textContent = `GATE RUSH · ${st.time.toFixed(2)}s`;
      }
    } else {
      ch.textContent = flags.coarse ? '' : 'T · iniciar Gate Rush'; cnt.classList.remove('show');
    }
  }

  return { init, drawTape, drawMinimap, update, hitFlash, gateFlash, updateInvasionHud };
}
