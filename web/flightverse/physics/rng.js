// flightverse/physics/rng.js — seeded PRNG (mulberry32) + gaussian. Pure, no
// allocations after creation. State lives in a plain object so it can be
// copied (snapshots / respawn) and compared bit-for-bit in tests.

export function createRng(seed = 1) {
  return { s: seed >>> 0, spare: 0, has: 0 };
}

export function rngSeed(r, seed) {
  r.s = seed >>> 0; r.spare = 0; r.has = 0;
}

export function rngCopy(dst, src) {
  dst.s = src.s; dst.spare = src.spare; dst.has = src.has;
}

/** Uniform in [0,1). */
export function rngNext(r) {
  let t = (r.s = (r.s + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal (Box-Muller with cached spare). */
export function rngGauss(r) {
  if (r.has) { r.has = 0; return r.spare; }
  let u = rngNext(r);
  if (u < 1e-12) u = 1e-12;
  const v = rngNext(r);
  const m = Math.sqrt(-2 * Math.log(u));
  const a = 6.283185307179586 * v;
  r.spare = m * Math.sin(a);
  r.has = 1;
  return m * Math.cos(a);
}
