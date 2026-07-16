// autoclean.mjs — motor de Auto-Clean para gaussian splats aéreos (Splat Lab v2, P0).
//
// Pipeline ORDENADO (docs/SPLATLAB_V2_PLAN.md §2.1). Opera sobre .splat (antimatter15,
// 32 B/gaussiana: pos 3×f32 · scale 3×f32 · rgba 4×u8 · quat 4×u8). En .splat las escalas
// ya están LINEALES (post-exp) y la opacidad es alpha u8 (post-sigmoid) — umbrales en ese
// espacio, adaptativos por escena (mediana/bbox del modelo).
//
// Etapas locales (este script, baratas primero para no sesgar lo caro):
//   1 NaN/Inf   2 opacidad<T   3 escala>K·mediana   4 escala>frac·bboxDiag   5 anisotropía>A
// Etapa 6 (voxel-occupancy, el removedor estructural de floaters desconectados) se delega a
// splat-transform --filter-floaters (GPU). 7 SOR y 8 crop quedan para fases siguientes.
//
// REVERSIBLE por diseño: nunca muta la entrada; escribe una salida nueva. El caller archiva
// el crudo antes de publicar. Salvaguarda fail-open: si conservaría <40%, ABORTA (no escribe).
//
// Uso: node autoclean.mjs <in.splat> <out.splat> [--preset aerial] [--st <cli.mjs>] [--json]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STRIDE = 32;

function parseArgs(argv) {
  const a = { preset: 'aerial', json: false, st: null, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--preset') a.preset = argv[++i];
    else if (t === '--st') a.st = argv[++i];
    else if (t === '--json') a.json = true;
    else a.pos.push(t);
  }
  return a;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function localFilter(inFile, outFile, preset) {
  const buf = fs.readFileSync(inFile);
  const n = Math.floor(buf.length / STRIDE);
  if (n === 0) throw new Error('splat vacío');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + n * STRIDE);
  const f32 = new Float32Array(ab);
  const u8 = new Uint8Array(ab);

  // pasada 1: estadística adaptativa (mediana de max-eje, bbox) sobre gaussianas finitas
  const maxAxes = [];
  let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const x = f32[o], y = f32[o + 1], z = f32[o + 2];
    const sx = f32[o + 3], sy = f32[o + 4], sz = f32[o + 5];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
          && Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz))) continue;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    maxAxes.push(Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz)));
  }
  if (!maxAxes.length) throw new Error('sin gaussianas finitas');
  const medMax = median(maxAxes);
  const bboxDiag = Math.hypot(xmax - xmin, ymax - ymin, zmax - zmin) || 1;
  // radial: distancia XY al centroide (robusto = mediana), para recortar el SPRAY de borde
  // que se dispara MÁS ALLÁ del footprint (buildings quedan dentro; las agujas radiales no).
  let radHi = Infinity;
  if (preset.radial_pct && preset.radial_pct > 0 && preset.radial_pct < 1) {
    const cx = median(Array.from({length: n}, (_, i) => f32[i*8]).filter(Number.isFinite));
    const cy = median(Array.from({length: n}, (_, i) => f32[i*8+1]).filter(Number.isFinite));
    const rads = [];
    for (let i = 0; i < n; i++) {
      const dx = f32[i*8] - cx, dy = f32[i*8+1] - cy;
      if (Number.isFinite(dx) && Number.isFinite(dy)) rads.push(Math.hypot(dx, dy));
    }
    const rs = Float64Array.from(rads).sort();
    radHi = rs[Math.floor(preset.radial_pct * (rs.length - 1))] * (preset.radial_factor || 1.0);
    var _cx = cx, _cy = cy;
  }
  const scaleHi = preset.scale_k > 0 ? medMax * preset.scale_k : Infinity;
  const bboxHi = preset.bbox_frac > 0 ? bboxDiag * preset.bbox_frac : Infinity;
  const alphaMin = Math.round((preset.opacity_min ?? 0) * 255);
  const anisoMax = preset.aniso_max > 0 ? preset.aniso_max : Infinity;

  const removed = { nan: 0, opacity: 0, scale: 0, bbox: 0, aniso: 0, radial: 0 };
  const out = Buffer.allocUnsafe(buf.length);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const x = f32[o], y = f32[o + 1], z = f32[o + 2];
    const sx = Math.abs(f32[o + 3]), sy = Math.abs(f32[o + 4]), sz = Math.abs(f32[o + 5]);
    // 1 NaN/Inf
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
          && Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz))) { removed.nan++; continue; }
    // 2 opacidad (haze)
    if (u8[i * STRIDE + 27] < alphaMin) { removed.opacity++; continue; }
    const smax = Math.max(sx, sy, sz), smin = Math.min(sx, sy, sz);
    const smid = (sx + sy + sz) - smax - smin || 1e-9;   // eje intermedio
    // 3 escala vs mediana (spikes)
    if (smax > scaleHi) { removed.scale++; continue; }
    // 4 escala vs bbox (splats que cruzan la escena)
    if (smax > bboxHi) { removed.bbox++; continue; }
    // 5 anisotropía = AGUJAS (maxEje >> ejeINTERMEDIO). Ojo: usar max/min borraría los discos
    // planos (pancakes) que representan SUPERFICIES válidas — esos tienen min chico pero mid
    // grande. Una aguja tiene el intermedio TAMBIÉN chico: max/mid la delata sin tocar planos.
    if (smax / smid > anisoMax) { removed.aniso++; continue; }
    // 5b recorte radial: sólo el spray extremo del borde (P99 del radio × factor)
    if (radHi !== Infinity) {
      const dx = x - _cx, dy = y - _cy;
      if (Math.hypot(dx, dy) > radHi) { removed.radial++; continue; }
    }
    buf.copy(out, kept * STRIDE, i * STRIDE, i * STRIDE + STRIDE);
    kept++;
  }
  fs.writeFileSync(outFile, out.subarray(0, kept * STRIDE));
  return { n, kept, removed, medMax, bboxDiag, scaleHi, bboxHi, alphaMin, anisoMax };
}

