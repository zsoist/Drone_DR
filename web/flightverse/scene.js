// flightverse/scene.js — servicio de carga de escenas (SceneManifestV2).
// Único punto donde FLIGHTVERSE materializa assets del vault en objetos three:
// terreno (heightfield métrico + orto), splat (DropInViewer en la MISMA escena),
// y muestreo de altura para vuelo/colisión honesta. Validado por el spike P1
// (docs/FLIGHTVERSE_RENDERER_DECISION.md): 3 draw calls, enter/exit sin fuga.
import * as THREE from '/flightverse/three.js?v=368';
import { OBJLoader } from '/vendor/three-addons180/loaders/OBJLoader.js?v=368';
import { MTLLoader } from '/vendor/three-addons180/loaders/MTLLoader.js?v=368';
import {
  applyVisualCoverageMask, coverageMaskBytes, underTerrainHeights, patchUnderTerrainShader,
} from '/flightverse/visual-coverage.js?v=368';
import { glbDeviceTier, glbUrlFromManifest, loadGlbMesh } from '/flightverse/glb-mesh.js?v=368';
import { applyWorldLook } from '/flightverse/world-look.js?v=368';

// ruido de valor 3D barato (hash sin seno costoso) para el grano del terreno/paredes
const FX_NOISE_GLSL = `
float fvHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fvNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fvHash(i), fvHash(i + vec3(1,0,0)), f.x), mix(fvHash(i + vec3(0,1,0)), fvHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fvHash(i + vec3(0,0,1)), fvHash(i + vec3(1,0,1)), f.x), mix(fvHash(i + vec3(0,1,1)), fvHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

let sceneGenerationId = 0;
export function createSceneGeneration() {
  const token = ++sceneGenerationId;
  let current = true;
  return {
    token,
    isCurrent: () => current,
    invalidate() { current = false; },
  };
}

export async function loadManifest(cid) {
  const id = String(cid || '').replace(/[^\w-]/g, '');
  // no-store: el edge de Cloudflare cacheaba manifiestos viejos (misma URL,
  // contenido nuevo) → grid 512 vs bin 256 → malla NaN 'invisible' + ±NaNcm
  const r = await fetch(`data/models/${id}/scene.v2.json`, { cache: 'no-store' });
  if (!r.ok) throw Object.assign(new Error(`escena ${id}: sin manifiesto (${r.status})`), { status: r.status });
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

// Máscara de "datos reales" de la ortofoto: el canal alfa del webp es 0 fuera de lo fotografiado
// (el RGB ahí es basura extrapolada → cortinas rayadas / manchas negras). Se lee UNA vez a 256 px
// y produce (a) la máscara suave y (b) un color de relleno 32 px: promedio ponderado por alfa
// propagado a las celdas vacías. Sobrevive al cambio a ortho_full (jpg sin alfa). null si no hay
// lienzo o si la ortho es toda opaca.
function orthoDataMask(img) {
  try {
    const w = img?.width, h = img?.height;
    if (!(w > 0) || !(h > 0)) return null;
    const cw = 256, ch = Math.max(16, Math.round(256 * h / w));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0, cw, ch);
    const px = c.getImageData(0, 0, cw, ch).data;
    const a = new Uint8Array(cw * ch);
    let lo = 255;
    for (let i = 0; i < a.length; i++) { a[i] = px[i * 4 + 3]; if (a[i] < lo) lo = a[i]; }
    if (lo > 250) return null;
    const mk = (data, fw, fh, fmt) => {
      const t2 = new THREE.DataTexture(data, fw, fh, fmt, THREE.UnsignedByteType);
      t2.flipY = true;                            // fila 0 = norte = v alto (igual que las otras máscaras)
      t2.minFilter = t2.magFilter = THREE.LinearFilter;
      t2.generateMipmaps = false;
      t2.needsUpdate = true;
      return t2;
    };
    // relleno: celdas 8x8 px → grid 32 x (ch/8)
    const gw = cw / 8, gh = Math.ceil(ch / 8);
    const acc = new Float32Array(gw * gh * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = (y * cw + x) * 4, al = px[p + 3] / 255;
      if (al < 0.5) continue;
      const g = ((y >> 3) * gw + (x >> 3)) * 4;
      acc[g] += px[p] * al; acc[g + 1] += px[p + 1] * al; acc[g + 2] += px[p + 2] * al; acc[g + 3] += al;
    }
    const col = new Float32Array(gw * gh * 3), has = new Uint8Array(gw * gh);
    for (let g = 0; g < gw * gh; g++) {
      if (acc[g * 4 + 3] > 4) {
        has[g] = 1;
        for (let k = 0; k < 3; k++) col[g * 3 + k] = acc[g * 4 + k] / acc[g * 4 + 3];
      }
    }
    for (let it = 0; it < 40; it++) {             // difusión desde las celdas con datos hacia las vacías
      let pending = 0;
      const nh = has.slice(), nc = col.slice();
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const g = y * gw + x;
        if (has[g]) continue;
        let n = 0, r = 0, gr = 0, b = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const q = yy * gw + xx;
          if (has[q]) { n++; r += col[q * 3]; gr += col[q * 3 + 1]; b += col[q * 3 + 2]; }
        }
        if (n) { nh[g] = 1; nc[g * 3] = r / n; nc[g * 3 + 1] = gr / n; nc[g * 3 + 2] = b / n; } else pending++;
      }
      has.set(nh); col.set(nc);
      if (!pending) break;
    }
    const fill = new Uint8Array(gw * gh * 4);
    for (let g = 0; g < gw * gh; g++) {
      fill[g * 4] = col[g * 3]; fill[g * 4 + 1] = col[g * 3 + 1]; fill[g * 4 + 2] = col[g * 3 + 2]; fill[g * 4 + 3] = 255;
    }
    const fillTex = mk(fill, gw, gh, THREE.RGBAFormat);
    fillTex.colorSpace = THREE.SRGBColorSpace;
    return { mask: mk(a, cw, ch, THREE.RedFormat), fill: fillTex };
  } catch { return null; }
}

// fx: 'high' (desktop) | 'lite' (táctil) | 'off' (?fx=0). Todo el "look" del terreno cuelga de
// este nivel; 'off' es exactamente el shader anterior.
export async function loadTerrain(man, { anisotropy = 4, fx = 'high' } = {}) {
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
  let dataMaskTex = null;
  let dataFillTex = null;
  if (man.assets.ortho) {
    const tex = await new THREE.TextureLoader().loadAsync(man.assets.ortho);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    if (fx !== 'off') { const dm = orthoDataMask(tex.image); dataMaskTex = dm?.mask || null; dataFillTex = dm?.fill || null; }
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
      maskTex.minFilter = THREE.NearestFilter;
      maskTex.magFilter = THREE.NearestFilter;
      maskTex.needsUpdate = true;
    }
  }
  // borde de la isla: copia DESFOCADA de la máscara nodata (radio ≈ 6 m). El contorno crudo es
  // un serrucho de triángulos de 1-2 m contra el cielo; con esto el último tramo se funde en bruma.
  let rimTex = null;
  if (fx !== 'off' && maskTex) {
    try {
      const src = maskTex.image.data;
      const r = Math.max(2, Math.min(6, Math.round(6 / Math.min(...lodMeta.spacing_m))));
      let a = Float32Array.from(src, v => (v > 0 ? 1 : 0));
      let b = new Float32Array(a.length);
      for (let pass = 0; pass < 2; pass++) {          // 2 pasadas separables ≈ gaussiana
        for (let y = 0; y < rows; y++) {               // horizontal
          let acc = 0;
          for (let x = -r; x <= r; x++) acc += a[y * cols + Math.min(cols - 1, Math.max(0, x))];
          for (let x = 0; x < cols; x++) {
            b[y * cols + x] = acc / (2 * r + 1);
            acc += a[y * cols + Math.min(cols - 1, x + r + 1)] - a[y * cols + Math.max(0, x - r)];
          }
        }
        for (let x = 0; x < cols; x++) {               // vertical
          let acc = 0;
          for (let y = -r; y <= r; y++) acc += b[Math.min(rows - 1, Math.max(0, y)) * cols + x];
          for (let y = 0; y < rows; y++) {
            a[y * cols + x] = acc / (2 * r + 1);
            acc += b[Math.min(rows - 1, y + r + 1) * cols + x] - b[Math.max(0, y - r) * cols + x];
          }
        }
      }
      const out = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * 255);
      rimTex = new THREE.DataTexture(out, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
      rimTex.flipY = true;
      rimTex.minFilter = rimTex.magFilter = THREE.LinearFilter;
      rimTex.generateMipmaps = false;
      rimTex.needsUpdate = true;
    } catch { rimTex = null; }
  }
  let meshCoverageTex = null;
  if (man.assets.mesh_coverage) {
    const cbuf = await fetch(man.assets.mesh_coverage, { cache: 'no-store' })
      .then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (cbuf && cbuf.byteLength === rows * cols) {
      meshCoverageTex = new THREE.DataTexture(
        coverageMaskBytes(cbuf), cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
      meshCoverageTex.flipY = true;
      meshCoverageTex.minFilter = THREE.NearestFilter;
      meshCoverageTex.magFilter = THREE.NearestFilter;
      meshCoverageTex.needsUpdate = true;
    }
  }
  const splatMask = { uSplatOn: { value: 0 }, uSplatC: { value: new THREE.Vector2() }, uSplatR: { value: 0 } };
  const meshMask = {
    available: !!meshCoverageTex,
    uMeshOn: { value: 0 },
    texture: meshCoverageTex,
    worldSize: new THREE.Vector2(Wm, Hm),
    texel: new THREE.Vector2(1 / cols, 1 / rows),
  };
  const frontier = {
    uFrontierOn: { value: 1 },
    uFrontierWidth: { value: 0.055 },
    uFrontierColor: { value: new THREE.Color(0xcfe2f2) },
  };
  const hasMap = !!material.map;
  const fxOn = fx !== 'off';
  // uniformes del "look" (colores/levantamiento de sombras los ajusta volar.js por preset de cielo)
  const look = {
    uFxOn: { value: fxOn ? 1 : 0 },
    uFxDetail: { value: fx === 'high' ? 1 : 0 },
    uLift: { value: 0.5 },                       // piso de luz: fracción del albedo (sombras no negras)
    uCovTexel: { value: new THREE.Vector2(1 / cols, 1 / rows) },
  };
  material.customProgramCacheKey = () =>
    `fv-terrain|${fx}|${hasMap ? 'm' : '-'}${maskTex ? 'v' : '-'}${meshCoverageTex ? 'c' : '-'}${dataMaskTex ? 'd' : '-'}${rimTex ? 'r' : '-'}`;
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, splatMask, frontier, look, { uMeshOn: meshMask.uMeshOn });
    if (rimTex) sh.uniforms.uRim = { value: rimTex };
    if (dataMaskTex) { sh.uniforms.uDataMask = { value: dataMaskTex }; sh.uniforms.uDataFill = { value: dataFillTex }; }
    if (maskTex) sh.uniforms.uValid = { value: maskTex };
    if (meshCoverageTex) sh.uniforms.uMeshCoverage = { value: meshCoverageTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;\nvarying vec2 vFvUv;\nvarying vec3 vFvN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFvUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFvW = (modelMatrix * vec4(transformed,1.)).xyz;\nvFvN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFvW;\nvarying vec2 vFvUv;\nuniform float uSplatOn;uniform vec2 uSplatC;uniform float uSplatR;'
        + '\nuniform float uMeshOn;'
        + '\nuniform float uFrontierOn;uniform float uFrontierWidth;uniform vec3 uFrontierColor;'
        + '\nvarying vec3 vFvN;uniform float uFxOn;uniform float uFxDetail;uniform float uLift;uniform vec2 uCovTexel;'
        + (dataMaskTex ? '\nuniform sampler2D uDataMask;uniform sampler2D uDataFill;' : '')
        + (rimTex ? '\nuniform sampler2D uRim;' : '')
        + FX_NOISE_GLSL
        + (maskTex ? '\nuniform sampler2D uValid;' : '')
        + (meshCoverageTex ? '\nuniform sampler2D uMeshCoverage;' : ''))
      .replace('#include <map_fragment>',
        (maskTex ? 'if (texture2D(uValid, vFvUv).r < 0.5) discard;\n' : '')
        + (meshCoverageTex
          ? `if (uMeshOn > .5) {
               float fvCv = texture2D(uMeshCoverage, vFvUv).r;
               // misma erosión de 5 taps que visual-coverage.js (SIEMPRE, también con fx=0: la malla
               // se recorta con ella, y descartar el terreno con la máscara cruda dejaba un anillo
               // de 1 celda sin malla ni terreno = cielo)
               fvCv = min(fvCv, texture2D(uMeshCoverage, vFvUv + vec2(uCovTexel.x, 0.)).r);
               fvCv = min(fvCv, texture2D(uMeshCoverage, vFvUv - vec2(uCovTexel.x, 0.)).r);
               fvCv = min(fvCv, texture2D(uMeshCoverage, vFvUv + vec2(0., uCovTexel.y)).r);
               fvCv = min(fvCv, texture2D(uMeshCoverage, vFvUv - vec2(0., uCovTexel.y)).r);
               if (fvCv > 0.5) discard;
             }\n` : '')
        + `if (uSplatOn > .5) {
             float dfv = distance(vFvW.xz, uSplatC);
             float ffv = smoothstep(uSplatR * 0.8, uSplatR, dfv);
             float nfv = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
             if (ffv < nfv) discard;
           }\n#include <map_fragment>`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
       float fvEdge = min(min(vFvUv.x, vFvUv.y), min(1.0 - vFvUv.x, 1.0 - vFvUv.y));
       fvEdge = smoothstep(0.0, uFrontierWidth, fvEdge);
       float fvKeep = mix(1.0, fvEdge, uFrontierOn);
       diffuseColor.rgb = mix(uFrontierColor, diffuseColor.rgb, fvKeep);
       float fvRimFade = 0.0;
       if (uFxOn > .5) {
         ${rimTex ? 'fvRimFade = 1.0 - smoothstep(0.38, 0.92, texture2D(uRim, vFvUv).r);' : ''}
         ${hasMap ? `// paredes del DSM: la ortho nadir proyectada en vertical sale como cortina rayada →
         // color de mip bajo (sin rayas) + grano de estuco; el color real se conserva, solo se calma
         float fvNy = normalize(vFvN).y;
         float fvWall = 1.0 - smoothstep(0.30, 0.74, fvNy);
         vec3 fvWallCol = textureLod(map, vMapUv, 3.4).rgb;
         fvWallCol *= 0.84 + 0.22 * fvNoise(vec3(vFvW.xz * 2.3, vFvW.y * 2.3));
         diffuseColor.rgb = mix(diffuseColor.rgb, fvWallCol, fvWall * 0.92);` : ''}
         ${dataMaskTex ? `// fuera de lo fotografiado (alfa de la ortho) el barrido extrapolado se disuelve en bruma
         float fvData = texture2D(uDataMask, vFvUv).r;
         vec3 fvFill = texture2D(uDataFill, vFvUv).rgb * (0.9 + 0.2 * fvNoise(vec3(vFvW.xz * 0.35, 5.0)));
         diffuseColor.rgb = mix(fvFill, diffuseColor.rgb, smoothstep(0.08, 0.7, fvData));` : ''}
         if (uFxDetail > .5) {
           // grano de suelo cerca: la ortho (13 cm/px) se ve a 20 cm/px con poco detalle a baja altura
           float fvNear = 1.0 - smoothstep(18.0, 85.0, length(vFvW - cameraPosition));
           float fvG = fvNoise(vec3(vFvW.xz * 1.1, 3.0)) * 0.6 + fvNoise(vec3(vFvW.xz * 4.7, 7.0)) * 0.4;
           diffuseColor.rgb *= 1.0 + (fvG - 0.5) * 0.30 * fvNear;
         }
       }`);
    // piso de luz: la cara a la sombra del sol nunca baja de uLift x albedo (antes: negro puro)
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      `if (uFxOn > .5) {
         outgoingLight = max(outgoingLight, diffuseColor.rgb * uLift);
         outgoingLight = mix(outgoingLight, uFrontierColor, fvRimFade);   // contorno de la isla → bruma
       }
       #include <opaque_fragment>`);
  };

  applyWorldLook(material);          // WS E: niebla-muro del borde + disolución cercana (uniformes compartidos)
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fv-terrain';
  // respaldo bajo la malla (ver visual-coverage.js): capa de FONDO que se dibuja antes que la malla y
  // el terreno y luego limpia el depth → solo asoma donde no queda ningún píxel de malla/terreno
  // (huecos reales de la malla dentro de celdas "cubiertas"), en vez de dejar ver el cielo.
  let underMesh = null;
  if (meshCoverageTex) {
    const uh = underTerrainHeights(hf, cols, rows, {
      spacing: Math.min(...lodMeta.spacing_m), elevMin: lodMeta.elev_min });
    const ugeo = new THREE.BufferGeometry();
    ugeo.setIndex(geo.index);
    ugeo.setAttribute('uv', geo.attributes.uv);
    const upos = new Float32Array(geo.attributes.position.array);
    for (let i = 0; i < uh.length; i++) upos[i * 3 + 1] = uh[i];
    ugeo.setAttribute('position', new THREE.BufferAttribute(upos, 3));
    const umat = new THREE.MeshBasicMaterial({
      map: material.map || null, color: material.map ? 0xffffff : 0x39424f,
    });
    umat.customProgramCacheKey = () => `fv-terrain-under-v2|${maskTex ? 'v' : '-'}`;
    umat.onBeforeCompile = sh => patchUnderTerrainShader(sh, { uMeshOn: meshMask.uMeshOn, validTex: maskTex });
    applyWorldLook(umat);
    underMesh = new THREE.Mesh(ugeo, umat);
    underMesh.name = 'fv-terrain-under';
    underMesh.renderOrder = -5;                // tras el domo del cielo (-10), antes de malla/terreno (0)
    underMesh.matrixAutoUpdate = false;
    underMesh.frustumCulled = false;
    // sigue a la ortofoto (calidad extra la cambia) y a la ganancia de color del 3D
    let hazeSorted = false;
    underMesh.onBeforeRender = (_r, scene) => {
      if (umat.map !== material.map) umat.map = material.map;
      umat.color.copy(material.color);
      // el plano de bruma (sky.js, y=-7, opaco, renderOrder 0) se dibuja DESPUÉS del respaldo y, tras
      // limpiar el depth, lo taparía: debe ir antes que el respaldo (-5) para quedar debajo de él
      if (!hazeSorted) {
        const haze = scene?.getObjectByName?.('fv-haze-ground');
        if (haze) { haze.renderOrder = -6; hazeSorted = true; }
      }
    };
    // el respaldo ordena bien consigo mismo (depth) y después se borra el depth: la malla y el
    // terreno lo sobrescriben SIEMPRE, sea cual sea su profundidad
    underMesh.onAfterRender = renderer => { if (meshMask.uMeshOn.value > 0.5) renderer.clearDepth(); };
    mesh.add(underMesh);
  }
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
    splatMask, meshMask, frontier: frontier, look, fx,
    mesh, hf, crater,
    heightAt: makeHeightSampler(hf, { ...lodMeta, elev_min: lodMeta.elev_min }),
    world: lodMeta,
    dispose: () => {
      geo.dispose();
      material.map?.dispose();
      maskTex?.dispose();
      meshCoverageTex?.dispose();
      if (underMesh) { underMesh.geometry.dispose(); underMesh.material.dispose(); }
      dataMaskTex?.dispose();
      dataFillTex?.dispose();
      rimTex?.dispose();
      material.dispose();
    },
  };
}

