// flightverse/runtime.js — núcleo del juego: loop de timestep FIJO, input y
// física del dron. Determinismo primero: la simulación avanza en pasos de
// 1/120s con acumulador (el replay y los desafíos dependen de que la física
// NO dependa del framerate); el render interpola entre el estado previo y el
// actual con alpha. Patrón "fix your timestep" clásico.
import * as THREE from '/flightverse/three.js';

export const STEP = 1 / 120;
const MAX_STEPS = 6;             // panic cap: tab de fondo no “explota” al volver

export function createLoop({ update, render }) {
  let acc = 0, last = 0, raf = 0, running = false;
  let frames = 0, fpsT = 0, fps = 0;
  const tick = (tms) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const t = tms / 1000;
    let dt = Math.min(t - (last || t), 0.25);
    last = t;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS) { update(STEP); acc -= STEP; n++; }
    if (n === MAX_STEPS) acc = 0;         // descartar deuda: mejor saltar que congelar
    render(acc / STEP);
    frames++; fpsT += dt;
    if (fpsT >= 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  };
  const onVis = () => { if (document.hidden) pause(); else resume(); };
  function start() { running = true; last = 0; document.addEventListener('visibilitychange', onVis); raf = requestAnimationFrame(tick); }
  function pause() { running = false; cancelAnimationFrame(raf); }
  function resume() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(tick); } }
  function stop() { pause(); document.removeEventListener('visibilitychange', onVis); }
  return { start, stop, pause, resume, fps: () => fps };
}

// Input: teclado (WASD/QE/RF/Shift/Space) + mouse-look opcional (pointer lock).
// sample() devuelve ejes normalizados [-1..1] — el modo decide qué significan.
export function createInput(el) {
  const keys = new Set();
  let mouseDX = 0, mouseDY = 0, locked = false;
  const kd = e => { if (!e.repeat) keys.add(e.code); };
  const ku = e => keys.delete(e.code);
  const mm = e => { if (locked) { mouseDX += e.movementX; mouseDY += e.movementY; } };
  const lc = () => { locked = document.pointerLockElement === el; };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  addEventListener('mousemove', mm); document.addEventListener('pointerlockchange', lc);
  const ax = (neg, pos) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
  return {
    keys,
    requestLock: () => el.requestPointerLock?.(),
    releaseLock: () => document.exitPointerLock?.(),
    get locked() { return locked; },
    sample() {
      const s = {
        fwd: ax('KeyS', 'KeyW'), strafe: ax('KeyA', 'KeyD'),
        yaw: ax('KeyE', 'KeyQ'), lift: ax('KeyF', 'KeyR'),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        brake: keys.has('Space'),
        mouseDX, mouseDY,
      };
      mouseDX = 0; mouseDY = 0;
      return s;
    },
    dispose() {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      removeEventListener('mousemove', mm); document.removeEventListener('pointerlockchange', lc);
    },
  };
}

// Perfiles de vuelo — números tangibles por modo (m/s, rad/s). El modo NO es
// una skin: cambia el modelo de control (velocidad-objetivo vs tasas FPV).
export const MODES = {
  cinematico: { label: 'Cinemático', vmax: 0, tour: true },
  asistido:   { label: 'Asistido', vmax: 14, vboost: 24, vy: 5, resp: 3.2, yawRate: 1.6, autoLevel: true },
  fpv:        { label: 'FPV', vmax: 26, vboost: 38, vy: 9, resp: 1.4, yawRate: 3.4, autoLevel: false },
  arcade:     { label: 'Arcade', vmax: 34, vboost: 55, vy: 14, resp: 5.5, yawRate: 2.6, autoLevel: true },
  dios:       { label: 'Dios', vmax: 60, vboost: 160, vy: 60, resp: 8, yawRate: 2.2, autoLevel: true, noclip: true },
};

const MIN_AGL = 1.2;             // el dron nunca “entra” al terreno: piso duro honesto
const DRONE_R = 1.2;             // radio de colisión contra el proxy de edificios
const _n = new THREE.Vector3();  // scratch de la respuesta de colisión

