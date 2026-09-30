// flightverse/physics/quad.js — rigid-body quadcopter model + flight
// controllers. Pure JS, no three.js. Semi-implicit Euler at a fixed dt
// (120 Hz), exact quaternion increment. Zero allocations inside stepQuad.
//
// Frames: world y up. Body: x right, y up (thrust axis), z back (forward=-z).
// q = (w,x,y,z) rotates body -> world. `w` (angular velocity) is in the BODY frame.
import { G } from './params.js';
import { createRng, rngGauss, rngCopy } from './rng.js';
import {
  groundEffectRatio, ceilingEffectRatio, wallPullFraction,
  vrsBump, vrsHorizontalDamp, batteryMultiplier,
} from './aero.js';

export const STEP_DT = 1 / 120;
export const MODE_VEL = 0;   // angle mode: sticks -> velocity command
export const MODE_ATT = 1;   // direct tilt targets (pitchDeg/rollDeg)
export const MODE_RATE = 2;  // acro

// Motor layout (X): 0 front-right, 1 back-right, 2 back-left, 3 front-left.
// Position in the body x/z plane and spin direction (yaw reaction sign).
const MX = new Float64Array([1, 1, -1, -1]);
const MZ = new Float64Array([-1, 1, 1, -1]);
const MS = new Float64Array([1, -1, 1, -1]);

export function createCmd() {
  return { mode: MODE_VEL, fwd: 0, right: 0, climb: 0, yaw: 0, thr: 0.5, pitchDeg: 0, rollDeg: 0 };
}

export function createQuad(P, seed = 1) {
  const s = {
    p: new Float64Array(3), v: new Float64Array(3),
    q: new Float64Array([1, 0, 0, 0]), w: new Float64Array(3),
    m: new Float64Array(4),        // normalised motor speed
    dmg: new Float64Array(4),      // per-motor damage 0..1
    thr: new Float64Array(4),      // last actual thrust per motor (N)
    iv: new Float64Array(3),       // wind-cancelling integrator (m/s^2)
    vcf: new Float64Array(3),      // smoothed velocity command
    soc: 1, integrity: 1, cut: 0, t: 0,
    tilt: 0, tiltCmd: 0, vrs: 0, ge: 1, thrustSum: 0, satur: 0,
    rng: createRng(seed),
  };
  hoverMotors(s, P);
  return s;
}

export function hoverMotors(s, P) {
  s.m.fill(P.hoverW);
  s.thr.fill(P.weight / 4);
}

export function copyQuad(d, s) {
  d.p.set(s.p); d.v.set(s.v); d.q.set(s.q); d.w.set(s.w);
  d.m.set(s.m); d.dmg.set(s.dmg); d.thr.set(s.thr); d.iv.set(s.iv); d.vcf.set(s.vcf);
  d.soc = s.soc; d.integrity = s.integrity; d.cut = s.cut; d.t = s.t;
  d.tilt = s.tilt; d.tiltCmd = s.tiltCmd; d.vrs = s.vrs; d.ge = s.ge;
  d.thrustSum = s.thrustSum; d.satur = s.satur;
  rngCopy(d.rng, s.rng);
  return d;
}

/** Set yaw (rad, about +y, 0 = facing -z) and zero tilt. */
export function setYaw(s, yaw) {
  s.q[0] = Math.cos(yaw / 2); s.q[1] = 0; s.q[2] = Math.sin(yaw / 2); s.q[3] = 0;
}

// ---- module scratch (single-threaded; never escapes) -----------------------
const R = new Float64Array(9);     // row-major body->world
const CTL = new Float64Array(4);   // Tc, tx, ty, tz
const TM = new Float64Array(4);    // per-motor thrust command / actual
const DRP = new Float64Array(4);
const DY = new Float64Array(4);

function rotFromQ(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
  R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
  R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
}
export function rotationInto(q, out) {
  rotFromQ(q); for (let i = 0; i < 9; i++) out[i] = R[i]; return out;
}

