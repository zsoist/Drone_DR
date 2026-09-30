// flightverse/physics/contact.js — velocity-level impulse contact solver for
// the quad's oriented box, energy classification of the impact, respawn
// snapshot helper and a vegetation soft-drag helper. Pure, no allocations.
//
// A hit is { nx,ny,nz (unit, pointing out of the surface toward the drone),
// px,py,pz (contact point, world), kind }. The caller does the geometry
// query (mesh raycast / collision-math); this file only resolves the response.
import { rotationInto } from './quad.js';

export const KIND_CONCRETE = 0, KIND_TERRAIN = 1, KIND_FOLIAGE = 2;
export const CLS_NONE = 0, CLS_SCRAPE = 1, CLS_WOBBLE = 2, CLS_PROP = 3, CLS_CRASH = 4;

const MX = [1, 1, -1, -1], MZ = [-1, 1, 1, -1];   // read-only, module level
const RM = new Float64Array(9);
const nb = new Float64Array(3), rb = new Float64Array(3), vb = new Float64Array(3);
const PLANE_HIT = { nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, kind: KIND_TERRAIN };
const tb = new Float64Array(3), tmp = new Float64Array(3), tmp2 = new Float64Array(3);

export function createContactOut() {
  return { cls: CLS_NONE, energy: 0, vn: 0, impulse: 0, motorsHit: 0 };
}

function restitutionFor(P, kind) {
  return kind === KIND_CONCRETE ? P.eConcrete : (kind === KIND_FOLIAGE ? P.eFoliage : P.eTerrain);
}

/** Classify an impact energy (J). */
export function classifyEnergy(P, e) {
  if (e < P.eScrape) return CLS_SCRAPE;
  if (e < P.eWobble) return CLS_WOBBLE;
  if (e < P.eCrash) return CLS_PROP;
  return CLS_CRASH;
}

/** Distance from the body center to the box surface along world direction n
 *  (support extent): hx|n_b.x| + hy|n_b.y| + hz|n_b.z|. */
export function supportExtent(s, P, nx, ny, nz) {
  rotationInto(s.q, RM);
  const bx = RM[0] * nx + RM[3] * ny + RM[6] * nz;
  const by = RM[1] * nx + RM[4] * ny + RM[7] * nz;
  const bz = RM[2] * nx + RM[5] * ny + RM[8] * nz;
  return P.hx * Math.abs(bx) + P.hy * Math.abs(by) + P.hz * Math.abs(bz);
}

function cross(ax, ay, az, bx, by, bz, o) {
  o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx;
}

/**
 * Resolve one contact (normal impulse + Coulomb friction). Mutates s.v, s.w
 * and damage/integrity/cut. Returns out.cls (CLS_NONE if separating).
 */
