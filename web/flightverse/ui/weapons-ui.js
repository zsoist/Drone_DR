// flightverse/ui/weapons-ui.js — UI de armas: panel de combate, chip/selector de arma,
// botones de disparo y sus lecturas (munición, enfriamiento) (WS A).
// La lógica de disparo vive en fx/index.js (doFire) e input/bindings.js (gatillo).
// Refactor A0: extraído de volar.js sin cambio de comportamiento.
import { createWeaponPicker } from '/flightverse/mobile-command.js?v=368';
import { WEAPON_PROFILES } from '/flightverse/weapon-registry.js?v=368';
import { ARSENAL } from '/flightverse/weapons.js?v=368';

export const combatMarkup = () => `    <div class="vl-corner br">
      <div class="vl-combat" id="vl-combat" role="dialog" aria-modal="false" aria-labelledby="vl-combat-title">
        <div class="vl-dock-head vl-panel-drag"><b id="vl-combat-title">COMBATE <small>ARRASTRAR</small></b><button id="vl-combat-close">Cerrar</button></div>
        <div class="vl-kills" id="vl-kills"></div>
        <div class="vl-weps" id="vl-weps"></div>
        <button class="vl-fire" id="vl-fire" title="X · disparar (Z cambia arma)" aria-label="Disparar">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="3.2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>
          </svg>
          <strong>DISPARAR</strong>
          <span id="vl-ammo">8</span>
          <i id="vl-cool"></i>
        </button>
      </div>
    </div>
`;
export const commandMarkup = () => `    <div class="vl-command-hud" id="vl-command-hud" aria-label="Controles de combate">
      <button class="vl-weapon-toggle" id="vl-weapon-toggle"
        aria-controls="vl-weapon-picker" aria-haspopup="listbox" aria-expanded="false">
        <span id="vl-weapon-code">M·M</span>
        <output id="vl-weapon-status">8</output>
      </button>
      <div class="vl-weapon-picker" id="vl-weapon-picker"
        role="listbox" aria-label="Seleccionar arma" hidden></div>
      <button class="vl-trigger" id="vl-trigger" title="X · disparar" aria-label="Disparar arma seleccionada">
        <span>◎</span><strong>FUEGO</strong>
      </button>
    </div>
`;

const $ = s => document.querySelector(s);

export function createWeaponsUi(ctx) {
  const fireBtn = $('#vl-fire');
  const triggerBtn = $('#vl-trigger');
  const weaponToggle = $('#vl-weapon-toggle');
  const weaponOptionMarkup = Object.entries(WEAPON_PROFILES).map(([key, profile]) => (
    `<button role="option" data-w="${key}" aria-selected="${key === 'm'}">${profile.label}</button>`
  )).join('');
  $('#vl-weps').innerHTML = weaponOptionMarkup;
  $('#vl-weapon-picker').innerHTML = weaponOptionMarkup;
  const weaponItems = [...document.querySelectorAll('#vl-weapon-picker button[data-w]')];
  const WEAPON_CODES = Object.fromEntries(
    Object.entries(WEAPON_PROFILES).map(([key, profile]) => [key, profile.code]),
  );
  const triggerLabel = () => {
    const triggerState = ctx.trigger;
    return triggerState.locked
      ? 'LIBERA PARA REARMAR'
      : triggerState.mode === 'auto' && triggerState.held ? 'MG AUTO'
        : 'LISTO';
  };
  const updateTriggerUi = () => {
    const { weapons } = ctx.fx;
    const triggerState = ctx.trigger;
    const weapon = ARSENAL[weapons.state.weapon];
    const ammo = Math.floor(weapons.state.ammo[weapons.state.weapon]);
    $('#vl-weapon-code').textContent = WEAPON_CODES[weapons.state.weapon];
    $('#vl-weapon-status').textContent = ammo;
    weaponToggle.setAttribute('aria-label', `${weapon.label}, ${ammo} municiones`);
    for (const item of weaponItems) {
      item.setAttribute('aria-selected', String(item.dataset.w === weapons.state.weapon));
    }
    triggerBtn.classList.toggle('locked', triggerState.locked);
    triggerBtn.setAttribute('aria-pressed', String(triggerState.held));
    triggerBtn.setAttribute('aria-label', `Disparar ${weapon.label}. ${triggerLabel()}`);
  };

  const setWeapon = k => {
    ctx.fx.selectWeapon(k);
    document.querySelectorAll('#vl-weps button, #vl-weapon-picker button').forEach(b =>
      b.classList.toggle('sel', b.dataset.w === k));
    updateTriggerUi();
  };

  let picker = null;
  /** Crea el selector de arma y el atajo de pointerdown del panel de combate. */
  function attach() {
    picker = createWeaponPicker({
      trigger: weaponToggle,
      panel: $('#vl-weapon-picker'),
      items: weaponItems,
      eventRoot: document,
      onSelect: setWeapon,
      onActiveChange: active => {
        if (active) ctx.controls.flightTools?.closeAll('peer');
        const gimbalTrigger = $('#vl-gimbal-toggle');
        if (gimbalTrigger) gimbalTrigger.hidden = active;
      },
    });
    api.picker = picker;
    document.addEventListener('pointerdown', e => {
      const activeOverlay = ctx.ui.overlay?.active();
      const b = e.target.closest('#vl-weps button[data-w]');
      if (activeOverlay && (activeOverlay !== 'combat' || !b?.closest('#vl-combat'))) return;
      if (b) setWeapon(b.dataset.w);
    });
  }

  /** Destello del botón de disparo (reinicia la animación CSS). */
  function flashFire() {
    fireBtn.classList.remove('flash'); void fireBtn.offsetWidth;   // reinicia anim
    fireBtn.classList.add('flash');
    triggerBtn.classList.remove('flash'); void triggerBtn.offsetWidth;
    triggerBtn.classList.add('flash');
  }

  /** Lecturas por frame: mini-barras de munición, contador, enfriamiento, derribos. */
  function update() {
    const { weapons } = ctx.fx;
    // mini-barras de munición por arma (HUD de vida de armas)
    document.querySelectorAll('#vl-weps button, #vl-weapon-picker button').forEach(b => {
      const k = b.dataset.w;
      b.style.setProperty('--ammo', `${(weapons.state.ammo[k] / ARSENAL[k].max) * 100}%`);
    });
    const st = weapons.state;
    const WA = ARSENAL[st.weapon];
    $('#vl-ammo').textContent = Math.floor(st.ammo[st.weapon]);
    updateTriggerUi();
    $('#vl-cool').style.transform = `scaleX(${1 - st.cool / (WA.cd || WA.rate)})`;
    fireBtn.classList.toggle('is-empty', st.ammo[st.weapon] < 1);
    if (st.destroyed) { const k = $('#vl-kills'); k.textContent = `DERRIBOS ${st.destroyed}`; k.classList.add('show'); }
  }

  const api = {
    fireBtn, triggerBtn, weaponToggle, picker: null,
    attach, setWeapon, updateTriggerUi, flashFire, update,
    dispose() { picker?.dispose(); },
  };
  return api;
}
