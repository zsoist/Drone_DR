// flightverse/fx/index.js — punto de instalación del workstream B (armas, proyectiles,
// FX, impactos, sacudida, audio). installFx(ctx) es ASYNC (carga GLTFLoader para los
// modelos de arma) y debe correr tras crear scene/camera/terrain/collision/audio y
// ANTES de installEnemies (la horda usa weapons.explodeAt).
//
// Publica en ctx.fx:
//   weapons, weaponModels, shake{mag,fov}, aim (grupo 3D; en ?fv=2 es un grupo vacío — la
//   retícula es de pantalla), selectedWeaponKey, selectWeaponModel(key), selectWeapon(key),
//   doFire(), resolveCombatAim(), update(dt, gamePaused), afterUpdate(), report(),
//   render(rdt), audioFrame(spd), dispose()
// Emite en el bus: fire{weapon,origin,dir}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento; B añade aquí
// (y en fx/*.js) el resto de la biblioteca FX.
//
// ── ?fv=2 (flags.fv2) ────────────────────────────────────────────────────────────────────
// Arsenal de 6 armas (WEAPON_UI_KEYS), FX pooled/instanced (fx/fx-system.js), sacudida por
// trauma con presupuesto, hit-stop, balística consistente, audio por capas. API nueva:
//   fx.aimData     datos de retícula para el HUD (A dibuja): {valid, weapon, class, kind, point,
//                  normal, distance, spreadPx, heat{value,overheated}, cooldown{value,ready},
//                  charge{active,progress}, lead{active,world,onTarget,...},
//                  lock{state,progress,target,world,radius}, swarm{targets[],max}, nova{splash},
//                  ammo, screenFlash}  — TODAS las posiciones en coordenadas de mundo
//   fx.project(w)  {x,y,visible} en px CSS de la posición de mundo w
//   fx.timeScale() 1 o 0.05 durante un hit-stop (el loop de volar.js puede multiplicar su dt)
//   fx.weaponList  [{key,label,code,slot,hud,icon}] las 6 armas del jugador (WEAPON_UI)
//   fx.press()/release() opcionales; bindings.js ya llama a doFire() al pulsar (MISIL/SWARM
//                  deciden en la liberación usando ctx.state.firing)
// Bus: fire, hit{target,weapon,damage,kill,kind,pos}, explode{pos,size:'S'|'M'|'XL',big,weapon},
// lock{target,state:'acquiring'|'locked'|'lost'|'none'}.
import { createWeapons, ARSENAL } from '/flightverse/weapons.js?v=368';
import {
  angleBetween, bulletDrop, createDwell, createLockTracker, createVelocityTracker, evaluateLead,
  pickLockCandidate, pickSwarmTargets, resolveAimRay,
} from '/flightverse/aiming.js?v=368';
import { createWeaponModelLibrary } from '/flightverse/weapon-models.js?v=368';
import { reducedMotion } from '/flightverse/vegetation.js?v=368';
import {
  LEAD, MISIL, SWARM_LOCK, WEAPON_FAMILY, WEAPON_FX, WEAPON_PROFILES, WEAPON_UI, WEAPON_UI_KEYS,
} from '/flightverse/weapon-registry.js?v=368';
import { createShake, shakeOffsets } from '/flightverse/fx/shake.js?v=368';
import { createHitStop } from '/flightverse/fx/hitstop.js?v=368';
import { BUS_EVENTS } from '/flightverse/bus.js?v=368';

