// flightverse/fx/trails.js — persistent projectile trail ribbons (missile smoke, NOVA plasma).
// A trail is a ring buffer of timed samples; every sim step it is drawn as chained screen-space
// streak quads through fxs.quad() (immediate quads: no extra draw call, no sprite-pool pressure).
// Trails outlive their projectile (`close()`), so the plume stays 1-2 s after a missile dies.
// Pure logic + a `quad` sink => unit-testable without Three.

const lerp = (a, b, t) => a + (b - a) * t;
const mix4 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];

/**
 * @param {object} o
 * @param {(q:object)=>boolean} o.quad      fxs.quad
 * @param {number} o.budget                 max ribbon quads drawn per step across all trails
 */
export function createTrailSystem({ quad, budget = 40 } = {}) {
  const trails = [];
  let now = 0;
  const stats = { created: 0, peak: 0, drawn: 0, lastDrawn: 0 };

  /**
   * def: { life, interval, layers: [{ layer, cell, life, w0, w1, minW, c0, c1, tail, headOnly }] }
   * `headOnly` = seconds of history the layer covers (e.g. a hot core that only lives 0.3 s).
   */
  function create(def) {
    const cap = Math.ceil(def.life / def.interval) + 3;
    const t = {
      def, cap, n: 0, head: 0, sinceSample: 1e9, closed: false, closedAt: 0,
      x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), at: new Float32Array(cap),
      tip: { x: 0, y: 0, z: 0 }, hasTip: false,
    };
    trails.push(t);
    stats.created += 1;
    stats.peak = Math.max(stats.peak, trails.length);
    return t;
  }

  function push(t, p) {
    const i = t.head;
    t.x[i] = p.x; t.y[i] = p.y; t.z[i] = p.z; t.at[i] = now;
    t.head = (i + 1) % t.cap;
    t.n = Math.min(t.cap, t.n + 1);
  }

  /** Move the trail tip (call every step while the projectile flies). */
  function follow(t, p, dt) {
    if (t.closed) return;
    t.tip.x = p.x; t.tip.y = p.y; t.tip.z = p.z; t.hasTip = true;
    t.sinceSample += dt;
    if (t.sinceSample >= t.def.interval || t.n === 0) { t.sinceSample = 0; push(t, p); }
  }

  function close(t, p = null) {
    if (t.closed) return;
    if (p) { t.tip.x = p.x; t.tip.y = p.y; t.tip.z = p.z; push(t, p); }
    t.closed = true; t.closedAt = now;
  }

  const ax = { x: 0, y: 0, z: 0 };
  const mid = { x: 0, y: 0, z: 0 };

  /** Emit the quads for this step and retire dead trails. Call once per step, before fxs.update. */
  function draw(dt) {
    now += dt;
    let quota = budget;
    const live = trails.length;
    const each = live > 0 ? Math.max(3, Math.floor(budget / live)) : 0;
    let drawn = 0;
    for (let ti = trails.length - 1; ti >= 0; ti -= 1) {
      const t = trails[ti];
      const def = t.def;
      if (t.closed && now - t.closedAt > def.life + 0.05) { trails.splice(ti, 1); continue; }
      if (t.n === 0) continue;
      // segments newest -> oldest; the head segment runs from the last sample to the live tip
      let allowed = Math.min(each, quota);
      let prev = t.closed || !t.hasTip ? null : t.tip;
      let prevAt = now;
      for (let k = 0; k < t.n && allowed > 0; k += 1) {
        const i = (t.head - 1 - k + t.cap * 2) % t.cap;
        const cur = { x: t.x[i], y: t.y[i], z: t.z[i] };
        const curAt = t.at[i];
        if (prev) {
          ax.x = prev.x - cur.x; ax.y = prev.y - cur.y; ax.z = prev.z - cur.z;
          if (ax.x * ax.x + ax.y * ax.y + ax.z * ax.z > 1e-6) {
            mid.x = (prev.x + cur.x) * 0.5; mid.y = (prev.y + cur.y) * 0.5; mid.z = (prev.z + cur.z) * 0.5;
            const age = now - (prevAt + curAt) * 0.5;
            const kk = age / def.life;
            if (kk >= 1) break;
            let spent = 0;
            for (const L of def.layers) {
              const lk = age / (L.life ?? def.life);
              if (lk >= 1) continue;
              const fade = Math.pow(1 - lk, L.fade ?? 1.25);
              const c = mix4(L.c0, L.c1, lk);
              // the newest segment also fades in so the ribbon never pops at the nozzle
              const w = lerp(L.w0, L.w1, Math.min(1, lk * (L.grow ?? 1)));
              const ok = quad({
                mode: 'streak', layer: L.layer, cell: L.cell, pos: mid, axis: ax, width: w, minW: L.minW, minLen: L.minLen ?? 10,
                tail: L.tail || 0, color: [c[0], c[1], c[2], c[3] * fade],
              });
              if (ok) spent += 1;
            }
            drawn += spent; allowed -= 1; quota -= 1;
          }
        }
        prev = cur; prevAt = curAt;
      }
    }
    stats.lastDrawn = drawn; stats.drawn += drawn;
  }

  return { create, follow, close, draw, clear() { trails.length = 0; }, get count() { return trails.length; }, stats: () => ({ ...stats, live: trails.length }) };
}

