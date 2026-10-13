// flightverse/enemy-materials.js — detalle de material procedural para los enemigos GLB (WS D).
// Los GLB de enemigos traen texturas embebidas planas (todas gris 194): con el baseColorFactor el
// Gigante se veía como un maniquí liso. Aquí se generan texturas teselables (canvas 256², ruido de
// valor con wrap) por clase de material y se asignan como map + bumpMap en ?fv=2. Contrato GLB
// intacto (no se toca ningún .glb). Coste: ~7 canvas 256² una sola vez por sesión.
import * as THREE from '/flightverse/three.js?v=443';

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
  if (cls !== 'flat' && cls !== 'cloth') {
    material.bumpMap = tex; material.bumpScale = cls === 'scale' ? bump * 2.4 : bump;
    // la misma textura modula la rugosidad (canal G): escamas/metal/piedra ya no reflejan como plástico liso
    if (cls === 'scale' || cls === 'metal' || cls === 'stone') {
      material.roughnessMap = tex;
      material.roughness = Math.min(1, (material.roughness ?? 0.8) * 1.25);
    }
  }
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


// ── v2: material "vivo" de enemigos: rim hostil, reflejo de cielo falso (sin envMap), emisivos pulsantes, contorno ──
export const ENEMY_UNIFORMS = { fvTime: { value: 0 } };
const glowMats = { a: null, b: null, eye: null };
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}
function glowMat(key, color) {
  if (!glowMats[key]) glowMats[key] = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  glowMats[key].userData.shared = true;
  return glowMats[key];
}
/** Reloj de los emisivos y brillos compartidos (una llamada por frame). */
export function tickEnemyMaterials(t) {
  ENEMY_UNIFORMS.fvTime.value = t;
  if (glowMats.a) glowMats.a.opacity = 0.55 + 0.45 * Math.sin(t * 6);
  if (glowMats.b) glowMats.b.opacity = 0.55 + 0.45 * Math.sin(t * 6 + Math.PI);
  if (glowMats.eye) glowMats.eye.opacity = 0.65 + 0.35 * Math.sin(t * 2.4);
}

const RIM_DEFAULT = new THREE.Color(0xFFB25A);
const HOSTILE = new THREE.Color(0xE0653A);
/**
 * Rim Fresnel + tinte hostil + (Standard) reflejo de cielo/suelo falso escalado por metalness·(1-roughness)
 * + pulso de emisivos (clases ember/energy/eye/glow). Un solo parche por material.
 */
export function upgradeMaterial(m, { tint = 0.15, lift = 1, rimK = 0.35, rimColor = RIM_DEFAULT, envK = 1 } = {}) {
  if (!m || m.userData?.fvRim) return;
  if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
  m.userData = m.userData || {};
  m.userData.fvRim = true;
  const std = !!m.isMeshStandardMaterial;
  const emissive = std && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.02;
  if (m.color) {
    if (lift !== 1) m.color.multiplyScalar(lift);
    if (tint > 0) m.color.lerp(HOSTILE, tint);
  }
  if (emissive) m.emissiveIntensity = Math.max(m.emissiveIntensity || 1, 1.7);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.fvRimColor = { value: rimColor };
    shader.uniforms.fvRimK = { value: rimK };
    shader.uniforms.fvEnvK = { value: envK };
    shader.uniforms.fvTime = ENEMY_UNIFORMS.fvTime;
    shader.uniforms.fvPulse = { value: emissive ? 0.45 : 0 };
    const envChunk = std ? `
      vec3 fvRf = reflect(-fvV, fvN);
      vec3 fvUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      float fvHh = dot(fvRf, fvUp) * 0.5 + 0.5;
      vec3 fvEnv = mix(vec3(0.17, 0.15, 0.12), vec3(0.62, 0.78, 1.0), smoothstep(0.38, 0.62, fvHh));
      float fvSun = pow(max(dot(fvRf, normalize((viewMatrix * vec4(0.4, 0.8, 0.3, 0.0)).xyz)), 0.0), 22.0);
      float fvSpec = (metalnessFactor * (1.0 - roughnessFactor * 0.55) + 0.05) * fvEnvK;
      gl_FragColor.rgb += (fvEnv * diffuseColor.rgb * 1.7 + vec3(1.0, 0.95, 0.85) * fvSun * 0.7 * (1.0 - roughnessFactor)) * fvSpec;
    ` : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 fvRimColor;\nuniform float fvRimK;\nuniform float fvEnvK;\nuniform float fvTime;\nuniform float fvPulse;\nvoid main() {')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= 1.0 + fvPulse * sin(fvTime * 3.4);')
      .replace('#include <dithering_fragment>',
        `vec3 fvV = normalize(vViewPosition); vec3 fvN = normalize(vNormal);
         float fvR = pow(1.0 - clamp(dot(fvN, fvV), 0.0, 1.0), 2.0);
         gl_FragColor.rgb += fvRimColor * fvR * fvRimK + diffuseColor.rgb * 0.14;
         ${envChunk}
         #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => `fv-en-${std ? 1 : 0}`;
  m.needsUpdate = true;
}

// Contorno por casco invertido (back-face hull), ancho ~constante EN PANTALLA: se empuja el vértice a lo largo de la normal
// una distancia proporcional a la profundidad de vista. Un material compartido por tipo (sin coste por enemigo).
const hullMats = new Map();
function hullMaterial(color, k, minW, maxW) {
  const key = `${color}|${k}`;
  if (hullMats.has(key)) return hullMats.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false });
  m.userData.shared = true;
  m.onBeforeCompile = shader => {
    shader.uniforms.fvK = { value: k };
    shader.uniforms.fvMin = { value: minW };
    shader.uniforms.fvMax = { value: maxW };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float fvK;\nuniform float fvMin;\nuniform float fvMax;\nvoid main() {')
      .replace('#include <project_vertex>', `
        #ifdef USE_SKINNING
        vec3 fvNn = normalize(objectNormal);
        #else
        vec3 fvNn = normalize(normal);
        #endif
        float fvSc = max(1e-3, length(modelMatrix[0].xyz));
        vec4 fvMv = modelViewMatrix * vec4(transformed, 1.0);
        transformed += fvNn * (clamp(-fvMv.z * fvK, fvMin, fvMax) / fvSc);
        #include <project_vertex>`);
  };
  m.customProgramCacheKey = () => 'fv-hull';
  hullMats.set(key, m);
  return m;
}

