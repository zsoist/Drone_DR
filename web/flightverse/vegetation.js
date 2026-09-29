// flightverse/vegetation.js — W5 (docs/WORLD_UPGRADE_PLAN.md): dispersión de vegetación sobre el
// terreno DSM que la malla fotogramétrica NO cubre. Los puntos los calcula pipeline/scatter.py
// (models/<cid>/scatter.json: máscara ExG + altura nDSM, fuera de mesh_coverage); aquí solo se
// instancian: 1 InstancedMesh por tipo (4 draw calls máx.), assets CC0 de Kenney en
// /assets/vegetation/ (≤ 10 KB). Es 100% visual: sin colisión, sin sombras, sin física.
//
// Cualquier fallo (red, GLB, JSON viejo) devuelve null y el mundo sigue como antes.
import * as THREE from '/flightverse/three.js?v=363';

const V = '?v=363';
// tope de instancias por nivel (el JSON viene barajado: el prefijo es un adelgazamiento uniforme)
export const VEGETATION_CAPS = { high: 6000, lite: 1800 };
// ancho relativo al alto del GLB normalizado (1 m de alto): árboles anchos, arbusto ya viene ancho
const WIDTH = { tree_round: 1.55, tree_conifer: 1.35, tree_oak: 1.6, bush: 1.0 };

export function vegetationCap(fx) {
  return VEGETATION_CAPS[fx] || 0;
}

export function reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Función pura (probada en test_vegetation.mjs): filas del JSON → lotes por tipo con el tope aplicado.
export function planInstances(doc, cap) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.instances) || !Array.isArray(doc.types)) return null;
  const rows = doc.instances.slice(0, Math.max(0, cap | 0));
  const byType = doc.types.map(() => []);
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const t = r[5] | 0;
    if (t < 0 || t >= byType.length) continue;
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1]) || !(r[3] > 0)) continue;
    byType[t].push(r);
  }
  return byType;
}

export async function createVegetation(man, parent, {
  heightAt, fx = 'high', sway = true, signal = null,
} = {}) {
  const url = man?.assets?.scatter;
  const cap = vegetationCap(fx);
  if (!url || !cap || typeof heightAt !== 'function') return null;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const doc = await res.json();
  const batches = planInstances(doc, cap);
  if (!batches) return null;

  const { GLTFLoader } = await import(`/vendor/three-addons180/loaders/GLTFLoader.js${V}`);
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'fv-vegetation';
  const uniforms = { uVegT: { value: 0 }, uVegAmp: { value: sway ? 1 : 0 } };
  const meshes = [];
  const stats = { cap, total: 0, byType: {}, drawCalls: 0 };
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  for (let ti = 0; ti < doc.types.length; ti++) {
    const rows = batches[ti];
    if (!rows.length) continue;
    const name = String(doc.types[ti]).replace(/[^\w-]/g, '');
    const gltf = await loader.loadAsync(`/assets/vegetation/${name}.glb${V}`);
    let geo = null;
    gltf.scene.traverse(n => { if (!geo && n.isMesh) geo = n.geometry; });
    if (!geo) continue;
    geo = geo.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();   // el GLB empaquetado no lleva normales
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uVegT;uniform float uVegAmp;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // viento: balanceo en espacio del modelo (alto 1), crece con y², fase por posición de instancia
          float fvSw = position.y * position.y * uVegAmp;
          float fvPh = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
          transformed.x += sin(uVegT * 1.3 + fvPh) * 0.022 * fvSw;
          transformed.z += cos(uVegT * 1.1 + fvPh * 1.3) * 0.015 * fvSw;`);
    };
    mat.customProgramCacheKey = () => 'fv-vegetation-sway';
    const im = new THREE.InstancedMesh(geo, mat, rows.length);
    im.name = `fv-veg-${name}`;
    im.castShadow = false;
    im.receiveShadow = false;
    let n = 0;
    for (const r of rows) {
      const [x, z, g, h, yaw, , tint] = r;
      const ground = heightAt(x, z);
      if (ground == null) continue;                       // fuera del DSM válido: nunca se inventa suelo
      const wf = (WIDTH[name] || 1.4) * (0.85 + 0.3 * ((yaw * 7) % 1));
      tmpP.set(x, ground - g, z);
      tmpQ.setFromAxisAngle(up, yaw);
      tmpS.set(h * wf, h, h * wf * (0.92 + 0.16 * ((yaw * 13) % 1)));
      tmpM.compose(tmpP, tmpQ, tmpS);
      im.setMatrixAt(n, tmpM);
      // tinte = color medio de la ortho bajo el punto, aclarado (la foto viene oscura) y con
      // variación por instancia
      tmpC.setHex(tint | 0);
      const k = 0.95 + 0.30 * ((yaw * 5) % 1);
      tmpC.setRGB(Math.min(1, tmpC.r * k), Math.min(1, tmpC.g * k), Math.min(1, tmpC.b * k * 0.92));
      im.setColorAt(n, tmpC);
      n++;
    }
    if (!n) { geo.dispose(); mat.dispose(); continue; }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
    im.updateMatrix();
    group.add(im);
    meshes.push(im);
    stats.byType[name] = n;
    stats.total += n;
    stats.drawCalls++;
    gltf.scene.traverse(o => { if (o.isMesh && o.geometry !== geo) o.geometry.dispose(); });
  }
  if (!meshes.length) return null;
  parent.add(group);
  let disposed = false;
  return {
    group, stats,
    setVisible(v) { group.visible = !!v; },
    update(t) { if (sway) uniforms.uVegT.value = t; },
    dispose() {
      if (disposed) return;
      disposed = true;
      parent.remove(group);
      for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    },
  };
}
