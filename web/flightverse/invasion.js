// flightverse/invasion.js — MODO INVASIÓN: enemigos ORIGINALES procedurales
// (cero assets de terceros). Tipos: zombies, arqueros (flechas en arco),
// soldados (ráfagas), OVNIs (plasma), aviones (pasadas), dragón (bolas de
// fuego) y gigantes (cuerpo a cuerpo). Los terrestres SOLO pisan suelo
// caminable (pendiente <4.5m, altura suavizada — sin escalones); los aéreos
// vuelan con sus propios patrones. Todos son hittables del armamento.
import * as THREE from '/flightverse/three.js?v=306';
import {
  capWaveQueue,
  createBurstSchedule,
  getDeviceBudget,
  getInvasionRuntimeCaps,
  modelLoadDecision,
  nextEnemyState,
  predictiveAim,
  selectEnemyLod,
  steerGroundEnemy,
} from '/flightverse/invasion-policy.js?v=306';

export const ENEMIES = {
  zombie:  { label: 'Zombies',   ground: true,  blood: true },
  arquero: { label: 'Arqueros',  ground: true,  blood: true },
  soldado: { label: 'Soldados',  ground: true,  blood: true },
  ufo:     { label: 'OVNIs',     ground: false, blood: false },
  avion:   { label: 'Aviones',   ground: false, blood: false },
  dragon:  { label: 'Dragón',    ground: false, blood: true },
  gigante: { label: 'Gigantes',  ground: true,  blood: true },
};

function walkable(heightAt, x, z, maxSlope = 4.5, d = 2.2) {
  const g = heightAt(x, z);
  if (g == null) return null;
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    const n = heightAt(x + dx, z + dz);
    if (n == null || Math.abs(n - g) > maxSlope) return null;
  }
  return g;
}

const M = (c) => new THREE.MeshLambertMaterial({ color: c });
const cap = (r, h, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 5, 10), m);
const box = (x, y, z, m) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m);
const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), m);

