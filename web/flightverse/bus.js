// flightverse/bus.js — bus de eventos tipado y mínimo (sin dependencias).
// Contrato entre workstreams (docs/FLIGHTVERSE_DESIGN_SPEC.md §15.1): los módulos
// NO se importan entre sí para reaccionar; emiten/escuchan eventos del bus.
//
//   const bus = createBus();
//   const off = bus.on('hit', ({ target, weapon, damage, kill }) => { ... });
//   bus.emit('hit', { target, weapon: 'mg', damage: 12, kill: false });
//   off();
//
// Un handler que lanza NO rompe al emisor ni a los demás handlers: el error se
// registra (console.error) y se cuenta en bus.stats().errors.

/** Eventos válidos y los campos del payload (documentales; `validate` avisa si faltan). */
export const BUS_EVENTS = Object.freeze({
  fire:    ['weapon', 'origin', 'dir'],
  hit:     ['target', 'weapon', 'damage', 'kill'],
  explode: ['pos', 'size'],
  damage:  ['amount', 'dir', 'source'],
  crash:   ['energyClass'],
  respawn: [],
  lock:    ['target', 'state'],
  wave:    ['n'],
  gate:    ['i', 'n'],
  mode:    ['key'],
  pause:   [],          // A0 añade { active } (opcional) al payload
  tod:     ['key', 'elev'],         // E: preset + elevación solar en grados (A añade elev en los chips)
  prefs:   ['key', 'value'],   // A: preferencia del jugador cambiada (ui/prefs.js)
  medal:   ['id', 'level'],    // A: medalla concedida (ui/records.js)
  onboarding: ['completed'],   // A: primer vuelo terminado/omitido
  // ── integración (handoffs de B/D/E): antes vivían en emisores locales (ctx.tour.events / ctx.enemies.events) ──
  tour:    ['state', 'index', 'n', 'poi'],   // E: state start|poi|loop|stop
  photo:   ['active'],                        // E: modo foto (active, captured?, bytes?)
  edge:    ['warn'],                          // E: borde del mundo (warn, s, fog, dist, m)
  kill:    ['target', 'weapon'],              // B: hit con kill:true reenviado
  overheat: ['weapon'],                       // B: {weapon,cleared?} (arma sobrecalentada / enfriada, weapon:null + cleared)
  unlock:  [],                                // B: audio desbloqueado por el primer gesto
  telegraph: ['type'],                        // D: aviso previo de un disparo enemigo (id,type,kind,dur,dir,pos,dist)
  score:   ['score', 'gained'],               // D: Invasión (combo, reason)
  life:    ['lives'],                         // D: vida perdida / reaparición (hp, invulnerableS)
  victory: ['wave', 'score'],                 // D: Invasión completada
  defeat:  ['wave', 'score'],                 // D: Invasión perdida
  record:  ['mode', 'rank'],                  // D: récord local guardado
  markers: ['markers'],                       // D: marcadores de pantalla de enemigos (~10 Hz: markers, edges, boss)
  'game-mode': ['key', 'phase'],              // D: select|start|go
  warn:    ['kind'],                          // D: lowhp|move
  pack:    ['phase'],                         // D: spawn|pickup de botiquín
  reposition: ['pos'],                        // D: reposicionar al dron
  onboard: ['step'],                          // D: pasos del primer vuelo
  'damage-blocked': ['reason'],               // D: daño ignorado (invulnerable, ya contado por física…)
  'gr-miss': ['kind'],                        // D: Gate Rush: fallo (crash)
  'gr-penalty': ['seconds'],                  // D: Gate Rush: penalización de tiempo (+3 s por respawn)
});

export function createBus({ validate = false, strict = false } = {}) {
  const handlers = new Map();          // type -> Set<fn>
  const warned = new Set();
  const stats = { emitted: 0, errors: 0 };

  function known(type) {
    if (Object.prototype.hasOwnProperty.call(BUS_EVENTS, type)) return true;
    if (strict) throw new Error(`bus: evento desconocido "${type}"`);
    if (!warned.has(type)) { warned.add(type); console.warn(`[bus] evento desconocido: ${type}`); }
    return false;
  }

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on: handler debe ser función');
    known(type);
    let set = handlers.get(type);
    if (!set) handlers.set(type, set = new Set());
    set.add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const set = handlers.get(type);
    if (!set) return false;
    const removed = set.delete(fn);
    if (!set.size) handlers.delete(type);
    return removed;
  }

  function once(type, fn) {
    const remove = on(type, detail => { remove(); return fn(detail); });
    return remove;
  }

  function emit(type, detail = {}) {
    known(type);
    stats.emitted += 1;
    if (validate && BUS_EVENTS[type]) {
      for (const key of BUS_EVENTS[type]) {
        if (!(key in detail)) console.warn(`[bus] "${type}" sin campo "${key}"`);
      }
    }
    const set = handlers.get(type);
    if (!set) return 0;
    let n = 0;
    for (const fn of [...set]) {        // copia: un handler puede darse de baja
      try { fn(detail); n += 1; } catch (error) {
        stats.errors += 1;
        console.error(`[bus] handler de "${type}" falló:`, error);
      }
    }
    return n;
  }

  function clear(type) {
    if (type) handlers.delete(type); else handlers.clear();
  }

  return {
    on, off, once, emit, clear,
    count: type => handlers.get(type)?.size || 0,
    stats: () => ({ ...stats }),
  };
}
