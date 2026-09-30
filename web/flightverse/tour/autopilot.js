// flightverse/tour/autopilot.js — autopiloto Arcade v2 (WS E): curva por longitud de
// arco sobre el track real (sin jitter 1Hz), tránsito grácil al inicio, Shift acelera,
// migas de luz adelante y estela.
export function createAutopilot(ctx) {
  const { THREE, scene, state: S } = ctx;
  const $ = ctx.$;
  const apilot = { u: 0, transit: null, curve: null };
  const crumbs = [];
  const initAuto = () => {
    const ghost = S.ghost;
    if (!ghost || apilot.curve) return;
    apilot.curve = new THREE.CatmullRomCurve3(ghost.pts, false, 'catmullrom', 0.5);
    apilot.len = apilot.curve.getLength();
    const cTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const c = cv.getContext('2d'); const g = c.createRadialGradient(16,16,1,16,16,15);
      g.addColorStop(0,'rgba(125,255,201,.9)'); g.addColorStop(1,'rgba(125,255,201,0)');
      c.fillStyle = g; c.fillRect(0,0,32,32); return new THREE.CanvasTexture(cv); })();
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(1.6); sp.visible = false;
      scene.add(sp); crumbs.push(sp);
    }
  };
  const goToStart = () => {
    const drone = ctx.drone;
    if (!apilot.curve) return;
    const start = apilot.curve.getPointAt(0);
    const d = drone.pos.distanceTo(start);
    apilot.transit = { from: drone.pos.clone(), to: start, t: 0,
      dur: Math.min(4, Math.max(1, d / 26)) };
    apilot.u = 0;
  };
  const trail = [];
  const TRAIL_MAX = 200;
  const trailGeo = new THREE.BufferGeometry();
  // buffer fijo: setFromPoints dejaba el atributo del tamaño del 1er llamado (1 vértice) y WebGL no lo crece
  const trailPos = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
  trailPos.setUsage(THREE.DynamicDrawUsage);
  trailGeo.setAttribute('position', trailPos);
  trailGeo.setDrawRange(0, 0);
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: 0x7dffc9, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  trailLine.frustumCulled = false;             // bounding sphere no se recalcula al mover el buffer
  scene.add(trailLine);

  $('#vl-goto').addEventListener('click', () => goToStart());

  return {
    apilot, initAuto, goToStart,
    /** true mientras el autopiloto vuela la curva (no el tránsito inicial). */
    get flying() { return !!(apilot.curve && !apilot.transit); },
    /** Rama del paso fijo cuando el modo actual es autopiloto y hay track. */
    step(dt) {
      const drone = ctx.drone, input = ctx.input;
      initAuto();
      drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
      if (apilot.transit) {
        // vuelo grácil al inicio (easeInOut + arco de altura), NO teleport
        const tr = apilot.transit;
        tr.t += dt;
        const k = Math.min(1, tr.t / tr.dur), e = k * k * (3 - 2 * k);
        drone.pos.lerpVectors(tr.from, tr.to, e);
        drone.pos.y += Math.sin(e * Math.PI) * 6;      // arquito elegante
        drone.yaw += (Math.atan2(-(tr.to.x - tr.from.x), -(tr.to.z - tr.from.z)) - drone.yaw) * 0.06;
        if (k >= 1) apilot.transit = null;
      } else if (apilot.curve && apilot.len > 1e-3) {
        const boost = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
        apilot.u = (apilot.u + dt * (14 * (boost ? 2.5 : 1)) / apilot.len) % 1;
        const p2 = apilot.curve.getPointAt(apilot.u);
        const tan = apilot.curve.getTangentAt(apilot.u);
        drone.pos.copy(p2);
        const wy = Math.atan2(-tan.x, -tan.z);
        let dy = wy - drone.yaw;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        drone.yaw += dy * 0.12;                        // giro suave en esquinas
        drone.vel.copy(tan).multiplyScalar(14 * (boost ? 2.5 : 1));
      }
      trail.push(drone.pos.clone());
      if (trail.length > TRAIL_MAX) trail.shift();
      for (let i = 0; i < trail.length; i++) trailPos.setXYZ(i, trail[i].x, trail[i].y, trail[i].z);
      trailPos.needsUpdate = true;
      trailGeo.setDrawRange(0, trail.length);
    },
    /** Por frame: migas de luz por delante del dron (visibles solo en vuelo de curva). */
    renderCrumbs(modeAutopilot) {
      const isAuto = modeAutopilot && apilot.curve && !apilot.transit;
      crumbs.forEach((sp, i) => {
        sp.visible = !!isAuto;
        if (isAuto) {
          sp.position.copy(apilot.curve.getPointAt((apilot.u + (i + 1) * 0.012) % 1));
          sp.scale.setScalar(1.2 + Math.sin(S.simT * 4 - i * 0.9) * 0.5);
        }
      });
    },
  };
}
