// flightverse/ui/hud2.js — HUD v2 "Instrument Graphite" (WS A, solo con ?fv=2).
// UNA gramática de instrumentos para todas las cámaras (spec §2): icono de volver + pausa arriba,
// placa de contexto / cinta de rumbo al centro, cintas de velocidad y altitud (en no-FPV solo
// placas numéricas), retícula en pantalla y extras FPV (escalera + horizonte). Sin los elementos
// del §2.6. El DOM lleva texto/placas; el único canvas (reticle.js) lleva retícula/cintas/flechas.
//
// API pública (ctx.ui.hud) para B/C/D/E — ver docs/FLIGHTVERSE_DESIGN_SPEC.md §15.2 y ui/index.js:
//   setReticle(kind, state)  kind: gun|missile|swarm|rail|nova · state: {screen|point, spreadPx, heat,
//                            overheated, cool(0..1, 1 = listo), charge, swarm(0..8), splashPx}
//   hitMarker(type)          'hit' | 'graze' | 'deflect' | 'kill'
//   damageArc(angleRad)      0 = arriba, sentido horario; máx 3 simultáneos
//   setLock({state, progress, world|rect}|null)   state: acquiring | locked | incoming
//   setPipper({world|screen, locked}|null)
//   setThreats([{pos:{x,y,z}, hp(0..1), locked, tiered}])   marcadores + flechas de borde
//   setObjective({x,y,z,label}|null)
//   setWind({speed, fromDeg, gust}) · setIntegrity(0..1) · setBattery(0..1) · setAttitude(on)
//   hitFlash() · gateFlash() · updateInvasionHud(inv, health) · announce(text) · message(text, ms)
import { combatV2Markup } from '/flightverse/ui/weapons2.js?v=368';
import { bootMarkup } from '/flightverse/ui/screens.js?v=368';
import { createHudCanvas, reticleKindFor } from '/flightverse/ui/reticle.js?v=368';
import { RIGS } from '/flightverse/runtime.js?v=368';
import { WEAPON_PROFILES } from '/flightverse/weapon-registry.js?v=368';
import { ICON } from '/flightverse/ui/icons2.js?v=368';
import { hudMenuMarkup } from '/flightverse/ui/menu2.js?v=368';
import { screensV2Markup } from '/flightverse/ui/screens2.js?v=368';

export { ICON };

/** Elementos que otros workstreams siguen buscando por id (C: cámara/gimbal/modo, E: goto/ghost, volar.js:
 *  vista/calidad/escena). Viven ocultos; sin clases legacy. */
const compatMarkup = () => `    <div id="hx-compat" hidden aria-hidden="true">
      <span id="vl-rig"></span><span id="vl-mode"></span><span id="vl-ghost"></span><small id="vl-scene"></small>
      <button id="vl-goto" type="button" tabindex="-1"></button>
      <button id="vl-vista" type="button" tabindex="-1"></button>
      <button id="vl-calidad" type="button" tabindex="-1"></button>
      <button id="vl-sound" type="button" tabindex="-1"></button>
      <button id="vl-rec" type="button" tabindex="-1"></button>
      <button id="vl-camera-toggle" type="button" tabindex="-1"><output>FPV</output></button>
      <button id="vl-camera-picker-toggle" type="button" tabindex="-1"></button>
      <button id="vl-gimbal-toggle" type="button" tabindex="-1"><output>-7°</output></button>
    </div>
`;

