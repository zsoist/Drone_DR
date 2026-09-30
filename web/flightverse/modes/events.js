// flightverse/modes/events.js — emisor de eventos de modos (WS D).
// Reenvía al bus compartido SOLO los eventos que ya existen en BUS_EVENTS (el bus avisa con
// console.warn ante un tipo desconocido); el resto queda disponible en ctx.enemies.events.on(...)
// y en report.modeEvents hasta que A registre los tipos nuevos en bus.js (ver lista en modes/index.js).
import { BUS_EVENTS } from '/flightverse/bus.js?v=368';

export function createModeEvents(bus, report) {
  const handlers = new Map();
  const tail = [];
  const counts = {};
  const forwarded = {};
  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  }
  function emit(type, detail = {}) {
    counts[type] = (counts[type] || 0) + 1;
    if (type !== 'markers') {                       // markers es de alta frecuencia: no ensucia la cola
      tail.push({ type, at: +(performance.now() / 1000).toFixed(2), detail: summarize(detail) });
      if (tail.length > 40) tail.shift();
    }
    for (const fn of [...(handlers.get(type) || [])]) {
      try { fn(detail); } catch (error) { console.error(`[modes] handler "${type}":`, error); }
    }
    if (Object.hasOwn(BUS_EVENTS, type)) {
      forwarded[type] = (forwarded[type] || 0) + 1;
      bus.emit(type, detail);
    }
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
