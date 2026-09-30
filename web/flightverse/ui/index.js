// flightverse/ui/index.js — punto de instalación del workstream A (HUD, menús, pantallas).
//   mountUi(ctx)   temprano en boot: inyecta el HUD, guardas de superficie, crea los
//                  submódulos (sin listeners de juego). Deja listo ctx.ui.
//   installUi(ctx) tras fx/enemies/controls: cablea selector de armas, menú, overlays,
//                  pantallas y minimapa.  ctx.ui.overlay queda disponible aquí.
//   ctx.ui.update(frame) por frame; ctx.ui.dispose() en pagehide.
// Refactor A0: sin cambio de comportamiento respecto al volar.js monolítico.
//
// ?fv=2 (ctx.flags.fv2) → ui/v2.js monta el HUD v2 (hud2/weapons2/menu2/screens2 + css/hud.css, css/screens.css).
// Contrato ctx.ui (igual en ambos modos): hud, menu, screens, weapons, overlay, setInvasionUi, update, dispose.
// Solo v2 añade:
//   ctx.ui.prefs            get/set/onChange/reducedMotion() — claves en ui/prefs.js; bus 'prefs' {key,value}
//   ctx.ui.drawsModeHud     true: A dibuja marcadores/placa/banners de D desde ctx.modeHud (= enemies.renderHud())
//   ctx.ui.hud.*            setReticle(kind,{screen|point,spreadPx,heat,overheated,cool,charge,swarm,splashPx})
//                           hitMarker('hit'|'graze'|'deflect'|'kill') · damageArc(angleRad) · setLock({state,progress,world|rect})
//                           setPipper({world|screen,locked}) · setThreats([{pos,hp,locked,tiered}]) · setObjective({x,y,z,label})
//                           setWind({speed,fromDeg,gust}) · setIntegrity(0..1) · setBattery(0..1) · setVisible(bool)
//                           announce(text) (aria-live) · message(text) · hitFlash() · gateFlash() · slots
//   ctx.ui.screens.*        toast(msg,ms) · showGateRushResult(vm) · showDefeat(run) · showVictory(run) · clearResult()
//   ctx.ui.menu.*           openModes() · openPause(page) · install(overlays)
//   bus (escucha A)         hit{kill,damage} → marcador · damage{dir|angle} → arco · lock → caja · wave/gate → aria-live
//   bus (emite A)           pause{active,overlay} · prefs{key,value} · medal{id,level} · onboarding{completed}
//   ctx.actions opcionales  setProfile('cine'|'normal') · startTour() · enterPhoto() — los menús los usan si existen
import { installFlightSurfaceGuards } from '/flightverse/mobile-command.js?v=370';
import { mountHudMarkup, createHud } from '/flightverse/ui/hud.js?v=370';
import { createMenu } from '/flightverse/ui/menu.js?v=370';
import { createScreens } from '/flightverse/ui/screens.js?v=370';
import { createWeaponsUi } from '/flightverse/ui/weapons-ui.js?v=370';
import { mountUi2, installUi2 } from '/flightverse/ui/v2.js?v=370';

export function mountUi(ctx) {
  if (ctx.flags.fv2) return mountUi2(ctx);      // HUD v2 (?fv=2): ui/v2.js
  mountHudMarkup();
  const ui = ctx.ui;
  ui.guards = installFlightSurfaceGuards(document.body);
  ui.hud = createHud(ctx);
  ui.menu = createMenu(ctx);
  ui.screens = createScreens(ctx);
  ui.weapons = createWeaponsUi(ctx);
  ui.menu.initGradePanel();
  const zBtn = document.querySelector('#vl-zombies');
  const zhud = document.querySelector('#vl-zhud');
  /** Estado visual de Invasión: botón del dock + panel de oleada. */
  ui.setInvasionUi = on => {
    zBtn.classList.toggle('on', !!on);
    zhud.classList.toggle('show', !!on);
  };
  /** Por frame (tras render de escena): HUD, arranque, etiqueta de grabación. */
  ui.update = frame => {
    ui.hud.update(frame);
    ui.screens.tickBoot();
    ui.menu.tickRec();
  };
  ui.dispose = () => {
    ui.weapons.dispose();
    ui.guards.dispose();
    ui.menu.dispose();
  };
  return ui;
}

export function installUi(ctx) {
  if (ctx.flags.fv2) return installUi2(ctx);
  const ui = ctx.ui;
  ui.weapons.attach();      // selector de arma (antes del menú: el overlay lo cierra)
  ui.menu.install();        // crea ctx.ui.overlay
  ui.screens.install();
  ui.hud.init();
  return ui;
}
