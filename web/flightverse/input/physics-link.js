// flightverse/input/physics-link.js — wires Physics v2 into the running game (WS C).
// Only installed with ?fv=2 (or ?phys=v2). Builds the sim (physics/sim.js) for this world,
// attaches it to the drone (runtime.js), chooses profile / wind from the game context,
// and publishes the results to other workstreams:
//
//   ctx.phys  (== window.__volar.physics)   plain-number snapshot, refreshed every frame
//   bus       crash{energyClass,...}  damage{amount,dir,source:'impact'}  respawn{invulnerable,...}
//   ctx.controls.physics   setProfile(name|null) setWind(name|null) skipCrash() state
//
// energyClass (bus 'crash'): 'bounce' | 'wobble' | 'prop' | 'crash'  (+ legacy 'soft' from v1).
import {
  createSim, profileForContext, windForContext, PROFILES, WIND_PRESETS, densityRatio,
  RESPAWN_DELAY, WRECK_CAM_TIME, INVULN_TIME, buildVegetationField,
} from '/flightverse/physics/index.js?v=368';

const hashString = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h || 1;
};
const DEG = 180 / Math.PI;

export function physicsRequested(ctx) {
  return !!(ctx.flags.fv2 || ctx.Q.get('phys') === 'v2');
}

export function installPhysicsV2(ctx, { settings } = {}) {
  const { drone, man, bus, Q, report, state: S } = ctx;
  const storage = (() => { try { return localStorage; } catch { return null; } })();
  const store = {
    get: (k) => { try { return storage?.getItem(k) || null; } catch { return null; } },
    set: (k, v) => { try { if (v) storage?.setItem(k, v); else storage?.removeItem(k); } catch { /* */ } },
  };
  let userProfile = PROFILES[Q.get('perfil')] ? Q.get('perfil') : (PROFILES[store.get('ab.fv.profile')] ? store.get('ab.fv.profile') : null);
  let userWind = WIND_PRESETS[Q.get('viento')] ? Q.get('viento') : (WIND_PRESETS[store.get('ab.fv.wind')] ? store.get('ab.fv.wind') : null);

  // MSL of the flight volume: world floor + a rooftop's worth. Bogota ~2590 m -> rho/rho0 0.74.
  const elevMin = Number(man?.world?.elev_min);
  const altM = (Number.isFinite(elevMin) ? elevMin : 2600) + 12;

  // vegetation: same scatter rows and cap as the renderer (vegetation.js); built lazily once loaded
  let vegField = null, vegState = 'wait', vegAt = 0;
  const vegetation = { densityAt: (x, y, z) => (vegField ? vegField.densityAt(x, y, z) : 0) };
  async function tryVegetation() {
    vegState = 'loading';
    try {
      const cap = report.vegetation?.cap;
      const url = man?.assets?.scatter;
      if (!cap || !url) { vegState = cap === undefined ? 'wait' : 'none'; return; }
      const doc = await fetch(url).then(r => (r.ok ? r.json() : null));
      vegField = buildVegetationField(doc, cap, (x, z) => ctx.collision.groundHeight(x, z));
      vegState = vegField ? 'ready' : 'none';
    } catch { vegState = 'none'; }
  }

  const phys = {
    active: false, version: 2, profile: 'normal', altM, densityRatio: densityRatio(altM),
    wind: { x: 0, y: 0, z: 0, speed: 0, gust: 0, fromDeg: 0, relDeg: 0, preset: 'breezy', shelter: 0 },
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0, tiltDeg: 0, roll: 0, pitch: 0 },
    battery: 100, integrity: 100, motors: [0, 0, 0, 0], vrs: 0, groundEffect: 1, thrustRatio: 1,
    boost: 0, invuln: 0, agl: null,
    crash: { active: false, phase: 'none', t: 0, count: 0, x: 0, y: 0, z: 0, wreckTime: WRECK_CAM_TIME, respawnDelay: RESPAWN_DELAY },
    impact: { name: 'none', energy: 0, speed: 0, t: -1, nx: 0, ny: 1, nz: 0 },
    vegetation: { state: 'wait', density: 0, count: 0 },
    stats: {}, stepUs: 0, stepUsMax: 0, settings: null,
  };
  ctx.phys = phys;
  report.physics = phys;

  const yaw0 = drone.yaw || 0;
  const sim = createSim({
    world: ctx.collision,
    altM,
    seed: hashString(ctx.CID || 'fv'),
    profile: userProfile || 'normal',
    windPreset: userWind || 'breezy',
    windDirRad: 2.75,                       // prevailing easterly: blows toward the west-southwest
    radii: { structure: drone.collisionRadius, boundary: drone.collisionRadius },
    spawn: { x: drone.pos.x, y: drone.pos.y, z: drone.pos.z, yaw: yaw0 },
    vegetation,
    hooks: {
      onImpact(ev) {
        phys.impact.name = ev.energyClass; phys.impact.energy = ev.energy; phys.impact.speed = ev.speed;
        phys.impact.t = S.simT; phys.impact.nx = ev.nx; phys.impact.ny = ev.ny; phys.impact.nz = ev.nz;
        bus.emit('crash', {
          energyClass: ev.energyClass, energy: ev.energy, speed: ev.speed, integrity: ev.integrity,
          pos: [ev.x, ev.y, ev.z], normal: [ev.nx, ev.ny, ev.nz],
        });
        if (ev.cls >= 3) {                  // prop strike / crash: sound + flash like the v1 soft-crash edge
          try { ctx.audio?.crash?.(); } catch { /* */ }
          try { ctx.ui?.hud?.hitFlash?.(); } catch { /* */ }
        }
      },
      onCrash(ev) {
        phys.crash.count = sim.crash.count;
        ctx.controls.camera?.onCrash?.(ev);
      },
      onDamage(ev) { bus.emit('damage', { amount: ev.amount, dir: ev.dir, source: 'impact', integrity: ev.integrity }); },
      onRespawn(ev) {
        bus.emit('respawn', { invulnerable: ev.invulnerable, x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
        ctx.controls.camera?.onRespawn?.(ev);
        ctx.controls.v2?.haptics?.play('respawn');
      },
    },
  });
  drone.attachV2(sim);

  // ---- context-driven profile + wind ---------------------------------------------------------------
  const sportContext = () => {
    const gr = S.reto?.state;
    const grActive = gr && gr.phase && gr.phase !== 'idle' && gr.phase !== 'finished';
    return {
      grDifficulty: grActive ? gr.difficulty : null,
      invasion: !!ctx.enemies?.invasion?.state?.on,
    };
  };
  let lastSky = '', lastProfile = '', lastWind = '';
  function refreshContext() {
    const sc = sportContext();
    const prof = profileForContext({ userProfile, ...sc });
    if (prof !== lastProfile) { lastProfile = prof; sim.setProfile(prof); }
    const sport = prof === 'sport';
    const pref = settings?.windPreset?.() || userWind;
    const sky = ctx.sky?.preset || 'dia';
    const wind = windForContext({ userWind: pref, sky, sport });
    if (wind !== lastWind || sky !== lastSky) { lastWind = wind; lastSky = sky; sim.setWindPreset(wind); }
  }
  refreshContext();

  // ---- per fixed step -------------------------------------------------------------------------------------
  let ema = 0, peak = 0, n = 0;
  const link = {
    sim,
    beforeStep() {
      if (S.simT - vegAt > 1 && (vegState === 'wait')) { vegAt = S.simT; tryVegetation(); }
      if (((sim.stats.steps + 1) & 31) === 0) refreshContext();
    },
    afterStep(t0) {
      const us = (performance.now() - t0) * 1000;
      ema += (us - ema) * 0.02; if (us > peak) peak = us; n++;
      phys.stepUs = +ema.toFixed(1);
    },
  };

  // ---- per render frame ----------------------------------------------------------------------------------------
  function publish() {
    const s = sim.s, a = sim.att, w = sim.windInfo;
    phys.active = !!drone.v2?.active;
    phys.profile = sim.profile;
    const hd = a.yaw * DEG;
    phys.wind.x = w.x; phys.wind.y = w.y; phys.wind.z = w.z;
    phys.wind.speed = w.speed; phys.wind.gust = w.gust; phys.wind.fromDeg = w.fromDeg;
    // wind-from bearing relative to the drone heading (0 = head wind). Heading: 0 = north (-z), clockwise.
    const headingDeg = ((-hd % 360) + 360) % 360;
    phys.wind.relDeg = ((w.fromDeg - headingDeg + 540) % 360) - 180;
    phys.wind.preset = w.preset; phys.wind.shelter = w.shelter;
    phys.attitude.rollDeg = a.roll * DEG; phys.attitude.pitchDeg = a.pitch * DEG;
    phys.attitude.yawDeg = headingDeg; phys.attitude.tiltDeg = a.tilt * DEG;
    phys.attitude.roll = a.roll; phys.attitude.pitch = a.pitch;
    phys.battery = s.soc * 100; phys.integrity = s.integrity * 100;
    for (let i = 0; i < 4; i++) phys.motors[i] = s.m[i];
    phys.vrs = s.vrs; phys.groundEffect = s.ge; phys.boost = sim.boostK;
    phys.thrustRatio = s.thrustSum / sim.P.weight;
    phys.invuln = sim.invuln; phys.agl = sim.agl;
    const c = sim.crash;
    phys.crash.active = c.active; phys.crash.t = c.t; phys.crash.count = c.count;
    phys.crash.phase = !c.active ? 'none' : (c.t < WRECK_CAM_TIME ? 'wreck' : 'fade');
    phys.crash.x = c.x; phys.crash.y = c.y; phys.crash.z = c.z;
    phys.vegetation.state = vegState; phys.vegetation.density = sim.vegDensity; phys.vegetation.count = vegField?.count || 0;
    phys.stats = sim.stats; phys.stepUsMax = +peak.toFixed(1);
  }

  Object.assign(ctx.controls, {
    physics: {
      sim, link, phys,
      setProfile(name) {
        userProfile = PROFILES[name] ? name : null;
        store.set('ab.fv.profile', userProfile);
        refreshContext();
        return sim.profile;
      },
      setWind(name) {
        userWind = WIND_PRESETS[name] ? name : null;
        store.set('ab.fv.wind', userWind);
        lastWind = ''; refreshContext();
        return sim.windInfo.preset;
      },
      skipCrash: () => sim.skipCrash(),
      respawnNow: () => sim.forceRespawn(),
      publish,
      get profile() { return sim.profile; },
    },
  });
  // respawn from tap during the wreck camera
  const onTap = () => sim.skipCrash();
  addEventListener('pointerdown', onTap, { passive: true });
  link.dispose = () => removeEventListener('pointerdown', onTap);
  link.publish = publish;
  link.INVULN_TIME = INVULN_TIME;
  return link;
}
