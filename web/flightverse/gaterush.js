// flightverse/gaterush.js — desafío Gate Rush (P4, slice vertical).
// Circuito HONESTO: los gates se colocan sobre la ruta del vuelo REAL (puntos
// del track GPS ya convertidos al frame local). Sin track: anillo procedural
// alrededor del centro, documentado como fallback. Detección de paso por
// proximidad al plano del gate en timestep fijo (determinista → replay).
// Grabación de poses a 60Hz para replay/ghost-de-ti-mismo.
import * as THREE from '/flightverse/three.js?v=80';

const GATE_R = 7;                 // radio del anillo (m) — generoso, es el primer reto
const PASS_R = GATE_R * 1.15;

export function createGateRush({ scene, trackPts, world, heightAt }) {
  // ── curso ──
  let centers = [];
  if (trackPts?.length > 20) {
    const stepN = Math.max(1, Math.floor(trackPts.length / 9));
    for (let i = stepN; i < trackPts.length && centers.length < 8; i += stepN) {
      centers.push(trackPts[i].clone());
    }
  } else {
    const R = Math.min(...world.size_m) * 0.32;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const g = heightAt(x, z);
      centers.push(new THREE.Vector3(x, (g ?? 0) + 22, z));
    }
  }
  // altura mínima honesta: gates jamás bajo el terreno
  centers = centers.map(c => {
    const g = heightAt(c.x, c.z);
    if (g != null && c.y < g + GATE_R + 2) c.y = g + GATE_R + 2;
    return c;
  });

  const grp = new THREE.Group();
  const matNext = new THREE.MeshLambertMaterial({ color: 0x45A0E6, emissive: 0x1b4a72 });
  const matIdle = new THREE.MeshLambertMaterial({ color: 0x566274 });
  const matDone = new THREE.MeshLambertMaterial({ color: 0x52C79A, transparent: true, opacity: 0.35 });
  const ringGeo = new THREE.TorusGeometry(GATE_R, 0.5, 10, 36);
  const gates = centers.map((c, i) => {
    const next = centers[i + 1] || centers[i - 1] || c.clone().add(new THREE.Vector3(1, 0, 0));
    const m = new THREE.Mesh(ringGeo, matIdle);
    m.position.copy(c);
    m.lookAt(next);                                 // el anillo mira al siguiente gate
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(GATE_R * 1.12, 0.9, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x45A0E6, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(glow);
    grp.add(m);
    return { mesh: m, glow, center: c, passed: false };
  });
  // CAMINO estilo Mario Galaxy: tubo aditivo con gradiente entre gates
  const curve = new THREE.CatmullRomCurve3(centers, false, 'catmullrom', 0.35);
  const pathGeo = new THREE.TubeGeometry(curve, centers.length * 14, 0.55, 8, false);
  const nP = pathGeo.attributes.position.count;
  const colors = new Float32Array(nP * 3);
  const cA = new THREE.Color(0x45A0E6), cB = new THREE.Color(0x9a6cff);
  for (let i = 0; i < nP; i++) {
    const t = (i / nP);
    const c2 = cA.clone().lerp(cB, 0.5 + 0.5 * Math.sin(t * Math.PI * 6));
    colors[i * 3] = c2.r; colors[i * 3 + 1] = c2.g; colors[i * 3 + 2] = c2.b;
  }
  pathGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const pathMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
  const path = new THREE.Mesh(pathGeo, pathMat);
  grp.add(path);
  scene.add(grp);

  const st = {
    phase: 'idle',                 // idle | countdown | running | finished
    idx: 0, total: gates.length,
    t: 0, countdown: 0, time: null, topSpeed: 0,
    rec: [],                       // poses 60Hz para replay
  };
  let recSkip = 0;

  function paint() {
    gates.forEach((g, i) => {
      g.mesh.material = g.passed ? matDone : (i === st.idx ? matNext : matIdle);
    });
  }
  paint();

  return {
    state: st,
    gates,
    pulse(t) {                                     // latido del camino + glow del gate activo
      pathMat.opacity = 0.26 + Math.sin(t * 2.6) * 0.1;
      gates.forEach((gg, i) => {
        gg.glow.material.opacity = i === st.idx ? 0.2 + Math.sin(t * 4) * 0.12 : 0.05;
      });
    },
    start() {
      gates.forEach(g => { g.passed = false; });
      st.phase = 'countdown'; st.countdown = 3; st.idx = 0; st.t = 0;
      st.time = null; st.topSpeed = 0; st.rec = [];
      paint();
    },
    update(dt, dronePos, droneVel, droneYaw) {
      if (st.phase === 'countdown') {
        st.countdown -= dt;
        if (st.countdown <= 0) { st.phase = 'running'; st.t = 0; }
        return;
      }
      if (st.phase !== 'running') return;
      st.t += dt;
      st.topSpeed = Math.max(st.topSpeed, droneVel.length());
      if ((recSkip = (recSkip + 1) % 2) === 0) {     // 120Hz sim → 60Hz de grabación
        st.rec.push([dronePos.x, dronePos.y, dronePos.z, droneYaw]);
      }
      const g = gates[st.idx];
      if (g && dronePos.distanceTo(g.center) < PASS_R) {
        g.passed = true; st.idx++;
        paint();
        if (st.idx >= gates.length) { st.phase = 'finished'; st.time = st.t; }
      }
    },
    dispose() {
      scene.remove(grp);
      ringGeo.dispose(); matNext.dispose(); matIdle.dispose(); matDone.dispose();
      pathGeo.dispose(); pathMat.dispose();
    },
  };
}

// Mejores tiempos por escena — localStorage hasta que exista store server-side
// (P9); clave con esquema propio para migrar limpio.
export function bestTime(cid, t) {
  const k = `ab.fv.best.${cid}.gaterush`;
  const prev = parseFloat(localStorage.getItem(k));
  if (t != null && (!Number.isFinite(prev) || t < prev)) {
    localStorage.setItem(k, String(t));
    return { best: t, isNew: true };
  }
  return { best: Number.isFinite(prev) ? prev : null, isNew: false };
}
