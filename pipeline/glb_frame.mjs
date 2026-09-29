// glb_frame.mjs — decode a gltfpack GLB with the SAME vendored three r180
// GLTFLoader + MeshoptDecoder the browser uses, and print its geometry stats in
// the frame scene.js sees (before the mesh_offset/rotation the scene applies).
//
//   node pipeline/glb_frame.mjs <file.glb> [--dump out.f32]   ->  JSON on stdout
//   --dump writes every world-space vertex as float32 xyz (for the subset check)
//
// Textures are not decoded (KTX2 needs a GPU transcoder): a stub loader
// satisfies GLTFLoader's KHR_texture_basisu hook. Positions come out through
// every node transform, so gltfpack's quantization scale/offset is included.
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

// web/ modules import '/vendor/...?v=N' (absolute, versioned) — map to disk.
register('data:text/javascript,' + encodeURIComponent(`
  import { pathToFileURL } from 'node:url';
  import path from 'node:path';
  const WEB = ${JSON.stringify(WEB)};
  export async function resolve(specifier, context, next) {
    if (/^\\/(vendor|flightverse)\\//.test(specifier)) {
      const clean = specifier.split('?')[0];
      return { url: pathToFileURL(path.join(WEB, clean)).href, shortCircuit: true };
    }
    return next(specifier, context);
  }
`));

globalThis.self ??= globalThis;   // GLTFLoader reads self.URL for embedded images
const file = process.argv[2];
const dumpAt = process.argv.indexOf('--dump');
const dumpPath = dumpAt > 0 ? process.argv[dumpAt + 1] : null;
const dump = [];
if (!file) { console.error('uso: glb_frame.mjs <file.glb>'); process.exit(2); }

const THREE = await import(pathToFileURL(path.join(WEB, 'vendor/three180.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(path.join(WEB, 'vendor/three-addons180/loaders/GLTFLoader.js')).href);
const { MeshoptDecoder } = await import(pathToFileURL(path.join(WEB, 'vendor/three-addons180/libs/meshopt_decoder.module.js')).href);

const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const stubKtx2 = { load(_url, onLoad) { onLoad(new THREE.Texture()); }, dispose() {} };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(stubKtx2);
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));

gltf.scene.updateMatrixWorld(true);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
let tris = 0, area = 0, meshes = 0, materials = new Set();
const cen = [0, 0, 0];
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
gltf.scene.traverse(node => {
  if (!node.isMesh) return;
  meshes++;
  materials.add(node.material?.name ?? '');
  const pos = node.geometry.attributes.position;
  const idx = node.geometry.index;
  const n = idx ? idx.count : pos.count;
  const M = node.matrixWorld;
  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i).applyMatrix4(M);
    if (dumpPath) dump.push(a.x, a.y, a.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a.x : k === 1 ? a.y : a.z;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(M);
    b.fromBufferAttribute(pos, i1).applyMatrix4(M);
    c.fromBufferAttribute(pos, i2).applyMatrix4(M);
    t.subVectors(b, a).cross(c.clone().sub(a));
    const ar = 0.5 * t.length();
    area += ar;
    cen[0] += ar * (a.x + b.x + c.x) / 3;
    cen[1] += ar * (a.y + b.y + c.y) / 3;
    cen[2] += ar * (a.z + b.z + c.z) / 3;
    tris++;
  }
});
if (dumpPath) writeFileSync(dumpPath, Buffer.from(new Float32Array(dump).buffer));
console.log(JSON.stringify({
  tris, meshes, materials: materials.size, area,
  bbox_min: min, bbox_max: max,
  centroid: area ? cen.map(v => v / area) : null,
  roots: gltf.scene.children.length,
}));
