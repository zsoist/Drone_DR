// flightverse/gate-stats.js — estadísticas de carrera robustas (puro, sin DOM; testeable en Node).
// "vel máx" del resultado de Gate Rush salía de drone.vel.length(): si el arnés o un respawn teletransporta al dron, o la
// velocidad de la física no refleja el movimiento real, la cifra quedaba absurda (0.9 m/s en 414 m). Aquí la velocidad
// se calcula a partir de POSICIÓN y TIEMPO (ventana deslizante) y los teletransportes se ignoran.
export const TELEPORT_MPS = 90;          // un desplazamiento más rápido que esto en un paso no es vuelo (dron deportivo ~25 m/s)
export const SPEED_WINDOW_S = 0.25;      // promedio sobre 250 ms: sin picos de un solo frame

export function createSpeedTracker({ window: win = SPEED_WINDOW_S, teleport = TELEPORT_MPS } = {}) {
  let prev = null;                        // {x,y,z}
  let samples = [];                       // [{dt, d}] dentro de la ventana
  let winT = 0, winD = 0;
  const S = { top: 0, dist: 0, time: 0, teleports: 0 };
  return {
    reset() { prev = null; samples = []; winT = 0; winD = 0; S.top = 0; S.dist = 0; S.time = 0; S.teleports = 0; },
    /** dt en s, pos {x,y,z}. Devuelve la velocidad de ventana actual (m/s). */
    add(dt, pos) {
      if (!(dt > 0)) return winT > 0 ? winD / winT : 0;
      if (prev) {
        const d = Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
        if (d / dt > teleport) {          // salto: no cuenta como distancia ni como velocidad, y reinicia la ventana
          S.teleports += 1; samples = []; winT = 0; winD = 0;
        } else {
          samples.push({ dt, d }); winT += dt; winD += d; S.dist += d; S.time += dt;
          while (winT - samples[0].dt >= win) { const o = samples.shift(); winT -= o.dt; winD -= o.d; }
          if (winT >= Math.min(win, 0.1)) S.top = Math.max(S.top, winD / winT);
        }
      }
      prev = { x: pos.x, y: pos.y, z: pos.z };
      return winT > 0 ? winD / winT : 0;
    },
    get top() { return S.top; },
    get distance() { return S.dist; },
    get avg() { return S.time > 0 ? S.dist / S.time : 0; },
    get teleports() { return S.teleports; },
  };
}

/** Velocidad máxima mostrable: la medida por posición, nunca por debajo de la media ni ≥ teleport. */
export function topSpeedFor({ tracked = 0, avg = 0, reported = 0 } = {}) {
  const r = reported > 0 && reported < TELEPORT_MPS ? reported : 0;
  return Math.max(tracked, r, avg);
}

/** Cifras de velocidad del resultado: la máxima nunca queda por debajo de la media (distancia recorrida / tiempo). */
export function resultSpeeds({ topSpeed = 0, dist = 0, t = 0 } = {}) {
  const avg = t > 0 && dist > 0 ? dist / t : 0;
  return { avg, top: Math.max(topSpeed || 0, avg) };
}
