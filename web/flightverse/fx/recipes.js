// flightverse/fx/recipes.js — layered FX recipes as data + generators (pure: they drive a
// "sink" object, so they are unit-testable without Three). Spec §5.
//
// sink API (implemented by fx-system.js):
//   sprite({pos,vel,size0,size1,life,cell,layer,c0,c1,rot,spin,drag,buoy,grav,maxScreen,delay})
//   streak({pos,vel,stretch,width,life,c0,c1,grav,drag})     // spark streak oriented by velocity
//   ring({pos,normal,r0,r1,life,c0,c1})                      // expanding ring on the surface plane
//   debris({pos,vel,size,life,color,spin})                   // instanced shard
//   decal({pos,normal,size,life,cell,c0,rot})                // ring-buffered decal
//   light({pos,color,intensity,distance,life})
//   screenFlash(alpha, life)
// Colours are DISPLAY values [r,g,b,a] (sRGB-ish, >1 = HDR glow); the sink linearises them.

const TAU = Math.PI * 2;

export const FIRE = Object.freeze({
  hot: [2.0, 1.75, 1.15, 1], mid: [1.5, 0.78, 0.22, 0.9], red: [0.75, 0.2, 0.05, 0.5], out: [0.3, 0.05, 0.02, 0],
});
const SMOKE_A = [0.1, 0.095, 0.09, 0.0];
const SMOKE_B = [0.46, 0.44, 0.42, 0.0];
// On a 430 px screen the spec sizes read too small at 30-60 m: sprite size is DIAMETER and gets this boost.
const VIS = 1.5;

/** Explosion classes: counts taken from the spec; `lifeScale` only for tests. */
export const EXPLOSIONS = Object.freeze({
  S: Object.freeze({
    flash: { size: 1.5, life: 0.06 },
    fireball: { n: 6, size: 1.2, life: 0.22 },
    smoke: { n: 6, size: 2.0, life: 0.9 },
    debris: { n: 8, life: 0.8, speed: [5, 13] },
    flashPx: 52, firePx: 30, core: null, embers: 0, bring: null,
    sparks: { n: 6, life: 0.3 },
    light: { intensity: 60, distance: 14, life: 0.10, color: '#FFB066' },
    ring: null, decal: { size: 0.9, life: 6 },
    shake: 'T1', hitstop: 40,
  }),
  M: Object.freeze({
    flash: { size: 3.2, life: 0.08 },
    fireball: { n: 10, size: 3.0, life: 0.6 },
    smoke: { n: 12, size: 4.0, life: 2.4 },
    ring: { r1: 6, life: 0.25, alpha: 0.6 },
    debris: { n: 16, life: 1.7, speed: [8, 21] },
    flashPx: 150, firePx: 80, core: { n: 4, size: 3.2, life: 2.0 }, embers: 10, bring: { r1: 7.5, life: 0.38, px: 210 },
    sparks: { n: 12, life: 0.5 },
    light: { intensity: 150, distance: 40, life: 0.16, color: '#FFB066' },
    decal: { size: 2.0, life: 6 },
    shake: 'T2', hitstop: 60,
  }),
  XL: Object.freeze({
    flash: { size: 9, life: 0.10 },
    screen: { alpha: 0.15, life: 0.08 },
    fireball: { n: 16, size: 9, life: 1.05 },
    smoke: { n: 20, size: 9, life: 4.6, column: true },
    ring: { r1: 18, life: 0.5, alpha: 0.7 },
    debris: { n: 32, life: 1.9, speed: [9, 30] },
    flashPx: 360, firePx: 200, core: { n: 6, size: 9, life: 3.6 }, embers: 16, bring: { r1: 24, life: 0.65, px: 460 },
    sparks: { n: 20, life: 0.8 },
    light: { intensity: 420, distance: 90, life: 0.30, color: '#FFC27A' },
    decal: { size: 6.5, life: 6 },
    haze: { life: 0.4 },
    shake: 'T3', hitstop: 80,
  }),
});

const rnd2 = (rnd, a, b) => a + (b - a) * rnd();

function unit(rnd) {
  // uniform direction on the sphere
  const z = rnd() * 2 - 1;
  const a = rnd() * TAU;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(a), y: z, z: r * Math.sin(a) };
}

/** Random direction in the hemisphere around `n` (biased towards n by `bias`). */
function hemi(rnd, n, bias = 0.5) {
  const u = unit(rnd);
  const d = u.x * n.x + u.y * n.y + u.z * n.z;
  const flip = d < 0 ? -1 : 1;
  const v = { x: u.x * flip + n.x * bias, y: u.y * flip + n.y * bias, z: u.z * flip + n.z * bias };
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });

