// volar.js — FLIGHTVERSE /volar: vuelo jugable sobre la escena real (P3).
// Escena unificada (terreno DSM+orto vía flightverse/scene.js) + dron con
// física de timestep fijo (flightverse/runtime.js) + ghost del vuelo REAL
// (track GPS 1Hz interpolado — el dato más honesto del juego: eso voló ahí).
// ?autotest=1 → 5s de vuelo sintético y reporte en window.__volar (gate CDP).
//
// Este archivo es SOLO orquestación (boot, loop, ciclo de vida). Desde el refactor A0
// la lógica vive en módulos por workstream, conectados por `ctx` (contexto compartido)
// y `bus` (eventos tipados):
//   ui/*     (A) HUD, menús, pantallas         → mountUi(ctx) / installUi(ctx)
//   fx/*     (B) armas, FX, audio              → installFx(ctx)
//   input/*  (C) controles, cámara, dron       → installControls(ctx), createDroneModel(ctx)
//   modes/*  (D) enemigos, Invasión, Gate Rush → installEnemies(ctx)
//   tour/*   (E) ghost, autopiloto, director   → installTour(ctx)
// Contrato: docs/FLIGHTVERSE_DESIGN_SPEC.md §15. Flag ?fv=2 → ctx.flags.fv2.
import * as THREE from '/flightverse/three.js?v=370';
import {
  loadManifest, loadTerrain, attachSplat, attachVisualMesh, createSceneGeneration,
} from '/flightverse/scene.js?v=370';
import {
  createLoop, createInput, createDrone, MODES, STEP,
} from '/flightverse/runtime.js?v=370';
import { createAudio } from '/flightverse/audio.js?v=370';
import { createSky } from '/flightverse/sky.js?v=370';
import { createVegetation, reducedMotion } from '/flightverse/vegetation.js?v=370';
import { loadSceneObjects } from '/flightverse/objects.js?v=370';
import { createWorldCollision } from '/flightverse/world-collision.js?v=370';
import { createRenderQualityGovernor } from '/flightverse/render-quality.js?v=370';
import { createLazyLayerLoader, markLoadStep } from '/flightverse/layer-load-state.js?v=370';
import { splatAlignmentLabel } from '/flightverse/hud-format.js?v=370';
import { createMutableCollisionWorld } from '/flightverse/scene-object-collision.js?v=370';
import { createBus } from '/flightverse/bus.js?v=370';
import { mountUi, installUi } from '/flightverse/ui/index.js?v=370';
import { bootProgress, markLayerUnavailable, bootError } from '/flightverse/ui/screens.js?v=370';
import { installFx } from '/flightverse/fx/index.js?v=370';
import { installControls, createDroneModel } from '/flightverse/input/index.js?v=370';
import { installEnemies } from '/flightverse/modes/index.js?v=370';
import { installTour } from '/flightverse/tour/index.js?v=370';
import {
  EffectComposer, RenderPass, EffectPass, Effect,
  SMAAEffect, SMAAPreset, BloomEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
  BrightnessContrastEffect, HueSaturationEffect,
} from '/vendor/postprocessing180.module.js?v=370';


// exposición multiplicativa ANTES del tonemap — el 'brillo' aditivo del panel
// empujaba los blancos del splat a clip (puntos blancos, reporte del operador)
class ExposureFx extends Effect {
  constructor(exp = 1) {
    super('ExposureFx',
      'uniform float uExp; void mainImage(const in vec4 c, const in vec2 uv, out vec4 o){ o = vec4(c.rgb * uExp, c.a); }',
      { uniforms: new Map([['uExp', new THREE.Uniform(exp)]]) });
  }
}
const Q = new URLSearchParams(location.search);
const CID = (Q.get('m') || '').replace(/[^\w-]/g, '');
const COVERAGE_DIAMETERS = new Set(['100', '200', '400', '600', '1000']);
const COVERAGE_REQUEST = COVERAGE_DIAMETERS.has(Q.get('diametro')) ? +Q.get('diametro') : null;
const COVERAGE_SHAPE = Q.get('forma') === 'square' ? 'square' : 'circle';
const AT = Q.get('autotest');
const AUTOTEST = AT === '1' || AT === 'record';   // ambos vuelan input sintético
const report = { ready: false, done: false, errors: [], cid: CID };
window.__volar = report;

