// flightverse/fx/index.js — punto de instalación del workstream B (armas, proyectiles,
// FX, impactos, sacudida, audio). installFx(ctx) es ASYNC (carga GLTFLoader para los
// modelos de arma) y debe correr tras crear scene/camera/terrain/collision/audio y
// ANTES de installEnemies (la horda usa weapons.explodeAt).
//
// Publica en ctx.fx:
//   weapons, weaponModels, shake{mag,fov}, aim (retícula 3D), selectedWeaponKey,
//   selectWeaponModel(key), selectWeapon(key), doFire(), resolveCombatAim(),
//   update(dt, gamePaused), afterUpdate(), report(), render(rdt), audioFrame(spd), dispose()
// Emite en el bus: fire{weapon,origin,dir}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento; B añade aquí
// (y en fx/*.js) el resto de la biblioteca FX.
import { createWeapons, ARSENAL } from '/flightverse/weapons.js?v=367';
import { resolveAimRay } from '/flightverse/aiming.js?v=367';
import { createWeaponModelLibrary } from '/flightverse/weapon-models.js?v=367';
import { reducedMotion } from '/flightverse/vegetation.js?v=367';

export async function installFx(ctx) {
  const {
    THREE, scene, camera, report, Q, terrain, collision, audio, state: S, bus, P, flags,
  } = ctx;
  const fx = ctx.fx;
  // ── armamento: misiles + explosiones + destrucción (X o botón FIRE) ──
  const shake = { mag: 0 };
  const weaponModelErrors = new Set();
  const { GLTFLoader: ArsenalGLTFLoader } = await import(
    '/vendor/three-addons180/loaders/GLTFLoader.js?v=367'
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
  const weapons = createWeapons(scene, {
    world: collision, heightAt: terrain.heightAt, audio, crater: terrain.crater,
    getCameraPosition: () => camera.position,
    effectTier: flags.coarse
      ? (Math.min(innerWidth, innerHeight) < 700 ? 'phone' : 'tablet')
      : 'desktop',
    cloneProjectile: key => weaponModels?.cloneProjectile(key),
    onDestroy: node => S.sceneObjects?.markDestroyed(node),
    onShake: (pos, big) => {
      if (reducedMotion()) return;               // sacudida y patada de FOV son movimiento no esencial
      const d = camera.position.distanceTo(pos);
      shake.mag = Math.max(shake.mag, Math.min(0.9, (9 * big) / (5 + d)));
      shake.fov = Math.max(shake.fov || 0, Math.min(7, (26 * big) / (4 + d)));
    },
  });
  // report.weaponState se escribe VIVO en el loop (aquí era snapshot de boot)
  // retícula de impacto: simula la balística y marca dónde caerá el misil
  const aim = new THREE.Group();
  {
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
  const doFire = () => {
    if (ctx.ui.overlay?.active()) return false;
    // si el GLB trae hardpoints, el misil sale del siguiente en turno
    const hardpoints = ctx.droneModel.hardpoints;
    const hp = hardpoints.length
      ? hardpoints[weapons.state.fired % hardpoints.length].getWorldPosition(new THREE.Vector3())
      : P.clone();
    const target = resolveCombatAim();
    if (!weapons.fire(hp, { aimPoint: target.point, target: target.target || null })) return false;
    ctx.ui.weapons.flashFire();
    bus.emit('fire', { weapon: weapons.state.weapon, origin: hp, dir: aimDirection.clone() });
    return true;
  };

  Object.assign(fx, {
    weapons, weaponModels, shake, aim, doFire, resolveCombatAim,
    /** Cambia de arma (modelo 3D incluido). La parte de UI vive en ui/weapons-ui.js setWeapon. */
    selectWeapon(k) {
      weapons.setWeapon(k);
      fx.selectedWeaponKey = weapons.state.weapon;
      void fx.selectWeaponModel(fx.selectedWeaponKey);
    },
    /** weapons.update (congelado mientras hay un overlay abierto). */
    update(dt, gamePaused) {
      const allHit = ctx.enemies.hittables();
      if (!gamePaused) weapons.update(dt, allHit);
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
      report.weaponState = { weapon: weapons.state.weapon, cool: +weapons.state.cool.toFixed(2),
        ammo: Object.fromEntries(Object.entries(weapons.state.ammo).map(([k2, n2]) => [k2, Math.floor(n2)])),
        trigger: { ...ctx.trigger } };
    },
    /** Retícula de impacto + sacudida de cámara (tras fijar la pose de cámara; antes de qaPose/composer). */
    render(rdt) {
      // Reticle and launch direction share the same camera-center ray. This
      // avoids gimbal-yaw drift and keeps the hardpoint converged on the hit.
      const reticleHit = !S.director ? resolveCombatAim() : null;
      if (reticleHit?.kind !== 'none') {
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
      weapons.dispose();
      weaponModels.dispose();
    },
  });
  void fx.selectWeaponModel(weapons.state.weapon);
  return fx;
}