/**
 * Layered explosion. Returns counts per layer for telemetry/tests.
 * `q` is the tier quality factor (non-essential counts scale; flash/fireball never drop to 0).
 */
export function explosion(kind, sink, { pos, normal = { x: 0, y: 1, z: 0 }, rnd = Math.random, q = 1, ground = true, scale = 1, plasma = false } = {}) {
  const R = EXPLOSIONS[kind] || EXPLOSIONS.M;
  const counts = { flash: 0, fireball: 0, smoke: 0, ring: 0, debris: 0, sparks: 0, light: 0, decal: 0, screen: 0, core: 0, embers: 0, shock: 0 };
  const up = ground ? normal : { x: 0, y: 1, z: 0 };
  const big = kind === 'XL';

  // flash — never skipped
  sink.sprite({
    pos, vel: { x: 0, y: 0, z: 0 }, size0: R.flash.size * 0.7 * scale * VIS, size1: R.flash.size * 1.2 * scale * VIS, life: R.flash.life * 1.3,
    cell: 'flash', layer: 'add', c0: [2.6, 2.3, 1.7, 1], c1: [1.4, 0.8, 0.3, 0], rot: rnd() * TAU, spin: 0, drag: 0,
    maxScreen: big ? 0.9 : 0.6, kind: 'flash', minPx: R.flashPx,
  });
  counts.flash += 1;
  if (R.screen) { sink.screenFlash(R.screen.alpha, R.screen.life); counts.screen += 1; }

  // fireball: overlapping sprites offset from the centre, hot -> red -> out
  const nFire = Math.max(3, Math.round(R.fireball.n * (0.6 + 0.4 * q)));
  for (let i = 0; i < nFire; i += 1) {
    const d = hemi(rnd, up, 0.9);
    const speed = R.fireball.size * rnd2(rnd, 0.6, 1.6);
    const life = R.fireball.life * rnd2(rnd, 0.8, 1.25);
    const off = mul(d, R.fireball.size * 0.18 * rnd());
    const s = R.fireball.size * rnd2(rnd, 0.7, 1.05) * scale * VIS;
    sink.sprite({
      pos: add(pos, off, 1), vel: mul(d, speed), size0: s * 0.35, size1: s, life,
      cell: rnd() < 0.5 ? 'glow' : 'puffHot', layer: 'add', c0: FIRE.hot, c1: rnd() < 0.5 ? FIRE.red : FIRE.mid,
      rot: rnd() * TAU, spin: rnd2(rnd, -2, 2), drag: 2.4, buoy: 1.5, maxScreen: big ? 0.8 : 0.5, kind: 'fire', minPx: R.firePx * (0.6 + 0.4 * rnd()),
      delay: i < 2 ? 0 : rnd() * R.fireball.life * 0.25,
    });
    counts.fireball += 1;
  }

  // smoke: structured puffs (normal blend), grows and rises, stays dark (never solid black ink)
  const nSmoke = Math.max(2, Math.round(R.smoke.n * q));
  for (let i = 0; i < nSmoke; i += 1) {
    const d = R.smoke.column ? { x: rnd2(rnd, -0.25, 0.25), y: 1, z: rnd2(rnd, -0.25, 0.25) } : hemi(rnd, up, 0.6);
    const speed = R.smoke.column ? rnd2(rnd, 5, 12) : rnd2(rnd, 1.2, 4.2) * (R.smoke.size / 2);
    const delay = R.smoke.column ? (i / nSmoke) * 0.6 : rnd() * 0.12;
    const s = R.smoke.size * rnd2(rnd, 0.7, 1.1) * scale * VIS;
    sink.sprite({
      pos: add(pos, { x: rnd2(rnd, -1, 1), y: 0.2, z: rnd2(rnd, -1, 1) }, R.fireball.size * 0.12), vel: mul(d, speed),
      size0: s * 0.3, size1: s, life: R.smoke.life * rnd2(rnd, 0.7, 1), cell: rnd() < 0.5 ? 'smokeA' : 'smokeB', layer: 'norm',
      c0: SMOKE_A, c1: SMOKE_B, rot: rnd() * TAU, spin: rnd2(rnd, -0.6, 0.6), drag: 1.6, buoy: R.smoke.column ? 2.4 : 1.1,
      maxScreen: big ? 0.8 : 0.55, kind: 'smoke', delay, peak: 1.0, minPx: R.firePx * 0.85,
    });
    counts.smoke += 1;
  }

  // shockwave ring on the surface plane (M, XL)
  if (R.ring) {
    sink.ring({
      pos: add(pos, up, 0.06), normal: up, r0: 0.4, r1: R.ring.r1 * scale, life: R.ring.life * 1.3,
      c0: [2.0, 1.8, 1.4, R.ring.alpha], c1: [0.9, 0.85, 0.75, 0], kind: 'shockwave',
    });
    counts.ring += 1;
    if (big) {   // second, vertical-facing ring so it also reads from a chase/FPV angle
      sink.ring({
        pos: add(pos, up, 0.6), normal: up, r0: 0.6, r1: R.ring.r1 * 1.25 * scale, life: R.ring.life * 1.2,
        c0: [1.0, 0.95, 0.85, 0.35], c1: [0.6, 0.6, 0.6, 0], kind: 'shockwave',
      });
      counts.ring += 1;
    }
  }

  // camera-facing shock ring (reads from ANY view angle; min apparent size for phones)
  if (R.bring) {
    sink.sprite({
      pos: add(pos, up, 0.3), vel: { x: 0, y: 0, z: 0 }, size0: 1.2, size1: R.bring.r1 * 2 * scale, life: R.bring.life, cell: 'ring', layer: 'add',
      c0: plasma ? [1.6, 1.2, 3.0, 0.95] : [2.4, 2.0, 1.4, 0.95], c1: plasma ? [0.5, 0.3, 1.4, 0] : [1.0, 0.75, 0.45, 0], rot: 0,
      maxScreen: big ? 0.85 : 0.6, kind: 'shockwave', minPx: R.bring.px,
    });
    counts.shock += 1;
  }
  // dark smoke core: gives the fireball something to read against (additive alone washes out on a bright sky)
  if (R.core) {
    const nCore = Math.max(2, Math.round(R.core.n * q));
    for (let i = 0; i < nCore; i += 1) {
      const d = hemi(rnd, up, 0.7);
      sink.sprite({
        pos: add(pos, up, 0.4), vel: mul(d, rnd2(rnd, 1.5, 5) * (R.core.size / 3)), size0: R.core.size * 0.3 * scale * VIS, size1: R.core.size * rnd2(rnd, 0.8, 1.15) * scale * VIS,
        life: R.core.life * rnd2(rnd, 0.75, 1), cell: rnd() < 0.5 ? 'smokeA' : 'smokeB', layer: 'norm', c0: [0.06, 0.055, 0.05, 0], c1: [0.3, 0.28, 0.27, 0],
        rot: rnd() * TAU, spin: rnd2(rnd, -0.5, 0.5), drag: 1.8, buoy: big ? 2.0 : 1.2, maxScreen: big ? 0.8 : 0.5, kind: 'smoke', delay: 0.05 + rnd() * 0.15, peak: 0.95,
        minPx: R.firePx * 0.9,
      });
      counts.core += 1;
    }
  }
  // embers: hot glowing motes that arc up and fall (additive)
  if (R.embers) {
    const nEmb = Math.max(3, Math.round(R.embers * q));
    for (let i = 0; i < nEmb; i += 1) {
      const d = hemi(rnd, up, 1.4);
      sink.sprite({
        pos: add(pos, up, 0.3), vel: mul(d, rnd2(rnd, 6, big ? 26 : 16)), size0: 0.5 * scale, size1: 0.2 * scale, life: rnd2(rnd, 0.8, 1.5), cell: 'spark', layer: 'add',
        c0: [2.6, 1.6, 0.6, 1], c1: [1.2, 0.3, 0.05, 0], drag: 0.3, grav: 16, maxScreen: 0.05, kind: 'ember', minPx: 5,
      });
      counts.embers += 1;
    }
  }
  if (plasma) {   // NOVA: violet-white energy core + crackling arcs on top of the fireball
    sink.sprite({
      pos, vel: { x: 0, y: 0, z: 0 }, size0: R.flash.size * 0.5 * scale * VIS, size1: R.flash.size * 1.5 * scale * VIS, life: 0.35, cell: 'orb', layer: 'add',
      c0: [1.6, 1.1, 3.4, 1], c1: [0.6, 0.3, 1.6, 0], rot: 0, maxScreen: 0.9, kind: 'plasma', minPx: R.flashPx * 0.8,
    });
    const nArc = Math.max(4, Math.round(10 * q));
    for (let i = 0; i < nArc; i += 1) {
      const d = unit(rnd);
      sink.streak({ pos, vel: mul(d, rnd2(rnd, 18, 44)), stretch: 0.06, width: 0.14 * scale, minW: 3, life: rnd2(rnd, 0.3, 0.6), c0: [1.6, 1.3, 3.2, 1], c1: [0.5, 0.3, 1.4, 0], grav: 2, drag: 0.6 });
    }
  }

  // debris shards ballistic; dies against the floor in the sink
  const nDebris = Math.max(2, Math.round(R.debris.n * q));
  for (let i = 0; i < nDebris; i += 1) {
    const d = hemi(rnd, up, 1.1);
    const speed = rnd2(rnd, R.debris.speed[0], R.debris.speed[1]);
    sink.debris({
      pos: add(pos, up, 0.2), vel: mul(d, speed), size: rnd2(rnd, 0.14, big ? 0.7 : 0.4), life: R.debris.life * rnd2(rnd, 0.7, 1.2),
      color: [0x8a8278, 0xa09880, 0x6e675d, 0x9a8f7a, 0x2c2723, 0x8a4c38][i % 6], spin: rnd2(rnd, 4, 14),
    });
    counts.debris += 1;
  }

  // spark streaks
  const nSparks = Math.max(3, Math.round(R.sparks.n * q));
  for (let i = 0; i < nSparks; i += 1) {
    const d = hemi(rnd, up, 0.8);
    sink.streak({
      pos, vel: mul(d, rnd2(rnd, 12, big ? 34 : 24)), stretch: 0.05, width: 0.06 * (big ? 2 : 1) * scale, minW: 2.4, life: R.sparks.life * rnd2(rnd, 0.6, 1),
      c0: [2.0, 1.5, 0.7, 1], c1: [1.0, 0.3, 0.05, 0], grav: 14, drag: 0.4,
    });
    counts.sparks += 1;
  }

  // scorch/crater decal on surfaces
  if (ground && R.decal) {
    sink.decal({
      pos: add(pos, normal, 0.04), normal, size: R.decal.size * scale * 1.35, life: R.decal.life * 1.6, cell: kind === 'S' ? 'scorch' : 'crater',
      c0: [0.05, 0.045, 0.04, 0.85], rot: rnd() * TAU,
    });
    counts.decal += 1;
  }

  // one pooled light pulse
  sink.light({ pos: add(pos, up, 1.2), color: R.light.color, intensity: R.light.intensity * scale, distance: R.light.distance, life: R.light.life });
  counts.light += 1;
  if (R.haze) sink.haze?.(R.haze.life);
  return counts;
}

