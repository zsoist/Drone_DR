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
