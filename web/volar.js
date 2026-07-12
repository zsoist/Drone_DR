// volar.js — FLIGHTVERSE /volar: vuelo jugable sobre la escena real (P3).
// Escena unificada (terreno DSM+orto vía flightverse/scene.js) + dron con
// física de timestep fijo (flightverse/runtime.js) + ghost del vuelo REAL
// (track GPS 1Hz interpolado — el dato más honesto del juego: eso voló ahí).
// HUD: arquitectura de 4 esquinas + barra inferior, cero solapamientos.
// ?autotest=1 → 5s de vuelo sintético y reporte en window.__volar (gate CDP).
import * as THREE from '/flightverse/three.js?v=104';
import { loadManifest, loadTerrain, loadTrack, attachSplat } from '/flightverse/scene.js?v=104';
import { createLoop, createInput, createDrone, MODES, RIGS, STEP } from '/flightverse/runtime.js?v=104';
import { createGateRush, bestTime } from '/flightverse/gaterush.js?v=104';
import { createRecorder } from '/flightverse/recorder.js?v=104';
import { createAudio } from '/flightverse/audio.js?v=104';
import { createTouchSticks } from '/flightverse/touch.js?v=104';
import { createSky } from '/flightverse/sky.js?v=104';
import { loadSceneObjects } from '/flightverse/objects.js?v=104';
import { createWeapons } from '/flightverse/weapons.js?v=104';
import CameraControls from '/vendor/camera-controls.module.js?v=104';
import { canExport, exportDeterministic } from '/flightverse/export.js?v=104';
CameraControls.install({ THREE });
import {
  EffectComposer, RenderPass, EffectPass, Effect,
  SMAAEffect, SMAAPreset, BloomEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
  BrightnessContrastEffect, HueSaturationEffect,
} from '/vendor/postprocessing180.module.js?v=104';

// exposición multiplicativa ANTES del tonemap — el 'brillo' aditivo del panel
// empujaba los blancos del splat a clip (puntos blancos, reporte del operador)
class ExposureFx extends Effect {
  constructor(exp = 1) {
    super('ExposureFx',
      'uniform float uExp; void mainImage(const in vec4 c, const in vec2 uv, out vec4 o){ o = vec4(c.rgb * uExp, c.a); }',
      { uniforms: new Map([['uExp', new THREE.Uniform(exp)]]) });
  }
}
import { computeBoundsTree, disposeBoundsTree } from '/vendor/three-mesh-bvh180.module.js?v=104';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const Q = new URLSearchParams(location.search);
const CID = (Q.get('m') || '').replace(/[^\w-]/g, '');
const AT = Q.get('autotest');
const AUTOTEST = AT === '1' || AT === 'record';   // ambos vuelan input sintético
const report = { ready: false, done: false, errors: [], cid: CID };
window.__volar = report;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const M_LAT = 111320;

function hud() {
  document.body.insertAdjacentHTML('beforeend', `
  <div class="vl-hud" id="vl-hud">
    <div class="vl-corner tl">
      <a class="vl-back" href="mundo.html">← Mundo</a>
      <button class="vl-chip" id="vl-share">Compartir</button>
      <div class="vl-scene" id="vl-scene"></div>
    </div>
    <div class="vl-corner tr">
      <div class="vl-metric"><span id="vl-agl">—</span><label>ALT AGL</label><i class="vl-bar"><b id="vl-agl-b"></b></i></div>
      <div class="vl-metric"><span id="vl-spd">—</span><label>VEL m/s</label><i class="vl-bar"><b id="vl-spd-b"></b></i></div>
    </div>
    <div class="vl-corner bl">
      <button class="vl-fab" id="vl-fab">&#9776;</button>
      <button class="vl-dockmin vl-solo-fino" id="vl-dockmin" title="Ocultar panel">«</button>
      <div class="vl-dock" id="vl-dock">
        <button class="vl-chip sec-nav" id="vl-mode"></button>
        <button class="vl-chip sec-nav" id="vl-rig"></button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-mundo" id="vl-vista">vista · 3D</button>
        <button class="vl-chip sec-mundo" id="vl-cielo">cielo · día</button>
        <button class="vl-chip sec-mundo vl-solo-fino" id="vl-calidad">calidad · auto</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-juego" id="vl-reto">Gate Rush</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-media" id="vl-sound">Sonido</button>
        <button class="vl-chip sec-media" id="vl-ajustes">Imagen</button>
        <button class="vl-rec sec-media" id="vl-rec">● Grabar</button>
        <i class="vl-sep"></i>
        <button class="vl-chip sec-ayuda" id="vl-ayuda">Guía <kbd>H</kbd></button>
      </div>
    </div>
    <div class="vl-corner br">
      <div class="vl-kills" id="vl-kills"></div>
      <button class="vl-fire" id="vl-fire" title="X · disparar">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3.2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>
        </svg>
        <span id="vl-ammo">8</span>
        <i id="vl-cool"></i>
      </button>
      <div class="vl-ghost" id="vl-ghost"></div>
      <div class="vl-fps" id="vl-fps"></div>
    </div>
    <div class="vl-center-top" id="vl-challenge"></div>
    <div class="vl-compass" id="vl-compass"><span id="vl-heading">N 0°</span></div>
    <div class="vl-fpv" id="vl-fpv">
      <div class="vl-fpv-cross"></div>
      <div class="vl-fpv-horizon" id="vl-horizon"><i></i></div>
      <div class="vl-osd tape-l"><div class="vl-osd-ticks" id="osd-vt"></div><b id="osd-v">0.0</b><label>M/S</label></div>
      <div class="vl-osd tape-r"><div class="vl-osd-ticks" id="osd-at"></div><b id="osd-a">0</b><label>AGL</label></div>
      <div class="vl-osd-home" id="osd-home">HOME 0 m</div>
      <div class="vl-osd-gimbal" id="osd-gimbal">GIMBAL -7°</div>
      <div class="vl-fpv-head" id="fpv-head">FLT 00:00 · HS 0.0 · VS +0.0 · DIST 0 m · LNK ●●●</div>
      <i class="vl-fpv-br tl"></i><i class="vl-fpv-br tr"></i><i class="vl-fpv-br bl"></i><i class="vl-fpv-br br"></i>
      <div class="vl-fpv-sig" id="fpv-sig"><i></i><i></i><i></i></div>
      <div class="vl-fpv-rec" id="fpv-rec">REC</div>
    </div>
    <div class="vl-flash" id="vl-flash"></div>
    <div class="vl-scrim top"></div><div class="vl-scrim bottom"></div>
    <canvas class="vl-minimap" id="vl-minimap" width="180" height="180"></canvas>
    <div class="vl-count" id="vl-count"></div>
    <div class="vl-result" id="vl-result"></div>
    <input type="range" class="vl-gwheel" id="vl-gwheel" min="-72" max="22" value="-7" aria-label="gimbal">
    <div class="vl-grade" id="vl-grade">
      <div class="vl-grade-head"><span class="vl-grade-k">IMAGEN</span>
        <button class="vl-grade-x" id="gr-close" aria-label="cerrar">✕</button></div>
      <div class="vl-presets">
        <button data-pr="natural">Natural</button>
        <button data-pr="vivo">Vivo</button>
        <button data-pr="cine">Cine</button>
      </div>
      <label>Brillo Gaussian <output id="o-b">0.88</output><input type="range" id="gr-b" min="0.35" max="1.6" step="0.01" value="0.88"></label>
      <label>Brillo 3D <output id="o-t">1.00</output><input type="range" id="gr-t" min="0.3" max="2.2" step="0.01" value="1"></label>
      <label>Contraste <output id="o-c">0.06</output><input type="range" id="gr-c" min="-0.15" max="0.55" step="0.01" value="0.06"></label>
      <label>Saturación <output id="o-s">0.06</output><input type="range" id="gr-s" min="-1" max="1" step="0.01" value="0.06"></label>
      <label>Bloom <output id="o-g">0.25</output><input type="range" id="gr-g" min="0" max="2" step="0.02" value="0.25"></label>
      <label>Viñeta <output id="o-v">0.42</output><input type="range" id="gr-v" min="0" max="1" step="0.02" value="0.42"></label>
      <label>Tono <output id="o-h">0.00</output><input type="range" id="gr-h" min="-0.5" max="0.5" step="0.01" value="0"></label>
      <button id="gr-reset">Restablecer</button>
    </div>
    <button class="vl-goto" id="vl-goto">Ir al inicio de la ruta »</button>
    <div class="vl-cine" id="vl-cine">
      <label>Velocidad<input type="range" id="cine-v" min="0.03" max="0.5" step="0.01" value="0.14"></label>
      <label>Ángulo<input type="range" id="cine-a" min="0.12" max="0.6" step="0.01" value="0.24"></label>
    </div>
    <div class="vl-director" id="vl-director">
      <div class="vl-dir-row">
        <button id="dir-key">+ Keyframe</button>
        <button id="dir-play">Vista previa</button>
        <button id="dir-rec">Grabar toma</button>
        <button id="dir-hd">Exportar 1080p</button>
        <button id="dir-exit">Salir</button>
      </div>
      <input type="range" id="dir-scrub" min="0" max="1" step="0.001" value="0">
      <div class="vl-dir-keys" id="dir-keys"></div>
    </div>
    <div class="vl-guide" id="vl-guide">
      <div class="vl-guide-card">
        <div class="vl-guide-k">GUÍA DE VUELO</div>
        <div class="vl-guide-rows">
          <div><span class="vl-gi">01</span><b>Volar</b><br>
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> mover · <kbd>R</kbd><kbd>F</kbd> subir/bajar · <kbd>Q</kbd><kbd>E</kbd> girar<br>
            <kbd>Shift</kbd> turbo · <kbd>Espacio</kbd> freno · <span class="vl-kmouse">rueda</span> gimbal</div>
          <div><span class="vl-gi">02</span><b>Modos y cámaras</b><br>
            <kbd>1</kbd>–<kbd>4</kbd> modo (Cine·Normal·Arcade·Dios) · <kbd>C</kbd> cámara · <kbd>P</kbd> vista · <kbd>G</kbd> ghost</div>
          <div><span class="vl-gi">03</span><b>Jugar y grabar</b><br>
            <kbd>T</kbd> Gate Rush (aros sobre tu ruta REAL) · <kbd>V</kbd> grabar WebM · <kbd>M</kbd> sonido</div>
          <div><span class="vl-gi">04</span><b>Vistas</b><br>
            3D = malla · foto-real = gaussian · mixta = 3D realzado con foto-realismo encima.</div>
          <div><span class="vl-gi">05</span><b>Calidad</b><br>
            auto = fluidez adaptativa (recomendado al volar) · HD→ultra = supersampling real
            (afila bordes y 3D; el gaussian conserva su blur natural). Ideal para fotos/tomas.</div>
        </div>
        <button id="vl-guide-ok">¡A volar!</button>
      </div>
    </div>
    <div class="vl-help" id="vl-help">
      <b>Controles</b><br>
      WASD mover · R/F subir/bajar · Q/E girar · mouse mirar (click captura)<br>
      Shift turbo · Space freno · 1-5 modo · C cámara · G ghost · P foto-real · V grabar · H ayuda
    </div>
  </div>`);
}

