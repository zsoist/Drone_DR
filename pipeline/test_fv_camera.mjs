// Flightverse v2 cameras (WS C): FPV uptilt + roll, chase spring arm, sphere-cast pull-in, push-out,
// orbit, crash camera, reduced motion. Pure math (camera-rigs.js has no three/DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraRigController } from '../web/flightverse/camera-rigs.js';

const DEG = Math.PI / 180;
const frame = (o = {}) => ({
  dronePosition: o.p || { x: 0, y: 50, z: 0 },
  dronePose: { yaw: o.yaw ?? 0, pitch: o.look ?? 0, roll: o.roll ?? 0, bodyPitch: o.bodyPitch ?? 0, v2: true },
  velocity: o.v || { x: 0, y: 0, z: 0 },
  dt: 1 / 120, realDt: o.dt ?? 1 / 60,
  collision: o.collision || null,
  v2opts: o.v2opts || { fpvTilt: 28 * DEG, reduced: false },
  crash: o.crash || null,
});
const settle = (c, f, n = 120) => { let s; for (let i = 0; i < n; i++) s = c.update(f()); return s; };
const pitchOf = (s) => Math.asin(s.forward[1]) / DEG;
const finite = (s) => s.finite && [...s.position, ...s.quaternion].every(Number.isFinite);

test('FPV: hover looks through the gimbal, forward lean engages the 28 deg uptilt (horizon stays level at cruise)', () => {
  const c = createCameraRigController({ initialKey: 'fpv' });
  c.setGimbalRadians(0);
  let s = settle(c, () => frame({ bodyPitch: 0 }));
  assert.ok(Math.abs(pitchOf(s)) < 0.5, `hover pitch ${pitchOf(s)}`);
  s = settle(c, () => frame({ bodyPitch: -30 * DEG }), 240);
  assert.ok(Math.abs(pitchOf(s) - (-2)) < 1.0, `cruise pitch ${pitchOf(s)} (30 deg lean - 28 deg uptilt)`);
  s = settle(c, () => frame({ bodyPitch: 20 * DEG }), 240);      // braking: nose up, no uptilt
  assert.ok(pitchOf(s) > 18, `braking pitch ${pitchOf(s)}`);
  const c2 = createCameraRigController({ initialKey: 'fpv' });
  c2.setGimbalRadians(0);
  s = settle(c2, () => frame({ bodyPitch: -30 * DEG }), 240);
  c2.update(frame({ bodyPitch: -30 * DEG, v2opts: { fpvTilt: 25 * DEG, reduced: false } }));
  const s25 = settle(c2, () => frame({ bodyPitch: -30 * DEG, v2opts: { fpvTilt: 25 * DEG, reduced: false } }), 240);
  assert.ok(pitchOf(s25) < pitchOf(s) - 2, 'the uptilt is configurable (25-30)');
});

test('FPV follows the body roll at 100 % with a ~60 ms filter; reduced motion halves it', () => {
  const c = createCameraRigController({ initialKey: 'fpv' });
  settle(c, () => frame({ roll: 0 }), 10);
  let s = c.update(frame({ roll: 20 * DEG, dt: 1 / 60 }));
  assert.ok(s.rollDegrees > 4 && s.rollDegrees < 12, `one 60 Hz frame after a step: ${s.rollDegrees}`);
  s = settle(c, () => frame({ roll: 20 * DEG }), 30);
  assert.ok(Math.abs(s.rollDegrees - 20) < 0.3);
  // the camera up vector really leans: right-bank -> up tilts toward +right
  const right = s.right, up = s.up;
  assert.ok(Math.abs(up[1] - Math.cos(20 * DEG)) < 0.01);
  assert.ok(Math.abs(Math.hypot(up[0], up[2]) - Math.sin(20 * DEG)) < 0.03);
  assert.ok(up[0] * right[0] + up[2] * right[2] > 0.3);
  const r = createCameraRigController({ initialKey: 'fpv' });
  const rs = settle(r, () => frame({ roll: 20 * DEG, v2opts: { fpvTilt: 28 * DEG, reduced: true } }), 60);
  assert.ok(Math.abs(rs.rollDegrees - 10) < 0.3, `reduced motion roll ${rs.rollDegrees}`);
  assert.equal(s.hideDrone, true);
});

