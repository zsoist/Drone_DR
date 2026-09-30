// flightverse/physics/aero.js — thrust modifiers: ground / ceiling / wall
// effect, vortex-ring state, battery sag. Pure functions, no allocations.
// Environment probing is injected (rayDist) so this file never sees three.js.

/** Ground effect thrust ratio (Cheeseman-Bennett): 1/(1 - rhoG (R/4z)^2).
 *  z is clamped to >= 0.5 R so the ratio stays finite (max 1.333 at rhoG=1). */
export function groundEffectRatio(z, rEff, rhoG) {
  if (!(z < 1e6)) return 1;              // Infinity / NaN -> no effect
  const zc = z > 0.5 * rEff ? z : 0.5 * rEff;
  const k = rEff / (4 * zc);
  return 1 / (1 - rhoG * k * k);
}

/** Ceiling effect: thrust rises near an overhead surface. Capped at `cap`. */
export function ceilingEffectRatio(zc, rEff, rhoC, cap) {
  if (!(zc < 1e6)) return 1;
  const z = zc > 0.5 * rEff ? zc : 0.5 * rEff;
  const k = rEff / (4 * z);
  const r = 1 / (1 - rhoC * k * k);
  return r < cap ? r : cap;
}

/** Wall pull as a fraction of thrust for wall distance d (0 beyond 4x wallR). */
export function wallPullFraction(d, wallR, wallK) {
  if (!(d < 4 * wallR)) return 0;
  const dd = d > 0.5 * wallR ? d : 0.5 * wallR;
  const q = wallR / dd;
  const f = wallK * q * q;
  // fade to zero at the range limit so there is no step
  const fade = 1 - d / (4 * wallR);
  return f * (fade > 0 ? fade : 0);
}

/** VRS bump B(r) = sin^2(pi (r-0.3)/1.3), r = descent rate / vh in [0.3, 1.6]. */
export function vrsBump(r) {
  if (r <= 0.3 || r >= 1.6) return 0;
  const s = Math.sin(Math.PI * (r - 0.3) / 1.3);
  return s * s;
}

/** Horizontal damping of VRS: 1 at hover, 0 at vhor >= frac*vh (smoothstep). */
export function vrsHorizontalDamp(vhor, vh, frac) {
  const x = vhor / (frac * vh);
  if (x >= 1) return 0;
  if (x <= 0) return 1;
  return 1 - x * x * (3 - 2 * x);
}

/** Thrust multiplier from battery state of charge (1 -> 1 - sagMax). */
export function batteryMultiplier(soc, sagStart, sagMax) {
  if (soc >= sagStart) return 1;
  const x = soc <= 0 ? 1 : (sagStart - soc) / sagStart;
  return 1 - sagMax * x * x * (3 - 2 * x);
}

/** Per-frame environment record shared between the game and quad.step. */
export function createEnv() {
  return {
    wx: 0, wy: 0, wz: 0,          // wind velocity (world), m/s
    agl: Infinity,                // rotor-plane height above ground, m
    ceil: Infinity,               // distance to overhead surface, m
    wallDist: Infinity,           // distance to nearest lateral wall, m
    wnx: 0, wnz: 0,               // unit horizontal direction toward that wall
  };
}

const DIRS = [1, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, -1];   // module-level, read only

/**
 * Fill env.agl / ceil / wall from an injected ray function:
 *   rayDist(ox,oy,oz,dx,dy,dz,maxDist) -> distance or Infinity.
 * Call at ~30 Hz, not every physics step.
 */
export function probeEnvironment(rayDist, px, py, pz, rEff, env) {
  const far = 4 * rEff * 2 + 1;
  env.agl = rayDist(px, py, pz, 0, -1, 0, 8 * rEff + 30);
  env.ceil = rayDist(px, py, pz, 0, 1, 0, 8 * rEff);
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < 12; i += 3) {
    const dx = DIRS[i], dz = DIRS[i + 2];
    const d = rayDist(px, py, pz, dx, 0, dz, far);
    if (d < best) { best = d; bx = dx; bz = dz; }
  }
  env.wallDist = best; env.wnx = bx; env.wnz = bz;
  return env;
}
