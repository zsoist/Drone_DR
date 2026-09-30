// Flightverse v2 controls (WS C): stick dead zone / expo, look zone, settings persistence,
// gamepad mapping, haptics, mouse-look shaping. Pure modules: no browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_DEFAULTS, normalizeSettings, loadSettings, saveSettings, stickCurve, axisCurve, lookCurve,
  inertiaDecay, mouseLook, STORAGE_KEY,
} from '../web/flightverse/input/curves.js';
import { mapGamepad, createGamepadState, PAD } from '../web/flightverse/input/gamepad.js';
import { createHaptics } from '../web/flightverse/input/haptics.js';
import { createTouchSticks } from '../web/flightverse/touch.js';

test('stick dead zone: nothing below 9 %, continuous at the edge, full at the rim', () => {
  const o = [0, 0];
  assert.deepEqual(stickCurve(0.08, 0, 0.09, 0.35, o), [0, 0]);
  assert.deepEqual(stickCurve(0.05, 0.05, 0.09, 0.35, o), [0, 0]);
  stickCurve(0.0901, 0, 0.09, 0.35, o);
  assert.ok(o[0] > 0 && o[0] < 0.001, `no jump at the dead-zone edge: ${o[0]}`);
  stickCurve(1, 0, 0.09, 0.35, o);
  assert.ok(Math.abs(o[0] - 1) < 1e-12);
  stickCurve(5, 0, 0.09, 0.35, o);                       // beyond the rim clamps to the unit circle
  assert.ok(Math.abs(o[0] - 1) < 1e-12);
});

test('stick expo: v = sign(x)(|x|(1-e)+e x^3) on one axis, direction preserved on two', () => {
  const o = [0, 0];
  const dz = 0.09, e = 0.35;
  for (const x of [0.2, 0.5, 0.8]) {
    const r = (x - dz) / (1 - dz);
    stickCurve(x, 0, dz, e, o);
    assert.ok(Math.abs(o[0] - (r * (1 - e) + e * r ** 3)) < 1e-12);
    stickCurve(-x, 0, dz, e, o);
    assert.ok(o[0] < 0);
  }
  stickCurve(0.4, 0.3, dz, e, o);
  assert.ok(Math.abs(o[1] / o[0] - 0.75) < 1e-9, 'direction is preserved');
  stickCurve(0.5, 0, dz, 0, o);                            // expo 0 = linear after the dead zone
  assert.ok(Math.abs(o[0] - (0.5 - dz) / (1 - dz)) < 1e-12);
  // expo softens small deflections
  const soft = stickCurve(0.4, 0, dz, 0.35, [0, 0])[0], lin = stickCurve(0.4, 0, dz, 0, [0, 0])[0];
  assert.ok(soft < lin);
});

test('gamepad axis curve and trigger dead zone', () => {
  assert.equal(axisCurve(0.09, 0.1, 0.3), 0);
  assert.ok(axisCurve(0.11, 0.1, 0.3) < 0.01);
  assert.ok(Math.abs(axisCurve(1, 0.1, 0.3) - 1) < 1e-12);
  assert.ok(axisCurve(-0.6, 0.1, 0.3) < 0);
});

test('look zone: slow drags stay linear, fast drags are amplified by expo, inertia decays in ~90 ms', () => {
  assert.ok(Math.abs(lookCurve(2, 0.25, 28) - 2 * 0.75) < 0.01, 'slow drags are 25 % finer (expo 0.25)');
  assert.ok(Math.abs(lookCurve(28, 0.25, 28) - 28) < 1e-9, 'the reference speed is 1:1');
  assert.ok(lookCurve(60, 0.25, 28) > 60 * 1.3);
  assert.ok(lookCurve(1000, 0.25, 28) <= 1000 * 2.2 + 1e-9, 'capped');
  assert.equal(lookCurve(-10, 0, 28), -10);
  const v1 = inertiaDecay(1000, 90, 90);
  assert.ok(Math.abs(v1 - 1000 / Math.E) < 1e-9);
  assert.equal(inertiaDecay(1000, 16, 0), 0);
});

