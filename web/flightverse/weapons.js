// flightverse/weapons.js — armamento del dron: misiles con estela, explosiones
// multicapa (flash, bola de fuego, humo, chispas, onda expansiva, scorch,
// luz puntual) y destrucción de objetos de escena (fragmentación con física).
// HONESTO: la fotogrametría es un escaneo real — recibe scorch y metralla,
// no se "rompe"; lo destruible son los objetos de juego (objects.json).
// Todo procedural (canvas + primitivas), pools reciclados, cero assets.
import * as THREE from '/flightverse/three.js?v=96';

function glowTex(stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 1, 32, 32, 31);
  for (const [p, col] of stops) g.addColorStop(p, col);
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export function createWeapons(scene, { heightAt, audio, onShake } = {}) {
  const TEX = {
    fire: glowTex([[0, 'rgba(255,240,190,1)'], [0.25, 'rgba(255,150,40,.9)'], [0.6, 'rgba(200,60,10,.45)'], [1, 'rgba(120,20,0,0)']]),
    smoke: glowTex([[0, 'rgba(70,66,62,.55)'], [0.5, 'rgba(55,52,50,.3)'], [1, 'rgba(40,40,40,0)']]),
    flash: glowTex([[0, 'rgba(255,255,240,1)'], [0.4, 'rgba(255,220,120,.6)'], [1, 'rgba(255,180,60,0)']]),
    puff: glowTex([[0, 'rgba(210,205,198,.5)'], [1, 'rgba(190,185,180,0)']]),
  };
  const S = { missiles: [], parts: [], decals: [], frags: [], ammo: 8, MAX: 8, cool: 0, fired: 0, exploded: 0 };
  const group = new THREE.Group(); group.name = 'fv-weapons'; scene.add(group);

  // cuerpo del misil compartido (clonado por disparo — 60 tris)
  const missileGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.62, 8);
  missileGeo.rotateX(Math.PI / 2);           // apunta a -Z como el dron
  const missileMat = new THREE.MeshLambertMaterial({ color: 0x39404b, emissive: 0x0d0f13 });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });

  const sprite = (tex, blending = THREE.AdditiveBlending) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, blending }));
    group.add(sp);
    return sp;
  };
  // partícula genérica: sprite con vida, velocidad, crecimiento y fade
  const emit = (tex, pos, vel, size0, size1, life, blending, tint) => {
    const sp = sprite(tex, blending);
    sp.position.copy(pos);
    if (tint) sp.material.color.set(tint);
    S.parts.push({ sp, vel, t: 0, life, size0, size1 });
  };

  function explode(p, big = 1) {
    S.exploded++;
    // flash + luz
    emit(TEX.flash, p, new THREE.Vector3(), 6 * big, 15 * big, 0.16, THREE.AdditiveBlending);
    const light = new THREE.PointLight(0xffb066, 90 * big, 60 * big, 1.8);
    light.position.copy(p).y += 1.5;
    group.add(light);
    S.parts.push({ light, t: 0, life: 0.22 });
    // bola de fuego (sprites que suben y crecen rápido)
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 6, (Math.random() - 0.5) * 7);
      emit(TEX.fire, p, v, (1.2 + Math.random() * 2) * big, (4 + Math.random() * 3) * big,
        0.45 + Math.random() * 0.25, THREE.AdditiveBlending);
    }
    // humo (lento, oscuro, dura)
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1.6 + Math.random() * 2.4, (Math.random() - 0.5) * 3);
      emit(TEX.smoke, p, v, (2 + Math.random() * 2) * big, (7 + Math.random() * 4) * big,
        1.8 + Math.random() * 1.2, THREE.NormalBlending);
    }
    // chispas: Points con gravedad
    const n = 70, pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([p.x, p.y + 0.3, p.z], i * 3);
      const a = Math.random() * 6.283, e = Math.random() * 1.35, s2 = 14 + Math.random() * 22;
      vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * s2, Math.sin(e) * s2, Math.sin(a) * Math.cos(e) * s2));
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(gg, new THREE.PointsMaterial({
      color: 0xffc37a, size: 0.55 * big, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending }));
    group.add(pts);
    S.parts.push({ pts, vel, t: 0, life: 1.0 });
    // onda expansiva a ras de suelo
    const gy = heightAt ? (heightAt(p.x, p.z) ?? p.y) : p.y;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.4, p.z);
    group.add(ring);
    S.parts.push({ ring, t: 0, life: 0.55, big });
    // scorch: marca quemada persistente sobre el terreno (máx 12, FIFO)
    const sc = new THREE.Mesh(new THREE.CircleGeometry(2.6 * big, 22),
      new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.62, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2; sc.position.set(p.x, gy + 0.06, p.z);
    group.add(sc);
    S.decals.push(sc);
    if (S.decals.length > 12) { const old = S.decals.shift(); group.remove(old); }
    audio?.boom?.();
    onShake?.(p, big);                        // el llamador escala por distancia de cámara
  }

  // fragmentación de un objeto destruible: caja → metralla que vuela y cae
  function smash(node, color) {
    const bb = new THREE.Box3().setFromObject(node);
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    node.visible = false; node.userData.dead = true;
    for (let i = 0; i < 14; i++) {
      const s = (0.14 + Math.random() * 0.22);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz.x * s, sz.y * s, sz.z * s),
        new THREE.MeshLambertMaterial({ color: color || 0xE0A458 }));
      m.position.copy(c).add(new THREE.Vector3((Math.random() - 0.5) * sz.x,
        (Math.random() - 0.5) * sz.y, (Math.random() - 0.5) * sz.z));
      m.castShadow = true;
      group.add(m);
      S.frags.push({ m, t: 0, life: 3.2,
        vel: new THREE.Vector3((Math.random() - 0.5) * 12, 5 + Math.random() * 9, (Math.random() - 0.5) * 12),
        rot: new THREE.Vector3(Math.random() * 7, Math.random() * 7, Math.random() * 7) });
    }
  }

  return {
    state: S,
    // dispara desde la posición/rumbo del dron; devuelve false si no hay munición
    fire(pos, yaw, pitch = -0.05) {
      if (S.ammo <= 0 || S.cool > 0) return false;
      S.ammo--; S.cool = 0.9; S.fired++;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const body = new THREE.Group();
      const mm = new THREE.Mesh(missileGeo, missileMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), tipMat);
      tip.rotation.x = -Math.PI / 2; tip.position.z = -0.36;
      const glow = sprite(TEX.fire); glow.scale.setScalar(0.7); glow.position.z = 0.42;
      body.add(mm, tip, glow);
      body.position.copy(pos).y -= 0.35;
      body.rotation.y = yaw;
      group.add(body);
      S.missiles.push({ body, dir, vel: dir.clone().multiplyScalar(56), t: 0, trail: 0 });
      audio?.launch?.();
      return true;
    },
    smash,
    explodeAt: explode,                       // expuesto para autotest/retos
    // objetos destruibles: chequeo esfera-punto contra la lista de hittables
    update(dt, hittables) {
      S.cool = Math.max(0, S.cool - dt);
      if (S.ammo < S.MAX) { S.reload = (S.reload || 0) + dt; if (S.reload > 2.5) { S.ammo++; S.reload = 0; } }
      // misiles
      for (let i = S.missiles.length - 1; i >= 0; i--) {
        const M = S.missiles[i];
        M.t += dt;
        M.vel.y -= 2.2 * dt;                  // caída balística leve
        M.body.position.addScaledVector(M.vel, dt);
        M.body.lookAt(M.body.position.clone().add(M.vel));
        M.trail += dt;
        if (M.trail > 0.028) {                // estela de humo
          M.trail = 0;
          emit(TEX.puff, M.body.position.clone(), new THREE.Vector3(0, 0.5, 0),
            0.5, 2.2, 0.9, THREE.NormalBlending);
        }
        const p = M.body.position;
        let hit = M.t > 6;
        const gy = heightAt ? heightAt(p.x, p.z) : null;
        if (gy != null && p.y <= gy + 0.3) { hit = true; p.y = gy + 0.3; }
        if (!hit && hittables) {
          for (const h of hittables) {
            if (h.node.userData.dead) continue;
            if (p.distanceToSquared(h.center) < h.r2) {
              hit = true;
              smash(h.node, h.color);
              break;
            }
          }
        }
        if (hit) {
          group.remove(M.body);
          S.missiles.splice(i, 1);
          explode(p.clone());
        }
      }
      // partículas
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const P = S.parts[i];
        P.t += dt;
        const k = P.t / P.life;
        if (k >= 1) {
          if (P.sp) group.remove(P.sp);
          if (P.light) group.remove(P.light);
          if (P.pts) group.remove(P.pts);
          if (P.ring) group.remove(P.ring);
          S.parts.splice(i, 1);
          continue;
        }
        if (P.sp) {
          P.sp.position.addScaledVector(P.vel, dt);
          P.vel.multiplyScalar(1 - 1.6 * dt);   // drag
          P.sp.scale.setScalar(P.size0 + (P.size1 - P.size0) * k);
          P.sp.material.opacity = 1 - k * k;
        }
        if (P.light) P.light.intensity = 90 * (1 - k);
        if (P.pts) {
          const a = P.pts.geometry.attributes.position;
          for (let j = 0; j < P.vel.length; j++) {
            P.vel[j].y -= 28 * dt;
            a.array[j * 3] += P.vel[j].x * dt;
            a.array[j * 3 + 1] += P.vel[j].y * dt;
            a.array[j * 3 + 2] += P.vel[j].z * dt;
          }
          a.needsUpdate = true;
          P.pts.material.opacity = 1 - k;
        }
        if (P.ring) {
          const r = 1 + k * 26 * (P.big || 1);
          P.ring.scale.setScalar(r);
          P.ring.material.opacity = 0.85 * (1 - k);
        }
      }
      // metralla con física simple
      for (let i = S.frags.length - 1; i >= 0; i--) {
        const F = S.frags[i];
        F.t += dt;
        if (F.t >= F.life) { group.remove(F.m); S.frags.splice(i, 1); continue; }
        F.vel.y -= 22 * dt;
        F.m.position.addScaledVector(F.vel, dt);
        F.m.rotation.x += F.rot.x * dt; F.m.rotation.y += F.rot.y * dt; F.m.rotation.z += F.rot.z * dt;
        const gy = heightAt ? heightAt(F.m.position.x, F.m.position.z) : null;
        if (gy != null && F.m.position.y < gy + 0.15) {
          F.m.position.y = gy + 0.15;
          F.vel.y = Math.abs(F.vel.y) * 0.32;   // rebote amortiguado
          F.vel.x *= 0.7; F.vel.z *= 0.7;
        }
        if (F.t > F.life - 0.6) F.m.scale.setScalar(Math.max(0.01, (F.life - F.t) / 0.6));
      }
    },
    dispose() { scene.remove(group); },
  };
}
