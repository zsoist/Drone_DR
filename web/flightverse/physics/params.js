// flightverse/physics/params.js — every physical constant of the v2 drone
// model in one place. [U] = unverified constant (kept as a named param so it
// can be tuned without touching code). Units: SI, y up, body frame:
// x right, y up (thrust axis), z back (forward = -z). Pure module, no deps.

export const G = 9.81;
export const RHO0 = 1.225;            // ISA sea level air density, kg/m^3

/** ISA density ratio rho/rho0 at altitude h (m above sea level). */
export function densityRatio(altM) {
  const h = altM > 0 ? altM : 0;
  const t = 1 - 0.0065 * h / 288.15;
  return Math.pow(t > 0.05 ? t : 0.05, 4.256);
}

/** Per-world helper: Bogota 2600 m -> ~0.773. */
export const WORLD_ALTITUDE_M = Object.freeze({ default: 0, bogota: 2600 });
export function worldDensityRatio(worldKey) {
  return densityRatio(WORLD_ALTITUDE_M[worldKey] ?? WORLD_ALTITUDE_M.default);
}

/** Flight profiles. tilt in degrees, speeds m/s. Top speed EMERGES from tilt
 *  (drag balance): cine ~6.5, normal ~10, sport ~14 m/s at sea level. vmax
 *  is only the stick scale and must exceed the emergent speed. */
export const PROFILES = Object.freeze({
  cine:   Object.freeze({ tiltDeg: 18, vmax: 9,  climb: 3, descend: 2.5, cmdTau: 0.6,  kv: 1.8, yawRate: 1.2 }),
  normal: Object.freeze({ tiltDeg: 30, vmax: 14, climb: 5, descend: 4,   cmdTau: 0.08, kv: 2.5, yawRate: 2.2 }),
  sport:  Object.freeze({ tiltDeg: 42, vmax: 20, climb: 7, descend: 6,   cmdTau: 0.0,  kv: 2.5, yawRate: 3.5 }),
});

/** Wind presets: W20 = mean speed at 6 m (20 ft) AGL, turbulence multiplier. */
export const WIND_PRESETS = Object.freeze({
  calm:   Object.freeze({ w20: 0.5, sigmaMul: 1.0 }),
  breezy: Object.freeze({ w20: 4.0, sigmaMul: 1.0 }),
  gusty:  Object.freeze({ w20: 7.0, sigmaMul: 1.4 }),
});

