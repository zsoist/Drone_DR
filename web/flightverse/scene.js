// flightverse/scene.js — servicio de carga de escenas (SceneManifestV2).
// Único punto donde FLIGHTVERSE materializa assets del vault en objetos three:
// terreno (heightfield métrico + orto), splat (DropInViewer en la MISMA escena),
// y muestreo de altura para vuelo/colisión honesta. Validado por el spike P1
// (docs/FLIGHTVERSE_RENDERER_DECISION.md): 3 draw calls, enter/exit sin fuga.
import * as THREE from '/flightverse/three.js?v=79';

export async function loadManifest(cid) {
  const id = String(cid || '').replace(/[^\w-]/g, '');
  // no-store: el edge de Cloudflare cacheaba manifiestos viejos (misma URL,
  // contenido nuevo) → grid 512 vs bin 256 → malla NaN 'invisible' + ±NaNcm
  const r = await fetch(`data/models/${id}/scene.v2.json`, { cache: 'no-store' });
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
    fetch(man.assets.dsm_lod_meta, { cache: 'no-store' }).then(r => r.json()),
    fetch(man.assets.dsm_lod_bin).then(r => r.arrayBuffer()),
  ]);
  const hf = new Float32Array(buf);
  const [rows, cols] = lodMeta.grid;
  if (hf.length !== rows * cols) throw new Error(`terreno corrupto: bin ${hf.length} ≠ grid ${rows}×${cols} — recarga sin caché`);
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

  // UNA inyección de shader con dos deberes: (a) descartar celdas nodata
  // (adiós acantilados del borde), (b) máscara espacial de la vista mixta
  // (el splat es dueño de su huella). Consolidada aquí porque dos
  // onBeforeCompile sobre el mismo material se pisan.
  let maskTex = null;
  if (man.assets.dsm_lod_mask) {
    const mbuf = await fetch(man.assets.dsm_lod_mask).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (mbuf && mbuf.byteLength === rows * cols) {
      maskTex = new THREE.DataTexture(new Uint8Array(mbuf), cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
      maskTex.flipY = true;                 // fila 0 = norte = v alto del plano
      maskTex.needsUpdate = true;
    }
  }
  const splatMask = { uSplatOn: { value: 0 }, uSplatC: { value: new THREE.Vector2() }, uSplatR: { value: 0 } };
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, splatMask);
    if (maskTex) sh.uniforms.uValid = { value: maskTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;\nvarying vec2 vFvUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFvUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFvW = (modelMatrix * vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;\nvarying vec2 vFvUv;\nuniform float uSplatOn;uniform vec2 uSplatC;uniform float uSplatR;'
        + (maskTex ? '\nuniform sampler2D uValid;' : ''))
      .replace('#include <map_fragment>',
        (maskTex ? 'if (texture2D(uValid, vFvUv).r < 0.5) discard;\n' : '')
        + `if (uSplatOn > .5) {
             float dfv = distance(vFvW.xz, uSplatC);
             float ffv = smoothstep(uSplatR * 0.8, uSplatR, dfv);
             float nfv = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
             if (ffv < nfv) discard;
           }\n#include <map_fragment>`);
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fv-terrain';
  return {
    splatMask,
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
export async function attachSplat(man, scene, { renderer, onProgress } = {}) {
  if (!man.capabilities?.splat) throw new Error('la escena no tiene splat');
  if (!renderer) throw new Error('attachSplat necesita el renderer (SparkRenderer)');
  // Spark 2.1 (sucesor oficial de GS3D): ksplat nativo, LOD de presupuesto
  // fijo (~coste constante), sort asíncrono en worker — el splat aparece 1-2
  // frames tras el primer render, irrelevante con nuestro loop.
  const { SparkRenderer, SplatMesh } = await import('/vendor/spark.module.js?v=79');
  if (!scene.userData.fvSpark) {
    const sp = new SparkRenderer({ renderer });   // extends THREE.Mesh
    scene.userData.fvSpark = sp;
    scene.add(sp);
  }
  const tr = man.transforms?.splat;
  const aligned = tr?.status === 'aligned' && Array.isArray(tr.matrix) && tr.matrix.length === 16;
  const mesh = new SplatMesh({ url: man.assets.splat });   // URL termina en .ksplat → loader KSPLAT
  onProgress?.(40);
  await mesh.initialized;
  onProgress?.(100);
  if (aligned) {
    const m = new THREE.Matrix4();
    m.set(...tr.matrix);                      // Matrix4.set es row-major, como el JSON
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
  }
  scene.add(mesh);
  return {
    object: mesh, aligned,
    rmse: aligned ? tr.rmse_m : null,
    splats: mesh.numSplats ?? null,
    dispose: async () => {
      scene.remove(mesh);
      try { mesh.dispose?.(); } catch { /* ya liberado */ }
    },
  };
}

export async function loadTrack(man) {
  if (!man.capabilities?.track) return null;
  const r = await fetch(man.assets.track);
  if (!r.ok) return null;
  return r.json();   // {source, stats, points:[{t,lat,lon,rel_alt,abs_alt,...}]}
}
