// flightverse/touch.js — controles táctiles adaptativos y coordinación de
// overlays. Los sticks nacen bajo cada pulgar, se limitan a su zona y exponen
// un ciclo de vida explícito para BFCache/cambio de escena.

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

    const state = { x: 0, y: 0, id: null, cx: 0, cy: 0, radius: fixedRadius ?? DEFAULT_RADIUS };
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
      setNub(0, 0);
    };
    const down = event => {
      if (!enabled || disposed || state.id != null) return;
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
      let dx = (event.clientX - state.cx) / state.radius;
      let dy = (event.clientY - state.cy) / state.radius;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      state.x = Math.abs(dx) < deadzone ? 0 : dx;
      state.y = Math.abs(dy) < deadzone ? 0 : dy;
      setNub(dx, dy);
      event.preventDefault?.();
    };
    const end = event => {
      if (event.pointerId !== state.id) return;
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

  const controller = {
    sample() {
      if (!enabled || disposed) return { ...ZERO_SAMPLE };
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
