// flightverse/ui/weapons2.js — armas en el HUD v2 (WS A): UN botón de fuego (76 px), chip de arma
// (toque = siguiente; mantener o deslizar arriba = rueda radial de 6 iconos), tira de 6 ranuras
// con teclas 1-6 en escritorio y lectura de munición/recarga. La lógica (doFire, cadencia, munición)
// sigue en fx/ y input/; aquí solo presentación. Mismo contrato que weapons-ui.js (A0):
//   ctx.ui.weapons = { fireBtn, triggerBtn, weaponToggle, picker{close,open,toggle}, attach, setWeapon,
//                      updateTriggerUi, flashFire, update, dispose }
import { WEAPON_PROFILES } from '/flightverse/weapon-registry.js?v=368';
import { ARSENAL } from '/flightverse/weapons.js?v=368';

/** Las 6 armas de la UI (spec §4). Las variantes M·S / M·L / VIPER-X siguen en el registro como perfiles internos. */
export const UI_WEAPONS = Object.freeze(['mg', 'ac', 'm', 'sw', 'rg', 'tb']);
export const WEAPON_NAME = Object.freeze({ mg: 'MG', ac: 'AC-30', m: 'MISIL', sw: 'SWARM-8', rg: 'RAIL', tb: 'NOVA' });
const FAMILY = { s: 'm', l: 'm', vx: 'm' };           // variantes → icono de la familia
const famOf = k => FAMILY[k] || k;
const svg = body => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const WEAPON_ICON = Object.freeze({
  mg: svg('<path d="M6 7v4M12 7v4M18 7v4"/><path d="M4 16h16"/>'),                       // tres marcas sobre una barra
  ac: svg('<path d="M4 12h16" stroke-width="3.4"/>'),                                      // barra gruesa
  m: svg('<path d="M12 3l4 8H8z"/><path d="M8 11l-3 6M16 11l3 6M12 11v9"/>'),             // nariz triangular sobre aleta
  sw: svg(['6,7', '12,7', '18,7', '6,13', '12,13', '18,13', '9,19', '15,19'].map(p => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor" stroke="none"/>`; }).join('')), // racimo de 8
  rg: svg('<path d="M3 12h18"/><circle cx="12" cy="12" r="4.5"/>'),                      // línea con anillo
  tb: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>'),          // círculo dentro de círculo
});
const weaponKeys = () => UI_WEAPONS.filter(k => WEAPON_PROFILES[k] && ARSENAL[k]);

export const combatV2Markup = () => {
  const strip = UI_WEAPONS.map((k, i) => `<button type="button" class="hx-slot" data-w="${k}" aria-label="${WEAPON_NAME[k]}" aria-pressed="false"><kbd>${i + 1}</kbd>${WEAPON_ICON[k]}<span class="hx-ammo-n">0</span></button>`).join('');
  return `    <div class="hx-actions" id="hx-actions">
      <button class="hx-wchip" id="hx-wchip" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="hx-wheel"><span class="hx-wico"></span><span class="hx-ammo-n" id="hx-wammo">0</span></button>
      <div class="hx-wheel" id="hx-wheel" role="listbox" aria-label="Seleccionar arma" hidden></div>
      <button class="hx-fire" id="hx-fire" type="button" aria-label="Disparar">
        <svg class="hx-fire-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="37" class="trk"/><circle cx="40" cy="40" r="37" class="arc" id="hx-fire-arc" transform="rotate(-90 40 40)"/></svg>
        <svg class="hx-fire-ico" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5"/></svg>
      </button>
      <button id="hx-fire-stub" type="button" hidden tabindex="-1" aria-hidden="true"></button>
    </div>
    <div class="hx-wstrip" id="hx-wstrip" role="toolbar" aria-label="Armas">${strip}</div>
    <div class="hx-heat" id="hx-heat" aria-hidden="true"><b id="hx-heat-name">MISIL</b><span id="hx-heat-ammo">8</span></div>
`;
};

const $ = s => document.querySelector(s);

export function createWeaponsUi2(ctx) {
  const fireBtn = $('#hx-fire'), stub = $('#hx-fire-stub'), chip = $('#hx-wchip'), wheel = $('#hx-wheel');
  const actions = $('#hx-actions'), arc = $('#hx-fire-arc'), strip = $('#hx-wstrip');
  const keys = weaponKeys();
  const R = 37, CIRC = 2 * Math.PI * R;
  arc.style.strokeDasharray = `${CIRC}`;
  wheel.innerHTML = keys.map(k => `<button type="button" role="option" class="hx-wopt" data-w="${k}" aria-label="${WEAPON_NAME[k]}" aria-selected="false">${WEAPON_ICON[k]}<span class="hx-ammo-n">0</span></button>`).join('');
  const opts = [...wheel.querySelectorAll('.hx-wopt')];
  const slots = [...strip.querySelectorAll('.hx-slot')];
  let lastActive = performance.now();
  let opened = false, pending = null, sticky = 0, lastKey = 'm', heldBlur = 0;
  let disposed = false;
  const cur = () => ctx.fx?.weapons?.state?.weapon || 'm';
  const touch = () => { lastActive = performance.now(); actions.classList.remove('idle'); };

  const place = () => {           // abanico de 6 iconos de 52 px a radio ~100 px, hacia el centro de la pantalla
    const r = chip.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const base = Math.atan2(innerHeight / 2 - cy, innerWidth / 2 - cx);
    const n = opts.length, step = 32 * Math.PI / 180, R0 = 104;
    const pr = actions.getBoundingClientRect();
    opts.forEach((b, i) => {
      const a = base + (i - (n - 1) / 2) * step;
      // centro del icono, acotado al viewport (la rueda nace junto al borde derecho)
      const ix = Math.min(innerWidth - 30, Math.max(30, cx + Math.cos(a) * R0));
      const iy = Math.min(innerHeight - 30, Math.max(70, cy + Math.sin(a) * R0));
      b.style.left = `${ix - pr.left - 26}px`;
      b.style.top = `${iy - pr.top - 26}px`;
      b.style.transitionDelay = `${i * 12}ms`;
    });
    wheel.style.setProperty('--ox', `${cx - pr.left}px`);
    wheel.style.setProperty('--oy', `${cy - pr.top}px`);
  };
  const openWheel = () => {
    if (opened || disposed) return false;
    opened = true; place();
    wheel.hidden = false;
    requestAnimationFrame(() => wheel.classList.add('open'));
    chip.setAttribute('aria-expanded', 'true');
    ctx.controls.flightTools?.closeAll('peer');
    return true;
  };
  const closeWheel = (reason = 'close') => {
    if (!opened) return false;
    opened = false; clearTimeout(sticky);
    wheel.classList.remove('open');
    chip.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!opened) wheel.hidden = true; }, 160);
    if (!['outside', 'overlay', 'orientation', 'dispose'].includes(reason)) chip.focus?.({ preventScroll: true });
    return true;
  };
  const picker = { close: closeWheel, open: openWheel, toggle: () => (opened ? closeWheel('toggle') : openWheel()), get isOpen() { return opened; } };

  const nextKey = dir => {
    const i = keys.indexOf(famOf(cur()));
    return keys[(i + dir + keys.length) % keys.length];
  };
  const setWeapon = k => {
    if (k !== cur()) lastKey = cur();
    ctx.fx.selectWeapon(k);
    touch(); updateTriggerUi();
  };

  function attach() {
    const onDown = e => {
      if (ctx.ui.overlay?.active() || pending) return;
      e.preventDefault();
      chip.setPointerCapture?.(e.pointerId);
      pending = { id: e.pointerId, x: e.clientX, y: e.clientY, hover: null, wasOpen: opened };
      if (!opened) pending.timer = setTimeout(() => { if (pending) openWheel(); }, 350);
    };
    const hoverAt = (x, y) => {
      let best = null, bd = 34;
      for (const b of opts) { const r = b.getBoundingClientRect(); const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)); if (d < bd) { bd = d; best = b; } }
      for (const b of opts) b.classList.toggle('hover', b === best);
      return best;
    };
    const onMove = e => {
      if (!pending || e.pointerId !== pending.id) return;
      if (!opened && pending.y - e.clientY > 24) openWheel();
      if (opened) pending.hover = hoverAt(e.clientX, e.clientY);
    };
    const onUp = e => {
      if (!pending || e.pointerId !== pending.id) return;
      clearTimeout(pending.timer);
      const was = pending; pending = null;
      chip.releasePointerCapture?.(e.pointerId);
      if (was.wasOpen) { closeWheel('toggle'); return; }     // toque sobre la rueda abierta = cerrarla
      if (opened) {
        const pick = was.hover;
        for (const b of opts) b.classList.remove('hover');
        if (pick) { setWeapon(pick.dataset.w); closeWheel('select'); }
        else { clearTimeout(sticky); sticky = setTimeout(() => closeWheel('timeout'), 3500); }
      } else if (e.type === 'pointerup') setWeapon(nextKey(1));   // toque = siguiente
    };
    chip.addEventListener('pointerdown', onDown);
    chip.addEventListener('pointermove', onMove);
    chip.addEventListener('pointerup', onUp);
    chip.addEventListener('pointercancel', e => { onUp(e); closeWheel('cancel'); });
    chip.addEventListener('click', e => {                       // teclado / lector de pantalla
      if (e.detail !== 0) return;
      if (e.shiftKey) picker.toggle(); else setWeapon(nextKey(1));
    });
    chip.addEventListener('keydown', e => { if (e.key === 'ArrowUp') { e.preventDefault(); openWheel(); opts[0]?.focus(); } });
    wheel.addEventListener('click', e => {
      const b = e.target.closest('.hx-wopt'); if (!b) return;
      setWeapon(b.dataset.w); closeWheel('select');
    });
    wheel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWheel('escape'); } });
    addEventListener('pointerdown', e => { if (opened && !wheel.contains(e.target) && !chip.contains(e.target)) closeWheel('outside'); }, true);
    strip.addEventListener('click', e => { const b = e.target.closest('.hx-slot'); if (b) setWeapon(b.dataset.w); });
    // teclas 1-6 / Tab / rueda: las gestiona input/v2-input.js (WS C) y llaman a ui.weapons.setWeapon.
  }

  function flashFire() {
    fireBtn.classList.remove('flash'); void fireBtn.offsetWidth; fireBtn.classList.add('flash');
    touch();
  }

  let lastSig = '';
  function updateTriggerUi() {
    const w = ctx.fx.weapons.state, key = w.weapon, fam = famOf(key);
    const ammo = Math.floor(w.ammo[key]);
    const t = ctx.trigger;
    const label = `Disparar ${WEAPON_NAME[fam] || ARSENAL[key]?.label}`;
    const sig = `${key}|${ammo}|${t.held}|${t.locked}`;
    if (sig === lastSig) return;
    lastSig = sig;
    fireBtn.setAttribute('aria-label', `${label}, ${ammo} municiones`);
    fireBtn.setAttribute('aria-pressed', String(t.held));
    fireBtn.classList.toggle('held', t.held);
    fireBtn.classList.toggle('locked', t.locked);
    chip.querySelector('.hx-wico').innerHTML = WEAPON_ICON[fam] || '';
    chip.setAttribute('aria-label', `Arma: ${WEAPON_NAME[fam]}, ${ammo} municiones. Toca para cambiar, mantén para elegir`);
    $('#hx-wammo').textContent = ammo;
    $('#hx-heat-name').textContent = WEAPON_NAME[fam] || key;
    $('#hx-heat-ammo').textContent = ammo;
    for (const b of opts) b.setAttribute('aria-selected', String(b.dataset.w === fam));
    for (const s of slots) { const on = s.dataset.w === fam; s.classList.toggle('sel', on); s.setAttribute('aria-pressed', String(on)); }
  }

  function update() {
    const { weapons } = ctx.fx, st = weapons.state, W = ARSENAL[st.weapon];
    const ammo = Math.floor(st.ammo[st.weapon]);
    // cooldown: arco alrededor del botón (1 = listo)
    const ready = 1 - Math.min(1, st.cool / (W.cd || W.rate || 1));
    arc.style.strokeDashoffset = String(CIRC * (1 - ready));
    fireBtn.classList.toggle('is-empty', ammo < 1);
    // munición por ranura / rueda (valores enteros: pocos cambios de DOM)
    for (const s of [...slots, ...opts]) {
      const k = s.dataset.w, n = Math.floor(st.ammo[k] ?? 0), span = s.querySelector('.hx-ammo-n');
      if (span.textContent !== String(n)) span.textContent = n;
    }
    updateTriggerUi();
    const combat = ctx.enemies?.invasion?.state.on || ctx.state.reto || ctx.state.onboardingCombat;
    if (!combat && performance.now() - lastActive > 2500) actions.classList.add('idle'); else actions.classList.remove('idle');
    void heldBlur;
  }

  const api = {
    fireBtn, triggerBtn: stub, weaponToggle: chip, picker, slots: { cluster: actions },
    attach, setWeapon, updateTriggerUi, flashFire, update,
    dispose() { disposed = true; closeWheel('dispose'); },
  };
  return api;
}
