import * as THREE from '/flightverse/three.js?v=343';
import { createWorldCollision } from '/flightverse/world-collision.js?v=343';
import {
  composeCollisionWorld,
  createSceneObjectCollision,
} from '/flightverse/scene-object-collision.js?v=343';
import { createDrone, STEP } from '/flightverse/runtime.js?v=343';
import { createWeapons } from '/flightverse/weapons.js?v=343';
import { WEAPON_PROFILES } from '/flightverse/weapon-registry.js?v=343';
import { createWeaponModelLibrary } from '/flightverse/weapon-models.js?v=343';
import { radialDamage } from '/flightverse/weapon-effects.js?v=343';

const report = {
  done: false,
  ok: false,
  assertions: [],
  failures: [],
  queries: 0,
  query_ms: null,
};
window.__worldCollisionFixture = report;

function check(name, condition, detail = '') {
  report.assertions.push({ name, ok: Boolean(condition), detail });
  if (!condition) report.failures.push(`${name}: ${detail}`);
}

function approx(actual, expected, tolerance = 1e-3) {
  return Math.abs(actual - expected) <= tolerance;
}

function colliderUrls() {
  const positions = new Float32Array([
    4, -5, -5,
    4, 5, -5,
    4, 5, 5,
    4, -5, 5,
    -5, -5, 4,
    5, -5, 4,
    5, 5, 4,
    -5, 5, 4,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  const bytesPos = positions.byteLength;
  const binary = new Uint8Array(bytesPos + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), bytesPos);
  const meta = {
    version: 2,
    verts: 8,
    tris: 4,
    bytes_pos: bytesPos,
    bytes_idx: indices.byteLength,
  };
  return {
    meta: URL.createObjectURL(new Blob(
      [JSON.stringify(meta)],
      { type: 'application/json' },
    )),
    bin: URL.createObjectURL(new Blob(
      [binary],
      { type: 'application/octet-stream' },
    )),
  };
}

function memorySample(renderer) {
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}

function copyEffectCounters(weapons) {
  return Object.fromEntries(Object.entries(weapons.state.effectCounters).map(([kind, counters]) => [
    kind,
    { ...counters },
  ]));
}

// Exercise the actual renderer rather than inferring GPU cleanup from the pool
// counters. Decals/rubble are deliberately persistent game state, so their
// settled allocation becomes the comparison baseline for a subsequent burst.
function runRenderedEffectMemoryPressure(terrainWorld) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(32, 32, false);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;';
  document.body.append(renderer.domElement);

  // Keep every persistent fragment inside the warming render; otherwise Three
  // uploads an off-screen fragment only in a later burst and mimics a leak.
  const camera = new THREE.OrthographicCamera(-256, 256, 256, -256, 0.1, 500);
  camera.position.set(0, 200, 0);
  camera.lookAt(0, 0, 0);
  const fixtureAnchor = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x223344 }),
  );
  scene.add(fixtureAnchor);

  const render = () => {
    renderer.render(scene, camera);
    return memorySample(renderer);
  };
  const hitAt = index => ({
    kind: 'terrain',
    point: new THREE.Vector3((index % 7) - 3, 0, ((index * 3) % 7) - 3),
    normal: new THREE.Vector3(0, 1, 0),
  });
  const relevantPools = [
    'muzzle', 'tracer', 'fire', 'fragment', 'decal', 'rubble',
  ];
  let weapons = null;

  try {
    // Three lazily creates one shared Sprite geometry. Warm it before the
    // teardown baseline so this renderer-internal allocation is not mistaken
    // for an effect leak.
    const rendererWarmup = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x223344 }));
    scene.add(rendererWarmup);
    render();
    scene.remove(rendererWarmup);
    rendererWarmup.material.dispose();
    const baseline = render();
    weapons = createWeapons(scene, {
      world: terrainWorld,
      heightAt: () => 0,
      // This gate measures resources owned by createWeapons. Optional debris
      // GLBs are shared loader assets and intentionally outlive an instance.
      useDebrisModels: false,
    });
    const projectileOrigin = new THREE.Vector3(0, 20, 0);
    const projectileAim = { aimPoint: new THREE.Vector3(0, 20, -240) };
    const forceFire = (kind, count) => {
      let shots = 0;
      weapons.setWeapon(kind);
      for (let index = 0; index < count; index += 1) {
        // This is a pool-pressure fixture, so bypass gameplay cooldown/ammo
        // after each real fire() call without changing production behavior.
        weapons.state.cool = 0;
        weapons.state.ammo[kind] = Math.max(1, weapons.state.ammo[kind]);
        if (weapons.fire(projectileOrigin, projectileAim)) shots += 1;
      }
      return shots;
    };
    const burst = (count, start) => {
      for (let index = 0; index < count; index += 1) {
        weapons.explodeAt(hitAt(start + index), 2.8, WEAPON_PROFILES.tb);
        // Removing evicted entries on every tick keeps the burst bounded while
        // still forcing each pool's FIFO eviction path.
        weapons.update(STEP);
      }
    };
    const settle = () => {
      for (let index = 0; index < 1440; index += 1) weapons.update(STEP);
    };

    // Upload weapon-level shared geometries/materials before sampling the
    // persistent baseline. Later projectile pressure must return to this state.
    forceFire('mg', 1);
    forceFire('s', 1);
    render();
    settle();

    // The first two bursts fill persistent decal/rubble capacity and upload
    // the shared VFX textures. That fully warmed state is the allowed baseline
    // for the independently measured eviction burst below.
    burst(50, 0);
    settle();
    burst(50, 50);
    render();
    settle();
    const persistent = render();
    const persistentEffects = weapons.effects.snapshot();
    const persistentPools = copyEffectCounters(weapons);
    const beforeBurstDisposals = weapons.state.resources.disposed;

    // The measured burst exceeds every explosion and projectile effect pool.
    burst(50, 100);
    const projectileBurst = {
      mgShots: forceFire('mg', 80),
      missileShots: forceFire('s', 49),
    };
    const peak = render();
    const peakEffects = weapons.effects.snapshot();
    const peakPools = copyEffectCounters(weapons);
    const disposalsAtPeak = weapons.state.resources.disposed;
    settle();
    const settled = render();
    const settledEffects = weapons.effects.snapshot();
    const settledPools = copyEffectCounters(weapons);
    const poolEvictions = Object.fromEntries(relevantPools.map(kind => [
      kind,
      weapons.state.effectCounters[kind].evicted > 0,
    ]));

    const beforeTeardown = weapons.state.resources.disposed;
    weapons.dispose();
    const teardownEffects = weapons.effects.snapshot();
    const teardown = render();
    const afterTeardown = weapons.state.resources.disposed;

    return {
      baseline,
      persistent,
      peak,
      settled,
      teardown,
      persistentEffects,
      peakEffects,
      settledEffects,
      teardownEffects,
      relevantPools,
      poolEvictions,
      projectileBurst,
      persistentPools,
      peakPools,
      settledPools,
      disposedOnEviction: disposalsAtPeak - beforeBurstDisposals,
      disposedOnTeardown: afterTeardown - beforeTeardown,
    };
  } finally {
    weapons?.dispose();
    scene.remove(fixtureAnchor);
    fixtureAnchor.geometry.dispose();
    fixtureAnchor.material.dispose();
    renderer.render(scene, camera);
    renderer.dispose();
    renderer.domElement.remove();
  }
}

