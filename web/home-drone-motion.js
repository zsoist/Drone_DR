export const HOME_DRONE_VIEW = Object.freeze({
  camera: Object.freeze({ x: 0, y: 0, z: 3.15, fov: 34 }),
  rig: Object.freeze({ x: 0, y: 0, z: 0 }),
  rest: Object.freeze({ pitch: -0.12, yaw: -0.28 }),
});

const ROTOR_SPEED = 32;
const ROTOR_DIRECTIONS = Object.freeze([1, -1, 1, -1]);

export function homeDroneFrame(seconds, reducedMotion = false) {
  if (reducedMotion) {
    return { offsetY: 0, roll: 0, rotorAngles: [0, 0, 0, 0] };
  }
  const time = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const rotorPhase = (time * ROTOR_SPEED) % (Math.PI * 2);
  return {
    offsetY: Math.sin(time * 1.35) * 0.055,
    roll: Math.sin(time * 0.9) * 0.025,
    rotorAngles: ROTOR_DIRECTIONS.map(direction => rotorPhase * direction),
  };
}
