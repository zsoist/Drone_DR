// flightverse/modes/rules.js — reglas puras de modos (WS D): medallas, tiempos par,
// récords top-10, fantasma, validación del punto de partida. Sin THREE ni DOM:
// se prueban en node (pipeline/test_fv_modes.mjs).

export const MEDALS = Object.freeze(['bronze', 'silver', 'gold']);
export const MEDAL_LABEL = Object.freeze({ bronze: 'Bronce', silver: 'Plata', gold: 'Oro' });
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ── Gate Rush: par y medallas ───────────────────────────────────────────────
/** Velocidad objetivo (m/s) usada para el par cuando el JSON del mundo no trae uno. */
export const GR_PAR_SPEED = Object.freeze({ facil: 7, media: 9.5, dificil: 12 });
export const GR_PAR_PER_GATE_S = 0.35;      // margen por gate (giro/alineación)
export const GR_MISS_PENALTY_S = 0;         // los fallos no suman tiempo: bloquean el oro

export function courseLength(points) {
  let d = 0;
  for (let i = 1; i < (points?.length || 0); i++) {
    d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  }
  return d;
}

/** Par del circuito. worldPar = world.gaterush.par[difficulty] (segundos) si el JSON del mundo lo define. */
export function parTime({ pathLength = 0, gates = 0, difficulty = 'media', worldPar = null } = {}) {
  if (Number.isFinite(worldPar) && worldPar > 0) return worldPar;
  const v = GR_PAR_SPEED[difficulty] || GR_PAR_SPEED.media;
  return +(Math.max(8, pathLength / v + gates * GR_PAR_PER_GATE_S)).toFixed(1);
}

