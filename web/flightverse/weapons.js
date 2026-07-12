// flightverse/weapons.js — armamento v2: misiles con balística y roll, estela
// fina, explosiones multicapa con técnicas de VFX de motor (texturas suaves en
// Points — no cuadrados —, streaks de chispa estirados por velocidad, rampas
// de color sobre vida, rotación de sprites), CRÁTERES reales en el terreno,
// escombros PERSISTENTES que se congelan al asentarse, y fuegos residuales.
// HONESTO: la fotogrametría es un escaneo real — recibe cráter/scorch/
// metralla en el terreno de juego; lo destruible son objetos de juego.
// Todo procedural (canvas + primitivas), pools con tope, cero assets.
import * as THREE from '/flightverse/three.js?v=109';

function glowTex(stops, size = 64) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2 - 1);
  for (const [p, col] of stops) g.addColorStop(p, col);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

export function createWeapons(scene, { heightAt, audio, onShake, crater } = {}) {
  const TEX = {
    fire: glowTex([[0, 'rgba(255,244,200,1)'], [0.25, 'rgba(255,150,40,.9)'], [0.6, 'rgba(200,60,10,.45)'], [1, 'rgba(120,20,0,0)']]),
    smoke: glowTex([[0, 'rgba(72,68,64,.5)'], [0.5, 'rgba(58,55,52,.28)'], [1, 'rgba(44,42,40,0)']]),
    flash: glowTex([[0, 'rgba(255,255,240,1)'], [0.4, 'rgba(255,220,120,.6)'], [1, 'rgba(255,180,60,0)']]),
    puff: glowTex([[0, 'rgba(215,210,202,.4)'], [1, 'rgba(195,190,184,0)']]),
    dot: glowTex([[0, 'rgba(255,225,170,1)'], [0.5, 'rgba(255,170,80,.8)'], [1, 'rgba(255,120,40,0)']], 32),
  };
  const S = { missiles: [], parts: [], decals: [], frags: [], rubble: [], fires: [], booms: [],
    ammo: 8, MAX: 8, cool: 0, fired: 0, exploded: 0, destroyed: 0 };
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
      drag: o.drag ?? 1.6, rise: o.rise ?? 0, tall: o.tall ?? 1 });
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
      emit(TEX.smoke, p.clone().add(new THREE.Vector3(0, i * 0.12, 0)), v,
        (1.8 + Math.random() * 2.2) * big, (11 + Math.random() * 7) * big,
        3.2 + Math.random() * 2.2, THREE.NormalBlending,
        { tint0: 0x211f1c, tint1: 0x7a7672, spin: 0.8, rise: 1.9, drag: 1.2 });
    }
    // anillo de POLVO rasante (tierra levantada, corre por el suelo)
    for (let i = 0; i < 14; i++) {
      const a2 = (i / 14) * 6.283 + Math.random() * 0.3;
      const v = new THREE.Vector3(Math.cos(a2) * (9 + Math.random() * 6), 0.7, Math.sin(a2) * (9 + Math.random() * 6));
      emit(TEX.smoke, new THREE.Vector3(p.x, gy + 0.6, p.z), v,
        1.4 * big, (6 + Math.random() * 3) * big, 1.5 + Math.random() * 0.6,
        THREE.NormalBlending, { tint0: 0x6e5c48, tint1: 0x8a7a64, spin: 1, drag: 2.2 });
    }
    // EYECTA: pedazos del suelo/edificio que vuelan y QUEDAN como escombro
    for (let i = 0; i < 12; i++) {
      const sz3 = 0.15 + Math.random() * 0.4;
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(sz3, sz3 * (0.5 + Math.random()), sz3),
        new THREE.MeshLambertMaterial({ color: [0x4a4238, 0x6b5d4a, 0x2e2a24, 0x57503f][i % 4] }));
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
      const n = 110, pos = new Float32Array(n * 3), vel = [];
      for (let i = 0; i < n; i++) {
        pos.set([p.x, p.y + 0.3, p.z], i * 3);
        const a = Math.random() * 6.283, e = Math.random() * 1.3, s2 = 9 + Math.random() * 16;
        vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * s2, Math.sin(e) * s2, Math.sin(a) * Math.cos(e) * s2));
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(gg, new THREE.PointsMaterial({
        map: TEX.dot, color: 0xffc37a, size: 0.7 * big, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      group.add(pts);
      S.parts.push({ pts, vel, t: 0, life: 1.3, grav: 22 });
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
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.4, p.z);
    group.add(ring);
    S.parts.push({ ring, t: 0, life: 0.55, big });
    // scorch persistente
    const sc = new THREE.Mesh(new THREE.CircleGeometry(2.8 * big, 22),
      new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.62, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(p.x, (heightAt ? (heightAt(p.x, p.z) ?? gy) : gy) + 0.06, p.z);
    group.add(sc);
    S.decals.push(sc);
    if (S.decals.length > 14) group.remove(S.decals.shift());
    if (nearGround) fireAftermath(new THREE.Vector3(p.x, gy, p.z));
    audio?.boom?.();
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

  return {
    state: S,
    fire(pos, yaw, pitch = -0.05) {
      if (S.ammo <= 0 || S.cool > 0) return false;
      S.ammo--; S.cool = 0.9; S.fired++;
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
      S.missiles.push({ body, glow, vel: dir.clone().multiplyScalar(56), t: 0, trail: 0 });
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
      if (S.ammo < S.MAX) { S.reload = (S.reload || 0) + dt; if (S.reload > 2.5) { S.ammo++; S.reload = 0; } }
      // ── misiles ──
      for (let i = S.missiles.length - 1; i >= 0; i--) {
        const M = S.missiles[i];
        M.t += dt;
        M.vel.y -= 2.2 * dt;
        M.body.position.addScaledVector(M.vel, dt);
        M.body.lookAt(M.body.position.clone().add(M.vel));
        M.body.rotateZ(M.t * 9);               // roll del misil
        M.glow.scale.setScalar(0.45 + Math.random() * 0.25);   // flicker de tobera
        M.trail += dt;
        if (M.trail > 0.018) {                 // estela FINA (no cono)
          M.trail = 0;
          emit(TEX.puff, M.body.position.clone(), new THREE.Vector3(0, 0.35, 0),
            0.16, 0.85, 0.75, THREE.NormalBlending, { spin: 0.6, drag: 0.4 });
        }
        const p = M.body.position;
        let hit = M.t > 6;
        const gy = heightAt ? heightAt(p.x, p.z) : null;
        if (gy != null && p.y <= gy + 0.3) { hit = true; p.y = gy + 0.3; }
        if (!hit && hittables) {
          for (const h of hittables) {
            if (h.node.userData.dead) continue;
            if (p.distanceToSquared(h.center) < h.r2) { hit = true; smash(h.node, h.color, p.clone()); break; }
          }
        }
        if (hit) {
          group.remove(M.body);
          S.missiles.splice(i, 1);
          explode(p.clone(), 1.25);
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
          P.sp.material.opacity = 1 - k * k;
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
            emit(TEX.smoke, F.p.clone().add(j).add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1.8, 0),
              0.8, 3.2, 2.6, THREE.NormalBlending, { tint0: 0x2e2b28, tint1: 0x777370, spin: 0.6, drag: 0.3 });
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
        F.vel.y -= 22 * dt;
        F.m.position.addScaledVector(F.vel, dt);
        F.m.rotation.x += F.rot.x * dt; F.m.rotation.y += F.rot.y * dt; F.m.rotation.z += F.rot.z * dt;
        const gy = heightAt ? heightAt(F.m.position.x, F.m.position.z) : null;
        let grounded = false;
        if (gy != null && F.m.position.y < gy + 0.12) {
          F.m.position.y = gy + 0.12;
          F.vel.y = Math.abs(F.vel.y) * 0.3;
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
