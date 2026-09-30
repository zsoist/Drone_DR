// Behavioural regressions from the 2026-09-30 World hunt: they RUN the real runtime + collision modules
// (root-absolute browser imports are remapped to web/ by an in-file loader hook).
import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const WEB = new URL('../web', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('/flightverse/') || spec.startsWith('/vendor/')) {
    return { url: ${JSON.stringify(WEB)} + spec.split('?')[0], shortCircuit: true };
  }
  return next(spec, ctx);
}`));

const THREE = await import('/flightverse/three.js?v=1');
const { createWorldCollision } = await import('/flightverse/world-collision.js?v=1');
const { createDrone, STEP } = await import('/flightverse/runtime.js?v=1');
const { createMutableCollisionWorld } = await import('/flightverse/scene-object-collision.js?v=1');

const IDLE = { fwd: 0, strafe: 0, yaw: 0, lift: 0, boost: false, brake: false, mouseDX: 0, mouseDY: 0 };
const inp = o => ({ ...IDLE, ...o });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const world = opts => createWorldCollision({}, opts);

test('Dios (noclip) stays inside the playable boundary and the camera boom does not collapse', async () => {
  const w = createMutableCollisionWorld(await world({ heightAt: () => 0, boundary: { shape: 'circle', radius: 65 } }));
  const d = createDrone({ world: w, spawn: { position_m: [0, 30, 0] } });
  d.yaw = -Math.PI / 2;
  for (let i = 0; i < 120 * 6; i++) d.step(STEP, inp({ fwd: 1, boost: true }), 'dios');
  assert.ok(Math.hypot(d.pos.x, d.pos.z) <= 65 + 1e-6, `left the boundary: ${d.pos.toArray()}`);
  // camera boom behind the drone must keep its length (previously collapsed to ~0.05 m)
  const inward = V(-d.pos.x, 0, -d.pos.z).normalize();
  const cam = d.pos.clone().addScaledVector(inward, 4.6).add(V(0, 1.9, 0));
  const before = cam.distanceTo(d.pos);
  const hit = w.castSegment(d.pos, cam, 0);
  assert.equal(hit, null, `boom blocked by a phantom hit: ${hit && hit.kind}`);
  assert.ok(before > 4);
  // and Dios still flies through terrain (noclip semantics preserved)
  const low = createDrone({ world: w, spawn: { position_m: [0, 30, 0] } });
  for (let i = 0; i < 120; i++) low.step(STEP, inp({ lift: -1, boost: true }), 'dios');
  assert.ok(low.pos.y < 0, 'noclip must still pass through the ground');
});

test('Number(null) no longer lifts a drone that is off the DSM grid', async () => {
  const w = await world({ heightAt: (x) => (x < 100 ? 40 : null), boundary: { shape: 'circle', radius: 1000 } });
  assert.equal(w.recoverSphere(V(150, -30, 0), { structure: 0.59, terrain: 1.2, boundary: 0.59 }), null);
  const on = w.recoverSphere(V(50, 30, 0), { structure: 0.59, terrain: 1.2, boundary: 0.59 });
  assert.ok(on && on.translation.y > 9, 'on-grid terrain recovery still works');
});

test('long terrain rays (reticle / RAIL) do not skip narrow ridges', async () => {
  // 1 m wide, 30 m tall wall at x = 600.3..601.3 across a 1200 m ray
  const heightAt = (x) => (x > 600.3 && x < 601.3 ? 30 : 0);
  const w = await world({ heightAt, boundary: { shape: 'circle', radius: 5000 } });
  let hits = 0;
  for (let i = 0; i < 60; i += 1) {
    const off = i * 0.037;
    if (w.castSegment(V(-20 + off, 10, 0), V(1180 + off, 10, 0), 0)) hits += 1;
  }
  assert.equal(hits, 60, `missed the ridge in ${60 - hits}/60 casts`);
});
