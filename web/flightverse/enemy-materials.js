// flightverse/enemy-materials.js — detalle de material procedural para los enemigos GLB (WS D).
// Los GLB de enemigos traen texturas embebidas planas (todas gris 194): con el baseColorFactor el
// Gigante se veía como un maniquí liso. Aquí se generan texturas teselables (canvas 256², ruido de
// valor con wrap) por clase de material y se asignan como map + bumpMap en ?fv=2. Contrato GLB
// intacto (no se toca ningún .glb). Coste: ~7 canvas 256² una sola vez por sesión.
import * as THREE from '/flightverse/three.js?v=370';

const SIZE = 256;
const cache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
/** Ruido de valor teselable: lattice n×n con wrap, interpolación suave. */
function valueNoise(n, seed) {
  const r = rng(seed);
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (u, v) => {
    const x = (u - Math.floor(u)) * n, y = (v - Math.floor(v)) * n;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
    const c = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(seed) {
  const n1 = valueNoise(4, seed), n2 = valueNoise(8, seed + 1), n3 = valueNoise(16, seed + 2), n4 = valueNoise(32, seed + 3);
  return (u, v) => (n1(u, v) * 0.45 + n2(u, v) * 0.3 + n3(u, v) * 0.17 + n4(u, v) * 0.08);
}

// Cada clase es una FÁBRICA (f) => pattern(u, v): los campos de ruido se crean UNA vez por textura. (Antes se
// construían dentro del patrón, es decir 65 536 veces por canvas: una tarea de ~3,8 s en el hilo principal.)
const CLASSES = {
  // [contraste, patrón]
  skin:   { seed: 11, contrast: 0.30, make: f => { const n = valueNoise(24, 5); return (u, v) => 0.5 + (f(u * 2, v * 2) - 0.5) * 0.8 - Math.max(0, n(u, v) - 0.8) * 1.6; } },
  cloth:  { seed: 23, contrast: 0.24, make: f => (u, v) => 0.55 + 0.22 * Math.sin(u * 48 * 6.2832) * Math.sin(v * 48 * 6.2832) + (f(u, v) - 0.5) * 0.9 },
  stone:  { seed: 31, contrast: 0.42, make: f => (u, v) => { const c = Math.abs(f(u * 3, v * 3) - 0.5); return 0.35 + f(u, v) * 0.7 - (c < 0.012 ? 0.35 : 0); } },
  metal:  { seed: 41, contrast: 0.36, make: f => { const n = valueNoise(64, 9); return (u, v) => 0.5 + (n(u * 0.2, v * 6) - 0.5) * 0.5 + (f(u, v) - 0.5) * 0.9; } },
  scale:  { seed: 53, contrast: 0.40, make: () => { const n = valueNoise(16, 3); return (u, v) => { const s = 14; const a = (u * s) % 1, b = ((v + (Math.floor(u * s) % 2) * 0.5 / s) * s) % 1; const d = Math.hypot(a - 0.5, b - 0.5); return 0.85 - d * 1.1 + n(u, v) * 0.2; }; } },
  bone:   { seed: 61, contrast: 0.22, make: f => { const n = valueNoise(48, 7); return (u, v) => 0.6 + (n(u * 0.3, v * 5) - 0.5) * 0.4 + (f(u, v) - 0.5) * 0.6; } },
  flat:   { seed: 71, contrast: 0.12, make: f => (u, v) => f(u, v) },
};

export function materialClass(name = '') {
  const n = name.toLowerCase();
  if (/skin|decay/.test(n)) return 'skin';
  if (/cloth|fabric|uniform|fatigue|leather|strap/.test(n)) return 'cloth';
  if (/stone|armor|panel|helmet/.test(n)) return 'stone';
  if (/metal|rust|hull|steel|brushed|rifle|gun/.test(n)) return 'metal';
  if (/scale|wing|membrane/.test(n)) return 'scale';
  if (/bone|teeth|horn|wood|bow/.test(n)) return 'bone';
  if (/eye|ember|energy|glass|dome|glow/.test(n)) return null;     // emisivos / vidrio: sin detalle
  return 'flat';
}

function build(cls) {
  const def = CLASSES[cls];
  const f = fbm(def.seed);
  const pattern = def.make(f);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  const img = c.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = pattern(x / SIZE, y / SIZE);
      // media ≈ 0.76 (lo que valían las texturas planas) ± contraste
      const v = Math.max(0.12, Math.min(1, 0.76 + (p - 0.5) * def.contrast * 2));
      const b = Math.round(v * 255), k = (y * SIZE + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData = { cls };
  return tex;
}

export function detailTexture(cls) {
  if (!cls) return null;
  if (!cache.has(cls)) cache.set(cls, build(cls));
  return cache.get(cls);
}

/** Aplica el detalle a un material (una vez). Devuelve la clase usada o null. */
export function applyDetail(material, { bump = 0.5 } = {}) {
  if (!material || material.userData?.fvDetail) return null;
  if (!material.isMeshStandardMaterial) return null;
  const cls = materialClass(material.name);
  material.userData = material.userData || {};
  material.userData.fvDetail = cls || 'none';
  if (!cls) return null;
  const tex = detailTexture(cls);
  material.map = tex;
  if (cls !== 'flat' && cls !== 'cloth') { material.bumpMap = tex; material.bumpScale = bump; }
  material.needsUpdate = true;
  return cls;
}

/** Construye las texturas de detalle una clase por hueco de inactividad (cada una ~2 ms; nunca una tarea larga). */
export async function prewarmDetailTextures(idle = () => new Promise(r => setTimeout(r, 0)), classes = Object.keys(CLASSES)) {
  for (const cls of classes) {
    if (!cls || cache.has(cls)) continue;
    await idle();
    detailTexture(cls);
  }
}

/** Clases de detalle que necesitará un árbol (para construirlas por adelantado, una por tarea). */
export function detailClassesOf(root) {
  const out = new Set();
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m?.isMeshStandardMaterial) { const c = materialClass(m.name); if (c) out.add(c); }
    }
  });
  return [...out];
}

export function disposeDetailTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
