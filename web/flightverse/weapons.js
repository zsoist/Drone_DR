// flightverse/weapons.js — armamento v2: misiles con balística y roll, estela
// fina, explosiones multicapa con técnicas de VFX de motor (texturas suaves en
// Points — no cuadrados —, streaks de chispa estirados por velocidad, rampas
// de color sobre vida, rotación de sprites), CRÁTERES reales en el terreno,
// escombros PERSISTENTES que se congelan al asentarse, y fuegos residuales.
// HONESTO: la fotogrametría es un escaneo real — recibe cráter/scorch/
// metralla en el terreno de juego; lo destruible son objetos de juego.
// Todo procedural (canvas + primitivas), pools con tope, cero assets.
import * as THREE from '/flightverse/three.js?v=315';
import {
  earliestHit,
  normalizeTargetRadius,
  segmentSphereHit,
} from '/flightverse/collision-math.js?v=315';
import {
  EffectPool,
  disposeOwnedRenderObject,
  impactTransform,
  isContinuousWeapon,
  projectileDirection,
} from '/flightverse/aiming.js?v=315';

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

export const ARSENAL = {
  mg: { label: 'MG',  auto: true,  rate: 0.085, max: 120, regen: 12,   speed: 150, dmg: 14 },
  s:  { label: 'M·S', cd: 0.4,     max: 12,     regen: 0.55, speed: 74, big: 0.75, radius: 0.1, proximity: 1.2 },
  m:  { label: 'M·M', cd: 0.9,     max: 8,      regen: 0.4,  speed: 56, big: 1.25, radius: 0.16, proximity: 1.8 },
  l:  { label: 'M·L', cd: 2.2,     max: 3,      regen: 0.12, speed: 42, big: 2.2, radius: 0.25, proximity: 3.0 },
};