test('chase spring arm: critically damped (no overshoot), 4 / 6 / 10 m arms, look-ahead in the flight direction', () => {
  const dist = (s, p) => Math.hypot(s.position[0] - p.x, s.position[1] - p.y, s.position[2] - p.z);
  for (const [key, len] of [['cerca', 4], ['lejos', 10], ['muycerca', 2.6]]) {
    const c = createCameraRigController({ initialKey: key });
    const s = settle(c, () => frame({ p: { x: 0, y: 50, z: 0 } }), 240);
    const d = dist(s, { x: 0, y: 50, z: 0 });
    assert.ok(Math.abs(d - len) < 0.35, `${key}: arm ${d} vs ${len}`);
    assert.ok(finite(s));
  }
  // drone jumps 10 m sideways in one frame (below the teleport snap): the camera follows without overshoot
  const c = createCameraRigController({ initialKey: 'cerca' });
  settle(c, () => frame({ p: { x: 0, y: 50, z: 0 } }), 240);
  let maxX = -1e9, prev = null, monotonic = true;
  for (let i = 0; i < 240; i++) {
    const s = c.update(frame({ p: { x: 6, y: 50, z: 0 }, dt: 1 / 120 }));
    maxX = Math.max(maxX, s.position[0]);
    if (prev !== null && s.position[0] < prev - 1e-9) monotonic = false;
    prev = s.position[0];
  }
  assert.ok(monotonic && maxX < 6 + 0.35 + 0.01, `overshoot ${maxX}`);
  // look-ahead: moving at 10 m/s towards -z puts the focus ahead -> the camera sits further forward than at rest
  const a = createCameraRigController({ initialKey: 'cerca' });
  const rest = settle(a, () => frame({ v: { x: 0, y: 0, z: 0 } }), 240);
  const b = createCameraRigController({ initialKey: 'cerca' });
  const fast = settle(b, () => frame({ v: { x: 0, y: 0, z: -10 } }), 240);
  assert.ok(fast.position[2] < rest.position[2] - 2, `look-ahead ${fast.position[2]} vs ${rest.position[2]}`);
});

test('yaw lag: the chase camera trails a turn with tau 0.25 s', () => {
  const c = createCameraRigController({ initialKey: 'cerca' });
  settle(c, () => frame({ yaw: 0 }), 240);
  let s;
  for (let i = 0; i < 15; i++) s = c.update(frame({ yaw: Math.PI / 2, dt: 1 / 60 }));      // 250 ms after a 90 deg turn
  const az = () => Math.atan2(s.position[0], s.position[2]) / DEG;                         // arm azimuth (0 = directly behind yaw 0)
  assert.ok(az() > 10 && az() < 65, `still trailing after 0.25 s: ${az()} deg`);
  for (let i = 0; i < 120; i++) s = c.update(frame({ yaw: Math.PI / 2, dt: 1 / 60 }));
  assert.ok(Math.abs(az() - 90) < 3, `caught up after 2 s: ${az()} deg`);
});

test('sphere-cast pull-in within ~60 ms, ease-out over ~350 ms, push-out, drone fade', () => {
  const c = createCameraRigController({ initialKey: 'cerca' });
  let fraction = null;
  const collision = { cast: () => fraction, push: () => null };
  settle(c, () => frame({ collision }), 240);
  fraction = 0.3;                                                  // a wall 1.2 m behind the drone
  let t = 0, scale = 1;
  for (; t < 0.5 && scale > 0.4; t += 1 / 120) scale = c.update(frame({ collision, dt: 1 / 120 })).armScale;
  assert.ok(t <= 0.09, `pull-in took ${t} s`);
  const inside = settle(c, () => frame({ collision }), 60);
  assert.ok(inside.armScale < 0.36);
  assert.ok(Math.hypot(inside.position[0], inside.position[1] - 50, inside.position[2]) < 1.6);
  assert.ok(inside.droneFade < 1, 'close camera fades the drone');
  fraction = null;                                                 // wall gone: ease out
  let back = 0;
  for (let tt = 0; tt < 1.5; tt += 1 / 120) {
    const s = c.update(frame({ collision, dt: 1 / 120 }));
    if (s.armScale > 0.95) { back = tt; break; }
  }
  assert.ok(back > 0.25 && back < 0.8, `ease-out took ${back} s`);
  // push-out along the normal
  const pushed = createCameraRigController({ initialKey: 'lejos' });
  const s0 = settle(pushed, () => frame({}), 240);
  const s1 = settle(pushed, () => frame({ collision: { cast: () => null, push: () => [0, 2, 0] } }), 5);
  assert.ok(s1.position[1] > s0.position[1] + 1.5);
});

