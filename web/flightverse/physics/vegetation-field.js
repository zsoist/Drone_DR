// flightverse/physics/vegetation-field.js — soft-drag density field from the
// scatter.json that vegetation.js (E) renders. Same rows, same cap: what you can
// see is what slows you down. Pure; the caller supplies the parsed document.
//
// Row layout (pipeline/scatter.py): [x, z, groundOffset, height, yaw, type, tint].
// A plant is a vertical cylinder of radius ~ 0.5 * height * widthFactor from the
// ground to its height. Density 0..1 = 1 - r/R (soft edge), max over neighbours.

const WIDTH = { tree_round: 1.55, tree_conifer: 1.35, tree_oak: 1.6, bush: 1.0 };
const CELL = 6;

export function buildVegetationField(doc, cap, heightAt) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.instances) || !Array.isArray(doc.types)) return null;
  const rows = doc.instances.slice(0, Math.max(0, cap | 0));
  const cells = new Map();
  let count = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const x = +r[0], z = +r[1], h = +r[3];
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(h > 0)) continue;
    const name = String(doc.types[r[5] | 0] || '');
    const w = (WIDTH[name] || 1.4) * h * 0.5;
    const gy = heightAt ? heightAt(x, z) : 0;
    if (gy == null || !Number.isFinite(gy)) continue;
    const key = Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663;
    let list = cells.get(key);
    if (!list) cells.set(key, list = []);
    list.push(x, z, w, gy, gy + h);            // flat numbers: x, z, radius, y0, y1
    count++;
  }
  if (!count) return null;
  const maxR = 5;                               // tallest canopy radius we ever look for
  return {
    count,
    densityAt(px, py, pz) {
      let best = 0;
      const cx0 = Math.floor((px - maxR) / CELL), cx1 = Math.floor((px + maxR) / CELL);
      const cz0 = Math.floor((pz - maxR) / CELL), cz1 = Math.floor((pz + maxR) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const list = cells.get(cx * 73856093 ^ cz * 19349663);
          if (!list) continue;
          for (let i = 0; i < list.length; i += 5) {
            if (py < list[i + 3] || py > list[i + 4] + 0.3) continue;
            const dx = px - list[i], dz = pz - list[i + 1];
            const d2 = dx * dx + dz * dz, R = list[i + 2];
            if (d2 >= R * R) continue;
            const d = 1 - Math.sqrt(d2) / R;
            if (d > best) best = d;
          }
        }
      }
      return best;
    },
  };
}
