// make_ksplat.mjs — convierte .splat/.ply a .ksplat (formato de carga más rápida de GaussianSplats3D)
// Reutiliza la MISMA lib vendoreada del viewer (web/vendor) para que el formato generado
// coincida exactamente con lo que el visor sabe leer. Sin npm ni dependencias externas.
//
// La lib importa "/vendor/three.module.js" (path de URL del navegador) — en Node eso no
// resuelve, así que reescribimos ese import a file:// en una copia temporal y la importamos.
//
// Uso: node make_ksplat.mjs <in.splat|in.ply> <out.ksplat> [compressionLevel=1] [alphaThreshold=1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const VENDOR = path.resolve(HERE, '..', 'web', 'vendor');

// la lib asume globals de navegador (window.setTimeout en delayedExecute, self, document):
// shims mínimos para el camino de parsing puro (sin WebGL) en Node
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;
globalThis.document ??= { createElement: () => ({ style: {} }) };
globalThis.navigator ??= { userAgent: 'node' };

async function loadLib() {
  const srcPath = path.join(VENDOR, 'gaussian-splats-3d.module.min.js');
  const threeUrl = pathToFileURL(path.join(VENDOR, 'three.module.js')).href;
  const src = fs.readFileSync(srcPath, 'utf8')
    .replaceAll('"/vendor/three.module.js"', JSON.stringify(threeUrl));
  // cache por hash simple (mtime) para no reescribir en cada corrida
  const tmp = path.join(os.tmpdir(), `gs3d-node-${fs.statSync(srcPath).mtimeMs}.mjs`);
  if (!fs.existsSync(tmp)) fs.writeFileSync(tmp, src);
  return import(pathToFileURL(tmp).href);
}

const [inFile, outFile, compArg, alphaArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('uso: node make_ksplat.mjs <in.splat|in.ply> <out.ksplat> [compression=1] [alpha=1]');
  process.exit(2);
}
const compressionLevel = Number(compArg ?? 1);       // 0=sin comprimir, 1=16-bit, 2=cuantizado
const alphaThreshold = Number(alphaArg ?? 1);        // descarta gaussians casi transparentes

const GS = await loadLib();
const buf = fs.readFileSync(inFile);
const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fmt = GS.LoaderUtils.sceneFormatFromPath(inFile.toLowerCase());

let splatBuffer;
if (fmt === GS.SceneFormat.Ply) {
  splatBuffer = await GS.PlyLoader.loadFromFileData(data, alphaThreshold, compressionLevel, false);
} else if (fmt === GS.SceneFormat.Splat) {
  splatBuffer = await GS.SplatLoader.loadFromFileData(data, alphaThreshold, compressionLevel, false);
} else {
  console.error(`formato no soportado para conversión: ${inFile}`);
  process.exit(2);
}

fs.writeFileSync(outFile, Buffer.from(splatBuffer.bufferData));
const inMB = (buf.byteLength / 1048576).toFixed(2);
const outMB = (splatBuffer.bufferData.byteLength / 1048576).toFixed(2);
console.log(`ksplat listo: ${outFile} · ${inMB}MB -> ${outMB}MB · comp=${compressionLevel} alpha=${alphaThreshold}`);
