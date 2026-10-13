// flightverse/modes/index.js — punto de instalación del workstream D (enemigos,
// Invasión, Gate Rush, medallas/récords, dificultad). installEnemies(ctx) es síncrono
// y debe correr DESPUÉS de installFx (la horda usa weapons.explodeAt).
//
// Publica en ctx.enemies:
//   health{hp,lives,invulnerable,protect}, invasion, gaterush (ver modes/gaterush-mode.js),
//   onButton(), startFromPicker(types, difficulty), startRun(types, difficulty),
//   showDefeat(), stopUi(), hittables(), update(dt, gamePaused), report(), renderHud(), dispose()
// y registra en ctx.actions: startReto, startReplay, exitReplay, startInvasionRun.
//
// ?fv=2 añade (contrato con A/B/C/E — ver docs/FLIGHTVERSE_DESIGN_SPEC.md §9, §8):
//   ctx.modes = { start(key, opts), stop(), current, onboarding }   // key: explorar|tour|gaterush|invasion
//   ctx.actions.startMode / stopMode / repositionDrone / setGhost
//   ctx.enemies.events.on(type, fn)  — alias de bus.on (todos los eventos de modos viajan por el bus compartido)
//   ctx.enemies.markers  = { markers:[{id,type,x,y,dist,hpFrac,boss,telegraphing}], edges:[{id,x,y,angle,dist,opacity}], boss:{name,hpFrac} }   // x,y 0..1
//   ctx.enemies.grHud()  = { phase, t, timerText, gate, total, par, pace, misses, countdown, medal }   (Gate Rush)
//   ctx.enemies.beat     = S.modeBeat = { text, sub, dur } banner de intro/outro de oleada
//
// Eventos emitidos (ctx.enemies.events; * = ya en BUS_EVENTS y por tanto también en el bus):
//   wave*{n,phase:'intro'|'start'|'clear',types,fresh,count,bonus}  gate*{i,n,t,split,misses}
//   damage*{amount,dir{x,y,z},source,hp}  damage-blocked{reason}  telegraph{id,type,kind,dur,dir,pos,dist}
//   score{score,gained,combo,reason}  life{lives,hp}  warn{kind:'move'|'lowhp',text}  pack{phase}
//   victory{wave,score,killed,medal,rank,livesLost}  defeat{...}  record{mode,rank,score}
//   medal*{id,level,mode,medal,...} (id 'gaterush:<dif>'|'invasion:<dif>'|'primer-vuelo'; level bronze|silver|gold — formato de A)
//   Resultado → ui: vm de Gate Rush lleva medal,par,misses,rank,top,score; Invasión usa ctx.ui.screens.showVictory(run) si existe (si no, tarjeta de respaldo en modes/result-cards.js)
//   QA de desarrollo: ?invWave=n empieza en la oleada n; ?onboard=1 fuerza el onboarding
//   markers{markers,edges,boss} (≈10 Hz)  game-mode{key,phase}  gr-miss  gr-penalty  onboard{step,copy}  reposition
// Todos los tipos están registrados en BUS_EVENTS (integración).
import { createInvasionMode } from '/flightverse/modes/invasion-mode.js?v=432';
import { createGateRushMode } from '/flightverse/modes/gaterush-mode.js?v=432';
import { createModeEvents } from '/flightverse/modes/events.js?v=432';
import { createModeOverlay } from '/flightverse/modes/overlay.js?v=432';
import { createOnboarding } from '/flightverse/modes/onboarding.js?v=432';
import { createModeArbiter, setTourChrome, tourActiveFrom } from '/flightverse/modes/exclusive.js?v=432';

