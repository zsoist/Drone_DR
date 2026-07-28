// Fixed-capacity Flightverse weapon effects. Five render batches replace the
// former object-per-particle explosions while preserving deterministic budgets.

const BUDGETS = Object.freeze({
  phone: Object.freeze({ active: 520, heavy: 96 }),
  tablet: Object.freeze({ active: 850, heavy: 150 }),
  desktop: Object.freeze({ active: 1400, heavy: 240 }),
});

const CHANNELS = Object.freeze(['smoke', 'fire', 'spark', 'streak', 'debris']);
const CHANNEL_WEIGHTS = Object.freeze({
  smoke: 0.30,
  fire: 0.20,
  spark: 0.20,
  streak: 0.14,
  debris: 0.16,
});
const EMISSION_PATTERN = Object.freeze(CHANNELS.flatMap(kind => (
  Array.from({ length: Math.round(CHANNEL_WEIGHTS[kind] * 100) }, () => kind)
)));

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);
const point = value => ({
  x: finite(value?.x),
  y: finite(value?.y),
  z: finite(value?.z),
});
const length = value => Math.hypot(value.x, value.y, value.z);
const normalized = (value, fallback = { x: 0, y: 1, z: 0 }) => {
  const vector = point(value);
  const magnitude = length(vector);
  if (magnitude <= 1e-9) return { ...fallback };
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
};

export function effectBudget(tier = 'desktop') {
  const budget = BUDGETS[tier] || BUDGETS.desktop;
  return { ...budget };
}

export function cappedShockwaveDiameter(requested, viewportDiameter) {
  const viewport = Math.max(0, finite(viewportDiameter));
  return Math.min(Math.max(0, finite(requested)), viewport * 0.35);
}

export function radialDamage({
  origin,
  radius,
  maxDamage,
  targets,
  castSegment,
  applyDamage,
} = {}) {
  const center = point(origin);
  const blastRadius = Math.max(0, finite(radius));
  const peakDamage = Math.max(0, finite(maxDamage));
  const entries = Array.isArray(targets)
    ? targets.map((target, index) => [target?.id || String(index), target])
    : Object.entries(targets || {});
  const result = {};
  for (const [key, target] of entries) {
    const targetCenter = point(target?.center || target?.position);
    const dx = targetCenter.x - center.x;
    const dy = targetCenter.y - center.y;
    const dz = targetCenter.z - center.z;
    const distance = Math.hypot(dx, dy, dz);
    const outside = blastRadius <= 0 || distance >= blastRadius;
    let occluded = false;
    if (!outside && typeof castSegment === 'function') {
      const hit = castSegment(center, targetCenter, 0);
      const ownNode = target?.node || target?.g;
      occluded = Boolean(
        hit
        && Number.isFinite(hit.fraction)
        && hit.fraction < 1 - 1e-6
        && hit.node !== ownNode
        && hit.target !== target
      );
    }
    const falloff = outside || occluded
      ? 0
      : Math.max(0, 1 - distance / blastRadius) ** 2;
    const damage = peakDamage * falloff;
    result[key] = { damage, distance, occluded, target };
    if (damage > 0) applyDamage?.(target, damage, result[key]);
  }
  return result;
}

function capacitiesFor(active) {
  let assigned = 0;
  const capacities = {};
  CHANNELS.forEach((kind, index) => {
    const capacity = index === CHANNELS.length - 1
      ? active - assigned
      : Math.floor(active * CHANNEL_WEIGHTS[kind]);
    capacities[kind] = capacity;
    assigned += capacity;
  });
  return capacities;
}

