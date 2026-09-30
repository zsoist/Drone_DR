// flightverse/ui/index.js — punto de instalación del workstream A (HUD, menús, pantallas).
//   mountUi(ctx)   temprano en boot: inyecta el HUD, guardas de superficie, crea los
//                  submódulos (sin listeners de juego). Deja listo ctx.ui.
//   installUi(ctx) tras fx/enemies/controls: cablea selector de armas, menú, overlays,
//                  pantallas y minimapa.  ctx.ui.overlay queda disponible aquí.
//   ctx.ui.update(frame) por frame; ctx.ui.dispose() en pagehide.
// Refactor A0: sin cambio de comportamiento respecto al volar.js monolítico.
import { installFlightSurfaceGuards } from '/flightverse/mobile-command.js?v=367';
import { mountHudMarkup, createHud } from '/flightverse/ui/hud.js?v=367';
import { createMenu } from '/flightverse/ui/menu.js?v=367';
import { createScreens } from '/flightverse/ui/screens.js?v=367';
import { createWeaponsUi } from '/flightverse/ui/weapons-ui.js?v=367';

export function mountUi(ctx) {
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
  const ui = ctx.ui;
  ui.weapons.attach();      // selector de arma (antes del menú: el overlay lo cierra)
  ui.menu.install();        // crea ctx.ui.overlay
  ui.screens.install();
  ui.hud.init();
  return ui;
}
