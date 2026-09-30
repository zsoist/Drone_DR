// flightverse/tour/render-guard.js — aislamiento del tamaño de render durante una exportación
// determinista (Director HD) o una grabación (WS E).
// Problema: durante el export el canvas está a 1920x1080 @1x; un `resize` del navegador, el
// gobernador de calidad (applyDpr) o el ajuste de aspecto del render cambiaban setSize/DPR/aspect a
// mitad de export -> frames corruptos o mezcla de resoluciones. Mientras dura el bloqueo los
// setters se ignoran (se recuerda el último pedido) y el aspecto se fuerza al del export; al
// soltar se restaura el estado original y se aplica el ÚLTIMO tamaño pedido por la app.
//
// IMPORTANTE (incidente prod 2026-09-30): en three.js WebGLRenderer define setSize/setPixelRatio como
// propiedades PROPIAS del instancia (this.setSize = function…), no en el prototipo. Un `delete` las
// borraba para siempre -> "renderer.setPixelRatio is not a function". `shadow()` guarda el valor
// original (propio o heredado) y `unshadow()` lo restaura exactamente; nunca deja un método indefinido.

/** Sombrea obj[key] con `fn`; devuelve la función que restaura el estado previo exacto. */
export function shadow(obj, key, fn) {
  const own = Object.prototype.hasOwnProperty.call(obj, key);
  const prev = obj[key];
  obj[key] = fn;
  return () => {
    if (own) obj[key] = prev; else delete obj[key];
    if (typeof obj[key] !== 'function') obj[key] = prev;          // red de seguridad
  };
}

export function lockRenderSize(ctx, { width = 1920, height = 1080 } = {}) {
  const { renderer, composer, camera } = ctx;
  const orig = {
    setSize: renderer.setSize.bind(renderer),
    setPixelRatio: renderer.setPixelRatio.bind(renderer),
    cSetSize: composer.setSize.bind(composer),
    upd: camera.updateProjectionMatrix.bind(camera),
  };
  const before = { dpr: renderer.getPixelRatio(), aspect: camera.aspect };
  const pending = { size: null, dpr: null, composer: null, blocked: 0 };
  const aspect = width / height;
  orig.setPixelRatio(1);
  orig.setSize(width, height, false);
  orig.cSetSize(width, height);
  camera.aspect = aspect; orig.upd();
  const undo = [
    shadow(renderer, 'setPixelRatio', d => { pending.dpr = d; pending.blocked++; }),
    shadow(renderer, 'setSize', (w, h, u) => { pending.size = [w, h, u]; pending.blocked++; }),
    shadow(composer, 'setSize', (w, h) => { pending.composer = [w, h]; pending.blocked++; }),
    shadow(camera, 'updateProjectionMatrix', () => { camera.aspect = aspect; orig.upd(); }),
  ];
  ctx.state.exporting = true;
  let released = false;
  return {
    pending,
    /** Suelta el bloqueo: restaura los métodos y deja el render al tamaño actual de la ventana. */
    release() {
      if (released) return;
      released = true;
      for (const u of undo.reverse()) { try { u(); } catch { /* restaurar el resto */ } }
      ctx.state.exporting = false;
      try {
        renderer.setPixelRatio(pending.dpr ?? before.dpr);
        const sz = pending.size || [innerWidth, innerHeight];
        renderer.setSize(sz[0], sz[1]);
        const cz = pending.composer || [innerWidth, innerHeight];
        composer.setSize(cz[0], cz[1]);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
      } catch (e) { console.warn('[render-guard] restauración parcial:', e?.message || e); }
    },
  };
}

/**
 * Congela el DPR del renderer mientras dura una grabación (Quick Record): un cambio de DPR del
 * gobernador a mitad de captura cambiaría la resolución del stream (WebM corrupto / saltos).
 * Se recuerda el último pedido y se aplica al soltar. Sólo se usa con ?fv=2.
 */
export function freezePixelRatio(ctx) {
  const { renderer, composer } = ctx;
  const pending = { dpr: null, blocked: 0 };
  const undo = shadow(renderer, 'setPixelRatio', d => { pending.dpr = d; pending.blocked++; });
  let released = false;
  return {
    pending,
    release() {
      if (released) return;
      released = true;
      undo();
      if (pending.dpr != null) {
        try {
          renderer.setPixelRatio(pending.dpr);
          renderer.setSize(innerWidth, innerHeight);
          composer?.setSize(innerWidth, innerHeight);
        } catch (e) { console.warn('[render-guard] DPR diferido:', e?.message || e); }
      }
    },
  };
}
