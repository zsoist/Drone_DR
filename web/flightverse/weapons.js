// flightverse/weapons.js — armamento v2: misiles con balística y roll, estela
// fina, explosiones multicapa con técnicas de VFX de motor (texturas suaves en
// Points — no cuadrados —, streaks de chispa estirados por velocidad, rampas
// de color sobre vida, rotación de sprites), CRÁTERES reales en el terreno,
// escombros PERSISTENTES que se congelan al asentarse, y fuegos residuales.
// HONESTO: la fotogrametría es un escaneo real — recibe cráter/scorch/
// metralla en el terreno de juego; lo destruible son objetos de juego.
// Todo procedural (canvas + primitivas), pools con tope, cero assets.
import * as THREE from '/flightverse/three.js?v=280';

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
  s:  { label: 'M·S', cd: 0.4,     max: 12,     regen: 0.55, speed: 74, big: 0.75 },
  m:  { label: 'M·M', cd: 0.9,     max: 8,      regen: 0.4,  speed: 56, big: 1.25 },
  l:  { label: 'M·L', cd: 2.2,     max: 3,      regen: 0.12, speed: 42, big: 2.2 },
};

// eyecta con FRAGMENTOS REALES del destruction kit (debris_pack.glb: 16
// chunks PBR de concreto/ladrillo). Clonar comparte geometría/material —
// barato. Sin el GLB (o mientras carga): cajas procedurales (fallback).
let debrisFrags = null;
(async () => {
  try {
    const { GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=280');
    const g = await new GLTFLoader().loadAsync('/assets/destruction/models/debris_pack.glb');
    const frags = [];
    g.scene.traverse(n => { if (n.isMesh && n.userData.role === 'fragment') frags.push(n); });
    if (frags.length) debrisFrags = frags;
  } catch { /* opcional */ }
})();

export function createWeapons(scene, { heightAt, audio, onShake, crater } = {}) {
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
    ammo: { mg: 120, s: 12, m: 8, l: 3 } };
  const group = new THREE.Group(); group.name = 'fv-weapons'; scene.add(group);

  const missileGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.62, 8);
  missileGeo.rotateX(Math.PI / 2);
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
    if (S.parts.length > 460) return;         // tope de seguridad (drawcalls)
    const sp = sprite(tex, blending);
    sp.position.copy(pos);
    if (o.tint0) sp.material.color.set(o.tint0);
    S.parts.push({ sp, vel, t: 0, life, size0, size1,
      rot: (Math.random() - 0.5) * (o.spin ?? 1.6),
      tint0: o.tint0 && new THREE.Color(o.tint0), tint1: o.tint1 && new THREE.Color(o.tint1),
      drag: o.drag ?? 1.6, rise: o.rise ?? 0, tall: o.tall ?? 1, smoke: !!o.smoke });
  };

  function fireAftermath(p) {                 // fuego residual que arde y muere
    if (S.fires.length >= 3) {
      const old = S.fires.shift();
      if (old.light) group.remove(old.light);
    }
    const light = new THREE.PointLight(0xff7a30, 14, 26, 2);
    light.position.copy(p).y += 1.2;
    group.add(light);
    S.fires.push({ p: p.clone(), t: 0, life: 5.5, acc: 0, light });
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

  function explode(p, big = 1) {
    S.exploded++;
    const gy = heightAt ? (heightAt(p.x, p.z) ?? p.y) : p.y;
    const nearGround = p.y - gy < 3.5;
    if (nearGround && crater) crater(p.x, p.z, 3.4 * big, 1.15 * big);
    // flash + luz
    emit(TEX.flash, p, new THREE.Vector3(), 9 * big, 24 * big, 0.16, THREE.AdditiveBlending);
    const light = new THREE.PointLight(0xffb066, 150 * big, 85 * big, 1.8);
    light.position.copy(p).y += 1.5;
    group.add(light);
    S.parts.push({ light, t: 0, life: 0.22 });
    // núcleo blanco-caliente (el 'punch' del estallido)
    for (let i = 0; i < 7; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 5, (Math.random() - 0.5) * 5);
      emit(TEX.flash, p, v, 1.4 * big, (2.8 + Math.random()) * big, 0.22 + Math.random() * 0.1,
        THREE.AdditiveBlending, { tint0: 0xffffff, tint1: 0xffc060, spin: 4, tall: 1.25 });
    }
    // bola de fuego: llamas ALTAS (no bolas) con rampa blanco→naranja→rojo
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 9, 3 + Math.random() * 8, (Math.random() - 0.5) * 9);
      emit(TEX.fire, p, v, (1.1 + Math.random() * 1.8) * big, (3.8 + Math.random() * 3) * big,
        0.42 + Math.random() * 0.34, THREE.AdditiveBlending,
        { tint0: 0xfff4d8, tint1: 0x8a2508, spin: 3.2, tall: 1.5 + Math.random() * 0.5, rise: 3 });
    }
    // humo: columna que SUBE, oscura → gris, dura y crece mucho
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3.4, 2 + Math.random() * 3.4, (Math.random() - 0.5) * 3.4);
      emit(TEX.puff3d, p.clone().add(new THREE.Vector3(0, i * 0.12, 0)), v,
        (1.8 + Math.random() * 2.2) * big, (11 + Math.random() * 7) * big,
        3.2 + Math.random() * 2.2, THREE.NormalBlending,
        { tint0: 0xb56a34, tint1: 0x8f8b86, spin: 0.8, rise: 1.9, drag: 1.2, smoke: true });
    }
    // anillo de POLVO rasante (tierra levantada, corre por el suelo)
    for (let i = 0; i < 14; i++) {
      const a2 = (i / 14) * 6.283 + Math.random() * 0.3;
      const v = new THREE.Vector3(Math.cos(a2) * (9 + Math.random() * 6), 0.7, Math.sin(a2) * (9 + Math.random() * 6));
      emit(TEX.puff3d, new THREE.Vector3(p.x, gy + 0.6, p.z), v,
        1.4 * big, (6 + Math.random() * 3) * big, 1.5 + Math.random() * 0.6,
        THREE.NormalBlending, { tint0: 0x8a7256, tint1: 0x9a8a72, spin: 1, drag: 2.2, smoke: true });
    }
    // EYECTA: pedazos del suelo/edificio que vuelan y QUEDAN como escombro
    for (let i = 0; i < 12; i++) {
      const sz3 = 0.1 + Math.random() * 0.26;
      let m2;
      if (debrisFrags) {
        // fragmento PBR real del kit (geometría/material compartidos)
        m2 = debrisFrags[(Math.random() * debrisFrags.length) | 0].clone();
        m2.scale.setScalar(0.5 + Math.random() * 0.9);
      } else {
        m2 = new THREE.Mesh(new THREE.BoxGeometry(sz3, sz3 * (0.5 + Math.random()), sz3),
          new THREE.MeshLambertMaterial({ color: [0x4a4238, 0x6b5d4a, 0x2e2a24, 0x57503f][i % 4] }));
      }
      m2.position.set(p.x, gy + 0.4, p.z);
      m2.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m2.castShadow = true;
      group.add(m2);
      const a3 = Math.random() * 6.283, e3 = 0.5 + Math.random() * 0.9, s3 = (7 + Math.random() * 13) * big;
      S.frags.push({ m: m2, t: 0,
        vel: new THREE.Vector3(Math.cos(a3) * Math.cos(e3) * s3, Math.sin(e3) * s3, Math.sin(a3) * Math.cos(e3) * s3),
        rot: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) });
    }
    // brasas: Points con textura suave (adiós cuadrados) + gravedad
    {
      const n = 80, pos = new Float32Array(n * 3), vel = [];
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
      S.parts.push({ pts, vel, t: 0, life: 0.9, grav: 34 });
    }
    // streaks: chispas estiradas por velocidad (LineSegments, técnica quarks)
    {
      const n = 40, pos = new Float32Array(n * 6), vel = [];
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
      S.parts.push({ ln, vel, t: 0, life: 0.8, grav: 30 });
    }
    // onda expansiva a ras de suelo
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.35, p.z);
    group.add(ring);
    S.parts.push({ ring, t: 0, life: 0.5, big });
    // banda de compresión: anillo oscuro sutil detrás del frente (lente de aire)
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 64),
      new THREE.MeshBasicMaterial({ color: 0x1a1611, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false }));
    ring2.rotation.x = -Math.PI / 2; ring2.position.set(p.x, gy + 0.32, p.z);
    group.add(ring2);
    S.parts.push({ ring: ring2, t: 0, life: 0.62, big: big * 0.92 });
    // scorch persistente
    const sc = new THREE.Mesh(new THREE.CircleGeometry(3.2 * big, 24),
      new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, opacity: 0.8, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(p.x, (heightAt ? (heightAt(p.x, p.z) ?? gy) : gy) + 0.06, p.z);
    group.add(sc);
    S.decals.push(sc);
    if (S.decals.length > 14) group.remove(S.decals.shift());
    if (S._enemies) for (const h of S._enemies) {   // splash a la horda
      if (!h.g.userData.dead && p.distanceToSquared(h.center) < (7 * big) ** 2) hitEnemy(h, 220 * big, h.center.clone());
    }
    if (nearGround) fireAftermath(new THREE.Vector3(p.x, gy, p.z));
    audio?.boom?.(big);
    onShake?.(p, big);
  }

  // fragmentación v3: si el objeto trae fragmentos pre-esculpidos (destruction
  // kit: role=fragment con massKg), vuelan ESOS con velocidad ∝ 1/√masa desde
  // el punto de impacto; barriles explosivos encadenan detonación. Fallback:
  // shatter procedural de cajas.
  function smash(node, color, blastP) {
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
        S.frags.push({ m: f, t: 0,
          vel: dir.multiplyScalar(speed).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)),
          rot: new THREE.Vector3((Math.random() - 0.5) * 10 / Math.sqrt(mass), (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10 / Math.sqrt(mass)) });
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
      S.frags.push({ m, t: 0,
        vel: new THREE.Vector3((Math.random() - 0.5) * 13, 5 + Math.random() * 10, (Math.random() - 0.5) * 13),
        rot: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    }
  }

  const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1.4);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });

  return {
    state: S,
    setWeapon(k) { if (ARSENAL[k]) S.weapon = k; return S.weapon; },
    fire(pos, yaw, pitch = -0.05) {
      const W2 = ARSENAL[S.weapon];
      if (S.ammo[S.weapon] < 1 || S.cool > 0) return false;
      if (W2.auto) {
        // ametralladora: tracer balístico con dispersión leve
        S.ammo.mg--; S.cool = W2.rate; S.fired++;
        const yj = yaw + (Math.random() - 0.5) * 0.012;
        const pj = pitch + (Math.random() - 0.5) * 0.012;
        const dir = new THREE.Vector3(-Math.sin(yj) * Math.cos(pj), Math.sin(pj), -Math.cos(yj) * Math.cos(pj));
        const b = new THREE.Mesh(tracerGeo, tracerMat);
        const tg = sprite(TEX.dot); tg.scale.set(0.5, 0.5, 1); b.add(tg);
        b.position.copy(pos).y -= 0.18;
        group.add(b);
        // fogonazo de boca: flash corto en el origen
        emit(TEX.flash, pos.clone(), new THREE.Vector3(0, 0, 0), 0.5, 1.3, 0.07, THREE.AdditiveBlending);
        S.bullets.push({ m: b, vel: dir.multiplyScalar(W2.speed), t: 0 });
        audio?.mg?.();
        return true;
      }
      S.ammo[S.weapon]--; S.cool = W2.cd; S.fired++;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const body = new THREE.Group();
      const mm = new THREE.Mesh(missileGeo, missileMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), tipMat);
      tip.rotation.x = -Math.PI / 2; tip.position.z = -0.36;
      const f1 = new THREE.Mesh(finGeo, missileMat); f1.position.z = 0.26;
      const f2 = f1.clone(); f2.rotation.z = Math.PI / 2;
      const glow = sprite(TEX.fire); glow.scale.setScalar(0.55); glow.position.z = 0.44;
      body.add(mm, tip, f1, f2, glow);
      // hardpoints alternos bajo los brazos (izq/der)
      body.position.copy(pos).addScaledVector(right, (S.fired % 2 ? 0.28 : -0.28)).y -= 0.3;
      body.rotation.y = yaw;
      group.add(body);
      body.scale.setScalar(S.weapon === 'l' ? 1.5 : S.weapon === 's' ? 0.75 : 1);
      emit(TEX.puff3d, body.position.clone(), new THREE.Vector3(0, -0.5, 0), 0.5, 1.6, 0.7,
        THREE.NormalBlending, { smoke: true, tint0: 0xcfc9c2, tint1: 0xb0aaa4 });
      S.missiles.push({ body, glow, dir: dir.clone(), full: W2.speed,
        vel: dir.clone().multiplyScalar(W2.speed * 0.25), t: 0, trail: 0, big: W2.big });
      audio?.launch?.();
      return true;
    },
    smash,
    explodeAt: explode,
    update(dt, hittables) {
      S.cool = Math.max(0, S.cool - dt);
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
        B.t += dt;
        B.vel.y -= 4 * dt;
        B.m.position.addScaledVector(B.vel, dt);
        B.m.lookAt(B.m.position.clone().add(B.vel));
        const bp = B.m.position;
        let dead = B.t > 2.2;
        const bgy = heightAt ? heightAt(bp.x, bp.z) : null;
        let impact = null;
        if (bgy != null && bp.y <= bgy + 0.15) impact = new THREE.Vector3(bp.x, bgy + 0.15, bp.z);
        if (!impact && hittables) {
          for (const h of hittables) {
            if (h.enemy) {
              if (h.g.userData.dead) continue;
              if (bp.distanceToSquared(h.center) < h.r2 * h.r2) { hitEnemy(h, ARSENAL.mg.dmg, bp.clone()); impact = bp.clone(); break; }
              continue;
            }
            if (h.node.userData.dead) continue;
            if (bp.distanceToSquared(h.center) < h.r2) {
              h.hp = (h.hp ?? (h.node.userData.kit?.health || 60)) - ARSENAL.mg.dmg;
              if (h.hp <= 0) { smash(h.node, h.color, bp.clone()); explode(bp.clone(), 0.7); }
              impact = bp.clone();
              break;
            }
          }
        }
        if (impact) {
          dead = true;
          emit(TEX.dot, impact, new THREE.Vector3(0, 1.5, 0), 0.3, 0.9, 0.22, THREE.AdditiveBlending);
          emit(TEX.puff3d, impact, new THREE.Vector3(0, 0.8, 0), 0.3, 1.3, 0.6,
            THREE.NormalBlending, { smoke: true, tint0: 0x9a8a72, tint1: 0xb0a48e });
        }
        if (dead) { group.remove(B.m); S.bullets.splice(i, 1); }
      }
      // ── misiles ──
      for (let i = S.missiles.length - 1; i >= 0; i--) {
        const M = S.missiles[i];
        M.t += dt;
        if (M.t < 0.6) M.vel.copy(M.dir).multiplyScalar(M.full * (0.25 + (M.t / 0.6) * 0.75));
        M.vel.y -= 2.2 * dt;
        M.body.position.addScaledVector(M.vel, dt);
        M.body.lookAt(M.body.position.clone().add(M.vel));
        M.body.rotateZ(M.t * 9);               // roll del misil
        M.glow.scale.setScalar(0.45 + Math.random() * 0.25);   // flicker de tobera
        M.trail += dt;
        if (M.trail > 0.018) {                 // estela FINA (no cono)
          M.trail = 0;
          emit(TEX.puff3d, M.body.position.clone(), new THREE.Vector3(0, 0.35, 0),
            0.18, 0.9, 0.75, THREE.NormalBlending, { spin: 0.6, drag: 0.4, smoke: true, tint0: 0xcfc9c2, tint1: 0xb9b3ac });
        }
        const p = M.body.position;
        let hit = M.t > 6;
        const gy = heightAt ? heightAt(p.x, p.z) : null;
        if (gy != null && p.y <= gy + 0.3) { hit = true; p.y = gy + 0.3; }
        if (!hit && hittables) {
          for (const h of hittables) {
            if (h.enemy) {
              if (!h.g.userData.dead && p.distanceToSquared(h.center) < h.r2 * h.r2 * 4) { hit = true; hitEnemy(h, 900, p.clone()); break; }
              continue;
            }
            if (h.node.userData.dead) continue;
            if (p.distanceToSquared(h.center) < h.r2) { hit = true; smash(h.node, h.color, p.clone()); break; }
          }
        }
        if (hit) {
          group.remove(M.body);
          S.missiles.splice(i, 1);
          explode(p.clone(), M.big || 1.25);
        }
      }
      // ── partículas ──
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const P = S.parts[i];
        P.t += dt;
        const k = P.t / P.life;
        if (k >= 1) {
          for (const key of ['sp', 'light', 'pts', 'ring', 'ln']) if (P[key]) group.remove(P[key]);
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
          if (F.light) group.remove(F.light);
          S.fires.splice(i, 1);
        }
      }
      // ── escombros: vuelan, rebotan, y al asentarse QUEDAN (rubble) ──
      for (let i = S.frags.length - 1; i >= 0; i--) {
        const F = S.frags[i];
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
          S.rubble.push(F.m);
          if (S.rubble.length > 240) group.remove(S.rubble.shift());
          S.frags.splice(i, 1);
        }
      }
    },
    dispose() { scene.remove(group); },
  };
}