/** Bullet impact by surface type. Returns the number of particles emitted (excluding the decal). */
export function surfaceImpact(type, sink, { pos, normal = { x: 0, y: 1, z: 0 }, rnd = Math.random, q = 1, heavy = false } = {}) {
  let n = 0;
  const sparks = (count, hot = 1) => {
    for (let i = 0; i < count; i += 1) {
      const d = hemi(rnd, normal, 0.9);
      sink.streak({
        pos, vel: mul(d, rnd2(rnd, 9, heavy ? 26 : 18)), stretch: 0.04, width: heavy ? 0.06 : 0.035, life: rnd2(rnd, 0.14, 0.3),
        c0: [2.2 * hot, 1.6 * hot, 0.8 * hot, 1], c1: [1.1, 0.35, 0.08, 0], grav: 16, drag: 0.5,
      });
      n += 1;
    }
  };
  const puff = (color0, color1, size, life, count = 1, cell = 'dust') => {
    for (let i = 0; i < count; i += 1) {
      const d = hemi(rnd, normal, 1.2);
      sink.sprite({
        pos, vel: mul(d, rnd2(rnd, 0.8, 3)), size0: size * 0.4, size1: size * rnd2(rnd, 0.9, 1.3), life: life * rnd2(rnd, 0.8, 1),
        cell, layer: 'norm', c0: color0, c1: color1, rot: rnd() * TAU, spin: rnd2(rnd, -1, 1), drag: 2.4, buoy: 0.8, maxScreen: 0.3, kind: 'dust',
      });
      n += 1;
    }
  };
  const k = heavy ? 1.6 : 1;
  switch (type) {
    case 'concrete':
      puff([0.55, 0.54, 0.52, 0.0], [0.6, 0.59, 0.57, 0.0], 0.9 * k, 0.45, 2);
      sparks(Math.max(2, Math.round((heavy ? 5 : 3) * q)));
      break;
    case 'foliage':
      for (let i = 0; i < 4; i += 1) {
        const d = hemi(rnd, normal, 1.0);
        sink.sprite({
          pos, vel: mul(d, rnd2(rnd, 1.5, 5)), size0: 0.16, size1: 0.2, life: rnd2(rnd, 0.3, 0.45), cell: 'leaf', layer: 'norm',
          c0: [0.18, 0.42, 0.12, 1], c1: [0.3, 0.4, 0.1, 0], rot: rnd() * TAU, spin: rnd2(rnd, -9, 9), drag: 1.2, grav: 4, maxScreen: 0.15, kind: 'leaf',
        });
        n += 1;
      }
      puff([0.3, 0.42, 0.25, 0.0], [0.35, 0.45, 0.3, 0.0], 0.5, 0.35, 2);
      break;
    case 'metal':
      sparks(Math.max(4, Math.round((heavy ? 12 : 8) * q)), 1.2);
      sink.sprite({
        pos, vel: { x: 0, y: 0, z: 0 }, size0: 0.25 * k, size1: 0.5 * k, life: 0.06, cell: 'flash', layer: 'add', c0: [2.2, 1.9, 1.4, 1], c1: [1.3, 0.7, 0.2, 0],
        rot: rnd() * TAU, maxScreen: 0.15, kind: 'flash',
      });
      n += 1;
      break;
    case 'body':
      puff([0.36, 0.02, 0.03, 0.0], [0.3, 0.02, 0.03, 0.0], 0.6, 0.35, 3, 'glow');
      sparks(2, 0.8);
      break;
    case 'energy':
      sparks(Math.max(3, Math.round(5 * q)), 1.3);
      break;
    case 'ground':
    default:
      puff([0.42, 0.33, 0.22, 0.0], [0.46, 0.37, 0.26, 0.0], 1.0 * k, 0.5, 2);
      for (let i = 0; i < 3; i += 1) {
        const d = hemi(rnd, normal, 1.4);
        sink.debris({ pos, vel: mul(d, rnd2(rnd, 3, 9)), size: rnd2(rnd, 0.05, 0.12), life: 0.4, color: 0x5a4a38, spin: 9 });
        n += 1;
      }
      break;
  }
  return n;
}