test('orbit: 0.14 rad/s around a 25 m radius, FOV breathing +-1.5 deg, reduced motion halves the rate and removes breathing', () => {
  const run = (reduced) => {
    const c = createCameraRigController({ initialKey: 'orbit' });
    let s;
    for (let i = 0; i < 60 * 10; i++) s = c.update(frame({ v2opts: { fpvTilt: 28 * DEG, reduced } }));
    return s;
  };
  const normal = run(false), red = run(true);
  assert.ok(Math.abs(normal.phase - 1.4) < 0.01, `phase ${normal.phase}`);
  assert.ok(Math.abs(red.phase - 0.7) < 0.01);
  assert.ok(Math.abs(Math.hypot(normal.position[0], normal.position[2]) - 25) < 4, 'about 25 m away');
  assert.ok(Math.abs(normal.fovBreath) <= 1.5 + 1e-9 && Math.abs(normal.fovBreath) > 0.3);
  assert.equal(red.fovBreath, 0);
});

test('crash camera: detaches to a 3 m orbit at 0.6 rad/s around the wreck; reduced motion = static cut', () => {
  const crash = { active: true };
  const c = createCameraRigController({ initialKey: 'fpv' });
  settle(c, () => frame({}), 10);
  const first = c.update(frame({ crash, p: { x: 10, y: 20, z: 5 } }));
  assert.equal(first.crashCam, true); assert.equal(first.hideDrone, false);
  const d = (s) => Math.hypot(s.position[0] - 10, s.position[2] - 5);
  assert.ok(Math.abs(d(first) - 3) < 0.05);
  let last = first;
  for (let i = 0; i < 48; i++) last = c.update(frame({ crash, p: { x: 10, y: 20, z: 5 }, dt: 1 / 60 }));
  const a0 = Math.atan2(first.position[2] - 5, first.position[0] - 10), a1 = Math.atan2(last.position[2] - 5, last.position[0] - 10);
  assert.ok(Math.abs(a1 - a0 - 0.48) < 0.03, `orbited ${(a1 - a0)} rad in 0.8 s`);
  const still = createCameraRigController({ initialKey: 'cerca' });
  const r0 = still.update(frame({ crash, p: { x: 10, y: 20, z: 5 }, v2opts: { fpvTilt: 28 * DEG, reduced: true } }));
  let r1 = r0;
  for (let i = 0; i < 48; i++) r1 = still.update(frame({ crash, p: { x: 10, y: 20, z: 5 }, dt: 1 / 60, v2opts: { fpvTilt: 28 * DEG, reduced: true } }));
  assert.ok(Math.abs(r1.position[0] - r0.position[0]) < 1e-9);
  // and it returns to the normal rig the moment the crash ends
  const back = c.update(frame({ crash: { active: false } }));
  assert.equal(back.crashCam, false);
});

test('respawn teleport snaps the filters; fuzz never produces NaN; legacy frames are untouched', () => {
  const c = createCameraRigController({ initialKey: 'cerca' });
  settle(c, () => frame({ p: { x: 0, y: 50, z: 0 } }), 120);
  const s = c.update(frame({ p: { x: 200, y: 30, z: -100 }, yaw: 1.2 }));
  assert.ok(Math.hypot(s.position[0] - 200, s.position[1] - 30, s.position[2] + 100) < 6, 'snapped next to the drone');
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const key of ['fpv', 'muycerca', 'cerca', 'lejos', 'orbit', 'top', 'lado']) {
    const cc = createCameraRigController({ initialKey: key });
    for (let i = 0; i < 400; i++) {
      const st = cc.update(frame({
        p: { x: rnd() * 500 - 250, y: rnd() * 120, z: rnd() * 500 - 250 }, yaw: (rnd() - 0.5) * 12,
        roll: (rnd() - 0.5) * 3, bodyPitch: (rnd() - 0.5) * 3, look: (rnd() - 0.5) * 2,
        v: { x: rnd() * 30 - 15, y: rnd() * 10 - 5, z: rnd() * 30 - 15 }, dt: rnd() * 0.05 + 0.001,
        crash: rnd() < 0.1 ? { active: true } : null,
        collision: rnd() < 0.5 ? { cast: () => (rnd() < 0.5 ? rnd() : null), push: () => (rnd() < 0.3 ? [rnd(), rnd(), rnd()] : null) } : null,
      }));
      assert.ok(finite(st), `${key} frame ${i}`);
    }
  }
  // legacy (no dronePose.v2): same output as before, including the top camera
  const legacy = createCameraRigController({ initialKey: 'cerca' });
  const l = legacy.update({ dronePosition: { x: 0, y: 10, z: 0 }, dronePose: { yaw: 0, pitch: 0 }, velocity: { x: 0, y: 0, z: 0 }, dt: 1 });
  assert.ok(Math.abs(l.position[2] - 4.6) < 1e-9 && Math.abs(l.position[1] - 11.9) < 1e-9);
});
