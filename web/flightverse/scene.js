// flightverse/scene.js — servicio de carga de escenas (SceneManifestV2).
// Único punto donde FLIGHTVERSE materializa assets del vault en objetos three:
// terreno (heightfield métrico + orto), splat (DropInViewer en la MISMA escena),
// y muestreo de altura para vuelo/colisión honesta. Validado por el spike P1
// (docs/FLIGHTVERSE_RENDERER_DECISION.md): 3 draw calls, enter/exit sin fuga.
import * as THREE from '/vendor/three.module.js';

export async function loadManifest(cid) {
  const id = String(cid || '').replace(/[^\w-]/g, '');
  const r = await fetch(`data/models/${id}/scene.v2.json`);
  if (!r.ok) throw new Error(`escena ${id}: sin manifiesto (${r.status})`);
  const man = await r.json();
  if (man.version !== 2) throw new Error(`escena ${id}: versión ${man.version} no soportada`);
  return man;
}

// Muestreo bilineal del heightfield en el frame local (origen=centro, +x=este,
// +z=sur, fila 0=norte). Devuelve altura RELATIVA al piso (elev_min) o null
// fuera del terreno — el caller decide el fallback, nunca inventamos suelo.
export function makeHeightSampler(hf, world) {
  const [rows, cols] = world.grid;
  const [sx, sz] = world.spacing_m;
  const W = sx * (cols - 1), H = sz * (rows - 1);
  return (x, z) => {
    const fx = (x + W / 2) / sx, fz = (z + H / 2) / sz;
    if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return null;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, cols - 1), z1 = Math.min(z0 + 1, rows - 1);
    const tx = fx - x0, tz = fz - z0;
    const north = hf[z0 * cols + x0] * (1 - tx) + hf[z0 * cols + x1] * tx;
    const south = hf[z1 * cols + x0] * (1 - tx) + hf[z1 * cols + x1] * tx;
    return north * (1 - tz) + south * tz - world.elev_min;
  };
}

export async function loadTerrain(man, { anisotropy = 4 } = {}) {
  if (!man.capabilities?.terrain) throw new Error('la escena no tiene terreno');
  const [lodMeta, buf] = await Promise.all([
    fetch(man.assets.dsm_lod_meta).then(r => r.json()),
    fetch(man.assets.dsm_lod_bin).then(r => r.arrayBuffer()),
  ]);
  const hf = new Float32Array(buf);
  const [rows, cols] = lodMeta.grid;
  const [Wm, Hm] = lodMeta.size_m;
  const geo = new THREE.PlaneGeometry(Wm, Hm, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hf[i] - lodMeta.elev_min);
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  let material;
  if (man.assets.ortho) {
    const tex = await new THREE.TextureLoader().loadAsync(man.assets.ortho);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    material = new THREE.MeshLambertMaterial({ map: tex });
  } else {
    material = new THREE.MeshLambertMaterial({ color: 0x39424f });
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fv-terrain';
  return {
    mesh, hf,
    heightAt: makeHeightSampler(hf, { ...lodMeta, elev_min: lodMeta.elev_min }),
    world: lodMeta,
    dispose: () => { geo.dispose(); material.map?.dispose(); material.dispose(); },
  };
}

// Splat en la escena unificada. Si transforms.splat.status === 'aligned'
// (splat_align.py: Umeyama cámaras-splat vs reconstrucción topocéntrica,
// RMSE sub-métrico), la matriz 4x4 coloca el splat SOBRE el terreno en
// metros reales. Sin alineación el caller decide colocación explícita —
// nunca se finge registro.
export async function attachSplat(man, scene, { position, scale, onProgress } = {}) {
  if (!man.capabilities?.splat) throw new Error('la escena no tiene splat');
  const GS = await import('/vendor/gaussian-splats-3d.module.min.js');
  const tr = man.transforms?.splat;
  const aligned = tr?.status === 'aligned' && Array.isArray(tr.matrix) && tr.matrix.length === 16;
  const dv = new GS.DropInViewer({
    sharedMemoryForWorkers: false, antialiased: true,
    halfPrecisionCovariancesOnGPU: true, showLoadingUI: false,
  });
  await dv.addSplatScene(man.assets.splat, {
    // alineado: la matriz subsume la rotación Z-up->Y-up; sin ella, quat legado
    rotation: aligned ? undefined : (tr?.rotation || [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]),
    splatAlphaRemovalThreshold: 8, showLoadingUI: false, progressiveLoad: false,
    onProgress: p => onProgress?.(p),
  });
  if (aligned) {
    const m = new THREE.Matrix4();
    m.set(...tr.matrix);                      // Matrix4.set es row-major, como el JSON
    m.decompose(dv.position, dv.quaternion, dv.scale);
  } else {
    if (scale) dv.scale.setScalar(scale);
    if (position) dv.position.set(...position);
  }
  scene.add(dv);
  return {
    object: dv, aligned,
    rmse: aligned ? tr.rmse_m : null,
    radius: dv.splatMesh?.maxSplatDistanceFromSceneCenter ?? null,
    dispose: async () => {
      scene.remove(dv);
      try { const p = dv.dispose?.(); if (p?.then) await p; } catch { /* ya liberado */ }
    },
  };
}

export async function loadTrack(man) {
  if (!man.capabilities?.track) return null;
  const r = await fetch(man.assets.track);
  if (!r.ok) return null;
  return r.json();   // {source, stats, points:[{t,lat,lon,rel_alt,abs_alt,...}]}
}