async function main() {
  if (!CID) { location.replace('mundo.html'); return; }
  document.title = 'AeroBrain — Volar';
  hud();
  const say = m => { $('#vl-scene').textContent = m; };
  say('Cargando escena…');

  const man = await loadManifest(CID);
  if (!man.capabilities?.terrain) throw new Error('escena sin terreno volable');
  $('#vl-scene').textContent = man.name;


  // ── escena three (flags según README de postprocessing: AA lo hace SMAA,
  // depth/stencil viven en los buffers del composer) ──
  const renderer = new THREE.WebGLRenderer({
    powerPreference: 'high-performance', antialias: false, stencil: false, depth: false,
  });
  renderer.toneMapping = THREE.NoToneMapping;   // el tone mapping va al FINAL del pipeline
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  renderer.domElement.className = 'vl-canvas';
  const scene = new THREE.Scene();
  {
    // environment map procedural: reflejos PBR reales en GLBs metálicos
    // (sin esto, metallic>0.5 se ve negro — el look 'Unreal' necesita entorno)
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#7fb2e8'); g.addColorStop(0.5, '#dce9f6');
    g.addColorStop(0.52, '#5a5348'); g.addColorStop(1, '#2e2a24');
    c.fillStyle = g; c.fillRect(0, 0, 64, 32);
    const env = new THREE.CanvasTexture(cv);
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = THREE.SRGBColorSpace;
    scene.environment = env;
    scene.environmentIntensity = 0.85;
  }
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 6000);
  // cielo vivo: domo gradiente + sol/estrellas + nubes a la deriva; las luces
  // y la niebla las gobierna el preset (dia/atardecer/noche)
  const sky = createSky(scene);
  const qCielo = Q.get('cielo');
  if (qCielo) sky.setPreset(qCielo);

  // look premium: un solo EffectPass fusiona SMAA+Bloom+ACES+Vignette en un shader
  // NEUTRAL (no ACES): los colores del splat ya son display-referred — ACES
  // los lavaba; bloom umbral 1.0 para que los blancos del splat no lo disparen
  const fx = {
    exp: new ExposureFx(0.88),                 // doma el foto-real brillante por defecto
    bc: new BrightnessContrastEffect({ brightness: 0, contrast: 0.06 }),
    hs: new HueSaturationEffect({ saturation: 0.06 }),
    bloom: new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, intensity: 0.25, radius: 0.6 }),
    vig: new VignetteEffect({ offset: 0.3, darkness: 0.42 }),
  };
  // HalfFloat solo si el contexto puede RENDERIZAR a half-float (Safari viejo
  // no → frame basura blanquecina, reporte 'noche/atardecer blancos')
  const halfOk = !!renderer.extensions.get('EXT_color_buffer_half_float')
    || !!renderer.extensions.get('EXT_color_buffer_float');
  const composer = new EffectComposer(renderer, {
    frameBufferType: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType });
  report.halfFloat = halfOk;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera,
    new SMAAEffect({ preset: SMAAPreset.HIGH }),
    fx.exp, fx.bloom, fx.hs,
    new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    fx.bc, fx.vig,
  ));

  const terrain = await loadTerrain(man, { anisotropy: 8 });
  terrain.mesh.matrixAutoUpdate = false; terrain.mesh.updateMatrix();   // estática
  terrain.mesh.receiveShadow = true;
  scene.add(terrain.mesh);
  // objetos de escena (plataforma de juegos: docs/SCENE_OBJECTS.md)
  let sceneObjects = null;
  loadSceneObjects(man, scene, { heightAt: terrain.heightAt })
    .then(so => { sceneObjects = so; if (so) report.objects = so.count; })
    .catch(e => report.errors.push('objects: ' + e.message));
  const W = terrain.world;
  const mask = { uMaskOn: terrain.splatMask.uSplatOn, uMaskC: terrain.splatMask.uSplatC, uMaskR: terrain.splatMask.uSplatR };

  // splat héroe: solo si splat_align.py lo dejó 'aligned' (RMSE sub-métrico).
  // Carga DESPUÉS del terreno (el juego ya es volable mientras llega el ksplat).
  let splat = null;
  if (man.capabilities?.splat && man.transforms?.splat?.status === 'aligned') {
    attachSplat(man, scene, {
      renderer,
      onProgress: p => { if (p < 100) $('#vl-scene').textContent = `${man.name} · splat ${Math.round(p)}%`; },
    }).then(s => {
      splat = s;
      $('#vl-scene').textContent = `${man.name} · foto-real ±${(s.rmse * 100).toFixed(0)}cm`;
      report.splat = { aligned: s.aligned, rmse_m: s.rmse };
      applyVista();               // default 3D siempre (pedido del operador)
    }).catch(e => {
      report.errors.push('splat: ' + e.message);
      $('#vl-scene').textContent = man.name;
    });
  }

  // colisión precisa contra EDIFICIOS: proxy voxel del splat (splat-transform)
  // horneado al frame del juego (collision_bake.py) + BVH. Lazy: el vuelo ya
  // funciona con el heightfield mientras llega; queries closestPointToPoint
  // ~17µs — cabe de sobra en el paso de 120Hz.
  let coll = null;
  const collV = new THREE.Vector3();
  if (man.assets?.collision_bin && man.assets?.collision_meta) {
    Promise.all([
      fetch(man.assets.collision_meta, { cache: 'no-store' }).then(r => r.json()),
      fetch(man.assets.collision_bin).then(r => r.arrayBuffer()),
    ]).then(([cm, buf]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, cm.verts * 3), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, cm.bytes_pos, cm.tris * 3), 1));
      g.computeBoundsTree();
      g.computeBoundingBox();
      const bb = g.boundingBox;
      mask.uMaskC.value.set((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2);
      mask.uMaskR.value = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.42;
      applyVista();                       // re-evalúa mixta ahora que hay huella
      coll = g.boundsTree;
      report.collision = { tris: cm.tris };
      $('#vl-ghost').textContent += ' · colisión ✓';
    }).catch(e => report.errors.push('colisión: ' + e.message));
  }
  const collide = (p, r) => {
    if (!coll) return null;
    return coll.closestPointToPoint(collV.copy(p), {}, 0, r);
  };

  // dron rediseñado: proporciones DJI (~0.85m), cuerpo bajo, brazos finos,
  // props que giran con la velocidad, gimbal frontal — solo primitivas three
  const drone = createDrone({ heightAt: terrain.heightAt, collide, spawn: man.spawn });
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
  fetch('/assets/manifest.json?v=104', { cache: 'no-store' }).then(r => r.json()).then(async am => {
    if (!am.drone_glb) return;
    const { GLTFLoader } = await import('/vendor/three-addons180/loaders/GLTFLoader.js?v=104');
    const g = await new GLTFLoader().loadAsync('/assets/drone.glb');
    const m = g.scene;
    const bb = new THREE.Box3().setFromObject(m);
    const size = bb.getSize(new THREE.Vector3());
    const s = 0.85 / Math.max(size.x, size.z || 0.001);
    m.scale.setScalar(s);
    bb.setFromObject(m); bb.getCenter(m.position).multiplyScalar(-1);
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
    report.customDrone = true;
  }).catch(() => { /* GLB opcional */ });

  // ── ghost del vuelo real ──
  let ghost = null;
  const track = await loadTrack(man);
  if (track?.points?.length > 3 && W.center_wgs84) {
    const [clon, clat] = W.center_wgs84;
    const mlon = M_LAT * Math.cos(clat * Math.PI / 180);
    const p0 = track.points[0];
    // frame local: +x=este, +z=sur (lat baja) — misma convención que el terreno
    const g0 = terrain.heightAt((p0.lon - clon) * mlon, (clat - p0.lat) * M_LAT);
    const pts = track.points.map(p => new THREE.Vector3(
      (p.lon - clon) * mlon,
      (g0 ?? 0) + (p.rel_alt || 0),
      (clat - p.lat) * M_LAT,
    ));
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(600, pts.length * 3), 0.22, 6, false),
      new THREE.MeshBasicMaterial({ color: 0x52C79A, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0x7dffc9 }));
    const haloCv = document.createElement('canvas'); haloCv.width = haloCv.height = 64;
    const hc = haloCv.getContext('2d');
    const grd = hc.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(125,255,201,.85)'); grd.addColorStop(1, 'rgba(125,255,201,0)');
    hc.fillStyle = grd; hc.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCv), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(4.5);
    marker.add(halo);
    const grp = new THREE.Group();
    grp.add(line); grp.add(marker); grp.visible = true;
    scene.add(grp);
    // t viene como datetime string ("2026-07-04 16:03:58") en los SRT reales;
    // normalizar a segundos desde el inicio, fallback = índice (muestreo 1Hz)
    const T = track.points.map((p, i) => {
      if (typeof p.t === 'number') return p.t;
      const ms = Date.parse(String(p.t || '').replace(' ', 'T'));
      return Number.isFinite(ms) ? ms / 1000 : i;
    });
    const tBase = T[0] || 0;
    for (let i = 0; i < T.length; i++) T[i] -= tBase;
    const dur = T[T.length - 1] || 1;
    ghost = { grp, marker, pts, T, dur, t: 0, on: true };
    $('#vl-ghost').textContent = `ghost · vuelo real ${Math.round(dur)}s`;
  } else {
    $('#vl-ghost').textContent = 'sin track';
  }

  // ── estado de juego ──
  const input = createInput(renderer.domElement);
  const audio = createAudio();
  // ── armamento: misiles + explosiones + destrucción (X o botón FIRE) ──
  const shake = { mag: 0 };
  let curYaw = 0;
  const weapons = createWeapons(scene, {
    heightAt: terrain.heightAt, audio, crater: terrain.crater,
    onShake: (pos, big) => {
      const d = camera.position.distanceTo(pos);
      shake.mag = Math.max(shake.mag, Math.min(0.9, (9 * big) / (5 + d)));
    },
  });
  // retícula de impacto: simula la balística y marca dónde caerá el misil
  const aim = new THREE.Group();
  {
    const am = new THREE.MeshBasicMaterial({ color: 0xff8a5a, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const r1 = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 28), am);
    const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), am.clone());
    r1.rotation.x = r2.rotation.x = -Math.PI / 2;
    aim.add(r1, r2);
  }
  aim.visible = false;
  scene.add(aim);
  const fireBtn = $('#vl-fire');
  const doFire = (pitch) => {
    // si el GLB trae hardpoints, el misil sale del siguiente en turno
    const hp = hardpoints.length
      ? hardpoints[weapons.state.fired % hardpoints.length].getWorldPosition(new THREE.Vector3())
      : P.clone();
    if (!weapons.fire(hp, curYaw, pitch ?? gimbalTilt * 0.55)) return;
    $('#vl-ammo').textContent = weapons.state.ammo;
    fireBtn.classList.remove('flash'); void fireBtn.offsetWidth;   // reinicia anim
    fireBtn.classList.add('flash');
  };
  fireBtn.addEventListener('click', doFire);
  const sticks = createTouchSticks($('#vl-hud'));
  let sfx = { idx: 0, phase: '', crash: false, count: 0 };
  let modeKey = 'asistido', rigIx = 0;
  if (Q.get('rig') != null) rigIx = Math.abs(+Q.get('rig')) % RIGS.length;   // QA: cámara por URL
  let gimbalTilt = -0.12;                      // tilt del gimbal (rad); rueda/slider lo mueven
  const setGimbal = r => {
    gimbalTilt = Math.max(-1.26, Math.min(0.38, r));
    $('#vl-gwheel').value = Math.round(gimbalTilt * 180 / Math.PI);
    $('#osd-gimbal').textContent = `GIMBAL ${Math.round(gimbalTilt * 180 / Math.PI)}°`;
  };
  $('#vl-gwheel').addEventListener('input', e => setGimbal(+e.target.value * Math.PI / 180));
  const cine = { v: 0.14, a: 0.24 };
  $('#cine-v').addEventListener('input', e => { cine.v = +e.target.value; });
  $('#cine-a').addEventListener('input', e => { cine.a = +e.target.value; });
  const setMode = k => {
    modeKey = k; $('#vl-mode').textContent = `modo · ${MODES[k].label}`;
    $('#vl-cine').classList.toggle('show', k === 'cinematico');
    $('#vl-goto').classList.toggle('show', !!MODES[k].autopilot && !!ghost);
    if (MODES[k].autopilot) {
      if (ghost && ghost.pts.length > 3) { initAuto(); goToStart(); }
      else {                                   // honesto: sin track no hay autopiloto
        modeKey = 'asistido';
        $('#vl-mode').textContent = 'modo · Normal';
        $('#vl-challenge').textContent = 'esta escena no tiene ruta real — Arcade no disponible';
        setTimeout(() => { $('#vl-challenge').textContent = ''; }, 2600);
      }
    }
  };
  $('#vl-goto').addEventListener('click', () => goToStart());
  const setRig = ix => {
    rigIx = ((ix % RIGS.length) + RIGS.length) % RIGS.length;
    camera.fov = RIGS[rigIx].fov; camera.updateProjectionMatrix();
    $('#vl-rig').textContent = `cámara · ${RIGS[rigIx].label}`;
    dmesh.visible = !RIGS[rigIx].hideDrone;
    $('#vl-fpv').classList.toggle('show', !!RIGS[rigIx].hideDrone);
  };
  // vista: 0 mixta · 1 foto-real (solo splat) · 2 orto (solo terreno)
  let vista = 2;
  const applyVista = () => {
    if (!splat && vista !== 2) { vista = 2; }
    terrain.mesh.visible = vista !== 1;
    // mixta v4: '3D realzado con foto-realismo' — gap mínimo anti-zfight y
    // el terreno cede protagonismo (85% de ganancia) para que el splat pinte
    terrain.mesh.position.y = vista === 0 ? -0.35 : 0;
    terrain.mesh.updateMatrix();
    mask.uMaskOn.value = 0;
    if (splat) splat.object.visible = vista !== 2;
    terrain.mesh.material.color.setScalar((grade?.t ?? 1) * (vista === 0 ? 0.85 : 1));
    $('#vl-vista').textContent = 'vista · ' + (vista === 0 ? 'mixta' : vista === 1 ? 'foto-real' : '3D');
  };
  const cycleVista = () => { vista = (vista + 1) % 3; applyVista(); };
  $('#vl-vista').addEventListener('click', cycleVista);
  const CIELO_LB = { dia: 'día', atardecer: 'atardecer', noche: 'noche' };
  $('#vl-cielo').addEventListener('click', () => {
    $('#vl-cielo').textContent = 'cielo · ' + CIELO_LB[sky.cycle()];
  });
  $('#vl-cielo').textContent = 'cielo · ' + (CIELO_LB[sky.preset] || 'día');
  $('#vl-mode').addEventListener('click', () => {
    const ks = Object.keys(MODES);
    setMode(ks[(ks.indexOf(modeKey) + 1) % ks.length]);
  });
  $('#vl-rig').addEventListener('click', () => setRig(rigIx + 1));
  $('#vl-reto').addEventListener('click', () => startReto());   // arrow: startReto se declara abajo
  $('#vl-ayuda').addEventListener('click', () => $('#vl-guide').classList.add('show'));
  $('#vl-ajustes').addEventListener('click', e => {
    e.stopPropagation();
    $('#vl-grade').classList.toggle('show');
  });
  $('#gr-close').addEventListener('click', () => $('#vl-grade').classList.remove('show'));
  document.addEventListener('pointerdown', e => {
    const g = $('#vl-grade');
    if (g.classList.contains('show') && !g.contains(e.target) && !e.target.closest('#vl-ajustes'))
      g.classList.remove('show');
  });
  $('#vl-fab').addEventListener('click', () => $('#vl-dock').classList.toggle('open'));
  $('#vl-dockmin').addEventListener('click', () => {
    const min = $('#vl-dock').classList.toggle('min');
    $('#vl-dockmin').textContent = min ? '»' : '«';
  });
  $('#vl-dock').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    b.classList.remove('zap'); void b.offsetWidth; b.classList.add('zap');
  });
  const GRADE_KEY = 'ab.fv.grade';
  const applyGrade = g => {
    fx.exp.uniforms.get('uExp').value = g.b;
    fx.hs.hue = (g.h ?? 0) * Math.PI;
    // bloom: con NEUTRAL casi nada supera lum 1.0 — el slider baja el UMBRAL
    fx.bloom.luminanceMaterial.threshold = Math.max(0.55, 1.0 - (g.g ?? 0) * 0.28);
    for (const [oid, k] of [['o-b','b'],['o-t','t'],['o-c','c'],['o-s','s'],['o-g','g'],['o-v','v'],['o-h','h']])
      if ($('#'+oid)) $('#'+oid).textContent = (+(g[k] ?? 0)).toFixed(2);
    terrain.mesh.material.color.setScalar(g.t ?? 1);   // ganancia SOLO del 3D
    fx.bc.contrast = g.c;
    fx.hs.saturation = g.s;
    fx.bloom.intensity = g.g;
    fx.vig.darkness = g.v;
    for (const [id, k] of [['gr-b','b'],['gr-t','t'],['gr-c','c'],['gr-s','s'],['gr-g','g'],['gr-v','v'],['gr-h','h']]) if ($('#'+id)) $('#'+id).value = g[k] ?? 1;
  };
  const defGrade = { b: 0.88, t: 1, c: 0.06, s: 0.06, g: 0.25, v: 0.42, h: 0 };
  let grade = { ...defGrade, ...(JSON.parse(localStorage.getItem(GRADE_KEY) || '{}')) };
  applyGrade(grade);
  document.getElementById('vl-grade').addEventListener('input', e => {
    const map = { 'gr-b':'b','gr-t':'t','gr-c':'c','gr-s':'s','gr-g':'g','gr-v':'v','gr-h':'h' };
    const k = map[e.target.id]; if (!k) return;
    grade[k] = parseFloat(e.target.value);
    applyGrade(grade);
    localStorage.setItem(GRADE_KEY, JSON.stringify(grade));
  });
  $('#gr-reset').addEventListener('click', () => { grade = { ...defGrade }; applyGrade(grade); localStorage.removeItem(GRADE_KEY); });
  const PRESETS = {
    natural: { b: 0.9, c: 0.04, s: 0.02, g: 0.18, v: 0.35 },
    vivo:    { b: 1.0, c: 0.14, s: 0.22, g: 0.4, v: 0.4 },
    cine:    { b: 0.82, c: 0.18, s: -0.06, g: 0.28, v: 0.62 },
  };
  document.querySelector('.vl-presets').addEventListener('click', e => {
    const p = PRESETS[e.target.dataset.pr]; if (!p) return;
    grade = { ...p }; applyGrade(grade);
    localStorage.setItem(GRADE_KEY, JSON.stringify(grade));
  });
  // grade fuera de rango guardado (el bug del fondo blanco): sanear
  grade.c = Math.max(-0.15, Math.min(0.55, grade.c));
  if (!(grade.b >= 0.35 && grade.b <= 1.6)) grade.b = 0.88;  // migra esquemas viejos (y el 1.3 quemado)
  applyGrade(grade);
  $('#vl-guide-ok').addEventListener('click', () => {
    $('#vl-guide').classList.remove('show');
    localStorage.setItem('ab.fv.guided', '1');
  });
  if (!localStorage.getItem('ab.fv.guided') && !AT) $('#vl-guide').classList.add('show');
  $('#vl-sound').addEventListener('click', () => {
    const m = audio.toggleMute();
    $('#vl-sound').textContent = m ? 'Sonido off' : 'Sonido';
    $('#vl-sound').classList.toggle('off', m);
  });
  $('#vl-share').addEventListener('click', async () => {
    const url = `${location.origin}/volar.html?m=${encodeURIComponent(CID)}`;
    try {
      if (navigator.share) await navigator.share({ title: `Vuela ${man.name} — AeroBrain`, url });
      else { await navigator.clipboard.writeText(url); $('#vl-share').textContent = 'Copiado'; setTimeout(() => { $('#vl-share').textContent = 'Compartir'; }, 1600); }
    } catch { /* usuario canceló */ }
  });
  const qModo = Q.get('modo');
  setMode(qModo && MODES[qModo] ? qModo : 'asistido'); setRig(rigIx); applyVista();
  if (Q.get('reto') === '1' && !AT) setTimeout(() => startReto(), 3800);   // tras el arrival
  const modeKeys = { Digit1: 'cinematico', Digit2: 'asistido', Digit3: 'arcade', Digit4: 'dios' };
  addEventListener('keydown', e => {
    if (modeKeys[e.code]) setMode(modeKeys[e.code]);
    if (e.code === 'KeyC') setRig(rigIx + 1);
    if (e.code === 'KeyG' && ghost) { ghost.on = !ghost.on; ghost.grp.visible = ghost.on; }
    if (e.code === 'KeyH') $('#vl-guide').classList.toggle('show');
    if (e.code === 'KeyT') startReto();
    if (e.code === 'KeyP') cycleVista();
    if (e.code === 'KeyM') $('#vl-mode').style.opacity = audio.toggleMute() ? 0.4 : 1;
    if (e.code === 'KeyX') doFire();
    if (e.code === 'Escape' && replay) { replay = null; if (resultShown) $('#vl-result').classList.add('show'); }
  });
  renderer.domElement.addEventListener('click', () => { if (modeKey === 'fpv') input.requestLock(); });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  // ── Gate Rush (desafío del slice) + replay ──
  let reto = null, replay = null, resultShown = false;
  const startReto = () => {
    $('#vl-result').classList.remove('show'); $('#vl-result').innerHTML = '';
    replay = null; resultShown = false;
    if (reto) reto.dispose();
    reto = createGateRush({ scene, trackPts: ghost?.pts, world: W, heightAt: terrain.heightAt });
    reto.start();
  };
  const startReplay = () => {
    if (!reto?.state.rec.length) return;
    $('#vl-result').classList.remove('show');
    replay = { rec: reto.state.rec, f: 0 };
  };
  const showResult = () => {
    resultShown = true;
    const t = reto.state.time;
    const { best, isNew } = bestTime(CID, t);
    $('#vl-result').innerHTML = `
      <div class="vl-result-card">
        <div class="vl-result-k">GATE RUSH · COMPLETADO</div>
        <div class="vl-result-time">${t.toFixed(2)}<small>s</small></div>
        <div class="vl-result-rows">
          <span>${isNew ? 'nuevo récord' : `récord ${best?.toFixed(2)}s`}</span>
          <span>vel. máx ${reto.state.topSpeed.toFixed(1)} m/s</span>
          <span>${reto.state.total} gates</span>
        </div>
        <div class="vl-result-btns">
          <button data-act="retry">Reintentar</button>
          <button data-act="replay">Ver replay</button>
          <button data-act="director">Director</button>
          <a href="mundo.html">Mundo</a>
        </div>
      </div>`;
    $('#vl-result').classList.add('show');
  };
  $('#vl-result').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'retry') startReto();
    if (act === 'replay') startReplay();
    if (act === 'director') enterDirector();
  });

  // ── DIRECTOR (P6): keyframes de cámara sobre el replay grabado ──
  let director = null;
  const cc = new CameraControls(camera, renderer.domElement);
  cc.enabled = false;
  const recAt = f => {                     // pose del rec 60Hz con lerp
    const rec = reto?.state.rec; if (!rec?.length) return;
    const i = Math.min(Math.floor(f), rec.length - 1);
    const b = rec[Math.min(i + 1, rec.length - 1)], a = rec[i], k = f - i;
    drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
    drone.pos.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    drone.yaw = a[3] + (b[3] - a[3]) * k;
  };
  function enterDirector() {
    if (!reto?.state.rec?.length) return;
    $('#vl-result').classList.remove('show');
    replay = null;
    director = { keys: [], playing: false, f: 0, len: reto.state.rec.length - 1 };
    cc.enabled = true;
    cc.setLookAt(drone.pos.x + 20, drone.pos.y + 12, drone.pos.z + 20,
      drone.pos.x, drone.pos.y, drone.pos.z, false);
    $('#vl-director').classList.add('show');
    $('#dir-scrub').max = String(director.len);
    paintKeys();
  }
  function exitDirector() {
    director = null; cc.enabled = false;
    $('#vl-director').classList.remove('show');
    if (resultShown) $('#vl-result').classList.add('show');
  }
  function paintKeys() {
    $('#dir-keys').innerHTML = director.keys.map((k, i) =>
      `<button data-dk="${i}">${(k.f / 60).toFixed(1)}s ✕</button>`).join('')
      || '<span>añade keyframes moviendo la cámara y pulsando + Keyframe</span>';
  }
  const dirCam = f => {                    // cámara interpolada entre keyframes
    const ks = director.keys; if (!ks.length) return;
    let a = ks[0], b = ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++)
      if (f >= ks[i].f && f <= ks[i + 1].f) { a = ks[i]; b = ks[i + 1]; break; }
    const span = Math.max(1, b.f - a.f);
    let k = Math.min(1, Math.max(0, (f - a.f) / span));
    k = k * k * (3 - 2 * k);               // smoothstep
    camera.position.lerpVectors(a.pos, b.pos, k);
    _dirT.lerpVectors(a.target, b.target, k);
    camera.lookAt(_dirT);
  };
  const _dirT = new THREE.Vector3();
  $('#dir-key').addEventListener('click', () => {
    if (!director) return;
    const t = new THREE.Vector3(); cc.getTarget(t);
    director.keys.push({ f: director.f, pos: camera.position.clone(), target: t });
    director.keys.sort((x, y) => x.f - y.f);
    paintKeys();
  });
  $('#dir-keys').addEventListener('click', e => {
    const i = e.target.closest('[data-dk]')?.dataset.dk;
    if (i == null || !director) return;
    director.keys.splice(+i, 1); paintKeys();
  });
  $('#dir-scrub').addEventListener('input', e => {
    if (director && !director.playing) { director.f = +e.target.value; recAt(director.f); }
  });
  const dirPlay = async (rec) => {
    if (!director || director.keys.length < 2) return;
    director.playing = true; director.f = 0; cc.enabled = false;
    if (rec) { recorder.start(); }
  };
  $('#dir-play').addEventListener('click', () => dirPlay(false));
  $('#dir-rec').addEventListener('click', () => dirPlay(true));
  $('#dir-exit').addEventListener('click', exitDirector);
  $('#dir-hd').addEventListener('click', async () => {
    if (!director || director.keys.length < 2) return;
    if (!canExport()) { $('#dir-hd').textContent = 'sin WebCodecs — usa Grabar'; return; }
    const btn = $('#dir-hd');
    btn.disabled = true;
    // resolución fija: cada frame es un paso del rec — determinista de verdad
    const oldDpr = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(1920, 1080, false);
    composer.setSize(1920, 1080);
    camera.aspect = 1920 / 1080; camera.updateProjectionMatrix();
    try {
      const blob = await exportDeterministic({
        frames: director.len, canvas: renderer.domElement,
        drawFrame: f => { recAt(f); drone.lerpPose(1, P); dmesh.position.copy(P);
          dmesh.rotation.set(0, drone.yaw, 0); dirCam(f); composer.render(); },
        onProgress: p => { btn.textContent = `Exportando ${(p * 100) | 0}%`; },
      });
      recorder.download(blob, `director_${CID}_1080p.webm`);
      btn.textContent = 'Exportar 1080p';
    } catch (e) {
      btn.textContent = 'error: ' + String(e.message).slice(0, 24);
      report.errors.push('export: ' + e.message);
    } finally {
      btn.disabled = false;
      renderer.setPixelRatio(oldDpr); renderer.setSize(innerWidth, innerHeight);
      composer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    }
  });

  // cinemático: tour orbital sobre el centro de la escena
  let tourT = 0;
  const diag = Math.hypot(...W.size_m);

  // ── minimapa táctico: la ortofoto REAL como radar (dron/ghost/gates) ──
  const mm = { cv: $('#vl-minimap'), img: null, ready: false };
  if (man.assets?.ortho) {
    const im = new Image();
    im.onload = () => { mm.img = im; mm.ready = true; };
    im.src = man.assets.ortho;
  }
  const mmXY = (x, z) => [
    (x / W.size_m[0] + 0.5) * mm.cv.width,
    (z / W.size_m[1] + 0.5) * mm.cv.height,
  ];
  function drawMinimap() {
    if (!mm.ready) return;
    const c = mm.cv.getContext('2d');
    c.clearRect(0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 0.92;
    c.drawImage(mm.img, 0, 0, mm.cv.width, mm.cv.height);
    c.globalAlpha = 1;
    if (reto?.gates) for (let i = 0; i < reto.gates.length; i++) {
      const g = reto.gates[i];
      const [gx, gz] = mmXY(g.center.x, g.center.z);
      c.beginPath(); c.arc(gx, gz, 3, 0, 7);
      c.strokeStyle = g.passed ? '#52C79A' : (i === reto.state.idx ? '#45A0E6' : '#566274');
      c.lineWidth = 1.6; c.stroke();
    }
    if (ghost?.on) {
      const [gx, gz] = mmXY(ghost.marker.position.x, ghost.marker.position.z);
      c.fillStyle = '#52C79A'; c.beginPath(); c.arc(gx, gz, 2.4, 0, 7); c.fill();
    }
    const [dx, dz] = mmXY(drone.pos.x, drone.pos.z);
    c.save(); c.translate(dx, dz); c.rotate(-drone.yaw);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }

  // ── autopiloto Arcade v2: curva por longitud de arco (sin jitter 1Hz),
  // transit grácil al inicio, Shift acelera, migas de luz adelante ──
  const apilot = { u: 0, transit: null, curve: null };
  const crumbs = [];
  const initAuto = () => {
    if (!ghost || apilot.curve) return;
    apilot.curve = new THREE.CatmullRomCurve3(ghost.pts, false, 'catmullrom', 0.5);
    apilot.len = apilot.curve.getLength();
    const cTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const c = cv.getContext('2d'); const g = c.createRadialGradient(16,16,1,16,16,15);
      g.addColorStop(0,'rgba(125,255,201,.9)'); g.addColorStop(1,'rgba(125,255,201,0)');
      c.fillStyle = g; c.fillRect(0,0,32,32); return new THREE.CanvasTexture(cv); })();
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(1.6); sp.visible = false;
      scene.add(sp); crumbs.push(sp);
    }
  };
  const goToStart = () => {
    if (!apilot.curve) return;
    const start = apilot.curve.getPointAt(0);
    const d = drone.pos.distanceTo(start);
    apilot.transit = { from: drone.pos.clone(), to: start, t: 0,
      dur: Math.min(4, Math.max(1, d / 26)) };
    apilot.u = 0;
  };
  const ghostAuto = { f: 0 };
  const trail = [];
  const trailGeo = new THREE.BufferGeometry();
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: 0x7dffc9, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(trailLine);

  // llegada cinematográfica: swoop desde vista de mapa hacia el rig (skip en autotest)
  let arrival = AT ? null : { t: 0, dur: 3.4 };

  let simT = 0, propSpin = 14;
  const auto = AUTOTEST ? { until: 5 } : null;
  const autoReto = AT === 'gaterush' ? { last: 0, replayed: false } : null;

  // ── Quick Record (WebM del canvas — camino instantáneo del Video Studio) ──
  const recorder = createRecorder(renderer.domElement);
  const recBtn = $('#vl-rec');
  const toggleRec = async () => {
    if (!recorder.supported) { recBtn.textContent = 'grabación no soportada'; return; }
    if (recorder.recording) {
      const blob = await recorder.stop();
      recBtn.classList.remove('on'); recBtn.textContent = '● Grabar';
      if (blob) recorder.download(blob, `volar_${CID}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
    } else if (recorder.start()) { recBtn.classList.add('on'); audio.rec(true); }
  };
  recBtn.addEventListener('click', toggleRec);
  addEventListener('keydown', e => { if (e.code === 'KeyV') toggleRec(); });
  if (AT === 'record') {
    setTimeout(() => {
      const started = recorder.start();
      setTimeout(async () => {
        const blob = started ? await recorder.stop() : null;
        report.recordBytes = blob?.size || 0;
        report.recordMime = blob?.type || null;
        report.ok = (blob?.size || 0) > 50000;
        report.done = true;
      }, 2500);
    }, 1000);
  }
  const P = new THREE.Vector3();
  const loop = createLoop({
    update(dt) {
      simT += dt;
      if (director) {
        if (director.playing) {
          director.f += dt * 60;
          if (director.f >= director.len) {
            director.f = director.len; director.playing = false; cc.enabled = true;
            if (recorder.recording) recorder.stop().then(b => {
              if (b) recorder.download(b, `director_${CID}.webm`);
            });
          }
          $('#dir-scrub').value = String(director.f);
        }
        recAt(director.f);
      } else if (replay) {
        // replay: la grabación (60Hz) manda; física apagada, interpolación intacta
        replay.f += dt * 60;
        const n = replay.rec.length;
        if (replay.f >= n - 1) replay.f = 0;
        const i = Math.floor(replay.f), f = replay.f - i;
        const a = replay.rec[i], b = replay.rec[Math.min(i + 1, n - 1)];
        drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
        drone.pos.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
        drone.yaw = a[3] + (b[3] - a[3]) * f;
      } else if (MODES[modeKey]?.autopilot && ghost) {
        initAuto();
        drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
        if (apilot.transit) {
          // vuelo grácil al inicio (easeInOut + arco de altura), NO teleport
          const tr = apilot.transit;
          tr.t += dt;
          const k = Math.min(1, tr.t / tr.dur), e = k * k * (3 - 2 * k);
          drone.pos.lerpVectors(tr.from, tr.to, e);
          drone.pos.y += Math.sin(e * Math.PI) * 6;      // arquito elegante
          drone.yaw += (Math.atan2(-(tr.to.x - tr.from.x), -(tr.to.z - tr.from.z)) - drone.yaw) * 0.06;
          if (k >= 1) apilot.transit = null;
        } else if (apilot.curve) {
          const boost = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
          apilot.u = (apilot.u + dt * (14 * (boost ? 2.5 : 1)) / apilot.len) % 1;
          const p2 = apilot.curve.getPointAt(apilot.u);
          const tan = apilot.curve.getTangentAt(apilot.u);
          drone.pos.copy(p2);
          const wy = Math.atan2(-tan.x, -tan.z);
          let dy = wy - drone.yaw;
          while (dy > Math.PI) dy -= 2 * Math.PI;
          while (dy < -Math.PI) dy += 2 * Math.PI;
          drone.yaw += dy * 0.12;                        // giro suave en esquinas
          drone.vel.copy(tan).multiplyScalar(14 * (boost ? 2.5 : 1));
        }
        trail.push(drone.pos.clone());
        if (trail.length > 200) trail.shift();
        trailGeo.setFromPoints(trail);
      } else {
        let inp = input.sample();
        const ts = sticks?.sample();
        if (ts?.active) { inp.fwd = ts.fwd; inp.strafe = ts.strafe; inp.yaw = ts.yaw; inp.lift = ts.lift; }
        if (auto && simT < auto.until) inp = { fwd: 1, strafe: 0, yaw: 0.15, lift: 0.1, boost: simT > 2, brake: false, mouseDX: 0, mouseDY: 0 };
        drone.step(dt, inp, modeKey);
        if (autoReto) {
          // autotest del slice: teleporta por los gates — prueba detección,
          // resultado y replay reales sin fingir sus verificaciones
          if (!reto && simT > 0.5) startReto();
          else if (reto?.state.phase === 'running' && simT - autoReto.last > 0.4) {
            autoReto.last = simT;
            const g = reto.gates[reto.state.idx];
            if (g) { drone.pos.copy(g.center); drone.prev.pos.copy(g.center); }
          } else if (reto?.state.phase === 'finished' && !autoReto.replayed) {
            autoReto.replayed = true;
            startReplay();
            setTimeout(() => {
              report.reto = { time: reto.state.time, gates: reto.state.total, recFrames: reto.state.rec.length };
              report.replayActive = !!replay;
              report.ok = reto.state.total >= 4 && reto.state.time != null
                && reto.state.rec.length > 30 && !!replay;
              report.done = true;
            }, 1200);
          }
        }
        if (reto) {
          reto.update(dt, drone.pos, drone.vel, drone.yaw);
          const st = reto.state;
          if (st.idx > sfx.idx) {
            audio.gate();
            const fl = $('#vl-flash');
            fl.classList.remove('hit'); void fl.offsetWidth; fl.classList.add('hit');
          }
          if (st.phase === 'countdown') { const c = Math.ceil(st.countdown); if (c !== sfx.count) audio.tick(); sfx.count = c; }
          if (st.phase === 'running' && sfx.phase === 'countdown') audio.go();
          if (st.phase === 'finished' && sfx.phase !== 'finished') audio.finish();
          sfx.idx = st.idx; sfx.phase = st.phase;
          if (st.phase === 'finished' && !resultShown) showResult();
        }
        if (drone.crashedSoft && !sfx.crash) audio.crash();
        sfx.crash = drone.crashedSoft;
      }
      if (ghost?.on) {
        ghost.t = (ghost.t + dt) % ghost.dur;
        const i = ghost.T.findIndex(t => t > ghost.t);
        const a = Math.max(0, i - 1), b = Math.max(0, i);
        const ta = ghost.T[a], tb = ghost.T[b] || ta + 1;
        const f = tb > ta ? (ghost.t - ta) / (tb - ta) : 0;
        ghost.marker.position.lerpVectors(ghost.pts[a], ghost.pts[b] || ghost.pts[a], f);
      }
    },
    render(alpha) {
      const o = drone.lerpPose(alpha, P);
      curYaw = o.yaw;
      // FOV kick con turbo: sensación de velocidad AAA (lerp suave, barato)
      const wantFov = RIGS[rigIx].fov + (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 9 : 0);
      if (Math.abs(camera.fov - wantFov) > 0.1) {
        camera.fov += (wantFov - camera.fov) * 0.08;
        camera.updateProjectionMatrix();
      }
      if (ghost?.on) ghost.marker.children[0].scale.setScalar(4 + Math.sin(simT * 3.2) * 0.8);
      if (reto?.pulse) reto.pulse(simT);
      const isAuto = MODES[modeKey]?.autopilot && apilot.curve && !apilot.transit;
      crumbs.forEach((sp, i) => {
        sp.visible = !!isAuto;
        if (isAuto) {
          sp.position.copy(apilot.curve.getPointAt((apilot.u + (i + 1) * 0.012) % 1));
          sp.scale.setScalar(1.2 + Math.sin(simT * 4 - i * 0.9) * 0.5);
        }
      });
      // hélices con inercia (spin-up/down suave) + bob de hover premium
      propSpin += ((14 + drone.vel.length() * 3) - propSpin) * 0.06;
      for (const pr of props) pr.g.rotation.y += propSpin * STEP * pr.dir;
      for (const bl of propBlurs) bl.material.opacity = Math.min(0.3, 0.04 + propSpin * 0.0038);
      if (navLights.length) {
        const tk = simT % 1.2;                 // doble flash de strobe estilo aeronave
        navLights[0].material.opacity = (tk < 0.07 || (tk > 0.18 && tk < 0.25)) ? 1 : 0.04;
        const nv = 0.9 + Math.sin(simT * 3.1) * 0.1;   // respiración sutil, no pulso
        navLights[1].material.opacity = nv; navLights[2].material.opacity = nv;
      }
      const hover = Math.max(0, 1 - drone.vel.length() / 1.6);
      dmesh.position.y += Math.sin(simT * 2.1) * 0.05 * hover;
      dmesh.rotation.z += Math.sin(simT * 1.3) * 0.008 * hover;
      dmesh.position.copy(P);
      dmesh.rotation.set(0, o.yaw, 0, 'YXZ');
      dmesh.rotation.x = THREE.MathUtils.clamp(-drone.vel.dot(new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw))) * 0.012, -0.35, 0.35);
      if (director) {
        if (director.playing) dirCam(director.f);
        else cc.update(STEP);
      } else if (arrival) {
        // swoop de entrada: de vista-mapa al rig chase, easeOutCubic
        arrival.t += STEP;
        const k = Math.min(1, arrival.t / arrival.dur);
        const e = 1 - Math.pow(1 - k, 3);
        const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(14);
        const want = P.clone().add(back).add(new THREE.Vector3(0, 6, 0));
        const hi = P.clone().add(new THREE.Vector3(diag * 0.25, diag * 0.55, diag * 0.35));
        camera.position.lerpVectors(hi, want, e);
        camera.lookAt(P);
        if (k >= 1) arrival = null;
      } else if (modeKey === 'cinematico') {
        tourT += STEP * cine.v;
        const r = diag * 0.3;                        // más cerca (pedido)
        camera.position.set(Math.cos(tourT) * r, diag * cine.a, Math.sin(tourT) * r);
        camera.lookAt(0, (W.elev_max - W.elev_min) * 0.4, 0);
      } else {
        const rig = RIGS[rigIx];
        rig.fn(P, o, camera, STEP, rig);
        const dw = input.takeWheel();
        if (dw) setGimbal(gimbalTilt - dw * 0.0011);
        if (rig.hideDrone) camera.rotation.x += gimbalTilt;
        else camera.rotateX(gimbalTilt + 0.12);   // gimbal también en chase/orbita (offset neutro)
      }
      sky.update(STEP, camera.position, P);
      sceneObjects?.update(simT);
      {
        const now = performance.now();
        const wdt = Math.min(0.05, (now - (weapons._lt || now)) / 1000);
        weapons._lt = now;
        weapons.update(wdt, sceneObjects?.hittables);
        if (Q.get('fuego') && simT > 1 && !weapons.state.fired) doFire(-1.25);
        if (Q.get('boom') && simT > 5.2 && !weapons._boomed) {
          weapons._boomed = true;             // QA: detonación a nivel de suelo bajo el dron
          const bx = P.x - Math.sin(curYaw) * 6, bz = P.z - Math.cos(curYaw) * 6;
          const bgy = terrain.heightAt(bx, bz) ?? (P.y - 60);
          weapons.explodeAt(new THREE.Vector3(bx, bgy + 0.3, bz));
        }
        const st = weapons.state;
        $('#vl-ammo').textContent = st.ammo;
        $('#vl-cool').style.transform = `scaleX(${1 - st.cool / 0.9})`;
        fireBtn.classList.toggle('empty', st.ammo === 0);
        if (st.destroyed) { const k = $('#vl-kills'); k.textContent = `DERRIBOS ${st.destroyed}`; k.classList.add('show'); }
        // retícula: 80 pasos de balística contra el heightfield
        if (st.ammo > 0 && !director) {
          const pitch = gimbalTilt * 0.55;
          const simP = P.clone(); simP.y -= 0.3;
          const sv = new THREE.Vector3(-Math.sin(curYaw) * Math.cos(pitch), Math.sin(pitch),
            -Math.cos(curYaw) * Math.cos(pitch)).multiplyScalar(56);
          let hitP = null;
          for (let s2 = 0; s2 < 80; s2++) {
            sv.y -= 2.2 * 0.045;
            simP.addScaledVector(sv, 0.045);
            const gy = terrain.heightAt(simP.x, simP.z);
            if (gy != null && simP.y <= gy + 0.3) { simP.y = gy + 0.32; hitP = simP; break; }
          }
          if (hitP) {
            aim.visible = true;
            aim.position.copy(hitP);
            aim.scale.setScalar((1 + Math.sin(simT * 6) * 0.1) * (1 + camera.position.distanceTo(hitP) * 0.015));
          } else aim.visible = false;
        } else aim.visible = false;
        if (shake.mag > 0.003) {                 // sacudida de impacto (decae)
          camera.position.x += (Math.random() - 0.5) * shake.mag;
          camera.position.y += (Math.random() - 0.5) * shake.mag * 0.6;
          camera.rotation.z += (Math.random() - 0.5) * shake.mag * 0.02;
          shake.mag *= Math.pow(0.02, wdt);      // ~decadencia 98%/s
        } else shake.mag = 0;
      }
      composer.render();
      drawMinimap();
      // HUD (barato: texto directo, sin re-layout)
      $('#vl-agl').textContent = drone.agl == null ? 'fuera' : `${drone.agl.toFixed(1)} m`;
      const spd = drone.vel.length();
      $('#vl-spd').textContent = spd.toFixed(1);
      $('#vl-spd-b').style.transform = `scaleX(${Math.min(1, spd / 40)})`;
      $('#vl-agl-b').style.transform = `scaleX(${drone.agl == null ? 0 : Math.min(1, drone.agl / 160)})`;
      $('#vl-fps').textContent = `${Math.round(loop.fps() || 0)} fps`;
      if (recorder.recording) recBtn.textContent = `■ REC ${recorder.seconds.toFixed(0)}s`;
      {
        // oído en la cámara: distancia y paneo del dron relativo al rig activo
        const lpv = camera.worldToLocal(P.clone());
        const camDist = lpv.length();
        audio.update(propSpin, spd, drone.vel.y, camDist,
          lpv.x / Math.max(camDist, 0.001));
      }
      if (RIGS[rigIx].hideDrone) {
        const rollV = new THREE.Vector3(1, 0, 0).applyQuaternion(drone.quat).y;
        $('#vl-horizon').style.transform =
          `translateY(${(-o.pitch * 260).toFixed(1)}px) rotate(${(-rollV * 40).toFixed(1)}deg)`;
        $('#osd-v').textContent = spd.toFixed(1);
        $('#osd-a').textContent = drone.agl == null ? '—' : drone.agl.toFixed(0);
        $('#osd-vt').style.transform = `translateY(${(spd * 9) % 18}px)`;
        $('#osd-at').style.transform = `translateY(${((drone.agl || 0) * 4) % 18}px)`;
        $('#osd-home').textContent = `HOME ${Math.hypot(drone.pos.x, drone.pos.z).toFixed(0)} m`;
        const f = loop.fps() || 60;
        $('#fpv-sig').dataset.n = f > 50 ? 3 : f > 32 ? 2 : 1;   // señal honesta = fps
        $('#fpv-rec').classList.toggle('on', recorder.recording);
        const mm2 = Math.floor(simT / 60), ss2 = Math.floor(simT % 60);
        const hs = Math.hypot(drone.vel.x, drone.vel.z), vs = drone.vel.y;
        $('#fpv-head').textContent =
          `FLT ${String(mm2).padStart(2,'0')}:${String(ss2).padStart(2,'0')} · HS ${hs.toFixed(1)} · VS ${vs >= 0 ? '+' : ''}${vs.toFixed(1)} · DIST ${Math.hypot(drone.pos.x, drone.pos.z).toFixed(0)} m · LNK ${'●'.repeat(+($('#fpv-sig').dataset.n || 3))}`;
      }
      const hdg = ((-o.yaw * 180 / Math.PI) % 360 + 360) % 360;
      const card = ['N','NE','E','SE','S','SO','O','NO'][Math.round(hdg / 45) % 8];
      $('#vl-heading').textContent = `${card} ${Math.round(hdg)}°`;
      const ch = $('#vl-challenge'), cnt = $('#vl-count');
      if (director) {
        ch.textContent = director.playing ? 'DIRECTOR · reproduciendo' : 'DIRECTOR · edición';
        cnt.classList.remove('show');
      } else if (replay) {
        ch.textContent = 'REPLAY · ESC para salir'; cnt.classList.remove('show');
      } else if (reto) {
        const st = reto.state;
        if (st.phase === 'countdown') {
          cnt.textContent = String(Math.ceil(st.countdown)); cnt.classList.add('show');
          ch.textContent = 'GATE RUSH';
        } else cnt.classList.remove('show');
        if (st.phase === 'running') ch.textContent = `T ${st.t.toFixed(1)}s · gate ${Math.min(st.idx + 1, st.total)}/${st.total}`;
        if (st.phase === 'finished') ch.textContent = `GATE RUSH · ${st.time.toFixed(2)}s`;
      } else {
        ch.textContent = 'T · iniciar Gate Rush'; cnt.classList.remove('show');
      }
    },
  });
  // ── CALIDAD de render (desktop): auto | extra | 4k | ultra ──
  // auto = gobernador adaptativo (≤2 DPR); manual = DPR fijo + anisotropía 16.
  // escalera ABSOLUTA de supersampling (antes en Retina extra==auto y 4K<auto)
  const CALIDADES = {
    auto:  { label: 'auto',  dpr: null, aniso: 8 },
    hd:    { label: 'HD',    dpr: 2,    aniso: 8 },
    extra: { label: 'extra', dpr: 2.5,  aniso: 16 },
    '4k':  { label: '4K',    dpr: 3,    aniso: 16 },
    ultra: { label: 'ultra', dpr: 4,    aniso: 16 },
  };
  let calidad = localStorage.getItem('ab.fv.calidad') || 'auto';
  if (!CALIDADES[calidad]) calidad = 'auto';
  const applyDpr = d => {
    renderer.setPixelRatio(d);
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  };
  let fullTex = null;
  const setCalidad = k => {
    calidad = k;
    const c = CALIDADES[k];
    $('#vl-calidad').textContent = `calidad · ${c.label}`;
    if (terrain.mesh.material.map) {
      terrain.mesh.material.map.anisotropy = c.aniso;
      terrain.mesh.material.map.needsUpdate = true;
    }
    // el supersampling no inventa textura: extra+ sube a la ORTO COMPLETA
    if (c.aniso >= 16 && man.assets.ortho_full && !fullTex) {
      new THREE.TextureLoader().loadAsync(man.assets.ortho_full).then(t => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
        fullTex = t;
        terrain.mesh.material.map = t;
        terrain.mesh.material.needsUpdate = true;
        report.orthoFull = true;
      }).catch(() => {});
    } else if (fullTex) {
      terrain.mesh.material.map = fullTex;   // ya cargada: persiste
    }
    if (c.dpr) { dprNow = c.dpr; applyDpr(c.dpr); }
    else { dprNow = Math.min(devicePixelRatio, 2); applyDpr(dprNow); }
    localStorage.setItem('ab.fv.calidad', k);
    report.calidad = { k, dpr: +dprNow.toFixed(2) };
  };
  $('#vl-calidad').addEventListener('click', () => {
    const ks = Object.keys(CALIDADES);
    setCalidad(ks[(ks.indexOf(calidad) + 1) % ks.length]);
  });

  let dprNow = Math.min(devicePixelRatio, 2);
  setCalidad(calidad);
  setInterval(() => {
    if (calidad !== 'auto') return;              // manual manda; el governor descansa
    const f = loop.fps() || 60;
    const maxDpr = Math.min(devicePixelRatio, 2);
    let want = dprNow;
    if (f < 52) want = Math.max(1, dprNow - 0.25);
    else if (f > 58 && dprNow < maxDpr) want = Math.min(maxDpr, dprNow + 0.25);
    if (want !== dprNow) { dprNow = want; applyDpr(want); }
  }, 2000);

  renderer.compile(scene, camera);             // warmup: sin hitch del primer frame
  loop.start();
  report.ready = true;

  if (auto && AT === '1') {
    setTimeout(() => {
      report.fps = Math.round(loop.fps() || 0);
      report.audioArmed = audio.armed;
      report.weapons = { fired: weapons.state.fired, exploded: weapons.state.exploded };
      report.pos = { x: +drone.pos.x.toFixed(1), y: +drone.pos.y.toFixed(1), z: +drone.pos.z.toFixed(1) };
      report.agl = drone.agl == null ? null : +drone.agl.toFixed(1);
      report.distance = Math.round(drone.distance);
      report.ghost = !!ghost;
      report.moved = drone.distance > 20;
      report.ok = report.moved && report.fps >= 20 && Number.isFinite(drone.pos.y);
      report.done = true;
    }, (auto.until + 1.5) * 1000);
  }
}

main().catch(e => {
  report.errors.push(String(e?.message || e));
  report.done = true;
  document.body.insertAdjacentHTML('beforeend',
    `<div class="vl-err">No se pudo iniciar el vuelo: ${esc(e.message)} · <a href="mundo.html">volver al Mundo</a></div>`);
});
