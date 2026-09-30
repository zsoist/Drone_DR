// flightverse/weapons.js — armamento v2: misiles con balística y roll, estela
// fina, explosiones multicapa con técnicas de VFX de motor (texturas suaves en
// Points — no cuadrados —, streaks de chispa estirados por velocidad, rampas
// de color sobre vida, rotación de sprites), CRÁTERES reales en el terreno,
// escombros PERSISTENTES que se congelan al asentarse, y fuegos residuales.
// HONESTO: la fotogrametría es un escaneo real — recibe cráter/scorch/
// metralla en el terreno de juego; lo destruible son objetos de juego.
// Todo procedural (canvas + primitivas), pools con tope, cero assets.
import * as THREE from '/flightverse/three.js?v=369';
import {
  earliestHit,
  normalizeTargetRadius,
  segmentSphereHit,
} from '/flightverse/collision-math.js?v=369';
import {
  EffectPool,
  ballisticStep,
  disposeOwnedRenderObject,
  impactTransform,
  projectileDirection,
} from '/flightverse/aiming.js?v=369';
import {
  WEAPON_FAMILY,
  WEAPON_FX,
  WEAPON_PROFILES,
  advanceLaunchSchedules,
  createLaunchSchedule,
  explosionClass,
  isGuidanceTargetVisible,
  misilProfileKey,
  steerVector,
  usesHeat,
} from '/flightverse/weapon-registry.js?v=369';
import { createFxSystem } from '/flightverse/fx/fx-system.js?v=369';
import { createProjectileModels, PROJECTILE_LENGTH } from '/flightverse/fx/projectile-models.js?v=369';
import { surfaceOf } from '/flightverse/fx/surface.js?v=369';
import { hitStopFor } from '/flightverse/fx/hitstop.js?v=369';
import {
  createWeaponEffects,
  radialDamage,
} from '/flightverse/weapon-effects.js?v=369';

function glowTex(stops, size = 64) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2 - 1);
  for (const [p, col] of stops) g.addColorStop(p, col);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

