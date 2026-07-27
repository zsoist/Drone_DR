// Deterministic ownership for the mobile fire trigger. This module deliberately
// has no Flightverse runtime dependency so lifecycle edges stay independently testable.

export function createFirePointerController({
  element,
  eventRoot = window,
  visibilityRoot = document,
  onPress,
  onRelease,
  isEnabled = () => true,
}) {
  let enabled = true;
  let disposed = false;
  let pointerId = null;
  let accepted = false;

  const cancel = (reason = 'cancel', event = null) => {
    if (pointerId == null) return false;
    const owned = pointerId;
    pointerId = null;
    const fired = accepted;
    accepted = false;
    if (element.hasPointerCapture?.(owned)) element.releasePointerCapture(owned);
    onRelease?.(reason, event, fired);
    return true;
  };

  const down = event => {
    if (disposed || !enabled || !isEnabled() || pointerId != null) return;
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    element.setPointerCapture?.(pointerId);
    accepted = onPress?.(pointerId, event) !== false;
  };

  const listeners = [];
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  listen(element, 'pointerdown', down);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(element, type, event => {
      if (event.pointerId === pointerId) cancel(type, event);
    });
  }
  listen(eventRoot, 'blur', event => cancel('blur', event));
  listen(eventRoot, 'pagehide', event => cancel('pagehide', event));
  listen(visibilityRoot, 'visibilitychange', event => {
    if (visibilityRoot.hidden) cancel('visibilitychange', event);
  });

  return {
    state: () => ({ enabled, held: pointerId != null, pointerId, accepted }),
    cancel,
    setEnabled(value) {
      enabled = !!value;
      if (!enabled) cancel('disabled');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel('dispose');
      for (const [target, type, handler] of listeners) {
        target.removeEventListener(type, handler);
      }
    },
  };
}

export function createWeaponPicker({
  trigger,
  panel,
  items,
  eventRoot = document,
  onSelect,
}) {
  let opened = false;
  let disposed = false;
  const orientationRoot = eventRoot.defaultView;

  const close = (reason = 'close') => {
    if (!opened) return false;
    opened = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (reason !== 'overlay') trigger.focus?.();
    return true;
  };
  const open = () => {
    if (disposed || opened) return opened;
    opened = true;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    return true;
  };
  const toggle = () => opened ? close('toggle') : open();
  const outside = event => {
    if (opened && !panel.contains(event.target) && !trigger.contains(event.target)) {
      close('outside');
    }
  };
  const keydown = event => {
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      close('escape');
    }
  };
  const orientation = () => close('orientation');
  const choose = event => {
    const item = event.currentTarget;
    if (item.disabled || item.getAttribute('aria-disabled') === 'true') return;
    onSelect?.(item.dataset.w);
    close('selection');
  };

  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', toggle);
  eventRoot.addEventListener('pointerdown', outside);
  eventRoot.addEventListener('keydown', keydown);
  orientationRoot?.addEventListener('orientationchange', orientation);
  for (const item of items) item.addEventListener('click', choose);

  return {
    active: () => opened,
    open,
    close,
    toggle,
    dispose() {
      if (disposed) return;
      disposed = true;
      close('dispose');
      trigger.removeEventListener('click', toggle);
      eventRoot.removeEventListener('pointerdown', outside);
      eventRoot.removeEventListener('keydown', keydown);
      orientationRoot?.removeEventListener('orientationchange', orientation);
      for (const item of items) item.removeEventListener('click', choose);
    },
  };
}

const ALLOW = 'input[type="range"],input,textarea,select,[contenteditable="true"]';

export function installFlightSurfaceGuards(root) {
  const block = event => {
    if (!event.target?.closest?.(ALLOW)) event.preventDefault();
  };
  const types = ['selectstart', 'dragstart', 'contextmenu'];
  for (const type of types) root.addEventListener(type, block);
  return {
    dispose() {
      for (const type of types) root.removeEventListener(type, block);
    },
  };
}