export function createDrone({ heightAt, collide, spawn }) {
  const d = {
    pos: new THREE.Vector3(...(spawn?.position_m || [0, 60, 0])),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    prev: { pos: new THREE.Vector3(), yaw: 0, pitch: 0 },
    agl: null, crashedSoft: false, distance: 0,
  };
  d.prev.pos.copy(d.pos);

  d.step = (dt, inp, modeKey) => {
    const m = MODES[modeKey] || MODES.asistido;
    d.prev.pos.copy(d.pos); d.prev.yaw = d.yaw; d.prev.pitch = d.pitch;
    if (m.tour) return;                       // cinemático: la cámara vuela, no el dron

    d.yaw += inp.yaw * m.yawRate * dt - inp.mouseDX * 0.0022;   // teclas=tasa, mouse=directo
    d.pitch = THREE.MathUtils.clamp(d.pitch - inp.mouseDY * 0.0018, -1.2, 1.2);
    if (m.autoLevel) d.pitch *= Math.exp(-dt * 2.5);

    const vmax = inp.boost ? m.vboost : m.vmax;
    const sin = Math.sin(d.yaw), cos = Math.cos(d.yaw);
    // objetivo de velocidad en el frame del mundo a partir del heading
    const tx = (inp.fwd * -sin + inp.strafe * cos) * vmax;
    const tz = (inp.fwd * -cos - inp.strafe * sin) * vmax;
    const ty = inp.lift * m.vy + (modeKey === 'fpv' ? Math.sin(d.pitch) * inp.fwd * vmax * 0.35 : 0);
    const k = 1 - Math.exp(-dt * m.resp);
    d.vel.x += (tx - d.vel.x) * k;
    d.vel.z += (tz - d.vel.z) * k;
    d.vel.y += (ty - d.vel.y) * (1 - Math.exp(-dt * (m.resp + 1.5)));
    if (inp.brake) d.vel.multiplyScalar(Math.exp(-dt * 6));

    d.distance += d.vel.length() * dt;
    d.pos.addScaledVector(d.vel, dt);

    const ground = heightAt(d.pos.x, d.pos.z);
    d.agl = ground == null ? null : d.pos.y - ground;
    if (!m.noclip && ground != null && d.pos.y < ground + MIN_AGL) {
      d.pos.y = ground + MIN_AGL;             // clamp suave: tocar, no atravesar
      d.crashedSoft = d.vel.y < -6;
      if (d.vel.y < 0) d.vel.y = 0;
      d.vel.x *= 0.7; d.vel.z *= 0.7;         // fricción de “raspar” el suelo
    } else d.crashedSoft = false;

    // colisión precisa (proxy BVH del splat): push-out + rebote amortiguado.
    // Determinista: misma query, mismo resultado — el replay la reproduce.
    if (!m.noclip && collide) {
      const hit = collide(d.pos, DRONE_R + 0.3);
      if (hit && hit.distance < DRONE_R) {
        _n.subVectors(d.pos, hit.point);
        const len = _n.length() || 1e-6;
        _n.multiplyScalar(1 / len);
        d.pos.copy(hit.point).addScaledVector(_n, DRONE_R);
        const vn = d.vel.dot(_n);
        if (vn < 0) d.vel.addScaledVector(_n, -vn * 1.5);   // rebote 0.5
        d.vel.multiplyScalar(0.85);
        d.crashedSoft = true;
      }
    }
  };

  d.lerpPose = (alpha, outPos) => {
    outPos.lerpVectors(d.prev.pos, d.pos, alpha);
    return { yaw: THREE.MathUtils.lerp(d.prev.yaw, d.yaw, alpha),
             pitch: THREE.MathUtils.lerp(d.prev.pitch, d.pitch, alpha) };
  };
  return d;
}

// Rigs de cámara — cada rig es una función pura (drone interpolado → cámara).
// Registro extensible; C cicla. (6 de los 10 del spec; el resto con Director.)
export const RIGS = [
  { key: 'chase', label: 'Persecución', fov: 60,
    fn: (p, o, cam, dt) => {
      const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(14);
      const want = p.clone().add(back).add(new THREE.Vector3(0, 6, 0));
      cam.position.lerp(want, 1 - Math.exp(-dt * 5));
      cam.lookAt(p);
    } },
  { key: 'chase-far', label: 'Persecución lejana', fov: 55,
    fn: (p, o, cam, dt) => {
      const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(34);
      const want = p.clone().add(back).add(new THREE.Vector3(0, 16, 0));
      cam.position.lerp(want, 1 - Math.exp(-dt * 3));
      cam.lookAt(p);
    } },
  { key: 'fpv', label: 'FPV', fov: 78,
    fn: (p, o, cam) => {
      cam.position.copy(p);
      cam.rotation.set(o.pitch * 0.6, o.yaw + Math.PI, 0, 'YXZ');
    } },
  { key: 'top', label: 'Cenital', fov: 55,
    fn: (p, o, cam, dt) => {
      cam.position.lerp(p.clone().add(new THREE.Vector3(0, 90, 0.01)), 1 - Math.exp(-dt * 4));
      cam.lookAt(p);
    } },
  { key: 'orbit', label: 'Órbita', fov: 58, t: 0,
    fn: (p, o, cam, dt, rig) => {
      rig.t = (rig.t || 0) + dt * 0.25;
      cam.position.lerp(p.clone().add(new THREE.Vector3(
        Math.cos(rig.t) * 22, 10, Math.sin(rig.t) * 22)), 1 - Math.exp(-dt * 6));
      cam.lookAt(p);
    } },
  { key: 'lado', label: 'Lateral', fov: 50,
    fn: (p, o, cam, dt) => {
      const side = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw)).multiplyScalar(20);
      cam.position.lerp(p.clone().add(side).add(new THREE.Vector3(0, 4, 0)), 1 - Math.exp(-dt * 4));
      cam.lookAt(p);
    } },
];
