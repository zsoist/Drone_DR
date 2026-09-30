// flightverse/tour/splat-edge.js — niebla-muro del borde también para el splat (WS E, ?fv=2).
// El splat (Spark) no pasa por los materiales three, así que el borde se inyecta como un
// worldModifier (dyno): a partir de fog[0] el color se funde con la niebla y a partir del 85 % del
// tramo la opacidad cae a 0 — el contorno de la captura se disuelve en bruma en vez de cortarse.
// Comparte los uniformes de world-look.js (mismo centro, fog, color y fuerza que terreno/malla).
import { WORLD_LOOK } from '/flightverse/world-look.js?v=368';

let sparkMod = null;
async function spark() {
  if (!sparkMod) sparkMod = await import('/vendor/spark.module.js?v=368');
  return sparkMod;
}

/** Devuelve el primer SplatMesh dentro de `root` (o null). */
export function findSplatMesh(root) {
  let found = null;
  root.traverse?.(o => { if (!found && o.constructor?.name === 'SplatMesh') found = o; });
  return found;
}

export async function applySplatEdge(splatMesh) {
  if (!splatMesh || splatMesh.userData?.fvEdge) return false;
  const { dyno } = await spark();
  const a = dyno.dynoVec4(WORLD_LOOK.uFvEdgeA.value);
  const b = dyno.dynoVec4(WORLD_LOOK.uFvEdgeB.value);
  const c = dyno.dynoVec3(WORLD_LOOK.uFvEdgeColor.value);
  const mod = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat, edgeA: 'vec4', edgeB: 'vec4', color: 'vec3' },
    outTypes: { gsplat: dyno.Gsplat },
    inputs: { edgeA: a, edgeB: b, color: c },
    statements: ({ inputs, outputs }) => [
      `${outputs.gsplat} = ${inputs.gsplat};`,
      `if (${inputs.edgeB}.y > 0.0) {`,
      `  vec2 fvD = ${inputs.gsplat}.center.xz - ${inputs.edgeA}.xy;`,
      `  float fvM = ${inputs.edgeB}.x > 0.5 ? max(abs(fvD.x), abs(fvD.y)) : length(fvD);`,
      `  float fvT = clamp((fvM - ${inputs.edgeA}.z) / max(${inputs.edgeA}.w - ${inputs.edgeA}.z, 1.0), 0.0, 1.0);`,
      '  fvT = fvT * fvT * (3.0 - 2.0 * fvT);',
      `  fvT *= ${inputs.edgeB}.y;`,
      `  ${outputs.gsplat}.rgba.rgb = mix(${inputs.gsplat}.rgba.rgb, ${inputs.color}, fvT);`,
      `  ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * (1.0 - smoothstep(0.80, 1.0, fvT));`,
      '}',
    ],
  });
  splatMesh.worldModifier = mod;
  splatMesh.updateGenerator?.();
  splatMesh.userData.fvEdge = true;
  return true;
}
