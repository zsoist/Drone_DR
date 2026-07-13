// flightverse/invasion.js — MODO INVASIÓN: enemigos ORIGINALES procedurales
// (cero assets de terceros). Tipos: zombies, arqueros (flechas en arco),
// soldados (ráfagas), OVNIs (plasma), aviones (pasadas), dragón (bolas de
// fuego) y gigantes (cuerpo a cuerpo). Los terrestres SOLO pisan suelo
// caminable (pendiente <4.5m, altura suavizada — sin escalones); los aéreos
// vuelan con sus propios patrones. Todos son hittables del armamento.
import * as THREE from '/flightverse/three.js?v=160';

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
  zombie:  { build: () => bZombie(false), hp: 100, speed: 1.6, r2: 1.7, y: 1.15, dmg: 8,  melee: 2.2 },
  arquero: { build: () => bZombie(true),  hp: 90,  speed: 1.2, r2: 1.7, y: 1.15, shoot: { every: 3.2, speed: 26, dmg: 6, grav: 9, range: 90 } },
  soldado: { build: bSoldado,             hp: 120, speed: 3.2, r2: 1.7, y: 1.2,  shoot: { every: 2.4, speed: 46, dmg: 3, grav: 0, range: 110, burst: 3 } },
  ufo:     { build: bUfo,                 hp: 240, speed: 7,   r2: 4.5, y: 0,    fly: 'orbit', shoot: { every: 4, speed: 20, dmg: 10, grav: 0, range: 140, plasma: true } },
  avion:   { build: bAvion,               hp: 140, speed: 34,  r2: 6,   y: 0,    fly: 'pass' },
  dragon:  { build: bDragon,              hp: 700, speed: 9,   r2: 6,   y: 0,    fly: 'serp', shoot: { every: 4.5, speed: 17, dmg: 15, grav: 2, range: 150, fire: true } },
  gigante: { build: bGigante,             hp: 1600, speed: 2.1, r2: 14, y: 8.8,  dmg: 22, melee: 7, slope: 6, foot: 5 },
};