test('mouse-look: 0.0022 rad/px yaw (+ = left), 0.0018 pitch, sensitivity x0.5-2 and invert Y', () => {
  const s = { ...CONTROL_DEFAULTS };
  const m = mouseLook(100, 0, s);
  assert.ok(Math.abs(m.yaw + 0.22) < 1e-12, 'mouse right turns right (negative yaw in the legacy convention)');
  const up = mouseLook(0, -100, s);
  assert.ok(Math.abs(up.pitch - 0.18) < 1e-12, 'mouse up looks up');
  assert.ok(Math.abs(mouseLook(100, 0, { ...s, mouseSens: 2 }).yaw + 0.44) < 1e-12);
  assert.ok(mouseLook(0, -100, { ...s, invertY: true }).pitch < 0);
});

test('settings: defaults, clamping, corrupt storage, persistence round trip', () => {
  assert.equal(CONTROL_DEFAULTS.deadzone, 0.09);
  assert.equal(CONTROL_DEFAULTS.expo, 0.35);
  assert.equal(CONTROL_DEFAULTS.lookSens, 0.22);
  assert.equal(CONTROL_DEFAULTS.fpvTiltDeg, 28);
  const n = normalizeSettings({ deadzone: 0.9, lookSens: 5, mouseSens: 0.01, fpvTiltDeg: 99, leftHanded: 1, junk: 1, expo: 'x' });
  assert.equal(n.deadzone, 0.2);
  assert.equal(n.lookSens, 0.45);
  assert.equal(n.mouseSens, 0.5);
  assert.equal(n.fpvTiltDeg, 30);
  assert.equal(n.leftHanded, true);
  assert.equal(n.expo, CONTROL_DEFAULTS.expo, 'non numeric keeps the default');
  assert.ok(!('junk' in n));
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadSettings(storage), { ...CONTROL_DEFAULTS });
  assert.equal(saveSettings(storage, { expo: 0.5, invertY: true }), true);
  const back = loadSettings(storage);
  assert.equal(back.expo, 0.5);
  assert.equal(back.invertY, true);
  store.set(STORAGE_KEY, '{not json');
  assert.deepEqual(loadSettings(storage), { ...CONTROL_DEFAULTS });
  assert.deepEqual(loadSettings(null), { ...CONTROL_DEFAULTS });
});

const pad = (buttons = {}, axes = [0, 0, 0, 0]) => ({
  connected: true, mapping: 'standard', axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: !!buttons[i], value: buttons[i] === true ? 1 : (buttons[i] || 0) })),
});

test('gamepad map: LS move, RS look, LT descend, RT fire, A boost, B brake, edges fire once', () => {
  const st = { ...CONTROL_DEFAULTS };
  const prev = { buttons: [], fire: false };
  const out = createGamepadState();
  mapGamepad(pad({}, [0.05, -0.05, 0, 0]), prev, st, out);
  assert.ok(Math.abs(out.fwd) === 0 && Math.abs(out.strafe) === 0);            // dead zone 0.10
  mapGamepad(pad({}, [0, -1, 0, 0]), prev, st, out);
  assert.ok(out.fwd > 0.99, 'stick up = forward');
  mapGamepad(pad({}, [1, 0, -1, 0]), prev, st, out);
  assert.ok(out.strafe > 0.99 && out.lookYawRate > 2.5, 'RS left turns left (+)');
  mapGamepad(pad({ [PAD.LT]: 1, [PAD.A]: true, [PAD.B]: true }), prev, st, out);
  assert.ok(out.lift < -0.9 && out.boost && out.brake);
  mapGamepad(pad({ [PAD.RT]: 1 }), prev, st, out);
  assert.equal(out.edges.fireDown, true); assert.equal(out.fire, true);
  mapGamepad(pad({ [PAD.RT]: 1 }), prev, st, out);
  assert.equal(out.edges.fireDown, false, 'held trigger is not a new press');
  mapGamepad(pad({}), prev, st, out);
  assert.equal(out.edges.fireUp, true);
  mapGamepad(pad({ [PAD.RB]: true, [PAD.Y]: true, [PAD.START]: true, [PAD.UP]: true }), prev, st, out);
  assert.ok(out.edges.nextWeapon && out.edges.camera && out.edges.pause && out.edges.gimbalUp);
  mapGamepad(pad({ [PAD.RB]: true, [PAD.Y]: true }), prev, st, out);
  assert.ok(!out.edges.nextWeapon && !out.edges.camera, 'edges fire once');
  mapGamepad(null, prev, st, out);
  assert.equal(out.connected, false); assert.ok(Math.abs(out.fwd) === 0);
  mapGamepad(pad({}, [0, -1, 0, -1]), prev, { ...st, invertY: true }, out);
  assert.ok(out.lookPitchRate < 0, 'invert Y flips RS pitch');
});

