// flightverse/fx/surface.js — surface typing for impacts (pure).
// Spec §5 "Bullet impacts: surface-typed (concrete: grey dust + sparks; foliage: leaf cards 4;
// metal: sparks 8; ground: dirt puff)". World hits carry kind ('structure'|'terrain'|'target'|
// 'boundary'|'item'); items/targets may carry a node name or userData.kit.material.

const METAL = /(metal|steel|iron|car|carro|auto|bus|truck|tank|barrel|barril|drum|pipe|tubo|sign|valla|roof_?metal|zinc|lamina|container)/i;
const FOLIAGE = /(tree|arbol|árbol|plant|planta|shrub|arbusto|bush|veg|leaf|palm|grass|pasto|hedge)/i;
const FLESH = /(zombie|arquero|soldado)/i;

export const SURFACES = Object.freeze(['concrete', 'foliage', 'metal', 'ground', 'body', 'energy']);

function nameOf(hit) {
  const node = hit?.node || hit?.target?.node || hit?.target?.g || null;
  const parts = [];
  for (let n = node, depth = 0; n && depth < 3; n = n.parent, depth += 1) {
    if (n.name) parts.push(n.name);
    const kit = n.userData?.kit;
    if (kit?.material) parts.push(kit.material);
    if (kit?.name) parts.push(kit.name);
    if (n.userData?.surface) parts.push(n.userData.surface);
  }
  if (hit?.target?.type) parts.push(hit.target.type);
  return parts.join(' ');
}

/** @returns {'concrete'|'foliage'|'metal'|'ground'|'body'|'energy'} */
export function surfaceOf(hit) {
  if (!hit) return 'ground';
  if (hit.surface && SURFACES.includes(hit.surface)) return hit.surface;
  if (hit.kind === 'target' && hit.target?.enemy) {
    return hit.target.blood || FLESH.test(String(hit.target.type || '')) ? 'body' : 'energy';
  }
  const label = nameOf(hit);
  if (label) {
    if (FOLIAGE.test(label)) return 'foliage';
    if (METAL.test(label)) return 'metal';
  }
  if (hit.kind === 'terrain') return 'ground';
  if (hit.kind === 'structure' || hit.kind === 'item' || hit.kind === 'boundary') return 'concrete';
  if (hit.kind === 'target') return 'metal';
  return 'ground';
}