function defaultBatchFactory(THREE, textures, kind, capacity) {
  if (!THREE) return null;
  const dynamic = THREE.DynamicDrawUsage;
  if (kind === 'spark') {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(capacity * 3, 3);
    geometry.setAttribute('position', position);
    const material = new THREE.PointsMaterial({
      map: textures.dot || null,
      color: 0xffcf8a,
      size: 0.34,
      transparent: true,
      opacity: 0.95,
      alphaTest: 0.015,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const node = new THREE.Points(geometry, material);
    node.frustumCulled = false;
    return { node, geometry, material, position };
  }
  if (kind === 'streak') {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(capacity * 6, 3);
    geometry.setAttribute('position', position);
    const material = new THREE.LineBasicMaterial({
      color: 0xffd8a0,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const node = new THREE.LineSegments(geometry, material);
    node.frustumCulled = false;
    return { node, geometry, material, position };
  }
  const geometry = kind === 'debris'
    ? new THREE.BoxGeometry(0.22, 0.14, 0.28)
    : new THREE.PlaneGeometry(1, 1);
  const material = kind === 'debris'
    ? new THREE.MeshLambertMaterial({ color: 0x544b3e })
    : new THREE.MeshBasicMaterial({
      map: kind === 'smoke' ? textures.puff3d || textures.smoke : textures.fire,
      color: kind === 'smoke' ? 0x938d86 : 0xffb04f,
      transparent: true,
      opacity: kind === 'smoke' ? 0.58 : 0.94,
      alphaTest: 0.012,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: kind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  const node = new THREE.InstancedMesh(geometry, material, capacity);
  node.frustumCulled = false;
  node.instanceMatrix?.setUsage?.(dynamic);
  return { node, geometry, material };
}

export function createWeaponEffects(scene, {
  tier = 'desktop',
  textures = {},
  heightAt,
  THREE = null,
  random = Math.random,
  ownsTextures = false,
  batchFactory = null,
} = {}) {
  const budget = effectBudget(tier);
  const capacities = capacitiesFor(budget.active);
  const channels = {};
  const resources = [];
  const renderDummy = THREE ? new THREE.Object3D() : null;
  const textureResources = new Set();
  let active = 0;
  let peak = 0;
  let emitted = 0;
  let lastEmission = 0;
  let lastImpactKind = null;
  let lastImpactNormal = null;
  let disposed = false;
  let disposeCalls = 0;
  let disposedResources = 0;

  for (const kind of CHANNELS) {
    const capacity = capacities[kind];
    const record = {
      kind,
      capacity,
      cursor: 0,
      active: new Uint8Array(capacity),
      age: new Float32Array(capacity),
      life: new Float32Array(capacity),
      size: new Float32Array(capacity),
      position: new Float32Array(capacity * 3),
      velocity: new Float32Array(capacity * 3),
      batch: null,
    };
    record.position.fill(-1e6);
    const created = batchFactory
      ? batchFactory(kind, capacity)
      : defaultBatchFactory(THREE, textures, kind, capacity);
    if (created) {
      record.batch = created;
      resources.push(created);
      for (const texture of created.textures || []) textureResources.add(texture);
      scene?.add?.(created.node);
    }
    channels[kind] = record;
  }

  const allocate = (kind, spec) => {
    const channel = channels[kind];
    const index = channel.cursor;
    channel.cursor = (index + 1) % channel.capacity;
    if (!channel.active[index]) active += 1;
    channel.active[index] = 1;
    channel.age[index] = 0;
    channel.life[index] = Math.max(0.08, finite(spec.life, 1));
    channel.size[index] = Math.max(0.02, finite(spec.size, 1));
    const offset = index * 3;
    channel.position[offset] = spec.position.x;
    channel.position[offset + 1] = spec.position.y;
    channel.position[offset + 2] = spec.position.z;
    channel.velocity[offset] = spec.velocity.x;
    channel.velocity[offset + 1] = spec.velocity.y;
    channel.velocity[offset + 2] = spec.velocity.z;
    peak = Math.max(peak, active);
  };

  const emitImpact = ({
    profile = {},
    hit = {},
    inheritedVelocity = {},
    scale = 1,
  } = {}) => {
    if (disposed) return 0;
    const heavy = profile.effect === 'heavy'
      || finite(profile.big) >= 2
      || finite(scale, 1) >= 2;
    const kinetic = String(profile.effect || '').startsWith('kinetic');
    const count = heavy ? budget.heavy
      : kinetic ? Math.max(12, Math.round(budget.heavy * 0.08))
        : Math.max(28, Math.round(budget.heavy * 0.32));
    const origin = point(hit.point);
    const normal = normalized(hit.normal);
    lastImpactKind = hit.kind || 'air';
    lastImpactNormal = { ...normal };
    const inherited = point(inheritedVelocity);
    const impactScale = Math.max(0.2, finite(scale, profile.big || 1));
    for (let index = 0; index < count; index += 1) {
      const kind = EMISSION_PATTERN[(emitted + index) % EMISSION_PATTERN.length];
      const angle = index * 2.399963229728653 + random() * 0.24;
      const lift = 0.16 + ((index * 37) % 83) / 100;
      const tangent = normalized({
        x: Math.cos(angle),
        y: lift,
        z: Math.sin(angle),
      });
      const speedBase = kind === 'streak' || kind === 'spark' ? 24
        : kind === 'debris' ? 13
          : kind === 'fire' ? 7 : 4;
      const speed = speedBase * (0.72 + random() * 0.56) * Math.sqrt(impactScale);
      const velocity = {
        x: tangent.x * speed + normal.x * speed * 0.35 + inherited.x * 0.18,
        y: Math.abs(tangent.y * speed) + normal.y * speed * 0.35 + inherited.y * 0.18,
        z: tangent.z * speed + normal.z * speed * 0.35 + inherited.z * 0.18,
      };
      const life = kind === 'smoke' ? 3.8 + random() * 2.1
        : kind === 'fire' ? 0.45 + random() * 0.5
          : kind === 'debris' ? 2.4 + random() * 2.2
            : 0.65 + random() * 0.55;
      const size = kind === 'smoke' ? (1.5 + random() * 2.4) * impactScale
        : kind === 'fire' ? (0.7 + random() * 1.1) * impactScale
          : kind === 'debris' ? 0.45 + random() * 0.8
            : 0.25 + random() * 0.35;
      allocate(kind, { position: origin, velocity, life, size });
    }
    emitted += count;
    lastEmission = count;
    return count;
  };

  const emitTrail = ({
    profile = {},
    position,
    velocity = {},
    dt = 1 / 60,
  } = {}) => {
    if (disposed) return 0;
    const count = Math.max(1, Math.min(4, Math.ceil(finite(dt) * 120)));
    const origin = point(position);
    const sourceVelocity = point(velocity);
    for (let index = 0; index < count; index += 1) {
      const kind = index % 3 === 0 && profile.effect !== 'residual'
        ? 'fire' : 'smoke';
      allocate(kind, {
        position: origin,
        velocity: {
          x: -sourceVelocity.x * 0.025 + (random() - 0.5) * 0.4,
          y: 1.1 + random() * 1.3,
          z: -sourceVelocity.z * 0.025 + (random() - 0.5) * 0.4,
        },
        life: kind === 'smoke' ? 1.6 + random() * 1.2 : 0.28 + random() * 0.24,
        size: kind === 'smoke' ? 0.65 + random() * 0.5 : 0.35 + random() * 0.3,
      });
    }
    emitted += count;
    lastEmission = count;
    return count;
  };

  const updateBatch = (channel, camera) => {
    const batch = channel.batch;
    if (!batch || !THREE) return;
    const positionAttribute = batch.position || batch.geometry?.attributes?.position;
    for (let index = 0; index < channel.capacity; index += 1) {
      const offset = index * 3;
      const isActive = channel.active[index] === 1;
      if (channel.kind === 'spark') {
        positionAttribute.array[offset] = isActive ? channel.position[offset] : -1e6;
        positionAttribute.array[offset + 1] = isActive ? channel.position[offset + 1] : -1e6;
        positionAttribute.array[offset + 2] = isActive ? channel.position[offset + 2] : -1e6;
        continue;
      }
      if (channel.kind === 'streak') {
        const lineOffset = index * 6;
        const x = isActive ? channel.position[offset] : -1e6;
        const y = isActive ? channel.position[offset + 1] : -1e6;
        const z = isActive ? channel.position[offset + 2] : -1e6;
        positionAttribute.array[lineOffset] = x;
        positionAttribute.array[lineOffset + 1] = y;
        positionAttribute.array[lineOffset + 2] = z;
        positionAttribute.array[lineOffset + 3] = x - channel.velocity[offset] * 0.025;
        positionAttribute.array[lineOffset + 4] = y - channel.velocity[offset + 1] * 0.025;
        positionAttribute.array[lineOffset + 5] = z - channel.velocity[offset + 2] * 0.025;
        continue;
      }
      renderDummy.position.set(
        channel.position[offset],
        channel.position[offset + 1],
        channel.position[offset + 2],
      );
      if (camera?.quaternion && channel.kind !== 'debris') {
        renderDummy.quaternion.copy(camera.quaternion);
      } else {
        renderDummy.rotation.set(
          channel.age[index] * 1.7,
          channel.age[index] * 2.3,
          channel.age[index] * 1.1,
        );
      }
      const progress = channel.life[index] > 0
        ? channel.age[index] / channel.life[index] : 1;
      const size = isActive
        ? channel.size[index] * (
          channel.kind === 'smoke' ? 0.35 + progress * 1.25 : 1 - progress * 0.45
        )
        : 0;
      renderDummy.scale.set(
        size,
        channel.kind === 'smoke' ? size * 1.28 : size,
        size,
      );
      renderDummy.updateMatrix();
      batch.node.setMatrixAt(index, renderDummy.matrix);
    }
    if (positionAttribute) positionAttribute.needsUpdate = true;
    if (batch.node.instanceMatrix) batch.node.instanceMatrix.needsUpdate = true;
  };

  const update = (dt, camera = null) => {
    if (disposed) return;
    const step = Math.max(0, finite(dt));
    for (const channel of Object.values(channels)) {
      for (let index = 0; index < channel.capacity; index += 1) {
        if (!channel.active[index]) continue;
        channel.age[index] += step;
        if (channel.age[index] >= channel.life[index]) {
          channel.active[index] = 0;
          active -= 1;
          continue;
        }
        const offset = index * 3;
        if (channel.kind === 'spark' || channel.kind === 'streak' || channel.kind === 'debris') {
          channel.velocity[offset + 1] -= (channel.kind === 'debris' ? 22 : 30) * step;
        } else {
          channel.velocity[offset + 1] += (channel.kind === 'smoke' ? 1.4 : 0.5) * step;
        }
        const drag = channel.kind === 'smoke' ? 0.8 : 0.18;
        const damping = Math.max(0, 1 - drag * step);
        channel.velocity[offset] *= damping;
        channel.velocity[offset + 1] *= damping;
        channel.velocity[offset + 2] *= damping;
        channel.position[offset] += channel.velocity[offset] * step;
        channel.position[offset + 1] += channel.velocity[offset + 1] * step;
        channel.position[offset + 2] += channel.velocity[offset + 2] * step;
        if (typeof heightAt === 'function' && channel.kind === 'debris') {
          const ground = heightAt(channel.position[offset], channel.position[offset + 2]);
          if (Number.isFinite(ground) && channel.position[offset + 1] < ground + 0.05) {
            channel.position[offset + 1] = ground + 0.05;
            channel.velocity[offset + 1] = Math.abs(channel.velocity[offset + 1]) * 0.22;
          }
        }
      }
      updateBatch(channel, camera);
    }
  };

  const snapshot = () => ({
    tier: BUDGETS[tier] ? tier : 'desktop',
    budget: { ...budget },
    capacities: { ...capacities },
    active,
    peak,
    emitted,
    lastEmission,
    drawBatches: CHANNELS.length,
    softAlpha: true,
    shockwaveViewportCap: 0.35,
    lastImpactKind,
    lastImpactNormal: lastImpactNormal ? { ...lastImpactNormal } : null,
    disposed,
    disposeCalls,
    disposedResources,
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeCalls += 1;
    const seenGeometry = new Set();
    const seenMaterial = new Set();
    for (const resource of resources) {
      scene?.remove?.(resource.node);
      if (resource.geometry && !seenGeometry.has(resource.geometry)) {
        seenGeometry.add(resource.geometry);
        resource.geometry.dispose?.();
        disposedResources += 1;
      }
      if (resource.material && !seenMaterial.has(resource.material)) {
        seenMaterial.add(resource.material);
        resource.material.dispose?.();
        disposedResources += 1;
      }
    }
    if (ownsTextures) {
      for (const texture of textureResources) {
        texture.dispose?.();
        disposedResources += 1;
      }
    }
    active = 0;
    for (const channel of Object.values(channels)) channel.active.fill(0);
  };

  return {
    emitImpact,
    emitTrail,
    update,
    snapshot,
    dispose,
  };
}
