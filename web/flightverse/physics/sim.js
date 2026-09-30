// flightverse/physics/sim.js — Physics v2 game-side simulation (WS C).
//
// Glues quad.js + wind.js + aero.js + contact.js to a world that exposes the
// world-collision.js contract (castSegment / sweepSphere / recoverSphere /
// groundHeight). Pure JS, NO three.js, NO DOM: node can drive it with a
// synthetic world (pipeline/test_physics_integration.mjs) and the browser
// drives it from runtime.js at the fixed 120 Hz step.
//
// Responsibilities
//   * stick mapping -> quad command (+ profile, boost, brake, yaw pending)
//   * 30 Hz environment probe (ground / ceiling / wall) via ray adapters
//   * wind field (presets, urban shelter through world.groundHeight)
//   * collision: the game's own sweep/recover pipeline (radii unchanged, no
//     tunnelling) decides WHERE the drone may be; contact.js decides HOW it
//     reacts (impulse, energy class, damage)
//   * crash -> motors cut -> tumble -> respawn (< 1 s) from last-safe snapshots
//     with 1.5-2 s invulnerability
//   * vegetation soft drag (optional injected density function)
import { makeParams, setProfile, PROFILES, WIND_PRESETS, densityRatio } from './params.js';
import {
  createQuad, createCmd, stepQuad, setYaw, copyQuad, MODE_VEL,
} from './quad.js';
import { createEnv, probeEnvironment } from './aero.js';
import { createWind, sampleWind } from './wind.js';
import {
  resolveContact, createContactOut, vegetationDrag, createSafeSnapshot, restoreSafe, recordSafe,
  CLS_NONE, CLS_SCRAPE, CLS_WOBBLE, CLS_PROP, CLS_CRASH,
  KIND_CONCRETE, KIND_TERRAIN,
} from './contact.js';

export { CLS_NONE, CLS_SCRAPE, CLS_WOBBLE, CLS_PROP, CLS_CRASH };

export const CLASS_NAMES = Object.freeze(['none', 'bounce', 'wobble', 'prop', 'crash']);
export const MIN_AGL = 1.2;
export const DEFAULT_RADII = Object.freeze({ structure: 0.59, terrain: MIN_AGL, boundary: 0.59 });
export const PROBE_EVERY = 4;                 // 120 Hz / 4 = 30 Hz
export const RESPAWN_DELAY = 0.9;             // crash -> drone back at the snapshot (< 1 s)
export const WRECK_CAM_TIME = 0.8;            // crash camera on the wreck
export const INVULN_TIME = 1.75;              // 1.5-2 s after respawn
const WIND_PROFILE_CAP = 60;                  // m AGL where the wind power law stops growing
const DAMAGE_COOLDOWN = 0.3;                  // s: repeated touches of one scrape cost damage once
const SAFE_RING = 12;
const SAFE_EVERY = 60;                        // steps between snapshot attempts (0.5 s)
const BOOST_TILT = 1.3, BOOST_SPEED = 1.35;   // profile tilt / stick-speed multiplier at full boost
const MAX_TILT_RAD = 48 * Math.PI / 180;

/** Sky preset -> default wind preset (the pause-menu selector overrides it). */
export const SKY_WIND = Object.freeze({ dia: 'breezy', atardecer: 'breezy', noche: 'calm' });
/** Flight profile for the game context (spec 11). */
export function profileForContext({ userProfile = null, grDifficulty = null, invasion = false } = {}) {
  if (userProfile && PROFILES[userProfile]) return userProfile;
  if (invasion || grDifficulty === 'dificil') return 'sport';
  return 'normal';
}
export function windForContext({ userWind = null, sky = 'dia', sport = false } = {}) {
  if (userWind && WIND_PRESETS[userWind]) return userWind;
  if (sport) return 'gusty';
  return SKY_WIND[sky] || 'breezy';
}

const clamp = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));