/** Muzzle flash: billboard star + two crossed quads along the barrel (+ optional smoke wisp). */
export function muzzleFlash(sink, { pos, dir, size = 0.35, life = 0.05, smoke = false, casing = false, rnd = Math.random, ring = false, px = 0 }) {
  sink.sprite({
    pos, vel: { x: 0, y: 0, z: 0 }, size0: size, size1: size * 1.35, life, cell: 'flash', layer: 'add',
    c0: [2.4, 1.9, 1.1, 1], c1: [1.4, 0.7, 0.2, 0], rot: rnd() * TAU, maxScreen: 0.14, kind: 'muzzle', minPx: px || Math.min(34, 14 + size * 30),
  });
  for (let i = 0; i < 2; i += 1) {
    sink.streak({
      pos, vel: mul(dir, 0.01), stretch: size * 1.4 / 0.01, width: size * 0.5, life, cell: 'star',
      c0: [2.0, 1.5, 0.8, 0.9], c1: [1.2, 0.5, 0.1, 0], roll: i * Math.PI / 2, kind: 'muzzle', minW: 4,
    });
  }
  if (ring) {
    sink.ring({ pos, normal: dir, r0: 0.05, r1: size * 1.6, life: life * 1.6, c0: [1.2, 1.6, 2.0, 0.8], c1: [0.4, 0.8, 1.2, 0], kind: 'muzzle' });
  }
  if (smoke) {
    sink.sprite({
      pos, vel: mul(dir, 1.5), size0: size * 0.5, size1: size * 2.2, life: 0.3, cell: 'smokeB', layer: 'norm',
      c0: [0.5, 0.5, 0.5, 0], c1: [0.6, 0.6, 0.6, 0], rot: rnd() * TAU, drag: 2, buoy: 0.8, maxScreen: 0.14, kind: 'smoke',
    });
  }
  if (casing) {
    // spent-casing puff: a tiny dust/brass mote tossed sideways-up
    sink.sprite({
      pos, vel: { x: rnd2(rnd, -1, 1), y: 1.4, z: rnd2(rnd, -1, 1) }, size0: 0.05, size1: 0.12, life: 0.25, cell: 'dust', layer: 'norm',
      c0: [0.7, 0.6, 0.3, 0], c1: [0.6, 0.55, 0.4, 0], drag: 1.5, grav: 6, maxScreen: 0.06, kind: 'casing',
    });
  }
}

