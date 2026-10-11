// flightverse/ui/v2.js — montaje del HUD v2 (WS A). Con ?fv=2, ui/index.js delega aquí.
// Produce el MISMO contrato ctx.ui que el HUD legado (update, dispose, hud, menu, screens, weapons, overlay,
// setInvasionUi) más: ctx.ui.prefs (preferencias), ctx.ui.drawsModeHud = true (A dibuja marcadores, placa y
// banners de D a partir de ctx.modeHud) y las APIs de retícula/HUD documentadas en hud2.js.
import { installFlightSurfaceGuards } from '/flightverse/mobile-command.js?v=374';
import { buildHudMarkup2, createHud2 } from '/flightverse/ui/hud2.js?v=374';
import { createMenu2 } from '/flightverse/ui/menu2.js?v=374';
import { createScreens2 } from '/flightverse/ui/screens2.js?v=374';
import { createWeaponsUi2 } from '/flightverse/ui/weapons2.js?v=374';
import { createPrefs } from '/flightverse/ui/prefs.js?v=374';

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
  loadCss('css/hud.css?v=374');
  loadCss('css/screens.css?v=374');
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

const PHOTO_MIN_KEY = 'ab_fv_photo_min';
/** Panel de Foto (E, tour/default-ui.js): le añade cabecera con botón plegar/desplegar (compacto en móvil vertical). La lógica de foto no se toca. */
function enhancePhotoPanel(panel) {
  if (panel.querySelector('.fv-ph-head')) return;
  let stored = null;
  try { stored = localStorage.getItem(PHOTO_MIN_KEY); } catch { /* sin almacenamiento */ }
  const min0 = stored != null ? stored === '1' : innerWidth < 600 && innerHeight > innerWidth;
  const head = document.createElement('div');
  head.className = 'fv-ph-head';
  head.innerHTML = '<b>Ajustes de foto</b><button type="button" class="fv-ph-toggle" aria-expanded="true">Ocultar</button>';
  const btn = head.querySelector('button');
  const set = min => {
    panel.classList.toggle('fv-min', min);
    btn.textContent = min ? 'Ajustes' : 'Ocultar';
    btn.setAttribute('aria-expanded', String(!min));
    try { localStorage.setItem(PHOTO_MIN_KEY, min ? '1' : '0'); } catch { /* sin almacenamiento */ }
  };
  btn.addEventListener('click', () => set(!panel.classList.contains('fv-min')));
  panel.prepend(head);
  set(min0);
}

export function installUi2(ctx) {
  const ui = ctx.ui;
  // retícula en espacio de mundo (anillo rosa): fuera (spec §3). fx.render la reactiva cada frame; se ignora.
  const aim = ctx.fx?.aim;
  if (aim) Object.defineProperty(aim, 'visible', { get: () => false, set: () => {}, configurable: true });
  ui.weapons.attach();
  // volúmenes del jugador -> buses de B (master / efectos / música); se aplican ya y en cada cambio del slider
  const pushVolumes = () => ctx.audio?.setVolumes?.({ master: ui.prefs.get('volMaster'), sfx: ui.prefs.get('volSfx'), music: ui.prefs.get('volMusic') });
  pushVolumes();
  ctx.bus.on('prefs', d => { if (String(d?.key || '').startsWith('vol')) pushVolumes(); });
  ctx.bus.on('unlock', pushVolumes);
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
  const photoObs = new MutationObserver(() => { const p = document.querySelector('.fv-photo[data-fv-photo-ui]'); if (p) enhancePhotoPanel(p); });
  photoObs.observe(document.body, { childList: true });
  const prevDispose = ui.dispose;
  ui.dispose = () => { photoObs.disconnect(); prevDispose?.(); };
  return ui;
}