// ── constructores (compactos, silueta clara) ──
function bZombie(archer) {
  const g = new THREE.Group();
  const skin = M(0x5a6e4a), cloth = M(archer ? 0x3a2f24 : 0x2a2f38);
  const torso = cap(0.28, 0.5, cloth); torso.position.y = 1.15; torso.rotation.x = 0.24;
  const head = sph(0.2, skin); head.position.set(0.04, 1.62, -0.08);
  const aL = cap(0.075, 0.44, skin); aL.position.set(-0.34, 1.24, -0.22); aL.rotation.set(-1.1, 0, 0.18);
  const aR = cap(0.075, 0.44, skin); aR.position.set(0.34, 1.24, -0.28); aR.rotation.set(-1.35, 0, -0.12);
  const lL = cap(0.1, 0.5, cloth); lL.position.set(-0.14, 0.5, 0);
  const lR = cap(0.1, 0.5, cloth); lR.position.set(0.14, 0.5, 0);
  g.add(torso, head, aL, aR, lL, lR);
  if (archer) {                              // arco: arco de torus
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 14, Math.PI), M(0x6b4a2a));
    bow.position.set(0.42, 1.3, -0.42); bow.rotation.y = Math.PI / 2;
    g.add(bow);
  }
  return { g, anim: { aL, aR, lL, lR, torso } };
}
function bSoldado() {
  const g = new THREE.Group();
  const skin = M(0xc9a37e), uni = M(0x4a5238), dark = M(0x22261c);
  const torso = cap(0.26, 0.5, uni); torso.position.y = 1.2;
  const head = sph(0.18, skin); head.position.y = 1.68;
  const casco = sph(0.2, uni); casco.position.y = 1.73; casco.scale.y = 0.7;
  const rifle = box(0.07, 0.09, 0.85, dark); rifle.position.set(0.18, 1.32, -0.3);
  const aL = cap(0.07, 0.4, uni); aL.position.set(-0.32, 1.28, -0.05); aL.rotation.x = -0.9;
  const aR = cap(0.07, 0.4, uni); aR.position.set(0.3, 1.28, -0.15); aR.rotation.x = -1.1;
  const lL = cap(0.09, 0.52, dark); lL.position.set(-0.13, 0.5, 0);
  const lR = cap(0.09, 0.52, dark); lR.position.set(0.13, 0.5, 0);
  g.add(torso, head, casco, rifle, aL, aR, lL, lR);
  return { g, anim: { aL, aR, lL, lR, torso } };
}
function bUfo() {
  const g = new THREE.Group();
  const hull = sph(1.6, new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.25 }));
  hull.scale.y = 0.28;
  const dome = sph(0.62, new THREE.MeshLambertMaterial({ color: 0x7dffc9, emissive: 0x1f7a58 }));
  dome.position.y = 0.32; dome.scale.y = 0.75;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.09, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0x45A0E6 }));
  ring.rotation.x = Math.PI / 2;
  g.add(hull, dome, ring);
  return { g, anim: { ring } };
}
function bAvion() {
  const g = new THREE.Group();
  const mm = M(0x8a929e), dk = M(0x3a4048);
  const fus = cap(0.32, 2.6, mm); fus.rotation.x = Math.PI / 2;
  const wing = box(5.2, 0.1, 1.1, mm); wing.position.z = 0.2;
  const tail = box(1.6, 0.08, 0.55, mm); tail.position.set(0, 0.3, 1.5);
  const fin = box(0.08, 0.7, 0.5, dk); fin.position.set(0, 0.45, 1.5);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), dk);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -1.85;
  g.add(fus, wing, tail, fin, nose);
  return { g, anim: {} };
}
function bDragon() {
  const g = new THREE.Group();
  const rojo = M(0x8a2318), oscuro = M(0x571510);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 8), rojo);
  head.rotation.x = -Math.PI / 2;
  const segs = [];
  for (let i = 0; i < 6; i++) {
    const s = sph(0.5 - i * 0.055, i % 2 ? oscuro : rojo);
    s.position.z = 0.9 + i * 0.75;
    g.add(s); segs.push(s);
  }
  const wL = box(2.6, 0.06, 1.2, oscuro); wL.position.set(-1.5, 0.2, 1.2);
  const wR = box(2.6, 0.06, 1.2, oscuro); wR.position.set(1.5, 0.2, 1.2);
  g.add(head, wL, wR);
  return { g, anim: { wL, wR, segs } };
}
function bGigante() {
  const g = new THREE.Group();
  const piel = M(0xb08968), pelo = M(0x3a2a1c);
  const s = 7.5;                             // ~12m de alto
  const lL = cap(0.16 * s, 0.5 * s, piel); lL.position.set(-0.2 * s, 0.55 * s, 0);
  const lR = cap(0.16 * s, 0.5 * s, piel); lR.position.set(0.2 * s, 0.55 * s, 0);
  const torso = box(0.62 * s, 0.62 * s, 0.3 * s, piel); torso.position.y = 1.18 * s;
  const head = sph(0.19 * s, piel); head.position.y = 1.66 * s;
  const hair = sph(0.2 * s, pelo); hair.position.y = 1.72 * s; hair.scale.set(1, 0.6, 1);
  const aL = cap(0.11 * s, 0.55 * s, piel); aL.position.set(-0.42 * s, 1.2 * s, 0); aL.rotation.z = 0.25;
  const aR = cap(0.11 * s, 0.55 * s, piel); aR.position.set(0.42 * s, 1.2 * s, 0); aR.rotation.z = -0.25;
  g.add(lL, lR, torso, head, hair, aL, aR);
  return { g, anim: { aL, aR, lL, lR, torso } };
}

const SPECS = {
  zombie:  { build: () => bZombie(false), hp: 100, speed: 1.6, radius: 1.7, y: 1.15, dmg: 8,  melee: 2.2 },
  arquero: { build: () => bZombie(true),  hp: 90,  speed: 1.2, radius: 1.7, y: 1.15, shoot: { every: 3.2, speed: 26, dmg: 6, grav: 9, range: 90, band: { min: 24, max: 80 } } },
  soldado: { build: bSoldado,             hp: 120, speed: 3.2, radius: 1.7, y: 1.2,  shoot: { every: 2.4, speed: 46, dmg: 3, grav: 0, range: 110, burst: 3, band: { min: 20, max: 95 } } },
  ufo:     { build: bUfo,                 hp: 240, speed: 7,   radius: 4.5, y: 0,    fly: 'orbit', shoot: { every: 4, speed: 20, dmg: 10, grav: 0, range: 140, plasma: true, band: { min: 28, max: 115 } } },
  avion:   { build: bAvion,               hp: 140, speed: 34,  radius: 6,   y: 0,    fly: 'pass', attackDistance: 120 },
  dragon:  { build: bDragon,              hp: 700, speed: 9,   radius: 6,   y: 0,    fly: 'serp', shoot: { every: 4.5, speed: 17, dmg: 15, grav: 2, range: 150, fire: true, band: { min: 32, max: 125 } } },
  gigante: { build: bGigante,             hp: 1600, speed: 2.1, radius: 14, y: 8.8,  dmg: 22, melee: 7, slope: 6, foot: 5 },
};