/** Player crash: dust puff + 10 drone-coloured shards + 4 prop fragments + sparks + emissive LED bits. */
export function crashBurst(sink, { pos, normal = { x: 0, y: 1, z: 0 }, rnd = Math.random, q = 1, severity = 1 }) {
  const counts = { dust: 0, debris: 0, props: 0, sparks: 0, leds: 0 };
  const nDust = Math.max(3, Math.round(6 * q));
  for (let i = 0; i < nDust; i += 1) {
    const d = hemi(rnd, normal, 0.6);
    sink.sprite({
      pos, vel: mul(d, rnd2(rnd, 1.5, 5)), size0: 0.9, size1: 3.2 * severity, life: 1.1, cell: 'dust', layer: 'norm',
      c0: [0.55, 0.5, 0.42, 0.0], c1: [0.66, 0.62, 0.55, 0.0], rot: rnd() * TAU, spin: rnd2(rnd, -1, 1), drag: 2, buoy: 0.7, maxScreen: 0.5, kind: 'dust', minPx: 26, peak: 0.6,
    });
    counts.dust += 1;
  }
  // impact flash
  sink.sprite({
    pos, vel: { x: 0, y: 0, z: 0 }, size0: 0.8, size1: 2.0 * severity, life: 0.14, cell: 'flash', layer: 'add',
    c0: [2.6, 2.2, 1.5, 1], c1: [1.4, 0.7, 0.2, 0], rot: rnd() * TAU, maxScreen: 0.3, kind: 'flash', minPx: 38,
  });
  // drone-coloured shell/arm shards (white hull, grey arm, dark motor, orange tip)
  const PART = [0xe9eef5, 0xc6ced9, 0x7f8898, 0x262b33, 0xff8c1a];
  for (let i = 0; i < 10; i += 1) {
    const d = hemi(rnd, normal, 1.1);
    sink.debris({ pos: add(pos, normal, 0.15), vel: mul(d, rnd2(rnd, 3, 11) * severity), size: rnd2(rnd, 0.06, 0.2), life: 1.6, color: PART[i % PART.length], spin: rnd2(rnd, 6, 16) });
    counts.debris += 1;
  }
  for (let i = 0; i < 4; i += 1) {
    const d = hemi(rnd, normal, 0.9);
    sink.debris({ pos: add(pos, normal, 0.25), vel: mul(d, rnd2(rnd, 4, 12)), size: [0.05, 0.24, 0.035], life: 1.6, color: i % 2 ? 0x262b33 : 0xff8c1a, spin: rnd2(rnd, 18, 30), prop: true });
    counts.props += 1;
  }
  if (sink.streak) {
    const nSp = Math.max(6, Math.round(14 * q));
    for (let i = 0; i < nSp; i += 1) {
      const d = hemi(rnd, normal, 0.9);
      sink.streak({ pos, vel: mul(d, rnd2(rnd, 6, 18) * severity), stretch: 0.05, width: 0.05, minW: 2.6, life: rnd2(rnd, 0.2, 0.5), c0: [2.4, 1.7, 0.8, 1], c1: [1.1, 0.3, 0.05, 0], grav: 12, drag: 0.4 });
      counts.sparks += 1;
    }
  }
  // emissive LED bits (nav lights / battery sparks) tumbling away, glowing
  const LED = [[2.4, 0.3, 0.2, 1], [0.3, 2.4, 0.5, 1], [2.2, 2.2, 2.4, 1], [2.4, 0.9, 0.2, 1]];
  for (let i = 0; i < 4; i += 1) {
    const d = hemi(rnd, normal, 1.0);
    sink.sprite({
      pos: add(pos, normal, 0.3), vel: mul(d, rnd2(rnd, 3, 9)), size0: 0.22, size1: 0.12, life: rnd2(rnd, 0.9, 1.6), cell: 'spark', layer: 'add',
      c0: LED[i], c1: [LED[i][0] * 0.4, LED[i][1] * 0.4, LED[i][2] * 0.4, 0], drag: 0.5, grav: 12, maxScreen: 0.04, kind: 'led', minPx: 7,
    });
    counts.leds += 1;
  }
  return counts;
}