/** Standard trail definitions (display-space HDR colours). */
export const TRAILS = Object.freeze({
  // MISIL: dark-grey volumetric plume (contrast against sky) + short hot exhaust ribbon
  missile: Object.freeze({
    life: 1.7, interval: 0.085,
    layers: Object.freeze([
      Object.freeze({ layer: 'norm', cell: 'smokeRibbon', w0: 0.5, w1: 2.0, minW: 8, c0: [0.27, 0.26, 0.26, 0.92], c1: [0.86, 0.86, 0.88, 0.0], fade: 0.7, grow: 0.7 }),
      Object.freeze({ layer: 'add', cell: 'ribbon', life: 0.32, w0: 0.42, w1: 0.12, minW: 8, c0: [2.6, 1.5, 0.5, 0.95], c1: [1.4, 0.45, 0.1, 0], fade: 1.0 }),
      Object.freeze({ layer: 'add', cell: 'ribbonHard', life: 0.18, w0: 0.16, w1: 0.05, minW: 3.5, c0: [3.0, 2.8, 2.2, 1], c1: [2.0, 1.4, 0.6, 0], fade: 1.0 }),
    ]),
  }),
  // SWARM: same idea, shorter and cheaper (8 rockets in flight)
  swarm: Object.freeze({
    life: 0.95, interval: 0.1,
    layers: Object.freeze([
      Object.freeze({ layer: 'norm', cell: 'smokeRibbon', w0: 0.22, w1: 0.9, minW: 5, c0: [0.3, 0.29, 0.29, 0.85], c1: [0.86, 0.86, 0.88, 0.0], fade: 0.75, grow: 0.7 }),
      Object.freeze({ layer: 'add', cell: 'ribbonHard', life: 0.16, w0: 0.14, w1: 0.04, minW: 3, c0: [3.0, 2.3, 1.2, 1], c1: [2.0, 1.0, 0.3, 0], fade: 1.0 }),
    ]),
  }),
  // NOVA: plasma comet — violet body, white core, long fading wake
  nova: Object.freeze({
    life: 1.4, interval: 0.07,
    layers: Object.freeze([
      Object.freeze({ layer: 'add', cell: 'ribbon', w0: 1.1, w1: 0.2, minW: 14, c0: [0.9, 0.45, 2.6, 0.8], c1: [0.35, 0.2, 1.2, 0], fade: 1.1 }),
      Object.freeze({ layer: 'add', cell: 'ribbonHard', life: 0.55, w0: 0.42, w1: 0.08, minW: 5, c0: [2.8, 2.6, 3.0, 1], c1: [1.2, 0.8, 2.2, 0], fade: 1.0 }),
      Object.freeze({ layer: 'norm', cell: 'smokeRibbon', life: 1.4, w0: 0.6, w1: 2.2, minW: 6, c0: [0.14, 0.1, 0.2, 0.5], c1: [0.4, 0.36, 0.46, 0], fade: 1.0, grow: 0.6 }),
    ]),
  }),
});
