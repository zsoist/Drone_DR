// flightverse/zombies.js — MODO TIERRA: horda de zombies ORIGINAL (cero assets
// de terceros; humanoide procedural de primitivas con animación de caminata).
// Los zombies solo aparecen y caminan sobre suelo CAMINABLE: heightAt válido +
// pendiente baja (nada de pararse en acantilados de la fotogrametría). Persiguen
// al dron por el plano; mueren con el armamento (se registran como hittables).
// Oleadas crecientes. Determinista con el paso fijo del juego.
import * as THREE from '/flightverse/three.js?v=113';

const SKIN = 0x5a6e4a, SKIN2 = 0x47593b, CLOTH = 0x2a2f38, BLOOD = 0x7a1518;

// pendiente máxima caminable: muestrea 4 vecinos; si el desnivel supera el
// umbral, la celda es pared/acantilado y el zombie no puede estar ahí
function walkable(heightAt, x, z, maxSlope = 4.5) {
  const g = heightAt(x, z);
  if (g == null) return null;
  const d = 2.2;
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    const n = heightAt(x + dx, z + dz);
    if (n == null || Math.abs(n - g) > maxSlope) return null;
  }
  return g;
}

function buildZombie() {
  const g = new THREE.Group();
  const skinM = new THREE.MeshLambertMaterial({ color: SKIN });
  const skin2M = new THREE.MeshLambertMaterial({ color: SKIN2 });
  const clothM = new THREE.MeshLambertMaterial({ color: CLOTH });
  // torso encorvado
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 6, 12), clothM);
  torso.position.y = 1.15; torso.rotation.x = 0.24;
  // cabeza ladeada
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), skinM);
  head.position.set(0.04, 1.62, 0.08); head.rotation.z = 0.2;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.14), skin2M);
  jaw.position.set(0.04, 1.5, 0.12);
  // brazos extendidos (la pose zombie)
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.44, 4, 8);
  const armL = new THREE.Mesh(armGeo, skinM);
  armL.position.set(-0.34, 1.24, 0.22); armL.rotation.set(1.1, 0, 0.18);
  const armR = new THREE.Mesh(armGeo, skinM);
  armR.position.set(0.34, 1.24, 0.28); armR.rotation.set(1.35, 0, -0.12);
  // piernas
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.5, 4, 8);
  const legL = new THREE.Mesh(legGeo, clothM); legL.position.set(-0.14, 0.5, 0);
  const legR = new THREE.Mesh(legGeo, clothM); legR.position.set(0.14, 0.5, 0);
  g.add(torso, head, jaw, armL, armR, legL, legR);
  g.traverse(o => { o.castShadow = true; });
  return { g, parts: { torso, head, armL, armR, legL, legR } };
}

export function createZombies(scene, { heightAt, audio, onBite } = {}) {
  const group = new THREE.Group(); group.name = 'fv-zombies'; scene.add(group);
  const Z = [];
  const S = { on: false, wave: 0, alive: 0, killed: 0, spawnAcc: 0, betweenWaves: 0, toSpawn: 0 };

  function spawnOne(around) {
    // punto caminable en un anillo alrededor del dron (12-40m)
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * 6.283, r = 12 + Math.random() * 28;
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      const gy = walkable(heightAt, x, z);
      if (gy == null) continue;
      const { g, parts } = buildZombie();
      g.position.set(x, gy, z);
      group.add(g);
      const zz = { g, parts, zombie: true, hp: 100 + S.wave * 12, phase: Math.random() * 6.283,
        speed: 1.4 + Math.random() * 1.1 + S.wave * 0.06, center: new THREE.Vector3(), r2: 1.7 };
      Z.push(zz);
      S.alive++;
      return true;
    }
    return false;
  }

  return {
    state: S,
    // los zombies vivos son objetivos del armamento (mismo contrato hittables)
    hittables: Z,
    toggle(dronePos) {
      S.on = !S.on;
      if (S.on) { S.wave = 0; S.killed = 0; S.betweenWaves = 0.5; S.toSpawn = 0; }
      else { for (const z of Z) group.remove(z.g); Z.length = 0; S.alive = 0; }
      return S.on;
    },
    // el armamento llama esto al impactar (devuelve true si el zombie muere)
    damage(zz, dmg, pos) {
      zz.hp -= dmg;
      // salpicadura de sangre (sprite corto)
      if (zz.hp <= 0) {
        zz.dead = true;
        return true;
      }
      return false;
    },
    update(dt, dronePos, weapons) {
      if (!S.on) return;
      // gestión de oleadas
      if (S.alive === 0 && S.toSpawn === 0) {
        S.betweenWaves -= dt;
        if (S.betweenWaves <= 0) {
          S.wave++;
          S.toSpawn = 4 + S.wave * 2;
          S.spawnAcc = 0;
        }
      }
      if (S.toSpawn > 0) {
        S.spawnAcc += dt;
        if (S.spawnAcc > 0.45) { S.spawnAcc = 0; if (spawnOne(dronePos)) S.toSpawn--; }
      }
      // simulación por zombie
      for (let i = Z.length - 1; i >= 0; i--) {
        const z = Z[i];
        if (z.dead || (weapons && z.g.userData.dead)) {
          group.remove(z.g); Z.splice(i, 1); S.alive--; S.killed++;
          continue;
        }
        // caminar hacia el dron POR EL SUELO (solo XZ; y = terreno)
        const dx = dronePos.x - z.g.position.x, dz = dronePos.z - z.g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.6) {
          const nx = z.g.position.x + (dx / dist) * z.speed * dt;
          const nz = z.g.position.z + (dz / dist) * z.speed * dt;
          const gy = walkable(heightAt, nx, nz);
          if (gy != null) { z.g.position.set(nx, gy, nz); }
          z.g.rotation.y = Math.atan2(dx, dz);
        }
        // animación de caminata (balanceo de piernas/brazos + bamboleo)
        z.phase += dt * z.speed * 3.2;
        z.parts.legL.rotation.x = Math.sin(z.phase) * 0.6;
        z.parts.legR.rotation.x = -Math.sin(z.phase) * 0.6;
        z.parts.armL.rotation.z = 0.18 + Math.sin(z.phase) * 0.12;
        z.parts.torso.rotation.z = Math.sin(z.phase * 0.5) * 0.08;
        z.g.position.y += Math.abs(Math.sin(z.phase)) * 0.04;
        // hittable: centro a la altura del pecho
        z.center.set(z.g.position.x, z.g.position.y + 1.15, z.g.position.z);
        // mordida si alcanza al dron
        if (dist < 2.2 && Math.abs(dronePos.y - z.g.position.y) < 3) {
          z._bite = (z._bite || 0) + dt;
          if (z._bite > 0.8) { z._bite = 0; onBite?.(); }
        }
      }
    },
    dispose() { scene.remove(group); },
  };
}
