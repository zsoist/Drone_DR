// flightverse/modes/invasion-mode.js — MODO INVASIÓN: horda enemiga, vida del jugador,
// arranque/parada, récords, victoria y derrota (WS D). La presentación (selector, panel de
// oleada, tarjetas) vive en ui/*; aquí solo lógica y datos.
//
// Con ?fv=2 (ctx.flags.fv2) se activa la Invasión "justa": oleadas 1→10 con rampa y VICTORIA,
// daño con gracia de 3 s / invulnerabilidad de 5 s al reaparecer / 3 vidas, telégrafos ≥ 0.5 s,
// proyectiles que respetan los edificios, marcadores y flechas de amenaza, puntuación y top-10.
// Sin el flag el comportamiento es el legado (oleadas infinitas, 1 vida).
import * as THREE from '/flightverse/three.js?v=370';
import { createInvasion, ENEMIES } from '/flightverse/invasion.js?v=370';
import { summarizeInvasionRun } from '/flightverse/hud-format.js?v=370';
import {
  FAIR, VICTORY_WAVE, TYPE_INTRO, createPlayerVitals, fairHitDamage, computeMarkers,
  unlockedTypes, waveBonus, invasionMedal, hasLineOfSight,
} from '/flightverse/invasion-policy.js?v=370';
import { addRecord, getTop } from '/flightverse/modes/rules.js?v=370';
import { showVictoryFallback } from '/flightverse/modes/result-cards.js?v=370';

const BOSS_NAME = { dragon: 'DRAGÓN', gigante: 'GIGANTE' };
const TYPE_LABEL = { zombie: 'Zombis', arquero: 'Arqueros', soldado: 'Soldados', avion: 'Aviones', ufo: 'OVNIs', dragon: 'Dragón', gigante: 'Gigante' };