// Safari puede restaurar desde bfcache un DOM/JS viejo y luego revalidar solo el
// CSS, mezclando dos builds. Al volver a la pestaña comparamos el fingerprint del
// módulo activo con el HTML no-cache; si cambió, una recarga atómica evita el HUD híbrido.
const ACTIVE_BUILD = new URL(import.meta.url).searchParams.get('v');
let buildCheckRunning = false;
async function refreshStaleBuild() {
  if (!ACTIVE_BUILD || buildCheckRunning) return;
  buildCheckRunning = true;
  try {
    const html = await fetch(location.pathname + location.search, { cache: 'no-store' }).then(r => r.text());
    const current = html.match(/\bvolar\.js\?v=(\d+)/)?.[1];
    if (current && current !== ACTIVE_BUILD) location.reload();
  } catch { /* offline: conservar la sesión actual */ }
  finally { buildCheckRunning = false; }
}
addEventListener('pageshow', event => { if (event.persisted) refreshStaleBuild(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStaleBuild();
});

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Táctil = sin atajos de teclado en pantalla (T · …, H, etc.)
const COARSE_PTR = matchMedia('(pointer:coarse)').matches;

// ── contexto compartido (contrato entre workstreams) ──
// bus   : eventos tipados (flightverse/bus.js): fire hit explode damage crash respawn lock wave gate mode pause tod
// flags : ?fv=2 (rediseño Flightverse v2, default false), ?debug=1, autotest, táctil
// state : estado de juego mutable COMPARTIDO entre módulos (antes `let` sueltos de main())
// actions: puntos de entrada nombrados que los módulos registran y se llaman entre sí
// ui/fx/controls/enemies/tour: API de cada módulo (la rellena su install*)
const flags = Object.freeze({
  fv2: Q.get('fv') === '2',
  debug: Q.get('debug') === '1',
  autotest: AT,
  coarse: COARSE_PTR,
});
const bus = createBus({ validate: flags.debug });
const ctx = {
  THREE, $, esc, Q, CID, AT, AUTOTEST, report, bus, flags,
  auto: AUTOTEST ? { until: 5 } : null,
  P: new THREE.Vector3(),
  state: {
    simT: 0, modeKey: 'asistido',
    reto: null, replay: null, retoFly: null, retoMode: 'asistido', resultShown: false,
    director: null, ghost: null, sceneObjects: null, firing: false, lastInvasionRun: null,
  },
  trigger: {
    held: false, locked: false, source: null, pointerId: null,
    presses: 0, releases: 0, accepted: 0, mode: 'single',
  },
  actions: {},
  ui: {},
  fx: { selectedWeaponKey: 'm', selectWeaponModel: () => Promise.resolve(null) },
  controls: {},
  enemies: {},
  tour: {},
};
// inspección desde la consola / gates (no enumerable: JSON.stringify(window.__volar) no la incluye)
Object.defineProperty(report, 'ctx', { value: ctx, enumerable: false });
const S = ctx.state;
const P = ctx.P;


async function main() {
  if (!CID) { location.replace('mundo.html'); return; }
  document.title = 'AeroBrain — Volar';
  mountUi(ctx);                         // HUD + guardas de superficie + panel de imagen compacto
  const coarsePointer = flags.coarse;
  const say = m => { $('#vl-scene').textContent = m; };
  say('Cargando escena…');
  bootProgress(5, 'Leyendo escena');


  const man = await loadManifest(CID);
  ctx.man = man;
  bootProgress(15, 'Cargando terreno');
  const coverageRows = man.coverage?.shapes?.[COVERAGE_SHAPE] || [];
  const requestedCoverage = COVERAGE_REQUEST
    ? coverageRows.find(row =>
      row.diameter_m === COVERAGE_REQUEST && row.ready) : null;
  const requestedCoverageUnavailable = Boolean(
    COVERAGE_REQUEST && !requestedCoverage,
  );
  const coverageProduct = requestedCoverage || coverageRows.filter(row => row.ready).at(-1) || null;
  const coverageArea = coverageProduct?.area_m2
    ? `${Math.round(coverageProduct.area_m2).toLocaleString('es-CO')} m²` : null;
  const coverageLabel = coverageProduct
    ? `${coverageProduct.diameter_m} m · ${COVERAGE_SHAPE === 'square' ? 'cuadrado' : 'círculo'} · ${coverageArea}`
    : 'extensión nativa';
  report.coverage = {
    requested_diameter_m: COVERAGE_REQUEST,
    requested_honored: !requestedCoverageUnavailable,
    effective_diameter_m: coverageProduct?.diameter_m || null,
    shape: COVERAGE_SHAPE,
    renderer: coverageProduct?.preferred_renderer || 'terrain',
    status: requestedCoverageUnavailable
      ? 'native-fallback'
      : coverageProduct?.status || 'native',
    fallback_reason: requestedCoverageUnavailable
      ? 'requested-coverage-unavailable'
      : null,
  };
  $('#vb-name').textContent = man.name || 'Cargando escena…';
  if (!man.capabilities?.terrain) throw new Error('escena sin terreno volable');
  $('#vl-scene').textContent = `${man.name} · ${coverageLabel}`;

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
  const generation = createSceneGeneration();
  const worldGroup = new THREE.Group();
  worldGroup.name = 'fv-world';
  scene.add(worldGroup);
  report.lifecycle = {
    generation: generation.token,
    groups: scene.children.filter(node => node.name === 'fv-world').length,
    disposedStaleLoads: 0,
  };
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
  Object.assign(ctx, { renderer, scene, camera, worldGroup });
  // ?qa=1 → window.__volar.qa.pose(x,y,z,yawDeg,pitchDeg) fija la cámara (solo QA visual)
  let qaPose = null;
  if (Q.get('qa') === '1') {
    report.qa = {
      pose: (x, y, z, yawDeg = 0, pitchDeg = 0) => {
        qaPose = { x, y, z, yaw: THREE.MathUtils.degToRad(yawDeg), pitch: THREE.MathUtils.degToRad(pitchDeg) };
      },
      clear: () => { qaPose = null; },
      scene, camera,
    };
  }
  // cielo vivo: domo gradiente + sol/estrellas + nubes a la deriva; las luces
  // y la niebla las gobierna el preset (dia/atardecer/noche)
  const sky = createSky(scene);
  ctx.sky = sky;
  const qCielo = Q.get('cielo');
  if (qCielo) sky.setPreset(qCielo);

  // look premium: un solo EffectPass fusiona SMAA+Bloom+ACES+Vignette en un shader
  // NEUTRAL (no ACES): los colores del splat ya son display-referred — ACES
  // los lavaba; bloom umbral 1.0 para que los blancos del splat no lo disparen
  const post = {
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
  Object.assign(ctx, { composer, post });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera,
    new SMAAEffect({ preset: SMAAPreset.HIGH }),
    post.exp, post.bloom, post.hs,
    new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    post.bc, post.vig,
  ));

  // nivel visual del terreno/atmósfera (W5): high (desktop) · lite (táctil) · off (?fx=0 = look anterior)
  const FX = Q.get('fx') === '0' ? 'off' : (coarsePointer ? 'lite' : 'high');
  report.fx = FX;
  const terrain = await loadTerrain(man, { anisotropy: 8, fx: FX });
  ctx.terrain = terrain; ctx.fxLevel = FX;
  if (report.qa) { report.qa.heightAt = terrain.heightAt; report.qa.world = terrain.world; }
  const FRONTIER_COLORS = { dia: 0xcfe2f2, atardecer: 0xc08066, noche: 0x0c1420 };
  terrain.frontier.uFrontierOn.value = Q.get('diagnostic') !== '1' ? 1 : 0;
  const LIFT = { dia: 0.5, atardecer: 0.4, noche: 0.3 };       // piso de luz de sombras (fracción del albedo)
  const syncLook = () => {
    if (FX === 'off') {
      terrain.frontier.uFrontierColor.value.set(FRONTIER_COLORS[sky.preset] || FRONTIER_COLORS.dia);
    } else {
      terrain.frontier.uFrontierColor.value.copy(sky.fogColor);   // el borde se funde con la niebla/horizonte
      terrain.look.uLift.value = LIFT[sky.preset] ?? LIFT.dia;
    }
  };
  syncLook();
  ctx.syncLook = syncLook;
  terrain.mesh.matrixAutoUpdate = false; terrain.mesh.updateMatrix();   // estática
  terrain.mesh.receiveShadow = true;
  worldGroup.add(terrain.mesh);
  markLoadStep(document, 'vb-terreno');
  bootProgress(55, 'Preparando colisiones');
  const W = terrain.world;
  ctx.W = W;
  sky.setWorldScale(Math.min(...W.size_m) / 2, { enabled: FX !== 'off' });
  syncLook();
  if (man.capabilities?.mesh && !man.capabilities?.collision) {
    throw new Error('mundo bloqueado: malla sin collider estructural vigente');
  }
  const nativeHalfExtent = Math.min(...W.size_m) / 2;
  const playableHalfExtent = requestedCoverage
    ? requestedCoverage.diameter_m / 2
    : nativeHalfExtent;
  const boundary = COVERAGE_SHAPE === 'square'
    ? { shape: 'square', halfExtent: playableHalfExtent }
    : { shape: 'circle', radius: playableHalfExtent };
  report.coverage.effective_diameter_m = playableHalfExtent * 2;
  report.coverage.boundary_source = requestedCoverage
    ? 'requested'
    : requestedCoverageUnavailable ? 'native-fallback' : 'native';
  const world = await createWorldCollision(man, {
    heightAt: terrain.heightAt,
    boundary,
    report,
  });
  const collision = createMutableCollisionWorld(world);
  Object.assign(ctx, { world, collision });
  if (report.qa) report.qa.collision = collision;   // ?qa=1: consultas de colisión para verificar alineación con lo dibujado
  report.collision = {
    ready: world.qa.ready,
    structure: world.qa.structure,
    tris: world.qa.tris || 0,
  };
  $('#vl-ghost').textContent += ' · colisión ok';

  let visualMesh = null;
  let splat = null;
  let vegetation = null;
  const preferredRenderer = coverageProduct?.preferred_renderer || 'terrain';
  const representation = {
    preferred: preferredRenderer,
    requested: preferredRenderer,
    active: 'terrain',
    fallbackReason: null,
    visibleStructuralLayers: ['terrain'],
  };
  report.representation = representation;
  let requestedRenderer = preferredRenderer;
  const applyVista = () => {
    representation.requested = requestedRenderer;
    let active = requestedRenderer;
    let fallbackReason = null;
    if (!['terrain', 'mesh', 'splat'].includes(active)) {
      active = 'terrain';
      fallbackReason = `renderer desconocido: ${requestedRenderer}`;
    }
    if (active === 'mesh' && (!visualMesh || !terrain.meshMask.available)) {
      active = 'terrain';
      fallbackReason = visualMesh ? 'malla sin máscara de cobertura' : 'malla aún no disponible';
    }
    if (active === 'splat' && (!splat || !splat.aligned)) {
      active = visualMesh && terrain.meshMask.available ? 'mesh' : 'terrain';
      fallbackReason = 'splat alineado no disponible';
    }
    terrain.mesh.visible = true;
    terrain.mesh.position.y = 0;
    terrain.mesh.updateMatrix();
    terrain.meshMask.uMeshOn.value = active === 'mesh' ? 1 : 0;
    terrain.splatMask.uSplatOn.value = active === 'splat' ? 1 : 0;
    terrain.splatMask.uSplatC.value.set(0, 0);
    terrain.splatMask.uSplatR.value = playableHalfExtent;
    if (visualMesh) visualMesh.object.visible = active === 'mesh';
    if (splat) splat.object.visible = active === 'splat';
    vegetation?.setVisible(active !== 'splat');   // el splat es dueño de su huella: sin vegetación flotando
    representation.active = active;
    representation.fallbackReason = fallbackReason;
    representation.visibleStructuralLayers = active === 'terrain'
      ? ['terrain']
      : [active, 'terrain-fallback'];
    const labels = { terrain: 'terreno', mesh: 'malla 3D', splat: 'foto-real' };
    $('#vl-vista').textContent = `vista · ${labels[active]}`;
    $('#vl-vista').style.opacity = active === requestedRenderer ? 1 : 0.7;
  };
  const cycleVista = () => {
    const renderers = ['terrain', 'mesh', 'splat'];
    requestedRenderer = renderers[(renderers.indexOf(requestedRenderer) + 1) % renderers.length];
    applyVista();
    if (requestedRenderer === 'mesh') void ensureVisualMesh();
  };
  ctx.actions.cycleVista = cycleVista;   // el chip 'vista' lo cablea ui/menu.js
  applyVista();

  const canLoadVisualMesh = Boolean(
    man.capabilities?.mesh && man.assets?.mesh_mtl_low && man.transforms?.mesh_offset,
  );
  if (!canLoadVisualMesh) markLayerUnavailable('vb-malla');
  if (!(man.capabilities?.splat && man.transforms?.splat?.status === 'aligned')) markLayerUnavailable('vb-splat');
  const visualMeshLoader = canLoadVisualMesh
    ? createLazyLayerLoader(() => attachVisualMesh(man, worldGroup, {
      renderer,
      coverageMask: terrain.meshMask,
      onProgress: f => {
        if (f != null) $('#vl-scene').textContent = `${man.name} · ${coverageLabel} · malla ${Math.round(f * 100)}%`;
      },
    }))
    : null;
  report.visualMesh = false;
  // guardia de la regresión 0/1 vs 0/255 (sep-30): fracción de la máscara que el shader verá >= 0.5
  { const d = terrain.meshMask.texture?.image?.data;
    let on = 0; if (d) for (let i = 0; i < d.length; i++) if (d[i] >= 128) on++;
    report.meshCoverageOnFrac = d ? +(on / d.length).toFixed(4) : null; }
  report.visualMeshState = visualMeshLoader ? visualMeshLoader.state : 'unavailable';
  let visualMeshReady = null;
  const ensureVisualMesh = () => {
    if (!visualMeshLoader) return Promise.resolve(null);
    if (visualMeshReady) return visualMeshReady;
    report.visualMeshState = 'loading';
    visualMeshReady = visualMeshLoader.ensure().then(v => {
      if (!v) return;
      if (!generation.isCurrent()) {
        v.dispose();
        report.lifecycle.disposedStaleLoads++;
        return null;
      }
      visualMesh = v;
      $('#vl-scene').textContent = `${man.name} · ${coverageLabel} · malla fotogramétrica`;
      report.visualMesh = true;
      report.visualMeshState = 'ready';
      report.visualMeshCoverageClipped = Boolean(v.coverageClipped);
      markLoadStep(document, 'vb-malla');
      applyVista();
      return v;
    }).catch(e => {
      report.visualMeshState = 'error';
      report.errors.push('malla visual: ' + e.message);
      return null;
    });
    return visualMeshReady;
  };
  if (requestedRenderer === 'mesh') void ensureVisualMesh();
  // vegetación (W5): scatter.py → InstancedMesh. Solo relleno visual del terreno sin malla; sin colisión.
  // ?scatter=0 la apaga; cualquier fallo deja el mundo como estaba.
  report.vegetation = null;
  if (FX !== 'off' && Q.get('scatter') !== '0' && man.assets?.scatter) {
    createVegetation(man, worldGroup, { heightAt: terrain.heightAt, fx: FX, sway: !reducedMotion() })
      .then(veg => {
        if (!veg) return;
        if (!generation.isCurrent()) { veg.dispose(); report.lifecycle.disposedStaleLoads++; return; }
        vegetation = veg;
        report.vegetation = { ...veg.stats, fx: FX, sway: !reducedMotion() };
        applyVista();
      })
      .catch(e => console.warn('[fv] vegetación no disponible:', e?.message || e));
  }
  // objetos de escena (plataforma de juegos: docs/SCENE_OBJECTS.md)
  loadSceneObjects(man, worldGroup, { heightAt: terrain.heightAt })
    .then(so => {
      if (!generation.isCurrent()) {
        so?.dispose();
        report.lifecycle.disposedStaleLoads++;
        return;
      }
      S.sceneObjects = so;
      if (so) {
        collision.setItems(S.sceneObjects.collision);
        report.objects = so.count;
        report.collision.items = collision.qa.itemCount;
      }
    })
    .catch(e => report.errors.push('objects: ' + e.message));

  // splat héroe: solo si splat_align.py lo dejó 'aligned' (RMSE sub-métrico).
  // Carga DESPUÉS del terreno (el juego ya es volable mientras llega el ksplat).
  if (man.capabilities?.splat && man.transforms?.splat?.status === 'aligned') {
    attachSplat(man, worldGroup, {
      renderer,
      onProgress: p => { if (p < 100) $('#vl-scene').textContent = `${man.name} · ${coverageLabel} · splat ${Math.round(p)}%`; },
    }).then(s => {
      if (!generation.isCurrent()) {
        s?.dispose();
        report.lifecycle.disposedStaleLoads++;
        return;
      }
      splat = s;
      $('#vl-scene').textContent = `${man.name} · ${coverageLabel} · foto-real ${splatAlignmentLabel(s)}`;
      report.splat = { aligned: s.aligned, rmse_m: s.rmse };
      markLoadStep(document, 'vb-splat');
      applyVista();
    }).catch(e => {
      report.errors.push('splat: ' + e.message);
      $('#vl-scene').textContent = `${man.name} · ${coverageLabel}`;
    });
  }

  // dron rediseñado: proporciones DJI (~0.85m), cuerpo bajo, brazos finos,
  // props que giran con la velocidad, gimbal frontal — solo primitivas three
  bootProgress(80, 'Preparando el dron');
  const drone = createDrone({ world: collision, spawn: man.spawn });
  if (report.qa) report.qa.drone = drone;           // ?qa=1: estado del dron para pruebas de física/colisión
  report.collision.radius_m = +drone.collisionRadius.toFixed(3);
  report.collision.radius_source = 'fallback';
  report.customDrone = false;
  report.camera = { collision_checks: 0, collision_hits: 0, rig: null };
  ctx.drone = drone;
  ctx.droneModel = createDroneModel(ctx);       // input/drone-model.js: malla, hélices, luces, hardpoints
  await installTour(ctx);                        // tour/*: ghost del vuelo real, autopiloto, director, recorder

  // ── estado de juego ──
  const input = createInput(renderer.domElement);
  const audio = createAudio();
  ctx.input = input; ctx.audio = audio;
  await installFx(ctx);                          // fx/*: armas, modelos 3D, retícula, sacudida
  installEnemies(ctx);                           // modes/*: Invasión + Gate Rush
  installControls(ctx);                          // input/*: gatillo, palancas, cámara, atajos
  installUi(ctx);                                // ui/*: selector de arma, menú, overlays, pantallas
  const { fx, enemies, tour, controls } = ctx;
  const { weapons } = fx;
  const { actions: A } = ctx;

  A.setMode(Q.get('modo') && MODES[Q.get('modo')] ? Q.get('modo') : 'asistido');
  controls.camera.setRig(controls.camera.rigIx); applyVista();
  if (Q.get('reto') === '1' && !AT) setTimeout(() => A.startReto(Q.get('dif') || 'media'), 3800);   // tras el arrival

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  if (AT === 'record') tour.autotestRecord();
  let qualityGovernor = null;
  let dprNow = Math.min(devicePixelRatio, 2);
  let renderReportFrame = 0;
  const renderLifecycle = { pauses: 0, resumes: 0 };
  const loop = createLoop({
    timeScale: () => fx.timeScale(),
    onPause: () => {
      renderLifecycle.pauses += 1;
      controls.onPause();          // pausa/oculta: no dejar teclas ni disparo pegados
    },
    onResume: () => {
      renderLifecycle.resumes += 1;
      if (qualityGovernor) qualityGovernor.reset();
    },
    update(dt) {
      // Hit-stop (?fv=2, fx.timeScale() suavizado hasta 0.05 durante 40-80 ms): el MUNDO entero se congela a la vez — física
      // del dron, enemigos, armas, reloj de Gate Rush, fantasma. La escala entra en el acumulador de createLoop (loop-step.js):
      // los pasos siguen siendo exactos (STEP) y no se salta ninguno; lo que se frena es el tiempo, y `alpha` interpola fluido.
      S.simT += dt;
      // Pausa real de juego: con cualquier panel abierto (menú, armamento, imagen, guía…) el
      // input ya está cortado; sin esto la horda seguía matando al jugador y el reloj de Gate
      // Rush seguía corriendo mientras el menú tapaba la pantalla (sobre todo en móvil).
      const gamePaused = !!ctx.ui.overlay?.active();
      // quién mueve al dron este paso: director > replay > autopiloto Arcade > aproximación a Gate Rush > vuelo manual
      if (S.director) tour.director.stepDirector(dt);
      else if (S.replay) tour.director.stepReplay(dt);
      else if (MODES[S.modeKey]?.autopilot && S.ghost) tour.autopilot.step(dt);
      else if (S.retoFly) enemies.gaterush.stepFly(dt);
      else {
        controls.step(dt);
        enemies.gaterush.afterStep(dt, gamePaused);
        controls.afterStep();
      }
      fx.update(dt, gamePaused);
      enemies.update(dt, gamePaused);
      fx.afterUpdate();
      report.coverage.boundary_hits = world.qa.boundaryHits;
      tour.ghost.update(dt);
    },
    render(alpha, frameMs) {
      const o = drone.lerpPose(alpha, P);
      // dt REAL del frame para animación de presentación: antes avanzaba STEP (1/120) por frame pintado,
      // así el swoop de llegada (3.4 s) duraba ~9 s a 31-56 fps y la sacudida decaía según el FPS
      const rdt = Number.isFinite(frameMs) && frameMs > 0 ? Math.min(0.1, frameMs / 1000) : 1 / 60;
      const pdt = rdt * fx.timeScale();      // dt de PRESENTACIÓN (swoop, órbita, FOV, pulsos): también se congela en hit-stop
      controls.camera.updateFov(pdt);   // FOV kick con turbo + patada de sacudida
      tour.ghost.renderPulse();
      enemies.gaterush.renderPulse();
      tour.autopilot.renderCrumbs(MODES[S.modeKey]?.autopilot);
      ctx.droneModel.update(P, o);      // hélices con inercia, luces, bob de hover, pose del dron
      if (S.director) tour.director.cameraUpdate();
      else if (tour.cinematic.arrivalActive) tour.cinematic.stepArrival(o, pdt);   // swoop de entrada
      else if (S.modeKey === 'cinematico') tour.cinematic.stepOrbit(pdt);
      else controls.camera.update(o);
      sky.update(STEP, camera.position, P);
      vegetation?.update(S.simT);
      S.sceneObjects?.update(S.simT);
      {
        report.collision.casts = collision.qa.casts;
        report.collision.sweeps = collision.qa.sweeps;
        report.collision.recoveries = collision.qa.recoveries;
        report.collision.world_hits = collision.qa.worldHits;
        report.collision.item_hits = collision.qa.itemHits;
        enemies.report();
        fx.report();
        controls.report();
        ctx.modeHud = enemies.renderHud();   // A: marcadores/placa/banners de D (?fv=2)
        ctx.ui.weapons.update();
        fx.render(rdt);                 // retícula de impacto + sacudida de cámara
      }
      if (qaPose) {                            // ?qa=1: cámara libre para capturas de comparación
        camera.position.set(qaPose.x, qaPose.y, qaPose.z);
        camera.rotation.set(qaPose.pitch, qaPose.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
      }

      if (report.qa) renderer.info.autoReset = false, renderer.info.reset();   // ?qa=1: contadores de TODO el frame
      composer.render();
      if (report.qa) report.qa.frame = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      if (calidad === 'auto' && qualityGovernor) {
        const decision = qualityGovernor.sample(frameMs, performance.now());
        if (decision.changed) {
          dprNow = decision.dpr;
          applyDpr(dprNow);
        }
      }
      renderReportFrame += 1;
      if (renderReportFrame % 30 === 0) {
        const measured = qualityGovernor?.snapshot() || {
          tier: -1, changes: 0, reason: 'manual', avgMs: frameMs, p95Ms: frameMs, samples: 1,
        };
        report.render = {
          dpr: +dprNow.toFixed(2),
          tier: measured.tier,
          changes: measured.changes,
          reason: calidad === 'auto' ? measured.reason : 'manual',
          avgMs: +measured.avgMs.toFixed(2),
          p95Ms: +measured.p95Ms.toFixed(2),
          samples: measured.samples,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          pauses: renderLifecycle.pauses,
          resumes: renderLifecycle.resumes,
        };
      }
      const spd = drone.vel.length();
      fx.audioFrame(spd);                      // oído en la cámara
      ctx.ui.update({ o, spd });               // HUD, minimapa, arranque, etiqueta REC
    },
  });
  ctx.loop = loop;

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
  // En teléfono, 4K/ultra (DPR 3-4 = 6.4 MP con SMAA+bloom en half-float) superan el DPR real de la
  // pantalla y Metal desaloja texturas/tab crashea; además el valor persistía y se repetía en cada recarga.
  const CALIDAD_KEYS = COARSE_PTR ? ['auto', 'hd', 'extra'] : Object.keys(CALIDADES);
  const readStoredCalidad = () => { try { return localStorage.getItem('ab.fv.calidad'); } catch { return null; } };
  const storedCalidad = readStoredCalidad();
  let calidad = Q.get('calidad')                                   // QA: calidad por URL (sin límite)
    || (CALIDAD_KEYS.includes(storedCalidad) ? storedCalidad : 'auto');
  if (!CALIDADES[calidad]) calidad = 'auto';
  const applyDpr = d => {
    if (Math.abs(renderer.getPixelRatio() - d) < 0.001) return;
    renderer.setPixelRatio(d);
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  };
  let fullTex = null;
  // En móvil el selector fino está oculto. Auto usa la ortofoto 5K cuando
  // WebGL declara un tamaño seguro; antes quedaba bloqueado siempre en 2000px.
  const preferFullOrtho = matchMedia('(pointer:coarse)').matches
    && renderer.capabilities.maxTextureSize >= 8192;
  // las texturas viewer de la malla son downscales: extra+ sube a los ATLAS
  // ORIGINALES del geo (~90MB, perezoso one-shot — mismo principio que
  // ortho_full: el supersampling no inventa textura)
  // tier geo RETIRADO con causa: 73 atlas de 4096² = 6.5GB de VRAM sin
  // comprimir — con el framebuffer de 4K/ultra, Metal desaloja texturas y la
  // malla se pinta NEGRA a parches. vtx (2048², 1.6GB) es el techo sano hasta
  // tener KTX2/basis comprimido en GPU. upgradeMeshTex queda no-op.
  const upgradeMeshTex = () => {};
  const setCalidad = k => {
    calidad = k;
    const c = CALIDADES[k];
    $('#vl-calidad').textContent = `calidad · ${c.label}`;
    if (terrain.mesh.material.map) {
      terrain.mesh.material.map.anisotropy = c.aniso;
      terrain.mesh.material.map.needsUpdate = true;
    }
    // el supersampling no inventa textura: extra+ sube a la ORTO COMPLETA
    if ((preferFullOrtho || c.aniso >= 16) && man.assets.ortho_full && !fullTex) {
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
    if (c.dpr) {
      dprNow = c.dpr;
      applyDpr(c.dpr);
    } else {
      qualityGovernor = createRenderQualityGovernor({
        deviceDpr: Math.min(devicePixelRatio, 2),
        initialDpr: Math.min(dprNow, devicePixelRatio, 2),
      });
      dprNow = qualityGovernor.snapshot().dpr;
      applyDpr(dprNow);
    }
    if (!Q.get('calidad')) { try { localStorage.setItem('ab.fv.calidad', k); } catch { /* bloqueado */ } }
    report.calidad = { k, dpr: +dprNow.toFixed(2) };
    upgradeMeshTex(k);
  };
  ctx.actions.cycleCalidad = () => {
    const ks = CALIDAD_KEYS;
    setCalidad(ks[(ks.indexOf(calidad) + 1) % ks.length]);
  };

  setCalidad(calidad);

  renderer.compile(scene, camera);             // warmup: sin hitch del primer frame
  // volar.html no carga shell.js: el teardown de pagehide deja la escena muerta al restaurar desde bfcache
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  addEventListener('pagehide', () => {
    generation.invalidate();
    loop.stop();
    ctx.ui.dispose();                          // selector de arma, guardas de superficie, overlays
    controls.dispose();                        // orientación, herramientas de vuelo, fuego, palancas, rig
    input.dispose();
    collision.dispose();
    world.dispose();
    S.sceneObjects?.dispose();
    visualMesh?.dispose();
    vegetation?.dispose();
    splat?.dispose();
    terrain.dispose();
    fx.dispose();
    enemies.dispose();
    worldGroup.removeFromParent();
    composer.dispose?.();
    renderer.dispose();
  }, { once: true });
  loop.start();
  report.ready = true;

  if (ctx.auto && AT === '1') {
    setTimeout(() => {
      report.fps = Math.round(loop.fps() || 0);
      report.audioArmed = audio.armed;
      report.weapons = {
        ...(report.weapons || {}),
        fired: weapons.state.fired,
        exploded: weapons.state.exploded,
        projectiles: weapons.state.missiles.length
          + weapons.state.bullets.length
          + weapons.state.schedules.length,
      };
      report.pos = { x: +drone.pos.x.toFixed(1), y: +drone.pos.y.toFixed(1), z: +drone.pos.z.toFixed(1) };
      report.agl = drone.agl == null ? null : +drone.agl.toFixed(1);
      report.collision.radius_m = +drone.collisionRadius.toFixed(3);
      const cameraStats = controls.camera.stats();
      report.camera.collision_checks = cameraStats.checks;
      report.camera.collision_hits = cameraStats.hits;
      report.camera.rig = controls.cameraController.snapshot().key;
      report.distance = Math.round(drone.distance);
      report.ghost = !!S.ghost;

      report.moved = drone.distance > 20;
      report.lifecycle.groups = scene.children.filter(node => node.name === 'fv-world').length;
      report.rendererMemory = {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      };
      report.render = {
        ...(report.render || {}),
        dpr: +dprNow.toFixed(2),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        pauses: renderLifecycle.pauses,
        resumes: renderLifecycle.resumes,
      };
      report.ok = report.moved
        && report.fps >= 50
        && report.collision.ready
        && report.lifecycle.groups === 1
        && report.lifecycle.disposedStaleLoads === 0
        && Number.isFinite(drone.pos.y);
      report.done = true;
    }, (ctx.auto.until + 1.5) * 1000);
  }
}

main().catch(e => {
  report.errors.push(String(e?.message || e));
  report.done = true;
  bootError(e);
});