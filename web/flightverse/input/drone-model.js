// flightverse/input/drone-model.js — modelo visual del dron (WS C): procedural DJI
// (~0.85 m) o GLB del operador (web/assets/drone.glb, docs/DRONE_MODEL_SPEC.md), hélices
// con inercia, luces de navegación, hardpoints para armas y bob de hover.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { deriveDroneEnvelope } from '/flightverse/drone-envelope.js?v=431';
import { STEP } from '/flightverse/runtime.js?v=431';

export function createDroneModel(ctx) {
  const { THREE, scene, renderer, drone, report, state: S } = ctx;
  // dron rediseñado: proporciones DJI (~0.85m), cuerpo bajo, brazos finos,
  // props que giran con la velocidad, gimbal frontal — solo primitivas three
  const dmesh = new THREE.Group();
  const matHull = new THREE.MeshPhongMaterial({ color: 0xdfe5ee, specular: 0x8899aa, shininess: 62, flatShading: true });
  const matGrey = new THREE.MeshPhongMaterial({ color: 0x7e8898, specular: 0x556070, shininess: 40 });
  const matDark = new THREE.MeshPhongMaterial({ color: 0x1e232b, specular: 0x334, shininess: 28 });
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.165 * (1 - t * 0.22) + 0.001, (t - 0.5) * 0.56));
  }
  const hull = new THREE.Mesh(new THREE.LatheGeometry(prof, 8), matHull);   // 8 caras = facetado Mavic
  hull.rotation.x = Math.PI / 2; hull.rotation.y = Math.PI / 8;   // arista arriba, no cara plana
  hull.scale.set(1.05, 0.55, 1);
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 8), matGrey);
  shell.rotation.x = Math.PI / 2; shell.rotation.y = Math.PI / 8;
  shell.scale.set(0.86, 0.4, 0.84); shell.position.y = 0.052;
  for (const sx of [-0.09, 0.09]) {                    // patas de aterrizaje
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.05, 4, 6), matDark);
    leg.position.set(sx, -0.085, 0.12);
    dmesh.add(leg);
  }
  const gimbal = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), matDark);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), matGrey);
  lens.rotation.x = Math.PI / 2; lens.position.z = -0.05;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10),
    new THREE.MeshBasicMaterial({ color: 0x2f6db8 }));
  glass.position.z = -0.066;
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.007, 6, 18, Math.PI), matGrey);
  cage.rotation.z = Math.PI; cage.position.z = 0.01;
  gimbal.add(gb, lens, glass, cage); gimbal.position.set(0, -0.045, -0.27);
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 })); navL.position.set(-0.3, 0, -0.32);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x34c759 })); navR.position.set(0.3, 0, -0.32);
  const sensorM = new THREE.MeshBasicMaterial({ color: 0x11151c });
  for (const sx of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.016, 10), sensorM);
    eye.position.set(sx, 0.015, -0.293); eye.rotation.x = -0.12;
    dmesh.add(eye);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.02), matDark);
  stripe.position.set(0, -0.02, -0.24);
  for (let i = 0; i < 3; i++) {                          // rejillas de ventilación traseras
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.016), matDark);
    vent.position.set(0, 0.045 - i * 0.018, 0.24);
    dmesh.add(vent);
  }
  dmesh.add(hull, shell, gimbal, navL, navR, stripe);
  const props = [];
  const navLights = [];                       // LEDs: [strobe, rojo babor, verde estribor]
  const hardpoints = [];                      // nodos hardpoint_N del GLB (anclaje de misiles)
  const propBlurs = [];                       // discos motion-blur bajo cada helice
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.27, 4, 8), matGrey);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(x * 0.2, 0.015, z * 0.21);
    arm.rotation.y = Math.atan2(-z, x * 1.4);
    arm.rotation.z = x * -0.08;                       // brazos levemente caídos
    const bellB = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.035, 12), matDark);
    bellB.position.set(x * 0.33, 0.035, z * 0.34);
    const bellT = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 14), matGrey);
    bellT.position.set(x * 0.33, 0.065, z * 0.34);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.006, 6, 16), matGrey);
    rim.rotation.x = Math.PI / 2; rim.position.set(x * 0.33, 0.052, z * 0.34);
    dmesh.add(rim);
    const prop = new THREE.Group();
    const tipM = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
    for (const a of [0, Math.PI]) {
      // pala en 2 segmentos con quiebre: raíz recta + exterior barrido (curva DJI)
      const root = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.006, 0.026), matDark);
      root.rotation.set(0.14, a, 0);
      root.position.set(Math.cos(a) * 0.065, 0, -Math.sin(a) * 0.065);
      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.005, 0.02), matDark);
      outer.rotation.set(0.09, a + 0.18, 0);
      outer.position.set(Math.cos(a + 0.13) * 0.175, 0.004, -Math.sin(a + 0.13) * 0.175);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.006, 0.021), tipM);
      tip.rotation.copy(outer.rotation);
      tip.position.set(Math.cos(a + 0.18) * 0.235, 0.007, -Math.sin(a + 0.18) * 0.235);
      prop.add(root, outer, tip);
    }
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20),
      new THREE.MeshBasicMaterial({ color: 0x9fb2c8, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    blur.rotation.x = -Math.PI / 2; blur.position.y = 0.004;
    prop.add(blur);
    prop.position.set(x * 0.33, 0.085, z * 0.34);
    props.push({ g: prop, dir: x * z > 0 ? 1 : -1 });
    dmesh.add(arm, bellB, bellT, prop);
  }
  dmesh.traverse(o => { o.castShadow = true; });
  scene.add(dmesh);
  // modelo del operador: web/assets/drone.glb (spec en docs/DRONE_MODEL_SPEC.md).
  // Se normaliza a 0.85m de envergadura, centrado, nariz -Z. Si no existe,
  // vuela el procedural de arriba.
  fetch('/assets/manifest.json?v=431', { cache: 'no-store' }).then(r => r.json()).then(async am => {
    if (!am.drone_glb) return;
    const { GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=431');
    const g = await new GLTFLoader().loadAsync('/assets/drone.glb');
    const m = g.scene;
    const bb = new THREE.Box3().setFromObject(m);
    const envelope = deriveDroneEnvelope(bb);
    if (envelope.source !== 'glb') {
      report.collision.radius_reason = envelope.reason;
      return;
    }
    m.scale.setScalar(envelope.scale);
    bb.setFromObject(m); bb.getCenter(m.position).multiplyScalar(-1);
    drone.setCollisionRadius(envelope.radius);
    report.collision.radius_m = +drone.collisionRadius.toFixed(3);
    report.collision.radius_source = envelope.source;
    while (dmesh.children.length) dmesh.remove(dmesh.children[0]);   // fuera el procedural
    props.length = 0;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    m.traverse(o => {
      o.castShadow = true;                    // el traverse del procedural corrio ANTES del swap
      o.receiveShadow = true;                 // auto-sombra (brazos sobre el cuerpo)
      if (o.isMesh && o.material) {
        for (const k of ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap', 'emissiveMap']) {
          if (o.material[k]) o.material[k].anisotropy = maxAniso;
        }
      }
      if (/^prop/i.test(o.name)) props.push({ g: o, dir: props.length % 2 ? 1 : -1 });
      if (/^hardpoint_/i.test(o.name)) hardpoints.push(o);
    });
    const mkGlow = (color, sc) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const c = cv.getContext('2d');
      const g2 = c.createRadialGradient(16, 16, 1, 16, 16, 15);
      g2.addColorStop(0, color); g2.addColorStop(0.3, color);   // núcleo duro = punto LED
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g2; c.fillRect(0, 0, 32, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(sc);
      return sp;
    };
    for (const pr of props) {
      const bl = new THREE.Mesh(new THREE.CircleGeometry(0.155, 24),
        new THREE.MeshBasicMaterial({ color: 0x9fb2c8, transparent: true, opacity: 0.08,
          side: THREE.DoubleSide, depthWrite: false }));
      bl.rotation.x = -Math.PI / 2;
      pr.g.getWorldPosition(bl.position); m.worldToLocal(bl.position); bl.position.y += 0.006;
      m.add(bl); propBlurs.push(bl);
    }
    const ledR = mkGlow('rgba(255,64,48,.95)', 0.055), ledG = mkGlow('rgba(64,255,120,.95)', 0.055),
      strobe = mkGlow('rgba(255,255,255,.95)', 0.075);
    ledR.position.set(-0.23, 0.055, -0.155); ledG.position.set(0.23, 0.055, -0.155);
    strobe.position.set(0, 0.07, 0.20);
    m.add(ledR, ledG, strobe); navLights.push(strobe, ledR, ledG);
    dmesh.add(m);
    void ctx.fx.selectWeaponModel(ctx.fx.selectedWeaponKey);
    report.customDrone = true;
  }).catch(() => { /* GLB opcional */ });
  let propSpin = 14;
  // v2: opacidad del dron (invulnerabilidad 8 Hz .4/1, cámara pegada a la malla -> 40 %)
  let matCache = null, matCount = -1, lastOpacity = 1;
  const PROP_MOTOR = [3, 0, 2, 1];             // hélice (FL, FR, BL, BR) -> motor del sim (0 FR, 1 BR, 2 BL, 3 FL)
  const setOpacity = (a) => {
    if (a === lastOpacity) return;
    let count = 0;
    dmesh.traverse(() => { count++; });
    if (!matCache || count !== matCount) {                 // el swap a GLB cambia el árbol
      matCache = new Set(); matCount = count;
      const skip = new Set(propBlurs.map(b => b.material));
      dmesh.traverse(o => {
        if (!o.material || o.isSprite) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!skip.has(m) && !(m.isMeshBasicMaterial && m.blending === THREE.AdditiveBlending)) matCache.add(m);
        }
      });
    }
    for (const m of matCache) {
      if (m.userData.fvOpacity === undefined) { m.userData.fvOpacity = m.opacity; m.userData.fvTransparent = m.transparent; }
      m.transparent = a < 1 || m.userData.fvTransparent || false;
      m.opacity = m.userData.fvOpacity * a;
    }
    lastOpacity = a;
  };
  // ── break-apart (WS F1, visual only) ─────────────────────────────────────────────────────────────
  // On a 'crash' (energyClass 'crash') the body is hidden for the whole wreck and replaced by ~24 real
  // parts (half-shells, arms, guard-ring arcs, motor bells, prop blades, gimbal, legs, LED bits) coloured
  // like the drone, flying ballistically and bouncing on terrain / structures. A 'prop' strike throws
  // two blades off. Parts live ~2.4 s and shrink out; the body comes back with the respawn.
  const fragments = { live: [], group: null, hidden: false, subscribed: false, last: 0, geo: null, mat: null, spawned: 0 };
  const buildFragKit = () => {
    if (fragments.geo) return;
    const M = (color, extra = {}) => new THREE.MeshPhongMaterial({ color, shininess: 50, specular: 0x667788, flatShading: true, ...extra });
    fragments.mat = {
      white: M(0xe9eef5), grey: M(0x9aa3b2), dark: M(0x262b33), orange: new THREE.MeshBasicMaterial({ color: 0xff8c1a }),
      red: new THREE.MeshBasicMaterial({ color: 0xff3b30 }), green: new THREE.MeshBasicMaterial({ color: 0x34c759 }),
      white_e: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    fragments.geo = {
      shell: new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI),
      arm: new THREE.CapsuleGeometry(0.02, 0.26, 3, 6),
      ring: new THREE.TorusGeometry(0.16, 0.009, 5, 12, Math.PI * 0.62),
      bell: new THREE.CylinderGeometry(0.04, 0.05, 0.05, 8),
      blade: new THREE.BoxGeometry(0.24, 0.006, 0.034),
      tip: new THREE.BoxGeometry(0.04, 0.008, 0.036),
      gimbal: new THREE.SphereGeometry(0.05, 8, 6),
      leg: new THREE.CapsuleGeometry(0.012, 0.07, 3, 5),
      led: new THREE.SphereGeometry(0.022, 6, 5),
    };
    fragments.group = new THREE.Group();
    fragments.group.name = 'fv-drone-fragments';
    scene.add(fragments.group);
  };
  const FRAG_LIFE = 2.4;
  const _fv = new THREE.Vector3(), _fc = new THREE.Vector3(), _fq = new THREE.Quaternion();
  const addFrag = (geo, mat, local, scale, speedMul = 1, up = 2.5) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.scale.setScalar(scale);
    dmesh.updateWorldMatrix(true, false);
    mesh.position.copy(local).applyMatrix4(dmesh.matrixWorld);
    mesh.quaternion.copy(dmesh.quaternion).multiply(_fq.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 1.2, Math.random() * 6.28, (Math.random() - 0.5) * 1.2)));
    _fc.copy(dmesh.position);
    const out = _fv.copy(mesh.position).sub(_fc);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize();
    const vel = out.multiplyScalar((2.2 + Math.random() * 4.5) * speedMul).clone();
    vel.y = up * (0.5 + Math.random());
    if (drone?.vel) vel.addScaledVector(drone.vel, 0.55);
    fragments.group.add(mesh);
    fragments.live.push({
      mesh, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22),
      t: 0, life: FRAG_LIFE * (0.85 + Math.random() * 0.3), s0: scale, prev: mesh.position.clone(), rest: false,
    });
    fragments.spawned += 1;
  };
  const hideBody = () => {
    if (fragments.hidden) return;
    fragments.hidden = true;
    for (const c of dmesh.children) { c.userData.fvWasVisible = c.visible; c.visible = false; }
  };
  const showBody = () => {
    if (!fragments.hidden) return;
    fragments.hidden = false;
    for (const c of dmesh.children) { if (c.userData.fvWasVisible !== undefined) c.visible = c.userData.fvWasVisible; }
  };
  const breakApart = () => {
    buildFragKit();
    const { geo, mat } = fragments;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const K = 1.35;                                             // a touch bigger than life: they must read on a phone
    addFrag(geo.shell, mat.white, v(0, 0.02, 0), K * 1.0, 0.7);
    addFrag(geo.shell, mat.grey, v(0, -0.02, 0.05), K * 0.95, 0.7, 3);
    addFrag(geo.gimbal, mat.dark, v(0, -0.045, -0.27), K, 1.1);
    addFrag(geo.led, mat.red, v(-0.23, 0.05, -0.15), K * 1.4, 1.6, 4);
    addFrag(geo.led, mat.green, v(0.23, 0.05, -0.15), K * 1.4, 1.6, 4);
    addFrag(geo.led, mat.white_e, v(0, 0.07, 0.2), K * 1.4, 1.4, 4);
    for (const sx of [-1, 1]) addFrag(geo.leg, mat.dark, v(sx * 0.09, -0.085, 0.12), K, 1.2);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addFrag(geo.arm, mat.grey, v(x * 0.2, 0.015, z * 0.21), K, 1.0);
      addFrag(geo.bell, mat.dark, v(x * 0.33, 0.04, z * 0.34), K, 1.2);
      addFrag(geo.ring, mat.white, v(x * 0.33, 0.05, z * 0.34), K, 1.3);
      addFrag(geo.blade, mat.dark, v(x * 0.33, 0.085, z * 0.34), K, 1.8, 3.5);
      addFrag(geo.tip, mat.orange, v(x * 0.4, 0.09, z * 0.34), K, 2.0, 3.5);
    }
  };
  const throwBlades = () => {
    buildFragKit();
    const { geo, mat } = fragments;
    for (const [x, z] of [[-1, -1], [1, 1]]) {
      addFrag(geo.blade, mat.dark, new THREE.Vector3(x * 0.33, 0.085, z * 0.34), 1.5, 2.2, 4);
      addFrag(geo.tip, mat.orange, new THREE.Vector3(x * 0.4, 0.09, z * 0.34), 1.5, 2.4, 4);
    }
  };
  const stepFragments = (nowMs) => {
    const dt = Math.min(0.05, Math.max(0, (nowMs - (fragments.last || nowMs)) / 1000));
    fragments.last = nowMs;
    for (let i = fragments.live.length - 1; i >= 0; i--) {
      const f = fragments.live[i];
      f.t += dt;
      if (f.t >= f.life) { fragments.group.remove(f.mesh); fragments.live.splice(i, 1); continue; }
      const k = f.t / f.life;
      f.mesh.scale.setScalar(f.s0 * (k > 0.8 ? Math.max(0.01, 1 - (k - 0.8) / 0.2) : 1));
      if (f.rest) continue;
      f.vel.y -= 14 * dt;
      f.prev.copy(f.mesh.position);
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.y += f.spin.y * dt; f.mesh.rotation.z += f.spin.z * dt;
      const hit = ctx.collision?.castSegment?.(f.prev, f.mesh.position, 0);
      if (hit && hit.point && hit.fraction < 1) {                 // structure/terrain: bounce, lose energy
        const n = hit.normal || { x: 0, y: 1, z: 0 };
        const vn = f.vel.x * n.x + f.vel.y * n.y + f.vel.z * n.z;
        f.vel.x -= 1.6 * vn * n.x; f.vel.y -= 1.6 * vn * n.y; f.vel.z -= 1.6 * vn * n.z;
        f.vel.multiplyScalar(0.55); f.spin.multiplyScalar(0.6);
        f.mesh.position.set(hit.point.x + n.x * 0.04, hit.point.y + n.y * 0.04, hit.point.z + n.z * 0.04);
      }
      const gy = ctx.terrain?.heightAt?.(f.mesh.position.x, f.mesh.position.z);
      if (gy != null && f.mesh.position.y < gy + 0.03) {
        f.mesh.position.y = gy + 0.03;
        f.vel.y = Math.abs(f.vel.y) * 0.3; f.vel.x *= 0.6; f.vel.z *= 0.6; f.spin.multiplyScalar(0.55);
        if (f.vel.length() < 0.6) f.rest = true;
      }
    }
  };
  const fragmentUpdate = () => {
    if (!fragments.subscribed && ctx.bus?.on) {
      fragments.subscribed = true;
      ctx.bus.on('crash', (d) => {
        const cls = String(d?.energyClass || '');
        const nowT = S.simT;                                  // sim clock: one break per crash even if contacts repeat
        if (cls === 'crash') { if (nowT - (fragments.lastBreak ?? -1e9) > 1.5) { fragments.lastBreak = nowT; breakApart(); } }
        else if (cls === 'prop') throwBlades();
      });
    }
    const crashing = Boolean(ctx.phys?.crash?.active);
    if (crashing && fragments.live.length) hideBody();
    else if (!crashing) showBody();
    if (fragments.live.length) stepFragments(performance.now()); else fragments.last = 0;
  };
  return {
    mesh: dmesh, props, propBlurs, navLights, hardpoints,
    /** Opacidad global del dron 0..1 (WS C: parpadeo de invulnerabilidad, cámara dentro de la malla). */
    setOpacity,
    /** QA: fragments currently flying / ever spawned. */
    fragmentStats: () => ({ live: fragments.live.length, spawned: fragments.spawned, hidden: fragments.hidden }),
    debugBreak: () => { breakApart(); hideBody(); },
    debugRestore: () => { showBody(); },
    /** Velocidad angular de hélice suavizada (la usa el audio). */
    get spin() { return propSpin; },
    /** Por frame de render: hélices con inercia, luces, bob y pose del dron (P/o = pose interpolada). */
    update(P, o) {
      fragmentUpdate();
      const phys = o.quat && ctx.phys?.active ? ctx.phys : null;     // Physics v2: actitud real + motores reales
      if (phys) {
        // cada hélice gira con su motor (lag real, daño, corte en crash)
        const m = phys.motors;
        let mean = 0;
        for (let i = 0; i < props.length; i++) {
          const sp = 70 * (m[props.length === 4 ? PROP_MOTOR[i] : i % 4] || 0);
          props[i].g.rotation.y += sp * 0.0166 * props[i].dir;       // paso de render (la malla no necesita 1/120)
          mean += sp;
        }
        propSpin = mean / Math.max(1, props.length);
        for (const bl of propBlurs) bl.material.opacity = Math.min(0.3, 0.02 + propSpin * 0.0042);
        dmesh.position.copy(P);
        dmesh.quaternion.copy(o.quat);
        let a = 1;
        if (phys.invuln > 0) a = (Math.floor(S.simT * 16) & 1) ? 0.4 : 1;   // 8 Hz
        if (ctx.droneFade) a = Math.min(a, ctx.droneFade);
        setOpacity(a);
        if (navLights.length) {
          const tk = S.simT % 1.2;
          navLights[0].material.opacity = (tk < 0.07 || (tk > 0.18 && tk < 0.25)) ? 1 : 0.04;
          const nv = 0.9 + Math.sin(S.simT * 3.1) * 0.1;
          navLights[1].material.opacity = nv; navLights[2].material.opacity = nv;
        }
        return;
      }
      // hélices con inercia (spin-up/down suave) + bob de hover premium
      propSpin += ((14 + drone.vel.length() * 3) - propSpin) * 0.06;
      for (const pr of props) pr.g.rotation.y += propSpin * STEP * pr.dir;
      for (const bl of propBlurs) bl.material.opacity = Math.min(0.3, 0.04 + propSpin * 0.0038);
      if (navLights.length) {
        const tk = S.simT % 1.2;                 // doble flash de strobe estilo aeronave
        navLights[0].material.opacity = (tk < 0.07 || (tk > 0.18 && tk < 0.25)) ? 1 : 0.04;
        const nv = 0.9 + Math.sin(S.simT * 3.1) * 0.1;   // respiración sutil, no pulso
        navLights[1].material.opacity = nv; navLights[2].material.opacity = nv;
      }
      const hover = Math.max(0, 1 - drone.vel.length() / 1.6);
      dmesh.position.y += Math.sin(S.simT * 2.1) * 0.05 * hover;
      dmesh.rotation.z += Math.sin(S.simT * 1.3) * 0.008 * hover;
      dmesh.position.copy(P);
      dmesh.rotation.set(0, o.yaw, 0, 'YXZ');
      dmesh.rotation.x = THREE.MathUtils.clamp(-drone.vel.dot(new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw))) * 0.012, -0.35, 0.35);
    },
  };
}
