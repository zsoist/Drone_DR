// flightverse/modes/events.js — fachada de eventos de modos (WS D).
// Desde la pasada de integración TODOS los eventos viajan por el bus compartido (BUS_EVENTS los registra);
// `on` es bus.on. Aquí solo quedan los contadores de diagnóstico: report.modeEvents = {counts, forwarded, tail}.

export function createModeEvents(bus, report) {
  const tail = [];
  const counts = {};
  const forwarded = {};
  const on = (type, fn) => bus.on(type, fn);
  function emit(type, detail = {}) {
    counts[type] = (counts[type] || 0) + 1;
    if (type !== 'markers') {                       // markers es de alta frecuencia: no ensucia la cola
      tail.push({ type, at: +(performance.now() / 1000).toFixed(2), detail: summarize(detail) });
      if (tail.length > 40) tail.shift();
    }
    forwarded[type] = (forwarded[type] || 0) + 1;
    bus.emit(type, detail);
  }
  function summarize(d) {
    const out = {};
    for (const [k, v] of Object.entries(d || {})) {
      if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
      else if (Array.isArray(v)) out[k] = v.length > 6 ? `[${v.length}]` : v;
      else if (typeof v === 'object' && 'x' in v && 'z' in v) out[k] = `(${(+v.x).toFixed(1)},${(+v.y || 0).toFixed(1)},${(+v.z).toFixed(1)})`;
    }
    return out;
  }
  if (report) Object.defineProperty(report, 'modeEvents', { enumerable: false, configurable: true, get: () => ({ counts, forwarded, tail }) });
  return { on, emit, counts, tail };
}
