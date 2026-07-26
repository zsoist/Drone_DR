// Unified FLIGHTVERSE structural, terrain, and playable-boundary queries.
import * as THREE from '/flightverse/three.js?v=297';
import {
  MeshBVH,
  getTriangleHitPointInfo,
} from '/vendor/three-mesh-bvh180.module.js?v=297';
import {
  earliestHit,
  segmentCircleBoundaryHit,
  segmentSquareBoundaryHit,
} from '/flightverse/collision-math.js?v=297';

const EPSILON = 1e-7;
const ZERO = new THREE.Vector3();

function vector(value) {
  if (value?.isVector3) return value;
  return new THREE.Vector3(
    Number(value?.x) || 0,
    Number(value?.y) || 0,
    Number(value?.z) || 0,
  );
}

function plain(value) {
  return { x: value.x, y: value.y, z: value.z };
}

function orientedNormal(normal, direction) {
  const result = normal.clone().normalize();
  if (result.dot(direction) > 0) result.negate();
  return result;
}

async function checkedFetch(url, type) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return type === 'json' ? response.json() : response.arrayBuffer();
}

function validateCollider(meta, buffer) {
  const verts = Number(meta?.verts);
  const tris = Number(meta?.tris);
  const bytesPos = Number(meta?.bytes_pos);
  const bytesIdx = Number(meta?.bytes_idx);
  if (
    !Number.isInteger(verts) || verts < 3
    || !Number.isInteger(tris) || tris < 1
    || bytesPos !== verts * 3 * 4
    || bytesIdx !== tris * 3 * 4
    || buffer.byteLength !== bytesPos + bytesIdx
  ) {
    throw new Error('collider bin/meta inconsistente');
  }
  if (bytesPos % 4 !== 0) throw new Error('collider desalineado');
}

function buildCollider(meta, buffer) {
  validateCollider(meta, buffer);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(buffer, 0, meta.verts * 3);
  const indices = new Uint32Array(buffer, meta.bytes_pos, meta.tris * 3);
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) {
      geometry.dispose();
      throw new Error('collider contiene posiciones no finitas');
    }
  }
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] >= meta.verts) {
      geometry.dispose();
      throw new Error('collider contiene índices fuera de rango');
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const bvh = new MeshBVH(geometry, { targetLeafSize: 12 });
  geometry.boundsTree = bvh;
  return { geometry, bvh };
}

function boundaryHit(start, end, boundary, radius = 0) {
  if (!boundary) return null;
  let hit = null;
  if (boundary.shape === 'square') {
    const extent = Number(boundary.halfExtent) - radius;
    if (
      Math.abs(start.x) > extent + EPSILON
      || Math.abs(start.z) > extent + EPSILON
    ) {
      const point = new THREE.Vector3(
        THREE.MathUtils.clamp(start.x, -extent, extent),
        start.y,
        THREE.MathUtils.clamp(start.z, -extent, extent),
      );
      const normal = point.clone().sub(start).setY(0).normalize();
      return {
        kind: 'boundary',
        fraction: 0,
        point,
        normal: normal.lengthSq() > EPSILON ? normal : new THREE.Vector3(1, 0, 0),
      };
    }
    hit = segmentSquareBoundaryHit(plain(start), plain(end), extent);
  } else {
    const extent = Number(boundary.radius) - radius;
    const planarDistance = Math.hypot(start.x, start.z);
    if (planarDistance > extent + EPSILON) {
      const scale = extent / planarDistance;
      return {
        kind: 'boundary',
        fraction: 0,
        point: new THREE.Vector3(start.x * scale, start.y, start.z * scale),
        normal: new THREE.Vector3(-start.x, 0, -start.z).normalize(),
      };
    }
    hit = segmentCircleBoundaryHit(plain(start), plain(end), extent);
  }
  if (!hit) return null;
  return {
    ...hit,
    kind: 'boundary',
    point: vector(hit.point),
    normal: vector(hit.normal),
  };
}

function sweepRadii(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('sweepSphere requiere radius positivo');
    }
    return { structure: value, terrain: value, boundary: value };
  }
  const result = {
    structure: Number(value?.structure),
    terrain: Number(value?.terrain),
    boundary: Number(value?.boundary),
  };
  if (!Object.values(result).every(radius => Number.isFinite(radius) && radius > 0)) {
    throw new Error('sweepSphere requiere radios positivos');
  }
  return result;
}

