// flightverse/tour/cinematic.js — cámaras de presentación (WS E): swoop de llegada
// (de vista-mapa al rig chase) y tour orbital del modo Cinematico.
import { reducedMotion } from '/flightverse/vegetation.js?v=367';

export function createCinematic(ctx) {
  const { THREE, camera, W, AT } = ctx;
  const $ = ctx.$;
  const cine = { v: 0.14, a: 0.24 };
  $('#cine-v').addEventListener('input', e => { cine.v = +e.target.value; });
  $('#cine-a').addEventListener('input', e => { cine.a = +e.target.value; });
  // cinemático: tour orbital sobre el centro de la escena
  let tourT = 0;
  const diag = Math.hypot(...W.size_m);
  // llegada cinematográfica: swoop desde vista de mapa hacia el rig (skip en autotest)
  let arrival = AT || reducedMotion() ? null : { t: 0, dur: 3.4 };

  return {
    cine, diag,
    get arrivalActive() { return !!arrival; },
    /** Swoop de entrada (easeOutCubic). o = pose interpolada del dron, P = posición. */
    stepArrival(o, rdt) {
      const P = ctx.P;
      // swoop de entrada: de vista-mapa al rig chase, easeOutCubic
      arrival.t += rdt;
      const k = Math.min(1, arrival.t / arrival.dur);
      const e = 1 - Math.pow(1 - k, 3);
      const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)).multiplyScalar(14);
      const want = P.clone().add(back).add(new THREE.Vector3(0, 6, 0));
      const hi = P.clone().add(new THREE.Vector3(diag * 0.25, diag * 0.55, diag * 0.35));
      camera.position.lerpVectors(hi, want, e);
      camera.lookAt(P);
      if (k >= 1) arrival = null;
    },
    /** Tour orbital (modo cinematico). */
    stepOrbit(rdt) {
      tourT += rdt * 0.5 * cine.v;          // 0.5 = velocidad que ya veía el usuario a 60 fps
      const r = diag * 0.3;                        // más cerca (pedido)
      camera.position.set(Math.cos(tourT) * r, diag * cine.a, Math.sin(tourT) * r);
      camera.lookAt(0, (W.elev_max - W.elev_min) * 0.4, 0);
    },
  };
}