// La física sigue usando el DSM pequeño y estable; esta capa solo dibuja la
// malla fotogramétrica del visor. En móvil usa el tier 512px (~45 MB GPU en la
// escena real), no las 73 páginas 4K originales.
export async function attachVisualMesh(
  man,
  scene,
  {
    renderer,
    onProgress,
    coverageMask = null,
    // 'auto' → GLB del tier del dispositivo si el manifiesto lo anuncia; false/'off'
    // fuerza la escalera OBJ; 'mobile'|'desktop'|'extra' fuerza ese GLB (gates).
    glb = 'auto',
  } = {},
) {
  if (glb !== false && glb !== 'off') {
    try {
      const h = await attachGlbVisualMesh(man, scene, { renderer, onProgress, coverageMask, tier: glb });
      if (h) return h;
    } catch (err) {
      // CUALQUIER fallo (red, meshopt, transcoder KTX2, GLB vacío): escalera OBJ de siempre
      console.warn('[fv] malla GLB falló, uso la escalera OBJ:', err?.message || err);
    }
  }
  return attachObjVisualMesh(man, scene, { renderer, onProgress, coverageMask });
}

// Reemplaza los materiales del GLB (PBR) por el MeshBasicMaterial unlit del camino OBJ
// + máscara de cobertura. Devuelve si algún material quedó recortado por cobertura.
function unlitFromGlb(root, { renderer, coverageMask }) {
  const maxAniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  let coverageClipped = false;
  root.traverse(node => {
    if (!node.isMesh) return;
    const src = Array.isArray(node.material) ? node.material : [node.material];
    const photo = src.map(mat => {
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = maxAniso;
      }
      const m2 = new THREE.MeshBasicMaterial({
        map: mat.map || null, color: mat.map ? 0xffffff : 0x8a97a8,
        side: THREE.DoubleSide,
      });
      m2.name = mat.name;
      coverageClipped = applyVisualCoverageMask(m2, {
        texture: coverageMask?.texture,
        worldSize: coverageMask?.worldSize,
        texel: coverageMask?.texel,
      }) || coverageClipped;
      applyWorldLook(m2);
      mat.dispose();                 // el PBR sale; el mapa se conserva en m2
      return m2;
    });
    node.material = photo.length === 1 ? photo[0] : photo;
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return coverageClipped;
}

// Malla como GLB (meshopt + KTX2): mismo marco, misma transformación y mismo material
// unlit que el OBJ. Devuelve null si el manifiesto no anuncia GLB para el tier;
// LANZA ante cualquier error (el wrapper cae al OBJ).
async function attachGlbVisualMesh(man, scene, { renderer, onProgress, coverageMask, tier }) {
  const want = tier && tier !== 'auto' ? tier : glbDeviceTier();
  const url = glbUrlFromManifest(man, want);
  const offset = man.transforms?.mesh_offset;
  if (!url || !Array.isArray(offset) || offset.length !== 3) return null;
  if (!renderer) throw new Error('GLB necesita el renderer (detectSupport KTX2)');
  const loaded = await loadGlbMesh(url, { renderer, onProgress });
  let coverageClipped;
  try {
    coverageClipped = unlitFromGlb(loaded.root, { renderer, coverageMask });
  } catch (err) {
    loaded.dispose();
    throw err;
  }
  // mismo marco que el OBJ: el GLB es el viewer.obj (centrado por su media) → misma
  // rotación norte y mismo offset (ver attachObjVisualMesh).
  const object = new THREE.Group();
  object.name = 'fv-photogrammetry-visual';
  object.userData.fvMeshSource = 'glb';
  object.userData.fvGlbTier = want;
  object.add(loaded.root);
  object.rotation.x = -Math.PI / 2;
  object.position.set(offset[0], offset[2] - man.world.elev_min, -offset[1]);
  scene.add(object);
  let current = loaded;
  let upgraded = false;
  let upgrading = null;
  let disposed = false;
  return {
    object,
    coverageClipped,
    source: 'glb',
    tier: want,
    // "calidad extra": el equivalente GLB es el tier `extra` (malla completa + atlas
    // geo). Intercambia el contenido del MISMO grupo; si falla deja el tier actual.
    async upgradeTextures() {
      if (upgraded || disposed) return false;
      if (upgrading) return upgrading;
      const extraUrl = glbUrlFromManifest(man, 'extra');
      if (!extraUrl || want === 'extra') return false;
      upgrading = (async () => {
        try {
          const next = await loadGlbMesh(extraUrl, { renderer });
          if (disposed) { next.dispose(); return false; }
          unlitFromGlb(next.root, { renderer, coverageMask });
          object.remove(current.root);
          current.dispose();
          object.add(next.root);
          current = next;
          object.userData.fvGlbTier = 'extra';
          upgraded = true;
          return true;
        } catch (err) {
          console.warn('[fv] upgrade GLB extra falló, conservo el tier actual:', err?.message || err);
          return false;
        } finally {
          upgrading = null;
        }
      })();
      return upgrading;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene.remove(object);
      current.dispose();
    },
  };
}

async function attachObjVisualMesh(
  man,
  scene,
  {
    renderer,
    onProgress,
    coverageMask = null,
  } = {},
) {
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
  let coverageClipped = false;
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
      coverageClipped = applyVisualCoverageMask(m2, {
        texture: coverageMask?.texture,
        worldSize: coverageMask?.worldSize,
        texel: coverageMask?.texel,
      }) || coverageClipped;
      applyWorldLook(m2);
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
  let upgraded = false;
  let disposed = false;
  return {
    object,
    coverageClipped,
    source: 'obj',
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
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene.remove(object);
      object.traverse(node => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(m => { m.map?.dispose(); m.dispose(); });
      });
    },
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
  const { SparkRenderer, SplatMesh } = await import('/vendor/spark.module.js?v=368');
  if (!scene.userData.fvSpark) {
    const sp = new SparkRenderer({ renderer });   // extends THREE.Mesh
    sp.userData.fvRefs = 0;
    scene.userData.fvSpark = sp;
    scene.add(sp);
  }
  const spark = scene.userData.fvSpark;
  spark.userData.fvRefs++;
  const tr = man.transforms?.splat;
  const aligned = tr?.status === 'aligned' && Array.isArray(tr.matrix) && tr.matrix.length === 16;
  let mesh;
  try {
    mesh = new SplatMesh({ url: man.assets.splat });   // URL termina en .ksplat → loader KSPLAT
    onProgress?.(40);
    await mesh.initialized;
    onProgress?.(100);
  } catch (err) {
    // carga fallida: liberar la referencia al SparkRenderer y el mesh a medias
    try { mesh?.dispose?.(); } catch { /* nada que liberar */ }
    spark.userData.fvRefs = Math.max(0, (spark.userData.fvRefs || 1) - 1);
    if (!spark.userData.fvRefs && scene.userData.fvSpark === spark) {
      scene.remove(spark);
      try { spark.dispose?.(); } catch { /* ya liberado */ }
      delete scene.userData.fvSpark;
    }
    throw err;
  }
  if (aligned) {
    const m = new THREE.Matrix4();
    m.set(...tr.matrix);                      // Matrix4.set es row-major, como el JSON
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
  }
  scene.add(mesh);
  let disposed = false;
  return {
    object: mesh, aligned,
    rmse: aligned ? tr.rmse_m : null,
    splats: mesh.numSplats ?? null,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh);
      try { mesh.dispose?.(); } catch { /* ya liberado */ }
      spark.userData.fvRefs = Math.max(0, (spark.userData.fvRefs || 1) - 1);
      if (!spark.userData.fvRefs && scene.userData.fvSpark === spark) {
        scene.remove(spark);
        try { spark.dispose?.(); } catch { /* ya liberado */ }
        delete scene.userData.fvSpark;
      }
    },
  };
}

export async function loadTrack(man) {
  if (!man.capabilities?.track) return null;
  const r = await fetch(man.assets.track);
  if (!r.ok) return null;
  return r.json();   // {source, stats, points:[{t,lat,lon,rel_alt,abs_alt,...}]}
}