/** Añade un casco de contorno a cada malla opaca del árbol (una vez) y brillos en ojos/luces. */
export function addOutline(root, { color = 0xFF4A2E, k = 0.0042, minW = 0.014, maxW = 1.1 } = {}) {
  if (!root || root.userData.fvOutlined) return;
  root.userData.fvOutlined = true;
  const hull = hullMaterial(color, k, minW, maxW);
  const targets = [];
  root.traverse(o => {
    if (!o.isMesh || o.userData.fvHull) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some(m => m?.transparent)) return;
    if (ms.some(m => /eye|ember|glow|energy/i.test(m?.name || ''))) return;     // emisivos pequeños: sin casco
    targets.push(o);
  });
  for (const o of targets) {
    const h = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, hull) : new THREE.Mesh(o.geometry, hull);
    if (o.isSkinnedMesh) h.bind(o.skeleton, o.bindMatrix);
    h.userData.fvHull = true; h.castShadow = false; h.receiveShadow = false; h.renderOrder = -1;
    h.frustumCulled = o.frustumCulled;
    o.add(h);
  }
}

/** Brillos aditivos: ojos (dragón/gigante), luces del borde del OVNI y núcleo inferior. Comparten material (pulso global). */
export function addGlows(root, type) {
  if (!root || root.userData.fvGlows) return;
  root.userData.fvGlows = true;
  const eyes = [], rim = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    if (/^eye/i.test(o.name)) eyes.push(o);
    else if (type === 'ufo' && /^rim_light_/.test(o.name)) rim.push(o);
  });
  const big = type === 'dragon' ? 0.85 : type === 'gigante' ? 0.5 : 0.3;
  for (const e of eyes) {
    const sp = new THREE.Sprite(glowMat('eye', type === 'dragon' ? 0xff6a1a : 0xffa040));
    sp.scale.setScalar(big); sp.renderOrder = 5;
    sp.position.set(0, 0.04 * big, -0.5 * big);        // los ojos del GLB miran a -Z: el brillo sale por delante de la cara
    e.add(sp);
  }
  if (type === 'ufo') {
    rim.forEach((o, i) => {
      if (i % 3) return;                                   // 8 de 24: cadena de luces alternas
      const sp = new THREE.Sprite(glowMat((i / 3) % 2 ? 'b' : 'a', (i / 3) % 2 ? 0xffc24a : 0x5dffd6));
      sp.scale.setScalar(0.75); sp.renderOrder = 5;
      o.add(sp);
    });
    const core = new THREE.Sprite(glowMat('a', 0x5dffd6));
    core.scale.setScalar(3.6); core.position.set(0, -0.72, 0); core.renderOrder = 5;
    root.add(core);
  }
}
