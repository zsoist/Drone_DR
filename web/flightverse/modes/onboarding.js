// flightverse/modes/onboarding.js — lógica del onboarding de 20 s (spec §8, WS D).
// A dibuja los coach marks escuchando 'onboard' {step, copy, t} (ctx.enemies.events.on) o leyendo
// ctx.modes.onboarding.state. Pasos: 0–3 "Toca para empezar" · 3–8 despegue automático (1.5 s) +
// "Arrastra para volar" · 8–14 aro azul a 25 m / +3 m · 14–20 dron objetivo quieto a 40 m,
// el primer impacto termina el onboarding (medalla "Primer vuelo"). Saltable; ab_fv_onboarded.
import * as THREE from '/flightverse/three.js?v=370';
import { segmentPassesGate } from '/flightverse/collision-math.js?v=370';
import { ONBOARD_KEY, ONBOARD_STEPS, onboardStepAt } from '/flightverse/modes/rules.js?v=370';

export function createOnboarding(ctx, events) {
  const { scene, state: S, audio } = ctx;
  const flagged = () => { try { return !!localStorage.getItem(ONBOARD_KEY); } catch { return true; } };
  const st = { active: false, t: 0, step: null, tapped: false, gatePassed: false, done: false, skipped: false };
  let gate = null, target = null, takeoff = null, prevPos = null, lastStepId = '';
  const nrm = new THREE.Vector3();

  function makeGate(pos, yaw) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(4, 0.22, 14, 56),
      new THREE.MeshBasicMaterial({ color: 0x45A0E6 }));
    m.position.copy(pos); m.rotation.y = yaw;
    scene.add(m);
    return m;
  }
  function makeTarget(pos) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), new THREE.MeshLambertMaterial({ color: 0x566274 }));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.2), new THREE.MeshLambertMaterial({ color: 0x3a4048 }));
    const arm2 = arm.clone(); arm2.rotation.y = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0xD96A6A }));
    ring.rotation.x = Math.PI / 2;
    g.add(body, arm, arm2, ring);
    g.position.copy(pos);
    scene.add(g);
    // contrato de "hittable" del armamento (ver invasion.js): enemy, hp, g.userData.dead, center, radius
    return { enemy: true, blood: false, hp: 30, hpMax: 30, g, center: pos.clone(), radius: 2.4, radiusSq: 5.76, type: 'onboarding', state: 'idle' };
  }
  function cleanup() {
    if (gate) { scene.remove(gate); gate.geometry.dispose(); gate.material.dispose(); gate = null; }
    if (target) { scene.remove(target.g); target.g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); target = null; }
  }
  function finish(skipped) {
    st.active = false; st.done = true; st.skipped = !!skipped;
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
    cleanup();
    events.emit('onboard', { step: 'done', skipped: !!skipped });
    S.onboardingCombat = false;
    if (!skipped) events.emit('medal', { id: 'primer-vuelo', level: 'bronze', mode: 'onboarding', name: 'Primer vuelo' });
  }

  return {
    state: st,
    shouldRun() { return ctx.flags.fv2 && !ctx.AT && !flagged(); },
    begin() { if (st.active || flagged()) return false; Object.assign(st, { active: true, t: 0, done: false, skipped: false, tapped: false, gatePassed: false }); lastStepId = ''; return true; },
    /** A llama al pulsar "Toca para empezar" (desbloquea audio/háptica). */
    tap() { st.tapped = true; if (st.t < 3) st.t = 3; },
    skip() { if (st.active) finish(true); },
    get target() { return target; },
    /** Hittable extra mientras el objetivo existe. */
    hittables() { return target ? [target] : []; },
    update(dt) {
      if (!st.active) return;
      st.t += dt;
      const drone = ctx.drone;
      const step = onboardStepAt(st.t);
      if (step.id !== lastStepId) {
        lastStepId = step.id; st.step = step.id;
        events.emit('onboard', { step: step.id, copy: step.copy, t: +st.t.toFixed(1) });
        if (step.id === 'takeoff') takeoff = { t: 0, y0: drone.pos.y };
        if (step.id === 'gate' && !gate) {
          const fwd = new THREE.Vector3(-Math.sin(drone.yaw), 0, -Math.cos(drone.yaw));
          const pos = drone.pos.clone().addScaledVector(fwd, 25); pos.y += 3;
          gate = makeGate(pos, drone.yaw); prevPos = drone.pos.clone();
        }
        if (step.id === 'shoot') S.onboardingCombat = true;
        if (step.id === 'shoot' && !target) {
          const fwd = new THREE.Vector3(-Math.sin(drone.yaw), 0, -Math.cos(drone.yaw));
          const pos = drone.pos.clone().addScaledVector(fwd, 40); pos.y += 9;    // la cámara FPV mira ~28° arriba: entra en cuadro
          if (gate) { scene.remove(gate); gate.geometry.dispose(); gate.material.dispose(); gate = null; }
          target = makeTarget(pos);
        }
      }
      if (takeoff && takeoff.t < 1.5) {                 // despegue automático suave
        takeoff.t += dt;
        const k = Math.min(1, takeoff.t / 1.5), e = k * k * (3 - 2 * k);
        drone.prev.pos.copy(drone.pos); drone.pos.y = takeoff.y0 + 3 * e; drone.vel.y = 0;
      }
      if (gate && !st.gatePassed) {
        nrm.set(0, 0, 1).applyQuaternion(gate.quaternion);
        if (prevPos && segmentPassesGate(prevPos, drone.pos, gate.position, nrm, 4.6)) {
          st.gatePassed = true; audio.gate?.(); ctx.ui.screens.toast?.('Bien');
          events.emit('onboard', { step: 'gate-passed', copy: 'Bien', t: +st.t.toFixed(1) });
        }
        prevPos.copy(drone.pos);
      }
      if (target) {
        target.center.copy(target.g.position);
        target.g.rotation.y += dt * 0.8;
        if (target.hp < target.hpMax || target.g.userData.dead) finish(false);
      }
      if (st.t > 60) finish(true);                       // red de seguridad: nunca se queda pegado
    },
  };
}
