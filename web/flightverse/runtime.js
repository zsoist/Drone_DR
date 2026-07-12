// flightverse/runtime.js — núcleo del juego: loop de timestep FIJO, input y
// física del dron. Determinismo primero: la simulación avanza en pasos de
// 1/120s con acumulador (el replay y los desafíos dependen de que la física
// NO dependa del framerate); el render interpola entre el estado previo y el
// actual con alpha. Patrón "fix your timestep" clásico.
import * as THREE from '/flightverse/three.js?v=70';

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
  let wheelAcc = 0;
  const wh = e => { wheelAcc += e.deltaY; e.preventDefault(); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  addEventListener('mousemove', mm); document.addEventListener('pointerlockchange', lc);
  el.addEventListener('wheel', wh, { passive: false });
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
    takeWheel() { const w = wheelAcc; wheelAcc = 0; return w; },
    dispose() {
      el.removeEventListener('wheel', wh);
      removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      removeEventListener('mousemove', mm); document.removeEventListener('pointerlockchange', lc);
    },
  };
}

// Perfiles de vuelo — números tangibles por modo (m/s, rad/s). El modo NO es
// una skin: cambia el modelo de control (velocidad-objetivo vs tasas FPV).
export const MODES = {
  cinematico: { label: 'Cinemático', vmax: 0, tour: true },
  asistido:   { label: 'Asistido', vmax: 14, vboost: 24, vy: 9, vyBoost: 16, resp: 3.2, yawRate: 1.6, autoLevel: true },
  // FPV/Arcade: 6DOF real portado de ecctrl 2.0 (MIT, c) Erdong Chen) —
  // thrust por rotor + PD de actitud + mixer; ver docs/FLIGHTVERSE ledger
  fpv:        { label: 'FPV', six: true, twr: 3.6, tilt: Math.PI / 3.6, vmaxH: 26, vmaxV: 14, yawRate: 3.4 },
  arcade:     { label: 'Arcade', six: true, twr: 5.5, tilt: Math.PI / 4, vmaxH: 34, vmaxV: 22, yawRate: 2.6 },
  dios:       { label: 'Dios', vmax: 60, vboost: 160, vy: 60, resp: 8, yawRate: 2.2, autoLevel: true, noclip: true },
};

// ── 6DOF (port ecctrl): constantes en unidades de nuestro dron (masa 1kg) ──
const G6 = 9.81, MASS6 = 1, DRAG6 = 0.25, TORQUE_RATIO = 0.6;
const TILT_P = 3.5, TILT_D = 0.6, YAW_P = 1.2, HORIZ_P = 1.0, VERT_P = 2.0;
const I6 = 0.06;                               // inercia media (caja 0.85m, 1kg)
const ROTORS6 = [                              // pares diagonales contra-rotantes
  { p: [+0.33, 0, +0.34], s: -1 }, { p: [-0.33, 0, +0.34], s: +1 },
  { p: [+0.33, 0, -0.34], s: +1 }, { p: [-0.33, 0, -0.34], s: -1 },
];
const _up = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

