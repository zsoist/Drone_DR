import {
  WEAPON_PROFILES,
  weaponAssetTier,
} from './weapon-registry.js?v=332';

const textureSlots = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
  'emissiveMap', 'alphaMap',
];

export function createWeaponModelLibrary({
  quality = 'auto',
  coarse = false,
  loader,
  root = '/assets/weapons',
} = {}) {
  if (!loader?.loadAsync) throw new Error('weapon model loader missing');
  const tier = weaponAssetTier({ quality, coarse });
  const cache = new Map();
  const active = [];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let disposed = false;
  let selection = 0;

  const clearActive = () => {
    for (const { parent, node } of active.splice(0)) parent?.remove?.(node);
  };
  const template = async key => {
    if (disposed) throw new Error('weapon model library disposed');
    const model = WEAPON_PROFILES[key]?.model;
    if (!model) return null;
    if (!cache.has(key)) {
      const record = { scene: null, promise: null };
      record.promise = loader.loadAsync(`${root}/${tier}/${model}.glb`).then(gltf => {
        const scene = gltf?.scene;
        if (!scene?.getObjectByName) throw new Error(`weapon ${key} scene missing`);
        for (const required of ['mount', 'projectile', 'muzzle', 'collision_proxy']) {
          if (!scene.getObjectByName(required)) {
            throw new Error(`weapon ${key} missing node ${required}`);
          }
        }
        record.scene = scene;
        return scene;
      });
      cache.set(key, record);
    }
    return cache.get(key).promise;
  };
  const disposeScene = scene => {
    scene?.traverse?.(node => {
      if (node.geometry && !geometries.has(node.geometry)) {
        geometries.add(node.geometry);
        node.geometry.dispose?.();
      }
      const values = Array.isArray(node.material)
        ? node.material
        : node.material ? [node.material] : [];
      for (const material of values) {
        if (materials.has(material)) continue;
        materials.add(material);
        for (const slot of textureSlots) {
          const texture = material[slot];
          if (texture && !textures.has(texture)) {
            textures.add(texture);
            texture.dispose?.();
          }
        }
        material.dispose?.();
      }
    });
  };

  const library = {
    async preload(key) {
      return template(key);
    },
    async select(key, mounts = []) {
      const generation = ++selection;
      const scene = await template(key);
      if (disposed || generation !== selection) return null;
      clearActive();
      if (!scene) return null;
      const source = scene.getObjectByName('mount');
      const parent = mounts.find(Boolean);
      if (!source || !parent?.add) return null;
      const clone = source.clone(true);
      clone.scale?.setScalar?.(0.22);
      parent.add(clone);
      active.push({ parent, node: clone });
      return clone;
    },
    async cloneProjectile(key) {
      const scene = await template(key);
      return scene?.getObjectByName('projectile')?.clone(true) || null;
    },
    snapshot() {
      const requiredNodes = ['mount', 'projectile', 'muzzle', 'collision_proxy'];
      return {
        tier,
        selected: active.length,
        cached: [...cache.keys()],
        ready: [...cache.entries()]
          .filter(([, record]) => record.scene)
          .map(([key]) => key),
        nodes: Object.fromEntries(
          [...cache.entries()]
            .filter(([, record]) => record.scene)
            .map(([key, record]) => [
              key,
              Object.fromEntries(requiredNodes.map(name => [
                name,
                Boolean(record.scene.getObjectByName(name)),
              ])),
            ]),
        ),
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      selection += 1;
      clearActive();
      for (const record of cache.values()) {
        if (record.scene) disposeScene(record.scene);
        else record.promise.then(disposeScene, () => {});
      }
      cache.clear();
    },
  };
  return library;
}
