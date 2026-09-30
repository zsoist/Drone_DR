// flightverse/modes/gaterush-mode.js — MODO GATE RUSH: arranque, aproximación al
// circuito, cuenta atrás/cues, autotest ?autotest=gaterush, replay y resultado (WS D).
// Estado compartido en ctx.state: reto, replay, retoFly, retoMode, resultShown.
// La tarjeta de resultado (HTML) vive en ui/screens.js; el circuito en gaterush.js.
import { MODES, STEP } from '/flightverse/runtime.js?v=367';
import { createGateRush, bestTime } from '/flightverse/gaterush.js?v=367';

export function createGateRushMode(ctx) {
  const {
    scene, terrain, audio, report, AT, CID, state: S, actions: A, bus, W,
  } = ctx;
  const autoReto = AT === 'gaterush' ? { last: 0, replayed: false } : null;
  const sfx = { idx: 0, phase: '', count: 0 };

  // ── Gate Rush (desafío del slice) + replay ──
  const startReto = (diff) => {
    const drone = ctx.drone;
    if (!diff) { ctx.ui.overlay.toggle('difficulty'); return; }   // sin dif → picker
    ctx.ui.overlay.close();
    // Arcade (autopiloto) tenía prioridad en el loop y retoFly/countdown nunca avanzaban: T no hacía nada
    if (MODES[S.modeKey]?.autopilot) A.setMode('asistido');
    S.retoMode = S.modeKey;                    // Dios (noclip, 85 m/s) no comparte récord con vuelo normal
    try { localStorage.setItem('ab.fv.gr.diff', diff); } catch { /* bloqueado */ }
    ctx.ui.screens.clearResult();
    S.replay = null; S.resultShown = false;
    if (S.reto) S.reto.dispose();
    S.reto = createGateRush({ scene, trackPts: S.ghost?.pts, world: W, heightAt: terrain.heightAt, difficulty: diff });
    const ap = S.reto.approach();
    if (drone.pos.distanceTo(ap) > 20) {
      // vuelo grácil al punto de partida del circuito, luego countdown
      S.retoFly = { from: drone.pos.clone(), to: ap, t: 0,
        dur: Math.min(4, 1.2 + drone.pos.distanceTo(ap) / 55) };
    } else S.reto.start();
  };
  const startReplay = () => {
    if (!S.reto?.state.rec.length) return;
    ctx.ui.overlay.close('result');
    S.replay = { rec: S.reto.state.rec, f: 0 };
    S.reto.setVisible(false);
  };
  const exitReplay = () => {
    S.replay = null;
    S.reto?.setVisible(true);
    if (S.resultShown) ctx.ui.overlay.open('result');
  };
  const showResult = () => {
    S.resultShown = true;
    const st = S.reto.state;
    const t = st.time;
    const recordKey = S.retoMode === 'dios' ? `${st.difficulty}.dios` : st.difficulty;
    const { best, isNew, prev } = bestTime(CID, t, recordKey);
    const delta = !isNew && best != null ? t - best : 0;
    // distancia real del recorrido (poses 60Hz) → velocidad media honesta
    let dist = 0;
    for (let i = 1; i < st.rec.length; i++) {
      const a2 = st.rec[i - 1], b2 = st.rec[i];
      dist += Math.hypot(b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]);
    }
    ctx.ui.screens.showGateRushResult({ st, t, retoMode: S.retoMode, isNew, best, prev, delta, dist });
  };

  return {
    startReto, startReplay, exitReplay, showResult, sfx,
    /** Aproximación grácil al circuito (rama del loop mientras S.retoFly). */
    stepFly(dt) {
      const drone = ctx.drone;
      const retoFly = S.retoFly;
      // aproximación grácil al circuito: easeInOut + arquito, luego countdown
      retoFly.t += dt;
      const k = Math.min(1, retoFly.t / retoFly.dur), e = k * k * (3 - 2 * k);
      drone.prev.pos.copy(drone.pos); drone.prev.yaw = drone.yaw;
      drone.pos.lerpVectors(retoFly.from, retoFly.to, e);
      drone.pos.y += Math.sin(e * Math.PI) * 5;
      drone.vel.set(0, 0, 0);
      drone.yaw += (Math.atan2(-(retoFly.to.x - retoFly.from.x), -(retoFly.to.z - retoFly.from.z)) - drone.yaw) * 0.08;
      if (k >= 1) { S.retoFly = null; S.reto.start(); }
    },
    /** Tras drone.step en vuelo manual: autotest del slice + detección/cues del circuito. */
    afterStep(dt, gamePaused) {
      const drone = ctx.drone;
      if (autoReto) {
        // autotest del slice: teleporta por los gates — prueba detección,
        // resultado y replay reales sin fingir sus verificaciones
        if (!S.reto && S.simT > 0.5) startReto('media');
        else if (S.reto?.state.phase === 'running' && S.simT - autoReto.last > 0.4) {
          autoReto.last = S.simT;
          const g = S.reto.gates[S.reto.state.idx];
          if (g) { drone.pos.copy(g.center); drone.prev.pos.copy(g.center); }
        } else if (S.reto?.state.phase === 'finished' && !autoReto.replayed) {
          autoReto.replayed = true;
          startReplay();
          setTimeout(() => {
            report.reto = { time: S.reto.state.time, gates: S.reto.state.total, recFrames: S.reto.state.rec.length };
            report.replayActive = !!S.replay;
            report.ok = S.reto.state.total >= 4 && S.reto.state.time != null
              && S.reto.state.rec.length > 30 && !!S.replay;
            report.done = true;
          }, 1200);
        }
      }
      if (S.reto) {
        if (!gamePaused) S.reto.update(dt, drone.pos, drone.vel, drone.yaw);
        const st = S.reto.state;
        if (st.idx > sfx.idx) {
          audio.gate();
          ctx.ui.hud.gateFlash();
          bus.emit('gate', { i: st.idx, n: st.total });
        }
        if (st.phase === 'countdown') { const c = Math.ceil(st.countdown); if (c !== sfx.count) audio.tick(); sfx.count = c; }
        if (st.phase === 'running' && sfx.phase === 'countdown') audio.go();
        if (st.phase === 'finished' && sfx.phase !== 'finished') audio.finish();
        sfx.idx = st.idx; sfx.phase = st.phase;
        if (st.phase === 'finished' && !S.resultShown) showResult();
      }
    },
    /** Pulso de los aros (por frame, antes del vuelo de cámara). */
    renderPulse() {
      if (S.reto?.pulse) S.reto.pulse(S.simT, STEP * 2);
    },
  };
}