function step6(d, inp, m, dt) {
  const MT = (m.twr * MASS6 * G6) / 4;         // empuje máx por rotor
  const thr = Math.max(-1, Math.min(1, inp.lift));
  const yaw = Math.max(-1, Math.min(1, inp.yaw - inp.mouseDX * 0.02));
  const pit = Math.max(-1, Math.min(1, inp.fwd));
  const rol = Math.max(-1, Math.min(1, inp.strafe));
  const boost = inp.boost ? 1.4 : 1;

  const by = _v1.set(0, 1, 0).applyQuaternion(d.quat);
  const fwd = _v2.set(0, 0, -1).applyQuaternion(d.quat); fwd.y = 0; fwd.normalize();
  const right = _v3.set(1, 0, 0).applyQuaternion(d.quat); right.y = 0; right.normalize();

  // velocidad objetivo → error → aceleración pedida (clamp a g·tan(tilt))
  const vT = _v4.copy(right).multiplyScalar(rol * m.vmaxH * boost)
    .addScaledVector(fwd, pit * m.vmaxH * boost)
    .addScaledVector(_up, thr * m.vmaxV * boost);
  vT.sub(d.vel);                               // vErr
  const aV = Math.max(-G6, Math.min(G6, vT.y * VERT_P));
  const aH = vT.clone(); aH.y = 0; aH.multiplyScalar(HORIZ_P);
  const aHmax = G6 * Math.tan(m.tilt);
  if (aH.length() > aHmax) aH.setLength(aHmax);

  // hover feed-forward (auto-compensa el tilt) + PD de actitud
  const hover = Math.max(0, Math.min(1, (MASS6 * (G6 + aV)) / (4 * MT * Math.max(0.25, by.y))));
  const targetUp = aH.clone().addScaledVector(_up, G6).normalize();
  const tiltErr = new THREE.Vector3().crossVectors(by, targetUp);
  const tau = tiltErr.multiplyScalar(TILT_P)
    .addScaledVector(new THREE.Vector3(d.angVel.x, 0, d.angVel.z), -TILT_D)
    .addScaledVector(_up, (yaw * m.yawRate - d.angVel.y) * YAW_P);
  const tauBody = tau.applyQuaternion(_q1.copy(d.quat).invert());

  // mixer normalizado + fuerzas (empuje = +Y local de cada rotor)
  const maxMix = Math.min(1 - hover, hover) || 0.01;
  const F = new THREE.Vector3(0, -G6 * MASS6, 0).addScaledVector(d.vel, -DRAG6);
  const T = new THREE.Vector3();
  for (const r of ROTORS6) {
    const mix = tauBody.z * (r.p[0] > 0 ? -1 : 1) * 0.25
              + tauBody.x * (r.p[2] > 0 ? 1 : -1) * 0.25
              + tauBody.y * r.s * 0.25 / TORQUE_RATIO * 0.6;
    const t = Math.max(0, Math.min(1, hover + Math.max(-maxMix, Math.min(maxMix, mix))));
    const thrust = _v1.set(0, MT * t, 0).applyQuaternion(d.quat);
    F.add(thrust);
    const rw = _v2.set(...r.p).applyQuaternion(d.quat);
    T.add(_v3.crossVectors(rw, thrust));
    T.addScaledVector(by, r.s * TORQUE_RATIO * MT * t * 0.1);
  }
  if (inp.brake) d.vel.multiplyScalar(Math.exp(-dt * 4));
  d.vel.addScaledVector(F, dt / MASS6);
  d.pos.addScaledVector(d.vel, dt);
  d.angVel.addScaledVector(T, dt / I6);
  d.angVel.multiplyScalar(Math.exp(-dt * 1.2));           // damping aerodinámico
  // integrar quaternion: dq = 0.5·ω·q·dt
  const w = d.angVel;
  _q1.set(w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 0).multiply(d.quat);
  d.quat.x += _q1.x; d.quat.y += _q1.y; d.quat.z += _q1.z; d.quat.w += _q1.w;
  d.quat.normalize();
  // derivar yaw/pitch para rigs y HUD
  const f2 = _v1.set(0, 0, -1).applyQuaternion(d.quat);
  d.yaw = Math.atan2(-f2.x, -f2.z);
  d.pitch = Math.asin(Math.max(-1, Math.min(1, f2.y)));
}

const MIN_AGL = 1.2;             // el dron nunca “entra” al terreno: piso duro honesto
const DRONE_R = 1.2;             // radio de colisión contra el proxy de edificios
const _n = new THREE.Vector3();  // scratch de la respuesta de colisión

