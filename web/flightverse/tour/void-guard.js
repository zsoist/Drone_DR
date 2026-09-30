// flightverse/tour/void-guard.js — la cámara dentro de geometría ya no ve "el vacío" (WS E).
// C empuja la cámara fuera de la malla; este módulo gobierna lo que SE DIBUJA cuando aun así la
// cámara queda pegada o dentro: (1) bajo el terreno, (2) a < ~0.3 m de una superficie estructural.
// Resultado: bruma interior 0..1 (mezcla a color de niebla en materiales del mundo y cielo) y,
// siempre, disolución por dither de lo que esté a < 1.4 m (world-look.js). Coste: una consulta
// `closest` cada 2 frames.
import { WORLD_LOOK, setNearLook } from '/flightverse/world-look.js?v=370';
import { VOID, mistFromDistance, mistFromEnclosure } from '/flightverse/tour/void-math.js?v=370';

export { VOID, mistFromDistance };

export function createVoidGuard(ctx) {
  const { camera, sky, THREE } = ctx;
  let mist = 0, n = 0, target = 0;
  const _e = new THREE.Vector3();
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  setNearLook({ active: true });
  return {
    get mist() { return mist; },
    update(rdt) {
      if ((n++ % 3) === 0) {
        let t = 0;
        const c = camera.position;
        const g = ctx.terrain?.heightAt?.(c.x, c.z);
        if (g != null && c.y < g + 0.02) t = VOID.maxMist;                         // bajo el suelo
        else if (ctx.collision?.closest) {
          const near = ctx.collision.closest(c, VOID.probe);
          if (near) {
            if (near.kind !== 'terrain') t = mistFromDistance(near.distance);          // pegada a una superficie
            if (near.distance < VOID.probe && ctx.collision.castSegment) {
              // ¿encerrada? 6 rayos: dentro de un volumen casi todos golpean cerca (a cielo abierto, no)
              let h = 0;
              for (const d of DIRS) {
                _e.set(c.x + d[0] * VOID.ray, c.y + d[1] * VOID.ray, c.z + d[2] * VOID.ray);
                if (ctx.collision.castSegment(c, _e, 0)) h++;
              }
              t = Math.max(t, mistFromEnclosure(h));
            }
          }
        }
        target = t;
      }
      const k = target > mist ? 1 - Math.exp(-rdt / VOID.attack) : 1 - Math.exp(-rdt / VOID.release);
      mist += (target - mist) * k;
      if (mist < 0.002) mist = 0;
      WORLD_LOOK.uFvNear.value.z = mist;
      sky.setVoid(mist);
      return mist;
    },
    dispose() { WORLD_LOOK.uFvNear.value.set(0.3, 1.4, 0, 0); sky.setVoid(0); },
  };
}
