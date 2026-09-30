// flightverse/audio/render.js — offline renderer for audio/recipes.js (Node tests; no WebAudio).
// Implements just what the recipes use: noise/osc sources, exponential frequency sweeps,
// RBJ biquads (low/high/bandpass) with per-block coefficient updates, attack/exp-decay envelopes.

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

function biquadCoeffs(type, f, q, sr) {
  const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr;
  const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
  const cos = Math.cos(w0);
  let b0; let b1; let b2;
  const a0 = 1 + alpha; const a1 = -2 * cos; const a2 = 1 - alpha;
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }   // bandpass (constant 0 dB peak gain)
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

const expSweep = (f, k) => f[0] * Math.pow(f[1] / f[0], k);

export function renderLayers(layers, { sampleRate = 44100, seed = 7, pitch = 1 } = {}) {
  const rnd = mulberry32(seed);
  let total = 0;
  for (const l of layers) total = Math.max(total, l.t + l.a + l.d * 1.4);
  const n = Math.ceil(total * sampleRate) + 1;
  const out = new Float32Array(n);
  for (const layer of layers) {
    const start = Math.floor(layer.t * sampleRate);
    const dur = layer.a + layer.d * 1.4;
    const len = Math.min(n - start, Math.ceil(dur * sampleRate));
    let phase = 0;
    let z1 = 0; let z2 = 0;
    let c = layer.filter ? biquadCoeffs(layer.filter.type, expSweep(layer.filter.f, 0), layer.filter.q, sampleRate) : null;
    for (let i = 0; i < len; i += 1) {
      const t = i / sampleRate;
      const k = Math.min(1, t / Math.max(1e-6, layer.d));
      let x;
      if (layer.src === 'noise') x = rnd() * 2 - 1;
      else {
        const f = expSweep(layer.f, k) * pitch;
        phase += 2 * Math.PI * f / sampleRate;
        const ph = phase % (2 * Math.PI);
        if (layer.wave === 'sawtooth') x = ph / Math.PI - 1;
        else if (layer.wave === 'square') x = ph < Math.PI ? 1 : -1;
        else x = Math.sin(ph);
      }
      if (c) {
        if ((i & 63) === 0) c = biquadCoeffs(layer.filter.type, expSweep(layer.filter.f, k) * pitch, layer.filter.q, sampleRate);
        const y = c[0] * x + z1;
        z1 = c[1] * x - c[3] * y + z2;
        z2 = c[2] * x - c[4] * y;
        x = y;
      }
      const env = t < layer.a ? t / layer.a : Math.pow(0.001, Math.min(1.4, (t - layer.a) / layer.d));
      out[start + i] += x * env * layer.gain;
    }
  }
  return out;
}

/** In-place iterative radix-2 FFT magnitude spectrum of the first `size` samples (zero padded). */
export function magnitudeSpectrum(samples, size = 16384) {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const m = Math.min(samples.length, size);
  for (let i = 0; i < m; i += 1) re[i] = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (m - 1 || 1)));
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let cr = 1; let ci = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const ur = re[i + j]; const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Power-weighted spectral centroid (Hz), ignoring DC. */
export function spectralCentroid(samples, sampleRate = 44100, size = 32768) {
  const mag = magnitudeSpectrum(samples, size);
  let num = 0; let den = 0;
  for (let i = 1; i < mag.length; i += 1) {
    const p = mag[i] * mag[i];
    num += p * (i * sampleRate / size);
    den += p;
  }
  return den > 0 ? num / den : 0;
}
