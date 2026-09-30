// flightverse/ui/v2.js — montaje del HUD v2 (WS A). Con ?fv=2, ui/index.js delega aquí.
// Produce el MISMO contrato ctx.ui que el HUD legado (update, dispose, hud, menu, screens, weapons, overlay,
// setInvasionUi) más: ctx.ui.prefs (preferencias), ctx.ui.drawsModeHud = true (A dibuja marcadores, placa y
// banners de D a partir de ctx.modeHud) y las APIs de retícula/HUD documentadas en hud2.js.
import { installFlightSurfaceGuards } from '/flightverse/mobile-command.js?v=368';
import { buildHudMarkup2, createHud2 } from '/flightverse/ui/hud2.js?v=368';
import { createMenu2 } from '/flightverse/ui/menu2.js?v=368';
import { createScreens2 } from '/flightverse/ui/screens2.js?v=368';
import { createWeaponsUi2 } from '/flightverse/ui/weapons2.js?v=368';
import { createPrefs } from '/flightverse/ui/prefs.js?v=368';

function loadCss(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href;
  document.head.appendChild(link);
  return link;
}

export function applyPrefsToDocument(prefs) {
  const root = document.documentElement;
  root.style.setProperty('--hx-ts', String(prefs.get('textScale') / 100));
  root.dataset.rm = prefs.reducedMotion() ? '1' : '0';
  root.dataset.lefty = prefs.get('leftHanded') ? '1' : '0';
}

export function mountUi2(ctx) {
  const { flags, bus } = ctx;
  const ui = ctx.ui;
  document.documentElement.classList.add('fv2');
  document.body.classList.add('fv2', flags.coarse ? 'hx-touch' : 'hx-fine');
  loadCss('css/hud.css?v=368');
  loadCss('css/screens.css?v=368');
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  ui.prefs = createPrefs({ bus, systemReduced: () => mq.matches });
  applyPrefsToDocument(ui.prefs);
  ui.prefs.onChange(() => applyPrefsToDocument(ui.prefs));
  mq.addEventListener?.('change', () => applyPrefsToDocument(ui.prefs));

  document.body.insertAdjacentHTML('beforeend', buildHudMarkup2());
  ui.guards = installFlightSurfaceGuards(document.body);
  ui.hud = createHud2(ctx);
  ui.screens = createScreens2(ctx);
  ui.weapons = createWeaponsUi2(ctx);
  ui.menu = createMenu2(ctx);
  ui.drawsModeHud = true;
  ui.setInvasionUi = on => { document.getElementById('vl-hud').dataset.inv = on ? '1' : '0'; };
  ui.update = frame => {
    ui.hud.update(frame);
    ui.screens.tickBoot();
  };
  ui.dispose = () => {
    ui.weapons.dispose();
    ui.guards.dispose();
    ui.menu.dispose();
    ui.hud.dispose();
  };
  return ui;
}

export function installUi2(ctx) {
  const ui = ctx.ui;
  // retícula en espacio de mundo (anillo rosa): fuera (spec §3). fx.render la reactiva cada frame; se ignora.
  const aim = ctx.fx?.aim;
  if (aim) Object.defineProperty(aim, 'visible', { get: () => false, set: () => {}, configurable: true });
  ui.weapons.attach();
  const panel = id => document.getElementById(id);
  ui.menu.install({
    start: { panel: panel('hx-start'), openClass: 'open', dismissible: false, initialFocus: '#hx-start-go' },
    result: { panel: panel('vl-result'), openClass: 'open' },
    invasion: { panel: panel('vl-inv'), openClass: 'open', trigger: null },
    difficulty: { panel: panel('vl-diff'), openClass: 'open' },
    guide: { panel: panel('vl-guide'), openClass: 'open' },
    director: { panel: panel('vl-director'), openClass: 'open', dismissible: false },
  });
  ui.screens.install();
  ui.hud.init();
  return ui;
}
