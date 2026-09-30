// flightverse/modes/gaterush-mode.js — MODO GATE RUSH: arranque, aproximación al
// circuito, cuenta atrás/cues, autotest ?autotest=gaterush, replay y resultado (WS D).
// Estado compartido en ctx.state: reto, replay, retoFly, retoMode, resultShown.
// La tarjeta de resultado (HTML) vive en ui/screens.js; el circuito en gaterush.js.
//
// Con ?fv=2: inicio validado contra colisión (≥ 12 m de muros, 30 m libres al frente),
// par por mundo/dificultad, medallas bronce/plata/oro, fallos, penalización de +3 s por
// respawn, récords top-10 por (mundo, modo, dificultad) y fantasma de la mejor run.
import { MODES, STEP } from '/flightverse/runtime.js?v=369';
import { createGateRush, bestTime } from '/flightverse/gaterush.js?v=369';
import {
  addRecord, getTop, bestMedal, encodeGhost, ghostKey, saveGhostIfBest, loadGhost, timeText,
} from '/flightverse/modes/rules.js?v=369';
import { decorateGateRushResult } from '/flightverse/modes/result-cards.js?v=369';

const GHOST_PREF = 'ab_fv_gr_ghost';

export function createGateRushMode(ctx, events) {
  const {
    scene, terrain, audio, report, AT, CID, state: S, actions: A, bus, W,
  } = ctx;
  const v2 = !!ctx.flags.fv2;
  const autoReto = AT === 'gaterush' ? { last: 0, replayed: false } : null;
  const sfx = { idx: 0, phase: '', count: 0 };
  const ghostPref = () => { try { return localStorage.getItem(GHOST_PREF) !== '0'; } catch { return true; } };
  const variantOf = mode => (mode === 'dios' ? 'dios' : '');
  let lastResult = null;

  if (v2) {
    // Un choque que destruye el dron cuenta UNA vez: el fallo + la penalización de +3 s se aplican en el evento
    // `respawn` (C: clase crash/prop -> motores cortados -> reaparición). Los rebotes/roces (`crash` bounce|wobble) no
    // son fallos; `soft` (camino v2 sin física v2) sí, salvo dentro de la invulnerabilidad posterior al respawn
    // (ctx.phys.invuln > 0) para no contar dos veces el mismo golpe.
    let lastPenaltyAt = -99;
    bus.on('crash', d => {
      if (d?.energyClass !== 'soft' || S.reto?.state.phase !== 'running') return;
      if ((ctx.phys?.invuln || 0) > 0 || S.simT - lastPenaltyAt < 1) return;
      lastPenaltyAt = S.simT;
      S.reto.noteMiss(); events.emit('gr-miss', { kind: 'crash', misses: S.reto.state.misses });
    });
    bus.on('respawn', () => {
      const st = S.reto?.state;
      if (st?.phase !== 'running' || S.simT - lastPenaltyAt < 1) return;
      lastPenaltyAt = S.simT;
      S.reto.noteMiss();
      st.t += 3;
      events.emit('gr-miss', { kind: 'respawn', misses: st.misses });
      events.emit('gr-penalty', { seconds: 3, t: +st.t.toFixed(2) });
    });
  }

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
    const variant = variantOf(S.retoMode);
    const ghost = v2 && ghostPref() ? loadGhost(localStorage, ghostKey(CID, diff, variant)) : null;
    S.reto = createGateRush({
      scene, trackPts: S.ghost?.pts, world: W, heightAt: terrain.heightAt, difficulty: diff,
      v2, collision: v2 ? ctx.collision : null, worldPar: W?.gaterush?.par?.[diff] ?? null, ghost,
    });
    sfx.idx = 0; sfx.phase = ''; sfx.count = 0;
    const ap = S.reto.approach();
    if (v2) {
      report.grStart = { ...S.reto.state.startInfo, at: [+ap.x.toFixed(1), +ap.y.toFixed(1), +ap.z.toFixed(1)] };
      // perfil Sport en Difícil (spec §11), si C lo expone
      ctx.controls?.setProfile?.(diff === 'dificil' ? 'sport' : 'normal');
    }
    events.emit('game-mode', { key: 'gaterush', phase: 'start', difficulty: diff });
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
    const vm = { st, t, retoMode: S.retoMode, isNew, best, prev, delta, dist };
    if (v2) {
      const variant = variantOf(S.retoMode);
      const mode = variant ? `gaterush.${variant}` : 'gaterush';
      const rec = addRecord(localStorage, {
        world: CID, mode, difficulty: st.difficulty, score: st.score, medal: st.medal, time: t,
      });
      const savedGhost = saveGhostIfBest(localStorage, ghostKey(CID, st.difficulty, variant), encodeGhost(st.rec), t);
      Object.assign(vm, {
        medal: st.medal, par: st.par, misses: st.misses, score: st.score,
        rank: rec.rank, top: rec.list, bestMedal: bestMedal(rec.list), savedGhost,
      });
      lastResult = { medal: st.medal, par: st.par, misses: st.misses, time: +t.toFixed(2), score: st.score, rank: rec.rank, savedGhost, top: rec.list.length };
      report.grResult = lastResult;
      if (st.medal) events.emit('medal', { id: `gaterush:${st.difficulty}`, level: st.medal, mode: 'gaterush', medal: st.medal, difficulty: st.difficulty, time: +t.toFixed(2), par: st.par, misses: st.misses });
      events.emit('record', { mode, difficulty: st.difficulty, rank: rec.rank, score: st.score, isBest: rec.isBest });
    }
    ctx.ui.screens.showGateRushResult(vm);
    if (v2) decorateGateRushResult(document.getElementById('vl-result'), vm);
  };

  return {
    startReto, startReplay, exitReplay, showResult, sfx,
    /** Datos de HUD (cronómetro / gates / par) — A los dibuja; ctx.ui.drawsModeHud=false → la capa de modos. */
    hud() { return S.reto && !S.replay ? S.reto.hud() : null; },
    setGhostEnabled(v) {
      try { localStorage.setItem(GHOST_PREF, v ? '1' : '0'); } catch { /* ignore */ }
      S.reto?.setGhostEnabled?.(v);
    },
    get ghostEnabled() { return ghostPref(); },
    get lastResult() { return lastResult; },
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
      if (k >= 1) {
        S.retoFly = null;
        if (v2) {                              // encarar el gate 0 al empezar
          const c0 = S.reto.gates[0].center;
          drone.yaw = Math.atan2(-(c0.x - drone.pos.x), -(c0.z - drone.pos.z));
        }
        S.reto.start();
      }
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
          if (v2) events.emit('gate', { i: st.idx, n: st.total, t: +st.t.toFixed(2), split: st.lastSplit ? +st.lastSplit.delta.toFixed(2) : null, misses: st.misses });
          else bus.emit('gate', { i: st.idx, n: st.total });
        }
        if (st.phase === 'countdown') { const c = Math.ceil(st.countdown); if (c !== sfx.count) audio.tick(); sfx.count = c; }
        if (st.phase === 'running' && sfx.phase === 'countdown') { audio.go(); if (v2) events.emit('game-mode', { key: 'gaterush', phase: 'go' }); }
        if (st.phase === 'finished' && sfx.phase !== 'finished') audio.finish();
        sfx.idx = st.idx; sfx.phase = st.phase;
        if (st.phase === 'finished' && !S.resultShown) showResult();
      }
    },
    /** Pulso de los aros (por frame, antes del vuelo de cámara). */
    renderPulse() {
      if (S.reto?.pulse) S.reto.pulse(S.simT, STEP * 2);
    },
    /** Modelo de la capa de dibujo para este frame (?fv=2). */
    overlayModel() {
      if (!v2 || !S.reto || S.replay) return null;
      const h = S.reto.hud();
      if (S.retoFly) return { top: [{ text: 'Volando al circuito…', size: 13, weight: 500, color: '#B7C2D0' }] };
      const pace = h.pace;
      const lines = [{ text: h.phase === 'countdown' ? `GATE RUSH · ${h.difficulty.toUpperCase()}` : `${h.timerText}` , size: 16 }];
      if (h.phase === 'running' || h.phase === 'finished') {
        const pz = h.par ? ` · par ${timeText(h.par).replace(/^00:/, '')}` : '';
        const pc = h.phase === 'running' && h.passed > 0 ? ` · ${pace > 0 ? '+' : ''}${pace.toFixed(1)}s` : '';
        lines.push({ text: `gate ${h.gate}/${h.total}${pz}${pc}`, size: 12, weight: 500,
          color: h.phase === 'running' && h.passed > 0 ? (pace > 0 ? '#E0A458' : '#52C79A') : '#B7C2D0' });
      } else lines.push({ text: 'Prepárate', size: 12, weight: 500, color: '#B7C2D0' });
      const banner = h.countdown ? { text: String(h.countdown), dur: 1, t0: performance.now() - 300, color: '#45A0E6' } : null;
      return { top: lines, banner };
    },
  };
}