// ── GLBs externos de enemigos (assets/enemies/<tipo>.glb + manifest.json) ──
// Contrato en docs/ENEMY_MODEL_SPEC.md: metros reales, -Z al frente, origen en
// los pies (terrestres) o centro (voladores), AnimationClips 'walk'/'fly'/
// 'attack'/'idle'. Sin GLB: constructor procedural (fallback honesto).
let GLTFLoader = null, SkelUtils = null, enemyManifest = null;
const glbCache = {};
async function preloadEnemyGlb(type, v) {
  try {
    if (!enemyManifest) {
      enemyManifest = await (await fetch(`/assets/enemies/manifest.json?v=${v}`, { cache: 'no-store' })).json();
    }
    if (!enemyManifest[type] || glbCache[type]) return;
    if (!GLTFLoader) ({ GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=160'));
    if (!SkelUtils) SkelUtils = await import('/vendor/three-addons180/utils/SkeletonUtils.js?v=160');
    const g = await new GLTFLoader().loadAsync(`/assets/enemies/${type}.glb?v=160`);
    glbCache[type] = { scene: g.scene, clips: g.animations || [] };
  } catch { /* GLB opcional: el procedural sigue siendo la verdad */ }
}

export function createInvasion(scene, { heightAt, audio, onHit, fx } = {}) {
  const group = new THREE.Group(); group.name = 'fv-invasion'; scene.add(group);
  const E = [], shots = [];
  const S = { on: false, wave: 0, alive: 0, killed: 0, spawnAcc: 0, betweenWaves: 0,
    queue: [], types: ['zombie'] };

  function spawnOne(type, around) {
    const spec = SPECS[type];
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
      let g, anim, mixer = null, act = null, y2 = spec.y, r2 = spec.r2;
      const cached = glbCache[type];
      if (cached) {
        g = SkelUtils.clone(cached.scene);
        anim = {};
        if (cached.clips.length) {
          mixer = new THREE.AnimationMixer(g);
          const byName = n => THREE.AnimationClip.findByName(cached.clips, n);
          const move = byName(spec.fly ? 'fly' : 'walk') || byName('idle') || cached.clips[0];
          act = { move: mixer.clipAction(move), attack: null };
          act.move.play();
          const atk = byName('attack');
          if (atk) { act.attack = mixer.clipAction(atk); act.attack.setLoop(THREE.LoopOnce); }
        }
        const bb = new THREE.Box3().setFromObject(g);
        const sz = bb.getSize(new THREE.Vector3());
        y2 = spec.fly ? 0 : sz.y * 0.55;        // voladores: origen = centro (contrato)
        r2 = Math.max(spec.r2, (sz.length() * 0.42) ** 2);
      } else {
        ({ g, anim } = spec.build());
      }
      g.position.set(x, y, z);
      g.traverse(o => { o.castShadow = true; });
      group.add(g);
      E.push({ g, anim, mixer, act, type, spec, enemy: true, blood: ENEMIES[type].blood,
        hp: spec.hp * (1 + S.wave * 0.12), phase: Math.random() * 6.283,
        speed: spec.speed * (1 + S.wave * 0.04), center: new THREE.Vector3(),
        yOff: y2, r2, cool: Math.random() * 3, passDir: null });
      S.alive++;
      return true;
    }
    return false;
  }

  function shootAt(e, dronePos) {
    const sh = e.spec.shoot;
    const from = e.center.clone();
    const dir = dronePos.clone().sub(from);
    const d = dir.length();
    if (d > sh.range) return;
    dir.normalize();
    if (sh.grav) dir.y += (d / sh.speed) * sh.grav * 0.5 / sh.speed;   // compensa arco
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
    shots.push({ m, vel: dir.multiplyScalar(sh.speed), t: 0, dmg: sh.dmg, grav: sh.grav || 0, glow: sh.fire || sh.plasma });
  }

  return {
    state: S,
    hittables: E,
    setTypes(list) { if (list.length) S.types = list; },
    toggle(dronePos, types) {
      S.on = !S.on;
      if (S.on) {
        if (types?.length) S.types = types;
        for (const t of S.types) preloadEnemyGlb(t, 114);   // progresivo: cae al procedural mientras
        S.wave = 0; S.killed = 0; S.betweenWaves = 0.5; S.queue = [];
      } else {
        for (const e of E) group.remove(e.g);
        for (const s2 of shots) group.remove(s2.m);
        E.length = 0; shots.length = 0; S.alive = 0;
      }
      return S.on;
    },
    update(dt, dronePos) {
      if (!S.on) return;
      // oleadas: mezcla de los tipos elegidos
      if (S.alive === 0 && S.queue.length === 0) {
        S.betweenWaves -= dt;
        if (S.betweenWaves <= 0) {
          S.wave++;
          for (const t of S.types) {
            const n = t === 'gigante' ? Math.ceil(S.wave / 2)
              : t === 'dragon' ? 1
              : t === 'ufo' || t === 'avion' ? 1 + Math.floor(S.wave / 2)
              : 3 + S.wave * 2;
            for (let i = 0; i < n; i++) S.queue.push(t);
          }
          S.betweenWaves = 3;
        }
      }
      if (S.queue.length) {
        S.spawnAcc += dt;
        if (S.spawnAcc > 0.4) { S.spawnAcc = 0; if (spawnOne(S.queue[0], dronePos)) S.queue.shift(); }
      }
      // ── enemigos ──
      for (let i = E.length - 1; i >= 0; i--) {
        const e = E[i];
        if (e.g.userData.dead) {
          if (!e._deathStarted) {
            e._deathStarted = true;
            const dc = e.mixer && THREE.AnimationClip.findByName(glbCache[e.type]?.clips || [], 'death');
            if (dc) {
              e._deathT = Math.max(0.25, dc.duration);
              e.act?.move?.stop();
              const da = e.mixer.clipAction(dc);
              da.setLoop(THREE.LoopOnce, 1); da.clampWhenFinished = true;
              da.reset().play();
            } else e._deathT = 0;
          }
          if (e.mixer) e.mixer.update(dt);
          e._deathT -= dt;
          if (e._deathT <= 0) {
            if (!e.blood) fx?.explode?.(e.center.clone(), e.type === 'dragon' ? 1.6 : 0.9);
            group.remove(e.g); E.splice(i, 1); S.alive--; S.killed++;
          }
          continue;
        }
        const p = e.g.position;
        const dx = dronePos.x - p.x, dz = dronePos.z - p.z;
        const dist = Math.hypot(dx, dz);
        e.phase += dt * (e.spec.fly ? 2 : e.speed * 3.2);
        if (e.mixer) e.mixer.update(dt);
        if (e.spec.fly === 'orbit') {
          // OVNI: orbita cerrando círculos, bobbing
          const ang = Math.atan2(p.z - dronePos.z, p.x - dronePos.x) + dt * e.speed / Math.max(14, dist);
          const r = Math.max(16, dist - dt * 2.5);
          p.x = dronePos.x + Math.cos(ang) * r;
          p.z = dronePos.z + Math.sin(ang) * r;
          p.y += ((dronePos.y + 6 + Math.sin(e.phase) * 3) - p.y) * dt;
          if (!e.mixer && e.anim.ring) e.anim.ring.rotation.z += dt * 3;
        } else if (e.spec.fly === 'pass') {
          // avión: pasadas rectas, re-entra al alejarse
          if (!e.passDir || dist > 220) {
            e.passDir = dronePos.clone().sub(p).setY(0).normalize();
            e.g.lookAt(p.clone().add(e.passDir));
            e.g.rotateY(Math.PI);                  // frente -Z (lookAt apunta +Z)
          }
          p.addScaledVector(e.passDir, e.speed * dt);
          p.y += ((dronePos.y + 12) - p.y) * dt * 0.5;
          e.g.rotation.z = Math.sin(e.phase * 0.7) * 0.12;
        } else if (e.spec.fly === 'serp') {
          // dragón: persigue serpenteando, alas baten
          const dir = dronePos.clone().sub(p);
          dir.y += 4;
          dir.normalize();
          p.addScaledVector(dir, e.speed * dt);
          p.x += Math.sin(e.phase * 1.7) * dt * 6;
          p.y += Math.cos(e.phase * 1.3) * dt * 3;
          e.g.lookAt(dronePos);
          e.g.rotateY(Math.PI);                    // frente -Z (lookAt apunta +Z)
          if (!e.mixer && e.anim.wL) {
            e.anim.wL.rotation.z = 0.5 + Math.sin(e.phase * 3) * 0.5;
            e.anim.wR.rotation.z = -0.5 - Math.sin(e.phase * 3) * 0.5;
            e.anim.segs.forEach((s2, j) => { s2.position.y = Math.sin(e.phase * 1.6 - j * 0.7) * 0.25; });
          }
        } else {
          // terrestres: caminar hacia el dron por suelo caminable SUAVIZADO
          if (dist > (e.spec.melee || 2)) {
            const nx = p.x + (dx / dist) * e.speed * dt;
            const nz = p.z + (dz / dist) * e.speed * dt;
            const gy = walkable(heightAt, nx, nz, e.spec.slope || 4.5, e.spec.foot || 2.2);
            if (gy != null) {
              p.x = nx; p.z = nz;
              p.y += (gy - p.y) * Math.min(1, dt * 8);   // sin escalones
            }
            e.g.rotation.y = Math.atan2(dx, dz) + Math.PI;   // frente -Z al objetivo
          }
          if (!e.mixer && e.anim.lL) {
            e.anim.lL.rotation.x = Math.sin(e.phase) * 0.6;
            e.anim.lR.rotation.x = -Math.sin(e.phase) * 0.6;
            e.anim.torso.rotation.z = Math.sin(e.phase * 0.5) * 0.06;
          }
          // melee
          if (e.spec.melee && dist < e.spec.melee && Math.abs(dronePos.y - p.y - e.spec.y) < e.spec.melee * 1.4) {
            e._bite = (e._bite || 0) + dt;
            if (e._bite > 0.8) {
              e._bite = 0;
              onHit?.(e.spec.dmg);
              if (e.act?.attack) e.act.attack.reset().play();          // clip real
              else if (e.anim.aR) e.anim.aR.rotation.x = 2.2;          // manotazo
            }
          }
        }
        e.center.set(p.x, p.y + (e.yOff ?? e.spec.y), p.z);
        // disparos enemigos
        if (e.spec.shoot) {
          e.cool -= dt;
          if (e.cool <= 0) {
            e.cool = e.spec.shoot.every * (0.8 + Math.random() * 0.4);
            if (e.act?.attack) e.act.attack.reset().play();
            const n = e.spec.shoot.burst || 1;
            for (let b = 0; b < n; b++) setTimeout(() => !e.g.userData.dead && shootAt(e, dronePos), b * 120);
          }
        }
      }
      // ── proyectiles enemigos ──
      for (let i = shots.length - 1; i >= 0; i--) {
        const s2 = shots[i];
        s2.t += dt;
        s2.vel.y -= s2.grav * dt;
        s2.m.position.addScaledVector(s2.vel, dt);
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
        if (dead) { group.remove(s2.m); shots.splice(i, 1); }
      }
    },
    dispose() { scene.remove(group); },
  };
}
