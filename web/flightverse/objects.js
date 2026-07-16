// flightverse/objects.js — OBJETOS DE ESCENA: la base para construir juegos
// sobre los splats/ODM. Lee models/<cid>/objects.json (contrato en
// docs/SCENE_OBJECTS.md) e instancia GLBs de assets/props/ o primitivas
// (ring/beacon/box) con anclaje al suelo real (heightAt), animaciones
// spin/bob y materiales emisivos. Optimizado: matrices estáticas quietas,
// un solo update() barato para los animados.
import * as THREE from '/flightverse/three.js?v=218';

const PRIMS = {
  ring: ({ color }) => new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.3, 10, 32),
    new THREE.MeshLambertMaterial({ color: color || 0x45A0E6, emissive: 0x1b4a72 })),
  beacon: ({ color }) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 4.5, 10),
      new THREE.MeshLambertMaterial({ color: 0x2a313b })));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12),
      new THREE.MeshBasicMaterial({ color: color || 0x7dffc9 }));
    orb.position.y = 2.7;
    g.add(orb);
    return g;
  },
  box: ({ color }) => new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshLambertMaterial({ color: color || 0xE0A458 })),
};

export async function loadSceneObjects(man, scene, { heightAt } = {}) {
  if (!man.assets?.objects) return null;
  let data;
  try {
    data = await (await fetch(man.assets.objects, { cache: 'no-store' })).json();
  } catch { return null; }
  if (!Array.isArray(data?.objects)) return null;

  const group = new THREE.Group();
  group.name = 'fv-objects';
  scene.add(group);
  const animated = [];
  const hittables = [];                      // objetos destruibles (armamento)
  let GLTFLoader = null;

  for (const o of data.objects) {
    let node = null;
    if ((o.type === 'glb' || o.type === 'kit') && o.file) {
      try {
        if (!GLTFLoader) ({ GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=218'));
        const base = o.type === 'kit' ? '/assets/destruction/models/' : '/assets/props/';
        const g = await new GLTFLoader().loadAsync(base + encodeURIComponent(o.file));
        node = g.scene;
        if (o.type === 'kit') {
          // contrato del destruction kit: extras en userData (roles, masas,
          // modo swap/activate, explosive) — weapons.js fractura con esto
          let root = null;
          node.traverse(n => { if (!root && n.userData.destructible) root = n; });
          if (root) {
            node.userData.kit = root.userData;
            node.traverse(n => {
              if (n.userData.initialHidden) n.visible = false;
              if (n.userData.role === 'fragments' && n.userData.initialHidden) n.visible = false;
            });
          }
        }
      } catch { continue; }               // prop ausente: se omite, no rompe
    } else if (PRIMS[o.type]) {
      node = PRIMS[o.type](o);
    }
    if (!node) continue;
    node.traverse(mm => { mm.castShadow = mm.userData.role !== 'fragment'; });
    const [x, y, z] = o.pos;
    const gy = o.ground !== false && heightAt ? (heightAt(x, z) ?? 0) : 0;
    node.position.set(x, gy + y, z);
    node.rotation.y = o.yaw || 0;
    node.scale.setScalar(o.scale || 1);
    if (o.destructible) {
      const bb = new THREE.Box3().setFromObject(node);
      const r = bb.getSize(new THREE.Vector3()).length() * 0.55;
      hittables.push({ node, center: bb.getCenter(new THREE.Vector3()), r2: r * r, color: o.color });
    }
    if (o.spin || o.bob) {
      animated.push({ node, spin: !!o.spin, bob: !!o.bob, y0: node.position.y, ph: Math.random() * 6 });
    } else {
      node.traverse(m => { m.matrixAutoUpdate = false; m.updateMatrix(); });
      node.matrixAutoUpdate = false; node.updateMatrix();
    }
    group.add(node);
  }
  return {
    group,
    hittables,
    count: group.children.length,
    update(t) {
      for (const a of animated) {
        if (a.spin) a.node.rotation.y = t * 0.8 + a.ph;
        if (a.bob) a.node.position.y = a.y0 + Math.sin(t * 1.6 + a.ph) * 0.5;
      }
    },
    dispose() { scene.remove(group); },
  };
}
