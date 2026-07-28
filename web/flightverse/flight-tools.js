// Camera and gimbal transient surfaces. Pure event ownership keeps them
// independent from Fire and the two flight sticks.

const DEG = Math.PI / 180;
const clampDegrees = value => Math.max(-90, Math.min(25, Number(value) || 0));

export function createFlightTools({
  cameraTrigger,
  cameraPickerTrigger = cameraTrigger,
  cameraPanel,
  cameraItems = [],
  gimbalTrigger,
  gimbalTray,
  gimbalRange,
  gimbalValue,
  gimbalButtons = [],
  eventRoot = document,
  visibilityRoot = document,
  onCycleCamera,
  onSelectCamera,
  onGimbal,
}) {
  const orientationRoot = eventRoot.defaultView || globalThis.window;
  const outsideOptions = { capture: true };
  const listeners = [];
  let disposed = false;
  let cameraOpen = false;
  let gimbalOpen = false;
  let gimbalDegrees = clampDegrees(gimbalRange?.value ?? -7);

  const listen = (target, type, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };

  const paintGimbal = () => {
    const rounded = Math.round(gimbalDegrees);
    if (gimbalRange) gimbalRange.value = String(rounded);
    if (gimbalValue) gimbalValue.textContent = `${rounded}°`;
    if (gimbalTrigger) {
      gimbalTrigger.setAttribute('aria-label', `Ajustar gimbal. Actual: ${rounded}°`);
      const output = gimbalTrigger.querySelector?.('output');
      if (output) output.textContent = `${rounded}°`;
    }
  };

  const closeCamera = (reason = 'close') => {
    if (!cameraOpen) return false;
    cameraOpen = false;
    cameraPanel.hidden = true;
    gimbalTrigger.hidden = false;
    cameraPickerTrigger.setAttribute('aria-expanded', 'false');
    if (!['outside', 'overlay', 'orientation', 'visibilitychange', 'pagehide', 'dispose', 'peer'].includes(reason)) {
      cameraPickerTrigger.focus?.();
    }
    return true;
  };

  const closeGimbal = (reason = 'close') => {
    if (!gimbalOpen) return false;
    gimbalOpen = false;
    gimbalTray.hidden = true;
    gimbalTrigger.setAttribute('aria-expanded', 'false');
    if (!['outside', 'overlay', 'orientation', 'visibilitychange', 'pagehide', 'dispose', 'peer'].includes(reason)) {
      gimbalTrigger.focus?.();
    }
    return true;
  };

  const openCamera = () => {
    if (disposed || cameraOpen) return cameraOpen;
    closeGimbal('peer');
    cameraOpen = true;
    cameraPanel.hidden = false;
    gimbalTrigger.hidden = true;
    cameraPickerTrigger.setAttribute('aria-expanded', 'true');
    return true;
  };

  const openGimbal = () => {
    if (disposed || gimbalOpen) return gimbalOpen;
    closeCamera('peer');
    gimbalOpen = true;
    gimbalTray.hidden = false;
    gimbalTrigger.setAttribute('aria-expanded', 'true');
    return true;
  };

  const closeAll = (reason = 'close') => {
    const cameraClosed = closeCamera(reason);
    const gimbalClosed = closeGimbal(reason);
    return cameraClosed || gimbalClosed;
  };

  const setGimbalDegrees = value => {
    gimbalDegrees = clampDegrees(value);
    paintGimbal();
    onGimbal?.(gimbalDegrees * DEG);
    return gimbalDegrees;
  };

  const cycleCamera = event => {
    if (disposed) return;
    event?.preventDefault?.();
    closeAll('peer');
    onCycleCamera?.(event?.shiftKey ? -1 : 1);
  };

  listen(cameraTrigger, 'click', cycleCamera);
  listen(cameraPickerTrigger, 'click', event => {
    event.preventDefault();
    if (cameraOpen) closeCamera('toggle');
    else openCamera();
  });
  for (const item of cameraItems) {
    listen(item, 'click', event => {
      if (disposed || item.disabled || item.getAttribute?.('aria-disabled') === 'true') return;
      event.preventDefault();
      onSelectCamera?.(item.dataset.camera);
      closeCamera('selection');
    });
  }
  listen(gimbalTrigger, 'click', event => {
    if (disposed) return;
    event.preventDefault();
    if (gimbalOpen) closeGimbal('toggle');
    else openGimbal();
  });
  listen(gimbalRange, 'input', event => setGimbalDegrees(event.target.value));
  for (const button of gimbalButtons) {
    listen(button, 'click', event => {
      if (disposed || button.disabled) return;
      event.preventDefault();
      if ('gimbalReset' in button.dataset) setGimbalDegrees(0);
      else setGimbalDegrees(gimbalDegrees + Number(button.dataset.gimbal || 0));
    });
  }
  listen(eventRoot, 'pointerdown', event => {
    if (!cameraOpen && !gimbalOpen) return;
    const target = event.target;
    if (
      cameraTrigger.contains?.(target)
      || cameraPickerTrigger.contains?.(target)
      || cameraPanel.contains?.(target)
      || gimbalTrigger.contains?.(target)
      || gimbalTray.contains?.(target)
    ) return;
    closeAll('outside');
  }, outsideOptions);
  listen(eventRoot, 'keydown', event => {
    if (event.key !== 'Escape' || (!cameraOpen && !gimbalOpen)) return;
    event.preventDefault();
    closeAll('escape');
  });
  listen(orientationRoot, 'orientationchange', () => closeAll('orientation'));
  listen(eventRoot, 'pagehide', () => closeAll('pagehide'));
  listen(visibilityRoot, 'visibilitychange', () => {
    if (visibilityRoot.hidden) closeAll('visibilitychange');
  });

  cameraPanel.hidden = true;
  gimbalTray.hidden = true;
  cameraPickerTrigger.setAttribute('aria-expanded', 'false');
  gimbalTrigger.setAttribute('aria-expanded', 'false');
  paintGimbal();

  return {
    openCamera,
    closeCamera,
    openGimbal,
    closeGimbal,
    closeAll,
    syncCamera({ key, code, label }) {
      if (disposed) return;
      cameraTrigger.dataset.camera = key;
      cameraTrigger.setAttribute('aria-label', `Cambiar cámara. Actual: ${label}`);
      const output = cameraTrigger.querySelector?.('output');
      if (output) output.textContent = code;
      for (const item of cameraItems) {
        item.setAttribute('aria-selected', String(item.dataset.camera === key));
      }
    },
    syncGimbalRadians(radians) {
      if (Number.isFinite(radians)) {
        gimbalDegrees = clampDegrees(radians / DEG);
        paintGimbal();
      }
    },
    active: () => cameraOpen ? 'camera' : gimbalOpen ? 'gimbal' : null,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeAll('dispose');
      for (const [target, type, handler, options] of listeners) {
        target.removeEventListener(type, handler, options);
      }
      listeners.length = 0;
    },
  };
}