// humo con ESTRUCTURA interna (lóbulos superpuestos, no un blob plano):
// la diferencia entre 'disco negro' y nube — técnica estándar de VFX cuando
// no hay flipbook: silueta irregular + densidad variable dentro
function puffTex(size = 192) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const R = size / 2;
  for (let i = 0; i < 42; i++) {
    const a2 = Math.random() * 6.283, rr = Math.random() * R * 0.52;
    const x = R + Math.cos(a2) * rr, y = R + Math.sin(a2) * rr;
    const r2 = R * (0.16 + Math.random() * 0.3) * (1 - rr / R * 0.5);
    const al = 0.05 + Math.random() * 0.09;
    const g = c.createRadialGradient(x, y, 1, x, y, r2);
    g.addColorStop(0, `rgba(255,255,255,${al})`);
    g.addColorStop(0.65, `rgba(255,255,255,${al * 0.5})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);
  }
  return new THREE.CanvasTexture(cv);
}

export const ARSENAL = WEAPON_PROFILES;

// eyecta con FRAGMENTOS REALES del destruction kit (debris_pack.glb: 16
// chunks PBR de concreto/ladrillo). Clonar comparte geometría/material —
// barato. Sin el GLB (o mientras carga): cajas procedurales (fallback).
let debrisFrags = null;
(async () => {
  try {
    const { GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=369');
    const g = await new GLTFLoader().loadAsync('/assets/destruction/models/debris_pack.glb');
    const frags = [];
    g.scene.traverse(n => { if (n.isMesh && n.userData.role === 'fragment') frags.push(n); });
    if (frags.length) debrisFrags = frags;
  } catch { /* opcional */ }
})();

export function createWeapons(scene, {
  world,
  heightAt,
  audio,
  onShake,
  crater,
  getCameraPosition,
  onDestroy,
  cloneProjectile,
  useDebrisModels = true,
  effectTier = 'desktop',
  // ?fv=2: pooled instanced FX, thin tracers, rocket models, charge, heat, events (see fx/index.js)
  fv2 = false,
  events = null,
  reduced = () => false,
  getMuzzle = null,
  getAim = null,
  cameraRef = null,
  viewportHeight = null,
} = {}) {
  const V2 = !!fv2;
  const TEX = {
    fire: glowTex([[0, 'rgba(255,244,200,1)'], [0.25, 'rgba(255,150,40,.9)'], [0.6, 'rgba(200,60,10,.45)'], [1, 'rgba(120,20,0,0)']], 128),
    smoke: glowTex([[0, 'rgba(72,68,64,.5)'], [0.5, 'rgba(58,55,52,.28)'], [1, 'rgba(44,42,40,0)']]),
    flash: glowTex([[0, 'rgba(255,255,240,1)'], [0.4, 'rgba(255,220,120,.6)'], [1, 'rgba(255,180,60,0)']]),
    puff: glowTex([[0, 'rgba(215,210,202,.4)'], [1, 'rgba(195,190,184,0)']]),
    dot: glowTex([[0, 'rgba(255,225,170,1)'], [0.5, 'rgba(255,170,80,.8)'], [1, 'rgba(255,120,40,0)']], 32),
    puff3d: puffTex(),
    scorch: glowTex([[0, 'rgba(8,6,4,.85)'], [0.55, 'rgba(12,10,8,.5)'], [1, 'rgba(14,12,10,0)']], 96),
    blood: glowTex([[0, 'rgba(150,20,24,.95)'], [0.5, 'rgba(110,10,14,.6)'], [1, 'rgba(80,6,10,0)']], 48),
  };
  const S = { missiles: [], bullets: [], schedules: [], parts: [], decals: [], frags: [], rubble: [], fires: [], booms: [],
    weapon: 'm', cool: 0, fired: 0, exploded: 0, destroyed: 0,
    // ?fv=2 extras: heat (MG/AC), charge queue (RAIL/NOVA), hit/kill counters, last hittables
    heat: { mg: 0, ac: 0 }, overheat: 0, charges: [], burst: 0, burstT: 0, hits: 0, kills: 0,
    charge: null, lastHittables: [], lastMuzzle: null,
    structureHits: 0, terrainHits: 0, boundaryHits: 0, itemHits: 0, targetHits: 0,
    railHits: 0,
    proximityTriggers: 0, occludedFuses: 0,
    firedProjectiles: Object.fromEntries(
      Object.keys(WEAPON_PROFILES).map(key => [key, 0]),
    ),
    impactEvidence: null,
    lod: { near: 0, far: 0 },
    effectCounters: {},
    resources: { disposed: 0 },
    disposed: false,
    ammo: Object.fromEntries(
      Object.entries(WEAPON_PROFILES).map(([key, profile]) => [key, profile.max]),
    ) };
  const group = new THREE.Group(); group.name = 'fv-weapons'; scene.add(group);
  const fxs = V2 ? createFxSystem({
    THREE,
    parent: group,
    tier: effectTier === 'phone' ? 'low' : effectTier === 'tablet' ? 'mid' : 'high',
    heightAt,
    reduced,
  }) : null;
  const projectileModels = V2 ? createProjectileModels(THREE) : null;
  const effects = V2
    ? {
      emitImpact: () => 0,
      emitTrail: () => 0,
      update: () => {},
      snapshot: () => fxs.snapshot(),
      dispose: () => {},
    }
    : createWeaponEffects(group, {
      tier: effectTier,
      textures: TEX,
      heightAt,
      THREE,
    });

  const effectPools = Object.fromEntries([
    ['muzzle', 18], ['tracer', 72], ['exhaust', 48], ['smoke', 96],
    ['spark', 96], ['dust', 56], ['fire', 42], ['fragment', 80],
    ['decal', 24], ['crater', 12], ['rubble', 120],
  ].map(([kind, limit]) => [kind, new EffectPool(limit)]));
  const syncEffectCounters = () => {
    for (const [kind, pool] of Object.entries(effectPools)) S.effectCounters[kind] = pool.counters;
  };
  const removeObject = object => object?.parent?.remove?.(object);
  const disposeObject = (object, options) => {
    if (disposeOwnedRenderObject(object, options)) S.resources.disposed += 1;
  };
  const disposeEffect = entry => {
    if (!entry || entry.disposed) return false;
    entry.disposed = true;
    entry.cleanup?.();
    return true;
  };
  const poolEffect = (kind, entry, remove) => {
    const pool = effectPools[kind] || effectPools.spark;
    entry.effectKind = kind;
    entry.cleanup = remove;
    entry.onEvict = () => {
      entry.evicted = true;
      disposeEffect(entry);
    };
    pool.add(entry);
    syncEffectCounters();
    return entry;
  };
  const releaseEffect = (entry, { dispose = true } = {}) => {
    if (dispose) disposeEffect(entry);
    if (entry?.effectKind) effectPools[entry.effectKind]?.release(entry);
    syncEffectCounters();
  };
  syncEffectCounters();

  const missileGeo = new THREE.CylinderGeometry(0.045, 0.065, 0.58, 6);
  missileGeo.rotateX(Math.PI / 2);
  const missileNearGeo = new THREE.CylinderGeometry(0.052, 0.072, 0.64, 12);
  missileNearGeo.rotateX(Math.PI / 2);
  const missileMat = new THREE.MeshLambertMaterial({ color: 0x39404b, emissive: 0x0d0f13 });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  const finGeo = new THREE.BoxGeometry(0.24, 0.012, 0.1);

  const sprite = (tex, blending = THREE.AdditiveBlending) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, blending, rotation: Math.random() * 6.28 }));
    group.add(sp);
    return sp;
  };
  // partícula sprite: vida, velocidad, crecimiento, giro y rampa de color
  const emit = (tex, pos, vel, size0, size1, life, blending, o = {}) => {
    if (S.parts.length > 460) return null;     // tope de seguridad (drawcalls)
    const sp = sprite(tex, blending);
    sp.position.copy(pos);
    if (o.tint0) sp.material.color.set(o.tint0);
    const part = { sp, vel, t: 0, life, size0, size1,
      rot: (Math.random() - 0.5) * (o.spin ?? 1.6),
      tint0: o.tint0 && new THREE.Color(o.tint0), tint1: o.tint1 && new THREE.Color(o.tint1),
      drag: o.drag ?? 1.6, rise: o.rise ?? 0, tall: o.tall ?? 1, smoke: !!o.smoke };
    S.parts.push(poolEffect(o.effect || (o.smoke ? 'smoke' : 'spark'), part,
      () => disposeObject(sp, { geometry: false })));
    return part;
  };

  // Pool fijo de luces de explosión: añadir/quitar PointLights cambia el nº de luces
  // del shader y fuerza recompilaciones, así que se reutilizan (intensidad 0 = libre).
  const BLAST_LIGHTS = 4;
  const blastLights = [];
  let blastCursor = 0;
  function acquireBlastLight() {
    let slot = blastLights.find(sl => !sl.token);
    if (!slot && blastLights.length < BLAST_LIGHTS) {
      const light = new THREE.PointLight(0xffb066, 0, 85, 1.8);
      group.add(light);
      slot = { light, token: null };
      blastLights.push(slot);
    }
    if (!slot) slot = blastLights[blastCursor++ % blastLights.length];   // robar la más antigua
    return slot;
  }

  function fireAftermath(p) {                 // fuego residual que arde y muere
    if (S.fires.length >= 3) {
      const old = S.fires.shift();
      releaseEffect(old);
    }
    const light = new THREE.PointLight(0xff7a30, 14, 26, 2);
    light.position.copy(p).y += 1.2;
    group.add(light);
    S.fires.push(poolEffect('fire', { p: p.clone(), t: 0, life: 5.5, acc: 0, light }, () => removeObject(light)));
  }

  function bloodBurst(pos, big = 1) {
    for (let i = 0; i < 8 * big; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6);
      emit(TEX.blood, pos, v, 0.3, 0.9 + Math.random(), 0.4 + Math.random() * 0.3,
        THREE.NormalBlending, { drag: 2, tint0: 0x7a1518 });
    }
  }
  function hitEnemy(h, dmg, pos) {
    h.hp -= dmg;
    let kill = false;
    if (V2) {
      fxs.impact(h.blood ? 'body' : 'energy', { pos: { x: pos.x, y: pos.y, z: pos.z }, normal: { x: 0, y: 1, z: 0 } });
    } else if (h.blood) bloodBurst(pos, 1);
    else emit(TEX.dot, pos, new THREE.Vector3(0, 2, 0), 0.4, 1.1, 0.25, THREE.AdditiveBlending);
    if (h.hp <= 0 && !h.g.userData.dead) {
      h.g.userData.dead = true;
      if (!V2 && h.blood) bloodBurst(pos, 2.2);
      S.destroyed++;
      kill = true;
    }
    return kill;
  }

  // ── ?fv=2 events: hit / kill / hit-stop ──────────────────────────────────
  const fxOf = key => WEAPON_FX[WEAPON_FAMILY[key] || key] || {};
  function emitHit(target, key, damage, nominal, kill, point) {
    if (!V2 || !key) return;
    S.hits += 1;
    if (kill) S.kills += 1;
    const kind = damage <= 0 ? 'deflect' : damage < nominal * 0.4 ? 'graze' : 'full';
    const pos = point ? { x: point.x, y: point.y, z: point.z } : null;
    events?.hit?.({ target, weapon: key, damage, kill, kind, pos });
    audio?.hit?.({ kill, kind, weapon: key, pos });
    const ms = hitStopFor({ weaponFx: fxOf(key), kill, hit: true });
    if (ms) events?.hitstop?.(ms, { kill, weapon: key });
  }

  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();

  function activeTarget(target) {
    if (!target?.center || normalizeTargetRadius(target) <= 0) return false;
    if (target.enemy) return !target.g?.userData?.dead;
    return !target.node?.userData?.dead;
  }

  function targetHit(start, end, target, fuseRadius = 0) {
    const radius = normalizeTargetRadius(target);
    const direct = segmentSphereHit(start, end, target.center, radius);
    let proximity = null;
    if (fuseRadius > 0) {
      const expanded = segmentSphereHit(
        start,
        end,
        target.center,
        radius + fuseRadius,
      );
      if (expanded && (!direct || expanded.fraction < direct.fraction)) {
        const fusePoint = new THREE.Vector3(
          expanded.point.x,
          expanded.point.y,
          expanded.point.z,
        );
        const occluder = world?.castSegment?.(fusePoint, target.center, 0);
        if (occluder && occluder.fraction < 0.999) {
          S.occludedFuses += 1;
        } else {
          proximity = {
            ...expanded,
            kind: 'target',
            target,
            proximity: true,
          };
        }
      }
    }
    const chosen = earliestHit([
      direct && { ...direct, kind: 'target', target, proximity: false },
      proximity,
    ]);
    if (!chosen) return null;
    chosen.point = new THREE.Vector3(
      chosen.point.x,
      chosen.point.y,
      chosen.point.z,
    );
    chosen.normal = new THREE.Vector3(
      chosen.normal.x,
      chosen.normal.y,
      chosen.normal.z,
    );
    return chosen;
  }

  function projectileHit(start, end, radius, hittables, fuseRadius = 0) {
    let worldHit = world?.castSegment?.(start, end, radius) || null;
    const exactTarget = worldHit?.source === 'item'
      ? (hittables || []).find(target => (
        activeTarget(target) && target.node === worldHit.node
      ))
      : null;
    if (exactTarget) {
      worldHit = {
        ...worldHit,
        kind: 'target',
        collisionKind: 'item',
        target: exactTarget,
        proximity: false,
      };
    }
    const hits = [worldHit];
    for (const target of hittables || []) {
      if (!activeTarget(target)) continue;
      hits.push(targetHit(start, end, target, fuseRadius));
    }
    return earliestHit(hits);
  }

  function recordImpact(hit) {
    if (!hit) return;
    if (hit.kind === 'structure') S.structureHits += 1;
    else if (hit.kind === 'terrain') S.terrainHits += 1;
    else if (hit.kind === 'boundary') S.boundaryHits += 1;
    else if (hit.kind === 'target') {
      S.targetHits += 1;
      if (hit.proximity) S.proximityTriggers += 1;
    }
    if (hit.source === 'item') S.itemHits += 1;
  }

  function damageTarget(target, damage, point, missile = false, hit = null, weaponKey = null) {
    const nominal = WEAPON_PROFILES[weaponKey]?.dmg ?? damage;
    if (target.enemy) {
      const kill = hitEnemy(target, damage, point);
      emitHit(target, weaponKey, damage, nominal, kill, point);
      return;
    }
    target.hp = (
      target.hp
      ?? target.node.userData.kit?.health
      ?? 60
    ) - damage;
    const broken = missile || target.hp <= 0;
    if (broken) {
      smash(target.node, target.color, point, hit?.normal);
      if (!missile) explode(hit || { kind: 'target', point, normal: { x: 0, y: 1, z: 0 } }, 0.7, null, { weapon: weaponKey });
    }
    emitHit(target, weaponKey, damage, nominal, broken, point);
  }

  function explodeV2(hitOrPoint, big, profile, meta) {
    S.exploded++;
    const key = meta?.weapon || null;
    const hit = hitOrPoint?.point
      ? hitOrPoint
      : { kind: 'air', point: hitOrPoint, normal: { x: 0, y: 1, z: 0 } };
    const p = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const surface = impactTransform(hit, 0.035);
    const normal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z);
    const terrainImpact = hit.kind === 'terrain';
    const cls = explosionClass(big);
    S.impactEvidence = { kind: hit.kind, point: { ...surface.position }, normal: { ...surface.normal }, size: cls };
    if (terrainImpact && crater && cls !== 'S' && effectPools.crater.entries.length < effectPools.crater.limit) {
      crater(p.x, p.z, 3.4 * big, 1.15 * big);
      poolEffect('crater', { point: p.clone(), t: 0, life: 18 }, null);
    }
    const nominal = cls === 'S' ? 0.6 : cls === 'M' ? 1.3 : 2.8;
    const groundish = hit.kind !== 'air' && hit.kind !== 'target';
    const counts = fxs.explosion(cls, {
      pos: { x: p.x, y: p.y, z: p.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      ground: groundish,
      scale: Math.min(1.35, Math.max(0.7, big / nominal)),
    });
    let damaged = Boolean(meta?.targetHit);
    let kills = 0;
    if (S._enemies) {
      radialDamage({
        origin: p,
        radius: 7 * big,
        maxDamage: 220 * big,
        targets: S._enemies.filter(enemy => !enemy.g.userData.dead),
        castSegment: (start, end, radius) => world?.castSegment?.(start, end, radius),
        applyDamage: (enemy, damage) => {
          const kill = hitEnemy(enemy, damage, enemy.center.clone());
          damaged = true;
          if (kill) kills += 1;
          emitHit(enemy, key, damage, 220 * big, kill, enemy.center);
        },
      });
    }
    if (terrainImpact && cls !== 'S' && S.fires.length < 3) {
      S.fires.push(poolEffect('fire', { p: p.clone(), t: 0, life: cls === 'XL' ? 7 : 3.5, acc: 0, v2: true }, null));
    }
    audio?.explosion?.({ pos: { x: p.x, y: p.y, z: p.z }, size: cls, big, weapon: key });
    onShake?.(p, big, { cls, weapon: key, v2: true });
    events?.explode?.({ pos: p.clone(), size: cls, big, weapon: key, counts });
    const ms = hitStopFor({ weaponFx: fxOf(key), size: cls, kill: kills > 0, hit: damaged, damaged });
    if (ms && kills === 0) events?.hitstop?.(ms, { size: cls, weapon: key });
  }

  function explode(hitOrPoint, big = 1, profile = null, meta = null) {
    if (V2) return explodeV2(hitOrPoint, big, profile, meta);
    S.exploded++;
    const hit = hitOrPoint?.point
      ? hitOrPoint
      : { kind: 'air', point: hitOrPoint, normal: { x: 0, y: 1, z: 0 } };
    const p = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const surface = impactTransform(hit, 0.035);
    const normal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z);
    const terrainImpact = hit.kind === 'terrain';
    S.impactEvidence = {
      kind: hit.kind,
      point: { ...surface.position },
      normal: { ...surface.normal },
    };
    // Terrain.crater mutates the collision heightfield. Unlike visual effects
    // it cannot be safely recycled, so stop at the crater budget instead of
    // pretending FIFO eviction can undo a previous terrain deformation.
    if (terrainImpact && crater && effectPools.crater.entries.length < effectPools.crater.limit) {
      crater(p.x, p.z, 3.4 * big, 1.15 * big);
      poolEffect('crater', { point: p.clone(), t: 0, life: 18 }, null);
    }
    effects.emitImpact({
      profile: profile || {
        effect: big >= 2 ? 'heavy' : 'missile-medium',
        big,
      },
      hit,
      inheritedVelocity: { x: 0, y: 0, z: 0 },
      scale: big,
    });
    // One short-lived light preserves local illumination. All visible smoke,
    // fire, sparks, streaks and flying debris live in five fixed GPU batches.
    const lightSlot = acquireBlastLight();
    const light = lightSlot.light;
    light.color.setHex(0xffb066);
    light.intensity = 150 * big; light.distance = 85 * big;
    light.position.copy(p).addScaledVector(normal, 1.5);
    const lightToken = lightSlot.token = {};
    S.parts.push(poolEffect('fire', { light, t: 0, life: 0.22 }, () => {
      if (lightSlot.token === lightToken) { light.intensity = 0; lightSlot.token = null; }
    }));
    // A handful of bounded persistent chunks settle into world rubble. The
    // visible blowout itself is instanced in weapon-effects.
    for (let i = 0; i < 4; i++) {
      const sz3 = 0.1 + Math.random() * 0.26;
      let m2;
      const sharedDebris = useDebrisModels && debrisFrags;
      const ownsResources = !sharedDebris;
      if (sharedDebris) {
        // fragmento PBR real del kit (geometría/material compartidos)
        m2 = sharedDebris[(Math.random() * sharedDebris.length) | 0].clone();
        m2.scale.setScalar(0.5 + Math.random() * 0.9);
      } else {
        m2 = new THREE.Mesh(new THREE.BoxGeometry(sz3, sz3 * (0.5 + Math.random()), sz3),
          new THREE.MeshLambertMaterial({ color: [0x4a4238, 0x6b5d4a, 0x2e2a24, 0x57503f][i % 4] }));
      }
      m2.position.copy(p).addScaledVector(normal, 0.4);
      m2.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m2.castShadow = true;
      group.add(m2);
      const a3 = Math.random() * 6.283, e3 = 0.5 + Math.random() * 0.9, s3 = (7 + Math.random() * 13) * big;
      const fragment = { m: m2, t: 0,
        vel: normal.clone().multiplyScalar(s3 * 0.65).add(new THREE.Vector3(
          Math.cos(a3) * Math.cos(e3) * s3, Math.sin(e3) * s3, Math.sin(a3) * Math.cos(e3) * s3)),
        rot: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) };
      S.frags.push(poolEffect('fragment', fragment, () => {
        if (ownsResources) disposeObject(m2);
        else removeObject(m2);
      }));
    }
    // scorch persistente
    const sc = new THREE.Mesh(new THREE.CircleGeometry(3.2 * big, 24),
      new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, opacity: 0.8, depthWrite: false }));
    sc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    sc.position.set(surface.position.x, surface.position.y, surface.position.z);
    group.add(sc);
    const decal = poolEffect('decal', { m: sc }, () => disposeObject(sc));
    S.decals.push(decal);
    S.decals = S.decals.filter(entry => !entry.evicted);
    if (S._enemies) {
      radialDamage({
        origin: p,
        radius: 7 * big,
        maxDamage: 220 * big,
        targets: S._enemies.filter(enemy => !enemy.g.userData.dead),
        castSegment: (start, end, radius) => world?.castSegment?.(start, end, radius),
        applyDamage: (enemy, damage) => hitEnemy(enemy, damage, enemy.center.clone()),
      });
    }
    if (terrainImpact) fireAftermath(p.clone());
    audio?.boom?.(big);
    onShake?.(p, big);
  }

  // fragmentación v3: si el objeto trae fragmentos pre-esculpidos (destruction
  // kit: role=fragment con massKg), vuelan ESOS con velocidad ∝ 1/√masa desde
  // el punto de impacto; barriles explosivos encadenan detonación. Fallback:
  // shatter procedural de cajas.
  function smash(node, color, blastP, impactNormal = null) {
    onDestroy?.(node);
    S.destroyed++;
    const kit = node.userData.kit;
    if (kit) {
      const frags = [];
      node.traverse(n => {
        if (n.userData.role === 'fragment') frags.push(n);
        if (n.userData.role === 'intact' || n.userData.role === 'intactMesh' || n.userData.role === 'intactDetail') n.visible = false;
      });
      const c0 = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
      const bp = blastP || c0;
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      for (const f of frags) {
        f.updateWorldMatrix(true, false);
        f.matrixWorld.decompose(wp, wq, ws);
        group.add(f);
        f.position.copy(wp); f.quaternion.copy(wq); f.scale.copy(ws);
        f.visible = true; f.matrixAutoUpdate = true; f.castShadow = true;
        const mass = Math.max(0.5, f.userData.massKg || 8);
        const dir = wp.clone().sub(bp);
        dir.y = Math.abs(dir.y) + 0.4;
        dir.normalize();
        const speed = 3 + 26 / Math.sqrt(mass);
        const fragment = { m: f, t: 0,
          vel: dir.multiplyScalar(speed).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)),
          rot: new THREE.Vector3((Math.random() - 0.5) * 10 / Math.sqrt(mass), (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10 / Math.sqrt(mass)) };
        if (impactNormal) fragment.vel.addScaledVector(impactNormal, speed * 0.7);
        S.frags.push(poolEffect('fragment', fragment, () => removeObject(f)));
      }
      node.userData.dead = true;
      if (kit.explosive) S.booms.push({ p: c0, t: 0.12, big: 1.5 });   // cadena
      return;
    }
    const bb = new THREE.Box3().setFromObject(node);
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    node.visible = false; node.userData.dead = true;
    for (let i = 0; i < 18; i++) {
      const s = 0.12 + Math.random() * 0.24;
      const charred = Math.random() < 0.3;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz.x * s, sz.y * s, sz.z * s),
        new THREE.MeshLambertMaterial({ color: charred ? 0x17140f : (color || 0xE0A458) }));
      m.position.copy(c).add(new THREE.Vector3((Math.random() - 0.5) * sz.x,
        (Math.random() - 0.5) * sz.y, (Math.random() - 0.5) * sz.z));
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      group.add(m);
      const fragment = { m, t: 0,
        vel: new THREE.Vector3((Math.random() - 0.5) * 13, 5 + Math.random() * 10, (Math.random() - 0.5) * 13),
        rot: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) };
      if (impactNormal) fragment.vel.addScaledVector(impactNormal, 8);
      S.frags.push(poolEffect('fragment', fragment, () => disposeObject(m)));
    }
  }

  const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1.4);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const disposeMissile = missile => {
    if (!missile || missile.disposed) return;
    missile.disposed = true;
    removeObject(missile.body);
    disposeObject(missile.glow, { geometry: false });
    for (const geometry of missile.ownedGeometries || []) {
      geometry.dispose();
      S.resources.disposed += 1;
    }
  };
  const disposeWeapons = () => {
    if (S.disposed) return;
    S.disposed = true;
    for (const missile of S.missiles) disposeMissile(missile);
    S.missiles.length = 0;
    S.schedules.length = 0;
    for (const pool of Object.values(effectPools)) {
      for (const entry of [...pool.entries]) disposeEffect(entry);
      pool.entries.length = 0;
    }
    S.bullets.length = 0;
    S.parts.length = 0;
    S.fires.length = 0;
    S.frags.length = 0;
    S.decals.length = 0;
    S.rubble.length = 0;
    for (const resource of [missileGeo, missileNearGeo, finGeo, tracerGeo]) {
      resource.dispose();
      S.resources.disposed += 1;
    }
    for (const material of [missileMat, tipMat, tracerMat]) {
      material.dispose();
      S.resources.disposed += 1;
    }
    effects.dispose();
    fxs?.dispose();
    projectileModels?.dispose();
    for (const texture of Object.values(TEX)) texture.dispose();
    scene.remove(group);
    syncEffectCounters();
  };

  // ── ?fv=2 FPV parallax: when the camera sits at the muzzle (FPV) every projectile would fly down
  // the lens and collapse to a dot. The DRAWN path starts offset (lower-left/right) and converges
  // onto the true path over ~45 m; the simulated path and hit detection are untouched.
  const _offTmp = new THREE.Vector3();
  function fpvOffset(source, side) {
    const cam = cameraRef?.();
    if (!cam || !getCameraPosition || getCameraPosition().distanceTo(source) > 2.2) return null;
    const e = cam.matrixWorld.elements;
    return _offTmp.set(
      e[0] * 0.6 * side - e[4] * 0.42, e[1] * 0.6 * side - e[5] * 0.42, e[2] * 0.6 * side - e[6] * 0.42,
    ).clone();
  }
  const visualFade = (pos, origin) => Math.max(0, 1 - pos.distanceTo(origin) / 45);

  // ── ?fv=2 projectile: rocket/bomb mesh, drop-compensated launch, real gravity ──
  const _lob = new THREE.Vector3();
  function lobVelocity(source, aimPoint, g, vmax = 46) {
    // smallest flight time whose launch speed fits vmax: the bomb lands on the aim point
    const dx = aimPoint.x - source.x; const dy = aimPoint.y - source.y; const dz = aimPoint.z - source.z;
    for (let T = 0.3; T <= 9; T += 0.05) {
      const vx = dx / T; const vz = dz / T; const vy = (dy + 0.5 * g * T * T) / T;
      if (Math.hypot(vx, vy, vz) <= vmax) return _lob.set(vx, vy, vz).clone();
    }
    return null;
  }

  function spawnMissileV2(key, source, direction, aim = null, slot = 0) {
    const profile = ARSENAL[key];
    if (!profile) return null;
    let dir = direction.clone().normalize();
    const aimPoint = aim?.aimPoint || null;
    const gravity = profile.gravity ?? 2.2;
    let launchVel = null;
    if (profile.kind === 'bomb' && aimPoint) {
      launchVel = lobVelocity(source, aimPoint, gravity);
      if (launchVel) dir = launchVel.clone().normalize();
    } else if (profile.kind !== 'bomb' && aimPoint) {
      const d = aimPoint.clone().sub(source);
      const range = d.length();
      if (range > 4 && range < 1200) {
        const tf = (range / profile.speed) * 1.06;   // the motor ramp slows the first metres
        d.y += 0.5 * gravity * tf * tf;
        dir = d.normalize();
      }
    }
    if (key === 'sw') {                               // 6° cone: a rocket wanders within 3° of the aim
      const a = (WEAPON_FX.sw.cone / 2) * Math.sqrt(Math.random());
      const t = Math.random() * Math.PI * 2;
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const upv = new THREE.Vector3().crossVectors(side, dir).normalize();
      dir.addScaledVector(side, Math.cos(t) * Math.tan(a)).addScaledVector(upv, Math.sin(t) * Math.tan(a)).normalize();
    }
    const length = PROJECTILE_LENGTH[key] || 1.5;
    const mesh = new THREE.Mesh(profile.kind === 'bomb' ? projectileModels.bombGeo : projectileModels.rocketGeo, projectileModels.material);
    mesh.scale.setScalar(length);
    const body = new THREE.Group();
    body.add(mesh);
    body.position.copy(source);
    body.lookAt(source.clone().add(dir));
    group.add(body);
    const isBomb = profile.kind === 'bomb';
    const missile = {
      v2: true, body, mesh, glow: null, dir: dir.clone(), full: profile.speed, length, slot,
      pos: source.clone(), origin: source.clone(), off: fpvOffset(source, slot % 2 ? 1 : -1)?.multiplyScalar(0.55) || null,
      vel: launchVel ? launchVel.clone() : dir.clone().multiplyScalar(isBomb ? profile.speed : profile.speed * 0.25),
      fall: 0, gravity, t: 0, trail: 0, big: profile.big,
      radius: profile.radius || 0, proximity: profile.proximity || 0,
      damage: profile.dmg || 900, key, kind: profile.kind, profile,
      guidanceTarget: aim?.target || null,
      guidancePoint: aimPoint?.clone?.() || null,
      homing: key === 'sw' && aim?.target ? 1.3 : 0,
      nearLod: null, farLod: null, ownedGeometries: [],
      weapon: aim?.weaponKey || key,
    };
    S.missiles.push(missile);
    S.firedProjectiles[key] += 1;
    return missile;
  }

  const spawnMissile = (key, source, direction, aim = null) => {
    if (V2) return spawnMissileV2(key, source, direction, aim);
    const profile = ARSENAL[key];
    if (!profile) return null;
    const dir = direction.clone().normalize();
    const body = new THREE.Group();
    const farLod = new THREE.Group();
    const farBody = new THREE.Mesh(missileGeo, missileMat);
    farLod.add(farBody);
    const nearLod = new THREE.Group();
    const mm = new THREE.Mesh(missileNearGeo, missileMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 12), tipMat);
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.38;
    const f1 = new THREE.Mesh(finGeo, missileMat); f1.position.z = 0.27;
    const f2 = f1.clone(); f2.rotation.z = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 6, 12), tipMat);
    band.rotation.x = Math.PI / 2; band.position.z = 0.04;
    nearLod.add(mm, tip, f1, f2, band);
    const glow = sprite(TEX.fire); glow.scale.setScalar(0.55); glow.position.z = 0.44;
    body.add(farLod, nearLod, glow);
    body.position.copy(source);
    body.lookAt(source.clone().add(dir));
    group.add(body);
    const visualScale = key === 'l' ? 1.5
      : key === 's' ? 0.75
        : key === 'sw' ? 0.58
          : key === 'tb' ? 1.55
            : 1;
    body.scale.setScalar(visualScale);
    effects.emitTrail({
      profile,
      position: body.position,
      velocity: dir.clone().multiplyScalar(profile.speed),
      dt: 1 / 60,
    });
    const missile = {
      body, glow, dir: dir.clone(), full: profile.speed,
      vel: dir.clone().multiplyScalar(
        profile.kind === 'bomb' ? profile.speed : profile.speed * 0.25
      ),
      t: 0, trail: 0, big: profile.big,
      radius: profile.radius || 0, proximity: profile.proximity || 0,
      damage: profile.dmg || 900,
      key, kind: profile.kind, profile,
      guidanceTarget: aim?.target || null,
      guidancePoint: aim?.aimPoint?.clone?.() || null,
      nearLod, farLod,
      ownedGeometries: [tip.geometry, band.geometry],
    };
    S.missiles.push(missile);
    S.firedProjectiles[key] += 1;
    const model = cloneProjectile?.(key);
    if (model) {
      Promise.resolve(model).then(node => {
        if (!node || missile.disposed || S.disposed) return;
        node.scale?.setScalar?.(key === 'tb' ? 0.32 : 0.24);
        body.add(node);
        nearLod.visible = false;
        missile.model = node;
      }).catch(() => {});
    }
    audio?.launch?.();
    return missile;
  };

  // RAIL (?fv=2): analytic ray that PIERCES every enemy up to the first structure. Visuals: white
  // core + #8FD3FF edge for 0.25 s, distortion ripples along the line, 1.2 s afterglow.
  const fireRailV2 = (source, direction, profile, aim) => {
    const fx = WEAPON_FX.rg;
    const end = source.clone().addScaledVector(direction, 1200);
    const worldHit = world?.castSegment?.(source, end, 0) || null;
    const hittables = S.lastHittables || [];
    const exact = worldHit?.source === 'item'
      ? hittables.find(t => activeTarget(t) && t.node === worldHit.node) : null;
    const stop = worldHit
      ? new THREE.Vector3(worldHit.point.x, worldHit.point.y, worldHit.point.z) : end.clone();
    const victims = [];
    for (const target of hittables) {
      if (!activeTarget(target)) continue;
      const h = segmentSphereHit(source, stop, target.center, normalizeTargetRadius(target));
      if (h) victims.push({ target, h });
    }
    if (exact && !victims.some(v => v.target === exact)) victims.push({ target: exact, h: { point: stop, normal: worldHit.normal } });
    victims.sort((a, b) => a.h.fraction - b.h.fraction);
    let anyHit = false;
    for (const { target, h } of victims) {
      const pt = new THREE.Vector3(h.point.x, h.point.y, h.point.z);
      recordImpact({ kind: 'target', source: target === exact ? 'item' : undefined, proximity: false });
      damageTarget(target, profile.dmg, pt, false, { ...h, kind: 'target', normal: h.normal }, 'rg');
      anyHit = true;
    }
    if (worldHit) recordImpact(worldHit);
    S.railHits += victims.length + (worldHit ? 1 : 0);
    const len = source.distanceTo(stop);
    const railOff = fpvOffset(source, 1);
    const from = railOff ? source.clone().addScaledVector(railOff, 1.3) : source;   // FPV: the beam sweeps in from the lower right
    const edge = fx.beam.edge || '#8FD3FF';
    const toRgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
    const e = toRgb(edge);
    fxs.beam({ from, to: stop, width: 0.3, life: 0.25, c0: [e[0] * 1.5, e[1] * 1.5, e[2] * 1.5, 0.9], c1: [e[0], e[1], e[2], 0], kind: 'beam-edge', minW: 9 });
    fxs.beam({ from, to: stop, width: fx.beam.width, life: 0.25, c0: [2.8, 2.8, 2.8, 1], c1: [1.4, 1.6, 1.8, 0], kind: 'beam-core', minW: 3.2 });
    fxs.beam({ from, to: stop, width: 0.55, life: 1.2, c0: [e[0] * 0.8, e[1] * 0.8, e[2] * 0.9, 0.22], c1: [e[0] * 0.5, e[1] * 0.6, e[2] * 0.8, 0], kind: 'beam-afterglow', minW: 15 });
    const rings = Math.min(7, Math.max(2, Math.floor(len / 14)));
    for (let j = 1; j <= rings; j += 1) {
      const at = source.clone().addScaledVector(direction, (len * j) / (rings + 1));
      fxs.sink.ring({
        pos: { x: at.x, y: at.y, z: at.z }, normal: { x: direction.x, y: direction.y, z: direction.z },
        r0: 0.15, r1: 1.1 + j * 0.05, life: 0.32, delay: j * 0.018, c0: [0.8, 1.3, 1.8, 0.5], c1: [0.4, 0.8, 1.2, 0], kind: 'ripple',
      });
    }
    const lastHit = worldHit || (victims.length ? victims.at(-1).h : null);
    if (lastHit) {
      const hit = worldHit ? { ...worldHit } : { kind: 'target', point: lastHit.point, normal: lastHit.normal };
      const surface = impactTransform(hit, 0.018);
      S.impactEvidence = { kind: hit.kind, effect: profile.effect, point: surface.position, normal: surface.normal };
      const sp = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
      const nn = { x: surface.normal.x, y: surface.normal.y, z: surface.normal.z };
      fxs.sink.sprite({ pos: sp, vel: { x: 0, y: 0, z: 0 }, size0: 1.2, size1: 2.4, life: 0.12, cell: 'flash', layer: 'add', c0: [2.4, 2.6, 2.8, 1], c1: [0.8, 1.2, 1.8, 0], rot: Math.random() * 6, maxScreen: 0.5, kind: 'flash' });
      fxs.sink.ring({ pos: sp, normal: nn, r0: 0.2, r1: 3, life: 0.3, c0: [1.4, 1.8, 2.2, 0.8], c1: [0.6, 1.0, 1.4, 0], kind: 'shockwave' });
      fxs.impact(surfaceOf(hit), { pos: sp, normal: nn, heavy: true });
      if (worldHit) fxs.spawnDecal({ pos: { x: sp.x + nn.x * 0.04, y: sp.y + nn.y * 0.04, z: sp.z + nn.z * 0.04 }, normal: nn, size: 0.7, life: 8, cell: 'crack', c0: [0.04, 0.04, 0.05, 0.85], rot: Math.random() * 6 });
      audio?.impact?.(surfaceOf(hit), { pos: sp, weapon: 'rg', heavy: true });
      const ms = hitStopFor({ weaponFx: fx, hit: anyHit || Boolean(worldHit) });
      if (ms) events?.hitstop?.(ms, { weapon: 'rg', any: true });
    }
    S.firedProjectiles.rg += 1;
    return true;
  };

  const fireRail = (source, direction, profile, aim) => {
    if (V2) return fireRailV2(source, direction, profile, aim);
    const end = source.clone().addScaledVector(direction, 1200);
    const collision = projectileHit(
      source,
      end,
      // A rail slug is an analytic ray, not a sampled sphere sweep. Keeping
      // this at zero prevents a long 1.2 km shot from stepping over a thin
      // facade between bounded sphere-sweep samples.
      0,
      aim?.target ? [aim.target] : [],
    );
    const point = collision?.point
      ? new THREE.Vector3(collision.point.x, collision.point.y, collision.point.z)
      : end;
    const geometry = new THREE.BufferGeometry().setFromPoints([source, point]);
    const material = new THREE.LineBasicMaterial({
      color: 0xaeeeff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Line(geometry, material);
    group.add(beam);
    S.parts.push(poolEffect('tracer', {
      beam, t: 0, life: 0.12,
    }, () => disposeObject(beam)));
    if (collision) {
      recordImpact(collision);
      S.railHits += 1;
      if (collision.kind === 'target') {
        damageTarget(collision.target, profile.dmg, point.clone(), false, collision, 'rg');
      }
      const surface = impactTransform(collision, 0.018);
      S.impactEvidence = {
        kind: collision.kind,
        effect: profile.effect,
        point: surface.position,
        normal: surface.normal,
      };
      effects.emitImpact({
        profile,
        hit: collision,
        inheritedVelocity: direction.clone().multiplyScalar(profile.speed),
        scale: 0.35,
      });
    }
    S.firedProjectiles.rg += 1;
    audio?.mg?.();
    return true;
  };

  // ── ?fv=2 fire: heat, charge, tracer cadence, muzzle flash, recoil shake ──
  const _dirV2 = new THREE.Vector3();
  function recoil(fxDef, key) {
    const sk = fxDef.shake;
    if (!sk) return;
    let tier = sk.tier; let trauma = sk.trauma;
    if (key === 'ac' && sk.escalateAt && S.burst >= sk.escalateAt) { tier = sk.escalateTier; trauma = sk.escalateTrauma; }
    events?.shake?.({ tier, trauma, pos: null, weapon: key, ceiling: sk.cap === 'T2' ? 0.10 : null });
  }

  function launchCharged(charge) {
    const src = getMuzzle?.() || charge.source;
    const aim = getAim?.() || charge.aim;
    const dir = aim?.aimPoint ? _dirV2.copy(aim.aimPoint).sub(src).normalize().clone() : charge.direction.clone();
    const profile = ARSENAL[charge.key];
    if (profile.kind === 'rail') {
      fireRail(src, dir, profile, aim);
      fxs.muzzle({ pos: src.clone().addScaledVector(dir, 0.6), dir, size: 0.5, life: 0.1, ring: true });
    } else {
      spawnMissileV2(charge.key, src, dir, aim);
      fxs.muzzle({ pos: src.clone().addScaledVector(dir, 0.6), dir, size: 0.4, life: 0.1 });
    }
    audio?.fire?.(charge.key, { phase: 'release' });
    recoil(fxOf(charge.key), charge.key);
  }

  function fireV2(W2, source, direction, aim) {
    const key = S.weapon;
    const fxDef = fxOf(key);
    if (usesHeat(key) && S.overheat > 0) return false;
    if (S.charges.some(c => c.key === key)) return false;
    const hasAim = aim && (aim.aimPoint || aim.point);
    if (W2.kind === 'swarm') {
      if (!createLaunchSchedule(S.schedules, key, source.clone(), {
        aimPoint: aim?.aimPoint?.clone?.() || source.clone().add(direction),
        target: aim?.target || null,
        targets: aim?.targets || null,
        weaponKey: key,
      })) return false;
      S.ammo[key]--; S.cool = W2.cd; S.fired++;
      return true;
    }
    S.ammo[key]--; S.cool = W2.rate ?? W2.cd; S.fired++;
    const lookDir = direction.clone().normalize();
    if (W2.kind === 'rail' || W2.kind === 'bomb') {
      const dur = fxDef.charge || 0.4;
      S.charges.push({
        key, t: 0, dur, source: source.clone(), direction: lookDir, aim: hasAim ? {
          aimPoint: aim.aimPoint?.clone?.() || null, target: aim.target || null,
        } : null,
      });
      audio?.charge?.(key, dur);
      return true;
    }
    if (W2.kind === 'bullet') {
      const spread = fxDef.spread || 0.01;
      const dir = lookDir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread,
      )).normalize();
      S.burst = S.burstT > 0 ? S.burst + 1 : 1;
      S.burstT = 0.45;
      S.heat[key] = Math.min(1, (S.heat[key] || 0) + fxDef.heat.perShot);
      if (S.heat[key] >= 1) { S.overheat = 1.2; events?.overheat?.({ weapon: key }); }
      const shot = S.firedProjectiles[key];
      const tracer = fxDef.tracer;
      const bullet = {
        v2: true, pos: source.clone(), vel: dir.clone().multiplyScalar(W2.speed), t: 0, key, damage: W2.dmg,
        gravity: W2.gravity ?? 4, tracer: (shot % tracer.every) === 0, tracerDef: tracer,
        origin: source.clone(), off: fpvOffset(source, shot % 2 ? 1 : -1),
      };
      S.bullets.push(poolEffect('tracer', bullet, () => {}));
      S.firedProjectiles[key] += 1;
      fxs.muzzle({
        pos: source.clone().addScaledVector(dir, 0.55).add(bullet.off || _offTmp.set(0, 0, 0)), dir: { x: dir.x, y: dir.y, z: dir.z },
        size: fxDef.muzzle.size, life: fxDef.muzzle.life, smoke: Boolean(fxDef.muzzle.smoke), casing: Boolean(fxDef.muzzle.casing),
      });
      audio?.fire?.(key, { burst: S.burst });
      recoil(fxDef, key);
      return true;
    }
    // missile family
    const useKey = WEAPON_FAMILY[key] === 'm' && key === 'm'
      ? misilProfileKey({ guided: aim?.guided, target: aim?.target }) : key;
    spawnMissileV2(useKey, source, lookDir, { ...(aim || {}), weaponKey: key });
    const back = lookDir.clone();
    fxs.muzzle({ pos: source.clone().addScaledVector(back, 0.5), dir: back, size: fxDef.muzzle?.size || 0.5, life: fxDef.muzzle?.life || 0.09 });
    if (fxDef.muzzle?.backblast) {
      fxs.sink.sprite({
        pos: { x: source.x - back.x * 0.6, y: source.y - back.y * 0.6, z: source.z - back.z * 0.6 }, vel: { x: -back.x * 4, y: 1, z: -back.z * 4 },
        size0: 0.3, size1: 1.4, life: 0.35, cell: 'smokeB', layer: 'norm', c0: [0.6, 0.6, 0.6, 0], c1: [0.7, 0.7, 0.7, 0], drag: 2.2, maxScreen: 0.2, kind: 'smoke',
      });
    }
    audio?.fire?.(useKey === 'vx' ? 'm' : key, { guided: useKey === 'vx' });
    recoil(fxDef, key);
    return true;
  }

  // ── ?fv=2 per-step simulation ───────────────────────────────────────────
  const _b = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _axis = { x: 0, y: 0, z: 0 };
  const _mid = { x: 0, y: 0, z: 0 };
  const hexRgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  const TRACER_COLORS = {};
  const tracerColors = def => (TRACER_COLORS[def.core + def.edge] ||= { core: hexRgb(def.core), edge: hexRgb(def.edge) });

  function updateBulletsV2(dt, hittables) {
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const B = S.bullets[i];
      if (B.evicted) { S.bullets.splice(i, 1); continue; }
      B.t += dt;
      _from.copy(B.pos);
      _to.copy(_from);
      ballisticStep(_to, B.vel, B.gravity, dt);          // exact: drop = ½·g·t², same as the pipper
      const collision = projectileHit(_from, _to, 0, hittables);
      const endP = collision?.point || _to;
      if (B.tracer) {
        const def = B.tracerDef;
        const speed = B.vel.length();
        const len = Math.max(def.length, speed * dt * 1.15);
        _b.copy(B.vel).multiplyScalar(len / Math.max(speed, 1e-6));
        _axis.x = _b.x; _axis.y = _b.y; _axis.z = _b.z;
        const vf = B.off ? visualFade(endP, B.origin) : 0;
        _mid.x = endP.x - _b.x * 0.5; _mid.y = endP.y - _b.y * 0.5; _mid.z = endP.z - _b.z * 0.5;
        if (vf > 0) { _mid.x += B.off.x * vf; _mid.y += B.off.y * vf; _mid.z += B.off.z * vf; }
        const col = tracerColors(def);
        fxs.quad({ mode: 'streak', pos: _mid, axis: _axis, width: def.width * 3.2, cell: 'streak', minLen: 30, minW: 5,
          color: [col.edge[0] * 1.6, col.edge[1] * 1.6, col.edge[2] * 1.6, 0.6 * def.alpha] });
        fxs.quad({ mode: 'streak', pos: _mid, axis: _axis, width: def.width, cell: 'streak', minLen: 26, minW: 2.4,
          color: [col.core[0] * 2.6, col.core[1] * 2.6, col.core[2] * 2.6, def.alpha] });
      }
      B.pos.copy(endP);
      const bulletNear = (getCameraPosition?.() || B.pos).distanceTo(B.pos) < 90;
      S.lod[bulletNear ? 'near' : 'far'] += 1;
      let dead = B.t > 2.2;
      if (collision) {
        dead = true;
        recordImpact(collision);
        const nn = { x: collision.normal.x, y: collision.normal.y, z: collision.normal.z };
        const pp = { x: endP.x, y: endP.y, z: endP.z };
        if (collision.kind === 'target') {
          damageTarget(collision.target, B.damage, endP.clone ? endP.clone() : new THREE.Vector3(endP.x, endP.y, endP.z), false, collision, B.key);
        }
        const surf = surfaceOf(collision);
        const heavy = B.key === 'ac';
        fxs.impact(surf, { pos: pp, normal: nn, heavy });
        if (collision.kind !== 'target') {
          const range = WEAPON_FX[B.key].impact.decal;
          const size = range[0] + Math.random() * (range[1] - range[0]);
          fxs.spawnDecal({
            pos: { x: pp.x + nn.x * 0.03, y: pp.y + nn.y * 0.03, z: pp.z + nn.z * 0.03 }, normal: nn, size, life: 8,
            cell: surf === 'ground' ? 'scorch' : 'hole', c0: [0.05, 0.05, 0.05, 0.75], rot: Math.random() * 6.28,
          });
        }
        audio?.impact?.(surf, { pos: pp, weapon: B.key });
        const surface = impactTransform(collision, 0.018);
        S.impactEvidence = { kind: collision.kind, point: surface.position, normal: surface.normal };
      }
      if (dead) { releaseEffect(B); S.bullets.splice(i, 1); }
    }
  }

  const _steerDir = new THREE.Vector3();
  function updateMissilesV2(dt, hittables) {
    for (let i = S.missiles.length - 1; i >= 0; i--) {
      const M = S.missiles[i];
      M.t += dt;
      _from.copy(M.pos);
      const turn = M.kind === 'guided' ? M.profile.turnRate : M.homing;
      if (turn && activeTarget(M.guidanceTarget)) {
        const targetPoint = M.guidanceTarget.center;
        if (isGuidanceTargetVisible(_from, targetPoint, (a, b, r) => world?.castSegment?.(a, b, r), M.guidanceTarget.node || M.guidanceTarget.g)) {
          _steerDir.set(targetPoint.x - _from.x, targetPoint.y - _from.y, targetPoint.z - _from.z).normalize();
          const steered = steerVector(M.dir, _steerDir, turn, dt);
          M.dir.set(steered.x, steered.y, steered.z);
          M.fall *= Math.exp(-3.5 * dt);                 // the seeker flies level: sag is corrected
        }
      }
      if (M.kind === 'bomb') {
        M.vel.y -= M.gravity * dt;
        _to.copy(_from).addScaledVector(M.vel, dt);
        _to.y -= 0.5 * M.gravity * dt * dt;
      } else {
        const speed = M.t < 0.6 ? M.full * (0.25 + (M.t / 0.6) * 0.75) : M.full;
        M.fall -= M.gravity * dt;                        // accumulates: no longer overwritten each step
        M.vel.copy(M.dir).multiplyScalar(speed);
        M.vel.y += M.fall;
        _to.copy(_from).addScaledVector(M.vel, dt);
      }
      const collision = projectileHit(_from, _to, M.radius, hittables, M.proximity);
      M.pos.copy(collision?.point || _to);
      const vf = M.off ? visualFade(M.pos, M.origin) : 0;
      if (vf > 0) M.body.position.copy(M.pos).addScaledVector(M.off, vf); else M.body.position.copy(M.pos);
      _look.copy(M.body.position).add(M.vel);
      M.body.lookAt(_look);
      M.body.rotateZ(M.t * (M.kind === 'bomb' ? 1.4 : 7));
      const pos = M.body.position;
      const nozzle = M.length * 0.52;
      const vdir = _b.copy(M.vel).normalize();
      const missileNear = (getCameraPosition?.() || pos).distanceTo(pos) < 110;
      S.lod[missileNear ? 'near' : 'far'] += 1;
      // engine flare + flame (immediate additive quads)
      const flick = 0.8 + Math.random() * 0.4;
      const fxDef = fxOf(M.key);
      if (M.kind !== 'bomb') {
        const fs = (fxDef.flare || 0.4) * flick;
        _mid.x = pos.x - vdir.x * nozzle; _mid.y = pos.y - vdir.y * nozzle; _mid.z = pos.z - vdir.z * nozzle;
        fxs.quad({ mode: 'billboard', pos: _mid, size: fs, cell: 'glow', color: [2.0, 1.25, 0.55, 0.95], maxScreen: 0.12 });
        _axis.x = -vdir.x * M.length * 0.9; _axis.y = -vdir.y * M.length * 0.9; _axis.z = -vdir.z * M.length * 0.9;
        const flameMid = { x: _mid.x + _axis.x * 0.5, y: _mid.y + _axis.y * 0.5, z: _mid.z + _axis.z * 0.5 };
        fxs.quad({ mode: 'streak', pos: flameMid, axis: { x: -_axis.x, y: -_axis.y, z: -_axis.z }, width: fs * 0.55, cell: 'streak', minLen: 16, minW: 3, color: [1.8, 0.9, 0.35, 0.85] });
      } else {
        _mid.x = pos.x; _mid.y = pos.y; _mid.z = pos.z;
        fxs.quad({ mode: 'billboard', pos: _mid, size: 2.2 * flick, cell: 'glow', color: [1.3, 0.75, 0.3, 0.22], maxScreen: 0.25 });   // heat shimmer halo
      }
      // smoke trail: pooled puffs, rate*life <= the weapon's puff budget
      const trailDef = fxDef.trail;
      if (trailDef) {
        M.trail += dt;
        const interval = trailDef.life / trailDef.puffs;
        while (M.trail >= interval) {
          M.trail -= interval;
          fxs.sink.sprite({
            pos: { x: pos.x - vdir.x * nozzle, y: pos.y - vdir.y * nozzle, z: pos.z - vdir.z * nozzle },
            vel: { x: (Math.random() - 0.5) * 0.5, y: 0.5 + Math.random() * 0.5, z: (Math.random() - 0.5) * 0.5 },
            size0: trailDef.size * 0.3, size1: trailDef.size, life: trailDef.life * (0.85 + Math.random() * 0.3),
            cell: Math.random() < 0.5 ? 'smokeA' : 'smokeB', layer: 'norm', c0: [0.55, 0.54, 0.52, 0], c1: [0.62, 0.61, 0.6, 0],
            rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.8, drag: 1.4, buoy: 0.3, maxScreen: 0.3, kind: 'trail', peak: 0.42,
          });
        }
      }
      let hit = M.t > 6;
      if (collision) {
        hit = true;
        recordImpact(collision);
        if (collision.kind === 'target') {
          damageTarget(collision.target, M.damage, M.pos.clone(), true, collision, M.weapon || M.key);
        }
      }
      if (hit) {
        disposeMissile(M);
        S.missiles.splice(i, 1);
        explode(collision || M.pos.clone(), M.big || 1.25, M.profile, { weapon: M.weapon || M.key, targetHit: collision?.kind === 'target' });
      }
    }
  }

  return {
    state: S,
    setWeapon(k) { if (ARSENAL[k]) S.weapon = k; return S.weapon; },
    fire(pos, aim = null, pitch = -0.05) {
      const W2 = ARSENAL[S.weapon];
      if (S.ammo[S.weapon] < 1 || S.cool > 0) return false;
      const legacyAim = typeof aim === 'number';
      const yaw = legacyAim ? aim : 0;
      const legacyDirection = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
      );
      const source = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
      const aimVector = projectileDirection(
        source,
        aim?.aimPoint || aim?.point || source.clone().add(new THREE.Vector3(0, 0, -1)),
      );
      const direction = legacyAim
        ? legacyDirection
        : new THREE.Vector3(aimVector.x, aimVector.y, aimVector.z);
      if (!legacyAim && aim?.direction) direction.set(aim.direction.x, aim.direction.y, aim.direction.z).normalize();
      if (V2 && !legacyAim) return fireV2(W2, source, direction, aim);
      if (W2.kind === 'swarm') {
        if (!createLaunchSchedule(
          S.schedules,
          S.weapon,
          source.clone(),
          {
            aimPoint: aim?.aimPoint?.clone?.() || source.clone().add(direction),
            target: aim?.target || null,
          },
        )) return false;
        S.ammo[S.weapon]--; S.cool = W2.cd; S.fired++;
        return true;
      }
      if (W2.kind === 'rail') {
        S.ammo[S.weapon]--; S.cool = W2.cd; S.fired++;
        return fireRail(source, direction.normalize(), W2, aim);
      }
      if (W2.kind === 'bullet') {
        // ametralladora: tracer balístico con dispersión leve
        S.ammo[S.weapon]--; S.cool = W2.rate; S.fired++;
        const dir = direction.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * (S.weapon === 'ac' ? 0.006 : 0.012),
          (Math.random() - 0.5) * (S.weapon === 'ac' ? 0.006 : 0.012),
          (Math.random() - 0.5) * (S.weapon === 'ac' ? 0.006 : 0.012),
        )).normalize();
        const b = new THREE.Group();
        const near = new THREE.Mesh(tracerGeo, tracerMat);
        const far = sprite(TEX.dot); far.scale.setScalar(0.42); b.add(near, far);
        b.position.copy(source);
        group.add(b);
        // fogonazo de boca: flash corto en el origen
        emit(TEX.flash, source, dir.clone().multiplyScalar(-0.2), 0.5, 1.3, 0.07, THREE.AdditiveBlending,
          { effect: 'muzzle' });
        const bullet = {
          m: b, near, far, vel: dir.multiplyScalar(W2.speed), t: 0,
          key: S.weapon, damage: W2.dmg,
        };
        S.bullets.push(poolEffect('tracer', bullet, () => {
          removeObject(b);
          disposeObject(far, { geometry: false });
        }));
        S.firedProjectiles[S.weapon] += 1;
        audio?.mg?.();
        return true;
      }
      S.ammo[S.weapon]--; S.cool = W2.cd; S.fired++;
      spawnMissile(S.weapon, source, direction.normalize(), aim);
      return true;
    },
    smash,
    explodeAt: explode,
    update(dt, hittables) {
      S.cool = Math.max(0, S.cool - dt);
      S.lod.near = 0;
      S.lod.far = 0;
      if (V2) {
        S.lastHittables = hittables || [];
        S.burstT = Math.max(0, S.burstT - dt);
        if (S.burstT === 0) S.burst = 0;
        for (const k of Object.keys(S.heat)) {
          S.heat[k] = Math.max(0, S.heat[k] - WEAPON_FX[k].heat.cool * dt * (S.overheat > 0 ? 0.35 : 1));
        }
        if (S.overheat > 0) {
          S.overheat = Math.max(0, S.overheat - dt);
          if (S.overheat === 0) { for (const k of Object.keys(S.heat)) S.heat[k] = Math.min(S.heat[k], 0.5); events?.overheat?.({ weapon: null, cleared: true }); }
        }
        S.charge = null;
        for (let c = S.charges.length - 1; c >= 0; c--) {
          const ch = S.charges[c];
          ch.t += dt;
          const progress = Math.min(1, ch.t / ch.dur);
          S.charge = { weapon: ch.key, progress, dur: ch.dur };
          const at = getMuzzle?.() || ch.source;
          const rail = ch.key === 'rg';
          fxs.quad({
            mode: 'billboard', pos: { x: at.x, y: at.y, z: at.z }, size: 0.08 + progress * (rail ? 0.55 : 0.4), cell: rail ? 'glow' : 'flare',
            color: rail ? [0.8 + progress, 1.6, 2.4, 0.5 + progress * 0.5] : [2.2, 1.0 + progress * 0.4, 0.4, 0.4 + progress * 0.5], maxScreen: 0.1,
          });
          if (ch.t >= ch.dur) { S.charges.splice(c, 1); launchCharged(ch); }
        }
      }
      for (let i = S.booms.length - 1; i >= 0; i--) {   // detonaciones encadenadas
        S.booms[i].t -= dt;
        if (S.booms[i].t <= 0) { const b = S.booms.splice(i, 1)[0]; explode(b.p.clone(), b.big); }
      }
      for (const k of Object.keys(ARSENAL)) {           // recarga por arma
        if (S.ammo[k] < ARSENAL[k].max) S.ammo[k] = Math.min(ARSENAL[k].max, S.ammo[k] + ARSENAL[k].regen * dt);
      }
      advanceLaunchSchedules(S.schedules, dt, event => {
        const origin = event.origin.clone();
        const column = event.index % 4;
        const row = Math.floor(event.index / 4);
        origin.x += (column - 1.5) * 0.08;
        origin.y += (row - 0.5) * 0.09;
        const direction = event.aim.aimPoint.clone().sub(origin).normalize();
        direction.x += (column - 1.5) * 0.006;
        direction.y += (row - 0.5) * 0.005;
        if (V2) {
          // each rocket takes the next locked target (round-robin) and homes gently on it
          const list = event.aim.targets;
          const target = list?.length ? list[event.index % list.length] : null;
          const aim = { ...event.aim, target, weaponKey: event.key };
          spawnMissileV2(event.key, origin, direction.normalize(), aim, event.index);
          fxs.muzzle({ pos: origin.clone().addScaledVector(direction, 0.4), dir: direction, size: 0.25, life: 0.06 });
          audio?.fire?.('sw', { index: event.index });
          const fxDef = WEAPON_FX.sw;
          events?.shake?.({ tier: fxDef.shake.tier, trauma: fxDef.shake.trauma * 0.6, pos: null, weapon: 'sw', ceiling: 0.10 });
          return;
        }
        spawnMissile(event.key, origin, direction.normalize(), event.aim);
      });
      if (V2) {
        updateBulletsV2(dt, hittables);
        updateMissilesV2(dt, hittables);
      } else {
      // ── balas MG: tracer balístico + impacto con daño acumulativo ──
      for (let i = S.bullets.length - 1; i >= 0; i--) {
        const B = S.bullets[i];
        if (B.evicted) { S.bullets.splice(i, 1); continue; }
        B.t += dt;
        _from.copy(B.m.position);
        B.vel.y -= 4 * dt;
        _to.copy(_from).addScaledVector(B.vel, dt);
        const collision = projectileHit(_from, _to, 0, hittables);
        B.m.position.copy(collision?.point || _to);
        B.m.lookAt(B.m.position.clone().add(B.vel));
        const bulletNear = (getCameraPosition?.() || B.m.position).distanceTo(B.m.position) < 90;
        B.near.visible = bulletNear;
        B.far.visible = !bulletNear;
        S.lod[bulletNear ? 'near' : 'far'] += 1;
        const bp = B.m.position;
        let dead = B.t > 2.2;
        const impact = collision ? bp.clone() : null;
        if (collision) {
          recordImpact(collision);
          if (collision.kind === 'target') {
            damageTarget(collision.target, B.damage, impact, false, collision);
          }
        }
        if (impact) {
          dead = true;
          const normal = new THREE.Vector3(collision.normal.x, collision.normal.y, collision.normal.z);
          const surface = impactTransform(collision, 0.018);
          S.impactEvidence = { kind: collision.kind, point: surface.position, normal: surface.normal };
          effects.emitImpact({
            profile: ARSENAL[B.key],
            hit: collision,
            inheritedVelocity: B.vel,
            scale: B.key === 'ac' ? 0.42 : 0.24,
          });
        }
        if (dead) { releaseEffect(B); S.bullets.splice(i, 1); }
      }
      // ── misiles ──
      for (let i = S.missiles.length - 1; i >= 0; i--) {
        const M = S.missiles[i];
        M.t += dt;
        _from.copy(M.body.position);
        if (M.kind === 'guided' && activeTarget(M.guidanceTarget)) {
          const targetPoint = M.guidanceTarget.center;
          if (isGuidanceTargetVisible(
            _from,
            targetPoint,
            (start, end, radius) => world?.castSegment?.(start, end, radius),
            M.guidanceTarget.node || M.guidanceTarget.g,
          )) {
            const desired = new THREE.Vector3(
              targetPoint.x - _from.x,
              targetPoint.y - _from.y,
              targetPoint.z - _from.z,
            ).normalize();
            const steered = steerVector(M.dir, desired, M.profile.turnRate, dt);
            M.dir.set(steered.x, steered.y, steered.z);
          }
        }
        if (M.kind === 'bomb') {
          M.vel.y -= M.profile.gravity * dt;
        } else {
          const acceleration = M.t < 0.6
            ? M.full * (0.25 + (M.t / 0.6) * 0.75)
            : M.full;
          M.vel.copy(M.dir).multiplyScalar(acceleration);
          M.vel.y -= 2.2 * dt;
        }
        _to.copy(_from).addScaledVector(M.vel, dt);
        const collision = projectileHit(
          _from,
          _to,
          M.radius,
          hittables,
          M.proximity,
        );
        M.body.position.copy(collision?.point || _to);
        M.body.lookAt(M.body.position.clone().add(M.vel));
        M.body.rotateZ(M.kind === 'bomb' ? M.t * 2 : M.t * 9);
        const missileNear = (getCameraPosition?.() || M.body.position).distanceTo(M.body.position) < 110;
        M.nearLod.visible = missileNear;
        M.farLod.visible = !missileNear;
        S.lod[missileNear ? 'near' : 'far'] += 1;
        M.glow.visible = M.kind !== 'bomb';
        M.glow.scale.setScalar(0.45 + Math.random() * 0.25);   // flicker de tobera
        M.trail += dt;
        if (M.kind !== 'bomb' && M.trail > 0.018) { // estela FINA (no cono)
          M.trail = 0;
          effects.emitTrail({
            profile: M.profile,
            position: M.body.position,
            velocity: M.vel,
            dt,
          });
        }
        const p = M.body.position;
        let hit = M.t > 6;
        if (collision) {
          hit = true;
          recordImpact(collision);
          if (collision.kind === 'target') {
            damageTarget(collision.target, M.damage, p.clone(), true, collision);
          }
        }
        if (hit) {
          disposeMissile(M);
          S.missiles.splice(i, 1);
          explode(collision || p.clone(), M.big || 1.25, M.profile);
        }
      }
      }
      // ── partículas ──
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const P = S.parts[i];
        if (P.evicted) { S.parts.splice(i, 1); continue; }
        P.t += dt;
        const k = P.t / P.life;
        if (k >= 1) {
          releaseEffect(P);
          S.parts.splice(i, 1);
          continue;
        }
        if (P.sp) {
          P.sp.position.addScaledVector(P.vel, dt);
          P.vel.y += (P.rise || 0) * dt;
          P.vel.multiplyScalar(1 - P.drag * dt);
          const sz2 = P.size0 + (P.size1 - P.size0) * k;
          P.sp.scale.set(sz2, sz2 * P.tall, 1);
          // curva VFX: entrada rápida, salida lenta; el humo nunca es tinta sólida
          P.sp.material.opacity = P.smoke
            ? 0.6 * Math.min(1, k * 5) * (1 - k * k)
            : (1 - k * k);
          P.sp.material.rotation += P.rot * dt;
          if (P.tint0 && P.tint1) P.sp.material.color.lerpColors(P.tint0, P.tint1, Math.min(1, k * 1.4));
        }
        if (P.beam) P.beam.material.opacity = 0.95 * (1 - k);
        if (P.light) P.light.intensity = 90 * (1 - k);
        if (P.pts) {
          const a = P.pts.geometry.attributes.position;
          for (let j = 0; j < P.vel.length; j++) {
            P.vel[j].y -= P.grav * dt;
            a.array[j * 3] += P.vel[j].x * dt;
            a.array[j * 3 + 1] += P.vel[j].y * dt;
            a.array[j * 3 + 2] += P.vel[j].z * dt;
          }
          a.needsUpdate = true;
          P.pts.material.opacity = 1 - k;
        }
        if (P.ln) {                            // streaks: cola = pos - vel*στ
          const a = P.ln.geometry.attributes.position;
          for (let j = 0; j < P.vel.length; j++) {
            P.vel[j].y -= P.grav * dt;
            const hx = a.array[j * 6] + P.vel[j].x * dt;
            const hy = a.array[j * 6 + 1] + P.vel[j].y * dt;
            const hz = a.array[j * 6 + 2] + P.vel[j].z * dt;
            a.array.set([hx, hy, hz, hx - P.vel[j].x * 0.03, hy - P.vel[j].y * 0.03, hz - P.vel[j].z * 0.03], j * 6);
          }
          a.needsUpdate = true;
          P.ln.material.opacity = 1 - k;
        }
        if (P.ring) {
          P.ring.scale.setScalar(1 + k * 26 * (P.big || 1));
          P.ring.material.opacity = 0.85 * (1 - k);
        }
      }
      // ── fuegos residuales ──
      for (let i = S.fires.length - 1; i >= 0; i--) {
        const F = S.fires[i];
        if (F.evicted) { S.fires.splice(i, 1); continue; }
        if (F.v2) {                                  // smouldering: a few smoke wisps + ember glints, no light
          F.t += dt; F.acc += dt;
          if (F.t < F.life && F.acc > 0.28) {
            F.acc = 0;
            const a = Math.random() * 6.28; const r = Math.random() * 1.6;
            fxs.sink.sprite({
              pos: { x: F.p.x + Math.cos(a) * r, y: F.p.y + 0.2, z: F.p.z + Math.sin(a) * r }, vel: { x: 0, y: 1.6, z: 0 },
              size0: 0.4, size1: 1.6, life: 1.4, cell: 'smokeA', layer: 'norm', c0: [0.4, 0.39, 0.38, 0], c1: [0.5, 0.49, 0.48, 0],
              rot: Math.random() * 6, drag: 0.8, buoy: 0.5, maxScreen: 0.3, kind: 'smoke', peak: 0.3,
            });
          }
          if (F.t >= F.life) { releaseEffect(F); S.fires.splice(i, 1); }
          continue;
        }
        F.t += dt; F.acc += dt;
        if (F.light) F.light.intensity = Math.max(0, 14 * (1 - F.t / F.life)) * (0.75 + Math.random() * 0.5);
        if (F.t < F.life && F.acc > 0.09) {
          F.acc = 0;
          const j = new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.2, (Math.random() - 0.5) * 1.4);
          effects.emitTrail({
            profile: { effect: 'residual' },
            position: F.p.clone().add(j),
            velocity: { x: 0, y: 1.8, z: 0 },
            dt: 0.1,
          });
        }
        if (F.t > F.life + 1.5) {
          releaseEffect(F);
          S.fires.splice(i, 1);
        }
      }
      // ── escombros: vuelan, rebotan, y al asentarse QUEDAN (rubble) ──
      for (let i = S.frags.length - 1; i >= 0; i--) {
        const F = S.frags[i];
        if (F.evicted) { S.frags.splice(i, 1); continue; }
        F.t += dt;
        F.vel.y -= 30 * dt;
        F.vel.multiplyScalar(1 - 0.22 * dt);           // drag aerodinámico
        F.m.position.addScaledVector(F.vel, dt);
        F.m.rotation.x += F.rot.x * dt; F.m.rotation.y += F.rot.y * dt; F.m.rotation.z += F.rot.z * dt;
        const gy = heightAt ? heightAt(F.m.position.x, F.m.position.z) : null;
        let grounded = false;
        if (gy != null && F.m.position.y < gy + 0.12) {
          F.m.position.y = gy + 0.12;
          F.vel.y = Math.abs(F.vel.y) * 0.24;
          F.vel.x *= 0.62; F.vel.z *= 0.62;
          F.rot.multiplyScalar(0.6);
          grounded = true;
        }
        if ((grounded && F.vel.length() < 0.9) || F.t > 8) {   // se asienta → escombro estático
          F.m.matrixAutoUpdate = false; F.m.updateMatrix();
          const cleanup = F.cleanup;
          releaseEffect(F, { dispose: false });
          const rubble = poolEffect('rubble', { m: F.m }, cleanup);
          S.rubble.push(rubble);
          S.rubble = S.rubble.filter(entry => !entry.evicted);
          S.frags.splice(i, 1);
        }
      }
      if (V2) fxs.update(dt, cameraRef?.(), viewportHeight?.());
      else effects.update(dt, getCameraPosition?.() || null);
    },
    effects,
    fxs,
    v2: V2,
    dispose: disposeWeapons,
  };
}
