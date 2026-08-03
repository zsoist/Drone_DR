import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEAPON_PROFILES,
  advanceLaunchSchedules,
  createLaunchSchedule,
  integrateProjectileState,
  isGuidanceTargetVisible,
  steerVector,
  weaponAssetTier,
} from '../web/flightverse/weapon-registry.js';
import {
  createWeaponModelLibrary,
} from '../web/flightverse/weapon-models.js';


test('registry exposes nine complete immutable profiles', () => {
  assert.deepEqual(
    Object.keys(WEAPON_PROFILES),
    ['mg', 's', 'm', 'l', 'ac', 'sw', 'vx', 'rg', 'tb'],
  );
  for (const profile of Object.values(WEAPON_PROFILES)) {
    for (const key of ['kind', 'label', 'max', 'regen', 'model', 'effect']) {
      assert.ok(key in profile, `${profile.label}.${key}`);
    }
    assert.equal(Object.isFrozen(profile), true);
  }
  assert.equal(Object.isFrozen(WEAPON_PROFILES), true);
});

test('SWARM-8 schedules eight bounded launches over fixed steps', () => {
  const schedules = [];
  assert.equal(createLaunchSchedule(schedules, 'sw', { id: 'origin' }, { id: 'aim' }), true);
  assert.equal(createLaunchSchedule(schedules, 'sw', {}, {}), false);
  const launched = [];
  for (let index = 0; index < 120; index += 1) {
    advanceLaunchSchedules(schedules, 1 / 120, event => launched.push(event));
  }
  assert.equal(launched.length, 8);
  assert.equal(schedules.length, 0);
  assert.ok(launched.every((event, index) => event.index === index));
});

test('VIPER-X steers toward visible target but cannot guide through occluder', () => {
  const steered = steerVector(
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: 0 },
    WEAPON_PROFILES.vx.turnRate,
    0.25,
  );
  assert.ok(steered.x > 0 && steered.z < 0);
  assert.equal(
    isGuidanceTargetVisible(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      () => null,
    ),
    true,
  );
  assert.equal(
    isGuidanceTargetVisible(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      () => ({ fraction: 0.4, source: 'world' }),
    ),
    false,
  );
  const selectedNode = { id: 'selected-target' };
  assert.equal(
    isGuidanceTargetVisible(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      () => ({ fraction: 0.8, source: 'item', node: selectedNode }),
      selectedNode,
    ),
    true,
  );
});

test('RAIL is continuous at 460 m/s and NOVA integrates heavy gravity', () => {
  assert.equal(WEAPON_PROFILES.rg.kind, 'rail');
  assert.equal(WEAPON_PROFILES.rg.speed, 460);
  assert.equal(WEAPON_PROFILES.rg.fireball, false);
  const bomb = {
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 0, y: 0, z: -12 },
  };
  integrateProjectileState(bomb, WEAPON_PROFILES.tb, 0.5);
  assert.equal(bomb.velocity.y, -9);
  assert.equal(bomb.position.y, 15.5);
  assert.equal(bomb.position.z, -6);
});

test('asset tier keeps mobile/auto on runtime and reserves ultra for desktop manual quality', () => {
  assert.equal(weaponAssetTier({ quality: 'auto', coarse: false }), 'runtime');
  assert.equal(weaponAssetTier({ quality: 'ultra', coarse: true }), 'runtime');
  assert.equal(weaponAssetTier({ quality: '4k', coarse: false }), 'ultra');
  assert.equal(weaponAssetTier({ quality: 'extra', coarse: false }), 'ultra');
});

test('model library loads only selected tier, clones named nodes, and disposes once', async () => {
  const disposed = { geometry: 0, material: 0, texture: 0 };
  const makeNode = name => ({
    name,
    children: [],
    parent: null,
    clone() {
      const clone = makeNode(name);
      clone.children = this.children.map(child => child.clone());
      return clone;
    },
    traverse(fn) {
      fn(this);
      for (const child of this.children) child.traverse(fn);
    },
    getObjectByName(search) {
      if (this.name === search) return this;
      for (const child of this.children) {
        const found = child.getObjectByName(search);
        if (found) return found;
      }
      return null;
    },
  });
  const loads = [];
  const loader = {
    async loadAsync(url) {
      loads.push(url);
      const scene = makeNode('root');
      const mount = makeNode('mount');
      mount.geometry = { dispose: () => { disposed.geometry += 1; } };
      mount.material = {
        map: { dispose: () => { disposed.texture += 1; } },
        dispose: () => { disposed.material += 1; },
      };
      scene.children.push(mount, makeNode('projectile'), makeNode('muzzle'), makeNode('collision_proxy'));
      return { scene };
    },
  };
  const mountPoint = {
    children: [],
    add(node) { node.parent = this; this.children.push(node); },
    remove(node) { this.children = this.children.filter(child => child !== node); },
  };
  const library = createWeaponModelLibrary({
    quality: 'auto',
    coarse: false,
    loader,
    root: '/assets/weapons',
  });
  await library.select('ac', [mountPoint]);
  assert.equal(loads[0], '/assets/weapons/runtime/ac30_cannon.glb');
  assert.equal(mountPoint.children.length, 1);
  assert.equal((await library.cloneProjectile('ac')).name, 'projectile');
  assert.deepEqual(library.snapshot().nodes.ac, {
    mount: true,
    projectile: true,
    muzzle: true,
    collision_proxy: true,
  });
  library.dispose();
  library.dispose();
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
});
