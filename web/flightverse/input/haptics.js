// flightverse/input/haptics.js — haptic ticks (WS C).
// Android: navigator.vibrate. iOS has no vibrate(): a hidden <input type=checkbox switch>
// inside a <label>; clicking the label flips the switch and Safari 17.4+ plays the system
// "switch" tick (one tick per toggle, so patterns are several toggles). Must be created
// from/after a user gesture for iOS to honour it: init() is called on the first pointerup.
//
// Patterns (spec 6): fire 1 tick per 3 MG rounds, hit 1, kill 2, damage 1 long,
// crash 3 ticks; impact classes bounce 1, wobble 1, prop 1 long, crash 3.

const ANDROID = {
  fire: [10], hit: [10], kill: [15, 30, 15], damage: [60], bounce: [10],
  wobble: [15], prop: [60], crash: [25, 40, 25, 40, 25], respawn: [10],
};
// iOS: sequence of tick gaps (ms). 0 = one tick now; [0, 45] = two ticks 45 ms apart.
const IOS = {
  fire: [0], hit: [0], kill: [0, 70], damage: [0, 38], bounce: [0],
  wobble: [0], prop: [0, 38], crash: [0, 90, 180], respawn: [0],
};

export function createHaptics({ storageKey = 'ab.fv.controls', enabled = true, doc = typeof document !== 'undefined' ? document : null,
  nav = typeof navigator !== 'undefined' ? navigator : null, win = typeof window !== 'undefined' ? window : null } = {}) {
  let on = !!enabled;
  let label = null;
  const canVibrate = typeof nav?.vibrate === 'function';
  const touch = !!win && ('ontouchstart' in win || (nav?.maxTouchPoints || 0) > 0);
  const stats = { ticks: 0, patterns: 0, mode: canVibrate ? 'vibrate' : (touch ? 'ios-switch' : 'none') };
  const timers = new Set();

  function init() {
    if (canVibrate || !touch || !doc || label) return;
    try {
      label = doc.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-40px;top:-40px;width:24px;height:24px;opacity:0.01;'
        + 'overflow:hidden;pointer-events:none;';
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      doc.body.appendChild(label);
    } catch { label = null; }
  }

  function iosTick() {
    try { label?.click(); stats.ticks += 1; } catch { /* sin háptica */ }
  }

  function play(name) {
    if (!on) return false;
    stats.patterns += 1;
    if (canVibrate) {
      // Chrome logs an intervention (console error) for vibrate() before the first tap
      if (nav.userActivation && !nav.userActivation.hasBeenActive) return false;
      const p = ANDROID[name];
      if (!p) return false;
      try { nav.vibrate(p); stats.ticks += 1; } catch { return false; }
      return true;
    }
    if (!label) init();
    const seq = IOS[name];
    if (!label || !seq) return false;
    for (const gap of seq) {
      if (gap === 0) { iosTick(); continue; }
      const id = setTimeout(() => { timers.delete(id); iosTick(); }, gap);
      timers.add(id);
    }
    return true;
  }

  return {
    init,
    play,
    tick: () => play('hit'),
    setEnabled(v) { on = !!v; if (!on) { for (const id of timers) clearTimeout(id); timers.clear(); try { nav?.vibrate?.(0); } catch { /* */ } } },
    get enabled() { return on; },
    stats: () => ({ ...stats, enabled: on }),
    dispose() { for (const id of timers) clearTimeout(id); timers.clear(); label?.remove(); label = null; },
  };
}
