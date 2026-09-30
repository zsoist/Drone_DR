// flightverse/glb-mesh.js — W1 (docs/WORLD_UPGRADE_PLAN.md): malla fotogramétrica como
// GLB (geometría meshopt + texturas KTX2/Basis). Módulo COMPARTIDO por Flightverse
// (scene.js) y el visor 3D (tresd.js). Todo se importa de forma DINÁMICA: si el vendor
// (GLTFLoader/KTX2Loader/MeshoptDecoder/wasm) falla, la promesa rechaza y el caller cae
// al escalón OBJ de siempre — este archivo nunca puede romper la carga del módulo padre.
//
// Contrato de marco: el GLB se genera desde el viewer.obj (pipeline/glb_export.py), así
// que va en el MISMO marco que el OBJ y el caller aplica la MISMA transformación
// (rotation.x = -PI/2 + mesh_offset). Aquí no se rota ni se traslada nada.

const V = '?v=365';
const TRANSCODER_PATH = '/vendor/three-addons180/libs/basis/';
const STALL_MS = 20000;
const DECODE_MS = 40000;

// tier de dispositivo — MISMA regla que la escalera de texturas OBJ de scene.js:
// pantalla táctil chica → mobile, todo lo demás → desktop.
export function glbDeviceTier() {
  const small = typeof matchMedia === 'function'
    && matchMedia('(pointer:coarse)').matches
    && Math.min(screen.width, screen.height) < 700;
  return small ? 'mobile' : 'desktop';
}

// URL del GLB del tier según el manifiesto v2 (capabilities.glb_mesh + assets.mesh_glb_*)
export function glbUrlFromManifest(man, tier) {
  if (!man?.capabilities?.glb_mesh) return null;
  return man.assets?.[`mesh_glb_${tier}`] || null;
}

// soporte de formatos comprimidos SIN renderer (tresd crea el renderer después de
// cargar): sonda WebGL efímera con la interfaz `extensions.has/get` que KTX2Loader usa
// (`get` solo se llama si hay ASTC — GPUs Apple: Mac e iPhone).
function probeRenderer() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('sin WebGL para detectar formatos KTX2');
  const get = name => gl.getExtension(name);
  const has = name => !!get(name);
  return {
    renderer: { extensions: { has, get }, isWebGLRenderer: true },
    release: () => gl.getExtension('WEBGL_lose_context')?.loseContext(),
  };
}

// Watchdog por inactividad (no por duración total): una red lenta que sigue avanzando no
// se corta, pero una descarga parada o un transcoder que nunca responde sí → fallback OBJ.
//   · descargando: sin eventos de progreso en STALL_MS → falla
//   · descargado: transcodificar/decodificar debe terminar en DECODE_MS → falla
function withWatchdog(start, label) {
  let last = performance.now(), downloadedAt = 0, timer;
  const dog = new Promise((_, rej) => {
    timer = setInterval(() => {
      const now = performance.now();
      if (downloadedAt ? now - downloadedAt > DECODE_MS : now - last > STALL_MS) {
        rej(new Error(`${label}: ${downloadedAt ? 'decodificación' : 'descarga'} sin respuesta`));
      }
    }, 1000);
  });
  const onProgress = ev => {
    last = performance.now();
    if (ev?.total && ev.loaded >= ev.total && !downloadedAt) downloadedAt = last;
  };
  return Promise.race([start(onProgress), dog]).finally(() => clearInterval(timer));
}

// Descarga + decodifica un GLB. Devuelve { root, dispose() } — `root` (THREE.Group) NO
// está en ninguna escena. Rechaza ante CUALQUIER error (red, meshopt, transcoder, GLB
// vacío): el caller cae al OBJ.
export async function loadGlbMesh(url, { renderer = null, onProgress = null } = {}) {
  const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import(`/vendor/three-addons180/loaders/GLTFLoader.js${V}`),
    import(`/vendor/three-addons180/loaders/KTX2Loader.js${V}`),
    import(`/vendor/three-addons180/libs/meshopt_decoder.module.js`),
  ]);
  let probe = null;
  const ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
  try {
    if (renderer) {
      ktx2.detectSupport(renderer);
    } else {
      probe = probeRenderer();
      ktx2.detectSupport(probe.renderer);
    }
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
    const gltf = await withWatchdog(dogProgress => loader.loadAsync(url, ev => {
      dogProgress(ev);
      onProgress?.(ev.total ? ev.loaded / ev.total : null);
    }), 'GLB');
    const root = gltf.scene;
    let meshes = 0, textured = 0;
    root.traverse(n => {
      if (!n.isMesh) return;
      meshes++;
      const m = Array.isArray(n.material) ? n.material[0] : n.material;
      if (m?.map) textured++;
    });
    if (!meshes || !textured) throw new Error(`GLB vacío o sin texturas (${meshes} mallas, ${textured} con mapa)`);
    return {
      root, meshes,
      dispose() {
        root.traverse(n => {
          if (!n.isMesh) return;
          n.geometry?.dispose();
          const list = Array.isArray(n.material) ? n.material : [n.material];
          list.forEach(m => { m.map?.dispose(); m.dispose?.(); });
        });
      },
    };
  } finally {
    // los workers ya transcodificaron todo; el CompressedTexture conserva sus mips
    ktx2.dispose();
    probe?.release();
  }
}
export const _probeRendererForTest = probeRenderer;