const DIFFICULTY = {
  facil: { hp: 0.8, cadence: 1.25, accuracy: 0.72 },
  media: { hp: 1, cadence: 1, accuracy: 0.86 },
  dificil: { hp: 1.25, cadence: 0.78, accuracy: 0.95 },
};
const AI_STATES = ['spawn', 'pursue', 'strafe', 'orbit', 'attack', 'evade', 'recover', 'dead'];

export function createInvasion(scene, {
  heightAt,
  audio,
  onHit,
  fx,
  deviceTier = 'medium',
} = {}) {
  const group = new THREE.Group(); group.name = 'fv-invasion'; scene.add(group);
  const E = [], shots = [], bursts = [];
  const budget = getDeviceBudget(deviceTier);
  let runtimeCaps = getInvasionRuntimeCaps(deviceTier, 1);
  const modelCache = new Map();
  let catalog = null;
  let catalogPromise = null;
  let GLTFLoader = null;
  let SkelUtils = null;
  let session = 0;
  let disposed = false;
  let simTime = 0;
  const S = {
    on: false,
    phase: 'idle',
    wave: 0,
    alive: 0,
    killed: 0,
    score: 0,
    combo: 0,
    countdown: 0,
    spawnAcc: 0,
    queue: [],
    types: ['zombie'],
    difficulty: 'media',
    tier: deviceTier,
    budget,
    telemetry: {
      tier: deviceTier,
      modelSource: { glb: 0, procedural: 0 },
      lod: { full: 0, lod1: 0, lod2: 0 },
      ai: Object.fromEntries(AI_STATES.map(state => [state, 0])),
      activeByType: {},
      spawnFailures: 0,
      fallbackTotal: 0,
      fallbackByType: {},
      projectiles: 0,
      scheduledShots: 0,
      loadRejected: 0,
      preload: { requested: 0, ready: 0, failed: 0 },
      caps: runtimeCaps,
      runtimeCounts: { enemies: 0, shots: 0, bursts: 0, modelCache: 0 },
      withinCaps: true,
    },
  };

  function disposeTree(root) {
    root?.traverse?.(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose();
        }
        material.dispose?.();
      }
    });
  }

  async function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/assets/enemies/enemy_catalog.json?v=306', { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`enemy catalog ${response.status}`);
          return response.json();
        })
        .then(value => {
          catalog = value?.models || {};
          return catalog;
        });
    }
    return catalogPromise;
  }

  function modelFile(type, lod) {
    const entry = catalog?.[type];
    if (!entry) return null;
    return lod === 'full' ? entry.file : entry[lod];
  }

  async function loadModel(type, lod) {
    const key = `${type}:${lod}`;
    const existing = modelCache.get(key);
    if (modelLoadDecision(existing) === 'skip') {
      if (existing.status === 'ready') return existing.value;
      if (existing.status === 'loading') return existing.promise;
      return null;
    }
    if (modelCache.size >= runtimeCaps.modelCache) {
      S.telemetry.loadRejected++;
      return null;
    }
    S.telemetry.preload.requested++;
    const loadSession = session;
    let loadingEntry;
    const promise = (async () => {
      try {
        await loadCatalog();
        const file = modelFile(type, lod);
        if (!file) throw new Error(`catalog missing ${key}`);
        if (!GLTFLoader) ({ GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=306'));
        if (!SkelUtils) SkelUtils = await import('/vendor/three-addons180/utils/SkeletonUtils.js?v=306');
        const gltf = await new GLTFLoader().loadAsync(`/assets/enemies/${file}?v=306`);
        const loaded = { scene: gltf.scene, clips: gltf.animations || [], type, lod };
        if (disposed || loadSession !== session) {
          disposeTree(loaded.scene);
          if (modelCache.get(key) === loadingEntry) modelCache.delete(key);
          return null;
        }
        modelCache.set(key, { status: 'ready', value: loaded });
        S.telemetry.preload.ready++;
        return loaded;
      } catch {
        if (disposed || loadSession !== session) {
          if (modelCache.get(key) === loadingEntry) modelCache.delete(key);
          return null;
        }
        modelCache.set(key, { status: 'failed' });
        S.telemetry.preload.failed++;
        return null;
      }
    })();
    loadingEntry = { status: 'loading', promise };
    modelCache.set(key, loadingEntry);
    return promise;
  }

  function cachedModel(type, lod) {
    const entry = modelCache.get(`${type}:${lod}`);
    return entry?.status === 'ready' ? entry.value : null;
  }

  function makeActions(root, clips, spec) {
    if (!clips.length) return { mixer: null, act: null };
    const mixer = new THREE.AnimationMixer(root);
    const byName = name => THREE.AnimationClip.findByName(clips, name);
    const move = byName(spec.fly ? 'fly' : 'walk') || byName('idle') || clips[0];
    const act = {
      move: mixer.clipAction(move),
      attack: null,
      death: null,
    };
    act.move.play();
    const attack = byName('attack');
    if (attack) {
      act.attack = mixer.clipAction(attack);
      act.attack.setLoop(THREE.LoopOnce, 1);
      act.attack.clampWhenFinished = false;
    }
    const death = byName('death');
    if (death) {
      act.death = mixer.clipAction(death);
      act.death.setLoop(THREE.LoopOnce, 1);
      act.death.clampWhenFinished = true;
    }
    return { mixer, act };
  }

  function makeVisual(type, lod, spec) {
    const cached = cachedModel(type, lod);
    if (cached && SkelUtils) {
      const root = SkelUtils.clone(cached.scene);
      root.traverse(object => { object.castShadow = true; });
      const { mixer, act } = makeActions(root, cached.clips, spec);
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      return {
        root,
        anim: {},
        mixer,
        act,
        source: 'glb',
        lod,
        yOff: spec.fly ? 0 : size.y * 0.55,
        radius: Math.max(spec.radius, size.length() * 0.42),
      };
    }
    const built = spec.build();
    built.g.traverse(object => { object.castShadow = true; });
    return {
      root: built.g,
      anim: built.anim,
      mixer: null,
      act: null,
      source: 'procedural',
      lod: null,
      yOff: spec.y,
      radius: spec.radius,
    };
  }

  function releaseVisual(e, final = false) {
    if (!e.visual) return;
    e.mixer?.stopAllAction();
    e.mixer?.uncacheRoot?.(e.visual);
    e.visual.traverse?.(object => object.skeleton?.dispose?.());
    e.g.remove(e.visual);
    if (e.modelSource === 'procedural' || final) disposeTree(e.visual);
    e.visual = null;
    e.mixer = null;
    e.act = null;
  }

  function swapVisual(e, lod) {
    if (e.modelSource === 'glb' && e.lod === lod) return false;
    if (!cachedModel(e.type, lod)) {
      loadModel(e.type, lod);
      return false;
    }
    releaseVisual(e);
    const visual = makeVisual(e.type, lod, e.spec);
    e.visual = visual.root;
    e.anim = visual.anim;
    e.mixer = visual.mixer;
    e.act = visual.act;
    e.modelSource = visual.source;
    e.lod = visual.lod;
    e.yOff = visual.yOff;
    e.radius = visual.radius;
    e.radiusSq = visual.radius * visual.radius;
    e.g.add(visual.root);
    return true;
  }

  function spawnOne(type, around) {
    const spec = SPECS[type];
    if (!spec || E.length >= runtimeCaps.enemies) return false;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * 6.283;
      const r = spec.fly ? 60 + Math.random() * 60 : 14 + Math.random() * 30;
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      let y;
      if (spec.fly) {
        const g0 = heightAt(x, z);
        y = (g0 ?? around.y) + 25 + Math.random() * 20;
      } else {
        const gy = walkable(heightAt, x, z, spec.slope || 4.5, spec.foot || 2.2);
        if (gy == null) continue;
        y = gy;
      }
      const lod = selectEnemyLod(type, r, deviceTier, { nearUsed: budget.nearDetail });
      const visual = makeVisual(type, lod, spec);
      const g = new THREE.Group();
      g.add(visual.root);
      g.position.set(x, y, z);
      group.add(g);
      const diff = DIFFICULTY[S.difficulty];
      const waveScale = Math.min(10, S.wave);
      const e = {
        g,
        visual: visual.root,
        anim: visual.anim,
        mixer: visual.mixer,
        act: visual.act,
        modelSource: visual.source,
        lod: visual.lod,
        type,
        spec,
        enemy: true,
        blood: ENEMIES[type].blood,
        hp: spec.hp * diff.hp * (1 + waveScale * 0.1),
        phase: Math.random() * 6.283,
        speed: spec.speed * (1 + waveScale * 0.025),
        center: new THREE.Vector3(),
        yOff: visual.yOff,
        radius: visual.radius,
        radiusSq: visual.radius * visual.radius,
        cool: Math.random() * spec.shoot?.every || 0,
        state: 'spawn',
        stateTime: 0,
        blocked: false,
        passDir: null,
        seed: ((S.wave * 73856093) ^ (E.length * 19349663) ^ (type.length * 83492791)) >>> 0,
      };
      if (visual.source === 'procedural') {
        S.telemetry.fallbackTotal++;
        S.telemetry.fallbackByType[type] = (S.telemetry.fallbackByType[type] || 0) + 1;
      }
      E.push(e);
      S.alive++;
      return true;
    }
    return false;
  }

  function removeShot(index) {
    const shot = shots[index];
    if (!shot) return;
    group.remove(shot.m);
    disposeTree(shot.m);
    shots.splice(index, 1);
  }

  function shootAt(e, dronePos, droneVelocity) {
    const sh = e.spec.shoot;
    if (!sh || shots.length >= runtimeCaps.shots || e.g.userData.dead) return false;
    const from = e.center.clone();
    const d = from.distanceTo(dronePos);
    if (d > sh.range) return false;
    const aim = predictiveAim({
      origin: from,
      target: dronePos,
      targetVelocity: droneVelocity || { x: 0, y: 0, z: 0 },
      projectileSpeed: sh.speed,
      gravity: sh.grav || 0,
    });
    const diff = DIFFICULTY[S.difficulty];
    const miss = (1 - diff.accuracy) * 0.16;
    const dir = new THREE.Vector3(aim.velocity.x, aim.velocity.y, aim.velocity.z);
    dir.x += (Math.random() - 0.5) * sh.speed * miss;
    dir.y += (Math.random() - 0.5) * sh.speed * miss * 0.5;
    dir.z += (Math.random() - 0.5) * sh.speed * miss;
    dir.normalize().multiplyScalar(sh.speed);
    let m;
    if (sh.fire || sh.plasma) {
      m = new THREE.Mesh(new THREE.SphereGeometry(sh.fire ? 0.5 : 0.35, 10, 8),
        new THREE.MeshBasicMaterial({ color: sh.fire ? 0xff7a2a : 0x7dffc9 }));
    } else {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, sh.plasma ? 0.4 : 0.7, 5), M(0x8a7a5a));
      m.rotation.x = Math.PI / 2;
    }
    m.position.copy(from);
    group.add(m);
    shots.push({ m, vel: dir, t: 0, dmg: sh.dmg, grav: sh.grav || 0, glow: sh.fire || sh.plasma });
    return true;
  }

  function scheduleAttack(e) {
    const schedule = createBurstSchedule({
      requestedShots: e.spec.shoot?.burst || 1,
      intervalMs: 120,
      maxShots: 4,
      maxDurationMs: 420,
    });
    const cap = runtimeCaps.bursts;
    for (const delay of schedule) {
      if (bursts.length >= cap) break;
      bursts.push({ e, due: simTime + delay / 1000 });
    }
  }

  function removeEnemy(index) {
    const e = E[index];
    if (!e) return;
    bursts.splice(0, bursts.length, ...bursts.filter(job => job.e !== e));
    releaseVisual(e);
    group.remove(e.g);
    E.splice(index, 1);
    S.alive = Math.max(0, S.alive - 1);
  }

  function clearRuntime() {
    bursts.length = 0;
    for (let index = shots.length - 1; index >= 0; index--) removeShot(index);
    for (let index = E.length - 1; index >= 0; index--) removeEnemy(index);
    S.queue.length = 0;
    S.alive = 0;
    S.spawnAcc = 0;
    refreshTelemetry();
  }

  function clearModelCache() {
    for (const entry of modelCache.values()) {
      if (entry?.status === 'ready') disposeTree(entry.value.scene);
    }
    modelCache.clear();
  }

  function startPreload() {
    const token = session;
    S.phase = 'loading';
    S.countdown = 2;
    const selectedLods = S.types.flatMap(type => ['lod1', 'lod2'].map(lod => loadModel(type, lod)));
    Promise.allSettled(selectedLods).then(() => {
      if (!S.on || disposed || token !== session || S.phase !== 'loading') return;
      S.phase = 'countdown';
      S.countdown = 3;
    });
  }

  function refreshTelemetry() {
    const source = { glb: 0, procedural: 0 };
    const lod = { full: 0, lod1: 0, lod2: 0 };
    const ai = Object.fromEntries(AI_STATES.map(state => [state, 0]));
    const activeByType = {};
    for (const e of E) {
      source[e.modelSource]++;
      if (e.lod) lod[e.lod]++;
      ai[e.state] = (ai[e.state] || 0) + 1;
      activeByType[e.type] = (activeByType[e.type] || 0) + 1;
    }
    S.telemetry.modelSource = source;
    S.telemetry.lod = lod;
    S.telemetry.ai = ai;
    S.telemetry.activeByType = activeByType;
    S.telemetry.projectiles = shots.length;
    S.telemetry.scheduledShots = bursts.length;
    S.telemetry.caps = runtimeCaps;
    S.telemetry.runtimeCounts = {
      enemies: E.length,
      shots: shots.length,
      bursts: bursts.length,
      modelCache: modelCache.size,
    };
    S.telemetry.withinCaps = Object.entries(S.telemetry.runtimeCounts)
      .every(([key, value]) => value <= runtimeCaps[key]);
  }

  return {
    state: S,
    hittables: E,
    setTypes(list) { if (list.length) S.types = list; },
    toggle(dronePos, types, difficulty = 'media') {
      S.on = !S.on;
      session++;
      if (S.on) {
        if (types?.length) S.types = types.filter(type => ENEMIES[type]);
        if (!S.types.length) S.types = ['zombie'];
        runtimeCaps = getInvasionRuntimeCaps(deviceTier, S.types.length);
        S.difficulty = DIFFICULTY[difficulty] ? difficulty : 'media';
        S.wave = 0;
        S.killed = 0;
        S.score = 0;
        S.combo = 0;
        S.queue = [];
        S.spawnAcc = 0;
        S.telemetry.spawnFailures = 0;
        S.telemetry.fallbackTotal = 0;
        S.telemetry.fallbackByType = {};
        S.telemetry.loadRejected = 0;
        S.telemetry.preload = { requested: 0, ready: 0, failed: 0 };
        startPreload();
      } else {
        S.phase = 'idle';
        S.countdown = 0;
        clearRuntime();
        clearModelCache();
      }
      return S.on;
    },
    update(dt, dronePos, droneVelocity) {
      if (!S.on) return;
      const step = Math.min(0.05, Math.max(0, dt));
      simTime += step;
      if (S.combo && simTime - (S.lastKillAt || 0) > 4) S.combo = 0;
      if (S.phase === 'loading') {
        S.countdown -= step;
        if (S.countdown <= 0) {
          S.phase = 'countdown';
          S.countdown = 3;
        }
      } else if (S.phase === 'countdown') {
        S.countdown -= step;
        if (S.countdown <= 0) {
          S.wave++;
          S.queue = capWaveQueue({
            types: S.types,
            wave: S.wave,
            tier: deviceTier,
            difficulty: S.difficulty,
            seed: session * 1009 + S.wave * 9176,
          });
          S.phase = 'running';
          S.countdown = 0;
        }
      } else if (S.phase === 'running' && S.alive === 0 && S.queue.length === 0 && bursts.length === 0) {
        S.phase = 'countdown';
        S.countdown = 3;
      }
      if (S.queue.length) {
        S.spawnAcc += step;
        if (S.spawnAcc > 0.35) {
          S.spawnAcc = 0;
          const spawned = spawnOne(S.queue[0], dronePos);
          S.queue.shift();
          if (!spawned) S.telemetry.spawnFailures++;
        }
      }
      S._lodAcc = (S._lodAcc || 0) + step;
      if (S._lodAcc >= 0.5) {
        S._lodAcc = 0;
        let nearUsed = 0;
        const ranked = E.filter(e => !e.g.userData.dead)
          .sort((a, b) => a.g.position.distanceToSquared(dronePos) - b.g.position.distanceToSquared(dronePos));
        for (const e of ranked) {
          const distance = e.g.position.distanceTo(dronePos);
          const lod = selectEnemyLod(e.type, distance, deviceTier, { nearUsed });
          if (lod === 'full') nearUsed++;
          swapVisual(e, lod);
        }
      }

      // Mixers advance exactly once per frame, including death playback.
      for (let i = E.length - 1; i >= 0; i--) {
        const e = E[i];
        const p = e.g.position;
        e.stateTime += step;
        e.phase += step * (e.spec.fly ? 2 : e.speed * 3.2);
        e.mixer?.update(step);
        e.center.set(p.x, p.y + (e.yOff ?? e.spec.y), p.z);

        if (e.g.userData.dead) {
          if (e.state !== 'dead') {
            e.state = 'dead';
            e.stateTime = 0;
            e.act?.move?.stop();
            if (e.act?.death) {
              e._deathT = Math.max(0.25, e.act.death.getClip().duration);
              e.act.death.reset().play();
            } else {
              e._deathT = 0.15;
            }
          }
          e._deathT -= step;
          if (e._deathT <= 0) {
            if (!e.blood) fx?.explode?.(e.center.clone(), e.type === 'dragon' ? 1.6 : 0.9);
            const chained = S.lastKillAt != null && simTime - S.lastKillAt <= 4;
            S.combo = chained ? Math.min(12, S.combo + 1) : 1;
            S.lastKillAt = simTime;
            S.score += 100 * S.combo;
            S.killed++;
            removeEnemy(i);
          }
          continue;
        }

        const dx = dronePos.x - p.x;
        const dz = dronePos.z - p.z;
        const dist = Math.hypot(dx, dz);
        e.cool = Math.max(0, e.cool - step);
        const previous = e.state;
        const next = nextEnemyState({
          state: previous,
          timeInState: e.stateTime,
          distance: dist,
          dead: false,
          air: !!e.spec.fly,
          ranged: !!e.spec.shoot,
          blocked: e.blocked,
          attackReady: e.cool <= 0,
          band: e.spec.shoot?.band,
          attackDistance: e.spec.attackDistance || e.spec.melee || 80,
          spawnDuration: 0.5,
          windup: e.spec.fly ? (e.spec.fly === 'pass' ? 1.8 : 0.55) : 0.45,
          maxAttackDuration: e.spec.fly === 'pass' ? 1.8 : 0.55,
          disengageDistance: e.spec.fly === 'pass' ? 145 : 120,
          recoverDuration: 0.75,
          evadeDuration: 0.6,
        });
        if (next !== previous) {
          e.state = next;
          e.stateTime = 0;
          if (next === 'attack') {
            e.act?.attack?.reset().play();
            if (!e.act?.attack && e.anim.aR) e.anim.aR.rotation.x = 2.2;
            if (e.spec.fly === 'pass') e.passDir = dronePos.clone().sub(p).setY(0).normalize();
          }
          if (previous === 'attack') {
            const cadence = DIFFICULTY[S.difficulty].cadence;
            if (e.spec.shoot) scheduleAttack(e);
            if (e.spec.melee && dist <= e.spec.melee
                && Math.abs(dronePos.y - p.y - e.spec.y) < e.spec.melee * 1.4) {
              onHit?.(e.spec.dmg);
            }
            e.cool = (e.spec.shoot?.every || 0.8) * cadence * (0.9 + Math.random() * 0.2);
          }
        }

        if (e.spec.fly) {
          const toward = dronePos.clone().sub(p);
          const away = p.clone().sub(dronePos).normalize();
          if (e.state === 'pursue') {
            p.addScaledVector(toward.normalize(), e.speed * step);
          } else if (e.state === 'orbit' || e.state === 'strafe') {
            const tangent = new THREE.Vector3(-dz, 0, dx).normalize();
            p.addScaledVector(tangent, e.speed * step);
            p.addScaledVector(toward.normalize(), Math.sign(dist - 62) * e.speed * step * 0.35);
          } else if (e.state === 'attack') {
            const attackDir = e.passDir || toward.normalize();
            p.addScaledVector(attackDir, e.speed * step);
          } else if (e.state === 'evade' || e.state === 'recover') {
            p.addScaledVector(away, e.speed * step * (e.state === 'evade' ? 1.15 : 0.65));
          }
          p.y += ((dronePos.y + (e.spec.fly === 'pass' ? 12 : 7)
            + Math.sin(e.phase) * 2) - p.y) * step * 0.7;
          if (toward.lengthSq() > 0.001) {
            e.g.lookAt(dronePos);
            e.g.rotateY(Math.PI);
          }
          if (e.spec.fly === 'pass') e.g.rotation.z = Math.sin(e.phase * 0.7) * 0.12;
          if (!e.mixer && e.anim.ring) e.anim.ring.rotation.z += step * 3;
          if (!e.mixer && e.anim.wL) {
            e.anim.wL.rotation.z = 0.5 + Math.sin(e.phase * 3) * 0.5;
            e.anim.wR.rotation.z = -0.5 - Math.sin(e.phase * 3) * 0.5;
            e.anim.segs.forEach((segment, index) => {
              segment.position.y = Math.sin(e.phase * 1.6 - index * 0.7) * 0.25;
            });
          }
        } else if (!['spawn', 'attack', 'recover'].includes(e.state)) {
          let target = { x: dronePos.x, z: dronePos.z };
          if (e.state === 'evade') target = { x: p.x - dx, z: p.z - dz };
          if (e.state === 'strafe') {
            const side = e.seed % 2 ? 1 : -1;
            target = { x: dronePos.x - dz * side, z: dronePos.z + dx * side };
          }
          const neighbors = E.filter(other => other !== e && !other.spec.fly && !other.g.userData.dead)
            .map(other => ({ x: other.g.position.x, z: other.g.position.z }));
          const steering = steerGroundEnemy({
            position: { x: p.x, z: p.z },
            target,
            speed: e.speed,
            dt: step,
            seed: e.seed + Math.floor(simTime * 4),
            neighbors,
            separationRadius: Math.max(3, e.spec.foot || 2.2),
            isWalkable: (x, z) => walkable(
              heightAt, x, z, e.spec.slope || 4.5, e.spec.foot || 2.2,
            ) != null,
          });
          e.blocked = steering.blocked;
          if (steering.moved) {
            p.x = steering.position.x;
            p.z = steering.position.z;
            const groundY = walkable(
              heightAt, p.x, p.z, e.spec.slope || 4.5, e.spec.foot || 2.2,
            );
            if (groundY != null) p.y += (groundY - p.y) * Math.min(1, step * 8);
            e.g.rotation.y = steering.heading + Math.PI;
          }
          if (!e.mixer && e.anim.lL) {
            e.anim.lL.rotation.x = Math.sin(e.phase) * 0.6;
            e.anim.lR.rotation.x = -Math.sin(e.phase) * 0.6;
            e.anim.torso.rotation.z = Math.sin(e.phase * 0.5) * 0.06;
          }
        }
        e.center.set(p.x, p.y + (e.yOff ?? e.spec.y), p.z);
      }

      for (let index = bursts.length - 1; index >= 0; index--) {
        const job = bursts[index];
        if (job.due > simTime) continue;
        bursts.splice(index, 1);
        if (!job.e.g.userData.dead) shootAt(job.e, dronePos, droneVelocity);
      }
      // ── proyectiles enemigos ──
      for (let i = shots.length - 1; i >= 0; i--) {
        const s2 = shots[i];
        s2.t += step;
        s2.vel.y -= s2.grav * step;
        s2.m.position.addScaledVector(s2.vel, step);
        if (!s2.glow) s2.m.lookAt(s2.m.position.clone().add(s2.vel));
        let dead = s2.t > 7;
        if (s2.m.position.distanceTo(dronePos) < 1.8) {
          onHit?.(s2.dmg);
          dead = true;
        }
        const gy = heightAt(s2.m.position.x, s2.m.position.z);
        if (gy != null && s2.m.position.y <= gy + 0.2) {
          if (s2.glow) fx?.impact?.(s2.m.position.clone());
          dead = true;
        }
        if (dead) removeShot(i);
      }
      refreshTelemetry();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      session++;
      S.on = false;
      S.phase = 'idle';
      clearRuntime();
      clearModelCache();
      scene.remove(group);
    },
  };
}
