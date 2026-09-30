// flightverse/ui/onboarding.js — primer vuelo guiado de 20 s (WS A, spec §8): volar → cruzar un aro azul a 25 m
// y 3 m de altura → derribar un dron objetivo a 40 m. Saltable con ×; se guarda en localStorage
// 'ab_fv_onboarded' y no vuelve a mostrarse. Usa solo APIs públicas: ctx.drone, ctx.collision, ctx.scene,
// ctx.ui.hud.setObjective, bus 'fire'/'hit', S.sceneObjects.hittables (destruibles del armamento).
import { createMedalShelf, isOnboarded, setOnboarded } from '/flightverse/ui/records.js?v=369';

export function shouldOnboard(ctx, storage = globalThis.localStorage) {
  const { Q, AT, flags } = ctx;
  if (AT || Q.get('onboarding') === '0' || Q.get('reto') || Q.get('invasion') || Q.get('modo')) return false;
  if (Q.get('onboarding') === '1') return true;
  return flags.fv2 && !isOnboarded(storage);
}

export function createOnboarding(ctx) {
  const { THREE, scene, state: S, bus } = ctx;
  const root = document.getElementById('hx-coach');
  const text = root.querySelector('.hx-coach-t');
  const skipBtn = root.querySelector('.hx-coach-x');
  const shelf = createMedalShelf();
  let step = 'idle', t0 = 0, start = null, gate = null, decoy = null, hitEntry = null, fired = false, offs = [], active = false;
  const fwdOf = yaw => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

  const clearAt = (from, dir, dist) => {
    const to = from.clone().addScaledVector(dir, dist);
    try { return !ctx.collision?.castSegment?.(from, to, 1.6); } catch { return true; }
  };
  function pickDirection(from, yaw, dist) {
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4]) {
      const dir = fwdOf(yaw + off);
      if (clearAt(from, dir, dist + 6)) return dir;
    }
    return fwdOf(yaw);
  }
  function makeGate(pos, dir) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.14, 10, 56),
      new THREE.MeshBasicMaterial({ color: 0x45A0E6, transparent: true, opacity: 0.92, depthWrite: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(dir.x, dir.z);
    m.name = 'fv-onboard-gate';
    scene.add(m);
    return m;
  }
  function makeDecoy(pos) {
    const g = new THREE.Group(); g.name = 'fv-onboard-target';
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshStandardMaterial({ color: 0xD96A6A, emissive: 0x6a1f1f, roughness: 0.5 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0xE0A458 }));
    ring.rotation.x = Math.PI / 2;
    g.add(body, ring); g.position.copy(pos);
    scene.add(g);
    return g;
  }
  const say = (msg, where) => { text.textContent = msg; root.dataset.where = where; root.classList.add('show'); };
  const hide = () => root.classList.remove('show');

  function cleanup() {
    for (const off of offs) off(); offs = [];
    ctx.ui.hud.setObjective(null);
    for (const m of [gate, decoy]) if (m) { scene.remove(m); m.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    gate = decoy = null;
    if (hitEntry) {
      const arr = S.sceneObjects?.hittables; const i = arr ? arr.indexOf(hitEntry) : -1;
      if (i >= 0) arr.splice(i, 1);
      hitEntry = null;
    }
    S.onboardingCombat = false;
  }
  function finish(completed) {
    if (!active) return;
    active = false; step = 'done';
    cleanup(); hide();
    setOnboarded(localStorage);
    if (completed) {
      if (shelf.award('primer-vuelo', 'bronze')) bus.emit('medal', { id: 'primer-vuelo', level: 'bronze' });
      ctx.ui.screens.toast('Primer vuelo · medalla obtenida', 3600);
      ctx.audio.finish?.();
    }
    ctx.ui.hud.announce(completed ? 'Primer vuelo completado' : 'Introducción omitida');
    bus.emit('onboarding', { completed });
  }
  skipBtn.addEventListener('click', () => finish(false));

  function toGate() {
    const d = ctx.drone, dir = pickDirection(d.pos, d.yaw, 25);
    const pos = d.pos.clone().addScaledVector(dir, 25); pos.y = d.pos.y + 3;
    gate = makeGate(pos, dir);
    ctx.ui.hud.setObjective({ x: pos.x, y: pos.y, z: pos.z, label: 'Aro' });
    step = 'gate'; t0 = S.simT;
    say('Cruza el aro azul', 'center');
  }
  function toShoot() {
    ctx.ui.hud.setObjective(null);
    const d = ctx.drone, dir = pickDirection(d.pos, d.yaw, 40);
    const pos = d.pos.clone().addScaledVector(dir, 40); pos.y = d.pos.y + 1;
    decoy = makeDecoy(pos);
    hitEntry = { node: decoy, center: decoy.position, radius: 2.4, radiusSq: 5.76, color: 0xD96A6A, materialClass: 'metal' };
    S.sceneObjects?.hittables?.push(hitEntry);
    S.onboardingCombat = true;
    ctx.ui.hud.setObjective({ x: pos.x, y: pos.y, z: pos.z, label: 'Objetivo' });
    offs.push(bus.on('fire', () => { fired = true; }));
    step = 'shoot'; t0 = S.simT;
    say('Toca para disparar', 'fire');
  }

  return {
    get active() { return active; },
    start() {
      if (active) return;
      active = true; step = 'move'; t0 = S.simT; start = ctx.drone.pos.clone();
      say('Arrastra para volar', 'left');
    },
    skip: () => finish(false),
    /** Por frame (ui.update). */
    tick() {
      if (!active) return;
      const d = ctx.drone, el = S.simT - t0;
      if (ctx.ui.overlay?.active()) return;
      if (step === 'move') {
        if (d.pos.distanceTo(start) > 7 || el > 8) toGate();
      } else if (step === 'gate') {
        if (gate) { gate.rotation.z += 0.01; gate.material.opacity = 0.75 + Math.sin(S.simT * 4) * 0.17; }
        if (gate && d.pos.distanceTo(gate.position) < 4.2) {
          ctx.audio.gate?.(); ctx.ui.hud.gateFlash(); ctx.ui.hud.announce('Bien'); ctx.ui.screens.toast('Bien', 1400);
          scene.remove(gate); gate = null; toShoot();
        } else if (el > 14) { scene.remove(gate); gate = null; toShoot(); }
      } else if (step === 'shoot') {
        const dead = decoy && (decoy.userData.dead || !decoy.visible);
        if (dead || (fired && el > 6) || el > 16) finish(dead || fired);
      }
    },
    dispose() { cleanup(); },
  };
}