/** bronce = completar; plata = ≤ 1.25 × par; oro = ≤ par y 0 fallos. */
export function gateRushMedal({ time, par, misses = 0, finished = true }) {
  if (!finished || !Number.isFinite(time) || !(par > 0)) return null;
  if (time <= par && misses === 0) return 'gold';
  if (time <= par * 1.25) return 'silver';
  return 'bronze';
}
/** Tiempo que falta para el siguiente escalón (para el HUD/tarjeta). */
export function nextMedalTarget({ par, medal }) {
  if (medal === 'gold') return null;
  if (medal === 'silver') return { medal: 'gold', time: par };
  if (medal === 'bronze') return { medal: 'silver', time: +(par * 1.25).toFixed(2) };
  return { medal: 'bronze', time: null };
}
export function gateRushScore({ time, par, misses = 0 }) {
  if (!(time > 0) || !(par > 0)) return 0;
  return Math.max(0, Math.round(1000 * par / time) - misses * 50);
}
export function timeText(t) {
  if (!Number.isFinite(t)) return '--:--.-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
/** Ritmo frente al par en el gate i (proporcional): negativo = adelantado. */
export function paceDelta({ t, idx, total, par }) {
  if (!(idx > 0) || !(total > 0) || !(par > 0)) return 0;
  return +(t - par * (idx / total)).toFixed(2);
}

// ── Récords locales: top-10 por (mundo, modo, dificultad) ────────────────────
export const RECORDS_KEY = 'ab_fv_records';
export const TOP_N = 10;
export const recordListKey = (world, mode, difficulty) => `${world}|${mode}|${difficulty}`;

export function readRecords(storage) {
  try {
    const raw = JSON.parse(storage.getItem(RECORDS_KEY) || 'null');
    if (raw && raw.version === 1 && raw.lists && typeof raw.lists === 'object') return raw;
  } catch { /* almacenamiento bloqueado o corrupto */ }
  return { version: 1, lists: {} };
}
export function getTop(storage, world, mode, difficulty) {
  return [...(readRecords(storage).lists[recordListKey(world, mode, difficulty)] || [])];
}
/** Inserta y persiste. Devuelve {list, rank (1-based o null si no entra), isBest, prevBest}. */
export function addRecord(storage, { world, mode, difficulty, score, medal = null, time = null, date = null }) {
  const db = readRecords(storage);
  const k = recordListKey(world, mode, difficulty);
  const list = db.lists[k] || [];
  const prevBest = list.length ? list[0].score : null;
  const entry = { score: Math.round(finite(score)), date: date || new Date().toISOString().slice(0, 10), medal, ...(time != null ? { time: +time.toFixed(2) } : {}) };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const idx = list.indexOf(entry);
  const kept = list.slice(0, TOP_N);
  db.lists[k] = kept;
  try { storage.setItem(RECORDS_KEY, JSON.stringify(db)); } catch { /* cuota / privado */ }
  const rank = idx < TOP_N ? idx + 1 : null;
  return { list: kept, rank, isBest: rank === 1 && (prevBest == null || entry.score > prevBest), prevBest };
}
/** Mejor medalla conseguida en una lista. */
export function bestMedal(list) {
  let best = -1;
  for (const r of list || []) best = Math.max(best, MEDALS.indexOf(r.medal));
  return best < 0 ? null : MEDALS[best];
}

// ── Fantasma: mejor run a 20 Hz redondeada ───────────────────────────────────
export const GHOST_HZ = 20;
export const ghostKey = (world, difficulty, variant = '') => `ab_fv_ghost.${world}.${difficulty}${variant ? `.${variant}` : ''}`;
/** rec = [[x,y,z,yaw],...] a ~60 Hz → tira plana [x,y,z,yaw,...] a 20 Hz (x/y/z 0.05 m, yaw 0.01). */
export function encodeGhost(rec, srcHz = 60) {
  const stride = Math.max(1, Math.round(srcHz / GHOST_HZ));
  const out = [];
  for (let i = 0; i < rec.length; i += stride) {
    const r = rec[i];
    out.push(Math.round(r[0] * 20) / 20, Math.round(r[1] * 20) / 20, Math.round(r[2] * 20) / 20, Math.round(r[3] * 100) / 100);
  }
  return { hz: GHOST_HZ, n: out.length / 4, f: out };
}
export function ghostPoseAt(ghost, t) {
  if (!ghost?.f?.length) return null;
  const n = ghost.f.length / 4;
  const u = Math.max(0, t) * ghost.hz;
  const i = Math.min(n - 1, Math.floor(u)), j = Math.min(n - 1, i + 1), k = Math.min(1, u - i);
  const a = i * 4, b = j * 4, f = ghost.f;
  let dy = f[b + 3] - f[a + 3];
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return {
    x: f[a] + (f[b] - f[a]) * k, y: f[a + 1] + (f[b + 1] - f[a + 1]) * k,
    z: f[a + 2] + (f[b + 2] - f[a + 2]) * k, yaw: f[a + 3] + dy * k,
    done: u >= n - 1,
  };
}
export function saveGhostIfBest(storage, key, ghost, time) {
  let prev = null;
  try { prev = JSON.parse(storage.getItem(key) || 'null'); } catch { /* ignore */ }
  if (prev && Number.isFinite(prev.time) && prev.time <= time) return false;
  try { storage.setItem(key, JSON.stringify({ time: +time.toFixed(2), ...ghost })); return true; } catch { return false; }
}
export function loadGhost(storage, key) {
  try {
    const g = JSON.parse(storage.getItem(key) || 'null');
    return g && Array.isArray(g.f) && g.f.length >= 8 && Number.isFinite(g.hz) ? g : null;
  } catch { return null; }
}

// ── Punto de partida de Gate Rush (spec §8: ≥ 12 m de cualquier muro) ────────
export const START_CLEARANCE_M = 12;
/**
 * approach = punto nominal (16 m antes del gate 0, en su eje). Busca el primer punto libre
 * deslizando hacia atrás por el eje, luego subiendo, luego lateral. clearAt(p) → bool
 * (nada sólido a < 12 m) y rayClear(p, dir) → bool (30 m de frente libres: ni muro ni árbol).
 * Devuelve {point, moved, attempts, ok}. Si nada es válido: ok=false y el punto más alto probado.
 */
export function findClearStart({ approach, axis, up = { x: 0, y: 1, z: 0 }, clearAt, rayClear, maxAttempts = 40 }) {
  const side = { x: -axis.z, y: 0, z: axis.x };
  const cands = [{ d: 0, h: 0, s: 0 }];
  for (const h of [0, 6, 12, 20]) for (const d of [0, 10, 20, 35, 50, 70]) for (const s of [0, 8, -8, 16, -16]) {
    if (h || d || s) cands.push({ d, h, s });
  }
  let attempts = 0, last = approach;
  for (const c of cands) {
    if (attempts >= maxAttempts) break;
    const p = {
      x: approach.x - axis.x * c.d + side.x * c.s + up.x * c.h,
      y: approach.y - axis.y * c.d + up.y * c.h,
      z: approach.z - axis.z * c.d + side.z * c.s + up.z * c.h,
    };
    attempts++; last = p;
    if (clearAt(p) && rayClear(p, axis)) return { point: p, moved: c.d || c.h || c.s ? true : false, attempts, ok: true };
  }
  return { point: last, moved: true, attempts, ok: false };
}

// ── Onboarding de 20 s (spec §8): lógica de pasos; la UI (A) dibuja los coach marks ──
export const ONBOARD_KEY = 'ab_fv_onboarded';
export const ONBOARD_STEPS = Object.freeze([
  { id: 'tap', from: 0, to: 3, copy: 'Toca para empezar' },
  { id: 'takeoff', from: 3, to: 8, copy: 'Arrastra para volar' },
  { id: 'gate', from: 8, to: 14, copy: 'Cruza el aro azul' },
  { id: 'shoot', from: 14, to: 20, copy: 'Toca para disparar' },
]);
export function onboardStepAt(t) {
  return ONBOARD_STEPS.find(s => t >= s.from && t < s.to) || ONBOARD_STEPS[ONBOARD_STEPS.length - 1];
}

// ── Gate Rush: saneamiento del circuito (v2) ─────────────────────────────────
/**
 * Un track GPS real puede rozar el borde jugable (el dron rebota y el gate nunca se cruza) o pasar
 * pegado a la malla. Por gate: (1) si el borde lo recorta, se desplaza hacia dentro con la traslación
 * de boundaryClamp(p, r); (2) si hay estructura a < 0.9·R, sube en pasos de 4 m hasta 24 m; si sigue
 * bloqueado se descarta. nearest(p) → distancia a estructura o Infinity; clampFn(p, r) → {x,y,z}|null.
 */
export function sanitizeGateCenters(centers, { radius, nearest = () => Infinity, clampFn = () => null, margin = 6 }) {
  const out = [], report = { shifted: 0, raised: 0, dropped: 0 };
  for (const c of centers) {
    let p = { x: c.x, y: c.y, z: c.z };
    for (let i = 0; i < 3; i++) {                        // el desplazamiento puede empujar contra otro lado
      const t = clampFn(p, radius + margin);
      if (!t || (Math.abs(t.x) + Math.abs(t.y) + Math.abs(t.z)) < 1e-3) break;
      p = { x: p.x + t.x * 1.15, y: p.y + t.y * 1.15, z: p.z + t.z * 1.15 };
      if (i === 0) report.shifted++;
    }
    let ok = nearest(p) >= radius * 0.9;
    for (let up = 4; !ok && up <= 24; up += 4) {
      const q = { x: p.x, y: p.y + up, z: p.z };
      if (nearest(q) >= radius * 0.9) { p = q; ok = true; report.raised++; }
    }
    if (ok) out.push(p); else report.dropped++;
  }
  return { centers: out, report };
}
