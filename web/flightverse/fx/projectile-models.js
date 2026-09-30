// flightverse/fx/projectile-models.js — procedural projectile geometry that reads as a rocket
// (nose forward +Z, tail nozzle, four fins, colour bands via vertex colours) and a finned NOVA
// bomb. One merged BufferGeometry each = one draw call per projectile. Pure geometry builders:
// THREE is injected so this stays importable without a bundler.

function lathe(THREE, points, segments) {
  const pts = points.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2);            // +Y (length axis) -> +Z (nose)
  return g.index ? g.toNonIndexed() : g;
}

function box(THREE, sx, sy, sz, px, py, pz, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rz) g.rotateZ(rz);
  g.translate(px, py, pz);
  return g.toNonIndexed();
}

function paintBy(THREE, geometry, colorAt) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    c.set(colorAt(pos.getX(i), pos.getY(i), pos.getZ(i)));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function merge(THREE, geometries) {
  let total = 0;
  for (const g of geometries) total += g.attributes.position.count;
  const out = { position: new Float32Array(total * 3), normal: new Float32Array(total * 3), color: new Float32Array(total * 3) };
  let offset = 0;
  for (const g of geometries) {
    out.position.set(g.attributes.position.array, offset * 3);
    out.normal.set(g.attributes.normal.array, offset * 3);
    out.color.set(g.attributes.color.array, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(out.position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(out.normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(out.color, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** Rocket, unit length along Z (-0.5 tail .. +0.5 nose), body diameter 0.18. */
export function buildRocketGeometry(THREE) {
  const body = lathe(THREE, [
    [0.0, -0.5], [0.07, -0.5], [0.055, -0.44], [0.09, -0.4], [0.09, 0.2], [0.085, 0.26],
    [0.07, 0.36], [0.045, 0.45], [0.0, 0.5],
  ], 12);
  paintBy(THREE, body, (x, y, z) => {
    if (z < -0.39) return 0x25272b;                      // nozzle
    if (z > 0.05 && z < 0.13) return 0xd9472a;           // warning band
    if (z > 0.34) return 0xc8391f;                       // nose
    return 0xc9ced6;                                     // airframe
  });
  const fins = [];
  for (let i = 0; i < 4; i += 1) {
    const f = box(THREE, 0.012, 0.17, 0.2, 0, 0.13, -0.36);
    f.rotateZ(i * Math.PI / 2);
    fins.push(paintBy(THREE, f, () => 0x50565e));
  }
  return merge(THREE, [body, ...fins]);
}

/** NOVA bomb, unit length along Z, fat teardrop with tail fins and a yellow band. */
export function buildBombGeometry(THREE) {
  const body = lathe(THREE, [
    [0.0, -0.5], [0.13, -0.5], [0.22, -0.4], [0.32, -0.15], [0.34, 0.05], [0.28, 0.25], [0.16, 0.4], [0.0, 0.5],
  ], 14);
  paintBy(THREE, body, (x, y, z) => ((z > -0.02 && z < 0.1) ? 0xe0a458 : (z < -0.36 ? 0x2a2c30 : 0x3c4148)));
  const fins = [];
  for (let i = 0; i < 4; i += 1) {
    const f = box(THREE, 0.02, 0.3, 0.24, 0, 0.26, -0.38);
    f.rotateZ(i * Math.PI / 2 + Math.PI / 4);
    fins.push(paintBy(THREE, f, () => 0x2a2c30));
  }
  return merge(THREE, [body, ...fins]);
}

/** Visual length (m) of each registry projectile. */
export const PROJECTILE_LENGTH = Object.freeze({ s: 1.3, m: 1.7, l: 2.4, vx: 1.9, sw: 0.95, tb: 2.3 });

export function createProjectileModels(THREE) {
  const rocketGeo = buildRocketGeometry(THREE);
  const bombGeo = buildBombGeometry(THREE);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x5a5d63 });
  return {
    rocketGeo, bombGeo, material,
    dispose() { rocketGeo.dispose(); bombGeo.dispose(); material.dispose(); },
  };
}
