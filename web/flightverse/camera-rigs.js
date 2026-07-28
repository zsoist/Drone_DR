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

export const CAMERA_RIGS = Object.freeze([
  Object.freeze({ key: 'muycerca', label: 'Muy cerca', code: 'MC', fov: 66 }),
  Object.freeze({ key: 'cerca', label: 'Cerca', code: 'C', fov: 62 }),
  Object.freeze({ key: 'lejos', label: 'Lejos', code: 'L', fov: 57 }),
  Object.freeze({ key: 'fpv', label: 'FPV', code: 'FPV', fov: 78, hideDrone: true }),
  Object.freeze({ key: 'top', label: 'Cenital', code: 'TOP', fov: 55 }),
  Object.freeze({ key: 'orbit', label: 'Órbita', code: 'ORB', fov: 58 }),
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
  let state = {
    key,
    phase,
    radius: null,
    gimbalRadians,
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
  } = {}) => {
    const p = vec(dronePosition);
    const v = vec(velocity);
    const speed = length(v);
    const yaw = finite(dronePose.yaw) ? Number(dronePose.yaw) : 0;
    const pitch = finite(dronePose.pitch) ? Number(dronePose.pitch) : 0;
    const droneForward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    let pose;
    let radius = null;

    if (key === 'fpv') {
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
      radius = clamp(12 + speed * 0.55, 12, 28);
      const height = clamp(4.5 + speed * 0.16, 4.5, 10);
      phase += Math.max(0, Number(dt) || 0) * (0.22 + Math.min(speed, 30) * 0.006);
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
      phase,
      radius,
      gimbalRadians,
      position: pose.position,
      quaternion: pose.quaternion,
      forward: pose.forward,
      up: pose.up,
      right: pose.right,
      rollDegrees: 0,
      finite: values.every(Number.isFinite),
      fov: RIG_BY_KEY.get(key).fov,
      hideDrone: Boolean(RIG_BY_KEY.get(key).hideDrone),
    };
    return state;
  };

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

