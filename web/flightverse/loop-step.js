// flightverse/loop-step.js — acumulador de pasos fijos (puro, testeable en Node).
// El hit-stop NO salta pasos: escala el TIEMPO que entra al acumulador. Cada paso sigue siendo exactamente STEP
// (simulación idéntica), el reloj de la simulación avanza más lento y `alpha` (interpolación de render) se mueve de
// forma continua, así el dron se ve frenar y retomar sin tirones.
export function createStepAccumulator({ step, maxSteps = 6, maxDt = 0.25 }) {
  let acc = 0;
  return {
    /** Mete `dt` real (s) con la escala de tiempo `scale` (0..1); devuelve cuántos pasos fijos hay que correr. */
    feed(dt, scale = 1) {
      acc += Math.min(dt, maxDt) * scale;
      let n = 0;
      while (acc >= step && n < maxSteps) { acc -= step; n++; }
      if (n === maxSteps) acc = 0;           // descartar deuda: mejor saltar que congelar
      return n;
    },
    get alpha() { return acc / step; },
    reset() { acc = 0; },
  };
}
