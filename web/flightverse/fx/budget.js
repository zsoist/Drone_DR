// flightverse/fx/budget.js — per-tier FX caps and the fixed-slot pool (pure, no Three).
// Spec §5 "Pool caps per tier" / §13: low (phone) 64 sprites · 24 debris · 16 decals · 2 lights,
// mid 160/48/32/3, high 320/96/64/4 (+haze). Over cap the OLDEST entry is reused first;
// an effect is never skipped (the flash of an explosion always gets a slot).

export const FX_CAPS = Object.freeze({
  low: Object.freeze({ sprites: 64, debris: 24, decals: 16, lights: 2, imm: 48, haze: false, quality: 0.6 }),
  mid: Object.freeze({ sprites: 160, debris: 48, decals: 32, lights: 3, imm: 96, haze: false, quality: 0.85 }),
  high: Object.freeze({ sprites: 320, debris: 96, decals: 64, lights: 4, imm: 160, haze: true, quality: 1 }),
});

/** coarse pointer -> phone (<700 px short side) low, tablet mid; fine pointer -> high. */
export function fxTierFor({ coarse = false, width = 1440, height = 900 } = {}) {
  if (!coarse) return 'high';
  return Math.min(width, height) < 700 ? 'low' : 'mid';
}

export function fxCaps(tier) {
  return FX_CAPS[tier] || FX_CAPS.high;
}

/**
 * Fixed-capacity slot allocator. acquire() always succeeds: when full it steals
 * the slot that was acquired the longest ago and reports it as `stolen`.
 */
export class SlotPool {
  constructor(capacity) {
    this.capacity = Math.max(1, Math.floor(capacity) || 1);
    this.used = new Uint8Array(this.capacity);
    this.born = new Float64Array(this.capacity);
    this.free = [];
    for (let i = this.capacity - 1; i >= 0; i -= 1) this.free.push(i);
    this.live = 0;
    this.peak = 0;
    this.spawned = 0;
    this.stolen = 0;
    this.clock = 0;
  }

  /** @returns {{index:number, stolen:boolean}} */
  acquire() {
    this.clock += 1;
    let index;
    let stolen = false;
    if (this.free.length) {
      index = this.free.pop();
    } else {
      // reuse the oldest live slot
      index = 0;
      let oldest = Infinity;
      for (let i = 0; i < this.capacity; i += 1) {
        if (this.born[i] < oldest) { oldest = this.born[i]; index = i; }
      }
      stolen = true;
      this.stolen += 1;
      this.live -= 1;
    }
    this.used[index] = 1;
    this.born[index] = this.clock;
    this.live += 1;
    this.spawned += 1;
    if (this.live > this.peak) this.peak = this.live;
    return { index, stolen };
  }

  release(index) {
    if (!this.used[index]) return;
    this.used[index] = 0;
    this.born[index] = 0;
    this.free.push(index);
    this.live -= 1;
  }

  clear() {
    this.used.fill(0);
    this.born.fill(0);
    this.free.length = 0;
    for (let i = this.capacity - 1; i >= 0; i -= 1) this.free.push(i);
    this.live = 0;
  }

  snapshot() {
    return { cap: this.capacity, live: this.live, peak: this.peak, spawned: this.spawned, stolen: this.stolen };
  }
}
