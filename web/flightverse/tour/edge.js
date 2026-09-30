// flightverse/tour/edge.js — BORDE DEL MUNDO (WS E). Matemática pura (sin DOM, sin three):
// niebla-muro + aviso + límite suave. Se prueba en pipeline/test_world_edge.mjs.
//
// Métrica radial `m`: distancia (m) del punto al CENTRO del mundo — euclídea para frontera
// circular, Chebyshev (max(|dx|,|dz|)) para cuadrada. Las cifras del JSON (`edge.fog`, `edge.warn`)
// están en esa métrica, igual que el ejemplo del spec (§10): fog[0] = donde empieza la niebla,
// fog[1] = donde es opaca, warn = donde aparece la placa "Borde de la zona · gira".
//
//   boundary = { shape: 'circle', radius } | { shape: 'square', halfExtent }
export const EDGE_SOFT_BAND_M = 30;      // banda final donde el empuje hacia fuera se apaga (spec §10)

const finite = v => Number.isFinite(Number(v));
const clamp01 = v => Math.max(0, Math.min(1, v));

export function boundaryExtent(boundary) {
  if (!boundary) return 0;
  return Number(boundary.shape === 'square' ? boundary.halfExtent : boundary.radius) || 0;
}

/** Boundary desde el reporte de cobertura de volar.js (report.coverage). */
export function boundaryFromCoverage(coverage, nativeHalfExtent) {
  const d = Number(coverage?.effective_diameter_m);
  const half = finite(d) && d > 0 ? d / 2 : Number(nativeHalfExtent) || 0;
  return coverage?.shape === 'square'
    ? { shape: 'square', halfExtent: half }
    : { shape: 'circle', radius: half };
}

/** Métrica radial del punto (x,z) respecto al centro (cx,cz). */
export function edgeMetric(x, z, boundary, cx = 0, cz = 0) {
  const dx = x - cx, dz = z - cz;
  return boundary?.shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
}

/** Distancia (m) hasta la frontera, positiva dentro. */
export function distToBoundary(x, z, boundary, cx = 0, cz = 0) {
  return boundaryExtent(boundary) - edgeMetric(x, z, boundary, cx, cz);
}

/** Niebla de borde: 0 por debajo de fog[0], 1 (opaca) desde fog[1]; smoothstep. */
export function fogFactor(m, fog) {
  const [a, b] = fog;
  if (!(b > a)) return m >= b ? 1 : 0;
  const t = clamp01((m - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Empuje hacia fuera permitido: 1 lejos del borde -> 0 en la frontera (última banda de 30 m). */
export function softScale(m, boundary, band = EDGE_SOFT_BAND_M) {
  const R = boundaryExtent(boundary);
  const s = clamp01((m - (R - band)) / band);
  return 1 - s * s * (3 - 2 * s);
}

/** Factor s (0..1) de cercanía al borde para la banda final (0 = lejos, 1 = en la frontera). */
export function softS(m, boundary, band = EDGE_SOFT_BAND_M) {
  return 1 - softScale(m, boundary, band);
}

/**
 * Edge por defecto derivado de la frontera (spec §10: aviso 30 m dentro de la frontera).
 * La niebla empieza al ~72 % del radio (o R-60 si es mayor) y es opaca 6 m antes del borde.
 */
export function defaultEdge(boundary) {
  const R = boundaryExtent(boundary);
  const f0 = Math.max(R * 0.72, R - 60);
  return { fog: [Math.min(f0, R - 20), R - 6], warn: R - 30 };
}

/**
 * Resuelve el `edge` del JSON del mundo contra la frontera REAL en uso: si el jugador pidió un
 * diámetro menor que el nativo (?diametro=), las cifras se escalan en proporción; valores
 * inválidos caen al default; siempre fog[0] < fog[1] <= R - 2 y warn <= fog[1].
 */
export function resolveEdge(edge, boundary, nativeExtent = 0) {
  const R = boundaryExtent(boundary);
  const def = defaultEdge(boundary);
  if (!(R > 0)) return { fog: [0, 1], warn: 0, extent: 0, source: 'invalid' };
  const k = nativeExtent > 0 && nativeExtent > R ? R / nativeExtent : 1;
  let fog = def.fog.slice();
  let warn = def.warn;
  let source = 'default';
  if (edge && Array.isArray(edge.fog) && edge.fog.length === 2 && edge.fog.every(finite)
      && Number(edge.fog[0]) < Number(edge.fog[1])) {
    fog = [Number(edge.fog[0]) * k, Number(edge.fog[1]) * k];
    source = 'json';
  }
  if (edge && finite(edge.warn) && Number(edge.warn) > 0) { warn = Number(edge.warn) * k; source = 'json'; }
  fog[1] = Math.min(fog[1], R - 2);
  fog[0] = Math.min(fog[0], fog[1] - 8);
  fog[0] = Math.max(0, fog[0]);
  warn = Math.min(warn, fog[1]);
  return { fog, warn, extent: R, source };
}

/** Estado completo en un punto: lo que A dibuja (placa) y C usa (empuje). */
export function edgeState(x, z, boundary, edge, cx = 0, cz = 0) {
  const m = edgeMetric(x, z, boundary, cx, cz);
  const R = boundaryExtent(boundary);
  const dx = x - cx, dz = z - cz;
  const len = boundary?.shape === 'square'
    ? 1 : (Math.hypot(dx, dz) || 1);
  const out = boundary?.shape === 'square'
    ? (Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1])
    : [dx / len, dz / len];
  return {
    m, dist: R - m,
    fog: fogFactor(m, edge.fog),
    warn: m >= edge.warn,
    s: softS(m, boundary),
    scale: softScale(m, boundary),
    out,                       // vector unitario (x,z) apuntando hacia fuera
  };
}

/**
 * Límite suave para C: dado el empuje deseado `thrust` (x,z) en la posición, devuelve el empuje
 * con la componente saliente multiplicada por (1 - s). No toca la componente tangencial/entrante.
 */
export function limitThrust(thrustX, thrustZ, st) {
  const dot = thrustX * st.out[0] + thrustZ * st.out[1];
  if (dot <= 0) return [thrustX, thrustZ];
  const cut = dot * (1 - st.scale);
  return [thrustX - st.out[0] * cut, thrustZ - st.out[1] * cut];
}
