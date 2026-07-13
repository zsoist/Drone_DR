// flightverse/scene.js — servicio de carga de escenas (SceneManifestV2).
// Único punto donde FLIGHTVERSE materializa assets del vault en objetos three:
// terreno (heightfield métrico + orto), splat (DropInViewer en la MISMA escena),
// y muestreo de altura para vuelo/colisión honesta. Validado por el spike P1
// (docs/FLIGHTVERSE_RENDERER_DECISION.md): 3 draw calls, enter/exit sin fuga.
import * as THREE from '/flightverse/three.js?v=146';
import { OBJLoader } from '/vendor/three-addons180/loaders/OBJLoader.js?v=146';
import { MTLLoader } from '/vendor/three-addons180/loaders/MTLLoader.js?v=146';

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
  // cráter REAL: deprime el heightfield (hf + geometría). heightAt cierra
  // sobre hf, así que colisión del dron y anclaje de objetos ven el cráter.
  // Normales recalculadas SOLO en el parche (diferencias centrales del grid).
  function crater(cx, cz, r = 3.5, depth = 1.3) {
    const [sx2, sz2] = lodMeta.spacing_m;
    const W = sx2 * (cols - 1), H = sz2 * (rows - 1);
    const fx = (cx + W / 2) / sx2, fz = (cz + H / 2) / sz2;
    if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return false;
    const rx = Math.ceil(r / sx2), rz = Math.ceil(r / sz2);
    const x0 = Math.max(0, Math.floor(fx - rx)), x1 = Math.min(cols - 1, Math.ceil(fx + rx));
    const z0 = Math.max(0, Math.floor(fz - rz)), z1 = Math.min(rows - 1, Math.ceil(fz + rz));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x - fx) * sx2, (z - fz) * sz2);
      if (d > r) continue;
      const k = Math.cos((d / r) * Math.PI * 0.5);
      const i = z * cols + x;
      hf[i] -= depth * k * k;
      pos.setY(i, hf[i] - lodMeta.elev_min);
    }
    pos.needsUpdate = true;
    const nor = geo.attributes.normal;
    for (let z = Math.max(1, z0 - 1); z <= Math.min(rows - 2, z1 + 1); z++) {
      for (let x = Math.max(1, x0 - 1); x <= Math.min(cols - 2, x1 + 1); x++) {
        const i = z * cols + x;
        const dhx = (hf[i + 1] - hf[i - 1]) / (2 * sx2);
        const dhz = (hf[i + cols] - hf[i - cols]) / (2 * sz2);
        const inv = 1 / Math.hypot(dhx, 1, dhz);
        nor.setXYZ(i, -dhx * inv, inv, -dhz * inv);
      }
    }
    nor.needsUpdate = true;
    return true;
  }
  return {
    splatMask,
    mesh, hf, crater,
    heightAt: makeHeightSampler(hf, { ...lodMeta, elev_min: lodMeta.elev_min }),
    world: lodMeta,
    dispose: () => { geo.dispose(); material.map?.dispose(); material.dispose(); },
  };
}

// La física sigue usando el DSM pequeño y estable; esta capa solo dibuja la
// malla fotogramétrica del visor. En móvil usa el tier 512px (~45 MB GPU en la
// escena real), no las 73 páginas 4K originales.
export async function attachVisualMesh(man, scene, { renderer, onProgress } = {}) {
  const objUrl = man.assets?.mesh_viewer;
  // tier de texturas: móvil → low (3MB); desktop → extra/vtx (13MB, el más
  // nítido de los viewer). Los atlas ORIGINALES (geo, ~90MB) llegan después
  // vía upgradeTextures() cuando el jugador sube la calidad a extra+.
  // low SOLO para pantallas chicas: un iPad M-series puede con vtx (13MB)
  const small = matchMedia?.('(pointer:coarse)').matches
    && Math.min(screen.width, screen.height) < 700;
  const mtlUrl = (small ? null : (man.assets?.mesh_mtl_extra || man.assets?.mesh_mtl))
    || man.assets?.mesh_mtl_low;
  const offset = man.transforms?.mesh_offset;
  if (!objUrl || !mtlUrl || !Array.isArray(offset) || offset.length !== 3) return null;
  const split = url => {
    const i = url.lastIndexOf('/');
    return [url.slice(0, i + 1), url.slice(i + 1)];
  };
  const [mtlBase, mtlFile] = split(mtlUrl);
  const [objBase, objFile] = split(objUrl);
  const materials = await new MTLLoader().setPath(mtlBase).loadAsync(mtlFile);
  materials.preload();
  const object = await new OBJLoader().setMaterials(materials).setPath(objBase).loadAsync(
    objFile, ev => onProgress?.(ev.total ? ev.loaded / ev.total : null));
  const maxAniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  object.traverse(node => {
    if (!node.isMesh) return;
    const src = Array.isArray(node.material) ? node.material : [node.material];
    const photo = src.map(mat => {
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = maxAniso;
        mat.map.needsUpdate = true;
      }
      const m2 = new THREE.MeshBasicMaterial({
        map: mat.map || null, color: mat.map ? 0xffffff : 0x8a97a8,
        side: THREE.DoubleSide,
      });
      m2.name = mat.name;                     // ancla para upgradeTextures
      return m2;
    });
    node.material = photo.length === 1 ? photo[0] : photo;
    node.castShadow = false;
    node.receiveShadow = false;
  });
  // viewer.obj está centrado por su media. Restituimos el frame ODM y rotamos
  // norte (+Y OBJ) a norte (-Z mundo); Z OBJ vuelve a altura sobre elev_min.
  object.rotation.x = -Math.PI / 2;
  object.position.set(offset[0], offset[2] - man.world.elev_min, -offset[1]);
  object.name = 'fv-photogrammetry-visual';
  scene.add(object);
  // huella XZ en mundo (la usa el caller para recortar el DSM debajo)
  const bb = new THREE.Box3().setFromObject(object);
  const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  let upgraded = false;
  return {
    object,
    footprint: { x: c.x, z: c.z, r: (sz.x + sz.z) * 0.25 },
    // sube los mapas al tier dado (p.ej. atlas geo full-res) intercambiando
    // por NOMBRE de material — one-shot, perezoso, sin recrear geometría
    async upgradeTextures(newMtlUrl) {
      if (upgraded || !newMtlUrl) return false;
      upgraded = true;
      const [base2, file2] = split(newMtlUrl);
      const mats = await new MTLLoader().setPath(base2).loadAsync(file2);
      mats.preload();
      object.traverse(node => {
        if (!node.isMesh) return;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const m3 of list) {
          const src2 = mats.materials[m3.name];
          if (!src2?.map) continue;
          src2.map.colorSpace = THREE.SRGBColorSpace;
          src2.map.anisotropy = maxAniso;
          src2.map.needsUpdate = true;
          m3.map?.dispose();
          m3.map = src2.map;
          m3.needsUpdate = true;
        }
      });
      return true;
    },
    dispose: () => object.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(m => { m.map?.dispose(); m.dispose(); });
    }),
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
  const { SparkRenderer, SplatMesh } = await import('/vendor/spark.module.js?v=146');
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