const topMarkup = () => `    <div class="hx-scrim top" aria-hidden="true"></div>
    <div class="hx-top">
      <a class="hx-ibtn" id="hx-back" href="mundo.html" aria-label="Volver al Mundo">${ICON.back}</a>
      <div class="hx-tcenter">
        <div class="hx-plate hx-mission" id="vl-challenge" role="status" aria-live="off"></div>
        <button class="hx-compass" id="hx-compass" type="button" aria-label="Cambiar cámara. Mantén para ver todas"></button>
        <div class="hx-plate hx-sub" id="hx-sub"></div>
      </div>
      <button class="hx-ibtn" id="hx-pause" type="button" aria-label="Pausa" aria-haspopup="dialog">${ICON.pause}</button>
    </div>
    <div class="hx-left" id="hx-left">
      <div class="hx-chip" id="hx-wind" hidden><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v12M5.5 10.5L10 15.5l4.5-5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span>0 m/s</span></div>
      <div class="hx-chip" id="hx-vs" hidden><span>0.0</span></div>
      <div class="hx-att" id="hx-att" aria-hidden="true"></div>
    </div>
`;

const instrumentsMarkup = () => `    <div class="hx-fpv" id="vl-fpv" aria-hidden="true"></div>
    <div class="hx-tape l" id="hx-tape-l"><div class="hx-plate hx-read" id="hx-spd"><b>0.0</b><small>m/s</small></div></div>
    <div class="hx-tape r" id="hx-tape-r"><div class="hx-plate hx-read" id="hx-agl"><b>—</b><small>m</small></div></div>
    <output class="hx-gimbal" id="osd-gimbal" aria-live="off"></output>
    <canvas class="hx-canvas" id="hx-canvas" aria-hidden="true"></canvas>
    <canvas class="hx-minimap" id="vl-minimap" width="176" height="176" aria-hidden="true"></canvas>
    <div class="hx-rail" id="hx-rail" aria-hidden="true">
      <div class="hx-gauge" id="hx-integ" title="Casco"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-label="Casco"><path d="M10 2.500l6 2.300v4.700c0 3.700-2.500 6.200-6 8-3.500-1.800-6-4.300-6-8V4.800z"/></svg><i><b></b></i><em>100 %</em></div>
      <div class="hx-gauge" id="hx-batt" title="Batería"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-label="Batería"><rect x="2.500" y="6" width="13" height="8" rx="1.500"/><path d="M17.500 8.500v3"/></svg><i><b></b></i><em>100 %</em></div>
    </div>
    <div class="hx-keys" id="hx-keys" aria-hidden="true"><kbd>WASD</kbd> mover <kbd>Shift</kbd> turbo <kbd>Esc</kbd> pausa <kbd>1</kbd>–<kbd>6</kbd> armas</div>
    <div class="hx-count" id="vl-count" aria-hidden="true"></div>
    <div class="hx-banner" id="hx-banner" aria-hidden="true"><b></b><small></small></div>
    <div class="hx-warn" id="hx-warn" role="alert"></div>
    <div class="hx-flash" id="vl-flash" aria-hidden="true"></div>
    <div class="hx-damage" id="vl-hitfx" aria-hidden="true"></div>
    <div class="hx-live sr-only" id="hx-live" aria-live="polite" role="status"></div>
`;

/** HTML completo del HUD v2. */
export function buildHudMarkup2() {
  return `
  <div class="vl-hud hx" id="vl-hud" data-cam="fpv" data-mode="free">
` + topMarkup() + instrumentsMarkup() + combatV2Markup() + compatMarkup() + bootMarkup()
    + hudMenuMarkup() + screensV2Markup() + '  </div>';
}

const $ = s => document.querySelector(s);
const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1);

