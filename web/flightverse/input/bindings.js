// flightverse/input/bindings.js — pegamento de entradas (WS C): gatillo (botones de
// fuego + tecla X), palancas táctiles, teclado/atajos globales, reset por orientación,
// muestreo del input de vuelo y eco de choque. Sin lógica de UI (ver ui/*).
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { createTouchSticks } from '/flightverse/touch.js?v=367';
import { createFirePointerBindings } from '/flightverse/mobile-command.js?v=367';
import { ARSENAL } from '/flightverse/weapons.js?v=367';
import { isContinuousWeaponKey } from '/flightverse/weapon-registry.js?v=367';

export function createBindings(ctx) {
  const { state: S, actions: A, input, audio, bus } = ctx;
  const $ = ctx.$;
  const weaponsUi = ctx.ui.weapons;
  const controls = ctx.controls;
  const fireBtn = weaponsUi.fireBtn, triggerBtn = weaponsUi.triggerBtn;

  // gatillo: estado observable (window.__volar.weaponState.trigger lo vuelca)
  const triggerState = ctx.trigger;

  const releaseFiring = (source, e) => {
    if (source === 'pointer' && e?.pointerId != null
        && e.pointerId !== triggerState.pointerId) return;
    const captureId = e?.pointerId ?? triggerState.pointerId;
    for (const button of [fireBtn, triggerBtn]) {
      if (captureId != null && button.hasPointerCapture?.(captureId)) button.releasePointerCapture(captureId);
    }
    if (!triggerState.held || (source && triggerState.source !== source)) return;
    S.firing = false;
    triggerState.held = false;
    triggerState.locked = false;
    triggerState.source = null;
    triggerState.pointerId = null;
    triggerState.releases += 1;
    weaponsUi.updateTriggerUi();
  };
  const beginFiring = (source, button = null, pointerId = null) => {
    if (triggerState.held || ctx.ui.overlay?.active()) return false;
    const auto = isContinuousWeaponKey(ctx.fx.weapons.state.weapon);
    S.firing = true;
    triggerState.held = true;
    triggerState.locked = !auto;
    triggerState.source = source;
    triggerState.pointerId = pointerId;
    triggerState.mode = auto ? 'auto' : 'single';
    triggerState.presses += 1;
    if (button && pointerId != null) button.setPointerCapture(pointerId);
    if (ctx.fx.doFire()) triggerState.accepted += 1;
    weaponsUi.updateTriggerUi();
    return true;
  };
  const firePointers = createFirePointerBindings({
    elements: [fireBtn, triggerBtn],
    onPress: pointerId => beginFiring('pointer', null, pointerId),
    onRelease: (reason, event, accepted) => {
      if (accepted) releaseFiring('pointer', event);
    },
    isEnabled: () => !ctx.ui.overlay?.active(),
  });
  controls.firePointers = firePointers;
  Object.assign(A, { releaseFiring, beginFiring });

  const sticks = createTouchSticks($('#vl-hud'));
  controls.sticks = sticks;
  const resetCommandOnOrientation = () => {
    ctx.ui.weapons.picker?.close('orientation');
    controls.flightTools?.closeAll('orientation');
    firePointers.cancel('orientation');
    releaseFiring();
    sticks?.reset();
  };
  addEventListener('orientationchange', resetCommandOnOrientation);

  let lastFlightInput = {
    fwd: 0, strafe: 0, yaw: 0, lift: 0,
    boost: false, brake: false, mouseDX: 0, mouseDY: 0,
  };
  let crashed = false;     // flanco del choque blando (audio + destello)

  /** Teclado, ratón y foco: atajos globales. Registrar al final del cableado de juego. */
  function installHotkeys() {
    const modeKeys = { Digit1: 'cinematico', Digit2: 'asistido', Digit3: 'arcade', Digit4: 'dios' };
    const globalHotkeyAllowed = event => !event.defaultPrevented && !ctx.ui.overlay?.active();
    ctx.renderer.domElement.addEventListener('click', () => { if (S.modeKey === 'fpv') input.requestLock(); });
    addEventListener('keydown', e => {
      if (!globalHotkeyAllowed(e)) return;
      if (modeKeys[e.code]) A.setMode(modeKeys[e.code]);
      if (e.code === 'KeyC') A.cycleRig();
      if (e.code === 'KeyG' && S.ghost) A.toggleGhost();
      if (e.code === 'KeyH') ctx.ui.overlay.toggle('guide');
      if (e.code === 'KeyT') A.startReto(localStorage.getItem('ab.fv.gr.diff') || 'media');
      if (e.code === 'KeyP') A.cycleVista();
      if (e.code === 'KeyM') A.toggleSound();
      if (e.code === 'KeyX' && !e.repeat) beginFiring('keyboard');
      if (e.code === 'KeyZ') {
        const ks = Object.keys(ARSENAL);
        ctx.ui.weapons.setWeapon(ks[(ks.indexOf(ctx.fx.weapons.state.weapon) + 1) % ks.length]);
      }
      if (e.code === 'KeyV') A.toggleRec();
      if (e.code === 'Escape' && S.replay) A.exitReplay();
    });
    addEventListener('keyup', e => { if (e.code === 'KeyX') releaseFiring('keyboard'); });
    addEventListener('blur', () => { input.keys.clear(); releaseFiring('keyboard'); });
  }

  return {
    triggerState, releaseFiring, beginFiring, installHotkeys,
    /** Pausa/oculta: no dejar teclas ni disparo pegados. */
    onPause() {
      input.keys.clear();
      releaseFiring();
    },
    /** Vuelo manual: muestrea teclado/palancas/autotest, neutraliza con overlay y avanza la física. */
    step(dt) {
      const { drone } = ctx;
      let inp = input.sample();
      const ts = sticks?.sample();
      if (ts?.active) { inp.fwd = ts.fwd; inp.strafe = ts.strafe; inp.yaw = ts.yaw; inp.lift = ts.lift; }
      if (ctx.auto && S.simT < ctx.auto.until) inp = { fwd: 1, strafe: 0, yaw: 0.15, lift: 0.1, boost: S.simT > 2, brake: false, mouseDX: 0, mouseDY: 0 };
      if (ctx.ui.overlay?.active()) {
        inp = {
          fwd: 0, strafe: 0, yaw: 0, lift: 0,
          boost: false, brake: false, mouseDX: 0, mouseDY: 0,
        };
      }
      lastFlightInput = { ...inp };
      drone.step(dt, inp, S.modeKey);
    },
    /** Tras el paso de vuelo manual: audio + destello al primer toque blando. */
    afterStep() {
      const { drone } = ctx;
      if (drone.crashedSoft && !crashed) {
        audio.crash();
        ctx.ui.hud.hitFlash();
        bus.emit('crash', { energyClass: 'soft' });
      }
      crashed = drone.crashedSoft;
    },
    /** Volcado a window.__volar.controls. */
    report() {
      ctx.report.controls = {
        overlay: ctx.ui.overlay?.active() || null,
        flightTool: controls.flightTools?.active() || null,
        inputEnabled: input.enabled,
        keyboardKeys: input.keys.size,
        lastInput: { ...lastFlightInput },
      };
    },
    dispose() {
      removeEventListener('orientationchange', resetCommandOnOrientation);
      firePointers.dispose();
      sticks?.dispose();
    },
  };
}
