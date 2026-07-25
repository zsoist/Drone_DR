import * as THREE from '/flightverse/three.js?v=282';
import { createWorldCollision } from '/flightverse/world-collision.js?v=282';

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
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const bytesPos = positions.byteLength;
  const binary = new Uint8Array(bytesPos + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), bytesPos);
  const meta = {
    version: 2,
    verts: 4,
    tris: 2,
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
