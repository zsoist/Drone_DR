// flightverse/modes/invasion-mode.js — MODO INVASIÓN: horda enemiga, vida del jugador,
// arranque/parada, récord local y derrota (WS D). La presentación (selector, panel de
// oleada, pantalla de derrota) vive en ui/*; aquí solo lógica.
import { createInvasion, ENEMIES } from '/flightverse/invasion.js?v=367';
import { summarizeInvasionRun } from '/flightverse/hud-format.js?v=367';

export function createInvasionMode(ctx) {
  const {
    scene, terrain, audio, report, Q, CID, state: S, actions: A, bus, P, flags, fx,
  } = ctx;
  const { weapons } = fx;

  // ── MODO INVASIÓN: enemigos originales a elección (modal) ──
  const health = { hp: 100 };
  if (report.qa) report.qa.health = health;         // ?qa=1: permite forzar derrota en pruebas
  const invasionTier = flags.coarse || (navigator.deviceMemory || 4) <= 4
    ? 'low'
    : (navigator.deviceMemory || 8) >= 8 && (navigator.hardwareConcurrency || 4) >= 8
      ? 'high' : 'medium';
  const invasion = createInvasion(scene, {
    heightAt: terrain.heightAt, audio, deviceTier: invasionTier,
    onHit: dmg => {
      health.hp = Math.max(0, health.hp - dmg);
      ctx.ui.hud.hitFlash();
      audio.crash?.();
      bus.emit('damage', { amount: dmg, dir: null, source: 'invasion' });
    },
    fx: {
      impact: pos => weapons.explodeAt(pos, 0.5),
      explode: (pos, big) => weapons.explodeAt(pos, big),
    },
  });
  weapons.state._enemies = invasion.hittables;     // splash de explosión a la horda
  if (report.qa) report.qa.invasion = invasion;     // ?qa=1: inspección de la horda en pruebas

  // ── INVASIÓN: pantalla real de derrota (antes solo un toast que se iba en 3 s y reseteaba la vida) ──
  const invBestKey = () => `ab.fv.best.${CID}.invasion`;
  const invReadBest = () => {
    try {
      const v = JSON.parse(localStorage.getItem(invBestKey()) || 'null');
      return v && Number.isFinite(v.score) ? v : null;
    } catch { return null; }
  };
  const stopUi = () => {
    ctx.ui.setInvasionUi(false);
    health.hp = 100;
  };
  const startRun = (types, difficulty) => {
    if (invasion.state.on) return;
    ctx.ui.overlay?.close('result');
    invasion.toggle(P, types, difficulty);
    health.hp = 100;
    ctx.ui.setInvasionUi(true);
  };
  const showDefeat = () => {
    const prev = invReadBest();
    const run = summarizeInvasionRun(invasion.state, prev);
    if (run.newBest) {
      try {
        localStorage.setItem(invBestKey(), JSON.stringify({ score: run.score, wave: run.wave, killed: run.killed }));
      } catch { /* almacenamiento bloqueado: la derrota igual se muestra */ }
    }
    S.lastInvasionRun = run;
    S.resultShown = false;                    // la tarjeta de Gate Rush ya no está en #vl-result
    (report.invasionRuns ||= []).push({ ...run, at: +S.simT.toFixed(2) });
    invasion.toggle(P);                       // apaga la run: sin enemigos ni proyectiles vivos
    stopUi();
    A.releaseFiring();
    ctx.ui.screens.showDefeat(run);
  };

  let qaInvasionStarted = false;
  let lastWave = 0;

  return {
    health, invasion,
    /** Botón "Modo Invasión" del dock: apaga si está activa; si no, abre el selector. */
    onButton() {
      if (invasion.state.on) {                       // apagar directo
        invasion.toggle(P);
        ctx.ui.setInvasionUi(false);
        return;
      }
      ctx.ui.overlay?.toggle('invasion');            // elegir enemigos
    },
    /** "INICIAR INVASIÓN" del selector. */
    startFromPicker(types, difficulty) {
      ctx.ui.overlay?.close('invasion');
      invasion.toggle(P, types, difficulty);
      health.hp = 100;
      ctx.ui.setInvasionUi(true);
    },
    startRun, showDefeat, stopUi,
    /** Hittables de la horda + objetos de escena (para armas y apuntado). */
    hittables() {
      return invasion.state.on
        ? [...(S.sceneObjects?.hittables || []), ...invasion.hittables]
        : S.sceneObjects?.hittables;
    },
    /** Por paso fijo (tras weapons.update): arranque QA por URL, horda, derrota, eventos. */
    update(dt, gamePaused) {
      const drone = ctx.drone;
      if (Q.get('invasion') && !invasion.state.on && S.simT > 0.5 && !qaInvasionStarted) {
        qaInvasionStarted = true;               // solo una vez: si no, tras la derrota la URL reinicia la run detrás de la pantalla
        invasion.toggle(
          drone.pos,
          Q.get('invasion').split(',').filter(k => ENEMIES[k]),
          Q.get('invDifficulty') || 'media',
        );
        ctx.ui.setInvasionUi(true);
      }
      if (!gamePaused) invasion.update(dt, drone.pos, drone.vel);
      if (invasion.state.on && health.hp <= 0) showDefeat();   // HP a 0: pantalla de derrota (no un toast)
      if (invasion.state.wave !== lastWave) {
        lastWave = invasion.state.wave;
        if (lastWave > 0) bus.emit('wave', { n: lastWave });
      }
    },
    /** Volcado a window.__volar. */
    report() {
      report.invasion = {
        on: invasion.state.on,
        phase: invasion.state.phase,
        wave: invasion.state.wave,
        alive: invasion.state.alive,
        queued: invasion.state.queue.length,
        killed: invasion.state.killed,
        score: invasion.state.score,
        combo: invasion.state.combo,
        countdown: +invasion.state.countdown.toFixed(2),
        difficulty: invasion.state.difficulty,
        types: [...invasion.state.types],
        telemetry: invasion.state.telemetry,
      };
    },
    /** Panel de oleada (por frame, solo con la invasión activa). */
    renderHud() {
      if (invasion.state.on) ctx.ui.hud.updateInvasionHud(invasion.state, health);
    },
    dispose() { invasion.dispose(); },
  };
}