/**
 * opts: { world, altM, seed, profile, windPreset, windDirRad, radii, bodyScale, battery,
 *         spawn:{x,y,z,yaw}, vegetation:{densityAt(x,y,z)}, terrain:'urban'|'open',
 *         hooks:{ onImpact(ev), onCrash(ev), onRespawn(ev), onDamage(ev) } }
 */
export function createSim(opts = {}) {
  const world = opts.world || null;
  const radii = Object.assign({}, DEFAULT_RADII, opts.radii || {});
  const P = makeParams({
    bodyScale: opts.bodyScale ?? 2.0,
    battery: opts.battery ?? 1,
    profile: opts.profile || 'normal',
  }, opts.altM ?? 0);
  const s = createQuad(P, opts.seed ?? 1);
  const cmd = createCmd();
  const env = createEnv();
  const windOut = new Float64Array(3);
  const heightAt = world?.groundHeight
    ? (x, z) => { const h = world.groundHeight(x, z); return h == null || !Number.isFinite(h) ? -1e3 : h; }
    : null;
  const wind = createWind({
    seed: (opts.seed ?? 1) * 7 + 3,
    preset: opts.windPreset || 'breezy',
    dirRad: opts.windDirRad ?? 2.75,
    terrain: opts.terrain || 'urban',
    heightAt,
  });
  // Game-scale wind: the physical presets (0.5 / 4 / 7 m/s at 6 m) are halved so that "Brisa" is
  // flyable upwind at 100 m; the power-law profile saturates at WIND_PROFILE_CAP metres.
  const windGain = opts.windGain ?? 0.5;
  wind.w20 *= windGain;
  const cOut = createContactOut();
  const hooks = opts.hooks || {};
  const veg = opts.vegetation || null;

  const sim = {
    P, s, cmd, env, wind, radii, world,
    cOut,
    // derived, refreshed every step (plain numbers, JSON friendly)
    att: { roll: 0, pitch: 0, yaw: 0, tilt: 0 },
    windInfo: { x: 0, y: 0, z: 0, speed: 0, gust: 0, preset: opts.windPreset || 'breezy', shelter: 0, fromDeg: 0 },
    speed: 0, hspeed: 0,
    profile: P.profile,
    boostK: 0,
    agl: null,                 // true height of the drone centre above the ground (m) or null
    invuln: 0,
    crash: { active: false, t: 0, count: 0, x: 0, y: 0, z: 0, skip: false },
    lastImpact: { cls: CLS_NONE, name: 'none', energy: 0, vn: 0, t: -1e9, nx: 0, ny: 1, nz: 0, kind: 0 },
    vegDensity: 0,
    stats: {
      steps: 0, contacts: 0, bumps: 0, crashes: 0, respawns: 0, nonFinite: 0,
      collisionFailures: 0, embedded: 0, probes: 0, lastSafeAge: 0,
    },
    t: 0,
  };

  // ---- profile base values (boost scales these without drift) -------------------
  const base = { tanTilt: P.tanTilt, tiltMax: P.tiltMax, vmax: P.vmax, vzUp: P.vzUp, vzDown: P.vzDown, kv: P.kv };
  const captureBase = () => {
    base.tanTilt = P.tanTilt; base.tiltMax = P.tiltMax; base.vmax = P.vmax;
    base.vzUp = P.vzUp; base.vzDown = P.vzDown; base.kv = P.kv;
  };
  sim.setProfile = (name) => {
    if (!PROFILES[name]) name = 'normal';
    setProfile(P, name);
    captureBase();
    sim.profile = P.profile;
    return sim.profile;
  };
  sim.setWindPreset = (name) => {
    const pr = WIND_PRESETS[name];
    if (!pr) return sim.windInfo.preset;
    wind.w20 = pr.w20 * windGain; wind.sigmaMul = pr.sigmaMul;
    sim.windInfo.preset = name;
    return name;
  };

  // ---- spawn / reseed -------------------------------------------------------------
  const spawn = opts.spawn || { x: 0, y: 60, z: 0, yaw: 0 };
  sim.reseed = (x, y, z, yaw, vx = 0, vy = 0, vz = 0) => {
    s.p[0] = x; s.p[1] = y; s.p[2] = z;
    s.v[0] = vx; s.v[1] = vy; s.v[2] = vz;
    s.w.fill(0); s.iv.fill(0); s.vcf.fill(0);
    setYaw(s, yaw);
    s.m.fill(P.hoverW);
    s.cut = 0; s.dmg.fill(0);
    sim.crash.active = false; sim.crash.t = 0; sim.crash.skip = false;
    pend.yaw = 0;
    headingPrev = yaw;
    sim.updateDerived();
  };

  // ---- ray adapter over the world contract ---------------------------------------
  const RA = { x: 0, y: 0, z: 0 }, RB = { x: 0, y: 0, z: 0 };
  let rayKind = '';
  const rayDist = (ox, oy, oz, dx, dy, dz, maxD) => {
    if (dy < -0.5) rayKind = '';
    if (!world?.castSegment) return Infinity;
    RA.x = ox; RA.y = oy; RA.z = oz;
    RB.x = ox + dx * maxD; RB.y = oy + dy * maxD; RB.z = oz + dz * maxD;
    let hit = null;
    try { hit = world.castSegment(RA, RB, 0); } catch { hit = null; }
    if (!hit || !Number.isFinite(hit.fraction)) return Infinity;
    if (dy < -0.5) rayKind = hit.kind || '';
    return hit.fraction * maxD;
  };
  sim.rayDist = rayDist;

  // ---- derived attitude ------------------------------------------------------------
  let headingPrev = spawn.yaw || 0;
  sim.updateDerived = () => {
    const q = s.q;
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const r2 = 2 * (x * z + w * y), r8 = 1 - 2 * (x * x + y * y);   // forward = (-r2, ., -r8)
    const r3 = 2 * (x * y + w * z), r4 = 1 - 2 * (x * x + z * z), r5 = 2 * (y * z - w * x);
    const hl = Math.hypot(r2, r8);
    const a = sim.att;
    if (hl > 0.2) a.yaw = Math.atan2(r2, r8);
    a.pitch = Math.asin(clamp(-r5, -1, 1));
    a.roll = Math.atan2(-r3, r4);
    a.tilt = s.tilt;
    sim.speed = Math.hypot(s.v[0], s.v[1], s.v[2]);
    sim.hspeed = Math.hypot(s.v[0], s.v[2]);
  };

  // ---- input -> command ---------------------------------------------------------------
  const pend = { yaw: 0 };                  // pending heading change (rad, + = turn left like the legacy yaw)
  /** Queue a heading change (mouse / look zone). + = left. */
  sim.addYaw = (rad) => { pend.yaw = clamp(pend.yaw + rad, -1.4, 1.4); };

  function mapInput(inp, dt) {
    cmd.mode = MODE_VEL;
    const brake = !!inp.brake;
    cmd.fwd = brake ? 0 : clamp(inp.fwd || 0, -1, 1);
    cmd.right = brake ? 0 : clamp(inp.strafe ?? inp.right ?? 0, -1, 1);
    cmd.climb = clamp(inp.lift ?? inp.climb ?? 0, -1, 1);
    // heading: stick yaw (+ = left in the legacy convention) plus pending look yaw as a rate
    let yawRate = clamp(inp.yaw || 0, -1, 1) * P.yawRateMax;             // rad/s, + left
    if (pend.yaw !== 0) {
      const want = clamp(pend.yaw / 0.06, -P.yawRateMax * 1.6, P.yawRateMax * 1.6);
      yawRate += want;
    }
    cmd.yaw = clamp(-yawRate / P.yawRateMax, -1.6, 1.6);                 // quad: + = turn right
    // boost: more tilt + more stick speed, smoothed
    const bt = inp.boost ? 1 : 0;
    sim.boostK += (bt - sim.boostK) * (1 - Math.exp(-dt / 0.25));
    const k = sim.boostK;
    let tilt = base.tiltMax * (1 + (BOOST_TILT - 1) * k);
    if (tilt > MAX_TILT_RAD) tilt = MAX_TILT_RAD;
    P.tiltMax = tilt; P.tanTilt = Math.tan(tilt);
    P.vmax = base.vmax * (1 + (BOOST_SPEED - 1) * k);
    P.vzUp = base.vzUp * (1 + 0.4 * k);
    P.kv = brake ? base.kv * 1.8 : base.kv;
    if (brake) { s.vcf[0] = 0; s.vcf[2] = 0; }
  }

  // ---- environment (30 Hz) ----------------------------------------------------------------
  let aglForWind = 30;
  function refreshEnvironment() {
    sim.stats.probes += 1;
    const px = s.p[0], py = s.p[1], pz = s.p[2];
    // true height above the ground (DSM) for wind profile + HUD
    const g = world?.groundHeight ? world.groundHeight(px, pz) : null;
    sim.agl = g == null || !Number.isFinite(g) ? null : py - g;
    aglForWind = sim.agl == null ? 30 : Math.min(sim.agl, WIND_PROFILE_CAP);
    if (world?.castSegment) {
      probeEnvironment(rayDist, px, py, pz, P.rEff, env);
      // ray distances start at the centre; the collision shell already keeps the
      // rotor plane radius - 0.15 m away from the surface.
      const off = radii.structure - 0.15;
      const offG = (rayKind === 'terrain' ? radii.terrain : radii.structure) - 0.15;
      if (env.agl < 1e6) env.agl = Math.max(0.05, env.agl - offG);
      if (env.ceil < 1e6) env.ceil = Math.max(0.05, env.ceil - off);
      if (env.wallDist < 1e6) env.wallDist = Math.max(0.05, env.wallDist - off);
    } else {
      env.agl = sim.agl == null ? Infinity : Math.max(0.05, sim.agl - 1.05);
      env.ceil = Infinity; env.wallDist = Infinity;
    }
    if (veg) {
      const target = veg.densityAt(px, py, pz) || 0;
      sim.vegDensity += (target - sim.vegDensity) * 0.35;
    }
  }

  // ---- collision (sweep / recover, plus contact responses) -----------------------------------
  const CT = { n: 0, nx: new Float64Array(4), ny: new Float64Array(4), nz: new Float64Array(4), kind: new Uint8Array(4),
    px: new Float64Array(4), py: new Float64Array(4), pz: new Float64Array(4) };
  const cur = { x: 0, y: 0, z: 0 }, nxt = { x: 0, y: 0, z: 0 };
  const hitObj = { nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, kind: KIND_CONCRETE };
  const kindOf = (h) => (h.kind === 'terrain' ? KIND_TERRAIN : KIND_CONCRETE);

  function addContact(nx, ny, nz, kind, px, py, pz) {
    if (CT.n >= 4) return;
    const l = Math.hypot(nx, ny, nz) || 1;
    const i = CT.n++;
    CT.nx[i] = nx / l; CT.ny[i] = ny / l; CT.nz[i] = nz / l; CT.kind[i] = kind;
    CT.px[i] = px; CT.py[i] = py; CT.pz[i] = pz;
  }

  /** Move from (sx,sy,sz) towards (dx,dy,dz) through the world. Writes the legal centre
   *  to s.p, fills CT. Returns false if the world query failed (position reverted). */
  function constrain(sx, sy, sz, dx, dy, dz) {
    CT.n = 0;
    if (!world?.sweepSphere) { s.p[0] = dx; s.p[1] = dy; s.p[2] = dz; return true; }
    try {
      cur.x = sx; cur.y = sy; cur.z = sz;
      const rec = world.recoverSphere ? world.recoverSphere(cur, radii) : null;
      if (rec?.translation) {
        cur.x += rec.translation.x; cur.y += rec.translation.y; cur.z += rec.translation.z;
        addContact(rec.normal.x, rec.normal.y, rec.normal.z, kindOf(rec), cur.x, cur.y, cur.z);
        sim.stats.embedded += 1;
      } else {
        const emb = world.sweepSphere(cur, cur, radii);
        if (emb && emb.fraction === 0) {
          const nl = Math.hypot(emb.normal.x, emb.normal.y, emb.normal.z) || 1;
          const nx = emb.normal.x / nl, ny = emb.normal.y / nl, nz = emb.normal.z / nl;
          if (emb.kind === 'terrain' || emb.kind === 'boundary') {
            cur.x = emb.point.x + nx * 0.003; cur.y = emb.point.y + ny * 0.003; cur.z = emb.point.z + nz * 0.003;
          } else {
            const pen = Math.max(0.003, radii.structure - (Number(emb.distance) || 0) + 0.003);
            cur.x += nx * pen; cur.y += ny * pen; cur.z += nz * pen;
          }
          addContact(nx, ny, nz, kindOf(emb), cur.x, cur.y, cur.z);
          sim.stats.embedded += 1;
        }
      }
      let rx = dx - sx, ry = dy - sy, rz = dz - sz;
      for (let c = 0; c < 3; c++) {
        if (rx * rx + ry * ry + rz * rz <= 1e-10) break;
        nxt.x = cur.x + rx; nxt.y = cur.y + ry; nxt.z = cur.z + rz;
        const hit = world.sweepSphere(cur, nxt, radii);
        if (!hit) { cur.x = nxt.x; cur.y = nxt.y; cur.z = nxt.z; rx = ry = rz = 0; break; }
        const nl = Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z) || 1;
        const nx = hit.normal.x / nl, ny = hit.normal.y / nl, nz = hit.normal.z / nl;
        const travel = Math.max(0, hit.fraction - 1e-4);
        cur.x += rx * travel + nx * 0.003; cur.y += ry * travel + ny * 0.003; cur.z += rz * travel + nz * 0.003;
        const left = Math.max(0, 1 - hit.fraction);
        rx *= left; ry *= left; rz *= left;
        const rn = rx * nx + ry * ny + rz * nz;
        if (rn < 0) { rx -= nx * rn; ry -= ny * rn; rz -= nz * rn; }
        addContact(nx, ny, nz, kindOf(hit), cur.x, cur.y, cur.z);
      }
      if (rx * rx + ry * ry + rz * rz > 1e-10) {
        nxt.x = cur.x + rx; nxt.y = cur.y + ry; nxt.z = cur.z + rz;
        if (!world.sweepSphere(cur, nxt, radii)) { cur.x = nxt.x; cur.y = nxt.y; cur.z = nxt.z; }
      }
      // hard terrain floor (legacy MIN_AGL guard, but lift instead of reverting)
      const gh = world.groundHeight ? world.groundHeight(cur.x, cur.z) : null;
      if (gh != null && Number.isFinite(gh) && cur.y - gh < radii.terrain - 0.01) {
        cur.y = gh + radii.terrain;
        addContact(0, 1, 0, KIND_TERRAIN, cur.x, gh, cur.z);
      }
      if (!(Number.isFinite(cur.x) && Number.isFinite(cur.y) && Number.isFinite(cur.z))) throw new Error('nan');
      s.p[0] = cur.x; s.p[1] = cur.y; s.p[2] = cur.z;
      return true;
    } catch {
      s.p[0] = sx; s.p[1] = sy; s.p[2] = sz;
      s.v.fill(0);
      CT.n = 0;
      sim.stats.collisionFailures += 1;
      return false;
    }
  }

  // ---- last-safe snapshots ------------------------------------------------------------------
  const ring = [];
  for (let i = 0; i < SAFE_RING; i++) ring.push({ snap: createSafeSnapshot(), hover: 0, t: 0 });
  let ringHead = 0, ringCount = 0;
  let lastContactT = -1e9;
  const pushSafe = (hover) => {
    const e = ring[ringHead];
    recordSafe(e.snap, s);
    e.hover = hover; e.t = s.t;
    ringHead = (ringHead + 1) % SAFE_RING;
    if (ringCount < SAFE_RING) ringCount++;
  };
  const initialSafe = createSafeSnapshot();
  function pickSafe() {
    // newest snapshot at least 1.5 s older than the crash; prefer a real hover
    let best = null, bestHover = null;
    for (let k = 0; k < ringCount; k++) {
      const e = ring[(ringHead - 1 - k + SAFE_RING * 2) % SAFE_RING];
      if (e.t > s.t - 1.5) continue;
      if (!best) best = e;
      if (e.hover && !bestHover) bestHover = e;
      if (best && bestHover) break;
    }
    const chosen = bestHover && bestHover.t > (best ? best.t - 8 : 0) ? bestHover : best;
    return chosen ? chosen.snap : (initialSafe.valid ? initialSafe : null);
  }

  // ---- crash / respawn ------------------------------------------------------------------------
  function startCrash(ev) {
    const c = sim.crash;
    c.active = true; c.t = 0; c.count += 1; c.skip = false;
    c.x = s.p[0]; c.y = s.p[1]; c.z = s.p[2];
    sim.stats.crashes += 1;
    hooks.onCrash?.(ev);
  }
  function respawn() {
    const snap = pickSafe();
    const ok = snap ? restoreSafe(s, P, snap) : false;
    if (!ok) {
      setYaw(s, spawn.yaw || 0);
      s.p[0] = spawn.x; s.p[1] = spawn.y; s.p[2] = spawn.z;
      s.v.fill(0); s.w.fill(0); s.iv.fill(0); s.vcf.fill(0); s.dmg.fill(0);
      s.m.fill(P.hoverW); s.cut = 0; s.integrity = 1;
    }
    // make sure the snapshot is legal in the (possibly changed) world
    if (world?.recoverSphere) {
      cur.x = s.p[0]; cur.y = s.p[1]; cur.z = s.p[2];
      const rec = world.recoverSphere(cur, radii);
      if (rec?.translation) { s.p[0] += rec.translation.x; s.p[1] += rec.translation.y; s.p[2] += rec.translation.z; }
    }
    s.soc = Math.max(s.soc, 0.05);
    sim.crash.active = false; sim.crash.t = 0;
    sim.invuln = INVULN_TIME;
    pend.yaw = 0;
    ringCount = 0; ringHead = 0;
    lastContactT = s.t;
    sim.stats.respawns += 1;
    sim.updateDerived();
    headingPrev = sim.att.yaw;
    hooks.onRespawn?.({ invulnerable: INVULN_TIME, x: s.p[0], y: s.p[1], z: s.p[2], yaw: sim.att.yaw });
  }
  sim.skipCrash = () => { if (sim.crash.active && sim.crash.t > 0.3) sim.crash.skip = true; };
  sim.forceRespawn = () => { if (!sim.crash.active) { sim.crash.active = true; sim.crash.t = 0; } respawn(); };

  // ---- contacts -> impulses -------------------------------------------------------------------
  let dmgT = -1e9, dmgCls = 0, evT = -1e9, evCls = 0;
  function applyContacts() {
    let worst = CLS_NONE, worstE = 0, wi = -1, vnW = 0;
    const invuln = sim.invuln > 0;
    for (let i = 0; i < CT.n; i++) {
      hitObj.nx = CT.nx[i]; hitObj.ny = CT.ny[i]; hitObj.nz = CT.nz[i];
      hitObj.px = CT.px[i]; hitObj.py = CT.py[i]; hitObj.pz = CT.pz[i];
      hitObj.kind = CT.kind[i];
      const integ0 = s.integrity, cut0 = s.cut;
      const d0 = s.dmg[0], d1 = s.dmg[1], d2 = s.dmg[2], d3 = s.dmg[3];
      // the world collider is a sphere: a touch acts through the centre (no spurious spin); only a
      // crash-level hit (closing speed >= 5 m/s ~ 3 J) uses the box corner and tumbles the drone
      const close = -(s.v[0] * CT.nx[i] + s.v[1] * CT.ny[i] + s.v[2] * CT.nz[i]);
      P.contactLever = clamp((close - 3.5) / 1.5, 0, 1);
      const cls = resolveContact(s, P, hitObj, cOut);
      if (cls === CLS_NONE) continue;
      let spare = cls === CLS_SCRAPE || invuln;      // resting / scraping costs nothing; invulnerable = no consequences
      if (!spare && cls < CLS_CRASH && s.t - dmgT < DAMAGE_COOLDOWN && cls <= dmgCls) spare = true;   // one hit = one damage
      if (spare) {
        s.integrity = integ0;
        s.cut = cut0; s.dmg[0] = d0; s.dmg[1] = d1; s.dmg[2] = d2; s.dmg[3] = d3;
      } else {
        if (cls === CLS_PROP && CT.ny[i] > 0.7) s.integrity = integ0 - 0.02;   // landing gear absorbs a firm touch-down
        if (cls >= CLS_WOBBLE) { dmgT = s.t; dmgCls = cls; }
      }
      if (cOut.energy > worstE) { worstE = cOut.energy; worst = invuln && cls > CLS_SCRAPE ? CLS_SCRAPE : cls; wi = i; vnW = cOut.vn; }
    }
    if (wi < 0) return;
    lastContactT = s.t;
    sim.stats.contacts += 1;
    return classify(worst, worstE, wi, vnW);
  }

  let lastBumpT = -1e9;
  function classify(cls, energy, i, vn) {
    const li = sim.lastImpact;
    // significant? (resting contact is reported as nothing)
    const significant = cls >= CLS_WOBBLE || (cls === CLS_SCRAPE && energy > 0.04);
    if (!significant) return;
    if (cls === CLS_SCRAPE) {                   // debounce light bumps so a slide is one event
      if (s.t - lastBumpT < 0.25) return;
      lastBumpT = s.t;
    } else {
      if (s.t - evT < 0.12 && cls <= evCls) return;   // tumbling / scraping: one event per class per 120 ms
      evT = s.t; evCls = cls;
    }
    li.cls = cls; li.name = CLASS_NAMES[cls]; li.energy = energy; li.vn = vn; li.t = s.t;
    li.nx = CT.nx[i]; li.ny = CT.ny[i]; li.nz = CT.nz[i]; li.kind = CT.kind[i];
    li.px = CT.px[i]; li.py = CT.py[i]; li.pz = CT.pz[i];
    sim.stats.bumps += 1;
    const ev = {
      cls, energyClass: li.name, energy, speed: -vn, integrity: s.integrity,
      nx: li.nx, ny: li.ny, nz: li.nz, x: li.px, y: li.py, z: li.pz, kind: li.kind,
    };
    hooks.onImpact?.(ev);
    if (cls === CLS_CRASH && !sim.crash.active) startCrash(ev);
    return ev;
  }

  // ---- one fixed step ----------------------------------------------------------------------------
  const out = { moved: 0 };
  /**
   * dt = 1/120. inp: { fwd, strafe, lift, yaw, boost, brake }.
   * Positions are world metres (y up).
   */
  sim.step = (dt, inp) => {
    const st = sim.stats;
    st.steps += 1;
    if (st.steps % PROBE_EVERY === 1 || st.steps === 1) refreshEnvironment();
    // wind (cached at 30 Hz inside sampleWind)
    sampleWind(wind, s.t, s.p[0], s.p[1], s.p[2], aglForWind, sim.hspeed, windOut);
    env.wx = windOut[0]; env.wy = windOut[1]; env.wz = windOut[2];

    mapInput(inp, dt);
    const sx = s.p[0], sy = s.p[1], sz = s.p[2];
    stepQuad(s, P, cmd, env, dt);
    if (!(Number.isFinite(s.p[0]) && Number.isFinite(s.p[1]) && Number.isFinite(s.p[2])
      && Number.isFinite(s.v[0]) && Number.isFinite(s.v[1]) && Number.isFinite(s.v[2])
      && Number.isFinite(s.q[0]))) {
      st.nonFinite += 1;
      sim.reseed(sx, sy, sz, sim.att.yaw);
      return out;
    }
    const dx = s.p[0], dy = s.p[1], dz = s.p[2];
    constrain(sx, sy, sz, dx, dy, dz);
    let ev = null;
    const integ0 = s.integrity;
    if (CT.n) ev = applyContacts();
    if (integ0 - s.integrity > 0.005) {
      const li = sim.lastImpact;
      hooks.onDamage?.({ amount: integ0 - s.integrity, dir: [-li.nx, -li.ny, -li.nz], source: 'impact', integrity: s.integrity });
    }
    if (sim.vegDensity > 0.002) vegetationDrag(s, P, sim.vegDensity, dt);
    if (s.integrity <= 0 && !s.cut) s.cut = 1;
    if (s.cut && !sim.crash.active && s.integrity <= 0) startCrash({ cls: CLS_CRASH, energyClass: 'crash', energy: 0, integrity: 0 });

    // pending yaw bookkeeping: subtract what the body actually turned
    sim.updateDerived();
    if (pend.yaw !== 0) {
      let dyaw = sim.att.yaw - headingPrev;
      if (dyaw > Math.PI) dyaw -= 2 * Math.PI; else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      pend.yaw -= dyaw;
      if (Math.abs(pend.yaw) < 1e-4) pend.yaw = 0;
    }
    headingPrev = sim.att.yaw;

    if (sim.invuln > 0) { sim.invuln -= dt; if (sim.invuln < 0) sim.invuln = 0; }
    // crash timeline
    const c = sim.crash;
    if (c.active) {
      c.t += dt;
      if (c.t >= RESPAWN_DELAY || c.skip) respawn();
    } else if (st.steps % SAFE_EVERY === 0) {
      const stable = s.t - lastContactT > 1.0 && s.integrity > 0.3 && !s.cut
        && sim.speed < 14 && s.tilt < 0.8 && (sim.agl == null || sim.agl > 3) && sim.invuln <= 0;
      if (stable) pushSafe(sim.speed < 2 ? 1 : 0);
    }
    st.lastSafeAge = ringCount ? s.t - ring[(ringHead - 1 + SAFE_RING) % SAFE_RING].t : -1;

    // wind diagnostics (HUD / audio / other workstreams)
    const wi = sim.windInfo;
    wi.x = env.wx; wi.y = env.wy; wi.z = env.wz;
    wi.speed = Math.hypot(env.wx, env.wz);
    wi.gust = Math.hypot(wind.tu, wind.tv, wind.tw);
    wi.shelter = wind.shelter;
    // bearing the wind comes FROM (0 = north, clockwise; world: -z = north, +x = east)
    wi.fromDeg = wi.speed > 0.05 ? (((Math.atan2(-env.wx, env.wz) * 180 / Math.PI) % 360) + 360) % 360 : 0;
    return ev || out;
  };

  sim.setWorld = (w) => { sim.world = w; };
  // initial state
  sim.reseed(spawn.x, spawn.y, spawn.z, spawn.yaw || 0);
  recordSafe(initialSafe, s);
  sim.copyState = (dst) => copyQuad(dst, s);
  sim.altM = opts.altM ?? 0;
  sim.rhoR = P.rhoR;
  sim.densityRatio = densityRatio;
  return sim;
}