export function resolveContact(s, P, hit, out) {
  out.cls = CLS_NONE; out.energy = 0; out.vn = 0; out.impulse = 0; out.motorsHit = 0;
  rotationInto(s.q, RM);
  const nx = hit.nx, ny = hit.ny, nz = hit.nz;
  // everything below in the BODY frame (inertia diagonal there)
  nb[0] = RM[0] * nx + RM[3] * ny + RM[6] * nz;
  nb[1] = RM[1] * nx + RM[4] * ny + RM[7] * nz;
  nb[2] = RM[2] * nx + RM[5] * ny + RM[8] * nz;
  // support point = deepest box corner against the normal (face/edge centre if aligned)
  rb[0] = Math.abs(nb[0]) < 1e-3 ? 0 : (nb[0] > 0 ? -P.hx : P.hx);
  rb[1] = Math.abs(nb[1]) < 1e-3 ? 0 : (nb[1] > 0 ? -P.hy : P.hy);
  rb[2] = Math.abs(nb[2]) < 1e-3 ? 0 : (nb[2] > 0 ? -P.hz : P.hz);
  // contact point velocity (body frame)
  const v = s.v, w = s.w;
  vb[0] = RM[0] * v[0] + RM[3] * v[1] + RM[6] * v[2];
  vb[1] = RM[1] * v[0] + RM[4] * v[1] + RM[7] * v[2];
  vb[2] = RM[2] * v[0] + RM[5] * v[1] + RM[8] * v[2];
  cross(w[0], w[1], w[2], rb[0], rb[1], rb[2], tmp);
  const cvx = vb[0] + tmp[0], cvy = vb[1] + tmp[1], cvz = vb[2] + tmp[2];
  const vn = cvx * nb[0] + cvy * nb[1] + cvz * nb[2];
  if (vn >= 0) return CLS_NONE;
  out.vn = vn;
  const invM = 1 / P.mass;
  const e = -vn < P.eMinVn ? 0 : restitutionFor(P, hit.kind);
  // effective mass along n: 1/m + n . ((I^-1 (r x n)) x r)
  cross(rb[0], rb[1], rb[2], nb[0], nb[1], nb[2], tmp);
  tmp[0] *= P.invIx; tmp[1] *= P.invIy; tmp[2] *= P.invIz;
  cross(tmp[0], tmp[1], tmp[2], rb[0], rb[1], rb[2], tmp2);
  const kn = invM + tmp2[0] * nb[0] + tmp2[1] * nb[1] + tmp2[2] * nb[2];
  const j = -(1 + e) * vn / kn;
  const E = 0.5 * P.mass * vn * vn;
  // apply normal impulse
  v[0] += j * nx * invM; v[1] += j * ny * invM; v[2] += j * nz * invM;
  cross(rb[0], rb[1], rb[2], nb[0], nb[1], nb[2], tmp);
  w[0] += j * P.invIx * tmp[0]; w[1] += j * P.invIy * tmp[1]; w[2] += j * P.invIz * tmp[2];

  // friction (Coulomb, clamped so it never reverses tangential slip)
  // recompute post-impulse tangential velocity at the contact point
  vb[0] = RM[0] * v[0] + RM[3] * v[1] + RM[6] * v[2];
  vb[1] = RM[1] * v[0] + RM[4] * v[1] + RM[7] * v[2];
  vb[2] = RM[2] * v[0] + RM[5] * v[1] + RM[8] * v[2];
  cross(w[0], w[1], w[2], rb[0], rb[1], rb[2], tmp);
  let ux = vb[0] + tmp[0], uy = vb[1] + tmp[1], uz = vb[2] + tmp[2];
  const un = ux * nb[0] + uy * nb[1] + uz * nb[2];
  ux -= un * nb[0]; uy -= un * nb[1]; uz -= un * nb[2];
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (ul > 1e-9 && P.mu > 0) {
    tb[0] = ux / ul; tb[1] = uy / ul; tb[2] = uz / ul;
    cross(rb[0], rb[1], rb[2], tb[0], tb[1], tb[2], tmp);
    tmp[0] *= P.invIx; tmp[1] *= P.invIy; tmp[2] *= P.invIz;
    cross(tmp[0], tmp[1], tmp[2], rb[0], rb[1], rb[2], tmp2);
    const kt = invM + tmp2[0] * tb[0] + tmp2[1] * tb[1] + tmp2[2] * tb[2];
    let jt = ul / kt;
    const cap = P.mu * j;
    if (jt > cap) jt = cap;
    // world tangent = R * tb
    const twx = RM[0] * tb[0] + RM[1] * tb[1] + RM[2] * tb[2];
    const twy = RM[3] * tb[0] + RM[4] * tb[1] + RM[5] * tb[2];
    const twz = RM[6] * tb[0] + RM[7] * tb[1] + RM[8] * tb[2];
    v[0] -= jt * twx * invM; v[1] -= jt * twy * invM; v[2] -= jt * twz * invM;
    cross(rb[0], rb[1], rb[2], tb[0], tb[1], tb[2], tmp);
    w[0] -= jt * P.invIx * tmp[0]; w[1] -= jt * P.invIy * tmp[1]; w[2] -= jt * P.invIz * tmp[2];
  }

  // classification + consequences
  const cls = classifyEnergy(P, E);
  out.cls = cls; out.energy = E; out.impulse = j;
  if (cls === CLS_SCRAPE) {
    s.integrity -= 0.002 * (E / P.eScrape);
  } else if (cls === CLS_WOBBLE) {
    s.integrity -= 0.02;
  } else if (cls === CLS_PROP) {
    s.integrity -= 0.08;
    if (Math.abs(ny) < 0.5) {                         // mostly horizontal normal -> hit the props
      let f = (E - P.eWobble) / (P.eCrash - P.eWobble);
      f = f < 0 ? 0 : (f > 1 ? 1 : f);
      const dmg = 0.2 + 0.4 * f;
      const reach = P.propNear * P.bodyScale, reach2 = reach * reach;
      let mask = 0;
      for (let i = 0; i < 4; i++) {
        const dx = MX[i] * P.armL * P.bodyScale - rb[0];
        const dz = MZ[i] * P.armL * P.bodyScale - rb[2];
        if (dx * dx + rb[1] * rb[1] + dz * dz < reach2) {
          const d = s.dmg[i] + dmg;
          s.dmg[i] = d > 1 ? 1 : d;
          mask |= 1 << i;
        }
      }
      out.motorsHit = mask;
    }
  } else {
    s.integrity -= 0.4;
    s.cut = 1;                                         // motors cut, drone tumbles
  }
  if (s.integrity < 0) s.integrity = 0;
  return cls;
}

