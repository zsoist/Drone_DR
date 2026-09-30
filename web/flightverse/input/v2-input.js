// flightverse/input/v2-input.js — Flightverse v2 input layer (WS C), only created with ?fv=2.
//   * control settings: own persisted set (ab.fv.controls) overlaid with the player
//     preferences of ui/prefs.js (WS A: leftHanded, rcMode2, autoFire, invertY, lookSens,
//     expo, vibration, holdBoost, windPreset, reducedMotion)
//   * mouse-look with pointer lock in EVERY camera, LMB fire, RMB / Tab weapon cycle,
//     1-6 weapons, wheel = gimbal, "Haz clic para capturar el mouse" plate
//   * touch: up / down / boost buttons (spec 6), floating stick + look zone live in touch.js
//   * gamepad polling and its edge events
//   * haptics wired to the bus (fire / hit / damage / crash)
import { CONTROL_DEFAULTS, loadSettings, saveSettings, normalizeSettings, mouseLook, clamp, DEG } from './curves.js';
import { createHaptics } from './haptics.js';
import { createGamepad } from './gamepad.js';
import * as REG from '/flightverse/weapon-registry.js?v=369';

const WEAPON_FALLBACK = ['mg', 'ac', 'm', 'sw', 'rg', 'tb'];
export const weaponOrder = () => {
  const ui = REG.WEAPON_UI;
  if (!ui) return WEAPON_FALLBACK;
  return Object.keys(ui).sort((a, b) => (ui[a].slot || 99) - (ui[b].slot || 99));
};
const WIND_FROM_PREF = { calmo: 'calm', brisa: 'breezy', racheado: 'gusty' };

const STYLE = `
.vl-fv-btn{position:absolute;z-index:3;pointer-events:auto;touch-action:none;width:56px;height:56px;border-radius:50%;
  border:1px solid var(--media-line,rgba(230,235,242,.22));background:var(--media-scrim,rgba(8,10,14,.72));
  color:var(--on-media,#E6EBF2);font:600 12px var(--font,system-ui);display:flex;align-items:center;justify-content:center;
  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.vl-fv-btn.on{border-color:var(--accent,#45A0E6);color:var(--accent,#45A0E6)}
.vl-fv-btn.ud{width:44px;height:44px}
.vl-fv-btn svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.vl-fv-lock{position:fixed;left:50%;bottom:calc(18% + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:20;
  padding:6px 12px;border-radius:8px;background:var(--media-scrim,rgba(8,10,14,.72));color:var(--on-media,#E6EBF2);
  font:500 13px var(--font,system-ui);pointer-events:none;display:none}
.vl-fv-lock.show{display:block}
.vl-fv-fade{position:fixed;inset:0;z-index:50;background:#000;opacity:0;pointer-events:none}
`;