function voxelFilter(st, inFile, outFile, voxel) {
  if (!st || !fs.existsSync(st)) return { skipped: 'splat-transform ausente' };
  const [size, op, min] = voxel;
  const before = fs.statSync(inFile).size / STRIDE;
  const r = spawnSync('node', [st, inFile, '--filter-floaters', `${size},${op},${min}`,
    outFile, '--overwrite', '--no-tty', '-q'], { encoding: 'utf8', timeout: 600000 });
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    // fallback: voxel es GPU-only; si falla, el resultado local ya es válido
    fs.copyFileSync(inFile, outFile);
    return { skipped: (r.stderr || r.stdout || 'floaters falló').trim().slice(-160) };
  }
  const after = fs.statSync(outFile).size / STRIDE;
  return { removed: Math.round(before - after) };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const [inFile, outFile] = a.pos;
  if (!inFile || !outFile) {
    console.error('uso: node autoclean.mjs <in.splat> <out.splat> [--preset aerial] [--st <cli>] [--json]');
    process.exit(2);
  }
  const presets = JSON.parse(fs.readFileSync(path.join(HERE, 'autoclean_presets.json'), 'utf8'));
  const preset = presets[a.preset];
  if (!preset) { console.error(`preset desconocido: ${a.preset}`); process.exit(2); }
  const st = a.st || path.join(HERE, '..', 'tools', 'node_modules', '@playcanvas',
    'splat-transform', 'bin', 'cli.mjs');

  const tmp = outFile + '.local.tmp.splat';
  const local = localFilter(inFile, tmp, preset);
  const vox = voxelFilter(st, tmp, outFile, preset.voxel || [0.05, 0.1, 0.004]);
  fs.rmSync(tmp, { force: true });

  const finalKept = fs.statSync(outFile).size / STRIDE;
  const keptFrac = finalKept / local.n;
  // fail-open: nunca escribir basura (>60% borrado = algo salió mal)
  if (keptFrac < 0.4) {
    fs.rmSync(outFile, { force: true });
    console.error(`ABORTA: conservaría ${(keptFrac * 100).toFixed(1)}% (<40%) — sospechoso, no escribo`);
    process.exit(3);
  }

  const report = {
    preset: a.preset, input: local.n, output: finalKept,
    kept_pct: +(keptFrac * 100).toFixed(1),
    removed: { ...local.removed, voxel: vox.removed ?? 0 },
    adaptive: { median_max_scale: +local.medMax.toFixed(4), bbox_diag: +local.bboxDiag.toFixed(3),
                scale_hi: +local.scaleHi.toFixed(4), alpha_min: local.alphaMin, aniso_max: local.anisoMax },
    voxel_note: vox.skipped || null,
  };
  if (a.json) console.log(JSON.stringify(report));
  else console.log(`auto-clean[${a.preset}]: ${local.n} -> ${finalKept} (${report.kept_pct}% conservado) · `
    + `nan ${local.removed.nan} · opac ${local.removed.opacity} · escala ${local.removed.scale} · `
    + `bbox ${local.removed.bbox} · aniso ${local.removed.aniso} · radial ${local.removed.radial} · voxel ${vox.removed ?? 0}`
    + (vox.skipped ? ` · [voxel omitido: ${vox.skipped}]` : ''));
}

main();
