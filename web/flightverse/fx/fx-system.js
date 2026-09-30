// flightverse/fx/fx-system.js — pooled, instanced FX renderer for ?fv=2 (spec §5, §13).
//
// Draw calls for ALL effects: 4 (decals, smoke/dust, additive, debris) + 1 while a full-screen
// flash is active. One shared additive atlas (atlas.js). Everything is fixed-capacity:
//   sprites  : pooled billboard/streak/ring quads (layer 'add' or 'norm'), cap per tier
//   imm      : immediate quads rebuilt every frame (projectile visuals: tracers, flares)
//   debris   : instanced shards with a ground floor
//   decals   : ring-buffered surface quads
//   lights   : a fixed pool of PointLights (created up-front so no shader recompiles in combat)
// Over cap the OLDEST entry is reused first; a flash is never skipped.
import { SlotPool, fxCaps } from './budget.js?v=369';
import { buildAtlasCanvas, cellRect } from './atlas.js?v=369';
import { explosion, surfaceImpact, muzzleFlash, crashBurst } from './recipes.js?v=369';

const VERT = /* glsl */`
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD; attribute vec4 iE;
uniform float uFovH;     // 2*tan(fovY/2): world height per metre of distance
uniform float uPxWorld;  // uFovH / viewport height in px
uniform vec2 uViewport;  // viewport size in CSS px
varying vec2 vUv; varying vec4 vCol;
void main() {
  float mode = iA.w;
  vec3 c = iA.xyz;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float dist = max(0.05, length(cameraPosition - c));
  vec2 q = position.xy;
  vec3 wp;
  float fade = 1.0;
  if (mode < 0.5) {
    float sx = iB.x, sy = iB.y;
    float cap = dist * uFovH * iB.w;                // never more than iB.w of the view height
    float k = min(1.0, cap / max(max(sx, sy), 1e-4));
    sx *= k; sy *= k;
    float cs = cos(iB.z), sn = sin(iB.z);
    vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * vec2(sx, sy);
    wp = c + camRight * r.x + camUp * r.y;
    fade = smoothstep(0.3, 1.3, dist);
  } else if (mode < 1.5) {
    // screen-space line: tail->head projected, never shorter than ~10 px nor thinner than ~2.6 px,
    // so a tracer flying straight away from the camera still reads (FPV)
    vec3 axis = iE.xyz;
    vec4 ct = projectionMatrix * viewMatrix * vec4(c - axis * 0.5, 1.0);
    vec4 ch = projectionMatrix * viewMatrix * vec4(c + axis * 0.5, 1.0);
    ct.w = max(ct.w, 0.05); ch.w = max(ch.w, 0.05);
    vec2 hv = 0.5 * uViewport;
    vec2 st = ct.xy / ct.w * hv;
    vec2 sh = ch.xy / ch.w * hv;
    vec2 d = sh - st;
    float l = length(d);
    vec2 dir = l > 1e-3 ? d / l : vec2(1.0, 0.0);
    float minL = max(iB.x, 4.0);
    if (l < minL) { vec2 mid = 0.5 * (st + sh); st = mid - dir * minL * 0.5; sh = mid + dir * minL * 0.5; }
    float wpx = max(iB.y / (dist * uPxWorld), iB.z > 0.5 ? iB.z : 2.6);
    float t = q.x + 0.5;
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 sp = mix(st, sh, t) + nrm * q.y * wpx;
    float w = mix(ct.w, ch.w, t);
    float z = mix(ct.z / ct.w, ch.z / ch.w, t);
    vUv = iC.xy + uv * iC.zw;
    vCol = vec4(iD.rgb, iD.a * smoothstep(0.15, 0.9, dist));
    gl_Position = vec4(sp / hv * w, z * w, w);
    return;
  } else {
    vec3 n = normalize(iE.xyz);
    vec3 t = abs(n.y) < 0.95 ? normalize(cross(vec3(0.0, 1.0, 0.0), n)) : vec3(1.0, 0.0, 0.0);
    vec3 b = cross(n, t);
    float cap = dist * uFovH * iB.w;
    float k = min(1.0, cap / max(max(iB.x, iB.y), 1e-4));
    float cs = cos(iB.z), sn = sin(iB.z);
    vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * vec2(iB.x, iB.y) * k;
    wp = c + t * r.x + b * r.y;
  }
  vUv = iC.xy + uv * iC.zw;
  vCol = vec4(iD.rgb, iD.a * fade);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLASH_VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FLASH_FRAG = 'uniform float uA; void main(){ gl_FragColor = vec4(1.0, 0.98, 0.94, uA); }';

const lin = c => Math.pow(Math.max(0, c), 2.2);
const lerp = (a, b, t) => a + (b - a) * t;
const MODE = { billboard: 0, streak: 1, surface: 2 };

function hexToRgb(hex) {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Envelope peak for 'enveloped' (c0 alpha 0) normal-blend particles. */
const ENV_PEAK = { smokeA: 0.55, smokeB: 0.55, dust: 0.42, leaf: 1, glow: 0.9 };

export function createFxSystem({
  THREE, parent, tier = 'high', heightAt = null, rnd = Math.random, reduced = () => false, onLight = null,
} = {}) {
  const caps = fxCaps(tier);
  const spritePool = new SlotPool(caps.sprites);
  const debrisPool = new SlotPool(caps.debris);
  const decalPool = new SlotPool(caps.decals);

  // ── texture + materials ────────────────────────────────────────────────
  const atlas = new THREE.CanvasTexture(buildAtlasCanvas());
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.anisotropy = 2;
  const uniforms = { uMap: { value: atlas }, uFovH: { value: 1.5 }, uPxWorld: { value: 0.0016 }, uViewport: { value: new THREE.Vector2(430, 900) } };
  const makeMaterial = (blending, extra = {}) => new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
    blending, side: THREE.DoubleSide, toneMapped: true, ...extra,
  });
  const matAdd = makeMaterial(THREE.AdditiveBlending);
  const matNorm = makeMaterial(THREE.NormalBlending);
  const matDecal = makeMaterial(THREE.NormalBlending, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  const quadSrc = new THREE.PlaneGeometry(1, 1);
  const makeLayer = (capacity, material, order) => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quadSrc.index;
    geometry.setAttribute('position', quadSrc.attributes.position);
    geometry.setAttribute('uv', quadSrc.attributes.uv);
    const arrays = {};
    for (const name of ['iA', 'iB', 'iC', 'iD', 'iE']) {
      arrays[name] = new Float32Array(capacity * 4);
      const attr = new THREE.InstancedBufferAttribute(arrays[name], 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }
    geometry.instanceCount = 0;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.name = 'fv-fx-layer';
    parent.add(mesh);
    return { geometry, mesh, arrays, capacity, count: 0 };
  };
  const layers = {
    decal: makeLayer(caps.decals, matDecal, 1),
    norm: makeLayer(caps.sprites, matNorm, 2),
    add: makeLayer(caps.sprites + caps.imm, matAdd, 3),
  };

  // debris (instanced, lit)
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  const debrisMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a2622 });
  const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, caps.debris);
  debrisMesh.frustumCulled = false;
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.count = 0;
  debrisMesh.setColorAt(0, new THREE.Color(0xffffff));
  debrisMesh.name = 'fv-fx-debris';
  parent.add(debrisMesh);

  // screen flash (clip-space quad; visible only while active)
  const flashMat = new THREE.ShaderMaterial({
    vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, uniforms: { uA: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flashMat);
  flashMesh.frustumCulled = false;
  flashMesh.renderOrder = 1000;
  flashMesh.visible = false;
  parent.add(flashMesh);
  const flash = { a: 0, t: 0, life: 0 };

  // lights: fixed pool, created up-front
  const lights = [];
  for (let i = 0; i < caps.lights; i += 1) {
    const light = new THREE.PointLight(0xffb066, 0, 40, 1.8);
    light.name = 'fv-fx-light';
    parent.add(light);
    lights.push({ light, age: 0, life: 0, peak: 0, live: false });
  }
  let lightCursor = 0;

  // ── particle stores ───────────────────────────────────────────────────
  const P = Array.from({ length: caps.sprites }, () => ({
    live: false, layer: 'add', type: 'sprite', cell: 'glow', rect: cellRect('glow'),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, rot: 0, spin: 0, drag: 0, buoy: 0, grav: 0,
    c0: [1, 1, 1, 1], c1: [1, 1, 1, 0], enveloped: false, peak: 1, maxScreen: 0.5, nx: 0, ny: 1, nz: 0,
    stretch: 0.04, width: 0.05, roll: 0, ex: 0, ey: 0, ez: 0, kind: '', hold: 0,
  }));
  const D = Array.from({ length: caps.debris }, () => ({
    live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, spin: 1,
    age: 0, life: 1, floor: -1e9, color: 0x555555,
  }));
  const DC = Array.from({ length: caps.decals }, () => ({
    live: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, size: 1, age: 0, life: 6, rect: cellRect('scorch'), c: [0, 0, 0, 0.8], rot: 0,
  }));
  const imm = [];           // per-frame immediate quads
  const stats = {
    sprites: 0, debris: 0, decals: 0, lightsActive: 0, immediate: 0, immDropped: 0,
    byKind: {}, spawned: 0, updateMs: 0, lastFrameMs: 0,
  };
  let disposed = false;
  let time = 0;
  let warm = 4;                 // first frames: draw each layer once (zero alpha) so shaders compile before combat
  const tmpColor = new THREE.Color();
  const dummy = new THREE.Object3D();
  const euler = new THREE.Euler();

  const reducedFactor = () => (reduced() ? 0.5 : 1);

  // ── spawn API (the "sink") ────────────────────────────────────────────
  function spawnSprite(s, type = 'sprite') {
    if (disposed) return null;
    const { index } = spritePool.acquire();
    const p = P[index];
    p.live = true;
    p.type = type;
    p.layer = s.layer === 'norm' ? 'norm' : 'add';
    p.cell = s.cell || 'glow';
    p.rect = cellRect(p.cell);
    p.x = s.pos.x; p.y = s.pos.y; p.z = s.pos.z;
    const v = s.vel || { x: 0, y: 0, z: 0 };
    p.vx = v.x; p.vy = v.y; p.vz = v.z;
    p.delay = s.delay || 0;
    p.age = -p.delay;
    p.life = Math.max(0.02, s.life || 0.3);
    p.s0 = s.size0 ?? s.size ?? 1;
    p.s1 = s.size1 ?? s.size ?? p.s0;
    p.rot = s.rot || 0;
    p.spin = s.spin || 0;
    p.drag = s.drag ?? 0;
    p.buoy = s.buoy || 0;
    p.grav = s.grav || 0;
    p.c0 = s.c0 || [1, 1, 1, 1];
    p.c1 = s.c1 || p.c0;
    p.enveloped = (p.c0[3] ?? 1) <= 0;
    p.peak = s.peak ?? ENV_PEAK[p.cell] ?? 0.5;
    p.maxScreen = s.maxScreen ?? 0.5;
    p.stretch = s.stretch ?? 0.04;
    p.width = s.width ?? 0.05;
    p.roll = s.roll || 0;
    p.kind = s.kind || type;
    p.nx = s.normal?.x ?? 0; p.ny = s.normal?.y ?? 1; p.nz = s.normal?.z ?? 0;
    p.ex = s.end?.x ?? 0; p.ey = s.end?.y ?? 0; p.ez = s.end?.z ?? 0;
    p.hold = s.hold || 0;
    p.minW = s.minW || 0;
    stats.spawned += 1;
    stats.byKind[p.kind] = (stats.byKind[p.kind] || 0) + 1;
    return p;
  }

  const sink = {
    sprite: s => spawnSprite(s, 'sprite'),
    streak: s => spawnSprite({ ...s, layer: 'add', cell: s.cell || 'streak' }, 'streak'),
    ring: s => spawnSprite({
      ...s, layer: 'add', cell: s.cell || 'ring', size0: (s.r0 ?? 0.2) * 2, size1: (s.r1 ?? 4) * 2, vel: { x: 0, y: 0, z: 0 },
      pos: s.pos, normal: s.normal, maxScreen: s.maxScreen ?? 0.35,
    }, 'ring'),
    debris: s => spawnDebris(s),
    decal: s => spawnDecal(s),
    light: s => pulseLight(s),
    screenFlash: (alpha, life) => { if (!reduced()) { flash.a = alpha; flash.life = life; flash.t = 0; } },
    haze: () => false,
  };

  /** Pooled straight beam p0 -> p1 (RAIL): fixed endpoints, core + edge, used with hold/afterglow. */
  function beam({ from, to, width, life, c0, c1, cell = 'streak', hold = 0, kind = 'beam', minW = 0 }) {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    return spawnSprite({
      pos: mid, end: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, width, life, c0, c1, cell, layer: 'add', kind, hold, minW,
    }, 'beam');
  }

  function spawnDebris(s) {
    if (disposed) return null;
    const { index } = debrisPool.acquire();
    const d = D[index];
    d.live = true;
    d.x = s.pos.x; d.y = s.pos.y; d.z = s.pos.z;
    d.vx = s.vel.x; d.vy = s.vel.y; d.vz = s.vel.z;
    d.rx = rnd() * 6; d.ry = rnd() * 6; d.rz = rnd() * 6;
    if (Array.isArray(s.size)) { d.sx = s.size[0]; d.sy = s.size[1]; d.sz = s.size[2]; }
    else { d.sx = s.size; d.sy = s.size * (0.5 + rnd() * 0.6); d.sz = s.size * (0.7 + rnd() * 0.5); }
    d.spin = s.spin || 8;
    d.age = 0;
    d.life = Math.max(0.1, s.life || 0.8);
    d.floor = heightAt ? (heightAt(s.pos.x, s.pos.z) ?? -1e9) : -1e9;   // queried ONCE at spawn
    d.color = s.color ?? 0x555555;
    stats.spawned += 1;
    stats.byKind.debris = (stats.byKind.debris || 0) + 1;
    return d;
  }

  function spawnDecal(s) {
    if (disposed) return null;
    const { index } = decalPool.acquire();
    const d = DC[index];
    d.live = true;
    d.x = s.pos.x; d.y = s.pos.y; d.z = s.pos.z;
    d.nx = s.normal.x; d.ny = s.normal.y; d.nz = s.normal.z;
    d.size = s.size || 1;
    d.age = 0;
    d.life = s.life || 6;
    d.rect = cellRect(s.cell || 'scorch');
    d.c = s.c0 || [0.05, 0.05, 0.05, 0.8];
    d.rot = s.rot || 0;
    stats.byKind.decal = (stats.byKind.decal || 0) + 1;
    return d;
  }

  function pulseLight({ pos, color = '#ffb066', intensity = 100, distance = 30, life = 0.15 }) {
    if (disposed || !lights.length) return null;
    // a free light, else steal the round-robin oldest — the flash light is never skipped
    let slot = lights.find(l => !l.live);
    if (!slot) slot = lights[lightCursor++ % lights.length];
    slot.live = true; slot.age = 0; slot.life = Math.max(0.03, life); slot.peak = intensity;
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.light.position.set(pos.x, pos.y, pos.z);
    slot.light.intensity = intensity;
    onLight?.(slot);
    return slot;
  }

  /** Immediate quad for this frame only (projectile visuals). */
  function quad(q) {
    if (disposed) return false;
    if (imm.length >= caps.imm) { stats.immDropped += 1; return false; }
    imm.push(q);
    return true;
  }

  // ── writers ────────────────────────────────────────────────────────────
  function writeInstance(layer, i, mode, x, y, z, sx, sy, rot, maxScreen, rect, r, g, b, a, ex, ey, ez) {
    const A = layer.arrays;
    let o = i * 4;
    A.iA[o] = x; A.iA[o + 1] = y; A.iA[o + 2] = z; A.iA[o + 3] = mode;
    A.iB[o] = sx; A.iB[o + 1] = sy; A.iB[o + 2] = rot; A.iB[o + 3] = maxScreen;
    A.iC[o] = rect[0]; A.iC[o + 1] = rect[1]; A.iC[o + 2] = rect[2]; A.iC[o + 3] = rect[3];
    A.iD[o] = r; A.iD[o + 1] = g; A.iD[o + 2] = b; A.iD[o + 3] = a;
    A.iE[o] = ex; A.iE[o + 1] = ey; A.iE[o + 2] = ez; A.iE[o + 3] = 0;
  }

  const easeOut = k => 1 - (1 - k) * (1 - k);

  function updateSprites(dt) {
    let nAdd = 0; let nNorm = 0; let live = 0;
    for (let i = 0; i < P.length; i += 1) {
      const p = P[i];
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life + p.hold) {
        p.live = false; spritePool.release(i); continue;
      }
      live += 1;
      if (p.age < 0) continue;                   // delayed
      const active = p.age - p.hold;
      const k = Math.min(1, Math.max(0, active / p.life));
      if (p.type !== 'beam') {
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp; p.vy *= damp; p.vz *= damp;
        p.vy += (p.buoy - p.grav) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      p.rot += p.spin * dt;
      // colour + alpha
      const kc = Math.min(1, k * 1.4);
      const r = lin(lerp(p.c0[0], p.c1[0], kc));
      const g = lin(lerp(p.c0[1], p.c1[1], kc));
      const b = lin(lerp(p.c0[2], p.c1[2], kc));
      let a;
      if (p.enveloped) a = p.peak * Math.min(1, k / 0.14) * Math.pow(1 - k, 1.25);
      else if (p.hold > 0 && active < 0) a = p.c0[3];
      else a = lerp(p.c0[3], p.c1[3], k * k * (3 - 2 * k) * 0.5 + k * 0.5);
      if (a <= 0.003) continue;
      const layer = p.layer === 'norm' ? layers.norm : layers.add;
      const slot = p.layer === 'norm' ? nNorm++ : nAdd++;
      if (p.type === 'sprite') {
        const s = lerp(p.s0, p.s1, easeOut(k));
        writeInstance(layer, slot, MODE.billboard, p.x, p.y, p.z, s, s, p.rot, p.maxScreen, p.rect, r, g, b, a, 0, 0, 0);
      } else if (p.type === 'streak') {
        // head at the particle, tail behind along velocity
        const ex = p.vx * p.stretch; const ey = p.vy * p.stretch; const ez = p.vz * p.stretch;
        writeInstance(layer, slot, MODE.streak, p.x - ex * 0.5, p.y - ey * 0.5, p.z - ez * 0.5, 8, p.width, 0, 1, p.rect, r, g, b, a, ex, ey, ez);
      } else if (p.type === 'beam') {
        writeInstance(layer, slot, MODE.streak, p.x, p.y, p.z, 2, p.width * (p.s0 > 0 && p.s1 !== p.s0 ? lerp(p.s0, p.s1, k) : 1), p.minW || 0, 1, p.rect, r, g, b, a, p.ex, p.ey, p.ez);
      } else {   // ring
        const s = lerp(p.s0, p.s1, easeOut(k));
        writeInstance(layer, slot, MODE.surface, p.x, p.y, p.z, s, s, p.rot, p.maxScreen, p.rect, r, g, b, a, p.nx, p.ny, p.nz);
      }
    }
    stats.sprites = live;
    // immediate quads last (additive)
    let n = nAdd;
    for (const q of imm) {
      if (n >= layers.add.capacity) break;
      const c = q.color || [1, 1, 1, 1];
      if (q.mode === 'streak') {
        writeInstance(layers.add, n++, MODE.streak, q.pos.x, q.pos.y, q.pos.z, q.minLen ?? 8, q.width ?? 0.05, q.minW || 0, 1, cellRect(q.cell || 'streak'),
          lin(c[0]), lin(c[1]), lin(c[2]), c[3], q.axis.x, q.axis.y, q.axis.z);
      } else {
        writeInstance(layers.add, n++, MODE.billboard, q.pos.x, q.pos.y, q.pos.z, q.size, q.sizeY ?? q.size, q.rot || 0, q.maxScreen ?? 0.3, cellRect(q.cell || 'glow'),
          lin(c[0]), lin(c[1]), lin(c[2]), c[3], 0, 0, 0);
      }
    }
    stats.immediate = Math.min(imm.length, caps.imm);
    imm.length = 0;
    layers.add.count = n;
    layers.norm.count = nNorm;
  }

  function updateDebris(dt) {
    let n = 0; let live = 0;
    for (let i = 0; i < D.length; i += 1) {
      const d = D[i];
      if (!d.live) continue;
      d.age += dt;
      if (d.age >= d.life) { d.live = false; debrisPool.release(i); continue; }
      live += 1;
      d.vy -= 22 * dt;
      const damp = Math.exp(-0.25 * dt);
      d.vx *= damp; d.vz *= damp;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const ground = heightAt ? (heightAt(d.x, d.z) ?? d.floor) : d.floor;
      if (d.y < ground + 0.05) {
        if (d.y < ground - 0.8) { d.live = false; debrisPool.release(i); continue; }   // fell through the floor
        d.y = ground + 0.05;
        d.vy = Math.abs(d.vy) * 0.25; d.vx *= 0.6; d.vz *= 0.6; d.spin *= 0.6;
      }
      d.rx += d.spin * dt; d.ry += d.spin * 0.7 * dt; d.rz += d.spin * 0.4 * dt;
      const k = d.age / d.life;
      const shrink = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      dummy.position.set(d.x, d.y, d.z);
      euler.set(d.rx, d.ry, d.rz);
      dummy.quaternion.setFromEuler(euler);
      dummy.scale.set(d.sx * shrink, d.sy * shrink, d.sz * shrink);
      dummy.updateMatrix();
      debrisMesh.setMatrixAt(n, dummy.matrix);
      tmpColor.setHex(d.color);
      debrisMesh.setColorAt(n, tmpColor);
      n += 1;
    }
    debrisMesh.count = n;
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
    stats.debris = live;
  }

  function updateDecals(dt) {
    let n = 0; let live = 0;
    for (let i = 0; i < DC.length; i += 1) {
      const d = DC[i];
      if (!d.live) continue;
      d.age += dt;
      if (d.age >= d.life) { d.live = false; decalPool.release(i); continue; }
      live += 1;
      const k = d.age / d.life;
      const a = d.c[3] * Math.min(1, (1 - k) / 0.4);
      writeInstance(layers.decal, n++, MODE.surface, d.x, d.y, d.z, d.size, d.size, d.rot, 1.2, d.rect,
        lin(d.c[0]), lin(d.c[1]), lin(d.c[2]), a, d.nx, d.ny, d.nz);
    }
    layers.decal.count = n;
    stats.decals = live;
  }

  function updateLights(dt) {
    let active = 0;
    for (const slot of lights) {
      if (!slot.live) continue;
      slot.age += dt;
      const k = slot.age / slot.life;
      if (k >= 1) { slot.live = false; slot.light.intensity = 0; continue; }
      slot.light.intensity = slot.peak * (1 - k) * (1 - k);
      active += 1;
    }
    stats.lightsActive = active;
  }

  function flushLayer(layer) {
    const n = warm > 0 ? Math.max(1, layer.count) : layer.count;
    layer.geometry.instanceCount = n;
    layer.mesh.visible = n > 0;
    for (const name of ['iA', 'iB', 'iC', 'iD', 'iE']) layer.geometry.attributes[name].needsUpdate = true;
  }

  /** Advance the simulation and upload. `camera` provides fov/projection for the px-scale uniforms. */
  function update(dt, camera, viewportHeightPx = 900) {
    if (disposed) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    time += dt;
    if (camera?.isPerspectiveCamera) {
      const fovH = 2 * Math.tan((camera.fov * Math.PI / 180) / 2);
      uniforms.uFovH.value = fovH;
      uniforms.uPxWorld.value = fovH / Math.max(200, viewportHeightPx);
      uniforms.uViewport.value.set(Math.max(200, viewportHeightPx) * (camera.aspect || 0.5), Math.max(200, viewportHeightPx));
    }
    updateSprites(dt);
    updateDebris(dt);
    updateDecals(dt);
    updateLights(dt);
    flushLayer(layers.add); flushLayer(layers.norm); flushLayer(layers.decal);
    if (warm > 0 && debrisMesh.count === 0) { dummy.position.set(0, -1e5, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); debrisMesh.setMatrixAt(0, dummy.matrix); debrisMesh.count = 1; debrisMesh.instanceMatrix.needsUpdate = true; }
    debrisMesh.visible = debrisMesh.count > 0;
    if (flash.life > 0) {
      flash.t += dt;
      const k = flash.t / flash.life;
      flashMat.uniforms.uA.value = k >= 1 ? 0 : flash.a * (1 - k);
      flashMesh.visible = k < 1;
      if (k >= 1) flash.life = 0;
    } else flashMesh.visible = warm > 0;
    if (warm > 0) warm -= 1;
    if (t0) { stats.lastFrameMs = performance.now() - t0; stats.updateMs = stats.updateMs * 0.95 + stats.lastFrameMs * 0.05; }
  }

  function clear() {
    for (const p of P) p.live = false;
    for (const d of D) d.live = false;
    for (const d of DC) d.live = false;
    spritePool.clear(); debrisPool.clear(); decalPool.clear();
    for (const l of lights) { l.live = false; l.light.intensity = 0; }
    imm.length = 0;
  }

  function snapshot() {
    return {
      tier,
      caps: { sprites: caps.sprites, debris: caps.debris, decals: caps.decals, lights: caps.lights, imm: caps.imm },
      live: { sprites: stats.sprites, debris: stats.debris, decals: stats.decals, lights: stats.lightsActive, immediate: stats.immediate },
      pools: { sprites: spritePool.snapshot(), debris: debrisPool.snapshot(), decals: decalPool.snapshot() },
      drawCalls: 4 + (flashMesh.visible ? 1 : 0),
      spawned: stats.spawned,
      immDropped: stats.immDropped,
      updateMs: +stats.updateMs.toFixed(3),
      byKind: { ...stats.byKind },
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const layer of Object.values(layers)) {
      parent.remove(layer.mesh); layer.geometry.dispose();
    }
    parent.remove(debrisMesh); parent.remove(flashMesh);
    debrisMesh.dispose?.(); debrisGeo.dispose(); debrisMat.dispose();
    flashMesh.geometry.dispose(); flashMat.dispose();
    matAdd.dispose(); matNorm.dispose(); matDecal.dispose(); quadSrc.dispose(); atlas.dispose();
    for (const l of lights) parent.remove(l.light);
    lights.length = 0;
  }

  // recipe helpers bound to this system + tier quality
  const q = caps.quality * reducedFactor();
  return {
    tier, caps, sink, quad, beam, update, clear, snapshot, dispose,
    explosion: (kind, o = {}) => explosion(kind, sink, { rnd, q: caps.quality * reducedFactor(), ...o }),
    impact: (type, o = {}) => surfaceImpact(type, sink, { rnd, q: caps.quality, ...o }),
    muzzle: o => muzzleFlash(sink, { rnd, ...o }),
    crash: o => crashBurst(sink, { rnd, q: caps.quality, ...o }),
    spawnSprite, spawnDebris, spawnDecal, pulseLight,
    get flashVisible() { return flashMesh.visible; },
    get screenFlashAlpha() { return flashMat.uniforms.uA.value; },
    q,
  };
}
