// flightverse/input/gamepad.js — standard-mapping gamepad (WS C).
//
//   LS move (fwd / strafe)      RS look (yaw + aim pitch)      LT descend      LS click ascend
//   RT fire (hold)              RB / LB next / previous weapon A boost         B brake
//   X recenter gimbal + look    Y cycle camera                 D-pad up/down gimbal +-5 deg
//   D-pad left/right weapon step                               Start pause     Select photo mode
// Dead zone 0.10, expo 0.30 (settings). Rumble: weak = hit, strong = damage.
import { axisCurve, stickCurve } from './curves.js';

export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});
export const PAD_YAW_RATE = 2.6;      // rad/s at full RS deflection
export const PAD_PITCH_RATE = 1.3;

const pressed = (b) => !!b && (typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5);
const val = (b) => (!b ? 0 : (typeof b === 'object' ? b.value : +b));

/**
 * Pure mapping of one gamepad snapshot. `prev` (object, mutated) stores the previous
 * button states to produce edges. Returns `out` (reused):
 *   { connected, fwd, strafe, lift, lookYawRate, lookPitchRate, boost, brake, fire,
 *     edges: { fireDown, fireUp, nextWeapon, prevWeapon, weaponLeft, weaponRight, camera,
 *              recenter, gimbalUp, gimbalDown, pause, photo } }
 */
export function mapGamepad(pad, prev, settings, out) {
  const e = out.edges;
  for (const k of Object.keys(e)) e[k] = false;
  if (!pad || !pad.connected) {
    out.connected = false; out.fwd = out.strafe = out.lift = 0; out.lookYawRate = out.lookPitchRate = 0;
    out.boost = out.brake = out.fire = false;
    prev.buttons = [];
    return out;
  }
  const b = pad.buttons || [];
  const ax = pad.axes || [];
  const was = prev.buttons || (prev.buttons = []);
  const down = (i) => pressed(b[i]);
  const edge = (i) => down(i) && !was[i];
  const dz = settings.padDeadzone, ex = settings.padExpo;
  const tmp = out._tmp || (out._tmp = [0, 0]);
  stickCurve(ax[0] || 0, ax[1] || 0, dz, ex, tmp);
  out.connected = true;
  out.strafe = tmp[0];
  out.fwd = -tmp[1];
  stickCurve(ax[2] || 0, ax[3] || 0, dz, ex, tmp);
  out.lookYawRate = -tmp[0] * PAD_YAW_RATE;                                   // + = turn left
  out.lookPitchRate = -tmp[1] * PAD_PITCH_RATE * (settings.invertY ? -1 : 1);
  const lt = val(b[PAD.LT]);
  out.lift = (down(PAD.LS) ? 1 : 0) - axisCurve(lt, 0.05, 0.2);
  out.boost = down(PAD.A);
  out.brake = down(PAD.B);
  const fireNow = val(b[PAD.RT]) > 0.4 || down(PAD.RT);
  e.fireDown = fireNow && !prev.fire;
  e.fireUp = !fireNow && !!prev.fire;
  out.fire = fireNow;
  prev.fire = fireNow;
  e.nextWeapon = edge(PAD.RB);
  e.prevWeapon = edge(PAD.LB);
  e.weaponLeft = edge(PAD.LEFT);
  e.weaponRight = edge(PAD.RIGHT);
  e.camera = edge(PAD.Y);
  e.recenter = edge(PAD.X);
  e.gimbalUp = edge(PAD.UP);
  e.gimbalDown = edge(PAD.DOWN);
  e.pause = edge(PAD.START);
  e.photo = edge(PAD.SELECT);
  for (let i = 0; i < 16; i++) was[i] = down(i);
  return out;
}

export function createGamepadState() {
  return {
    connected: false, fwd: 0, strafe: 0, lift: 0, lookYawRate: 0, lookPitchRate: 0,
    boost: false, brake: false, fire: false,
    edges: {
      fireDown: false, fireUp: false, nextWeapon: false, prevWeapon: false, weaponLeft: false,
      weaponRight: false, camera: false, recenter: false, gimbalUp: false, gimbalDown: false,
      pause: false, photo: false,
    },
  };
}

/** Browser wrapper: polls the first connected standard pad. */
export function createGamepad({ getPads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []) } = {}) {
  const prev = { buttons: [], fire: false };
  const out = createGamepadState();
  let index = -1;
  return {
    state: out,
    poll(settings) {
      let pad = null;
      const pads = getPads() || [];
      for (const p of pads) { if (p && p.connected && (p.mapping === 'standard' || !p.mapping)) { pad = p; break; } }
      index = pad ? pad.index : -1;
      return mapGamepad(pad, prev, settings, out);
    },
    rumble(weak, strong, ms = 120) {
      const pads = getPads() || [];
      const pad = pads[index];
      const act = pad?.vibrationActuator;
      if (!act?.playEffect) return false;
      try { act.playEffect('dual-rumble', { duration: ms, weakMagnitude: weak, strongMagnitude: strong }); return true; } catch { return false; }
    },
    get index() { return index; },
  };
}