// ---- controller ---------------------------------------------------------------
// Writes CTL = [collective thrust N, torque x, y, z (body, N m)].
function control(s, P, cmd, dt) {
  const g = G, m = P.mass;
  const v = s.v;
  const by0 = R[1], by1 = R[4], by2 = R[7];       // body up in world
  const mode = cmd.mode;
  // heading (horizontal forward) from body -z
  let hx = -R[2], hz = -R[8];
  let hl = Math.sqrt(hx * hx + hz * hz);
  if (hl < 1e-4) { hx = R[0]; hz = R[6]; hl = Math.sqrt(hx * hx + hz * hz); if (hl < 1e-6) hl = 1; }
  hx /= hl; hz /= hl;
  const rx = -hz, rz = hx;                          // right = fwd x up

  let wdx = 0, wdy = 0, wdz = 0;                    // desired body rates
  let tc;

  if (mode === MODE_RATE) {
    const e = P.rateExpo;
    const sr = cmd.right, sp = cmd.fwd, sy = cmd.yaw;
    wdz = P.rateMax * ((1 - e) * sr + e * sr * sr * sr);
    wdx = -P.rateMax * ((1 - e) * sp + e * sp * sp * sp);   // forward stick = nose down = -x rotation
    wdy = -P.rateYawMax * ((1 - e) * sy + e * sy * sy * sy);
    const th = cmd.thr < 0 ? 0 : (cmd.thr > 1 ? 1 : cmd.thr);
    const hover = P.weight;
    tc = th < 0.5 ? hover * th * 2 : hover * (1 + (th - 0.5) * 2 * (P.twr - 1));
    s.tiltCmd = 0;
  } else {
    // ---- vertical channel
    const cl = cmd.climb;
    const vzc = cl >= 0 ? cl * P.vzUp : cl * P.vzDown;
    let ay = P.kvz * (vzc - v[1]) + s.iv[1];
    if (ay > P.aUpMax) ay = P.aUpMax; else if (ay < -P.aDownMax) ay = -P.aDownMax;

    let nx, nz, ny;
    if (mode === MODE_ATT) {
      const tp = Math.tan(cmd.pitchDeg * 0.017453292519943295);
      const tr = Math.tan(cmd.rollDeg * 0.017453292519943295);
      nx = tp * hx + tr * rx; nz = tp * hz + tr * rz; ny = 1;
      s.iv[0] = 0; s.iv[2] = 0;
    } else {
      // ---- horizontal: stick -> velocity command (optionally smoothed)
      let sx = cmd.fwd * hx + cmd.right * rx, sz = cmd.fwd * hz + cmd.right * rz;
      const sl = Math.sqrt(sx * sx + sz * sz);
      if (sl > 1) { sx /= sl; sz /= sl; }
      const vcx = sx * P.vmax, vcz = sz * P.vmax;
      if (P.cmdTau > 0) {
        const a = 1 - Math.exp(-dt / P.cmdTau);
        s.vcf[0] += a * (vcx - s.vcf[0]); s.vcf[2] += a * (vcz - s.vcf[2]);
      } else { s.vcf[0] = vcx; s.vcf[2] = vcz; }
      const ex = s.vcf[0] - v[0], ez = s.vcf[2] - v[2];
      let ax = P.kv * ex + s.iv[0], az = P.kv * ez + s.iv[2];
      // acceleration limit = what the tilt limit can deliver at the current lift
      let nyc = g + ay;
      if (nyc < 0.5 * g) nyc = 0.5 * g;
      const amax = nyc * P.tanTilt;
      const al = Math.sqrt(ax * ax + az * az);
      let sat = 0;
      if (al > amax) { const k = amax / al; ax *= k; az *= k; sat = 1; }
      // integrator (anti-windup: freeze when tilt-saturated and error pushes further)
      if (!sat) {
        s.iv[0] += P.kiH * ex * dt; s.iv[2] += P.kiH * ez * dt;
        const il = Math.sqrt(s.iv[0] * s.iv[0] + s.iv[2] * s.iv[2]);
        if (il > amax) { const k = amax / il; s.iv[0] *= k; s.iv[2] *= k; }
      }
      nx = ax; nz = az; ny = g + ay;
      if (ny < 0.5 * g) ny = 0.5 * g;
      nx /= ny; nz /= ny; ny = 1;
    }
    // vertical integrator
    s.iv[1] += P.kiV * (vzc - v[1]) * dt;
    if (s.iv[1] > 6) s.iv[1] = 6; else if (s.iv[1] < -6) s.iv[1] = -6;
    // tilt clamp (both VEL and ATT)
    const th = Math.sqrt(nx * nx + nz * nz);
    if (th > P.tanTilt) { const k = P.tanTilt / th; nx *= k; nz *= k; }
    const nl = Math.sqrt(nx * nx + 1 + nz * nz);
    const dx = nx / nl, dy = 1 / nl, dz = nz / nl;    // n_des (unit)
    s.tiltCmd = Math.acos(dy);
    // collective
    const by = by1 > P.minBy ? by1 : P.minBy;
    tc = m * (g + ay) / by;
    // attitude error: rotate n toward n_des (world axis * angle), into body
    const cx = by1 * dz - by2 * dy, cy = by2 * dx - by0 * dz, cz = by0 * dy - by1 * dx;
    const sn = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const dt_ = by0 * dx + by1 * dy + by2 * dz;
    let ex_ = 0, ey_ = 0, ez_ = 0;
    if (sn > 1e-9) {
      const k = Math.atan2(sn, dt_) / sn;
      ex_ = cx * k; ey_ = cy * k; ez_ = cz * k;
    } else if (dt_ < 0) { ex_ = 3.14159; }             // upside down: flip about body x
    let bx = R[0] * ex_ + R[3] * ey_ + R[6] * ez_;
    let bz = R[2] * ex_ + R[5] * ey_ + R[8] * ez_;
    wdx = P.kp * bx; wdz = P.kp * bz;
    const wl = Math.sqrt(wdx * wdx + wdz * wdz);
    if (wl > P.omegaMax) { const k = P.omegaMax / wl; wdx *= k; wdz *= k; }
    wdy = -cmd.yaw * P.yawRateMax;
  }
  // rate loop (+ gyroscopic feed-forward)
  const w = s.w;
  const Iwx = P.Ix * w[0], Iwy = P.Iy * w[1], Iwz = P.Iz * w[2];
  CTL[0] = tc;
  CTL[1] = P.Ix * P.kr * (wdx - w[0]) + (w[1] * Iwz - w[2] * Iwy);
  CTL[2] = P.Iy * P.kr * (wdy - w[1]) + (w[2] * Iwx - w[0] * Iwz);
  CTL[3] = P.Iz * P.kr * (wdz - w[2]) + (w[0] * Iwy - w[1] * Iwx);
}