test('haptics: Android vibrate patterns, iOS switch ticks, disabled = silent', () => {
  const calls = [];
  const h = createHaptics({ nav: { vibrate: (p) => { calls.push(p); return true; } }, win: {}, doc: null });
  assert.equal(h.play('hit'), true);
  assert.equal(h.play('damage'), true);
  assert.deepEqual(calls, [[10], [60]]);
  h.setEnabled(false);
  assert.equal(h.play('crash'), false);
  assert.equal(calls.length, 3, 'setEnabled(false) cancels vibration (vibrate(0)) and nothing else plays');

  let clicks = 0;
  const doc = {
    createElement: (tag) => ({ tag, style: {}, children: [], setAttribute() {}, appendChild(c) { this.children.push(c); }, click() { clicks++; }, remove() {} }),
    body: { appendChild() {} },
  };
  const ios = createHaptics({ nav: { maxTouchPoints: 5 }, win: { ontouchstart: null }, doc });
  ios.init();
  assert.equal(ios.play('hit'), true);
  assert.equal(clicks, 1, 'one tick = one switch toggle');
  assert.equal(ios.stats().mode, 'ios-switch');
  ios.dispose();
});

// ---- touch: floating stick + look zone (v2) ------------------------------------------------------------
class FakeElement extends EventTarget {
  constructor(rect = { left: 0, top: 0, width: 400, height: 400 }) {
    super();
    this.rect = rect; this.style = {}; this.dataset = {}; this.children = []; this.attributes = new Map(); this.captures = new Set();
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  setAttribute(k, v) { this.attributes.set(k, v); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
}
const ptr = (type, id, x, y) => {
  const e = new Event(type);
  Object.defineProperties(e, { pointerId: { value: id }, clientX: { value: x }, clientY: { value: y } });
  return e;
};
function harness(settings = {}) {
  const st = { ...CONTROL_DEFAULTS, ...settings };
  const made = [];
  let t = 0;
  const controller = createTouchSticks(new FakeElement(), {
    force: true, radius: 56, v2: true, settings: () => st, now: () => t,
    createElement: () => { const e = new FakeElement(); made.push(e); return e; },
  });
  return { controller, left: made[0], right: made[3], st, tick: (ms) => { t += ms; } };
}

test('v2 touch: left zone is a floating move stick with dead zone + expo; look stays out of the way', () => {
  const { controller, left } = harness();
  left.dispatchEvent(ptr('pointerdown', 1, 100, 300));
  left.dispatchEvent(ptr('pointermove', 1, 100, 300 - 5));           // 5 px of 56 = 9 %: inside the dead zone
  let s = controller.sample();
  assert.ok(s.fwd === 0 || Object.is(s.fwd, -0)); assert.equal(s.active, true);
  left.dispatchEvent(ptr('pointermove', 1, 100, 300 - 56));
  s = controller.sample();
  assert.ok(Math.abs(s.fwd - 1) < 1e-9 && s.sprint === true, 'rim = full forward + auto sprint');
  left.dispatchEvent(ptr('pointermove', 1, 100 + 28, 300));
  s = controller.sample();
  assert.ok(s.strafe > 0 && s.strafe < 0.5, 'expo softens half deflection');
  assert.equal(s.lift, 0); assert.equal(s.yaw, 0);
  left.dispatchEvent(ptr('pointerup', 1, 100, 300));
  assert.equal(controller.sample().active, false);
});

test('v2 touch: right zone is a relative look drag (0.22 deg/px), keeps inertia, double tap recenters', () => {
  const { controller, right, tick } = harness();
  right.dispatchEvent(ptr('pointerdown', 5, 300, 300));
  for (let i = 1; i <= 10; i++) { tick(16.7); right.dispatchEvent(ptr('pointermove', 5, 300 + i * 10, 300)); }   // 100 px at 600 px/s
  let yaw = 0, pitch = 0;
  for (let i = 0; i < 400; i++) { const l = controller.takeLook(1 / 120); yaw += l.yaw; pitch += l.pitch; }
  // 100 px * 0.22 deg/px = 22 deg to the right (negative yaw); expo 0.25 makes a 10 px / frame drag ~4 % finer
  const deg = yaw * 180 / Math.PI;
  assert.ok(deg < -16 && deg > -23, `yaw ${deg} deg`);
  assert.ok(Math.abs(pitch) < 1e-9);
  for (let i = 1; i <= 8; i++) { tick(16.7); right.dispatchEvent(ptr('pointermove', 5, 400, 300 - i * 5)); }   // drag up 40 px -> look up (+)
  let p2 = 0;
  for (let i = 0; i < 400; i++) p2 += controller.takeLook(1 / 120).pitch;
  assert.ok(p2 > 0.10 && p2 < 0.13, `pitch ${p2}`);   // 40 px at 5 px / frame: slow = 24 % finer -> ~6.7 deg
  right.dispatchEvent(ptr('pointerup', 5, 400, 260));
  assert.equal(controller.consumeRecenter(), false);
  // double tap
  tick(1000);
  right.dispatchEvent(ptr('pointerdown', 6, 300, 300)); tick(60); right.dispatchEvent(ptr('pointerup', 6, 300, 300));
  tick(120);
  right.dispatchEvent(ptr('pointerdown', 7, 302, 301)); tick(60); right.dispatchEvent(ptr('pointerup', 7, 302, 301));
  assert.equal(controller.consumeRecenter(), true);
  assert.equal(controller.consumeRecenter(), false);
});

test('v2 touch: left-handed swaps the zones, RC Mode 2 restores throttle/yaw + pitch/roll sticks', () => {
  const lh = harness({ leftHanded: true });
  lh.right.dispatchEvent(ptr('pointerdown', 1, 300, 300));
  lh.right.dispatchEvent(ptr('pointermove', 1, 300, 300 - 56));
  assert.ok(lh.controller.sample().fwd > 0.99, 'move stick is on the right when left-handed');
  lh.right.dispatchEvent(ptr('pointerup', 1, 300, 244));
  lh.left.dispatchEvent(ptr('pointerdown', 2, 100, 300));
  lh.left.dispatchEvent(ptr('pointermove', 2, 100 + 60, 300));
  assert.equal(lh.controller.sample().active, false, 'left zone is the look zone');
  assert.ok(lh.controller.takeLook(1 / 60).yaw !== 0);

  const m2 = harness({ mode2: true });
  m2.left.dispatchEvent(ptr('pointerdown', 3, 100, 300));
  m2.left.dispatchEvent(ptr('pointermove', 3, 100, 300 - 56));
  let s = m2.controller.sample();
  assert.ok(s.lift > 0.99 && s.fwd === 0, 'Mode 2: left stick up = throttle');
  m2.right.dispatchEvent(ptr('pointerdown', 4, 300, 300));
  m2.right.dispatchEvent(ptr('pointermove', 4, 300 + 56, 300));
  s = m2.controller.sample();
  assert.ok(s.strafe > 0.99, 'Mode 2: right stick = roll');
});

test('legacy touch sticks are unchanged without the v2 option', () => {
  const made = [];
  const controller = createTouchSticks(new FakeElement(), { force: true, radius: 50, createElement: () => { const e = new FakeElement(); made.push(e); return e; } });
  made[3].dispatchEvent(ptr('pointerdown', 2, 100, 100));
  made[3].dispatchEvent(ptr('pointermove', 2, 200, 200));
  const s = controller.sample();
  assert.ok(Math.abs(s.strafe - Math.SQRT1_2) < 1e-9 && Math.abs(s.fwd + Math.SQRT1_2) < 1e-9);
  assert.equal('sprint' in s, false);
});
