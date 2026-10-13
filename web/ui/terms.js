/** Internal keys remain unchanged in API requests and stored data. */
export const terms = Object.freeze({
  splat: 'Escena fotorrealista', mesh: 'Modelo 3D', malla: 'Modelo 3D',
  cloud: 'Puntos', nube: 'Puntos', pointCloud: 'Puntos',
  frontier: 'Detalle avanzado', grandmaster: 'Detalle máximo',
  gateRush: 'Carrera de aros', 'gate-rush': 'Carrera de aros',
  fast: 'Vista previa', medium: 'Detalle medio', cinematic: 'Cinemático',
  ultra: 'Detalle alto', ultra20: 'Detalle superior', splatLab: 'Taller de escenas',
});
export function term(key) { return Object.hasOwn(terms, key) ? terms[key] : key; }