export function createDrone({ heightAt, collide, spawn }) {
  const d = {
    pos: new THREE.Vector3(...(spawn?.position_m || [0, 60, 0])),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(), angVel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    prev: { pos: new THREE.Vector3(), yaw: 0, pitch: 0 },
    agl: null, crashedSoft: false, distance: 0,
  };
  d.prev.pos.copy(d.pos);

  d.step = (dt, inp, modeKey) => {
    const m = MODES[modeKey] || MODES.asistido;
    d.prev.pos.copy(d.pos); d.prev.yaw = d.yaw; d.prev.pitch = d.pitch;
    if (m.tour) return;                       // cinemático: la cámara vuela, no el dron

    if (m.six) {                               // FPV/Arcade: rígido 6DOF real
      step6(d, inp, m, dt);
      d.distance += d.vel.length() * dt;
      applyWorldConstraints(d, m);
      return;
    }
    // sincronizar quat con el heading del modo asistido (cambio de modo suave)
    d.quat.setFromAxisAngle(_up, d.yaw); d.angVel.set(0, 0, 0);

    d.yaw += inp.yaw * m.yawRate * dt - inp.mouseDX * 0.0022;   // teclas=tasa, mouse=directo
    d.pitch = THREE.MathUtils.clamp(d.pitch - inp.mouseDY * 0.0018, -1.2, 1.2);
    if (m.autoLevel) d.pitch *= Math.exp(-dt * 2.5);

    const vmax = inp.boost ? m.vboost : m.vmax;
    const sin = Math.sin(d.yaw), cos = Math.cos(d.yaw);
    // objetivo de velocidad en el frame del mundo a partir del heading
    const tx = (inp.fwd * -sin + inp.strafe * cos) * vmax;
    const tz = (inp.fwd * -cos - inp.strafe * sin) * vmax;
    const vyMax = inp.boost ? (m.vyBoost || m.vy * 1.8) : m.vy;   // el turbo TAMBIÉN sube
    const ty = inp.lift * vyMax;
    const k = 1 - Math.exp(-dt * m.resp);
    d.vel.x += (tx - d.vel.x) * k;
    d.vel.z += (tz - d.vel.z) * k;
    d.vel.y += (ty - d.vel.y) * (1 - Math.exp(-dt * (m.resp + 1.5)));
    if (inp.brake) d.vel.multiplyScalar(Math.exp(-dt * 6));

    d.distance += d.vel.length() * dt;
    d.pos.addScaledVector(d.vel, dt);
    applyWorldConstraints(d, m);
  };

  function applyWorldConstraints(d, m) {
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
  }

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
      const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(8);
      const want = p.clone().add(back).add(new THREE.Vector3(0, 3.2, 0));
      cam.position.lerp(want, 1 - Math.exp(-dt * 5));
      cam.lookAt(p);
    } },
  { key: 'chase-far', label: 'Persecución lejana', fov: 55,
    fn: (p, o, cam, dt) => {
      const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(20);
      const want = p.clone().add(back).add(new THREE.Vector3(0, 8, 0));
      cam.position.lerp(want, 1 - Math.exp(-dt * 3));
      cam.lookAt(p);
    } },
  { key: 'fpv', label: 'FPV', fov: 78, hideDrone: true,
    fn: (p, o, cam) => {
      // cámara EN el gimbal (nariz -Z del cuerpo), mirando al frente del dron
      cam.position.set(
        p.x - Math.sin(o.yaw) * 0.28, p.y - 0.02, p.z - Math.cos(o.yaw) * 0.28);
      cam.rotation.set(o.pitch * 0.7, o.yaw, 0, 'YXZ');
    } },
  { key: 'top', label: 'Cenital', fov: 55,
    fn: (p, o, cam, dt) => {
      cam.position.lerp(p.clone().add(new THREE.Vector3(0, 55, 0.01)), 1 - Math.exp(-dt * 4));
      cam.lookAt(p);
    } },
  { key: 'orbit', label: 'Órbita', fov: 58, t: 0,
    fn: (p, o, cam, dt, rig) => {
      rig.t = (rig.t || 0) + dt * 0.25;
      cam.position.lerp(p.clone().add(new THREE.Vector3(
        Math.cos(rig.t) * 12, 5.5, Math.sin(rig.t) * 12)), 1 - Math.exp(-dt * 6));
      cam.lookAt(p);
    } },
  { key: 'lado', label: 'Lateral', fov: 50,
    fn: (p, o, cam, dt) => {
      const side = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw)).multiplyScalar(10);
      cam.position.lerp(p.clone().add(side).add(new THREE.Vector3(0, 2.4, 0)), 1 - Math.exp(-dt * 4));
      cam.lookAt(p);
    } },
];
