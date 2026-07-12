// flightverse/gaterush.js — Gate Rush v2: dificultades (fácil/media/difícil),
// aros HD con spin/beacon/flash de paso, migas de luz fluyendo por la ruta,
// splits por gate. Circuito HONESTO: gates sobre la ruta del vuelo REAL
// (track GPS en frame local); sin track: anillo procedural documentado como
// fallback. Detección por proximidad en timestep fijo (determinista → replay).
import * as THREE from '/flightverse/three.js?v=107';

export const DIFFS = {
  facil:   { label: 'Fácil',   n: 8,  r: 9,   pass: 1.25, color: 0x52C79A },
  media:   { label: 'Media',   n: 10, r: 6.5, pass: 1.12, color: 0x45A0E6 },
  dificil: { label: 'Difícil', n: 13, r: 4.2, pass: 1.05, color: 0x9a6cff },
};

function glowSprite(color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 48;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(24, 24, 1, 24, 24, 23);
  g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(160,200,255,.5)');
  g.addColorStop(1, 'rgba(120,170,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color }));
  return sp;
}

export function createGateRush({ scene, trackPts, world, heightAt, difficulty = 'media' }) {
  const D = DIFFS[difficulty] || DIFFS.media;
  const GATE_R = D.r, PASS_R = GATE_R * D.pass;

  // ── curso ──
  let centers = [];
  if (trackPts?.length > 20) {
    const stepN = Math.max(1, Math.floor(trackPts.length / (D.n + 1)));
    for (let i = stepN; i < trackPts.length && centers.length < D.n; i += stepN) {
      centers.push(trackPts[i].clone());
    }
  } else {
    const R = Math.min(...world.size_m) * 0.32;
    for (let i = 0; i < D.n; i++) {
      const a = (i / D.n) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const g = heightAt(x, z);
      // difícil: altura variada = curvas de verdad
      const dy = difficulty === 'dificil' ? Math.sin(i * 2.1) * 14 : 0;
      centers.push(new THREE.Vector3(x, (g ?? 0) + 22 + dy, z));
    }
  }
  centers = centers.map(c => {                    // jamás bajo el terreno
    const g = heightAt(c.x, c.z);
    if (g != null && c.y < g + GATE_R + 2) c.y = g + GATE_R + 2;
    return c;
  });

  const grp = new THREE.Group();
  const cNext = new THREE.Color(D.color);
  const matNext = new THREE.MeshLambertMaterial({ color: D.color, emissive: cNext.clone().multiplyScalar(0.35) });
  const matIdle = new THREE.MeshLambertMaterial({ color: 0x566274 });
  const matDone = new THREE.MeshLambertMaterial({ color: 0x52C79A, transparent: true, opacity: 0.3 });
  // aros HD: torus denso + aro fino interior + glow + beam al suelo
  const ringGeo = new THREE.TorusGeometry(GATE_R, GATE_R * 0.06, 24, 96);
  const trimGeo = new THREE.TorusGeometry(GATE_R * 0.88, GATE_R * 0.018, 12, 72);
  const gates = centers.map((c, i) => {
    const next = centers[i + 1] || centers[i - 1] || c.clone().add(new THREE.Vector3(1, 0, 0));
    const m = new THREE.Mesh(ringGeo, matIdle);
    m.position.copy(c);
    m.lookAt(next);
    const trim = new THREE.Mesh(trimGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(trim);
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(GATE_R * 1.12, GATE_R * 0.11, 12, 72),
      new THREE.MeshBasicMaterial({ color: D.color, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(glow);
    // beacon: columna de luz al suelo bajo el gate activo
    const gy = heightAt(c.x, c.z) ?? (c.y - 25);
    const beamH = Math.max(4, c.y - gy);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.4, beamH, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: D.color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(c.x, gy + beamH / 2, c.z);
    grp.add(beam);
    grp.add(m);
    return { mesh: m, trim, glow, beam, center: c, passed: false };
  });

  // camino con gradiente + MIGAS de luz que fluyen hacia el siguiente gate
  const curve = new THREE.CatmullRomCurve3(centers, false, 'catmullrom', 0.35);
  const pathGeo = new THREE.TubeGeometry(curve, centers.length * 14, 0.45, 8, false);
  const nP = pathGeo.attributes.position.count;
  const colors = new Float32Array(nP * 3);
  const cA = new THREE.Color(D.color), cB = new THREE.Color(0x9a6cff);
  for (let i = 0; i < nP; i++) {
    const c2 = cA.clone().lerp(cB, 0.5 + 0.5 * Math.sin((i / nP) * Math.PI * 6));
    colors[i * 3] = c2.r; colors[i * 3 + 1] = c2.g; colors[i * 3 + 2] = c2.b;
  }
  pathGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const pathMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  grp.add(new THREE.Mesh(pathGeo, pathMat));
  const crumbs = [];
  for (let i = 0; i < 14; i++) {
    const sp = glowSprite(D.color);
    sp.scale.setScalar(1.6);
    grp.add(sp);
    crumbs.push(sp);
  }
  scene.add(grp);

  const st = {
    phase: 'idle',                 // idle | countdown | running | finished
    idx: 0, total: gates.length, difficulty,
    t: 0, countdown: 0, time: null, topSpeed: 0,
    splits: [], lastSplit: null,   // tiempos por gate (el HUD muestra el delta)
    rec: [],
  };
  let recSkip = 0;
  const flashes = [];              // anillos de celebración al pasar un gate

  function paint() {
    gates.forEach((g, i) => {
      g.mesh.material = g.passed ? matDone : (i === st.idx ? matNext : matIdle);
    });
  }
  paint();

  return {
    state: st,
    gates,
    // punto de aproximación: 16m antes del gate 0, en su eje de entrada
    approach() {
      const c0 = centers[0], c1 = centers[1] || c0.clone().add(new THREE.Vector3(1, 0, 0));
      const dir = c0.clone().sub(c1).normalize();
      return c0.clone().addScaledVector(dir, 16);
    },
    pulse(t, dt = 0.016) {
      pathMat.opacity = 0.24 + Math.sin(t * 2.6) * 0.08;
      gates.forEach((gg, i) => {
        const active = i === st.idx && st.phase !== 'finished';
        gg.glow.material.opacity = active ? 0.2 + Math.sin(t * 4) * 0.12 : 0.05;
        gg.trim.material.opacity = active ? 0.4 + Math.sin(t * 6) * 0.2 : 0.1;
        gg.beam.material.opacity = active ? 0.09 + Math.sin(t * 3) * 0.05 : 0;
        if (active) {
          gg.mesh.rotation.z += dt * 0.5;              // spin ceremonial
          const s = 1 + Math.sin(t * 3.2) * 0.025;
          gg.mesh.scale.setScalar(s);
        } else gg.mesh.scale.setScalar(1);
      });
      crumbs.forEach((sp, i) => {                      // migas fluyendo
        const u = (t * 0.022 + i / crumbs.length) % 1;
        sp.position.copy(curve.getPointAt(u));
        sp.material.opacity = 0.35 + Math.sin(t * 5 + i) * 0.25;
      });
      for (let i = flashes.length - 1; i >= 0; i--) {  // celebración de paso
        const f = flashes[i];
        f.k += dt * 2.2;
        if (f.k >= 1) { grp.remove(f.m); flashes.splice(i, 1); continue; }
        f.m.scale.setScalar(1 + f.k * 1.1);
        f.m.material.opacity = 0.7 * (1 - f.k);
      }
    },
    start() {
      gates.forEach(g => { g.passed = false; });
      st.phase = 'countdown'; st.countdown = 3; st.idx = 0; st.t = 0;
      st.time = null; st.topSpeed = 0; st.rec = []; st.splits = []; st.lastSplit = null;
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
      if ((recSkip = (recSkip + 1) % 2) === 0) {
        st.rec.push([dronePos.x, dronePos.y, dronePos.z, droneYaw]);
      }
      const g = gates[st.idx];
      if (g && dronePos.distanceTo(g.center) < PASS_R) {
        g.passed = true;
        st.splits.push(st.t);
        st.lastSplit = { t: st.t, at: st.t,
          delta: st.splits.length > 1 ? st.t - st.splits[st.splits.length - 2] : st.t };
        const fm = new THREE.Mesh(
          new THREE.TorusGeometry(GATE_R * 1.05, GATE_R * 0.05, 10, 60),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false }));
        fm.position.copy(g.center); fm.quaternion.copy(g.mesh.quaternion);
        grp.add(fm);
        flashes.push({ m: fm, k: 0 });
        st.idx++;
        paint();
        if (st.idx >= gates.length) { st.phase = 'finished'; st.time = st.t; }
      }
    },
    dispose() {
      scene.remove(grp);
      ringGeo.dispose(); trimGeo.dispose(); matNext.dispose(); matIdle.dispose(); matDone.dispose();
      pathGeo.dispose(); pathMat.dispose();
    },
  };
}

// Mejores tiempos por escena+dificultad — localStorage hasta store server-side (P9).
export function bestTime(cid, t, difficulty = 'media') {
  const k = `ab.fv.best.${cid}.gaterush.${difficulty}`;
  const prev = parseFloat(localStorage.getItem(k));
  if (t != null && (!Number.isFinite(prev) || t < prev)) {
    localStorage.setItem(k, String(t));
    return { best: t, isNew: true };
  }
  return { best: Number.isFinite(prev) ? prev : null, isNew: false };
}