export async function createWorldCollision(
  man,
  {
    heightAt = null,
    boundary = null,
    report = null,
  } = {},
) {
  let geometry = null;
  let bvh = null;
  let disposed = false;
  const qa = {
    ready: false,
    structure: false,
    casts: 0,
    sweeps: 0,
    closest: 0,
    boundaryHits: 0,
    terrainHits: 0,
    structureHits: 0,
    disposed: false,
  };

  const hasColliderAsset = Boolean(
    man?.assets?.collision_meta && man?.assets?.collision_bin,
  );
  if (hasColliderAsset) {
    const [meta, buffer] = await Promise.all([
      checkedFetch(man.assets.collision_meta, 'json'),
      checkedFetch(man.assets.collision_bin, 'arrayBuffer'),
    ]);
    ({ geometry, bvh } = buildCollider(meta, buffer));
    qa.structure = true;
    qa.tris = meta.tris;
  } else if (man?.capabilities?.mesh && man?.capabilities?.collision) {
    throw new Error('mundo mesh promete colisión pero no publica collider');
  }

  const direction = new THREE.Vector3();
  const ray = new THREE.Ray();
  const sample = new THREE.Vector3();
  const closestTarget = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1,
  };

  function ensureActive() {
    if (disposed) throw new Error('world collision disposed');
  }

  function structureRayHit(start, end) {
    if (!bvh) return null;
    direction.subVectors(end, start);
    const distance = direction.length();
    if (distance <= EPSILON) return null;
    direction.multiplyScalar(1 / distance);
    ray.set(start, direction);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, distance);
    if (!hit) return null;
    return {
      kind: 'structure',
      fraction: Math.min(1, Math.max(0, hit.distance / distance)),
      point: hit.point.clone(),
      normal: orientedNormal(hit.face.normal, direction),
      faceIndex: hit.faceIndex,
    };
  }

  function closestStructure(point, maxDistance = Infinity) {
    if (!bvh) return null;
    closestTarget.distance = Infinity;
    closestTarget.faceIndex = -1;
    const result = bvh.closestPointToPoint(
      point,
      closestTarget,
      0,
      maxDistance,
    );
    if (!result) return null;
    let normal = sample.subVectors(point, result.point);
    if (normal.lengthSq() <= EPSILON) {
      const triangle = getTriangleHitPointInfo(
        result.point,
        geometry,
        result.faceIndex,
      );
      normal = triangle.face.normal;
    }
    return {
      kind: 'structure',
      distance: result.distance,
      point: result.point.clone(),
      normal: normal.clone().normalize(),
      faceIndex: result.faceIndex,
    };
  }

  function sweepStructure(start, end, radius) {
    if (!bvh) return null;
    const delta = direction.subVectors(end, start);
    const distance = delta.length();
    const first = closestStructure(start, radius);
    if (first && first.distance <= radius + EPSILON) {
      return {
        ...first,
        fraction: 0,
        point: start.clone(),
        surfacePoint: first.point.clone(),
      };
    }
    if (distance <= EPSILON) return null;
    const steps = Math.min(
      8192,
      Math.max(1, Math.ceil(distance / Math.max(radius * 0.5, 0.05))),
    );
    let previousFraction = 0;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      sample.copy(start).addScaledVector(delta, fraction);
      const found = closestStructure(sample, radius);
      if (!found || found.distance > radius + EPSILON) {
        previousFraction = fraction;
        continue;
      }
      let low = previousFraction;
      let high = fraction;
      let contact = found;
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const middle = (low + high) * 0.5;
        sample.copy(start).addScaledVector(delta, middle);
        const middleHit = closestStructure(sample, radius);
        if (middleHit && middleHit.distance <= radius) {
          high = middle;
          contact = middleHit;
        } else {
          low = middle;
        }
      }
      const center = start.clone().addScaledVector(delta, high);
      return {
        ...contact,
        fraction: high,
        point: center,
        surfacePoint: contact.point.clone(),
      };
    }
    return null;
  }

  function terrainHit(start, end, radius = 0) {
    if (typeof heightAt !== 'function') return null;
    const delta = direction.subVectors(end, start);
    const distance = delta.length();
    const signedAt = (fraction) => {
      sample.copy(start).addScaledVector(delta, fraction);
      const height = heightAt(sample.x, sample.z);
      if (!Number.isFinite(height)) return null;
      return sample.y - height - radius;
    };
    const terrainNormal = (x, z) => {
      const offset = 0.25;
      const west = heightAt(x - offset, z);
      const east = heightAt(x + offset, z);
      const north = heightAt(x, z - offset);
      const south = heightAt(x, z + offset);
      if (![west, east, north, south].every(Number.isFinite)) {
        return new THREE.Vector3(0, 1, 0);
      }
      return new THREE.Vector3(
        west - east,
        offset * 2,
        north - south,
      ).normalize();
    };
    const initial = signedAt(0);
    if (initial !== null && initial <= 0) {
      const height = heightAt(start.x, start.z);
      return {
        kind: 'terrain',
        fraction: 0,
        point: new THREE.Vector3(start.x, height + radius, start.z),
        normal: terrainNormal(start.x, start.z),
      };
    }
    if (distance <= EPSILON) return null;
    const steps = Math.min(512, Math.max(1, Math.ceil(distance / 0.25)));
    let previousFraction = 0;
    let previousSigned = initial;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      const signed = signedAt(fraction);
      if (
        signed !== null && signed <= 0
        && (previousSigned === null || previousSigned > 0)
      ) {
        let low = previousFraction;
        let high = fraction;
        for (let iteration = 0; iteration < 12; iteration += 1) {
          const middle = (low + high) * 0.5;
          const middleSigned = signedAt(middle);
          if (middleSigned !== null && middleSigned <= 0) high = middle;
          else low = middle;
        }
        const point = start.clone().addScaledVector(delta, high);
        const height = heightAt(point.x, point.z);
        point.y = height + radius;
        return {
          kind: 'terrain',
          fraction: high,
          point,
          normal: terrainNormal(point.x, point.z),
        };
      }
      previousFraction = fraction;
      previousSigned = signed;
    }
    return null;
  }

  function recordHit(hit) {
    if (!hit) return hit;
    if (hit.kind === 'structure') qa.structureHits += 1;
    if (hit.kind === 'terrain') qa.terrainHits += 1;
    if (hit.kind === 'boundary') qa.boundaryHits += 1;
    return hit;
  }

  function castSegment(startValue, endValue, radius = 0) {
    ensureActive();
    qa.casts += 1;
    const start = vector(startValue);
    const end = vector(endValue);
    const structure = radius > EPSILON
      ? sweepStructure(start, end, radius)
      : structureRayHit(start, end);
    return recordHit(earliestHit([
      structure,
      terrainHit(start, end, radius),
      boundaryHit(start, end, boundary, radius),
    ]));
  }

  function sweepSphere(startValue, endValue, radius) {
    ensureActive();
    const radii = sweepRadii(radius);
    qa.sweeps += 1;
    const start = vector(startValue);
    const end = vector(endValue);
    return recordHit(earliestHit([
      sweepStructure(start, end, radii.structure),
      terrainHit(start, end, radii.terrain),
      boundaryHit(start, end, boundary, radii.boundary),
    ]));
  }

  function closest(pointValue, maxDistance = Infinity) {
    ensureActive();
    qa.closest += 1;
    const point = vector(pointValue);
    const hits = [];
    const structure = closestStructure(point, maxDistance);
    if (structure) hits.push(structure);
    if (typeof heightAt === 'function') {
      const height = heightAt(point.x, point.z);
      const distance = Number.isFinite(height) ? Math.abs(point.y - height) : Infinity;
      if (distance <= maxDistance) {
        hits.push({
          kind: 'terrain',
          distance,
          point: new THREE.Vector3(point.x, height, point.z),
          normal: new THREE.Vector3(0, 1, 0),
        });
      }
    }
    return hits.reduce(
      (best, hit) => (!best || hit.distance < best.distance ? hit : best),
      null,
    );
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (geometry) {
      geometry.boundsTree = null;
      geometry.dispose();
    }
    geometry = null;
    bvh = null;
    qa.disposed = true;
  }

  qa.ready = true;
  if (report && typeof report === 'object') report.worldCollision = qa;
  return {
    castSegment,
    sweepSphere,
    closest,
    groundHeight: (x, z) => (
      typeof heightAt === 'function' ? heightAt(x, z) : null
    ),
    dispose,
    qa,
  };
}
