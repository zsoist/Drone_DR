import * as THREE from '/flightverse/three.js?v=296';
import { createWorldCollision } from '/flightverse/world-collision.js?v=296';
import { createDrone, STEP } from '/flightverse/runtime.js?v=296';
import { createWeapons } from '/flightverse/weapons.js?v=296';

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

async function run() {
  const { resolveCameraCollision } = await import('/flightverse/runtime.js?v=296');
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

  const makeWeapons = (weaponWorld, heightAt = () => 0) => createWeapons(
    new THREE.Scene(),
    { world: weaponWorld, heightAt },
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
  terrainWorld.dispose();
  boundaryWorld.dispose();
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