export function installEnemies(ctx) {
  const enemies = ctx.enemies;
  const v2 = !!ctx.flags.fv2;
  const events = createModeEvents(ctx.bus, ctx.report);
  const overlay = v2 && !ctx.ui?.drawsModeHud ? createModeOverlay(ctx) : null;
  // Exclusión mutua: TODO punto de entrada (ctx.modes.start, startReto, startRun, selector, URL de QA) llama a
  // hooks.beforeStart(key) → arbiter.enter(key), que detiene cualquier otro modo. ctx.modes.start es la entrada canónica.
  const hooks = { beforeStart: key => arbiter.enter(key) };
  const inv = createInvasionMode(ctx, events, hooks);
  Object.assign(enemies, inv);
  enemies.gaterush = createGateRushMode(ctx, events, hooks);
  const stopGateRush = () => {
    const S = ctx.state;
    const had = !!(S.reto || S.retoFly || S.replay);
    if (S.reto) { S.reto.dispose(); S.reto = null; }
    S.retoFly = null; S.replay = null; S.resultShown = false;
    ctx.ui.screens?.clearResult?.();
    return had;
  };
  const arbiter = createModeArbiter({
    invasion: () => { const was = !!enemies.stopRun?.(); ctx.ui.screens?.clearResult?.(); return was; },
    gaterush: stopGateRush,
  });
  enemies.events = events;

  Object.assign(ctx.actions, {
    startInvasionRun: (types, difficulty) => enemies.startRun(types, difficulty),
    startReto: diff => enemies.gaterush.startReto(diff),
    startReplay: () => enemies.gaterush.startReplay(),
    exitReplay: () => enemies.gaterush.exitReplay(),
  });

  if (!v2) return enemies;

  // ── v2: orquestación de modos, onboarding, datos de HUD ──
  const onboarding = createOnboarding(ctx, events);
  // Tour: oculta «Viento»/«Dron caído» mientras corre (evento `tour` del bus + modes.start('tour'))
  const tourChrome = on => setTourChrome(document, on);
  ctx.bus.on('tour', d => tourChrome(tourActiveFrom(d?.state)));
  const stopAll = () => { tourChrome(false); return arbiter.leave(); };
  const modes = {
    get current() { return arbiter.current; },
    onboarding,
    /** Entrada única a un modo: detiene todos los demás (stopAll) y arranca `key`. */
    start(key, opts = {}) {
      if (!['explorar', 'tour', 'gaterush', 'invasion'].includes(key)) return false;
      arbiter.enter(key);
      if (key !== 'tour') tourChrome(false);
      if (key === 'explorar') ctx.actions.setMode(opts.noCollision ? 'dios' : 'asistido');
      else if (key === 'tour') { ctx.actions.setMode('cinematico'); tourChrome(true); }
      else if (key === 'gaterush') {
        if (ctx.state.modeKey === 'cinematico') ctx.actions.setMode('asistido');
        ctx.actions.startReto(opts.difficulty || 'media');
      } else if (key === 'invasion') {
        enemies.stopRun?.();                       // reinicio limpio si ya había una run
        if (ctx.state.modeKey === 'cinematico' || ctx.state.modeKey === 'arcade') ctx.actions.setMode('asistido');
        ctx.actions.startInvasionRun(opts.types?.length ? opts.types : ['zombie'], opts.difficulty || 'media');
      } else return false;
      events.emit('game-mode', { key, phase: 'select', opts: { difficulty: opts.difficulty || null } });
      return true;
    },
    stop() { stopAll(); events.emit('game-mode', { key: 'explorar', phase: 'select' }); },
  };
  ctx.modes = modes;
  Object.assign(ctx.actions, {
    startMode: modes.start, stopMode: modes.stop,
    repositionDrone: () => inv.repositionDrone(),
    setGhost: v => enemies.gaterush.setGhostEnabled(v),
  });
  enemies.markers = inv.markerState;
  enemies.grHud = () => enemies.gaterush.hud();

  const baseHittables = inv.hittables;
  enemies.hittables = () => {
    const list = baseHittables();
    const extra = onboarding.hittables();
    return extra.length ? [...(list || []), ...extra] : list;
  };
  const baseUpdate = inv.update;
  enemies.update = (dt, paused) => {
    baseUpdate(dt, paused);
    if (!paused) onboarding.update(dt);
    if (ctx.Q.get('onboard') === '1' && !onboarding.state.active && !onboarding.state.done && ctx.state.simT > 0.6) { onboarding.begin(); onboarding.tap(); }
  };
  const baseReport = inv.report;
  enemies.report = () => {
    baseReport();
    ctx.report.modes = {
      current: arbiter.current, onboarding: { active: onboarding.state.active, step: onboarding.state.step, t: +onboarding.state.t.toFixed(1), done: onboarding.state.done },
      gr: enemies.gaterush.hud(), startInfo: ctx.state.reto?.state.startInfo || null,
    };
  };
  enemies.renderHud = () => {
    // A (ui/hud2.js + ui/reticle.js) dibuja marcadores, flechas, jefe, placa, banner y aviso desde ctx.modeHud.
    // modes/overlay.js queda SOLO como respaldo cuando no hay HUD v2 que dibuje (ctx.ui.drawsModeHud).
    const model = inv.renderHud() || enemies.gaterush.overlayModel() || {};
    if (overlay && !ctx.ui?.drawsModeHud) overlay.draw(model, performance.now());
    return model;
  };
  const baseDispose = inv.dispose;
  enemies.dispose = () => { baseDispose(); overlay?.dispose(); };
  return enemies;
}