// eyecta con FRAGMENTOS REALES del destruction kit (debris_pack.glb: 16
// chunks PBR de concreto/ladrillo). Clonar comparte geometría/material —
// barato. Sin el GLB (o mientras carga): cajas procedurales (fallback).
let debrisFrags = null;
(async () => {
  try {
    const { GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=315');
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
} = {}) {
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
  const S = { missiles: [], bullets: [], parts: [], decals: [], frags: [], rubble: [], fires: [], booms: [],
    weapon: 'm', cool: 0, fired: 0, exploded: 0, destroyed: 0,
    structureHits: 0, terrainHits: 0, boundaryHits: 0, targetHits: 0,
    proximityTriggers: 0, occludedFuses: 0,
    impactEvidence: null,
    lod: { near: 0, far: 0 },
    effectCounters: {},
    resources: { disposed: 0 },
    disposed: false,
    ammo: { mg: 120, s: 12, m: 8, l: 3 } };
  const group = new THREE.Group(); group.name = 'fv-weapons'; scene.add(group);

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
    if (h.blood) bloodBurst(pos, 1);
    else emit(TEX.dot, pos, new THREE.Vector3(0, 2, 0), 0.4, 1.1, 0.25, THREE.AdditiveBlending);
    if (h.hp <= 0 && !h.g.userData.dead) {
      h.g.userData.dead = true;
      if (h.blood) bloodBurst(pos, 2.2);
      S.destroyed++;
    }
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
    const hits = [world?.castSegment?.(start, end, radius) || null];
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
  }

  function damageTarget(target, damage, point, missile = false, hit = null) {
    if (target.enemy) {
      hitEnemy(target, damage, point);
      return;
    }
    target.hp = (
      target.hp
      ?? target.node.userData.kit?.health
      ?? 60
    ) - damage;
    if (missile || target.hp <= 0) {
      smash(target.node, target.color, point, hit?.normal);
      if (!missile) explode(hit || { kind: 'target', point, normal: { x: 0, y: 1, z: 0 } }, 0.7);
    }
  }

  function explode(hitOrPoint, big = 1) {
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
    // flash + luz
    emit(TEX.flash, p, normal.clone().multiplyScalar(0.35), 9 * big, 24 * big, 0.16, THREE.AdditiveBlending,
      { effect: 'fire' });
    const light = new THREE.PointLight(0xffb066, 150 * big, 85 * big, 1.8);
    light.position.copy(p).addScaledVector(normal, 1.5);
    group.add(light);
    S.parts.push(poolEffect('fire', { light, t: 0, life: 0.22 }, () => removeObject(light)));
    // núcleo blanco-caliente (el 'punch' del estallido)
    for (let i = 0; i < 7; i++) {
      const v = normal.clone().multiplyScalar(3 + Math.random() * 5)
        .add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3));
      emit(TEX.flash, p, v, 1.4 * big, (2.8 + Math.random()) * big, 0.22 + Math.random() * 0.1,
        THREE.AdditiveBlending, { tint0: 0xffffff, tint1: 0xffc060, spin: 4, tall: 1.25, effect: 'fire' });
    }
    // bola de fuego: llamas ALTAS (no bolas) con rampa blanco→naranja→rojo
    for (let i = 0; i < 14; i++) {
      const v = normal.clone().multiplyScalar(3 + Math.random() * 8)
        .add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6));
      emit(TEX.fire, p, v, (1.1 + Math.random() * 1.8) * big, (3.8 + Math.random() * 3) * big,
        0.42 + Math.random() * 0.34, THREE.AdditiveBlending,
        { tint0: 0xfff4d8, tint1: 0x8a2508, spin: 3.2, tall: 1.5 + Math.random() * 0.5, rise: 3, effect: 'fire' });
    }
    // humo: columna que SUBE, oscura → gris, dura y crece mucho
    for (let i = 0; i < 12; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3.4)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.5, (Math.random() - 0.5) * 2.2));
      emit(TEX.puff3d, p.clone().addScaledVector(normal, i * 0.12), v,
        (1.8 + Math.random() * 2.2) * big, (11 + Math.random() * 7) * big,
        3.2 + Math.random() * 2.2, THREE.NormalBlending,
        { tint0: 0xb56a34, tint1: 0x8f8b86, spin: 0.8, rise: 1.9, drag: 1.2, smoke: true, effect: 'smoke' });
    }
    // anillo de POLVO rasante (tierra levantada, corre por el suelo)
    for (let i = 0; terrainImpact && i < 10; i++) {
      const a2 = (i / 14) * 6.283 + Math.random() * 0.3;
      const v = new THREE.Vector3(Math.cos(a2) * (9 + Math.random() * 6), 0.7, Math.sin(a2) * (9 + Math.random() * 6));
      emit(TEX.puff3d, p.clone().addScaledVector(normal, 0.6), v,
        1.4 * big, (6 + Math.random() * 3) * big, 1.5 + Math.random() * 0.6,
        THREE.NormalBlending, { tint0: 0x8a7256, tint1: 0x9a8a72, spin: 1, drag: 2.2, smoke: true, effect: 'dust' });
    }
    // EYECTA: pedazos del suelo/edificio que vuelan y QUEDAN como escombro
    for (let i = 0; i < 12; i++) {
      const sz3 = 0.1 + Math.random() * 0.26;
      let m2;
      const ownsResources = !debrisFrags;
      if (debrisFrags) {
        // fragmento PBR real del kit (geometría/material compartidos)
        m2 = debrisFrags[(Math.random() * debrisFrags.length) | 0].clone();
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
    // brasas: Points con textura suave (adiós cuadrados) + gravedad
    {
      const n = 44, pos = new Float32Array(n * 3), vel = [];
      for (let i = 0; i < n; i++) {
        pos.set([p.x, p.y + 0.3, p.z], i * 3);
        const a = Math.random() * 6.283, e = Math.random() * 1.3, s2 = 9 + Math.random() * 16;
        vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * s2, Math.sin(e) * s2, Math.sin(a) * Math.cos(e) * s2));
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(gg, new THREE.PointsMaterial({
        map: TEX.dot, color: 0xffc37a, size: 0.42 * big, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      group.add(pts);
      S.parts.push(poolEffect('spark', { pts, vel, t: 0, life: 0.9, grav: 34 }, () => disposeObject(pts)));
    }
    // streaks: chispas estiradas por velocidad (LineSegments, técnica quarks)
    {
      const n = 24, pos = new Float32Array(n * 6), vel = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, e = 0.15 + Math.random() * 1.2, s2 = 24 + Math.random() * 30;
        const v = new THREE.Vector3(Math.cos(a) * Math.cos(e) * s2, Math.sin(e) * s2, Math.sin(a) * Math.cos(e) * s2);
        vel.push(v);
        pos.set([p.x, p.y + 0.3, p.z, p.x - v.x * 0.02, p.y + 0.3 - v.y * 0.02, p.z - v.z * 0.02], i * 6);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const ln = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({
        color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      group.add(ln);
      S.parts.push(poolEffect('spark', { ln, vel, t: 0, life: 0.8, grav: 30 }, () => disposeObject(ln)));
    }
    // onda expansiva a ras de suelo
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    ring.position.copy(p).addScaledVector(normal, 0.04);
    group.add(ring);
    S.parts.push(poolEffect('fire', { ring, t: 0, life: 0.5, big }, () => disposeObject(ring)));
    // banda de compresión: anillo oscuro sutil detrás del frente (lente de aire)
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 64),
      new THREE.MeshBasicMaterial({ color: 0x1a1611, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false }));
    ring2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    ring2.position.copy(p).addScaledVector(normal, 0.035);
    group.add(ring2);
    S.parts.push(poolEffect('fire', { ring: ring2, t: 0, life: 0.62, big: big * 0.92 }, () => disposeObject(ring2)));
    // scorch persistente
    const sc = new THREE.Mesh(new THREE.CircleGeometry(3.2 * big, 24),
      new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, opacity: 0.8, depthWrite: false }));
    sc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    sc.position.set(surface.position.x, surface.position.y, surface.position.z);
    group.add(sc);
    const decal = poolEffect('decal', { m: sc }, () => disposeObject(sc));
    S.decals.push(decal);
    S.decals = S.decals.filter(entry => !entry.evicted);
    if (S._enemies) for (const h of S._enemies) {   // splash a la horda
      if (!h.g.userData.dead && p.distanceToSquared(h.center) < (7 * big) ** 2) hitEnemy(h, 220 * big, h.center.clone());
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
    for (const texture of Object.values(TEX)) texture.dispose();
    scene.remove(group);
    syncEffectCounters();
  };

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
      if (isContinuousWeapon(S.weapon)) {
        // ametralladora: tracer balístico con dispersión leve
        S.ammo.mg--; S.cool = W2.rate; S.fired++;
        const dir = direction.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012,
        )).normalize();
        const b = new THREE.Group();
        const near = new THREE.Mesh(tracerGeo, tracerMat);
        const far = sprite(TEX.dot); far.scale.setScalar(0.42); b.add(near, far);
        b.position.copy(source);
        group.add(b);
        // fogonazo de boca: flash corto en el origen
        emit(TEX.flash, source, dir.clone().multiplyScalar(-0.2), 0.5, 1.3, 0.07, THREE.AdditiveBlending,
          { effect: 'muzzle' });
        const bullet = { m: b, near, far, vel: dir.multiplyScalar(W2.speed), t: 0 };
        S.bullets.push(poolEffect('tracer', bullet, () => {
          removeObject(b);
          disposeObject(far, { geometry: false });
        }));
        audio?.mg?.();
        return true;
      }
      S.ammo[S.weapon]--; S.cool = W2.cd; S.fired++;
      const dir = direction.normalize();
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
      // `source` is already the selected GLB hardpoint. Do not re-offset it.
      body.position.copy(source);
      body.lookAt(source.clone().add(dir));
      group.add(body);
      body.scale.setScalar(S.weapon === 'l' ? 1.5 : S.weapon === 's' ? 0.75 : 1);
      emit(TEX.puff3d, body.position.clone(), dir.clone().multiplyScalar(-0.7), 0.5, 1.6, 0.7,
        THREE.NormalBlending, { smoke: true, tint0: 0xcfc9c2, tint1: 0xb0aaa4, effect: 'exhaust' });
      S.missiles.push({ body, glow, dir: dir.clone(), full: W2.speed,
        vel: dir.clone().multiplyScalar(W2.speed * 0.25), t: 0, trail: 0, big: W2.big,
        radius: W2.radius, proximity: W2.proximity, nearLod, farLod,
        ownedGeometries: [tip.geometry, band.geometry] });
      audio?.launch?.();
      return true;
    },
    smash,
    explodeAt: explode,
    update(dt, hittables) {
      S.cool = Math.max(0, S.cool - dt);
      S.lod.near = 0;
      S.lod.far = 0;
      for (let i = S.booms.length - 1; i >= 0; i--) {   // detonaciones encadenadas
        S.booms[i].t -= dt;
        if (S.booms[i].t <= 0) { const b = S.booms.splice(i, 1)[0]; explode(b.p.clone(), b.big); }
      }
      for (const k of Object.keys(ARSENAL)) {           // recarga por arma
        if (S.ammo[k] < ARSENAL[k].max) S.ammo[k] = Math.min(ARSENAL[k].max, S.ammo[k] + ARSENAL[k].regen * dt);
      }
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
            damageTarget(collision.target, ARSENAL.mg.dmg, impact, false, collision);
          }
        }
        if (impact) {
          dead = true;
          const normal = new THREE.Vector3(collision.normal.x, collision.normal.y, collision.normal.z);
          const surface = impactTransform(collision, 0.018);
          S.impactEvidence = { kind: collision.kind, point: surface.position, normal: surface.normal };
          emit(TEX.dot, impact, normal.multiplyScalar(1.5), 0.3, 0.9, 0.22, THREE.AdditiveBlending,
            { effect: 'spark' });
          emit(TEX.puff3d, impact, new THREE.Vector3(collision.normal.x, collision.normal.y, collision.normal.z).multiplyScalar(0.8), 0.3, 1.3, 0.6,
            THREE.NormalBlending, { smoke: true, tint0: 0x9a8a72, tint1: 0xb0a48e, effect: 'smoke' });
        }
        if (dead) { releaseEffect(B); S.bullets.splice(i, 1); }
      }
      // ── misiles ──
      for (let i = S.missiles.length - 1; i >= 0; i--) {
        const M = S.missiles[i];
        M.t += dt;
        _from.copy(M.body.position);
        if (M.t < 0.6) M.vel.copy(M.dir).multiplyScalar(M.full * (0.25 + (M.t / 0.6) * 0.75));
        M.vel.y -= 2.2 * dt;
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
        M.body.rotateZ(M.t * 9);               // roll del misil
        const missileNear = (getCameraPosition?.() || M.body.position).distanceTo(M.body.position) < 110;
        M.nearLod.visible = missileNear;
        M.farLod.visible = !missileNear;
        S.lod[missileNear ? 'near' : 'far'] += 1;
        M.glow.scale.setScalar(0.45 + Math.random() * 0.25);   // flicker de tobera
        M.trail += dt;
        if (M.trail > 0.018) {                 // estela FINA (no cono)
          M.trail = 0;
          emit(TEX.puff3d, M.body.position.clone(), M.dir.clone().multiplyScalar(-0.65),
            0.18, 0.9, 0.75, THREE.NormalBlending, { spin: 0.6, drag: 0.4, smoke: true, tint0: 0xcfc9c2, tint1: 0xb9b3ac, effect: 'exhaust' });
        }
        const p = M.body.position;
        let hit = M.t > 6;
        if (collision) {
          hit = true;
          recordImpact(collision);
          if (collision.kind === 'target') {
            damageTarget(collision.target, 900, p.clone(), true, collision);
          }
        }
        if (hit) {
          disposeMissile(M);
          S.missiles.splice(i, 1);
          explode(collision || p.clone(), M.big || 1.25);
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
        F.t += dt; F.acc += dt;
        if (F.light) F.light.intensity = Math.max(0, 14 * (1 - F.t / F.life)) * (0.75 + Math.random() * 0.5);
        if (F.t < F.life && F.acc > 0.09) {
          F.acc = 0;
          const j = new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.2, (Math.random() - 0.5) * 1.4);
          emit(TEX.fire, F.p.clone().add(j), new THREE.Vector3(0, 2.2 + Math.random() * 1.4, 0),
            0.6, 2.1, 0.5, THREE.AdditiveBlending,
            { tint0: 0xffe8b0, tint1: 0xa03008, spin: 2.4, drag: 0.3, tall: 2.1, rise: 2.5 });
          if (Math.random() < 0.4) {
            emit(TEX.puff3d, F.p.clone().add(j).add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1.8, 0),
              0.8, 3.2, 2.6, THREE.NormalBlending, { tint0: 0x6a5344, tint1: 0x8a8681, spin: 0.6, drag: 0.3, smoke: true });
          }
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
    },
    dispose: disposeWeapons,
  };
}