export function createHud2(ctx) {
  const { state: S, flags, bus } = ctx;
  const root = $('#vl-hud');
  const cv = createHudCanvas(ctx, { canvas: $('#hx-canvas') });
  const mm = { cv: $('#vl-minimap'), img: null, ready: false };
  const el = {
    plate: $('#vl-challenge'), sub: $('#hx-sub'), compass: $('#hx-compass'),
    spd: $('#hx-spd'), agl: $('#hx-agl'), tapeL: $('#hx-tape-l'), tapeR: $('#hx-tape-r'),
    wind: $('#hx-wind'), vs: $('#hx-vs'), att: $('#hx-att'), rail: $('#hx-rail'),
    integ: $('#hx-integ'), batt: $('#hx-batt'), count: $('#vl-count'), live: $('#hx-live'),
    hit: $('#vl-hitfx'), banner: $('#hx-banner'), warn: $('#hx-warn'), flash: $('#vl-flash'), keys: $('#hx-keys'), gimbal: $('#osd-gimbal'),
  };
  const cache = new WeakMap();
  const setText = (node, text) => {
    if (!node || cache.get(node) === text) return;
    cache.set(node, text); node.textContent = text;
  };
  const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };

  // ── estado alimentado por C (física) o derivado ──
  const phys = { wind: null, integrity: null, battery: null, invasion: null, externalThreatsAt: -9 };
  let lastT = performance.now();
  let layoutDirty = true;
  let camKey = '';
  let liveTimer = 0;
  let gimbalTimer = 0;
  let own = '';
  let frameN = 0;
  let lastIntegBand = 0, lastBattLow = false;

  const announce = text => {
    el.live.textContent = '';
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { el.live.textContent = text; }, 30);
  };
  const flashEl = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
  const hitFlash = () => { if (!ctx.ui.prefs?.reducedMotion()) flashEl(el.hit, 'go'); else { el.hit.classList.add('go'); setTimeout(() => el.hit.classList.remove('go'), 300); } };
  const gateFlash = () => flashEl(el.flash, 'hit');

  // gimbal: aparece 1.5 s tras cada cambio (C escribe #osd-gimbal.textContent)
  new MutationObserver(() => {
    el.gimbal.classList.add('on'); clearTimeout(gimbalTimer);
    gimbalTimer = setTimeout(() => el.gimbal.classList.remove('on'), 1500);
  }).observe(el.gimbal, { childList: true, characterData: true, subtree: true });

  // ── bus → HUD ──
  const offs = [];
  offs.push(bus.on('hit', d => {
    if (!d) return;
    cv.hitMarker(d.kill ? 'kill' : d.damage === 0 ? 'deflect' : d.graze ? 'graze' : 'hit');
  }));
  offs.push(bus.on('damage', d => {
    hitFlash();
    if (d?.dir && Number.isFinite(d.dir.x)) {
      const fwd = new ctx.THREE.Vector3(); ctx.camera.getWorldDirection(fwd);
      const cam = Math.atan2(fwd.x, -fwd.z);
      cv.damageArc(Math.atan2(d.dir.x, -d.dir.z) - cam);
    } else if (d && Number.isFinite(d.angle)) cv.damageArc(d.angle);
  }));
  offs.push(bus.on('crash', () => hitFlash()));
  offs.push(bus.on('wave', d => { if (d?.n) announce(`Oleada ${d.n}`); }));
  offs.push(bus.on('gate', d => { if (d) announce(`Puerta ${d.i} de ${d.n}`); }));
  offs.push(bus.on('lock', d => {
    if (!d) return;
    if (!d.target || d.state === 'lost') { cv.setLock(null); return; }
    const c = d.target.center || d.target.pos || d.target.position || d.target;
    cv.setLock({ state: d.state === 'locked' ? 'locked' : d.state === 'incoming' ? 'incoming' : 'acquiring', progress: d.progress || 0, world: c, halfPx: d.halfPx });
  }));
  offs.push(bus.on('pause', () => { layoutDirty = true; }));

  // brújula: toque = FPV ↔ Cerca ↔ Cenital; mantener = lista completa (Pausa › Cámara)
  {
    let timer = 0, long = false;
    const cyc = ['fpv', 'cerca', 'top'];
    el.compass.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; ctx.ui.menu.openPause('cam'); }, 450); });
    const up = () => clearTimeout(timer);
    el.compass.addEventListener('pointerleave', up);
    el.compass.addEventListener('pointercancel', up);
    el.compass.addEventListener('click', () => {
      clearTimeout(timer);
      if (long) { long = false; return; }
      const key = ctx.controls.cameraController?.snapshot?.().key;
      const next = cyc[(cyc.indexOf(key) + 1) % cyc.length] || 'fpv';
      const ix = RIGS.findIndex(r => r.key === next);
      if (ix >= 0) ctx.actions.setRig(ix);
    });
  }

  function init() {
    const { man } = ctx;
    if (man.assets?.ortho) {
      const im = new Image();
      im.onload = () => { mm.img = im; mm.ready = true; };
      im.src = man.assets.ortho;
    }
    resize();
  }
  function resize() { cv.resize(); layoutDirty = true; }
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 120));

  const mmXY = (x, z) => [(x / ctx.W.size_m[0] + 0.5) * mm.cv.width, (z / ctx.W.size_m[1] + 0.5) * mm.cv.height];
  function drawMinimap() {
    if (!mm.ready || !root.classList.contains('mm-on')) return;
    const { drone } = ctx, c = mm.cv.getContext('2d'), reto = S.reto, ghost = S.ghost;
    c.clearRect(0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 0.92; c.drawImage(mm.img, 0, 0, mm.cv.width, mm.cv.height); c.globalAlpha = 1;
    if (reto?.gates) for (let i = 0; i < reto.gates.length; i++) {
      const g = reto.gates[i], [gx, gz] = mmXY(g.center.x, g.center.z);
      c.beginPath(); c.arc(gx, gz, 4, 0, 7);
      c.strokeStyle = g.passed ? '#52C79A' : (i === reto.state.idx ? '#45A0E6' : '#7C8898'); c.lineWidth = 2; c.stroke();
    }
    if (ghost?.on) { const [gx, gz] = mmXY(ghost.marker.position.x, ghost.marker.position.z); c.fillStyle = '#52C79A'; c.beginPath(); c.arc(gx, gz, 3, 0, 7); c.fill(); }
    const inv = ctx.enemies?.invasion;
    if (inv?.state.on) for (const e of inv.hittables) {
      if (e.g?.userData?.dead) continue;
      const p = e.center || e.g?.position; if (!p) continue;
      const [ex, ez] = mmXY(p.x, p.z); c.fillStyle = '#D96A6A';
      c.beginPath(); c.moveTo(ex, ez - 5); c.lineTo(ex + 5, ez); c.lineTo(ex, ez + 5); c.lineTo(ex - 5, ez); c.closePath(); c.fill();
    }
    const [dx, dz] = mmXY(drone.pos.x, drone.pos.z);
    c.save(); c.translate(dx, dz); c.rotate(-drone.yaw); c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 7); c.lineTo(-6, 7); c.closePath(); c.fill(); c.restore();
  }

  /** Placa de Invasión: la llama D por frame con la run activa. */
  function updateInvasionHud(inv, health) { phys.invasion = { inv, hp: health.hp }; }

  function modeOf() {
    if (S.director) return 'director';
    if (S.replay) return 'replay';
    if (S.reto) return 'gaterush';
    if (ctx.enemies?.invasion?.state.on) return 'invasion';
    if (S.modeKey === 'cinematico') return 'tour';
    return 'free';
  }

  function missionText(mode) {
    const reto = S.reto, st = reto?.state;
    if (mode === 'director') return { main: S.director.playing ? 'Director · reproduciendo' : 'Director · edición' };
    if (mode === 'replay') return { main: 'Replay · Esc para salir' };
    if (mode === 'gaterush') {
      if (S.retoFly) return { main: 'Volando al circuito…' };
      const h = ctx.enemies?.gaterush?.hud?.();
      const DL = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
      if (st.phase === 'countdown') return { main: `Gate Rush · ${DL[st.difficulty] || ''}` };
      if (st.phase === 'running') {
        const sp = st.lastSplit && (st.t - st.lastSplit.at) < 1.6 ? `  +${fmt1(st.lastSplit.delta)}s` : '';
        const main = h ? `${h.timerText} · ${h.gate}/${h.total}${sp}` : `${st.t.toFixed(1)} s · ${Math.min(st.idx + 1, st.total)}/${st.total}${sp}`;
        const sub = h?.par ? `Par ${h.par.toFixed(1)} s · ${h.pace <= 0 ? '' : '+'}${h.pace.toFixed(1)} s${h.misses ? ` · ${h.misses} ${h.misses === 1 ? 'fallo' : 'fallos'}` : ''}` : '';
        return { main, sub };
      }
      if (st.phase === 'finished') return { main: `${st.time.toFixed(2)} s` };
      return { main: 'Gate Rush' };
    }
    if (mode === 'invasion' && ctx.modeHud?.top?.length) {
      return { main: ctx.modeHud.top[0].text, sub: ctx.modeHud.top[1]?.text || '' };
    }
    if (mode === 'invasion' && phys.invasion) {
      const { inv } = phys.invasion;
      const main = inv.phase === 'loading' ? 'Preparando invasión'
        : inv.phase === 'countdown' ? `Oleada ${inv.wave + 1} · ${Math.max(1, Math.ceil(inv.countdown))}`
          : `Oleada ${inv.wave || 1} · ${inv.alive + inv.queue.length} enemigos`;
      return { main, sub: `${inv.killed} abatidos · ${inv.score} pts${inv.combo > 1 ? ` · combo ×${inv.combo}` : ''}` };
    }
    return null;
  }

  function derivedThreats() {
    const inv = ctx.enemies?.invasion;
    if (!inv?.state.on) return [];
    const out = [];
    for (const e of inv.hittables) {
      if (e.g?.userData?.dead) continue;
      const p = e.center || e.g?.position; if (!p) continue;
      const max = e.hpMax ?? e.maxHp ?? e.hp0 ?? e.spec?.hp;
      out.push({ pos: p, hp: max && e.hp != null ? Math.max(0, Math.min(1, e.hp / max)) : undefined, tiered: e.type === 'gigante' || e.type === 'dragon' });
    }
    return out;
  }

  const WEAPON_KIND = () => {
    const w = ctx.fx?.weapons?.state;
    return w ? WEAPON_PROFILES[w.weapon] : null;
  };

  /** Por frame (tras el render de la escena). */
  function update({ o, spd }) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000) || 1 / 60; lastT = now;
    const { drone, loop } = ctx;
    const snap = ctx.controls.cameraController?.snapshot?.() || { key: 'fpv', hideDrone: true };
    const fpv = !!snap.hideDrone;
    if (snap.key !== camKey) { camKey = snap.key; root.dataset.cam = fpv ? 'fpv' : 'chase'; root.dataset.rig = snap.key; layoutDirty = true; }
    const mode = modeOf();
    if (root.dataset.mode !== mode) { root.dataset.mode = mode; layoutDirty = true; }
    const modeActive = mode !== 'free' && mode !== 'tour';

    // ── placa de contexto / cinta de rumbo ──
    const mt = missionText(mode);
    const recording = ctx.tour.recorder?.recording;
    const txt = el.plate.textContent;
    const foreign = txt && txt !== own;            // avisos transitorios de C/E ('#vl-challenge')
    let want = null;
    if (mt) want = mt.main;
    else if (!foreign && recording) want = `REC ${Math.floor((ctx.tour.recorder.seconds || 0) / 60)}:${String(Math.floor((ctx.tour.recorder.seconds || 0) % 60)).padStart(2, '0')}`;
    else if (!foreign && own) want = '';
    if (want !== null) { own = want; if (el.plate.textContent !== want) el.plate.textContent = want; }
    el.plate.classList.toggle('on', !!el.plate.textContent);
    if (mt) { setText(el.sub, mt.sub || ''); setHidden(el.sub, !mt.sub); } else setHidden(el.sub, true);
    cv.state.compassOn = !mt; setHidden(el.compass, !!mt);
    if (recording) el.plate.dataset.rec = '1'; else delete el.plate.dataset.rec;

    // ── cintas ──
    const aglTxt = drone.agl == null ? '—' : drone.agl.toFixed(0);
    if (cache.get(el.spd) !== spd.toFixed(1)) { cache.set(el.spd, spd.toFixed(1)); el.spd.firstChild.textContent = spd.toFixed(1); }
    if (cache.get(el.agl) !== aglTxt) { cache.set(el.agl, aglTxt); el.agl.firstChild.textContent = aglTxt; }
    el.tapeL.classList.toggle('active', cv.state.tapes.spdAct > 0);
    el.tapeR.classList.toggle('active', cv.state.tapes.aglAct > 0);

    // ── izquierda: viento / vel. vertical ──
    const vy = drone.vel.y;
    setHidden(el.vs, Math.abs(vy) < 0.6);
    if (Math.abs(vy) >= 0.6) { setText(el.vs.firstChild, `${vy > 0 ? '↑' : '↓'} ${Math.abs(vy).toFixed(1)}`); el.vs.classList.toggle('down', vy < 0); }
    const pw = ctx.report.physics?.wind || phys.wind;
    const windOn = pw && (pw.speed > 3 || pw.gust > 0);
    setHidden(el.wind, !windOn);
    const hdg = ((-o.yaw * 180 / Math.PI) % 360 + 360) % 360;
    if (windOn) {
      const rel = ((pw.fromDeg ?? 0) + 180 - hdg) % 360;
      el.wind.firstElementChild.style.transform = `rotate(${rel.toFixed(0)}deg)`;
      setText(el.wind.lastElementChild, `${Math.round(pw.speed)} m/s`);
      el.wind.classList.toggle('warn', (pw.gust || pw.speed) > 6);
    }
    setHidden(el.att, fpv);

    // ── casco / batería (Invasión → vida; si no, física v2 cuando exista) ──
    let integ = phys.integrity, batt = phys.battery;
    const p2 = ctx.report.physics;
    if (p2) { if (p2.integrity != null) integ = p2.integrity > 1 ? p2.integrity / 100 : p2.integrity; if (p2.battery != null) batt = p2.battery > 1 ? p2.battery / 100 : p2.battery; }
    if (mode === 'invasion' && phys.invasion) integ = phys.invasion.hp / 100;
    const showInteg = integ != null && (integ < 0.999 || mode === 'invasion');
    const showBatt = batt != null && (batt < 0.999 || modeActive);
    setHidden(el.integ, !showInteg); setHidden(el.batt, !showBatt);
    setHidden(el.rail, !showInteg && !showBatt);
    if (showInteg) gauge(el.integ, integ, integ < 0.2 ? 'hostile' : integ < 0.4 ? 'cand' : 'ok');
    if (showBatt) gauge(el.batt, batt, batt < 0.2 ? 'hostile' : batt < 0.4 ? 'cand' : 'ok');
    if (integ != null) {
      const band = integ < 0.2 ? 2 : integ < 0.4 ? 1 : 0;
      if (band > lastIntegBand) announce(band === 2 ? 'Integridad crítica' : 'Integridad baja');
      lastIntegBand = band;
    }
    if (batt != null) {
      const low = batt < 0.2;
      if (low && !lastBattLow) { announce('Batería baja'); ctx.ui.screens.toast('Batería baja', 2400); }
      lastBattLow = low;
    }
    cv.setLowHealth(integ != null && integ < 0.4 ? (0.4 - integ) / 0.4 : 0);

    // ── cuenta atrás grande ──
    if (mode === 'gaterush' && !S.retoFly && S.reto.state.phase === 'countdown') {
      setText(el.count, String(Math.ceil(S.reto.state.countdown))); el.count.classList.add('show');
    } else el.count.classList.remove('show');

    // ── retícula: derivar si B no la alimenta ──
    const ws = ctx.fx?.weapons?.state;
    if (ws) {
      const prof = WEAPON_KIND();
      if (ws.weapon !== cv.state.weaponKey) {
        cv.state.weaponKey = ws.weapon;
        cv.state.kind = reticleKindFor(prof);
        cv.state.spreadPx = prof?.code === 'AC' ? 14 : 22;
      }
      if (!cv.state.externalReticle) {
        const cd = prof?.cd || prof?.rate || 1;
        cv.state.cool = prof?.auto ? 1 : 1 - Math.min(1, ws.cool / cd);
      }
    }
    // amenazas: derivadas de la horda si D/B no llaman setThreats
    if (now / 1000 - phys.externalThreatsAt > 1.5) cv.setThreats(ctx.enemies?.markerState ? [] : derivedThreats());
    cv.setModeMarkers(ctx.modeHud?.markers);
    cv.state.bossY = (el.plate.getBoundingClientRect().bottom || 44) + (el.sub.hidden ? 26 : 56);
    const mh = ctx.modeHud, b = mh?.banner;
    if (b && now - b.t0 < b.dur * 1000) {
      el.banner.firstChild.textContent = b.text; el.banner.lastChild.textContent = b.sub || '';
      el.banner.classList.add('show'); el.banner.dataset.tone = b.color === '#E0A458' ? 'cand' : '';
    } else el.banner.classList.remove('show');
    if (mh?.warn) { setText(el.warn, mh.warn); el.warn.classList.add('show'); } else el.warn.classList.remove('show');

    if ((frameN = (frameN + 1) % 20) === 0) layoutDirty = true;   // las placas de viento / vel. vertical cambian la posición del horizonte
    if (layoutDirty) {
      cv.layout({ compass: el.compass, spd: el.tapeL, agl: el.tapeR, att: el.att });
      layoutDirty = false;
    }
    cv.draw({ dt, hdg, spd, agl: drone.agl, fpv, cam: ctx.camera, showReticle: !S.director && mode !== 'replay' });
    drawMinimap();
    // minimapa solo si el modo lo necesita
    root.classList.toggle('mm-on', mode === 'gaterush' || mode === 'invasion' || mode === 'tour');
    root.classList.toggle('idle-keys', flags.coarse || S.simT > 12);
    void loop;
  }

  function gauge(node, f, tone) {
    const bar = node.querySelector('b'); bar.style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})`;
    node.dataset.tone = tone;
    setText(node.querySelector('em'), `${Math.round(f * 100)} %`);
  }

  return {
    init, update, resize, hitFlash, gateFlash, updateInvasionHud, announce,
    drawMinimap,
    message: (text, ms) => ctx.ui.screens?.toast?.(text, ms),
    setReticle: (k, s) => cv.setReticle(k, s),
    hitMarker: t => cv.hitMarker(t),
    damageArc: a => cv.damageArc(a),
    setLock: l => cv.setLock(l),
    setPipper: p => cv.setPipper(p),
    setThreats(list) { phys.externalThreatsAt = performance.now() / 1000; cv.setThreats(list); },
    setObjective: o => cv.setObjective(o),
    setWind(w) { phys.wind = w; },
    setIntegrity(f) { phys.integrity = f; },
    setBattery(f) { phys.battery = f; },
    /** E (modo foto): oculta/muestra todo el cromo del HUD (la pausa y las hojas siguen disponibles). */
    setVisible(on) { root.classList.toggle('hx-off', !on); },
    setAttitude() { /* el disco se alimenta de drone.quat; hook reservado para C */ },
    canvas: cv,
    slots: { cluster: null },
    dispose() { offs.forEach(off => off()); removeEventListener('resize', resize); },
  };
}