// ---- mixer with desaturation (keeps collective) ---------------------------------
function mix(P, tmaxEff) {
  const lo = P.idleFrac * tmaxEff, hi = tmaxEff;
  const tx = CTL[1], ty = CTL[2], tz = CTL[3];
  let dmax = 0;
  for (let i = 0; i < 4; i++) {
    DRP[i] = -MZ[i] * P.armL * P.inv4L2 * tx + MX[i] * P.armL * P.inv4L2 * tz;
    DY[i] = MS[i] * P.inv4kQ * ty;
    const a = DRP[i] < 0 ? -DRP[i] : DRP[i];
    if (a > dmax) dmax = a;
  }
  // collective: attitude has priority — keep enough headroom for the
  // roll/pitch differential (airmode-style), otherwise keep the collective.
  let base = CTL[0] * 0.25;
  const bLo = lo + dmax, bHi = hi - dmax;
  if (bLo > bHi) base = 0.5 * (lo + hi);
  else if (base < bLo) base = bLo; else if (base > bHi) base = bHi;
  // 1) if roll/pitch alone do not fit, scale them; yaw is dropped
  let beta = 1;
  for (let i = 0; i < 4; i++) {
    const d = DRP[i];
    if (d > 0) { const b = (hi - base) / d; if (b < beta) beta = b; }
    else if (d < 0) { const b = (lo - base) / d; if (b < beta) beta = b; }
  }
  if (beta < 0) beta = 0;
  // 2) largest yaw fraction that still fits
  let alpha = beta < 1 ? 0 : 1;
  if (beta >= 1) {
    for (let i = 0; i < 4; i++) {
      const e = DY[i], d = DRP[i];
      if (e > 0) { const a = (hi - base - d) / e; if (a < alpha) alpha = a; }
      else if (e < 0) { const a = (lo - base - d) / e; if (a < alpha) alpha = a; }
    }
    if (alpha < 0) alpha = 0;
  }
  for (let i = 0; i < 4; i++) {
    let t = base + beta * DRP[i] + alpha * DY[i];
    if (t < lo) t = lo; else if (t > hi) t = hi;
    TM[i] = t;
  }
  return beta < 1 || alpha < 1 ? 1 : 0;
}

