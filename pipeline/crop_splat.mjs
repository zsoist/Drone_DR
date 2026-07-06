// crop_splat.mjs — quita los "floaters" outlier de un .splat (halo de los bordes en splats
// aéreos: gaussians de baja confianza fuera de la escena real, que el alpha-removal NO toca).
//
// Formato .splat (antimatter15): 32 bytes/splat = pos(3×f32) scale(3×f32) color(4×u8) rot(4×u8).
//
// Estrategia CAJA POR-EJE (no radio esférico): para cada eje x/y/z conserva el rango entre
// percentiles [P, 1-P] expandido por FACTOR. Un radio esférico cortaría las ESQUINAS de un
// vuelo en cuadrícula (están a ~√2× la distancia del borde) como si fueran floaters; la caja
// respeta footprints rectangulares/corredor y aún recorta los floaters que sobresalen de ella.
// Robusto a NaN/Inf: las posiciones no finitas se descartan (no envenenan percentiles ni centro).
//
// Uso: node crop_splat.mjs <in.splat> <out.splat> [pct=0.02] [factor=1.06]
//   pct = fracción recortada por lado de cada eje (0.02 = corta el 2% inferior y 2% superior)
import fs from 'node:fs';

const [inFile, outFile, pArg, fArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('uso: node crop_splat.mjs <in.splat> <out.splat> [pct=0.02] [factor=1.06]');
  process.exit(2);
}
const PCT = Math.min(0.2, Math.max(0.0, Number(pArg ?? 0.02)));
const FACTOR = Math.max(1.0, Number(fArg ?? 1.06));
const STRIDE = 32;

const buf = fs.readFileSync(inFile);
const n = Math.floor(buf.length / STRIDE);
if (n === 0) { console.error('splat vacío'); process.exit(2); }
// copia alineada a 4 bytes para el Float32Array (el buffer del archivo puede no estarlo)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + n * STRIDE);
const f32 = new Float32Array(ab);

// posiciones finitas por eje (descarta no-finitas)
const finite = new Uint8Array(n);
const xs = [], ys = [], zs = [];
for (let i = 0; i < n; i++) {
  const o = i * 8;
  const x = f32[o], y = f32[o + 1], z = f32[o + 2];
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    finite[i] = 1; xs.push(x); ys.push(y); zs.push(z);
  }
}
if (xs.length === 0) { console.error('sin posiciones finitas'); process.exit(2); }

// rango [P, 1-P] por eje, expandido desde el centro por FACTOR
function band(arr) {
  const s = Float64Array.from(arr).sort();
  const lo = s[Math.floor(PCT * (s.length - 1))];
  const hi = s[Math.floor((1 - PCT) * (s.length - 1))];
  const mid = (lo + hi) / 2, half = (hi - lo) / 2 * FACTOR;
  return [mid - half, mid + half];
}
const [xl, xh] = band(xs), [yl, yh] = band(ys), [zl, zh] = band(zs);

// escribe solo los splats dentro de la caja (los no-finitos siempre se descartan)
const out = Buffer.allocUnsafe(buf.length);
let kept = 0;
for (let i = 0; i < n; i++) {
  if (!finite[i]) continue;
  const o = i * 8;
  const x = f32[o], y = f32[o + 1], z = f32[o + 2];
  if (x >= xl && x <= xh && y >= yl && y <= yh && z >= zl && z <= zh) {
    buf.copy(out, kept * STRIDE, i * STRIDE, i * STRIDE + STRIDE);
    kept++;
  }
}
if (kept < n * 0.4) {   // salvaguarda: nunca borres >60% (algo salió mal → no escribas basura)
  console.error(`ABORTA: conservaría solo ${(kept / n * 100).toFixed(1)}% — sospechoso, no escribo`);
  process.exit(3);
}
fs.writeFileSync(outFile, out.subarray(0, kept * STRIDE));
console.log(`crop: ${n} -> ${kept} splats (${(kept / n * 100).toFixed(1)}% conservado) · `
  + `caja x[${xl.toFixed(2)},${xh.toFixed(2)}] y[${yl.toFixed(2)},${yh.toFixed(2)}] z[${zl.toFixed(2)},${zh.toFixed(2)}]`);
