// flightverse/fx/atlas.js — the ONE shared FX texture atlas (4x4 cells, 128 px each, white
// RGB + shaped alpha; colour comes from the instance). Procedural, seeded, no assets.

export const ATLAS_CELLS = Object.freeze({
  glow: 0, flash: 1, ring: 2, streak: 3, spark: 4, smokeA: 5, smokeB: 6, scorch: 7,
  crater: 8, dust: 9, crack: 10, leaf: 11, puffHot: 12, flare: 13, hole: 14, star: 15,
});
const GRID = 4;
const SIZE = 128;

/** uv rect [u0, v0, du, dv] for a cell name (canvas row 0 = top; texture flipY). */
export function cellRect(name) {
  const index = ATLAS_CELLS[name] ?? 0;
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  const d = 1 / GRID;
  return [col * d, 1 - (row + 1) * d, d, d];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fill one cell from a per-pixel alpha function f(x,y) -> 0..1 in [-1,1]^2. */
function paint(ctx, index, f, rgb = [255, 255, 255]) {
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  const img = ctx.createImageData(SIZE, SIZE);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const x = (i + 0.5) / SIZE * 2 - 1;
      const y = 1 - (j + 0.5) / SIZE * 2;      // +y up, like uv space
      const a = Math.min(1, Math.max(0, f(x, y)));
      const o = (j * SIZE + i) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, col * SIZE, row * SIZE);
}

/** Lobed puff: sum of soft discs with a fixed seed; silhouette irregular, density varies. */
function lobes(seed, count, spread, minR, maxR, weight = 0.11) {
  const r = mulberry32(seed);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * spread;
    items.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: minR + r() * (maxR - minR), w: weight * (0.5 + r()) });
  }
  return (x, y) => {
    let v = 0;
    for (const l of items) {
      const dx = x - l.x; const dy = y - l.y;
      const d2 = (dx * dx + dy * dy) / (l.r * l.r);
      if (d2 < 1) v += l.w * (1 - d2) * (1 - d2);
    }
    const edge = 1 - smooth(0.78, 1.0, Math.hypot(x, y));
    return Math.min(1, v * 3.0) * edge;
  };
}

/** Build the atlas canvas (browser only). */
export function buildAtlasCanvas(doc = document) {
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = GRID * SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const C = ATLAS_CELLS;

  paint(ctx, C.glow, (x, y) => {
    const r = Math.hypot(x, y);
    return Math.exp(-3.4 * r * r) * (1 - smooth(0.85, 1, r));
  });
  paint(ctx, C.flash, (x, y) => {
    const r = Math.hypot(x, y);
    const core = Math.exp(-9 * r * r);
    const spikeX = Math.exp(-(y * y) / 0.004) * Math.exp(-Math.abs(x) * 2.6);
    const spikeY = Math.exp(-(x * x) / 0.004) * Math.exp(-Math.abs(y) * 2.6);
    const d1 = Math.exp(-((x - y) * (x - y)) / 0.012) * Math.exp(-r * 4.5) * 0.5;
    const d2 = Math.exp(-((x + y) * (x + y)) / 0.012) * Math.exp(-r * 4.5) * 0.5;
    return (core + 0.85 * (spikeX + spikeY) + d1 + d2 + 0.25 * Math.exp(-2.2 * r * r)) * (1 - smooth(0.88, 1, r));
  });
  paint(ctx, C.ring, (x, y) => {
    const r = Math.hypot(x, y);
    const ringA = Math.exp(-((r - 0.82) * (r - 0.82)) / 0.0035);
    const halo = Math.exp(-((r - 0.78) * (r - 0.78)) / 0.05) * 0.22;
    return (ringA + halo) * (1 - smooth(0.93, 1, r)) * smooth(0.05, 0.3, r);
  });
  paint(ctx, C.streak, (x, y) => {
    // u along x: -1 tail .. +1 head. Bright hot head, long fading tail, thin across y
    const u = (x + 1) / 2;
    const across = 1 - smooth(0.25, 1.0, Math.abs(y));   // flat core: stays readable at 2–3 px
    const along = Math.pow(u, 1.7);
    const head = Math.exp(-((1 - u) * (1 - u)) / 0.004);
    const cap = 1 - smooth(0.9, 1, u);
    return Math.min(1, across * (along * 0.95 + head * 0.6) * (0.15 + 0.85 * cap) + Math.exp(-(y * y) / 0.6) * along * 0.0);
  });
  paint(ctx, C.spark, (x, y) => {
    const r = Math.hypot(x, y);
    return (Math.exp(-14 * r * r) + 0.35 * Math.exp(-3 * r * r)) * (1 - smooth(0.85, 1, r));
  });
  paint(ctx, C.smokeA, lobes(11, 34, 0.5, 0.22, 0.5, 0.22));
  paint(ctx, C.smokeB, lobes(29, 40, 0.55, 0.18, 0.45, 0.22));
  paint(ctx, C.scorch, (x, y) => {
    const r = Math.hypot(x, y);
    const rough = lobes(5, 26, 0.55, 0.25, 0.5, 0.2)(x, y);
    return Math.min(1, (Math.exp(-2.4 * r * r) * 0.9 + rough * 0.6)) * (1 - smooth(0.7, 0.98, r));
  });
  paint(ctx, C.crater, (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    const rays = 0.5 + 0.5 * Math.sin(a * 11 + 1.3) * Math.sin(a * 5.3);
    const body = Math.exp(-2.1 * r * r);
    const rim = Math.exp(-((r - 0.66) * (r - 0.66)) / 0.02) * (0.4 + 0.4 * rays);
    return Math.min(1, body * 0.95 + rim) * (1 - smooth(0.78, 0.98, r));
  });
  paint(ctx, C.dust, lobes(77, 30, 0.45, 0.3, 0.55, 0.09));
  paint(ctx, C.crack, (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    let v = Math.exp(-14 * r * r);
    for (let k = 0; k < 7; k += 1) {
      const ang = k * 0.9 + Math.sin(k * 3.1) * 0.3;
      const da = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
      v += Math.exp(-(da * da) / 0.006) * Math.exp(-r * 2.6) * (r < 0.88 ? 1 : 0);
    }
    return Math.min(1, v) * (1 - smooth(0.85, 1, r));
  });
  paint(ctx, C.leaf, (x, y) => {
    const u = x * 1.3;
    const inside = 1 - smooth(0.8, 1.0, Math.hypot(u * 0.75, y * 1.9));
    const rib = 1 - 0.35 * Math.exp(-(y * y) / 0.003);
    return inside * rib;
  });
  paint(ctx, C.puffHot, lobes(41, 28, 0.38, 0.3, 0.55, 0.17));
  paint(ctx, C.flare, (x, y) => {
    const r = Math.hypot(x * 0.6, y);
    return (Math.exp(-7 * r * r) * 0.9 + Math.exp(-2 * r * r) * 0.35) * (1 - smooth(0.85, 1, Math.hypot(x, y)));
  });
  paint(ctx, C.hole, (x, y) => {
    const r = Math.hypot(x, y);
    return (Math.exp(-18 * r * r) + 0.4 * Math.exp(-((r - 0.45) * (r - 0.45)) / 0.03)) * (1 - smooth(0.8, 1, r));
  });
  paint(ctx, C.star, (x, y) => {
    // horizontal spike, bright centre, for crossed muzzle quads (u along x)
    const across = 1 - smooth(0.2, 1.0, Math.abs(y));
    const along = Math.exp(-(x * x) / 0.3);
    return across * along * (1 - smooth(0.9, 1, Math.abs(x)));
  });
  return canvas;
}
