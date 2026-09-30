// Pure gameplay-camera controller. It deliberately has no Three.js or DOM
// dependency so camera ownership and orientation math remain deterministic.

const DEG = Math.PI / 180;
const DEFAULT_GIMBAL = -7 * DEG;
const GIMBAL_MIN = -90 * DEG;
const GIMBAL_MAX = 25 * DEG;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = value => Number.isFinite(Number(value));
const vec = (value = {}) => [
  finite(value.x) ? Number(value.x) : 0,
  finite(value.y) ? Number(value.y) : 0,
  finite(value.z) ? Number(value.z) : 0,
];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, value) => [a[0] * value, a[1] * value, a[2] * value];
const length = a => Math.hypot(a[0], a[1], a[2]);
const normalize = (a, fallback = [0, 0, -1]) => {
  const magnitude = length(a);
  return magnitude > 1e-12 && Number.isFinite(magnitude)
    ? scale(a, 1 / magnitude)
    : [...fallback];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function quaternionFromBasis(right, up, backward) {
  const m00 = right[0], m01 = up[0], m02 = backward[0];
  const m10 = right[1], m11 = up[1], m12 = backward[1];
  const m20 = right[2], m21 = up[2], m22 = backward[2];
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const magnitude = Math.hypot(x, y, z, w) || 1;
  return [x / magnitude, y / magnitude, z / magnitude, w / magnitude];
}

function poseFromForward(position, forwardValue, upHint = [0, 1, 0]) {
  const forward = normalize(forwardValue);
  const backward = scale(forward, -1);
  let right = cross(upHint, backward);
  if (length(right) <= 1e-9) right = cross([0, 0, -1], backward);
  right = normalize(right, [1, 0, 0]);
  const up = normalize(cross(backward, right), [0, 1, 0]);
  return {
    position,
    quaternion: quaternionFromBasis(right, up, backward),
    forward,
    up,
    right,
  };
}

function poseLookingAt(position, target, up = [0, 1, 0]) {
  return poseFromForward(position, sub(target, position), up);
}


// ── Flightverse v2 camera math (pure; used only when update() gets dronePose.v2) ──
const V2 = Object.freeze({
  fpvTilt: 28 * DEG,              // camera uptilt, engaged with forward lean (configurable 25-30 deg)
  rollTau: 0.06,                  // FPV follows the body roll at 100 %, smoothed
  pitchTau: 0.06,
  arm: { muycerca: 2.6, cerca: 4.0, lejos: 10 },   // spring arm length per chase rig (m)
  armElev: { muycerca: 18 * DEG, cerca: 20 * DEG, lejos: 22 * DEG },
  stiffness: 90, damping: 19,     // critically damped: 2 sqrt(90) = 18.97
  yawLagTau: 0.25,
  pitchMin: -55 * DEG, pitchMax: 20 * DEG,
  lookAheadT: 0.25, lookAheadMax: 3,
  camRadius: 0.4,                 // sphere-cast radius
  pullInTau: 0.02,                // ~60 ms to full pull-in
  easeOutTau: 0.12,               // ~350 ms back out
  orbitRate: 0.14, orbitRadius: 25, orbitHeight: 8,
  crashRadius: 3, crashRate: 0.6,
  fadeDist: 1.3,
});
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const tau = (dt, t) => 1 - Math.exp(-dt / Math.max(1e-4, t));

function makeV2State() {
  return {
    init: false, rollS: 0, pitchS: 0, yawLag: 0, scale: 1,
    x: [0, 0, 0], v: [0, 0, 0], last: [0, 0, 0],
    orbitPhase: 0, crashA: 0, crashT: 0, fovBreath: 0, breathT: 0, droneFade: 1,
  };
}

export const CAMERA_RIGS = Object.freeze([
  Object.freeze({ key: 'muycerca', label: 'Muy cerca', code: 'MC', fov: 66 }),
  Object.freeze({ key: 'cerca', label: 'Cerca', code: 'C', fov: 62 }),
  Object.freeze({ key: 'lejos', label: 'Lejos', code: 'L', fov: 57 }),
  Object.freeze({ key: 'fpv', label: 'FPV', code: 'FPV', fov: 78, hideDrone: true }),
  Object.freeze({ key: 'top', label: 'Cenital', code: 'TOP', fov: 55 }),
  Object.freeze({ key: 'orbit', label: 'Órbita', code: 'ORB', fov: 48 }),
  Object.freeze({ key: 'lado', label: 'Lateral', code: 'LAT', fov: 50 }),
]);

const RIG_BY_KEY = new Map(CAMERA_RIGS.map(rig => [rig.key, rig]));

export function createCameraRigController({
  initialKey = 'fpv',
  topHeadingMode = 'north',
} = {}) {
  let key = RIG_BY_KEY.has(initialKey) ? initialKey : 'fpv';
  let gimbalRadians = DEFAULT_GIMBAL;
  let phase = 0;
  const v2s = makeV2State();
  let state = {
    key,
    phase,
    radius: null,
    gimbalRadians,
    gimbalOwner: 'fpv',
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    forward: [0, 0, -1],
    up: [0, 1, 0],
    right: [1, 0, 0],
    rollDegrees: 0,
    finite: true,
    fov: RIG_BY_KEY.get(key).fov,
    hideDrone: Boolean(RIG_BY_KEY.get(key).hideDrone),
  };

  const select = requested => {
    const next = RIG_BY_KEY.has(requested) ? requested : 'fpv';
    if (next === 'orbit' && key !== 'orbit') phase = 0;
    key = next;
    state = {
      ...state,
      key,
      phase,
      radius: key === 'orbit' ? null : state.radius,
      gimbalOwner: key === 'fpv' ? 'fpv' : 'none',
      fov: RIG_BY_KEY.get(key).fov,
      hideDrone: Boolean(RIG_BY_KEY.get(key).hideDrone),
    };
    return key;
  };

  const cycle = (direction = 1) => {
    const index = CAMERA_RIGS.findIndex(rig => rig.key === key);
    const offset = Number(direction) < 0 ? -1 : 1;
    return select(CAMERA_RIGS[(index + offset + CAMERA_RIGS.length) % CAMERA_RIGS.length].key);
  };

  const setGimbalRadians = value => {
    if (finite(value)) {
      gimbalRadians = clamp(Number(value), GIMBAL_MIN, GIMBAL_MAX);
      state = { ...state, gimbalRadians };
    }
    return gimbalRadians;
  };

  const update = ({
    dronePosition,
    dronePose = {},
    velocity,
    dt = 0,
    realDt = 0,            // v2: tiempo real del frame de render (los filtros de cámara no dependen del fps)
    collision = null,      // v2: { cast(a,b,radius)->fraction|null, push(p)->[dx,dy,dz]|null }
    v2opts = null,         // v2: { fpvTilt, reduced }
    crash = null,          // v2: { active, t, x, y, z, phase }
  } = {}) => {
    const p = vec(dronePosition);
    const v = vec(velocity);
    const speed = length(v);
    const yaw = finite(dronePose.yaw) ? Number(dronePose.yaw) : 0;
    const pitch = finite(dronePose.pitch) ? Number(dronePose.pitch) : 0;
    const droneForward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    let pose;
    let radius = null;
    let extra = null;

    if (dronePose.v2 && (key !== 'top' && key !== 'lado')) {
      const r = updateV2({ p, v, speed, yaw, pitch, dronePose, dt: Number(realDt) > 0 ? Number(realDt) : Number(dt) || 0, collision, opts: v2opts, crash });
      pose = r.pose; radius = r.radius; extra = r.extra;
    } else if (key === 'fpv') {
      const cameraPitch = clamp(pitch * 0.7 + gimbalRadians, -Math.PI * 0.495, Math.PI * 0.495);
      const forward = [
        -Math.sin(yaw) * Math.cos(cameraPitch),
        Math.sin(cameraPitch),
        -Math.cos(yaw) * Math.cos(cameraPitch),
      ];
      pose = poseFromForward(add(p, scale(droneForward, 0.28)), forward);
      pose.position[1] -= 0.02;
    } else if (key === 'top') {
      const altitude = clamp(45 + speed * 0.8, 45, 90);
      const screenUp = topHeadingMode === 'drone'
        ? normalize(droneForward, [0, 0, -1])
        : [0, 0, -1];
      pose = poseFromForward(add(p, [0, altitude, 0]), [0, -1, 0], screenUp);
    } else if (key === 'orbit') {
      radius = clamp(5.5 + speed * 0.25, 5.5, 16);
      const height = clamp(2 + speed * 0.08, 2, 6);
      phase += Math.max(0, Number(dt) || 0) * (0.28 + Math.min(speed, 30) * 0.007);
      const leadScale = Math.min(4, speed * 0.12) / Math.max(speed, 1e-6);
      const target = add(p, scale(v, leadScale));
      const position = add(target, [
        Math.cos(phase) * radius,
        height,
        Math.sin(phase) * radius,
      ]);
      pose = poseLookingAt(position, target);
    } else {
      const config = {
        muycerca: { back: 2.3, height: 0.9 },
        cerca: { back: 4.6, height: 1.9 },
        lejos: { back: 12, height: 4.6 },
      }[key];
      if (config) {
        pose = poseLookingAt(add(p, [
          Math.sin(yaw) * config.back,
          config.height,
          Math.cos(yaw) * config.back,
        ]), p);
      } else {
        const side = [Math.cos(yaw) * 10, 2.4, -Math.sin(yaw) * 10];
        pose = poseLookingAt(add(p, side), p);
      }
    }

    const values = [...pose.position, ...pose.quaternion, ...pose.forward, ...pose.up, ...pose.right];
    state = {
      key,
      phase: extra && extra.phase !== undefined ? extra.phase : phase,
      radius,
      gimbalRadians,
      gimbalOwner: key === 'fpv' ? 'fpv' : 'none',
      position: pose.position,
      quaternion: pose.quaternion,
      forward: pose.forward,
      up: pose.up,
      right: pose.right,
      rollDegrees: extra ? extra.rollDegrees : 0,
      finite: values.every(Number.isFinite),
      fov: RIG_BY_KEY.get(key).fov,
      hideDrone: extra && extra.hideDrone !== undefined ? extra.hideDrone : Boolean(RIG_BY_KEY.get(key).hideDrone),
      droneFade: extra ? extra.droneFade : 1,
      fovBreath: extra ? extra.fovBreath : 0,
      crashCam: extra ? extra.crashCam : false,
      armScale: extra ? extra.armScale : 1,
    };
    return state;
  };

  // v2: chase spring arm / FPV uptilt + roll / orbit / crash camera. All state in v2s.
  function updateV2({ p, v, speed, yaw, pitch, dronePose, dt, collision, opts, crash }) {
    const o = opts || {};
    const reduced = !!o.reduced;
    const tilt = Number.isFinite(o.fpvTilt) ? o.fpvTilt : V2.fpvTilt;
    const d = clamp(dt, 0.0005, 0.1);
    const roll = finite(dronePose.roll) ? Number(dronePose.roll) : 0;
    const bodyPitch = finite(dronePose.bodyPitch) ? Number(dronePose.bodyPitch) : 0;
    const S = v2s;
    const extra = { rollDegrees: 0, droneFade: 1, fovBreath: 0, crashCam: false, armScale: 1, hideDrone: undefined, phase: undefined };
    if (!S.init) {
      S.init = true; S.yawLag = yaw; S.rollS = roll; S.pitchS = bodyPitch;
    }
    // respawn / teleport: snap every filter
    const jump = Math.hypot(p[0] - S.last[0], p[1] - S.last[1], p[2] - S.last[2]);
    const snap = jump > 8;
    S.last = [p[0], p[1], p[2]];
    if (snap) { S.yawLag = yaw; S.rollS = roll; S.pitchS = bodyPitch; S.scale = 1; S.x = null; }
    S.rollS += (roll - S.rollS) * tau(d, V2.rollTau);
    S.pitchS += (bodyPitch - S.pitchS) * tau(d, V2.pitchTau);
    S.yawLag += wrapPi(yaw - S.yawLag) * tau(d, V2.yawLagTau);

    let pose;
    let radius = null;

    // ── crash camera: detach to a 3 m orbit around the wreck ──
    if (crash && crash.active) {
      if (S.crashT === 0) S.crashA = Math.PI / 2 - yaw;     // start behind the drone
      S.crashT += d;
      if (!reduced) S.crashA += V2.crashRate * d;
      const a = S.crashA;
      let cp = [p[0] + Math.cos(a) * V2.crashRadius, p[1] + 1.2, p[2] + Math.sin(a) * V2.crashRadius];
      cp = pushOut(collision, cp);
      pose = poseLookingAt(cp, p);
      extra.crashCam = true; extra.hideDrone = false;
      return { pose, radius: V2.crashRadius, extra };
    }
    S.crashT = 0;

    if (key === 'fpv') {
      const lean = smooth01(-S.pitchS / (30 * DEG));
      const camPitch = clamp(gimbalRadians + pitch + S.pitchS + tilt * lean, -Math.PI * 0.495, Math.PI * 0.495);
      const cp = Math.cos(camPitch);
      const forward = [-Math.sin(yaw) * cp, Math.sin(camPitch), -Math.cos(yaw) * cp];
      const r0 = normalize(cross(forward, [0, 1, 0]), [1, 0, 0]);
      const bank = S.rollS * (reduced ? 0.5 : 1);
      const up = [Math.sin(bank) * r0[0], Math.cos(bank), Math.sin(bank) * r0[2]];
      const droneFwd = [-Math.sin(yaw), 0, -Math.cos(yaw)];
      pose = poseFromForward(add(p, scale(droneFwd, 0.28)), forward, up);
      pose.position[1] -= 0.02;
      extra.rollDegrees = bank / DEG;
      return { pose, radius, extra };
    }

    if (key === 'orbit') {
      S.orbitPhase += d * V2.orbitRate * (reduced ? 0.5 : 1);
      S.breathT += d;
      extra.fovBreath = reduced ? 0 : 1.5 * Math.sin(S.breathT * 0.45);
      extra.phase = S.orbitPhase;
      const ahead = lookAhead(v, speed);
      const target = add(p, ahead);
      const wanted = add(target, [
        Math.cos(S.orbitPhase) * V2.orbitRadius,
        V2.orbitHeight,
        Math.sin(S.orbitPhase) * V2.orbitRadius,
      ]);
      const cam = armCollide(S, collision, target, wanted, d, extra);
      // rule of thirds: the drone sits on the left third, looking a little past it
      const fwd = normalize(sub(target, cam), [0, 0, -1]);
      const right = normalize(cross(fwd, [0, 1, 0]), [1, 0, 0]);
      pose = poseLookingAt(cam, add(target, scale(right, V2.orbitRadius * 0.11)));
      radius = V2.orbitRadius;
      return { pose, radius, extra };
    }

    // chase rigs: spring arm with look-ahead
    const len = V2.arm[key] || 4;
    const baseElev = V2.armElev[key] || 20 * DEG;
    const camPitch = clamp(-baseElev + pitch, V2.pitchMin, V2.pitchMax);      // look pitch tilts the arm
    const elev = -camPitch;
    const ahead = lookAhead(v, speed);
    const focus = add(p, ahead);
    const ce = Math.cos(elev);
    const wanted = add(focus, [
      Math.sin(S.yawLag) * ce * len,
      Math.sin(elev) * len,
      Math.cos(S.yawLag) * ce * len,
    ]);
    if (!S.x) { S.x = [...wanted]; S.v = [0, 0, 0]; }
    // critically damped spring (semi-implicit, substeps <= 1/240 s)
    const n = Math.max(1, Math.ceil(d / (1 / 240)));
    const h = d / n;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const acc = V2.stiffness * (wanted[k] - S.x[k]) - V2.damping * S.v[k];
        S.v[k] += acc * h;
        S.x[k] += S.v[k] * h;
      }
    }
    const cam = armCollide(S, collision, focus, S.x, d, extra);
    // close to the drone: fade it to 40 % instead of drawing the near plane through it
    if (length(sub(cam, p)) < V2.fadeDist) extra.droneFade = 0.4;
    // never look through the drone's centre exactly (keeps the horizon level)
    pose = poseLookingAt(cam, add(p, [0, 0.25, 0]));
    radius = length(sub(cam, p));
    extra.armScale = S.scale;
    return { pose, radius, extra };
  }

  function lookAhead(v, speed) {
    const m = Math.min(V2.lookAheadMax, speed * V2.lookAheadT);
    return speed > 1e-6 ? scale(v, m / speed) : [0, 0, 0];
  }

  // sphere-cast the arm (focus -> desired), ease the arm length (fast in, slow out), push out of geometry
  function armCollide(S, collision, focus, desired, d, extra) {
    const vec = sub(desired, focus);
    const dist = length(vec);
    if (dist < 1e-6) return desired;
    let target = 1;
    if (collision?.cast) {
      const f = collision.cast(focus, desired, V2.camRadius);
      if (f != null && Number.isFinite(f)) target = clamp((f * dist - 0.05) / dist, 0.06, 1);
    }
    const t = target < S.scale ? V2.pullInTau : V2.easeOutTau;
    S.scale += (target - S.scale) * tau(d, t);
    if (S.scale > target) S.scale = Math.max(target, S.scale - 1e-4);
    let cam = add(focus, scale(vec, S.scale));
    cam = pushOut(collision, cam);
    return cam;
  }

  function pushOut(collision, pos) {
    if (!collision?.push) return pos;
    const t = collision.push(pos);
    return t ? [pos[0] + t[0], pos[1] + t[1], pos[2] + t[2]] : pos;
  }

  const snapshot = () => ({
    ...state,
    position: [...state.position],
    quaternion: [...state.quaternion],
    forward: [...state.forward],
    up: [...state.up],
    right: [...state.right],
  });

  const dispose = () => {};

  return {
    select,
    cycle,
    setGimbalRadians,
    update,
    snapshot,
    dispose,
  };
}