export function createV2Input(ctx, { sticks, beginFiring, releaseFiring }) {
  const { state: S, bus, input, flags, actions: A } = ctx;
  const doc = document;
  const coarse = flags.coarse;
  const storage = (() => { try { return localStorage; } catch { return null; } })();

  // ---- settings ---------------------------------------------------------------------------
  let own = loadSettings(storage);
  let cached = own, cachedAt = -1e9, dirty = true;
  const prefs = () => ctx.ui?.prefs || null;
  const build = () => {
    const p = prefs();
    const s = { ...own };
    if (p) {
      const g = k => { try { return p.get(k); } catch { return undefined; } };
      const v = g('leftHanded'); if (typeof v === 'boolean') s.leftHanded = v;
      const m2 = g('rcMode2'); if (typeof m2 === 'boolean') s.mode2 = m2;
      const af = g('autoFire'); if (typeof af === 'boolean') s.autoFire = af;
      const iy = g('invertY'); if (typeof iy === 'boolean') s.invertY = iy;
      const vib = g('vibration'); if (typeof vib === 'boolean') s.haptics = vib;
      const ex = g('expo'); if (Number.isFinite(ex)) s.expo = ex;
      const ls = g('lookSens'); if (Number.isFinite(ls)) { s.mouseSens = ls; s.lookSens = 0.22 * ls; }
    }
    return normalizeSettings(s);
  };
  const settings = {
    get() {
      const t = performance.now();
      if (dirty || t - cachedAt > 1000) { cached = build(); cachedAt = t; dirty = false; }
      return cached;
    },
    /** Patch + persist (own keys). A's prefs, when present, win for the keys it owns. */
    set(patch) {
      own = normalizeSettings({ ...own, ...patch });
      saveSettings(storage, own);
      dirty = true;
      sticks?.applyLayout?.();
      haptics.setEnabled(settings.get().haptics);
      return settings.get();
    },
    reset() { own = { ...CONTROL_DEFAULTS }; saveSettings(storage, own); dirty = true; sticks?.applyLayout?.(); return settings.get(); },
    defaults: CONTROL_DEFAULTS,
    windPreset() {
      const v = prefs()?.get?.('windPreset');
      return v && v !== 'brisa' ? (WIND_FROM_PREF[v] || null) : null;   // 'brisa' = automático (perfil / cielo)
    },
    reducedMotion() {
      try { const r = prefs()?.reducedMotion?.(); if (typeof r === 'boolean') return r; } catch { /* */ }
      try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    },
    holdBoost() { const h = prefs()?.get?.('holdBoost'); return h === undefined ? true : !!h; },
  };
  const offPrefs = bus.on('prefs', () => { dirty = true; setTimeout(placeButtons, 60); setTimeout(placeButtons, 450); sticks?.applyLayout?.(); haptics.setEnabled(settings.get().haptics); });

  // ---- haptics ------------------------------------------------------------------------------
  const haptics = createHaptics({ enabled: settings.get().haptics });
  const unlockHaptics = () => haptics.init();
  addEventListener('pointerup', unlockHaptics, { once: true, passive: true });
  let lastImpactHaptic = -1e9;
  let mgRounds = 0;
  const offs = [
    bus.on('fire', d => {
      const w = d?.weapon;
      if (w === 'mg') { mgRounds += 1; if (mgRounds % 3 === 1) haptics.play('fire'); } else haptics.play('fire');
    }),
    bus.on('hit', d => { haptics.play(d?.kill ? 'kill' : 'hit'); gamepad.rumble(0.3, 0, 60); }),
    bus.on('damage', d => {
      if (performance.now() - lastImpactHaptic < 120) return;      // el impacto ya vibró
      haptics.play('damage'); gamepad.rumble(0, 0.8, 140);
    }),
    bus.on('crash', d => {
      const name = d?.energyClass;
      if (!['bounce', 'wobble', 'prop', 'crash'].includes(name)) return;
      lastImpactHaptic = performance.now();
      haptics.play(name);
      if (name === 'prop' || name === 'crash') gamepad.rumble(0.4, 1, 260);
    }),
  ];

  // ---- gamepad ---------------------------------------------------------------------------------
  const gamepad = createGamepad();
  let padAt = -1e9;
  let padState = gamepad.state;
  const cycleWeapon = (dir) => {
    const order = weaponOrder();
    const cur = ctx.fx?.weapons?.state?.weapon;
    const fam = REG.WEAPON_FAMILY?.[cur] || cur;
    const i = Math.max(0, order.indexOf(fam));
    ctx.ui.weapons.setWeapon(order[(i + dir + order.length) % order.length]);
  };
  const setSlot = (n) => { const order = weaponOrder(); if (order[n]) ctx.ui.weapons.setWeapon(order[n]); };
  let lastWeaponKey = null;
  const recenter = () => {
    ctx.drone.pitch = 0;
    ctx.controls.camera?.setGimbal?.(ctx.controls.camera.defaultGimbal ?? -7 * DEG);
  };
  const openPause = () => (A.openPause ? A.openPause() : (ctx.ui.overlay?.open?.('pause') || ctx.ui.overlay?.open?.('menu')));
  const pollPad = () => {
    const t = performance.now();
    if (t - padAt < 8) return padState;
    padAt = t;
    padState = gamepad.poll(settings.get());
    if (!padState.connected) return padState;
    const e = padState.edges;
    if (e.fireDown) beginFiring('gamepad');
    if (e.fireUp) releaseFiring('gamepad');
    if (e.nextWeapon || e.weaponRight) cycleWeapon(1);
    if (e.prevWeapon || e.weaponLeft) cycleWeapon(-1);
    if (e.camera) A.cycleRig?.();
    if (e.recenter) recenter();
    if (e.gimbalUp) ctx.controls.camera?.setGimbal?.(ctx.controls.camera.gimbalTilt + 5 * DEG);
    if (e.gimbalDown) ctx.controls.camera?.setGimbal?.(ctx.controls.camera.gimbalTilt - 5 * DEG);
    if (e.pause) openPause();
    if (e.photo) A.togglePhoto?.();
    return padState;
  };

  // ---- touch buttons (up / down / boost) -------------------------------------------------------
  const held = { up: false, down: false, boost: false, boostToggle: false };
  const buttons = [];
  if (coarse) {
    const style = doc.createElement('style');
    style.textContent = STYLE;
    doc.head.appendChild(style);
    buttons.push(style);
  }
  function makeButton(kind, label, svg) {
    const host = doc.querySelector('#vl-hud');
    if (!host || !coarse) return null;
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `vl-fv-btn${kind === 'boost' ? '' : ' ud'}`;
    b.dataset.fv = kind;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    b.style.position = 'fixed';
    const press = (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      if (kind === 'boost' && !settings.holdBoost()) { held.boostToggle = !held.boostToggle; b.classList.toggle('on', held.boostToggle); return; }
      held[kind] = true; b.classList.add('on');
    };
    const release = () => {
      if (kind === 'boost' && !settings.holdBoost()) return;
      held[kind] = false; b.classList.remove('on');
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    host.appendChild(b);
    buttons.push(b);
    return b;
  }
  // anclados al botón de fuego real (A lo mueve): turbo a su izquierda, subir/bajar apilados a la izquierda del turbo
  function placeButtons() {
    const fire = [doc.querySelector('#hx-fire'), doc.querySelector('#vl-trigger'), doc.querySelector('#vl-fire')]
      .map(e => e?.getBoundingClientRect()).find(r => r && r.width > 0);
    const W = innerWidth, H = innerHeight;
    const r = fire || { left: W - 12 - 76, top: H - 150, width: 76, height: 76 };
    const cy = r.top + r.height / 2;
    const place = (kind, x, y, size) => {
      const el = buttons.find(b => b.dataset?.fv === kind);
      if (!el) return;
      el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y - size / 2)}px`;
      el.style.right = 'auto'; el.style.bottom = 'auto';
    };
    // zurdo (el fuego vive en la mitad izquierda): turbo a su DERECHA y subir/bajar más allá, espejo exacto
    const left = r.left + r.width / 2 < W / 2;
    const boostX = left ? r.left + r.width + 8 : r.left - 8 - 56;
    const udX = left ? boostX + 56 + 8 : boostX - 8 - 44;
    place('boost', boostX, cy, 56);
    place('up', udX, cy - 26, 44);
    place('down', udX, cy + 26, 44);
  }
  makeButton('boost', 'Turbo', '<svg viewBox="0 0 24 24"><path d="M13 3 6 13h5l-1 8 8-11h-5z"/></svg>');
  makeButton('up', 'Subir', '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>');
  makeButton('down', 'Bajar', '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>');

  placeButtons();
  addEventListener('resize', placeButtons);
  setTimeout(placeButtons, 400);      // el CSS del HUD (hud.css) puede llegar después del primer montaje
  addEventListener('orientationchange', placeButtons);
  const placeTimer = setTimeout(placeButtons, 1500);
  buttons.push({ remove() { clearTimeout(placeTimer); removeEventListener('resize', placeButtons); removeEventListener('orientationchange', placeButtons); } });

  // ---- mouse: pointer lock in every camera, LMB fire, RMB cycle -----------------------------------
  const canvas = ctx.renderer.domElement;
  const hint = doc.createElement('div');
  hint.className = 'vl-fv-lock';
  hint.setAttribute('role', 'status');
  hint.textContent = 'Haz clic para capturar el mouse';
  if (!coarse) {
    const style = doc.createElement('style');
    style.textContent = STYLE;
    doc.head.appendChild(style);
    buttons.push(style);
    doc.body.appendChild(hint);
  }
  let hadLock = false, wantLock = false;
  const onLockChange = () => {
    const locked = doc.pointerLockElement === canvas;
    if (locked) { hadLock = true; hint.classList.remove('show'); return; }
    if (hadLock && !coarse) {
      hint.classList.add('show');
      if (!ctx.ui.overlay?.active()) openPause();               // Esc libera el puntero y pausa
    }
  };
  doc.addEventListener('pointerlockchange', onLockChange);
  let lockFailed = false;
  const onLockError = () => { lockFailed = true; wantLock = false; };
  doc.addEventListener('pointerlockerror', onLockError);
  const canLock = () => !coarse && !ctx.ui.overlay?.active() && input.enabled;
  const onPointerDown = (e) => {
    if (coarse || e.pointerType === 'touch') return;
    if (!canLock()) return;
    if (doc.pointerLockElement !== canvas && !lockFailed) {
      if (e.button === 0) { input.requestLock(); wantLock = true; }
      return;                                                   // el primer clic solo captura
    }
    // (si el navegador rechazó la captura -> pointerlockerror -> se dispara igual con el clic: sin ratón atrapado
    //  el jugador no se queda sin poder disparar)
    if (e.button === 0) beginFiring('mouse');
    else if (e.button === 2) cycleWeapon(1);
  };
  const onPointerUp = (e) => { if (e.button === 0) releaseFiring('mouse'); };
  const onContext = (e) => { e.preventDefault(); };
  canvas.addEventListener('pointerdown', onPointerDown);
  addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContext);

  // ---- per-step sampling ----------------------------------------------------------------------------
  const mousePend = { yaw: 0, pitch: 0 };
  const padLook = { yaw: 0, pitch: 0 };
  /** Merge keyboard/mouse (already in `inp`), touch, gamepad and buttons into the flight input. */
  function sample(inp, ts, dt) {
    const st = settings.get();
    // mouse look: px -> rad, smoothed over ~1 frame (nothing is lost)
    if (inp.mouseDX || inp.mouseDY) {
      const m = mouseLook(inp.mouseDX, inp.mouseDY, st);
      mousePend.yaw += m.yaw; mousePend.pitch += m.pitch;
    }
    inp.mouseDX = 0; inp.mouseDY = 0;
    const k = 1 - Math.exp(-dt / 0.012);
    let lookYaw = mousePend.yaw * k, lookPitch = mousePend.pitch * k;
    mousePend.yaw -= lookYaw; mousePend.pitch -= lookPitch;
    // touch
    if (ts) {
      if (ts.active) {
        inp.fwd = ts.fwd; inp.strafe = ts.strafe;
        if (st.mode2) { inp.yaw = ts.yaw; inp.lift = ts.lift; }
      }
      if (ts.sprint) inp.boost = true;
    }
    const look = sticks?.takeLook?.(dt);
    if (look) { lookYaw += look.yaw; lookPitch += look.pitch; }
    if (sticks?.consumeRecenter?.()) recenter();
    // gamepad
    const pad = pollPad();
    if (pad.connected) {
      if (pad.fwd) inp.fwd = clamp(inp.fwd + pad.fwd, -1, 1);
      if (pad.strafe) inp.strafe = clamp(inp.strafe + pad.strafe, -1, 1);
      if (pad.lift) inp.lift = clamp(inp.lift + pad.lift, -1, 1);
      lookYaw += pad.lookYawRate * dt;
      lookPitch += pad.lookPitchRate * dt;
      if (pad.boost) inp.boost = true;
      if (pad.brake) inp.brake = true;
    }
    // buttons
    if (held.up) inp.lift = clamp(inp.lift + 1, -1, 1);
    if (held.down) inp.lift = clamp(inp.lift - 1, -1, 1);
    if (held.boost || held.boostToggle) inp.boost = true;
    inp.lookYaw = lookYaw; inp.lookPitch = lookPitch;
    return inp;
  }

  // hotkeys that only exist with v2 (called from bindings' single keydown listener)
  function key(e) {
    if (/^Digit[1-6]$/.test(e.code)) { setSlot(+e.code.slice(5) - 1); return true; }
    if (e.code === 'Tab') { e.preventDefault(); cycleWeapon(e.shiftKey ? -1 : 1); return true; }
    return false;
  }

  return {
    settings, haptics, gamepad, sample, key, recenter, held,
    releaseLock: () => input.releaseLock(),
    get lockHint() { return hint; },
    report: () => ({
      pointerLocked: doc.pointerLockElement === canvas,
      gamepad: gamepad.state.connected,
      haptics: haptics.stats(),
      settings: settings.get(),
    }),
    dispose() {
      offPrefs(); for (const o of offs) o();
      doc.removeEventListener('pointerlockchange', onLockChange);
      doc.removeEventListener('pointerlockerror', onLockError);
      canvas.removeEventListener('pointerdown', onPointerDown);
      removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('contextmenu', onContext);
      removeEventListener('pointerup', unlockHaptics);
      for (const b of buttons) b.remove();
      hint.remove();
      haptics.dispose();
    },
  };
}