async function run() {
  const { resolveCameraCollision } = await import('/flightverse/runtime.js?v=343');
  const urls = colliderUrls();
  const man = {
    capabilities: { mesh: true, terrain: true, collision: true },
    assets: {
      collision_meta: urls.meta,
      collision_bin: urls.bin,
    },
  };
  const world = await createWorldCollision(man, {
    heightAt: () => 0,
    boundary: { shape: 'circle', radius: 100 },
  });

  const thin = world.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, 2, 0),
  );
  check(
    'fast segment crosses thin wall',
    thin?.kind === 'structure' && approx(thin.fraction, 0.4),
    JSON.stringify({ kind: thin?.kind, fraction: thin?.fraction }),
  );

  const ordered = world.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, -2, 0),
  );
  check(
    'structure wins before later terrain',
    ordered?.kind === 'structure' && approx(ordered.fraction, 0.4),
    JSON.stringify({ kind: ordered?.kind, fraction: ordered?.fraction }),
  );

  const sphere = world.sweepSphere(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, 2, 0),
    1,
  );
  check(
    'sphere sweep contacts before center crosses wall',
    sphere?.kind === 'structure' && approx(sphere.fraction, 0.3, 0.002),
    JSON.stringify({ kind: sphere?.kind, fraction: sphere?.fraction }),
  );

  const nearest = world.closest(new THREE.Vector3(2, 2, 0), 3);
  check(
    'closest returns structural distance',
    nearest?.kind === 'structure' && approx(nearest.distance, 2),
    JSON.stringify({ kind: nearest?.kind, distance: nearest?.distance }),
  );

  const cameraPosition = new THREE.Vector3(6, 2, 0);
  const cameraHit = resolveCameraCollision?.(
    world,
    new THREE.Vector3(0, 2, 0),
    cameraPosition,
  );
  check(
    'camera boom stays on the drone side of real structure',
    cameraHit?.kind === 'structure'
      && cameraPosition.x >= 3.80
      && cameraPosition.x <= 3.82,
    JSON.stringify({
      kind: cameraHit?.kind,
      position: cameraPosition.toArray(),
    }),
  );

  const clearCameraPosition = new THREE.Vector3(0, 3, -6);
  const clearCameraBefore = clearCameraPosition.clone();
  const clearCameraHit = resolveCameraCollision?.(
    world,
    new THREE.Vector3(0, 2, 0),
    clearCameraPosition,
  );
  check(
    'clear camera boom remains unchanged',
    clearCameraHit == null && clearCameraPosition.equals(clearCameraBefore),
    JSON.stringify({
      hit: clearCameraHit?.kind,
      position: clearCameraPosition.toArray(),
    }),
  );

  const itemNode = new THREE.Mesh(
    new THREE.BoxGeometry(1, 10, 2),
    new THREE.MeshBasicMaterial({ color: 0x6d7b89 }),
  );
  itemNode.position.set(2, 0, 0);
  itemNode.updateWorldMatrix(true, true);
  const itemBounds = new THREE.Box3().setFromObject(itemNode);
  const itemSphere = new THREE.Sphere();
  itemBounds.getBoundingSphere(itemSphere);
  const itemCollision = createSceneObjectCollision([{
    node: itemNode,
    bounds: itemBounds,
    broadSphere: itemSphere,
    materialClass: 'metal',
  }]);
  const compositeWorld = composeCollisionWorld(world, itemCollision);
  const itemHit = compositeWorld.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, 2, 0),
  );
  check(
    'real scene item wins before the static world wall',
    itemHit?.source === 'item'
      && itemHit?.node === itemNode
      && approx(itemHit.fraction, 0.15),
    JSON.stringify({
      source: itemHit?.source,
      fraction: itemHit?.fraction,
      materialClass: itemHit?.materialClass,
    }),
  );

  const itemCameraPosition = new THREE.Vector3(6, 2, 0);
  const itemCameraHit = resolveCameraCollision?.(
    compositeWorld,
    new THREE.Vector3(0, 2, 0),
    itemCameraPosition,
  );
  check(
    'camera boom cannot enter a real scene item',
    itemCameraHit?.source === 'item'
      && itemCameraPosition.x >= 1.31
      && itemCameraPosition.x <= 1.33,
    JSON.stringify({
      source: itemCameraHit?.source,
      position: itemCameraPosition.toArray(),
    }),
  );

  const itemBlockedDrone = createDrone({
    world: compositeWorld,
    spawn: { position_m: [0, 2, 0] },
  });
  itemBlockedDrone.vel.set(80, 0, 0);
  for (let index = 0; index < 30; index += 1) {
    itemBlockedDrone.step(STEP, {
      fwd: 0, strafe: 0, yaw: 0, lift: 0,
      boost: false, brake: false, mouseDX: 0, mouseDY: 0,
    }, 'asistido');
  }
  check(
    'drone envelope stops before a real scene item',
    itemBlockedDrone.pos.x >= 0.88
      && itemBlockedDrone.pos.x <= 0.92
      && itemBlockedDrone.collisionHits > 0,
    JSON.stringify({
      position: itemBlockedDrone.pos.toArray(),
      collisionHits: itemBlockedDrone.collisionHits,
    }),
  );

  const terrainWorld = await createWorldCollision({
    capabilities: { mesh: false, terrain: true, collision: true },
    assets: {},
  }, {
    heightAt: (x) => (x >= 1.8 && x <= 2.2 ? 3 : 0),
    boundary: { shape: 'circle', radius: 100 },
  });
  const hill = terrainWorld.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(4, 2, 0),
  );
  check(
    'terrain crossing is detected between clear endpoints',
    hill?.kind === 'terrain' && hill.fraction > 0.4 && hill.fraction < 0.5,
    JSON.stringify({ kind: hill?.kind, fraction: hill?.fraction }),
  );

  const boundaryWorld = await createWorldCollision({
    capabilities: { mesh: false, terrain: false, collision: true },
    assets: {},
  }, {
    boundary: { shape: 'circle', radius: 5 },
  });
  const edge = boundaryWorld.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, 2, 0),
  );
  check(
    'native circular boundary is continuous',
    edge?.kind === 'boundary' && approx(edge.fraction, 0.5),
    JSON.stringify({ kind: edge?.kind, fraction: edge?.fraction }),
  );

  const blastTargets = {
    visible: { center: new THREE.Vector3(2, 0, 0), node: new THREE.Group() },
    occluded: { center: new THREE.Vector3(4, 0, 0), node: new THREE.Group() },
  };
  const blast = radialDamage({
    origin: new THREE.Vector3(0, 0, 0),
    radius: 8,
    maxDamage: 100,
    targets: blastTargets,
    castSegment: (_origin, target) => target.x > 3
      ? { kind: 'structure', fraction: 0.5, node: new THREE.Group() }
      : null,
  });
  check(
    'radial falloff damages visible target and rejects target behind structure',
    blast.visible.damage > 0
      && blast.visible.damage < 100
      && blast.occluded.damage === 0
      && blast.occluded.occluded === true,
    JSON.stringify({
      visible: blast.visible.damage,
      occluded: blast.occluded.damage,
    }),
  );

  const badMeta = URL.createObjectURL(new Blob([
    JSON.stringify({
      version: 2,
      verts: 3,
      tris: 1,
      bytes_pos: 36,
      bytes_idx: 12,
    }),
  ], { type: 'application/json' }));
  const badBin = URL.createObjectURL(new Blob([
    new Uint8Array(4),
  ], { type: 'application/octet-stream' }));
  let malformedRejected = false;
  try {
    await createWorldCollision({
      capabilities: { mesh: true, collision: true },
      assets: { collision_meta: badMeta, collision_bin: badBin },
    });
  } catch (error) {
    malformedRejected = /inconsistente/.test(error.message);
  }
  check('malformed collider bytes fail closed', malformedRejected);

  const neutralInput = {
    fwd: 0,
    strafe: 0,
    yaw: 0,
    lift: 0,
    boost: false,
    brake: false,
    mouseDX: 0,
    mouseDY: 0,
  };
  const landing = createDrone({
    world: terrainWorld,
    spawn: { position_m: [0, 1.21, 0] },
  });
  landing.vel.set(0, -20, 0);
  landing.step(STEP, neutralInput, 'asistido');
  check(
    'terrain keeps independent 1.20m AGL without rollback failure',
    landing.agl >= 1.20
      && landing.agl <= 1.22
      && landing.collisionFailures === 0,
    JSON.stringify({
      agl: landing.agl,
      collisionFailures: landing.collisionFailures,
      position: landing.pos.toArray(),
    }),
  );

  const boosted = createDrone({
    world,
    heightAt: () => 0,
    spawn: { position_m: [0, 2, -2] },
  });
  boosted.vel.set(80, 0, 18);
  for (let index = 0; index < 30; index += 1) {
    boosted.step(STEP, neutralInput, 'asistido');
  }
  check(
    'drone structural envelope matches the visible 0.85m aircraft',
    boosted.collisionRadius >= 0.57
      && boosted.collisionRadius <= 0.60
      && boosted.pos.x >= 3.38
      && boosted.pos.x <= 3.43
      && boosted.pos.z > -1.5,
    JSON.stringify({
      radius: boosted.collisionRadius,
      position: boosted.pos.toArray(),
      collisionHits: boosted.collisionHits,
    }),
  );

  const corner = createDrone({
    world,
    heightAt: () => 0,
    spawn: { position_m: [0, 2, 0] },
  });
  corner.vel.set(70, 0, 70);
  for (let index = 0; index < 40; index += 1) {
    corner.step(STEP, neutralInput, 'asistido');
  }
  check(
    'drone resolves two-contact corner without escaping',
    corner.pos.x <= 3.43 && corner.pos.z <= 3.43,
    JSON.stringify({ position: corner.pos.toArray() }),
  );

  const penetrating = createDrone({
    world,
    heightAt: () => 0,
    spawn: { position_m: [4, 2, 0] },
  });
  penetrating.step(STEP, neutralInput, 'asistido');
  check(
    'spawn penetration uses the active drone envelope',
    approx(
      Math.abs(penetrating.pos.x - 4),
      penetrating.collisionRadius + 0.003,
      0.01,
    ),
    JSON.stringify({
      radius: penetrating.collisionRadius,
      position: penetrating.pos.toArray(),
    }),
  );

  const { resolveAimRay } = await import('/flightverse/aiming.js?v=343');
  const reticleAim = resolveAimRay(
    { position: new THREE.Vector3(0, 2, 0), direction: new THREE.Vector3(1, 0, 0), far: 100 },
    world,
    [{ enemy: true, center: new THREE.Vector3(2.4, 2, 0), radius: 0.4 }],
  );
  check(
    'camera reticle selects the nearest dynamic target before the BVH wall',
    reticleAim.kind === 'target' && approx(reticleAim.point.x, 2),
    JSON.stringify(reticleAim),
  );

  const makeWeapons = (weaponWorld, heightAt = () => 0, options = {}) => createWeapons(
    new THREE.Scene(),
    { world: weaponWorld, heightAt, ...options },
  );
  const runWeapon = (weapons, steps, hittables = []) => {
    for (let index = 0; index < steps; index += 1) {
      weapons.update(STEP, hittables);
    }
  };
  const mg = makeWeapons(world);
  mg.setWeapon('mg');
  mg.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(mg, 8);
  check(
    'MG swept segment impacts thin structure',
    mg.state.structureHits === 1 && mg.state.bullets.length === 0,
    JSON.stringify({
      structureHits: mg.state.structureHits,
      bullets: mg.state.bullets.length,
    }),
  );
  mg.dispose();

  const destructibleItem = {
    node: itemNode,
    center: new THREE.Vector3(2, 2, 0),
    radius: 0.4,
    radiusSq: 0.16,
    hp: 1,
    blood: false,
    materialClass: 'metal',
  };
  const itemWeapons = makeWeapons(compositeWorld, () => 0, {
    onDestroy: node => itemCollision.remove(node),
  });
  itemWeapons.setWeapon('mg');
  itemWeapons.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(itemWeapons, 8, [destructibleItem]);
  const revealedStaticWall = compositeWorld.castSegment(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(10, 2, 0),
  );
  check(
    'weapon destroys item collider synchronously and reveals static wall',
    itemWeapons.state.itemHits === 1
      && itemWeapons.state.targetHits === 1
      && itemWeapons.state.destroyed === 1
      && revealedStaticWall?.source === 'world'
      && revealedStaticWall?.kind === 'structure'
      && approx(revealedStaticWall.fraction, 0.4),
    JSON.stringify({
      itemHits: itemWeapons.state.itemHits,
      targetHits: itemWeapons.state.targetHits,
      destroyed: itemWeapons.state.destroyed,
      nextSource: revealedStaticWall?.source,
      nextFraction: revealedStaticWall?.fraction,
    }),
  );
  itemWeapons.dispose();

  for (const type of ['s', 'm', 'l']) {
    const missiles = makeWeapons(world);
    missiles.setWeapon(type);
    missiles.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
    runWeapon(missiles, 240);
    check(
      `missile ${type} impacts structure continuously`,
      missiles.state.structureHits === 1 && missiles.state.exploded === 1,
      JSON.stringify({
        structureHits: missiles.state.structureHits,
        exploded: missiles.state.exploded,
      }),
    );
    missiles.dispose();
  }

  const ac30 = makeWeapons(world);
  ac30.setWeapon('ac');
  ac30.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(ac30, 8);
  check(
    'AC-30 continuous shell uses swept composite collision',
    ac30.state.structureHits === 1
      && ac30.state.firedProjectiles.ac === 1
      && ac30.state.bullets.length === 0,
    JSON.stringify({
      structureHits: ac30.state.structureHits,
      firedProjectiles: ac30.state.firedProjectiles.ac,
      bullets: ac30.state.bullets.length,
    }),
  );
  ac30.dispose();

  const swarm = makeWeapons(world);
  swarm.setWeapon('sw');
  swarm.fire(
    new THREE.Vector3(0, 2, 0),
    { aimPoint: new THREE.Vector3(8, 2, 0) },
  );
  runWeapon(swarm, 240);
  check(
    'SWARM-8 emits exactly eight bounded micro-rockets and clears schedule',
    swarm.state.firedProjectiles.sw === 8
      && swarm.state.schedules.length === 0
      && swarm.state.structureHits === 8
      && swarm.state.exploded === 8,
    JSON.stringify({
      firedProjectiles: swarm.state.firedProjectiles.sw,
      schedules: swarm.state.schedules.length,
      structureHits: swarm.state.structureHits,
      exploded: swarm.state.exploded,
    }),
  );
  swarm.dispose();

  const guided = makeWeapons(boundaryWorld);
  const guidedGroup = new THREE.Group();
  const guidedTarget = {
    enemy: true,
    g: guidedGroup,
    center: new THREE.Vector3(5, 4, 0),
    radius: 0.45,
    radiusSq: 0.45 ** 2,
    hp: 2000,
    blood: false,
  };
  guided.setWeapon('vx');
  guided.fire(new THREE.Vector3(0, 2, 0), {
    aimPoint: new THREE.Vector3(8, 2, 0),
    target: guidedTarget,
  });
  runWeapon(guided, 180, [guidedTarget]);
  check(
    'VIPER-X turns to a visible target and triggers only after clear guidance',
    guided.state.firedProjectiles.vx === 1
      && guided.state.targetHits === 1
      && guided.state.proximityTriggers === 1,
    JSON.stringify({
      firedProjectiles: guided.state.firedProjectiles.vx,
      targetHits: guided.state.targetHits,
      proximityTriggers: guided.state.proximityTriggers,
    }),
  );
  guided.dispose();

  const rail = makeWeapons(world);
  rail.setWeapon('rg');
  rail.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  check(
    'RAIL resolves a 460m/s continuous wall hit without fireball projectile',
    WEAPON_PROFILES.rg.speed === 460
      && rail.state.railHits === 1
      && rail.state.structureHits === 1
      && rail.state.exploded === 0
      && rail.state.missiles.length === 0,
    JSON.stringify({
      railHits: rail.state.railHits,
      structureHits: rail.state.structureHits,
      terrainHits: rail.state.terrainHits,
      boundaryHits: rail.state.boundaryHits,
      impact: rail.state.impactEvidence,
      exploded: rail.state.exploded,
    }),
  );
  rail.dispose();

  const nova = makeWeapons(terrainWorld, () => 0);
  nova.setWeapon('tb');
  nova.fire(new THREE.Vector3(0, 12, 0), {
    aimPoint: new THREE.Vector3(0, 0, -2),
  });
  runWeapon(nova, 240);
  check(
    'NOVA follows gravity and explodes on first terrain contact',
    nova.state.firedProjectiles.tb === 1
      && nova.state.terrainHits === 1
      && nova.state.exploded === 1
      && nova.state.missiles.length === 0,
    JSON.stringify({
      firedProjectiles: nova.state.firedProjectiles.tb,
      terrainHits: nova.state.terrainHits,
      exploded: nova.state.exploded,
    }),
  );
  nova.dispose();

  const { GLTFLoader } = await import(
    '/vendor/three-addons180/loaders/GLTFLoader.js?v=343'
  );
  const modelLibrary = createWeaponModelLibrary({
    quality: 'auto',
    coarse: true,
    loader: new GLTFLoader(),
    root: '/assets/weapons',
  });
  await Promise.all(['ac', 'sw', 'vx', 'rg', 'tb'].map(key => modelLibrary.preload(key)));
  const modelSnapshot = modelLibrary.snapshot();
  check(
    'all five runtime weapon GLBs load with named model contract',
    modelSnapshot.tier === 'runtime'
      && modelSnapshot.ready.length === 5
      && modelSnapshot.ready.every(key => ['ac', 'sw', 'vx', 'rg', 'tb'].includes(key)),
    JSON.stringify(modelSnapshot),
  );
  modelLibrary.dispose();

  const convergedWeapons = makeWeapons(world);
  convergedWeapons.setWeapon('m');
  convergedWeapons.fire(
    new THREE.Vector3(0, 2, 0),
    { aimPoint: new THREE.Vector3(6, 4, 0) },
  );
  const convergence = convergedWeapons.state.missiles[0]?.dir;
  check(
    'missile leaves its hardpoint converged on the camera reticle point',
    convergence && approx(convergence.x, 3 / Math.sqrt(10), 0.002)
      && approx(convergence.y, 1 / Math.sqrt(10), 0.002),
    JSON.stringify(convergence),
  );
  runWeapon(convergedWeapons, 240);
  const poolsBounded = Object.values(convergedWeapons.state.effectCounters)
    .every(pool => pool.active <= pool.limit);
  const normalImpact = convergedWeapons.state.impactEvidence;
  check(
    'structural impact evidence keeps BVH point and wall normal for effects',
    normalImpact?.kind === 'structure'
      && normalImpact.normal.x < -0.99
      && normalImpact.point.x > 3.7
      && normalImpact.point.x < 4.1
      && poolsBounded,
    JSON.stringify({ normalImpact, pools: convergedWeapons.state.effectCounters }),
  );
  check(
    'expired weapon effects release owned GPU resources while pool limits remain bounded',
    convergedWeapons.state.resources?.disposed > 0 && poolsBounded,
    JSON.stringify({ resources: convergedWeapons.state.resources, pools: convergedWeapons.state.effectCounters }),
  );
  report.effectMemory = runRenderedEffectMemoryPressure(terrainWorld);
  check(
    'rendered eviction burst returns VFX GPU memory to its persistent baseline and teardown baseline',
    Object.values(report.effectMemory?.poolEvictions || {}).every(Boolean)
      && report.effectMemory?.peakEffects?.budget?.active === 1400
      && report.effectMemory?.peakEffects?.drawBatches === 5
      && report.effectMemory?.peakEffects?.softAlpha === true
      && report.effectMemory?.peakEffects?.emitted >= 150 * 240
      && report.effectMemory?.peakEffects?.active <= 1400
      && report.effectMemory?.peakEffects?.peak <= 1400
      && report.effectMemory?.settledEffects?.active === 0
      && report.effectMemory?.teardownEffects?.disposed === true
      && report.effectMemory?.teardownEffects?.disposeCalls === 1
      && report.effectMemory?.projectileBurst?.mgShots >= 80
      && report.effectMemory?.projectileBurst?.missileShots >= 49
      && report.effectMemory?.disposedOnEviction > 0
      && report.effectMemory?.disposedOnTeardown > 0
      && report.effectMemory?.peak?.geometries > report.effectMemory?.persistent?.geometries
      && report.effectMemory?.peak?.textures >= report.effectMemory?.persistent?.textures
      && report.effectMemory?.settled?.geometries <= report.effectMemory?.persistent?.geometries
      && report.effectMemory?.settled?.textures <= report.effectMemory?.persistent?.textures
      && report.effectMemory?.teardown?.geometries <= report.effectMemory?.baseline?.geometries
      && report.effectMemory?.teardown?.textures <= report.effectMemory?.baseline?.textures,
    JSON.stringify(report.effectMemory),
  );
  convergedWeapons.dispose();

  const groundWeapons = makeWeapons(terrainWorld, () => 0);
  groundWeapons.setWeapon('mg');
  groundWeapons.fire(new THREE.Vector3(0, 0.7, 0), 0, -Math.PI / 2);
  runWeapon(groundWeapons, 2);
  check(
    'projectile detects ground crossing between endpoints',
    groundWeapons.state.terrainHits === 1,
    JSON.stringify({ terrainHits: groundWeapons.state.terrainHits }),
  );
  groundWeapons.dispose();

  const airburstCraters = [];
  const airburstWeapons = createWeapons(new THREE.Scene(), {
    world: boundaryWorld,
    heightAt: () => 0,
    crater: (...args) => airburstCraters.push(args),
  });
  airburstWeapons.explodeAt(new THREE.Vector3(1, 20, 1), 1);
  check(
    'raw airburst never deforms terrain without a terrain collision normal',
    airburstCraters.length === 0 && airburstWeapons.state.impactEvidence?.kind === 'air',
    JSON.stringify({ craters: airburstCraters.length, impact: airburstWeapons.state.impactEvidence }),
  );
  airburstWeapons.dispose();

  const visibleWeapons = makeWeapons(boundaryWorld);
  visibleWeapons.setWeapon('s');
  const visibleGroup = new THREE.Group();
  const visibleTarget = {
    enemy: true,
    g: visibleGroup,
    center: new THREE.Vector3(3.5, 2, 0),
    radius: 0.45,
    radiusSq: 0.45 ** 2,
    hp: 1000,
    blood: false,
  };
  visibleWeapons.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(visibleWeapons, 120, [visibleTarget]);
  check(
    'visible target triggers missile proximity fuse',
    visibleWeapons.state.proximityTriggers === 1,
    JSON.stringify({
      proximityTriggers: visibleWeapons.state.proximityTriggers,
      targetHits: visibleWeapons.state.targetHits,
    }),
  );
  visibleWeapons.dispose();

  const occludedWeapons = makeWeapons(world);
  occludedWeapons.setWeapon('s');
  const occludedGroup = new THREE.Group();
  const occludedTarget = {
    enemy: true,
    g: occludedGroup,
    center: new THREE.Vector3(5, 2, 0),
    radius: 0.5,
    radiusSq: 0.25,
    hp: 1000,
    blood: false,
  };
  occludedWeapons.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(occludedWeapons, 160, [occludedTarget]);
  check(
    'occluded target cannot trigger proximity through structure',
    occludedWeapons.state.proximityTriggers === 0
      && occludedWeapons.state.occludedFuses > 0
      && occludedWeapons.state.structureHits === 1,
    JSON.stringify({
      proximityTriggers: occludedWeapons.state.proximityTriggers,
      occludedFuses: occludedWeapons.state.occludedFuses,
      structureHits: occludedWeapons.state.structureHits,
    }),
  );
  occludedWeapons.dispose();

  const edgeWeapons = makeWeapons(boundaryWorld, () => null);
  edgeWeapons.setWeapon('mg');
  edgeWeapons.fire(new THREE.Vector3(0, 2, 0), -Math.PI / 2, 0);
  runWeapon(edgeWeapons, 8);
  check(
    'projectile detonates at playable boundary',
    edgeWeapons.state.boundaryHits === 1,
    JSON.stringify({ boundaryHits: edgeWeapons.state.boundaryHits }),
  );
  edgeWeapons.dispose();

  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    world.castSegment(
      new THREE.Vector3(0, 2 + (index % 3), 0),
      new THREE.Vector3(10, 2 + (index % 3), 0),
    );
  }
  report.queries = 10_000;
  report.query_ms = Math.round((performance.now() - started) * 10) / 10;

  world.dispose();
  world.dispose();
  compositeWorld.dispose();
  terrainWorld.dispose();
  boundaryWorld.dispose();
  itemNode.geometry.dispose();
  itemNode.material.dispose();
  check('dispose is idempotent', world.qa.disposed === true);

  for (const url of [urls.meta, urls.bin, badMeta, badBin]) {
    URL.revokeObjectURL(url);
  }
  report.ok = report.failures.length === 0;
}

run().catch((error) => {
  report.failures.push(error?.stack || error?.message || String(error));
}).finally(() => {
  report.ok = report.failures.length === 0;
  report.done = true;
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
});