// ---- one physics step -----------------------------------------------------------
/**
 * Advance the quad by dt. env: see aero.createEnv(). cmd: createCmd().
 * All outputs are written into `s`. No allocation.
 */
export function stepQuad(s, P, cmd, env, dt) {
  const q = s.q, v = s.v, w = s.w, p = s.p;
  rotFromQ(q);
  if (P._dt !== dt) { P._dt = dt; P._ku = 1 - Math.exp(-dt / P.tauUp); P._kd = 1 - Math.exp(-dt / P.tauDown); }

  // battery
  const batt = P.battery ? batteryMultiplier(s.soc, P.sagStart, P.sagMax) : 1;
  const tmaxEff = P.tMaxMotor * P.rhoR * batt;

  // controller + mixer
  if (s.cut) { TM[0] = TM[1] = TM[2] = TM[3] = 0; s.satur = 0; }
  else {
    control(s, P, cmd, dt);
    s.satur = mix(P, tmaxEff);
  }

  // motors: exact first-order lag toward sqrt(T/Tmax)
  const gAgl = groundEffectRatio(env.agl, P.rEff, P.rhoG);
  const gCeil = ceilingEffectRatio(env.ceil, P.rEff, P.rhoC, P.ceilMax);
  s.ge = gAgl;
  // relative air velocity
  const vax = v[0] - env.wx, vay = v[1] - env.wy, vaz = v[2] - env.wz;
  const by0 = R[1], by1 = R[4], by2 = R[7];
  // VRS
  const vaAlong = vax * by0 + vay * by1 + vaz * by2;
  const hx_ = vax - vaAlong * by0, hy_ = vay - vaAlong * by1, hz_ = vaz - vaAlong * by2;
  const vhor = Math.sqrt(hx_ * hx_ + hy_ * hy_ + hz_ * hz_);
  const rr = -vaAlong / P.vh;
  let vrsB = 0;
  if (rr > 0.3 && rr < 1.6) vrsB = vrsBump(rr) * vrsHorizontalDamp(vhor, P.vh, P.vrsHorFrac);
  s.vrs = vrsB;
  const thrMul = gAgl * gCeil * (1 - P.vrsDepth * vrsB);

  let tsum = 0, tqx = 0, tqy = 0, tqz = 0, wsum3 = 0;
  for (let i = 0; i < 4; i++) {
    let cmdW = TM[i] / tmaxEff;
    cmdW = cmdW > 0 ? Math.sqrt(cmdW) : 0;
    if (cmdW > 1) cmdW = 1;
    const wi = s.m[i];
    s.m[i] = wi + (cmdW > wi ? P._ku : P._kd) * (cmdW - wi);
    const wn = s.m[i];
    const T = tmaxEff * wn * wn * (1 - s.dmg[i]) * thrMul;
    s.thr[i] = T;
    tsum += T;
    tqx -= MZ[i] * P.armL * T;
    tqz += MX[i] * P.armL * T;
    tqy += MS[i] * P.kQ * T;
    wsum3 += wn * wn * wn;
  }
  s.thrustSum = tsum;
  if (vrsB > 0) {
    const sg = P.vrsNoise * vrsB * (tsum > P.weight ? 1 : tsum / P.weight);   // buffet needs rotor flow
    tqx += sg * rngGauss(s.rng); tqz += sg * rngGauss(s.rng);
  }

  // forces (world)
  const invM = 1 / P.mass;
  // drag: body-axis linear rotor drag + quadratic body drag
  const vbx = R[0] * vax + R[3] * vay + R[6] * vaz;
  const vby = R[1] * vax + R[4] * vay + R[7] * vaz;
  const vbz = R[2] * vax + R[5] * vay + R[8] * vaz;
  const spd = Math.sqrt(vax * vax + vay * vay + vaz * vaz);
  const hrho = 0.5 * P.rho * spd;
  const fbx = -(P.mass * P.k1x + hrho * P.cdaX) * vbx;
  const fby = -(P.mass * P.k1y + hrho * P.cdaY) * vby;
  const fbz = -(P.mass * P.k1z + hrho * P.cdaZ) * vbz;
  let fx = R[0] * fbx + R[1] * fby + R[2] * fbz + tsum * by0;
  let fy = R[3] * fbx + R[4] * fby + R[5] * fbz + tsum * by1;
  let fz = R[6] * fbx + R[7] * fby + R[8] * fbz + tsum * by2;
  // wall effect: small pull toward the nearest wall
  const wf = wallPullFraction(env.wallDist, P.wallR, P.wallK);
  if (wf > 0) { fx += wf * tsum * env.wnx; fz += wf * tsum * env.wnz; }

  // integrate translation (semi-implicit)
  v[0] += fx * invM * dt;
  v[1] += (fy * invM - G) * dt;
  v[2] += fz * invM * dt;
  p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;

  // rotation: I w' = tau - w x Iw - Cw w  (damping implicit)
  const wx = w[0], wy = w[1], wz = w[2];
  const Iwx = P.Ix * wx, Iwy = P.Iy * wy, Iwz = P.Iz * wz;
  const gx = wy * Iwz - wz * Iwy, gy = wz * Iwx - wx * Iwz, gz = wx * Iwy - wy * Iwx;
  w[0] = (wx + dt * P.invIx * (tqx - gx)) / (1 + dt * P.Cwx * P.invIx);
  w[1] = (wy + dt * P.invIy * (tqy - gy)) / (1 + dt * P.Cwy * P.invIy);
  w[2] = (wz + dt * P.invIz * (tqz - gz)) / (1 + dt * P.Cwz * P.invIz);

  // exact quaternion increment: q <- q (x) exp(w dt / 2)
  const nw = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
  const half = 0.5 * nw * dt;
  const sk = nw > 1e-9 ? Math.sin(half) / nw : 0.5 * dt;
  const dw = Math.cos(half), dx = w[0] * sk, dy = w[1] * sk, dz = w[2] * sk;
  const qw = q[0], qx = q[1], qy = q[2], qz = q[3];
  let nqw = qw * dw - qx * dx - qy * dy - qz * dz;
  let nqx = qw * dx + qx * dw + qy * dz - qz * dy;
  let nqy = qw * dy - qx * dz + qy * dw + qz * dx;
  let nqz = qw * dz + qx * dy - qy * dx + qz * dw;
  const inv = 1 / Math.sqrt(nqw * nqw + nqx * nqx + nqy * nqy + nqz * nqz);
  q[0] = nqw * inv; q[1] = nqx * inv; q[2] = nqy * inv; q[3] = nqz * inv;

  // tilt (angle between body up and world up)
  const byn = 1 - 2 * (q[1] * q[1] + q[3] * q[3]);
  s.tilt = Math.acos(byn > 1 ? 1 : (byn < -1 ? -1 : byn));

  // battery drain (endurance calibrated at hover)
  if (P.battery) {
    const h3 = P.hoverW * P.hoverW * P.hoverW;
    s.soc -= dt * (0.25 * wsum3 / h3) / P.hoverSeconds;
    if (s.soc < 0) s.soc = 0;
  }
  s.t += dt;
}

// ---- fixed-timestep accumulator ---------------------------------------------------
export function createStepper(dt = STEP_DT, maxSteps = 8) {
  return { dt, acc: 0, maxSteps, steps: 0 };
}

/** Advance by a (variable) frame time using fixed steps. Returns steps taken.
 *  Result depends only on the number of fixed steps, never on frame chunking. */
export function advanceQuad(s, P, cmd, env, stepper, frameDt) {
  stepper.acc += frameDt;
  let n = 0;
  const dt = stepper.dt;
  while (stepper.acc >= dt - 1e-9 && n < stepper.maxSteps) {
    stepQuad(s, P, cmd, env, dt);
    stepper.acc -= dt; n++;
  }
  if (stepper.acc > dt) stepper.acc = 0;     // panic cap: drop the backlog
  if (stepper.acc < 0) stepper.acc = 0;
  stepper.steps += n;
  return n;
}