/**
 * Convenience for a horizontal plane at y = planeY: depenetrate along +y and
 * resolve. Returns the class (CLS_NONE if not touching or separating).
 */
export function resolvePlane(s, P, planeY, kind, out) {
  const ext = supportExtent(s, P, 0, 1, 0);
  if (s.p[1] - ext >= planeY) { out.cls = CLS_NONE; return CLS_NONE; }
  s.p[1] = planeY + ext;
  PLANE_HIT.kind = kind; PLANE_HIT.px = s.p[0]; PLANE_HIT.py = planeY; PLANE_HIT.pz = s.p[2];
  return resolveContact(s, P, PLANE_HIT, out);
}

// ---- last-safe snapshot (respawn) ------------------------------------------------
export function createSafeSnapshot() {
  return { valid: 0, p: new Float64Array(3), q: new Float64Array(4), t: 0 };
}
export function recordSafe(snap, s) {
  snap.p.set(s.p); snap.q.set(s.q); snap.t = s.t; snap.valid = 1;
}
/** Restore position/attitude, zero motion, clear damage and cut. Returns false if no snapshot. */
export function restoreSafe(s, P, snap) {
  if (!snap.valid) return false;
  s.p.set(snap.p); s.q.set(snap.q);
  // keep yaw only: level the drone
  const q = s.q;
  const fx = -(2 * (q[1] * q[3] + q[0] * q[2])), fz = -(1 - 2 * (q[1] * q[1] + q[2] * q[2]));
  const yaw = Math.atan2(-fx, -fz);
  q[0] = Math.cos(yaw / 2); q[1] = 0; q[2] = Math.sin(yaw / 2); q[3] = 0;
  s.v.fill(0); s.w.fill(0); s.iv.fill(0); s.vcf.fill(0);
  s.dmg.fill(0); s.cut = 0; s.integrity = 1;
  s.m.fill(P.hoverW);
  return true;
}

/** Soft vegetation drag: density 0..1 overlap. Damps velocity/spin, no impulse, no damage. */
export function vegetationDrag(s, P, density, dt) {
  const f = Math.exp(-P.vegDrag * density * dt);
  const v = s.v, w = s.w;
  v[0] *= f; v[1] *= f; v[2] *= f;
  const fw = Math.exp(-0.5 * P.vegDrag * density * dt);
  w[0] *= fw; w[1] *= fw; w[2] *= fw;
  return f;
}