export function createInvasionMode(ctx, events) {
  const {
    scene, terrain, audio, report, Q, CID, state: S, actions: A, bus, P, flags, fx,
  } = ctx;
  const { weapons } = fx;
  const v2 = !!flags.fv2;

  // ── vida del jugador ──
  const health = { hp: 100, lives: FAIR.lives, invulnerable: false, protect: false };
  const vitals = createPlayerVitals();
  if (report.qa) report.qa.health = health;         // ?qa=1: permite forzar derrota en pruebas
  const invasionTier = flags.coarse || (navigator.deviceMemory || 4) <= 4
    ? 'low'
    : (navigator.deviceMemory || 8) >= 8 && (navigator.hardwareConcurrency || 4) >= 8
      ? 'high' : 'medium';

  const run = { livesLost: 0, startedAt: 0, lastWaveEvent: 0 };
  let banner = null;
  let warnUntil = 0;
  let warnedAt = -99;
  let lastPhase = 'idle';
  let introFor = 0;                                // oleada cuya intro ya se mostró
  let outcomeHandled = false;
  const lastTelegraph = { at: -99, info: null };
  const packs = [];
  let packMesh = null;
  const markerState = { markers: [], edges: [], boss: null, t: 0 };
  let markerEmitAcc = 0;
  const cameraInv = new THREE.Matrix4();
  const arcs = [];
  /** Arco de daño/telégrafo: ángulo en pantalla (0 = derecha, +π/2 = arriba) hacia un punto del mundo. */
  function pushArc(worldPos, kind) {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const v = worldPos.clone().applyMatrix4(cameraInv.copy(cam.matrixWorld).invert());
    const ang = Math.atan2(v.y * 0.6 - 0.0, v.x);
    // detrás de la cámara (z>0) conserva el lado; encima/debajo puros → abajo
    arcs.push({ angle: Math.abs(v.x) < 1e-3 && Math.abs(v.y) < 1e-3 ? -Math.PI / 2 : ang, t0: performance.now(), kind });
    while (arcs.length > 3) arcs.shift();
  }

  function applyDamage(raw, info = {}) {
    if (!v2) {                                       // legado: daño plano sin gracia
      health.hp = Math.max(0, health.hp - raw);
      ctx.ui.hud.hitFlash();
      audio.crash?.();
      bus.emit('damage', { amount: raw, dir: null, source: 'invasion' });
      return;
    }
    if ((ctx.phys?.invuln || 0) > 0) {                // C: 1,75 s de invulnerabilidad tras reaparecer (mesh parpadea)
      events.emit('damage-blocked', { reason: 'phys-invuln', type: info.type || null });
      return;
    }
    const dmg = fairHitDamage(raw, invasion.state.difficulty, invasion.state.wave, vitals.state.maxHp);
    const r = vitals.hit(dmg, S.simT);
    if (r.applied > 0) {
      health.hp = vitals.state.hp;
      ctx.ui.hud.hitFlash();
      audio.crash?.();
      events.emit('damage', { amount: +r.applied.toFixed(1), dir: info.dir || null, source: info.type || 'invasion', hp: +health.hp.toFixed(1) });
      if (health.hp <= 30 && health.hp > 0) events.emit('warn', { kind: 'lowhp', text: 'Integridad baja' });
    } else {
      events.emit('damage-blocked', { reason: r.blocked, type: info.type || null });
    }
  }

  const invasion = createInvasion(scene, {
    v2,
    collision: v2 ? ctx.collision : null,
    heightAt: terrain.heightAt, audio, deviceTier: invasionTier,
    onHit: (dmg, info) => applyDamage(dmg, info),
    onTelegraph: info => {
      lastTelegraph.at = S.simT; lastTelegraph.info = info;
      pushArc(info.pos, 'telegraph');
      audio.tick?.();
      events.emit('telegraph', info);
    },
    onEvent: (type, d) => onInvasionEvent(type, d),
    fx: {
      impact: pos => weapons.explodeAt(pos, 0.5),
      explode: (pos, big) => weapons.explodeAt(pos, big),
    },
  });
  weapons.state._enemies = invasion.hittables;     // splash de explosión a la horda
  if (report.qa) report.qa.invasion = invasion;     // ?qa=1: inspección de la horda en pruebas

  // ── eventos de la run (oleada / muerte / victoria) ──
  function setBanner(text, sub, dur = 2.4, color) {
    banner = { text, sub, dur, t0: performance.now(), color };
    S.modeBeat = { text, sub, dur, at: S.simT };
  }
  function onInvasionEvent(type, d) {
    if (type === 'wave-start') {
      vitals.startWave(S.simT);
      const fresh = (d.types || []).filter(t => TYPE_INTRO[t] === d.n);
      events.emit('wave', { n: d.n, phase: 'start', types: d.types, count: d.count, fresh });
    } else if (type === 'wave-clear') {
      const bonus = waveBonus(d.n, vitals.state.damageThisWave === 0);
      invasion.state.score += bonus;
      invasion.state.waveBonusTotal = (invasion.state.waveBonusTotal || 0) + bonus;
      events.emit('score', { score: invasion.state.score, gained: bonus, combo: 0, reason: 'wave-clear' });
      events.emit('wave', { n: d.n, phase: 'clear', bonus });
      setBanner(`OLEADA ${d.n} SUPERADA`, `+${bonus} pts${vitals.state.damageThisWave === 0 ? ' · sin daño' : ''}`, 2.4, '#52C79A');
      if (d.n % FAIR.healthPackEveryWaves === 0) spawnPack();
    } else if (type === 'kill') {
      events.emit('score', { score: d.score, gained: d.gained, combo: d.combo, reason: 'kill', type: d.type });
    } else if (type === 'victory') {
      // la resolución (tarjeta, récord) ocurre en update() para no demoler la horda dentro de su propio paso
    }
  }

  // ── kits de reparación azules: +25 HP, uno cada 2 oleadas ──
  function spawnPack() {
    const drone = ctx.drone;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * 6.283, r = 28 + Math.random() * 22;
      const pos = new THREE.Vector3(drone.pos.x + Math.cos(a) * r, 0, drone.pos.z + Math.sin(a) * r);
      const g = terrain.heightAt(pos.x, pos.z);
      if (g == null) continue;
      pos.y = Math.max(g + 4, drone.pos.y);
      if (ctx.collision?.castSegment && ctx.collision.castSegment(drone.pos, pos, 0.8)) continue;
      if (ctx.collision?.closest?.(pos, 3)) continue;
      addPack(pos);
      return true;
    }
    addPack(drone.pos.clone().add(new THREE.Vector3(0, 0, -14)));
    return false;
  }
  function addPack(pos) {
    if (!packMesh) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x45A0E6 }));
      const barA = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const barB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      g.add(body, barA, barB);
      packMesh = g;
    }
    const m = packMesh.clone();
    m.position.copy(pos);
    scene.add(m);
    packs.push({ m, t: 0, pos: pos.clone() });
    events.emit('pack', { phase: 'spawn', pos: pos.clone() });
  }
  function updatePacks(dt) {
    const drone = ctx.drone;
    for (let i = packs.length - 1; i >= 0; i--) {
      const k = packs[i];
      k.t += dt;
      k.m.rotation.y += dt * 1.4;
      k.m.position.y = k.pos.y + Math.sin(k.t * 2) * 0.35;
      if (drone.pos.distanceTo(k.m.position) < 3.2) {
        vitals.heal(FAIR.healthPackHp);
        health.hp = vitals.state.hp;
        events.emit('pack', { phase: 'pickup', hp: health.hp, amount: FAIR.healthPackHp });
        setBanner(`+${FAIR.healthPackHp} integridad`, null, 1.4, '#45A0E6');
        removePack(i);
      } else if (k.t > 60) removePack(i);
    }
  }
  function removePack(i) {
    const k = packs[i];
    scene.remove(k.m);
    k.m.traverse(o => o.geometry && null);
    packs.splice(i, 1);
  }
  function clearPacks() { for (let i = packs.length - 1; i >= 0; i--) removePack(i); }

  // ── récords / arranque / parada ──
  const invBestKey = () => `ab.fv.best.${CID}.invasion`;
  const invReadBest = () => {
    try {
      const val = JSON.parse(localStorage.getItem(invBestKey()) || 'null');
      return val && Number.isFinite(val.score) ? val : null;
    } catch { return null; }
  };
  const resetVitals = () => {
    health.hp = 100; health.lives = FAIR.lives; health.invulnerable = false;
    Object.assign(vitals.state, {
      hp: 100, lives: FAIR.lives, lastHitT: -Infinity, invulnUntil: -Infinity, protectUntil: -Infinity,
      lastMoveT: S.simT, hitsTaken: 0, hitsBlocked: 0, damageThisWave: 0,
    });
  };
  const stopUi = () => {
    ctx.ui.setInvasionUi(false);
    resetVitals();
    clearPacks();
    banner = null;
  };
  const beginRun = (types, difficulty) => {
    outcomeHandled = false;
    lastPhase = 'idle';
    run.livesLost = 0; run.startedAt = S.simT;
    resetVitals();
    clearPacks();
    invasion.toggle(P, types, difficulty);
    ctx.ui.setInvasionUi(true);
    ctx.ui.hud.updateInvasionHud?.(invasion.state, health);
    events.emit('game-mode', { key: 'invasion', phase: 'start', difficulty: invasion.state.difficulty, types: [...invasion.state.types] });
  };
  const startRun = (types, difficulty) => {
    if (invasion.state.on) return;
    ctx.ui.overlay?.close('result');
    beginRun(types, difficulty);
  };

  function buildRun(victory) {
    const st = invasion.state;
    const prev = invReadBest();
    const base = summarizeInvasionRun(st, prev);
    base.victory = !!victory;
    base.wavesCleared = st.wavesCleared || 0;
    base.livesLost = run.livesLost;
    base.medal = invasionMedal({ wavesCleared: base.wavesCleared, livesLost: run.livesLost, victory });
    base.lives = Math.max(0, health.lives);
    if (v2) {
      const rec = addRecord(localStorage, {
        world: CID, mode: 'invasion', difficulty: st.difficulty, score: base.score, medal: base.medal,
      });
      base.rank = rec.rank; base.top = rec.list;
    }
    if (base.newBest) {
      try {
        localStorage.setItem(invBestKey(), JSON.stringify({ score: base.score, wave: base.wave, killed: base.killed }));
      } catch { /* almacenamiento bloqueado: la pantalla igual se muestra */ }
    }
    return base;
  }

  const showDefeat = () => {
    if (outcomeHandled) return;
    outcomeHandled = true;
    const summary = buildRun(false);
    S.lastInvasionRun = summary;
    S.resultShown = false;                    // la tarjeta de Gate Rush ya no está en #vl-result
    (report.invasionRuns ||= []).push({ ...summary, at: +S.simT.toFixed(2) });
    invasion.toggle(P);                       // apaga la run: sin enemigos ni proyectiles vivos
    stopUi();
    A.releaseFiring();
    if (v2) {
      events.emit('defeat', { wave: summary.wave, score: summary.score, killed: summary.killed, medal: summary.medal, rank: summary.rank });
      if (summary.medal) events.emit('medal', { id: `invasion:${summary.difficulty}`, level: summary.medal, mode: 'invasion', medal: summary.medal, wave: summary.wave });
    }
    ctx.ui.screens.showDefeat(summary);
  };
  const showVictory = () => {
    if (outcomeHandled) return;
    outcomeHandled = true;
    const summary = buildRun(true);
    S.lastInvasionRun = summary;
    S.resultShown = false;
    (report.invasionRuns ||= []).push({ ...summary, at: +S.simT.toFixed(2) });
    invasion.toggle(P);
    stopUi();
    A.releaseFiring();
    events.emit('victory', { wave: summary.wave, score: summary.score, killed: summary.killed, medal: summary.medal, rank: summary.rank, livesLost: summary.livesLost });
    if (summary.medal) events.emit('medal', { id: `invasion:${summary.difficulty}`, level: summary.medal, mode: 'invasion', medal: summary.medal, wave: summary.wave });
    if (ctx.ui.screens.showVictory) ctx.ui.screens.showVictory(summary);
    else showVictoryFallback(ctx, summary);
  };

  /** Pierde una vida: reaparece con vida llena y 5 s de invulnerabilidad, o derrota si no quedan. */
  function loseLife() {
    lastLifeAt = S.simT;
    run.livesLost += 1;
    invasion.clearShots();
    if (vitals.respawn(S.simT)) {
      health.hp = vitals.state.hp; health.lives = vitals.state.lives;
      events.emit('life', { lives: health.lives, hp: health.hp, invulnerableS: FAIR.respawnInvulnS });
      setBanner('Dron reparado', `${health.lives} ${health.lives === 1 ? 'vida restante' : 'vidas restantes'}`, 2.2, '#E0A458');
    } else {
      health.lives = 0;
      showDefeat();
    }
  }

  /** Oferta de reposicionamiento: mueve al dron a un punto cubierto lejos de la horda. */
  function repositionDrone() {
    const drone = ctx.drone;
    const rows = invasion.enemyRows();
    let best = null, bestScore = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, r = 35;
      const cand = new THREE.Vector3(drone.pos.x + Math.cos(a) * r, drone.pos.y, drone.pos.z + Math.sin(a) * r);
      const g = terrain.heightAt(cand.x, cand.z);
      if (g == null || cand.y < g + 6) cand.y = (g ?? drone.pos.y) + 10;
      if (ctx.collision?.castSegment?.(drone.pos, cand, 1.0)) continue;
      if (ctx.collision?.closest?.(cand, 4)) continue;
      let nearest = Infinity;
      for (const e of rows) nearest = Math.min(nearest, e.pos.distanceTo(cand));
      if (nearest > bestScore) { bestScore = nearest; best = cand; }
    }
    if (!best) return false;
    drone.prev.pos.copy(drone.pos);
    drone.pos.copy(best); drone.prev.pos.copy(best);
    drone.vel.set(0, 0, 0);
    events.emit('reposition', { pos: best.clone() });
    return true;
  }

  /** QA: empieza en la oleada n (no cambia la fase si la precarga sigue en curso). */
  function forceWave(n) {
    invasion.state.wave = Math.max(0, n - 1);
    if (invasion.state.phase === 'running' || invasion.state.phase === 'clear') { invasion.state.phase = 'countdown'; invasion.state.countdown = 0.2; }
  }

  if (report.qa) {
    report.qa.modes = {
      vitals,
      killAll() { for (const e of invasion.hittables) { e.hp = 0; e.g.userData.dead = true; } },
      setWave: n => forceWave(n),
      repositionDrone, loseLife, spawnPack, markerState, packs,
    };
  }

  let qaInvasionStarted = false;
  // Calentamiento progresivo de assets de enemigos (módulos + catálogo + bytes GLB + texturas de detalle) en huecos de
  // inactividad, DESPUÉS de cargar el mundo: así "Iniciar invasión" no paga descarga/parseo/texturas de golpe.
  const conn = navigator.connection || {};
  const slowNet = !!conn.saveData || /(^|-)(2|3)g$/.test(conn.effectiveType || '');
  const warmTimer = setTimeout(() => { invasion.prewarm(['zombie']); }, 4000);
  // C: un choque que destruye el dron (evento `respawn`) cuesta UNA vida. Si la horda ya la quitó hace un momento
  // (hp<=0 -> loseLife) o el respawn ya descontó, no se cuenta dos veces.
  let lastLifeAt = -99;
  if (v2) {
    bus.on('respawn', () => {
      if (!invasion.state.on || outcomeHandled || S.simT - lastLifeAt < 1.5) return;
      loseLife();
    });
  }
  let lastWave = 0;

  function computeMarkerState() {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cameraInv.copy(cam.matrixWorld).invert();
    const v = new THREE.Vector3();
    const project = pos => {
      v.copy(pos).applyMatrix4(cameraInv);
      const behind = v.z > -0.05;
      v.copy(pos).project(cam);
      return { x: v.x, y: v.y, behind };
    };
    const rows = invasion.enemyRows();
    const out = computeMarkers({
      enemies: rows, player: ctx.drone.pos, project,
      maxMarkers: flags.coarse ? 6 : 10, maxEdge: 3, maxDist: 300,
    });
    let boss = null;
    for (const r of rows) {
      if (r.boss && (!boss || r.hpFrac < boss.hpFrac || true)) boss = { name: BOSS_NAME[r.type] || r.type.toUpperCase(), hpFrac: r.hpFrac, id: r.id };
    }
    markerState.markers = out.markers; markerState.edges = out.edges; markerState.boss = boss; markerState.t = S.simT;
    return markerState;
  }

  return {
    health, invasion, vitals, markerState, repositionDrone,
    /** Botón "Modo Invasión" del dock: apaga si está activa; si no, abre el selector. */
    onButton() {
      if (invasion.state.on) {                       // apagar directo
        invasion.toggle(P);
        stopUi();
        return;
      }
      invasion.prewarm(slowNet ? ['zombie'] : Object.keys(ENEMIES));   // mientras elige, se van trayendo los demás
      ctx.ui.overlay?.toggle('invasion');            // elegir enemigos
    },
    /** "INICIAR INVASIÓN" del selector. */
    startFromPicker(types, difficulty) {
      ctx.ui.overlay?.close('invasion');
      beginRun(types, difficulty);
    },
    startRun, showDefeat, showVictory, stopUi,
    /** Detiene la run (selector de modos): apaga la horda y limpia UI sin pantalla de resultado. */
    stopRun() {
      if (!invasion.state.on) return false;
      invasion.toggle(P);
      stopUi();
      return true;
    },
    /** Hittables de la horda + objetos de escena (para armas y apuntado). */
    hittables() {
      return invasion.state.on
        ? [...(S.sceneObjects?.hittables || []), ...invasion.hittables]
        : S.sceneObjects?.hittables;
    },
    /** Por paso fijo (tras weapons.update): arranque QA por URL, horda, derrota/victoria, eventos. */
    update(dt, gamePaused) {
      const drone = ctx.drone;
      if (Q.get('invasion') && !invasion.state.on && S.simT > 0.5 && !qaInvasionStarted) {
        qaInvasionStarted = true;               // solo una vez: si no, tras la derrota la URL reinicia la run detrás de la pantalla
        invasion.toggle(
          drone.pos,
          Q.get('invasion').split(',').filter(k => ENEMIES[k]),
          Q.get('invDifficulty') || 'media',
        );
        resetVitals(); outcomeHandled = false;
        ctx.ui.setInvasionUi(true);
        if (v2 && Number(Q.get('invWave')) > 1) forceWave(Number(Q.get('invWave')));
      }
      if (!gamePaused) invasion.update(dt, drone.pos, drone.vel);
      if (!invasion.state.on) { introFor = 0; return; }
      const st = invasion.state;
      if (v2) {
        vitals.noteMove(S.simT, drone.vel.length());
        health.invulnerable = vitals.invulnerable(S.simT);
        health.protect = S.simT < vitals.state.protectUntil;
        health.hp = vitals.state.hp;
        if (!gamePaused) updatePacks(dt);
        if (vitals.shouldWarnMove(S.simT) && S.simT - warnedAt > 10) {
          warnedAt = S.simT; warnUntil = performance.now() + 3500;
          events.emit('warn', { kind: 'move', text: 'Muévete', offer: 'reposition' });
        }
        if (st.phase !== lastPhase) {
          // La intro de oleada sale en cuanto arranca la run ('loading'), mientras se cargan los modelos; al pasar a
          // 'countdown' no se repite para la misma oleada.
          if (st.phase === 'countdown' || st.phase === 'loading') {
            const n = st.wave + 1;
            if (introFor !== n) {
              introFor = n;
              const types = unlockedTypes(st.types, n);
              const fresh = types.filter(t => TYPE_INTRO[t] === n || (n === 1));
              events.emit('wave', { n, phase: 'intro', types, fresh, total: VICTORY_WAVE });
              setBanner(`OLEADA ${n}`, fresh.length && n > 1 ? `Nuevo: ${fresh.map(t => TYPE_LABEL[t]).join(', ')}` : (n === VICTORY_WAVE ? 'Última oleada' : `de ${VICTORY_WAVE}`), 2.6);
            }
          }
          lastPhase = st.phase;
        }
        if (st.phase === 'victory') { showVictory(); return; }
        if (health.hp <= 0) loseLife();
      } else if (health.hp <= 0) showDefeat();       // HP a 0: pantalla de derrota (no un toast)
      if (st.wave !== lastWave) {
        lastWave = st.wave;
        if (!v2 && lastWave > 0) bus.emit('wave', { n: lastWave });
      }
    },
    /** Volcado a window.__volar. */
    report() {
      const st = invasion.state;
      report.invasion = {
        on: st.on,
        phase: st.phase,
        wave: st.wave,
        alive: st.alive,
        queued: st.queue.length,
        killed: st.killed,
        score: st.score,
        combo: st.combo,
        countdown: +st.countdown.toFixed(2),
        difficulty: st.difficulty,
        types: [...st.types],
        telemetry: st.telemetry,
        ...(v2 ? {
          v2: true, hp: +health.hp.toFixed(1), lives: health.lives, invulnerable: health.invulnerable,
          protect: health.protect, victoryWave: VICTORY_WAVE, wavesCleared: st.wavesCleared || 0,
          hitsTaken: vitals.state.hitsTaken, hitsBlocked: vitals.state.hitsBlocked,
          lastTelegraph: lastTelegraph.info ? { type: lastTelegraph.info.type, dur: lastTelegraph.info.dur, kind: lastTelegraph.info.kind, at: +lastTelegraph.at.toFixed(2) } : null,
          markers: markerState.markers.length, edges: markerState.edges.length,
          markerData: { markers: markerState.markers.slice(0, 10), edges: markerState.edges, boss: markerState.boss },
          packs: packs.length,
        } : {}),
      };
    },
    /** Panel de oleada (por frame, solo con la invasión activa). */
    renderHud() {
      if (!invasion.state.on) return null;
      ctx.ui.hud.updateInvasionHud(invasion.state, health);
      if (!v2) return null;
      const m = computeMarkerState();
      markerEmitAcc += 1;
      if (markerEmitAcc >= 6) { markerEmitAcc = 0; events.emit('markers', { markers: m.markers, edges: m.edges, boss: m.boss }); }
      const st = invasion.state;
      const top = [{ text: st.phase === 'victory' ? 'VICTORIA' : `OLEADA ${Math.max(1, st.wave)}/${VICTORY_WAVE} · ${st.score} PTS` },
        { text: `${'◆'.repeat(Math.max(0, health.lives))}${'◇'.repeat(Math.max(0, FAIR.lives - health.lives))}  ${st.alive + st.queue.length} restantes${st.combo > 1 ? ` · ×${st.combo}` : ''}`, size: 12, weight: 500, color: '#B7C2D0' }];
      return {
        markers: { markers: m.markers, edges: m.edges, boss: m.boss },
        arcs: arcs.filter(a => performance.now() - a.t0 < 1200),
        top,
        banner,
        warn: performance.now() < warnUntil ? 'Muévete' : null,
      };
    },
    dispose() { clearTimeout(warmTimer); invasion.dispose(); clearPacks(); },
  };
}
