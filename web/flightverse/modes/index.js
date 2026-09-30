// flightverse/modes/index.js — punto de instalación del workstream D (enemigos,
// Invasión, Gate Rush, medallas/récords, dificultad). installEnemies(ctx) es síncrono
// y debe correr DESPUÉS de installFx (la horda usa weapons.explodeAt).
//
// Publica en ctx.enemies:
//   health{hp}, invasion, gaterush (ver modes/gaterush-mode.js),
//   onButton(), startFromPicker(types, difficulty), startRun(types, difficulty),
//   showDefeat(), stopUi(), hittables(), update(dt, gamePaused), report(), renderHud(), dispose()
// y registra en ctx.actions: startReto, startReplay, exitReplay, startInvasionRun.
// Emite en el bus: damage{amount,dir,source}, wave{n}, gate{i,n}.
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { createInvasionMode } from '/flightverse/modes/invasion-mode.js?v=367';
import { createGateRushMode } from '/flightverse/modes/gaterush-mode.js?v=367';

export function installEnemies(ctx) {
  const enemies = ctx.enemies;
  Object.assign(enemies, createInvasionMode(ctx));
  enemies.gaterush = createGateRushMode(ctx);
  Object.assign(ctx.actions, {
    startInvasionRun: (types, difficulty) => enemies.startRun(types, difficulty),
    startReto: diff => enemies.gaterush.startReto(diff),
    startReplay: () => enemies.gaterush.startReplay(),
    exitReplay: () => enemies.gaterush.exitReplay(),
  });
  return enemies;
}
