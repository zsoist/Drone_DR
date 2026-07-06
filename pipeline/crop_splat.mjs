// crop_splat.mjs — quita los "floaters" outlier de un .splat (halo verde de los bordes en
// splats aéreos: gaussians de baja confianza lejos de la escena real, que el alpha-removal
// NO toca porque tienen opacidad decente pero posición/color errados).
//
// Formato .splat (antimatter15): 32 bytes/splat = pos(3×f32) scale(3×f32) color(4×u8) rot(4×u8).
// Estrategia robusta: centroide + radio del percentil P (no el máximo, dominado por floaters);
// conserva los splats dentro de FACTOR × radioP. Sin dependencias.
//
// Uso: node crop_splat.mjs <in.splat> <out.splat> [percentil=0.96] [factor=1.35]
import fs from 'node:fs';

const [inFile, outFile, pArg, fArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('uso: node crop_splat.mjs <in.splat> <out.splat> [percentil=0.96] [factor=1.35]');
  process.exit(2);
}
const PCT = Math.min(0.999, Math.max(0.5, Number(pArg ?? 0.96)));
const FACTOR = Math.max(1.0, Number(fArg ?? 1.35));
const STRIDE = 32;

const buf = fs.readFileSync(inFile);
const n = Math.floor(buf.length / STRIDE);
if (n === 0) { console.error('splat vacío'); process.exit(2); }
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

// centroide (media de posiciones)
let cx = 0, cy = 0, cz = 0;
for (let i = 0; i < n; i++) {
  const o = i * 8;                       // 32 bytes = 8 floats
  cx += f32[o]; cy += f32[o + 1]; cz += f32[o + 2];
}
cx /= n; cy /= n; cz /= n;

// distancias² al centroide → radio del percentil (robusto a floaters)
const d2 = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const o = i * 8;
  const dx = f32[o] - cx, dy = f32[o + 1] - cy, dz = f32[o + 2] - cz;
  d2[i] = dx * dx + dy * dy + dz * dz;
}
const sorted = Float64Array.from(d2).sort();
const rP = Math.sqrt(sorted[Math.floor(PCT * (n - 1))]);
const cutoff2 = (rP * FACTOR) ** 2;

// escribe solo los que caen dentro del corte
const out = Buffer.allocUnsafe(buf.length);
let kept = 0;
for (let i = 0; i < n; i++) {
  if (d2[i] <= cutoff2) {
    buf.copy(out, kept * STRIDE, i * STRIDE, i * STRIDE + STRIDE);
    kept++;
  }
}
fs.writeFileSync(outFile, out.subarray(0, kept * STRIDE));
const pctKept = (kept / n * 100).toFixed(1);
console.log(`crop: ${n} -> ${kept} splats (${pctKept}% conservado) · radioP${Math.round(PCT * 100)}=${rP.toFixed(2)} corte=${(rP * FACTOR).toFixed(2)}`);
