// flightverse/tour/photo-math.js — matemática pura del modo foto (WS E): focal -> FOV y parámetros del DOF.
// Sin DOM ni three: se prueba en pipeline/test_photo_math.mjs.
export const PHOTO_LIMITS = Object.freeze({
  focalMin: 18, focalMax: 85, fMin: 1.8, fMax: 16, evMin: -2, evMax: 2, maxLongSide: 2560,
  minAgl: 1.2, minGeoDist: 0.7, speed: 14, speedFast: 45, speedSlow: 4,
});
const SENSOR_HALF_DIAG = 21.635;           // mm (35 mm full frame)

/** FOV vertical (°) para una focal (mm) y un aspecto, con sensor de diagonal 43.27 mm. */
export function focalToVFov(mm, aspect) {
  const tanD = SENSOR_HALF_DIAG / mm;
  return 2 * Math.atan(tanD / Math.sqrt(1 + aspect * aspect)) * 180 / Math.PI;
}
/** FOV diagonal (°) de una focal. */
export function focalToDiagFov(mm) { return 2 * Math.atan(SENSOR_HALF_DIAG / mm) * 180 / Math.PI; }

/** Parámetros del DOF a partir de focal, apertura y distancia de enfoque (m). Pura, probada. */
export function dofParams(focalMm, fstop, focusDist) {
  const f = Math.max(PHOTO_LIMITS.fMin, Math.min(PHOTO_LIMITS.fMax, fstop));
  const aperture = PHOTO_LIMITS.fMin / f;                        // 1 a f/1.8 -> 0.11 a f/16
  const tele = Math.pow(focalMm / 50, 2);                        // más focal, menos profundidad de campo
  const bokehScale = Math.max(0.15, Math.min(9, 7 * aperture * tele));
  const range = Math.max(3, focusDist * (0.25 + 1.6 * (1 - aperture)) / Math.max(0.5, tele));
  return { bokehScale, focusRange: range, focusDistance: Math.max(0.5, focusDist) };
}

