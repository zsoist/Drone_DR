// flightverse/tour/void-math.js — bruma interior según la distancia a una superficie (WS E). Pura: sin DOM ni three.
export const VOID = Object.freeze({ wall0: 0.32, wall1: 0.04, maxMist: 0.92, attack: 0.05, release: 0.35, probe: 3, ray: 12 });

/** Bruma objetivo (0..1) según la distancia a una superficie estructural (puro, probado). */
export function mistFromDistance(d) {
  if (d == null || !Number.isFinite(d)) return 0;
  const t = Math.max(0, Math.min(1, (VOID.wall0 - d) / (VOID.wall0 - VOID.wall1)));
  return t * t * (3 - 2 * t) * VOID.maxMist;
}


/** Bruma según cuántos de 6 rayos axiales (12 m) golpean geometría: >=5 = dentro de un volumen. */
export function mistFromEnclosure(hits) {
  if (hits >= 6) return VOID.maxMist;
  if (hits === 5) return VOID.maxMist * 0.9;
  if (hits === 4) return VOID.maxMist * 0.45;
  return 0;
}
