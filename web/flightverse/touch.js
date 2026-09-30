// flightverse/touch.js — controles táctiles adaptativos y coordinación de
// overlays. Los sticks nacen bajo cada pulgar, se limitan a su zona y exponen
// un ciclo de vida explícito para BFCache/cambio de escena.

import { CONTROL_DEFAULTS, stickCurve, lookCurve, inertiaDecay, DEG } from './input/curves.js';

const ZERO_SAMPLE = Object.freeze({
  lift: 0, yaw: 0, fwd: 0, strafe: 0, active: false,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createTouchSticks(host, options = {}) {
  const touchCapable = options.force
    || (typeof window !== 'undefined' && 'ontouchstart' in window)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  if (!touchCapable || !host) return null;

  const fixedRadius = options.radius ?? null;
  const DEFAULT_RADIUS = 56;
  // v2 (?fv=2): zona izquierda = stick flotante de movimiento, derecha = zona de mirada
  // (arrastre relativo: yaw + pitch de apuntado), curvas de ajustes persistidos.
  const v2 = !!options.v2;
  const getSettings = options.settings || (() => CONTROL_DEFAULTS);
  const now = options.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const deadzone = options.deadzone ?? 0.12;
  const createElement = options.createElement
    || (tag => document.createElement(tag));
  let enabled = true;
  let disposed = false;

  const makeStick = side => {
    const zone = createElement('div');
    const base = createElement('div');
    const nub = createElement('div');
    zone.className = `vl-stick ${side}`;
    base.className = 'vl-stick-base';
    nub.className = 'vl-stick-nub';
    base.appendChild(nub);
    zone.appendChild(base);
    host.appendChild(zone);

    const state = {
      x: 0, y: 0, id: null, cx: 0, cy: 0, radius: fixedRadius ?? DEFAULT_RADIUS,
      role: 'stick',                 // 'stick' (flotante) | 'look' (arrastre relativo, solo v2)
      lx: 0, ly: 0, sx: 0, sy: 0, st: 0, lt: 0, pendX: 0, pendY: 0, vx: 0, vy: 0, lastTap: -1e9, path: 0,
    };
    // El radio sigue al tamaño CSS del aro (156px en horizontal, 112px en vertical): con 56 fijo el
    // pulgar nunca llegaba al borde del aro en landscape.
    const measureRadius = () => {
      if (fixedRadius != null) return fixedRadius;
      const half = (base.offsetWidth || 0) / 2;
      return Number.isFinite(half) && half >= 28 ? half : DEFAULT_RADIUS;
    };
    // Al rotar/redimensionar, la base quedaba en los px del gesto anterior (media pantalla fuera).
    const resetPlacement = () => {
      base.style.left = '';
      base.style.top = '';
      base.style.bottom = '';
      base.style.transform = '';
    };
    const listeners = [];
    const listen = (type, handler) => {
      zone.addEventListener(type, handler);
      listeners.push([type, handler]);
    };
    const setNub = (dx, dy) => {
      nub.style.transform = `translate(${dx * state.radius}px, ${dy * state.radius}px)`;
    };
    const reset = () => {
      if (state.id != null && zone.hasPointerCapture?.(state.id)) {
        zone.releasePointerCapture(state.id);
      }
      state.id = null;
      state.x = 0;
      state.y = 0;
      state.pendX = 0; state.pendY = 0; state.vx = 0; state.vy = 0; state.path = 0;
      setNub(0, 0);
    };
    const lookDown = event => {
      state.id = event.pointerId;
      state.lx = state.sx = event.clientX; state.ly = state.sy = event.clientY;
      state.st = state.lt = now(); state.path = 0; state.vx = 0; state.vy = 0;
      zone.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    };
    const lookMove = event => {
      const dx = event.clientX - state.lx, dy = event.clientY - state.ly;
      state.lx = event.clientX; state.ly = event.clientY;
      // expo sobre la VELOCIDAD del arrastre (px por ~16.7 ms): lento = fino, rápido = amplificado
      const t = now();
      const dtE = Math.max(4, Math.min(50, t - state.lt || 16.7));
      state.lt = t;
      const ref = 28 * dtE / 16.7;
      const expo = getSettings().lookExpo;
      state.pendX += lookCurve(dx, expo, ref); state.pendY += lookCurve(dy, expo, ref);
      state.path += Math.abs(dx) + Math.abs(dy);
      event.preventDefault?.();
    };
    const lookEnd = () => {
      const t = now();
      const tap = state.path < 12 && t - state.st < 260;
      if (tap) {
        if (t - state.lastTap < 320) { state.lastTap = -1e9; controller.recenterRequested = true; }
        else state.lastTap = t;
      }
      reset();
    };
    const down = event => {
      if (!enabled || disposed || state.id != null) return;
      if (state.role === 'look') { lookDown(event); return; }
      const rect = zone.getBoundingClientRect();
      state.radius = measureRadius();
      const radius = state.radius;
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const maxX = Math.max(radius, rect.width - radius);
      const maxY = Math.max(radius, rect.height - radius);
      state.cx = rect.left + clamp(localX, radius, maxX);
      state.cy = rect.top + clamp(localY, radius, maxY);
      base.style.left = `${state.cx - rect.left}px`;
      base.style.top = `${state.cy - rect.top}px`;
      base.style.bottom = 'auto';
      base.style.transform = 'translate(-50%, -50%)';
      state.id = event.pointerId;
      zone.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    };
    const move = event => {
      if (!enabled || disposed || event.pointerId !== state.id) return;
      if (state.role === 'look') { lookMove(event); return; }
      let dx = (event.clientX - state.cx) / state.radius;
      let dy = (event.clientY - state.cy) / state.radius;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      const dz = v2 ? 0 : deadzone;              // v2: zona muerta radial en sample() (curves.js)
      state.x = Math.abs(dx) < dz ? 0 : dx;
      state.y = Math.abs(dy) < dz ? 0 : dy;
      setNub(dx, dy);
      event.preventDefault?.();
    };
    const end = event => {
      if (event.pointerId !== state.id) return;
      if (state.role === 'look') { lookEnd(); return; }
      reset();
    };
    listen('pointerdown', down);
    listen('pointermove', move);
    listen('pointerup', end);
    listen('pointercancel', end);
    listen('lostpointercapture', end);

    return {
      zone,
      state,
      base,
      reset,
      resetPlacement,
      setEnabled(active) {
        zone.setAttribute('aria-hidden', String(!active));
        zone.classList.toggle('disabled', !active);
        if (!active) reset();
      },
      dispose() {
        reset();
        for (const [type, handler] of listeners) zone.removeEventListener(type, handler);
        zone.remove();
      },
    };
  };

  const left = makeStick('left');
  const right = makeStick('right');
  const shaped = [0, 0];

  // Geometría v2: zonas de ~50 % del ancho y ~50 % del alto (spec 6: y >= 40-50 % de la altura),
  // intercambiables (zurdo). Son inline para no depender del CSS del HUD (WS A).
  const applyLayout = () => {
    if (!v2) return;
    const st = getSettings();
    const moveSide = st.leftHanded ? right : left;
    const lookSide = st.leftHanded ? left : right;
    for (const [stick, side] of [[left, 'left'], [right, 'right']]) {
      const zs = stick.zone.style;
      zs.left = side === 'left' ? '0' : 'auto';
      zs.right = side === 'right' ? '0' : 'auto';
      zs.bottom = '0'; zs.top = 'auto';
      zs.width = '50%'; zs.maxWidth = 'none';
      zs.height = '50%';
      zs.paddingBottom = 'env(safe-area-inset-bottom)';
      zs.boxSizing = 'border-box';
      stick.zone.dataset.fvRole = stick === moveSide ? 'move' : 'look';
    }
    // mode2: ambas son sticks (legacy). Si no, una de ellas es la zona de mirada.
    const both = st.mode2;
    left.state.role = 'stick'; right.state.role = 'stick';
    if (!both) lookSide.state.role = 'look';
    for (const stick of [left, right]) {
      stick.base.style.display = stick.state.role === 'look' ? 'none' : '';
      stick.reset();
    }
  };
  applyLayout();

  const controller = {
    recenterRequested: false,
    applyLayout,
    sample() {
      if (!enabled || disposed) return { ...ZERO_SAMPLE };
      if (v2) return sampleV2();
      const active = left.state.id != null || right.state.id != null;
      if (!active) return { ...ZERO_SAMPLE };
      // RC Mode 2 real: IZQ = throttle+yaw · DER = pitch+roll.
      return {
        lift: -left.state.y,
        yaw: -left.state.x,
        fwd: -right.state.y,
        strafe: right.state.x,
        active,
      };
    },
    /** v2: (radianes) giro de mirada y pitch de apuntado acumulados desde la última llamada. */
    takeLook(dt) {
      const out = { yaw: 0, pitch: 0, touching: false };
      if (!v2 || !enabled || disposed || !(dt > 0)) return out;
      const st = getSettings();
      for (const stick of [left, right]) {
        const q = stick.state;
        if (q.role !== 'look') continue;
        const k = 1 - Math.exp(-dt / 0.018);
        let cx = q.pendX * k, cy = q.pendY * k;
        q.pendX -= cx; q.pendY -= cy;
        if (q.id != null) {
          out.touching = true;
          q.vx += (cx / dt - q.vx) * 0.25; q.vy += (cy / dt - q.vy) * 0.25;
        } else if (Math.abs(q.vx) + Math.abs(q.vy) > 1) {
          q.vx = inertiaDecay(q.vx, dt * 1000, st.lookInertiaMs);
          q.vy = inertiaDecay(q.vy, dt * 1000, st.lookInertiaMs);
          cx += q.vx * dt; cy += q.vy * dt;
        }
        out.yaw += -cx * st.lookSens * DEG;             // arrastre a la derecha = giro a la derecha (+ = izquierda)
        out.pitch += -cy * st.lookSens * DEG * (st.invertY ? -1 : 1);
      }
      return out;
    },
    consumeRecenter() {
      const r = controller.recenterRequested;
      controller.recenterRequested = false;
      return r;
    },
    reset() {
      if (disposed) return;
      left.reset();
      right.reset();
    },
    setEnabled(active) {
      if (disposed) return;
      enabled = !!active;
      left.setEnabled(enabled);
      right.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      enabled = false;
      left.dispose();
      right.dispose();
      disposed = true;
    },
  };

  function sampleV2() {
    const st = getSettings();
    const l = left.state, r = right.state;
    const moveStick = st.leftHanded ? r : l;
    const out = { lift: 0, yaw: 0, fwd: 0, strafe: 0, active: false, sprint: false, look: false };
    if (st.mode2) {
      // RC Mode 2: izquierda = throttle + yaw, derecha = pitch + roll
      stickCurve(l.x, l.y, st.deadzone, st.expo, shaped);
      out.lift = -shaped[1]; out.yaw = -shaped[0];
      stickCurve(r.x, r.y, st.deadzone, st.expo, shaped);
      out.fwd = -shaped[1]; out.strafe = shaped[0];
      out.active = l.id != null || r.id != null;
      out.sprint = Math.hypot(r.x, r.y) >= 0.95;
    } else {
      stickCurve(moveStick.x, moveStick.y, st.deadzone, st.expo, shaped);
      out.fwd = -shaped[1]; out.strafe = shaped[0];
      out.active = moveStick.id != null;
      out.sprint = Math.hypot(moveStick.x, moveStick.y) >= 0.95;     // auto-sprint al empujar > 95 %
    }
    out.look = (l.role === 'look' && l.id != null) || (r.role === 'look' && r.id != null);
    return out;
  }
  // Si la pestaña pierde foco a mitad de gesto no llega pointerup: soltar sticks.
  const releaseAll = () => controller.reset();
  const onViewportChange = () => {
    controller.reset();
    left.resetPlacement();
    right.resetPlacement();
  };
  const onVisibility = () => { if (typeof document !== 'undefined' && document.hidden) releaseAll(); };
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  win?.addEventListener?.('blur', releaseAll);
  win?.addEventListener?.('resize', onViewportChange);
  win?.addEventListener?.('orientationchange', onViewportChange);
  doc?.addEventListener?.('visibilitychange', onVisibility);
  const baseDispose = controller.dispose;
  controller.dispose = () => {
    win?.removeEventListener?.('blur', releaseAll);
    win?.removeEventListener?.('resize', onViewportChange);
    win?.removeEventListener?.('orientationchange', onViewportChange);
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    baseDispose();
  };
  controller.setEnabled(true);
  return controller;
}

export function createOverlayCoordinator({
  eventRoot = document,
  scrim,
  overlays = {},
  inertTargets = [],
  onChange = null,
} = {}) {
  let current = null;
  let disposed = false;
  let restoreFocus = null;
  const focusableSelector = [
    '[autofocus]',
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const focusableWithin = panel => [...(panel?.querySelectorAll?.(focusableSelector) || [])]
    .filter(node => !node.inert && node.getAttribute?.('aria-hidden') !== 'true');

  const apply = name => {
    const previous = current;
    const next = name && overlays[name] ? name : null;
    if (!previous && next) {
      restoreFocus = eventRoot?.activeElement || overlays[next]?.trigger || null;
    }
    current = next;
    for (const [key, overlay] of Object.entries(overlays)) {
      const active = key === current;
      overlay.panel?.classList.toggle(overlay.openClass || 'show', active);
      if (overlay.panel && !overlay.panel.getAttribute?.('role')) {
        overlay.panel.setAttribute('role', 'dialog');
      }
      overlay.panel?.setAttribute('aria-hidden', String(!active));
      overlay.panel?.setAttribute('aria-modal', String(active));
      if (overlay.panel) overlay.panel.inert = !active;
      overlay.trigger?.setAttribute('aria-expanded', String(active));
    }
    for (const target of inertTargets) {
      if (!target) continue;
      target.inert = !!current;
      target.setAttribute?.('aria-hidden', String(!!current));
    }
    scrim?.classList.toggle('open', !!current);
    scrim?.setAttribute('aria-hidden', String(!current));
    onChange?.(current);
    if (current) {
      const overlay = overlays[current];
      const focusTarget = typeof overlay.initialFocus === 'string'
        ? overlay.panel?.querySelector?.(overlay.initialFocus)
        : overlay.initialFocus
          || focusableWithin(overlay.panel)[0]
          || overlay.panel;
      if (focusTarget === overlay.panel && !focusTarget?.getAttribute?.('tabindex')) {
        focusTarget?.setAttribute?.('tabindex', '-1');
      }
      focusTarget?.focus?.({ preventScroll: true });
    } else if (previous && restoreFocus) {
      restoreFocus.focus?.({ preventScroll: true });
      restoreFocus = null;
    }
    return current;
  };
  const dismiss = event => {
    if (current && overlays[current]?.dismissible === false) return;
    event?.preventDefault?.();
    apply(null);
  };
  const onKeydown = event => {
    if (!current) return;
    if (event.key === 'Escape') {
      dismiss(event);
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = overlays[current]?.panel;
    const focusable = focusableWithin(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel?.focus?.({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = eventRoot?.activeElement;
    if (!panel?.contains?.(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus?.({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus?.({ preventScroll: true });
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus?.({ preventScroll: true });
    }
  };
  scrim?.addEventListener('pointerdown', dismiss);
  eventRoot?.addEventListener('keydown', onKeydown);
  apply(null);

  return {
    open(name) {
      if (disposed || !overlays[name]) return null;
      return apply(name);
    },
    close(name = current) {
      if (disposed || (name && name !== current)) return current;
      return apply(null);
    },
    toggle(name) {
      if (disposed || !overlays[name]) return null;
      return current === name ? apply(null) : apply(name);
    },
    active() { return current; },
    dispose() {
      if (disposed) return;
      scrim?.removeEventListener('pointerdown', dismiss);
      eventRoot?.removeEventListener('keydown', onKeydown);
      apply(null);
      disposed = true;
    },
  };
}