export async function installFx(ctx) {
  const {
    THREE, scene, camera, report, Q, terrain, collision, audio, state: S, bus, P, flags,
  } = ctx;
  const fx = ctx.fx;
  // ── armamento: misiles + explosiones + destrucción (X o botón FIRE) ──
  const shake = { mag: 0 };
  const weaponModelErrors = new Set();
  const { GLTFLoader: ArsenalGLTFLoader } = await import(
    '/vendor/three-addons180/loaders/GLTFLoader.js?v=368'
  );
  const weaponModels = createWeaponModelLibrary({
    quality: Q.get('calidad') || localStorage.getItem('ab.fv.calidad') || 'auto',
    coarse: matchMedia('(pointer:coarse)').matches,
    loader: new ArsenalGLTFLoader(),
    root: '/assets/weapons',
  });
  fx.selectWeaponModel = key => weaponModels.select(key, ctx.droneModel.hardpoints).catch(error => {
    const message = `arma 3D ${key}: ${error?.message || error}`;
    if (!weaponModelErrors.has(message)) {
      weaponModelErrors.add(message);
      report.errors.push(message);
    }
    return null;
  });
  // ?fvfx=1: interruptor SÓLO de B (armas/FX/audio v2) para probar aislado mientras ui/ input/ aún no
  // soportan ?fv=2; en la pasada de integración se elimina y manda flags.fv2.
  const V2 = Boolean(flags.fv2) || Q.get('fvfx') === '1';
  const shakeModel = V2 ? createShake({ reduced: reducedMotion }) : null;
  const hitstop = V2 ? createHitStop({ reduced: reducedMotion }) : null;
  const _right = { x: 1, y: 0, z: 0 };
  const _muzzle = new THREE.Vector3();
  const muzzleWorld = (index = null) => {
    const hardpoints = ctx.droneModel.hardpoints;
    return hardpoints.length
      ? hardpoints[(index ?? weapons.state.fired) % hardpoints.length].getWorldPosition(new THREE.Vector3())
      : P.clone();
  };
  const shakeAttenuation = pos => {
    if (!pos) return 1;
    const d = camera.position.distanceTo(pos);
    return 1 / (1 + (d / 40) * (d / 40));
  };
  const addShake = (tier, trauma, pos, ceiling = null) => {
    shakeModel.add(tier, trauma, { attenuation: shakeAttenuation(pos), ceiling });
    shake.fov = Math.max(shake.fov || 0, shakeModel.fov);
  };
  const events = V2 ? {
    hit: d => bus.emit('hit', d),
    explode: d => bus.emit('explode', d),
    hitstop: ms => hitstop.request(ms),
    shake: ({ tier, trauma, pos, ceiling }) => addShake(tier, trauma, pos, ceiling),
    overheat: () => {},
  } : null;
  const weapons = createWeapons(scene, {
    world: collision, heightAt: terrain.heightAt, audio, crater: terrain.crater,
    getCameraPosition: () => camera.position,
    fv2: V2,
    events,
    reduced: reducedMotion,
    getMuzzle: V2 ? () => muzzleWorld() : null,
    getAim: V2 ? () => {
      const hit = resolveCombatAim();
      return { aimPoint: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), target: hit.target || null };
    } : null,
    cameraRef: () => camera,
    viewportHeight: () => ctx.renderer?.domElement?.clientHeight || innerHeight,
    effectTier: flags.coarse
      ? (Math.min(innerWidth, innerHeight) < 700 ? 'phone' : 'tablet')
      : 'desktop',
    cloneProjectile: key => weaponModels?.cloneProjectile(key),
    onDestroy: node => S.sceneObjects?.markDestroyed(node),
    onShake: (pos, big, info) => {
      if (reducedMotion()) return;               // sacudida y patada de FOV son movimiento no esencial
      if (V2 && info?.v2) {                       // ?fv=2: tiers T1/T2/T3 con presupuesto (fx/shake.js)
        const own = WEAPON_FX[WEAPON_FAMILY[info.weapon] || info.weapon]?.shake;
        const byClass = { S: ['T1', 0.035], M: ['T2', 0.08], XL: ['T3', 0.2] }[info.cls] || ['T2', 0.08];
        const tier = own && info.cls !== 'S' ? own.tier : byClass[0];
        const trauma = own && info.cls !== 'S' ? own.trauma : byClass[1];
        addShake(tier, trauma, pos, own?.cap === 'T2' ? 0.10 : null);
        if (info.cls === 'XL') shakeModel.rumble(own?.rumble || 0.6, 0.07 * shakeAttenuation(pos));
        return;
      }
      const d = camera.position.distanceTo(pos);
      shake.mag = Math.max(shake.mag, Math.min(0.9, (9 * big) / (5 + d)));
      shake.fov = Math.max(shake.fov || 0, Math.min(7, (26 * big) / (4 + d)));
    },
  });
  // report.weaponState se escribe VIVO en el loop (aquí era snapshot de boot)
  // retícula de impacto: simula la balística y marca dónde caerá el misil
  // (?fv=2: no hay anillo en el mundo — la retícula es de pantalla y la dibuja el HUD con fx.aimData)
  const aim = new THREE.Group();
  if (!V2) {
    const am = new THREE.MeshBasicMaterial({ color: 0xff8a5a, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const r1 = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 28), am);
    const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), am.clone());
    aim.add(r1, r2);
  }
  aim.visible = false;
  scene.add(aim);

  const aimDirection = new THREE.Vector3();
  const resolveCombatAim = () => {
    camera.getWorldDirection(aimDirection);
    const invasion = ctx.enemies.invasion;
    const hittables = invasion.state.on
      ? [...(S.sceneObjects?.hittables || []), ...invasion.hittables]
      : S.sceneObjects?.hittables || [];
    return resolveAimRay({
      position: camera.position,
      direction: aimDirection,
      far: 1200,
    }, collision, hittables);
  };

  // ── ?fv=2: hold-to-lock (MISIL) / multi-lock (SWARM), decididos al soltar el gatillo ──
  const lockTracker = V2 ? createLockTracker({
    lockTime: MISIL.lockTime, loseGrace: MISIL.loseGrace, loseFade: MISIL.loseFade,
  }) : null;
  const swarm = { targets: [], acc: 0 };
  let pending = null;                                   // {key, t}: pulsación a la espera de soltar
  const velocities = V2 ? createVelocityTracker() : null;
  const dwell = V2 ? createDwell(LEAD.hold) : null;
  const enemyTargets = () => (ctx.enemies.hittables() || []).filter(h => h?.enemy && !h.g?.userData?.dead);
  const castSegment = (a, b, r) => collision?.castSegment?.(a, b, r);
  const emitLock = (target, state) => {
    bus.emit('lock', { target, state });
    audio?.lockTone?.(state, lockTracker.progress);
  };
  const resetLock = () => {
    if (!V2) return;
    const had = lockTracker.state !== 'none' || swarm.targets.length;
    lockTracker.reset();
    swarm.targets.length = 0; swarm.acc = 0;
    if (had) { bus.emit('lock', { target: null, state: 'none' }); audio?.lockTone?.('none', 0); }
  };

  const fireNow = (extra = {}) => {
    // si el GLB trae hardpoints, el misil sale del siguiente en turno
    const hp = muzzleWorld();
    const target = resolveCombatAim();
    const aimInfo = {
      aimPoint: V2 ? new THREE.Vector3(target.point.x, target.point.y, target.point.z) : target.point,
      target: target.target || null,
      ...extra,
    };
    if (!weapons.fire(hp, aimInfo)) return false;
    ctx.ui.weapons.flashFire();
    bus.emit('fire', { weapon: weapons.state.weapon, origin: hp, dir: aimDirection.clone() });
    return true;
  };
  const doFire = () => {
    if (ctx.ui.overlay?.active()) return false;
    if (V2) {
      const w = weapons.state.weapon;
      if (S.firing && (w === 'm' || w === 'sw')) {
        // la decisión tap (sin guiar) vs mantener-para-fijar (guiado) se toma al soltar
        if (pending) return true;
        const st = weapons.state;
        if (st.ammo[w] < 1 || st.cool > 0) return false;
        pending = { key: w, t: 0 };
        return true;
      }
    }
    return fireNow();
  };

  /** Por paso de juego: avanza la pulsación pendiente, el lock y dispara al soltar. */
  const tickPending = dt => {
    const w = weapons.state.weapon;
    if (pending && (pending.key !== w || ctx.ui.overlay?.active())) { pending = null; resetLock(); return; }
    if (!pending) { if (lockTracker.state !== 'none' || swarm.targets.length) resetLock(); return; }
    pending.t += dt;
    const holding = pending.t >= MISIL.holdToLock;
    if (S.firing) {
      camera.getWorldDirection(aimDirection);
      if (w === 'm') {
        const candidate = holding ? pickLockCandidate({
          origin: camera.position, direction: aimDirection, candidates: enemyTargets(),
          cone: MISIL.lockCone, range: MISIL.lockRange, sticky: lockTracker.target, castSegment,
        }) : null;
        const r = lockTracker.step({ dt, holding, candidate });
        if (r.changed) emitLock(r.target, r.state);
        else audio?.lockTone?.(r.state, r.progress);
      } else if (holding) {                                  // SWARM: +1 objetivo cada 0.12 s
        swarm.targets = swarm.targets.filter(t => t.enemy && !t.g?.userData?.dead);
        swarm.acc += dt;
        if (swarm.acc >= SWARM_LOCK.step && swarm.targets.length < SWARM_LOCK.max) {
          swarm.acc = 0;
          const pool = pickSwarmTargets({
            origin: camera.position, direction: aimDirection, candidates: enemyTargets(),
            cone: SWARM_LOCK.cone, range: SWARM_LOCK.range, max: SWARM_LOCK.max, castSegment,
          }).filter(t => !swarm.targets.includes(t));
          if (pool.length) { swarm.targets.push(pool[0]); emitLock(pool[0], 'locked'); }
        }
      }
      return;
    }
    // soltado: disparar
    const extra = {};
    if (w === 'm' && lockTracker.state === 'locked' && lockTracker.target) {
      extra.guided = true; extra.target = lockTracker.target;
    } else if (w === 'sw' && swarm.targets.length) {
      extra.targets = swarm.targets.slice(); extra.target = swarm.targets[0];
    }
    pending = null;
    fireNow(extra);
    resetLock();
  };

  // ── ?fv=2: datos de retícula para el HUD ───────────────────────────────────────
  const aimData = {
    valid: false, weapon: null, class: 'gun', kind: 'none', point: null, normal: null, distance: 0,
    spreadPx: 0, ammo: 0, screenFlash: 0,
    heat: { value: 0, overheated: false, lockout: 0 },
    cooldown: { value: 1, ready: true },
    charge: { active: false, progress: 0 },
    lead: { active: false, world: null, intercept: null, time: 0, range: 0, distance: 0, onTarget: false, target: null },
    lock: { state: 'none', progress: 0, target: null, world: null, radius: 0 },
    swarm: { targets: [], max: SWARM_LOCK.max },
    nova: { splash: WEAPON_PROFILES.tb.splash, point: null },
    missile: { drop: 0 },
  };
  const _pv = new THREE.Vector3();
  const project = w => {
    _pv.set(w.x, w.y, w.z).project(camera);
    const el = ctx.renderer?.domElement;
    const width = el?.clientWidth || innerWidth;
    const height = el?.clientHeight || innerHeight;
    return {
      x: (_pv.x * 0.5 + 0.5) * width,
      y: (-_pv.y * 0.5 + 0.5) * height,
      visible: _pv.z > -1 && _pv.z < 1 && Math.abs(_pv.x) <= 1.25 && Math.abs(_pv.y) <= 1.25,
    };
  };
  const xyz = v => (v ? { x: v.x, y: v.y, z: v.z } : null);

  function updateAimData(hit, rdt) {
    const st = weapons.state;
    const w = st.weapon;
    const prof = WEAPON_PROFILES[w];
    const family = WEAPON_FAMILY[w] || w;
    const ui = WEAPON_UI[family] || WEAPON_UI.mg;
    const fxDef = WEAPON_FX[family] || {};
    const far = !hit || hit.kind === 'none' || hit.distance > 400;
    aimData.valid = true;
    aimData.weapon = family;
    aimData.internalWeapon = w;
    aimData.class = ui.hud;
    aimData.kind = hit?.kind || 'none';
    aimData.point = far ? null : xyz(hit.point);
    aimData.normal = far ? null : xyz(hit.normal);
    aimData.distance = hit?.distance || 0;
    aimData.spreadPx = ui.spreadPx || 0;
    aimData.ammo = Math.floor(st.ammo[w]);
    aimData.screenFlash = weapons.fxs?.screenFlashAlpha || 0;
    // calor (MG/AC) o barrido de enfriamiento (resto)
    const heating = Boolean(fxDef.heat);
    aimData.heat.value = heating ? st.heat[w] : 0;
    aimData.heat.overheated = heating && st.overheat > 0;
    aimData.heat.lockout = heating ? st.overheat : 0;
    const cd = prof.rate ?? prof.cd ?? 0.5;
    aimData.cooldown.value = heating ? 1 : Math.max(0, Math.min(1, 1 - st.cool / cd));
    aimData.cooldown.ready = st.cool <= 0 && st.ammo[w] >= 1;
    aimData.charge.active = Boolean(st.charge);
    aimData.charge.progress = st.charge?.progress || 0;
    // pipper de ventaja (MG, AC, SWARM contra enemigos): punto de apuntado que incluye caída y movimiento
    const lead = aimData.lead;
    lead.active = false;
    if (w === 'mg' || w === 'ac' || w === 'sw') {
      let best = null; let bestAngle = Infinity;
      camera.getWorldDirection(aimDirection);
      const muzzle = muzzleWorld(0);
      for (const t of enemyTargets()) {
        const vel = velocities.update(t, t.center, rdt);
        const ev = evaluateLead({
          muzzle, cameraPos: camera.position, cameraDir: aimDirection, target: t.center, targetVel: vel,
          speed: prof.speed, gravity: prof.gravity || 0, range: LEAD.range, cone: LEAD.cone,
        });
        if (!ev) continue;
        const ang = angleBetween(aimDirection, { x: ev.aim.x - camera.position.x, y: ev.aim.y - camera.position.y, z: ev.aim.z - camera.position.z });
        if (ang < bestAngle) { bestAngle = ang; best = { t, ev }; }
      }
      if (best) {
        const r = Math.max(0.5, best.t.radius || 1);
        const tol = Math.max(LEAD.tolerance, Math.atan2(r * 0.6, best.ev.distance));
        lead.active = true;
        lead.world = xyz(best.ev.aim); lead.intercept = xyz(best.ev.intercept);
        lead.time = best.ev.time; lead.range = best.ev.range; lead.distance = best.ev.distance; lead.target = best.t;
        lead.onTarget = dwell.step(rdt, bestAngle, tol);
        lead.drop = best.ev.drop;
      } else dwell.reset();
    } else dwell.reset();
    // lock / swarm
    const lk = aimData.lock;
    lk.state = lockTracker.state; lk.progress = lockTracker.progress; lk.target = lockTracker.target;
    lk.world = lockTracker.target ? xyz(lockTracker.target.center) : null;
    lk.radius = lockTracker.target ? (lockTracker.target.radius || 1) : 0;
    aimData.swarm.targets = swarm.targets.map(t => ({ target: t, world: xyz(t.center), radius: t.radius || 1 }));
    // NOVA: radio de daño proyectable en el punto de impacto
    aimData.nova.point = family === 'tb' ? aimData.point : null;
    aimData.missile.drop = family === 'm' && aimData.distance ? bulletDrop(prof.speed, prof.gravity || 0, aimData.distance) : 0;
  }

  Object.assign(fx, {
    weapons, weaponModels, shake, aim, doFire, resolveCombatAim,
    aimData, project,
    weaponList: WEAPON_UI_KEYS.map(key => ({ key, ...WEAPON_UI[key] })),
    timeScale: () => (hitstop ? hitstop.scale() : 1),
    hitstop, shakeModel, lock: lockTracker,
    /** Cambia de arma (modelo 3D incluido). La parte de UI vive en ui/weapons-ui.js setWeapon. */
    selectWeapon(k) {
      weapons.setWeapon(k);
      fx.selectedWeaponKey = weapons.state.weapon;
      void fx.selectWeaponModel(fx.selectedWeaponKey);
      if (V2) { pending = null; resetLock(); audio?.ui?.('weapon'); }
    },
    /** weapons.update (congelado mientras hay un overlay abierto). */
    update(dt, gamePaused) {
      const allHit = ctx.enemies.hittables();
      if (!gamePaused) weapons.update(dt * (V2 ? hitstop.scale() : 1), allHit);
      if (!gamePaused && V2) tickPending(dt);
    },
    /** Tras la horda: ganchos QA por URL (?fuego, ?boom) y auto-disparo del gatillo. */
    afterUpdate() {
      if (Q.get('fuego') === 'mg' && S.simT > 1 && S.simT < 2.6) {
        if (!weapons._mg) { weapons._mg = true; weapons.setWeapon('mg'); }
        doFire();
      } else if (Q.get('fuego') && S.simT > 1 && !weapons.state.fired) {
        doFire();
      }
      if (Q.get('boom') && S.simT > 5.2 && !weapons._boomed) {
        weapons._boomed = true;
        const drone = ctx.drone;
        const bx = drone.pos.x - Math.sin(drone.yaw) * 6;
        const bz = drone.pos.z - Math.cos(drone.yaw) * 6;
        const bgy = terrain.heightAt(bx, bz) ?? (drone.pos.y - 60);
        weapons.explodeAt(new THREE.Vector3(bx, bgy + 0.3, bz));
      }
      const fixedWeapon = ARSENAL[weapons.state.weapon];
      if (S.firing && fixedWeapon.auto) doFire();
    },
    /** Volcado a window.__volar (armas + estado del gatillo). */
    report() {
      report.weapons = {
        fired: weapons.state.fired,
        exploded: weapons.state.exploded,
        structure_hits: weapons.state.structureHits,
        terrain_hits: weapons.state.terrainHits,
        boundary_hits: weapons.state.boundaryHits,
        item_hits: weapons.state.itemHits,
        target_hits: weapons.state.targetHits,
        proximity_triggers: weapons.state.proximityTriggers,
        occluded_fuses: weapons.state.occludedFuses,
        rail_hits: weapons.state.railHits,
        projectiles: weapons.state.missiles.length
          + weapons.state.bullets.length
          + weapons.state.schedules.length,
        fired_projectiles: { ...weapons.state.firedProjectiles },
        models: weaponModels.snapshot(),
        effects: weapons.effects.snapshot(),
        pools: weapons.state.effectCounters,
        resources: { ...weapons.state.resources },
        impact: weapons.state.impactEvidence,
        lod: { ...weapons.state.lod },
      };
      if (V2) {
        report.weapons.v2 = {
          hits: weapons.state.hits, kills: weapons.state.kills,
          shake: shakeModel.stats(), hitstop: hitstop.stats(),
          heat: { ...weapons.state.heat }, overheat: weapons.state.overheat,
          draw_calls_fx: weapons.fxs.snapshot().drawCalls,
        };
        report.aimData = {
          weapon: aimData.weapon, class: aimData.class, kind: aimData.kind, distance: +aimData.distance.toFixed(1),
          lead: aimData.lead.active, lock: aimData.lock.state, heat: +aimData.heat.value.toFixed(2),
        };
      }
      report.weaponState = { weapon: weapons.state.weapon, cool: +weapons.state.cool.toFixed(2),
        ammo: Object.fromEntries(Object.entries(weapons.state.ammo).map(([k2, n2]) => [k2, Math.floor(n2)])),
        trigger: { ...ctx.trigger } };
    },
    /** Retícula de impacto + sacudida de cámara (tras fijar la pose de cámara; antes de qaPose/composer). */
    render(rdt) {
      // Reticle and launch direction share the same camera-center ray. This
      // avoids gimbal-yaw drift and keeps the hardpoint converged on the hit.
      const reticleHit = !S.director ? resolveCombatAim() : null;
      if (V2) {
        // retícula de pantalla: sólo datos (fx.aimData) — nada se dibuja en el mundo
        aim.visible = false;
        updateAimData(reticleHit, rdt);
        report.aim = reticleHit && reticleHit.kind !== 'none' ? {
          kind: reticleHit.kind, point: { ...reticleHit.point }, normal: { ...reticleHit.normal },
          distance: +reticleHit.distance.toFixed(2),
        } : (reticleHit ? { kind: 'none', distance: +reticleHit.distance.toFixed(2) } : null);
        hitstop.step(rdt);
        shakeModel.step(rdt);
        shake.mag = shakeModel.trauma;
        if (shakeModel.trauma > 0) {
          const o = shakeOffsets(shakeModel.trauma, performance.now() / 1000);
          camera.translateX(o.x); camera.translateY(o.y);
          camera.rotateX(o.pitch); camera.rotateY(o.yaw); camera.rotateZ(o.roll);
        }
        return;
      }
      // (El modo Director no tiene retícula: reticleHit es null.)
      if (reticleHit && reticleHit.kind !== 'none') {
        const hitP = new THREE.Vector3(reticleHit.point.x, reticleHit.point.y, reticleHit.point.z);
        aim.visible = true;
        aim.position.copy(hitP);
        aim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(
          reticleHit.normal.x, reticleHit.normal.y, reticleHit.normal.z,
        ));
        aim.scale.setScalar((1 + Math.sin(S.simT * 6) * 0.1) * (1 + camera.position.distanceTo(hitP) * 0.015));
        report.aim = {
          kind: reticleHit.kind,
          point: { ...reticleHit.point },
          normal: { ...reticleHit.normal },
          distance: +reticleHit.distance.toFixed(2),
        };
      } else {
        aim.visible = false;
        report.aim = reticleHit ? { kind: 'none', distance: +reticleHit.distance.toFixed(2) } : null;
      }
      if (shake.mag > 0.003) {                 // sacudida de impacto (decae)
        camera.position.x += (Math.random() - 0.5) * shake.mag;
        camera.position.y += (Math.random() - 0.5) * shake.mag * 0.6;
        camera.rotation.z += (Math.random() - 0.5) * shake.mag * 0.02;
        shake.mag *= Math.pow(0.02, rdt); // ~decadencia 98%/s
      } else shake.mag = 0;
    },
    /** Oído en la cámara: distancia y paneo del dron relativo al rig activo. */
    audioFrame(spd) {
      const drone = ctx.drone;
      const lpv = camera.worldToLocal(P.clone());
      const camDist = lpv.length();
      audio.update(ctx.droneModel.spin, spd, drone.vel.y, camDist,
        lpv.x / Math.max(camDist, 0.001));
    },
    dispose() {
      offCrash?.();
      weapons.dispose();
      weaponModels.dispose();
    },
  });

  // ── ?fv=2: eventos de otros workstreams → FX / audio ───────────────────────────
  let offCrash = null;
  if (V2) {
    audio?.attach?.({
      bus,
      listener: () => {
        const e = camera.matrixWorld.elements;
        _right.x = e[0]; _right.y = e[1]; _right.z = e[2];
        return { pos: camera.position, right: _right };
      },
      motors: () => {
        const sim = ctx.drone?.v2?.sim;
        if (!ctx.drone?.v2?.active || !sim?.s?.m) return null;
        const s = sim.s; const env = sim.env;
        const va = env ? Math.hypot(s.v[0] - env.wx, s.v[1] - env.wy, s.v[2] - env.wz) : sim.speed;
        return { m: s.m, va, gust: sim.wind?.gust || 0, integrity: s.integrity };
      },
    });
    // choque del jugador: polvo + fragmentos + sacudida según clase de energía (C emite 'crash')
    offCrash = bus.on('crash', ({ energyClass } = {}) => {
      const cls = String(energyClass || 'soft');
      if (cls === 'bounce') return;
      const g = terrain.heightAt(P.x, P.z);
      const pos = { x: P.x, y: Math.max(P.y - 0.2, (g ?? P.y) + 0.25), z: P.z };
      const severity = cls === 'crash' ? 1.4 : cls === 'prop' ? 1 : 0.6;
      weapons.fxs.crash({ pos, normal: { x: 0, y: 1, z: 0 }, severity });
      if (cls === 'crash') addShake('T3', 0.18, null);
      else if (cls === 'prop') addShake('T2', 0.08, null);
      else addShake('T1', 0.04, null);
    });
    // bus 'kill' sólo si A lo añade a BUS_EVENTS (los kills viajan en hit{kill:true})
    if (Object.prototype.hasOwnProperty.call(BUS_EVENTS, 'kill')) {
      bus.on('hit', d => { if (d?.kill) bus.emit('kill', d); });
    }
  }
  void fx.selectWeaponModel(weapons.state.weapon);
  return fx;
}