export const DEFAULTS = Object.freeze({
  // --- airframe
  mass: 0.249,            // kg (Mini-class 249 g)
  twr: 2.5,               // thrust-to-weight at sea level, full throttle
  rotorR: 0.045,          // m, rotor radius
  armL: 0.078,            // m, X-mixer half spacing (motor at +-armL, +-armL)
  kQ: 0.016,              // m, yaw torque per thrust (torque = kQ*T) [U]
  Ix: 1.0e-3, Iy: 1.9e-3, Iz: 1.0e-3,   // kg m^2; y = yaw axis
  Cwx: 2.0e-4, Cwy: 4.0e-4, Cwz: 2.0e-4, // rotational damping N m s
  // --- motors
  tauUp: 0.03, tauDown: 0.05,   // s, first-order lag
  idleFrac: 0.02,               // min thrust per motor as fraction of Tmax
  // --- drag (Faessler et al. arXiv 1712.02402 for k1)
  k1x: 0.35, k1y: 0.15, k1z: 0.35,   // 1/s linear rotor drag (body axes) [U y]
  cdaX: 0.0077, cdaY: 0.044, cdaZ: 0.0077, // m^2 quadratic drag areas
  // --- aero extras
  rEff: 0.25,             // m, game-scale effective rotor radius for ground effect [U]
  rhoG: 1.0,              // ground-effect strength
  rhoC: 1.5,              // ceiling-effect strength
  ceilMax: 1.5,           // cap on ceiling thrust ratio
  wallK: 0.04,            // wall pull, fraction of thrust at d = wallR
  wallR: 0.5,             // m, wall effect reference / range = 4x [U]
  vrsDepth: 0.25,         // max thrust loss in VRS
  vrsHorFrac: 0.6,        // VRS vanishes at horizontal airspeed = frac * vh
  vrsNoise: 0.006,        // N m, VRS buffet torque sigma [U]
  // --- battery
  battery: 0,             // 1 = enable sag + SoC drain
  sagMax: 0.15,           // thrust multiplier drops 1 -> 1-sagMax below sagStart
  sagStart: 0.35,
  hoverSeconds: 1200,     // full SoC hover endurance [U]
  // --- controller
  kp: 7.5,                // attitude P (rad/s per rad of tilt error)
  kr: 30,                 // rate P (1/s); keep kr*dt <= 0.4
  omegaMax: 12,           // rad/s clamp on tilt rate command
  kvz: 3.0,               // vertical velocity P
  kiH: 1.2, kiV: 1.5,     // wind-cancelling integral gains
  aUpMax: 12, aDownMax: 8,// vertical accel command limits
  minBy: 0.3,             // collective divisor floor
  // acro (rate) mode, Betaflight-like
  rateMax: 9.0,           // rad/s at full stick (~515 deg/s)
  rateYawMax: 4.5,
  rateExpo: 0.35,
  // --- contact
  boxX: 0.29, boxY: 0.09, boxZ: 0.29,  // real-unit box
  bodyScale: 1.0,         // game-scale factor on the box
  mu: 0.4,
  eConcrete: 0.3, eTerrain: 0.25, eFoliage: 0,
  eMinVn: 0.3,            // below this |vn| restitution is 0
  eScrape: 0.15, eWobble: 1.0, eCrash: 3.0,   // J thresholds
  propNear: 0.11,         // m (scaled) contact-to-motor reach for prop strike
  vegDrag: 6.0,           // 1/s at density 1
  // --- world
  rhoR: 1.0,              // air density ratio (per world)
  profile: 'normal',
});

/**
 * Build a full parameter set. overrides may contain any DEFAULTS key.
 * `altM` (optional) sets rhoR from ISA unless overrides.rhoR is given.
 */
export function makeParams(overrides = {}, altM = 0) {
  const P = Object.assign({}, DEFAULTS, overrides);
  if (overrides.rhoR === undefined) P.rhoR = densityRatio(altM);
  P.g = G;
  P.rho = RHO0 * P.rhoR;
  P.weight = P.mass * G;
  P.tMaxMotor = P.twr * P.weight / 4;     // N per motor, sea level, w=1
  P.invIx = 1 / P.Ix; P.invIy = 1 / P.Iy; P.invIz = 1 / P.Iz;
  P.rotorArea = 4 * Math.PI * P.rotorR * P.rotorR;
  P.vh = Math.sqrt(P.weight / (2 * P.rho * P.rotorArea));   // hover induced velocity
  P.hoverW = Math.sqrt(P.weight / 4 / (P.tMaxMotor * P.rhoR));
  P.inv4L2 = 1 / (4 * P.armL * P.armL);
  P.inv4kQ = 1 / (4 * P.kQ);
  P.hx = 0.5 * P.boxX * P.bodyScale; P.hy = 0.5 * P.boxY * P.bodyScale; P.hz = 0.5 * P.boxZ * P.bodyScale;
  P._dt = 0; P._ku = 0; P._kd = 0;        // exact-exp cache
  P.prof = null;
  setProfile(P, P.profile);
  return P;
}

export function setProfile(P, name) {
  const f = PROFILES[name] || PROFILES.normal;
  P.profile = name in PROFILES ? name : 'normal';
  P.tiltMax = f.tiltDeg * Math.PI / 180;
  P.tanTilt = Math.tan(P.tiltMax);
  P.vmax = f.vmax; P.vzUp = f.climb; P.vzDown = f.descend;
  P.cmdTau = f.cmdTau; P.kv = f.kv; P.yawRateMax = f.yawRate;
  return P;
}
