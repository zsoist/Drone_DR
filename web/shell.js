// App shell: sidebar nav, shared formatters, data access. Requires icons.js.
const DATA = 'data';

// ---- captura global de errores JS → /api/client_error (registro central + reporte DeepSeek).
// sendBeacon: no bloquea ni falla ruidoso; máx 5 por sesión de página (anti-loop de un error
// que se repite en cada frame). El server además rate-limita globalmente.
(() => {
  let sent = 0;
  const report = (msg, stack) => {
    if (sent >= 5 || !navigator.sendBeacon) return;
    sent++;
    try {
      navigator.sendBeacon('/api/client_error', new Blob([JSON.stringify({
        msg: String(msg).slice(0, 300),
        stack: String(stack || '').slice(0, 200),
        page: location.pathname.split('/').pop(),
      })], { type: 'application/json' }));
    } catch { /* jamás romper la app por reportar */ }
  };
  addEventListener('error', e => report(e.message, e.error?.stack));
  addEventListener('unhandledrejection', e => report(`unhandled: ${e.reason?.message || e.reason}`, e.reason?.stack));
})();

const NAV = [
  { href: 'home.html', ic: 'gauge', label: 'Inicio', tab: true },
  { href: 'index.html', ic: 'grid', label: 'Vuelos', tab: true },
  { href: 'drone.html', ic: 'drone', label: 'Dron' },
  { href: 'trips.html', ic: 'pin', label: 'Viajes' },
  { href: 'mundo.html', ic: 'globe', label: 'Mundo' },
  { href: 'studio.html', ic: 'film', label: 'Studio', tab: true },
  { href: 'tresd.html', ic: 'cube', label: '3D', tab: true },
  { href: 'splatlab.html', ic: 'splat', label: 'Splat Lab' },
  { href: 'ventas.html', ic: 'tag', label: 'Ventas' },
  { href: 'system.html', ic: 'db', label: 'Sistema' },
];
// destinos secundarios del móvil (hoja «Más») + Guía, que solo vive en el footer/hoja
const NAV_MORE = [...NAV.filter(n => !n.tab), { href: 'guia.html', ic: 'list', label: 'Guía' }];

// Cabecera de página unificada (.page-head en style.css): título + subtítulo opcional + acciones a la derecha.
// pageHead('Sistema', 'inventario · costos', '<button class="btn sm">…</button>')
// opts.subId: el subtítulo existe siempre con ese id + aria-live (contador que el JS de la página rellena).
function pageHead(title, sub = '', actions = '', opts = {}) {
  const subEl = sub || opts.subId
    ? `<p class="page-head-sub"${opts.subId ? ` id="${opts.subId}" aria-live="polite"` : ''}>${esc(sub)}</p>` : '';
  return `<header class="page-head"><div class="page-head-t"><h1>${esc(title)}</h1>${subEl}</div>${actions ? `<div class="page-head-actions">${actions}</div>` : ''}</header>`;
}

// Estado vacío canónico (.empty): icono + título + ayuda + acción opcional (HTML de un .btn).
// emptyState({ icon: 'pin', title: 'Sin vuelos', help: 'Importa una SD desde Dron.', action: '<a class="btn primary" href="drone.html">Ir a Dron</a>' })
function emptyState({ icon: ic = 'search', title = '', help = '', action = '', cls = '' } = {}) {
  return `<div class="empty${cls ? ' ' + cls : ''}">${ic ? icon(ic) : ''}${title ? `<b>${esc(title)}</b>` : ''}${help ? `<p>${esc(help)}</p>` : ''}${action}</div>`;
}

// Arranque del resumen AI sin la muletilla ("El vuelo inicia con…") — títulos cortos de vuelo (Vuelos, Viajes).
function shortTitle(text) {
  let t = String(text || '').trim();
  t = t.replace(/^(el|la|este|esta)\s+(vuelo|dron|drone|clip|video|metraje|material)(\s+\S+)??\s+(inicia|comienza|muestra|captura|realiza|presenta|sobrevuela|ofrece|documenta|registra|recorre|revela)(\s+(con|sobre|en))?\s+/i, '');
  t = t.replace(/^(un|una|unos|unas)\s+/i, '');
  t = t.split(/[,.;:]| y | para | mientras | luego | donde /i)[0].trim();
  if (t.length > 64) t = t.slice(0, 64).replace(/\s+\S*$/, '') + '…';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

// ---- popover + menú canónicos (CSS: .pop / .menu-i en style.css) ------------------------------------------
// openPopover(anchor, content, opts) → { el, close } | null   (null = estaba abierto para ese ancla y se cerró: toggle)
//   content: Node ya construido · opts: { label, role, haspopup, align:'end'|'start', className, focus: selector|false,
//   onClose }. Un solo popover abierto a la vez. Cierra con Esc (devuelve el foco al ancla), clic/tap fuera, scroll
//   fuera del popover, resize y Tab. Se posiciona `fixed` bajo el ancla y se voltea arriba si no cabe.
// openMenu(anchor, items, opts) → igual, con role=menu/menuitem, flechas ↑↓ Home End, tipeo-para-saltar.
//   items: [{ id, label, icon, hint, danger, disabled, href, target, sep }] · opts.onSelect(id, item) corre DESPUÉS
//   de cerrar y devolver el foco (un modal abierto desde la acción recuerda el ancla como opener).
// ---- pila de capas (UN solo listener de teclado en window+captura) ----------------------------------------
// Popovers, modales y la hoja «Más» se apilan aquí; solo la capa de ARRIBA recibe teclas, así Esc cierra primero
// lo más alto (menú > modal > visor) y nunca hay dos listeners compitiendo.
// pushLayer({ onKey(e) }) → layer · popLayer(layer). Bloqueo de scroll de <html> con contador: lockScroll()/unlockScroll().
const _layers = [];
function _layerKey(e) { const top = _layers[_layers.length - 1]; if (top) top.onKey(e); }
function pushLayer(layer) {
  _layers.push(layer);
  if (_layers.length === 1) window.addEventListener('keydown', _layerKey, true);
  return layer;
}
function popLayer(layer) {
  const i = _layers.indexOf(layer);
  if (i < 0) return;
  _layers.splice(i, 1);
  if (!_layers.length) window.removeEventListener('keydown', _layerKey, true);
}
let _lockN = 0, _lockPad = '';
function lockScroll() {
  if (_lockN++ > 0) return;
  const html = document.documentElement;
  const sb = window.innerWidth - html.clientWidth;          // compensa el ancho de la barra para que no salte el layout
  _lockPad = html.style.paddingRight;
  html.classList.add('modal-open');
  if (sb > 0) html.style.paddingRight = sb + 'px';
}
function unlockScroll() {
  if (_lockN === 0 || --_lockN > 0) return;
  const html = document.documentElement;
  html.classList.remove('modal-open');
  html.style.paddingRight = _lockPad;
}

let _pop = null;
function closePopover({ refocus = false } = {}) {
  const p = _pop;
  if (!p) return;
  _pop = null;
  popLayer(p.layer);
  document.removeEventListener('pointerdown', p.onDown, true);
  window.removeEventListener('scroll', p.onScroll, true);
  window.removeEventListener('resize', p.onResize);
  p.anchor.setAttribute('aria-expanded', 'false');
  p.el.remove();
  try { p.onClose && p.onClose(); } catch {}
  if (refocus && p.anchor.isConnected) { try { p.anchor.focus({ preventScroll: true }); } catch {} }
}
function placePopover(el, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight, gap = 6, m = 8;
  const left = align === 'start' ? r.left : r.right - w;
  const below = r.bottom + gap + h <= innerHeight - m;
  const top = below ? r.bottom + gap : Math.max(m, r.top - gap - h);
  el.style.left = Math.max(m, Math.min(innerWidth - w - m, left)) + 'px';
  el.style.top = top + 'px';
}
function openPopover(anchor, content, opts = {}) {
  if (_pop && _pop.anchor === anchor) { closePopover(); return null; }
  closePopover();
  const el = document.createElement('div');
  el.className = 'pop' + (opts.className ? ' ' + opts.className : '');
  if (opts.role) el.setAttribute('role', opts.role);
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.appendChild(content);
  document.body.appendChild(el);
  anchor.setAttribute('aria-haspopup', opts.haspopup || opts.role || 'true');
  anchor.setAttribute('aria-expanded', 'true');
  placePopover(el, anchor, opts.align || 'end');
  const p = _pop = { el, anchor, onClose: opts.onClose };
  p.onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover({ refocus: true }); }
    else if (e.key === 'Tab') closePopover();
    else if (opts.onKey) opts.onKey(e, el);
  };
  p.onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  p.onScroll = e => { if (!el.contains(e.target)) closePopover(); };
  p.onResize = () => closePopover();
  p.layer = pushLayer({ onKey: p.onKey });   // pila de capas: gana a los Esc de modales/visores y solo el de arriba responde
  document.addEventListener('pointerdown', p.onDown, true);
  window.addEventListener('scroll', p.onScroll, true);
  window.addEventListener('resize', p.onResize);
  if (opts.focus !== false) {
    const f = typeof opts.focus === 'string' ? el.querySelector(opts.focus) : null;
    (f || el.querySelector('[role=menuitem]:not([aria-disabled=true]), input, button, [tabindex="0"]'))?.focus({ preventScroll: true });
  }
  return { el, close: o => { if (_pop === p) closePopover(o); } };
}
function openMenu(anchor, items, opts = {}) {
  const box = document.createElement('div');
  box.style.display = 'contents';
  box.innerHTML = items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    const inner = `${it.icon ? icon(it.icon) : ''}${it.hint
      ? `<span class="menu-t"><b>${esc(it.label)}</b><small>${esc(it.hint)}</small></span>` : `<span>${esc(it.label)}</span>`}`;
    const cls = `menu-i${it.danger ? ' danger' : ''}`;
    const dis = it.disabled ? ' aria-disabled="true"' : '';
    return it.href
      ? `<a role="menuitem" class="${cls}" data-mi="${i}" href="${esc(it.href)}"${it.target ? ` target="${esc(it.target)}" rel="noopener"` : ''}${dis}>${inner}</a>`
      : `<button type="button" role="menuitem" class="${cls}" data-mi="${i}"${dis}>${inner}</button>`;
  }).join('');
  const enabled = () => [...box.querySelectorAll('[role=menuitem]:not([aria-disabled=true])')];
  const pop = openPopover(anchor, box, {
    role: 'menu', haspopup: 'menu', label: opts.label, align: opts.align, className: opts.className, focus: false,
    onKey: (e, el) => {
      const list = enabled(), i = list.indexOf(document.activeElement);
      if (!list.length) return;
      const go = n => { e.preventDefault(); list[(n + list.length) % list.length].focus({ preventScroll: true }); };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(-1);
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const hit = [...list.slice(i + 1), ...list.slice(0, i + 1)].find(b => b.textContent.trim().toLowerCase().startsWith(k));
        if (hit) { e.preventDefault(); hit.focus({ preventScroll: true }); }
      }
    },
  });
  if (!pop) return null;
  pop.el.addEventListener('click', e => {
    const b = e.target.closest('[data-mi]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const item = items[+b.dataset.mi];
    closePopover({ refocus: true });
    if (item.onSelect) item.onSelect(item.id, item);
    if (opts.onSelect) opts.onSelect(item.id, item);
  });
  (opts.focusLast ? enabled().pop() : enabled()[0])?.focus({ preventScroll: true });
  return pop;
}

// ---- modal accesible compartido (API pública para páginas) ------------------------------------------------
// const close = openModal(ov, { onClose, label, initialFocus, closeOnBackdrop })   ov = <div class="modal-ov"><div class="modal">…
//   · role=dialog + aria-modal + aria-labelledby (auto: primer .modal-h b / h1-h3; si no hay, opts.label o «Diálogo»).
//   · Foco inicial: opts.initialFocus (selector|Element) → [autofocus] → primer control que NO sea la ×; en táctil los
//     campos de texto no se enfocan solos (evita abrir el teclado): entonces el foco va a la tarjeta.
//   · Tab atrapado dentro; Esc cierra SOLO el modal de arriba (pila de capas); clic en el fondo o en .modal-x cierra
//     (el clic debe empezar Y terminar en el fondo: arrastrar una selección de texto fuera no lo cierra).
//   · <html> sin scroll mientras haya ≥1 modal (contador); el foco vuelve a quien abrió el modal.
//   · Cualquier ov.remove() posterior (p. ej. tras guardar) hace lo mismo que close(): limpia capa, scroll y foco.
//   · La × es <button class="modal-x">: se le fuerza type=button y aria-label «Cerrar» si falta.
const _modalStack = [];
let _modalSeq = 0;
function openModal(ov, { onClose, label, initialFocus, closeOnBackdrop = true } = {}) {
  const opener = document.activeElement;
  const modal = ov.querySelector('.modal') || ov;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const head = modal.querySelector('.modal-h b, .tx-pop-h b, .modal-h, h1, h2, h3');
  if (head && !label) { head.id = head.id || `mdl-t${++_modalSeq}`; modal.setAttribute('aria-labelledby', head.id); }
  else modal.setAttribute('aria-label', label || 'Diálogo');
  modal.tabIndex = -1;
  ov.querySelectorAll('.modal-x').forEach(x => {
    if (x.tagName === 'BUTTON' && !x.getAttribute('type')) x.type = 'button';
    if (!x.hasAttribute('aria-label')) x.setAttribute('aria-label', 'Cerrar');
  });
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusables = () => [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  let done = false, downOnBackdrop = false;
  const nativeRemove = ov.remove.bind(ov);
  const layer = { onKey };
  const cleanup = () => {
    if (done) return;
    done = true;
    popLayer(layer);
    const i = _modalStack.indexOf(ov); if (i >= 0) _modalStack.splice(i, 1);
    unlockScroll();
    try { onClose && onClose(); } catch {}
    nativeRemove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus({ preventScroll: true }); } catch {} }
  };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) { e.preventDefault(); modal.focus(); return; }
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!modal.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (cur === first || cur === modal)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  ov.remove = cleanup;
  ov.addEventListener('pointerdown', e => { downOnBackdrop = e.target === ov; });
  ov.addEventListener('click', e => {
    if (e.target.closest('.modal-x')) cleanup();
    else if (closeOnBackdrop && e.target === ov && downOnBackdrop) cleanup();
  });
  document.body.appendChild(ov);
  _modalStack.push(ov);
  pushLayer(layer);
  lockScroll();
  let target = typeof initialFocus === 'string' ? modal.querySelector(initialFocus) : initialFocus;
  if (!target) target = modal.querySelector('[autofocus]');
  if (!target) {
    target = focusables().find(el => !el.classList.contains('modal-x')) || null;
    if (target && matchMedia('(pointer: coarse)').matches && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) target = null;
  }
  (target || modal).focus({ preventScroll: true });
  return cleanup;
}

// ---- nombre accesible para botones/enlaces solo-icono: aria-label sale de data-tip
(() => {
  const SEL = 'button[data-tip],a[data-tip],[role=button][data-tip]';
  const name = el => {
    if (el.hasAttribute('aria-label') && !el.hasAttribute('data-autoname')) return;
    if (el.hasAttribute('aria-labelledby') || el.textContent.trim() || !el.dataset.tip) return;
    el.setAttribute('aria-label', el.dataset.tip); el.setAttribute('data-autoname', '');
  };
  const scan = root => {
    if (root.nodeType !== 1) return;
    if (root.matches(SEL)) name(root);
    root.querySelectorAll(SEL).forEach(name);
  };
  const start = () => {
    scan(document.body);
    let queued = new Set(), raf = 0;
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes') queued.add(m.target);
        else m.addedNodes.forEach(n => queued.add(n));
      }
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = new Set(); q.forEach(scan); });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tip'] });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// scrub de miniaturas compartido (Vuelos, Viajes, Inicio): mouse hover + swipe horizontal iOS
function attachScrub(root) {
  root.querySelectorAll('.card.scrub, .cr-item.scrub').forEach(cardEl => {
    const n = +cardEl.dataset.frames;
    if (!n) return;
    const img = cardEl.querySelector('img');
    const line = cardEl.querySelector('.scrub-line');
    if (!img || !line) return;
    const orig = img.src;
    const at = frac => {
      const i = Math.max(1, Math.ceil(frac * n));
      img.src = `${DATA}/frames/${cardEl.dataset.cid}/f_${String(i).padStart(4, '0')}.jpg`;
      line.style.width = `${(frac * 100).toFixed(1)}%`;
      line.style.opacity = 1;
    };
    cardEl.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;              // touch usa el gesto propio
      const r = cardEl.getBoundingClientRect();
      at((e.clientX - r.left) / r.width);
    });
    cardEl.addEventListener('pointerleave', () => { img.src = orig; line.style.opacity = 0; });
    // iOS: deslizar horizontal sobre el thumb scrubbea; vertical sigue scrolleando
    let t0 = null, scrubT = 0;
    cardEl.addEventListener('touchstart', e => { t0 = e.touches[0]; clearTimeout(scrubT); }, { passive: true });   // cancela un reset pendiente del gesto anterior
    cardEl.addEventListener('touchmove', e => {
      if (!t0) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - t0.clientX) > Math.abs(t.clientY - t0.clientY) + 6) {
        const r = cardEl.getBoundingClientRect();
        at(Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)));
        e.preventDefault();
      }
    }, { passive: false });
    cardEl.addEventListener('touchend', () => {
      t0 = null;
      clearTimeout(scrubT);   // reemplaza (no acumula) el reset; se cancela si empieza otro scrub
      scrubT = setTimeout(() => { img.src = orig; line.style.opacity = 0; }, 900);
    });
  });
}

// escape HTML: TODO texto de usuario/LLM pasa por aquí antes de innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Aviso no-bloqueante compartido (estilo .ed-toast en style.css; alert() rompe el flujo en móvil)
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'ed-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 350); }, 3600);
}
// The server gates every document and data asset before this code runs. These
// checks cover session expiry while a tab is already open or restored by bfcache.
function loginLocation() {
  const next = location.pathname + location.search + location.hash;
  return `/login.html?next=${encodeURIComponent(next)}`;
}
function redirectToLogin() {
  location.replace(loginLocation());
}
let sessionExpiryTimer = 0;
function armSessionExpiry(session) {
  clearTimeout(sessionExpiryTimer);
  const ttl = Number(session?.expires_in_seconds);
  if (session?.dev_mode || !Number.isFinite(ttl)) return;
  const delay = Math.max(1000, Math.min((ttl + 1) * 1000, 24 * 60 * 60 * 1000 + 2000));
  sessionExpiryTimer = setTimeout(requireSession, delay);
}
async function requireSession() {
  try {
    const response = await fetch('/api/whoami', { cache: 'no-store' });
    if (!response.ok) { redirectToLogin(); return null; }
    const session = await response.json();
    armSessionExpiry(session);
    return session;
  } catch {
    clearTimeout(sessionExpiryTimer);
    sessionExpiryTimer = setTimeout(requireSession, 30 * 1000);
    return null;
  }
}
async function authFetch(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-AeroBrain-CSRF', '1');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('sesión expirada');
  }
  return response;
}

async function api(path, body) {
  const r = await authFetch(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
// compat: código viejo llama getToken() como gate; auth vive en la cookie HttpOnly
function getToken() { return 'session'; }
// migración: borra el token que versiones anteriores dejaron en localStorage
localStorage.removeItem('ab_token');
// páginas con teardown en pagehide (volar/mundo/home/system) marcan __abReloadOnRestore:
// al restaurarse desde bfcache quedan rotas, así que se recargan completas.
addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (window.__abReloadOnRestore) { location.reload(); return; }
  requireSession();
});
setInterval(requireSession, 5 * 60 * 1000);
// limpia códigos ANSI/escape que ODM mete en el log
function cleanLog(t) {
  return String(t || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\^?\[\[[0-9;]*m/g, '').trim();
}
const KIND_META = {
  ingest: { ic: 'dl', name: 'Importar SD' },
  '3d': { ic: 'cube', name: 'Modelo 3D' },
  splat: { ic: 'layers', name: 'Gaussian Splat' },
  edit: { ic: 'film', name: 'Edición' },
  upload: { ic: 'dl', name: 'Subida' },
  analyze: { ic: 'spark', name: 'Análisis AI' },
  foto4k: { ic: 'iso', name: 'Foto 4K' },
};
// etapa humana a partir del log/detail de ODM
function humanStage(j) {
  const src = cleanLog(j.log_tail) + ' ' + (j.detail || '');
  // orden inverso al pipeline: la línea MÁS TARDÍA del tail decide la etapa
  const M = [
    [/Step \d+|entrenando/i, 'Entrenando el splat'],
    [/publicando assets|browser gate|gdal_translate.*ortho/i, 'Publicando assets web'],
    [/running odm_orthophoto|orthophoto area/i, 'Generando ortofoto'],
    [/running odm_dem|gapfill|merged\.vrt/i, 'Calculando elevación (DSM)'],
    [/running (mvs_|odm_)texturing|mvstex/i, 'Texturizando el modelo'],
    [/running odm_meshing|PoissonRecon|dem2mesh/i, 'Generando malla 3D'],
    [/running odm_filterpoints/i, 'Filtrando nube de puntos'],
    [/Fused depth-maps/i, 'Fusionando depthmaps (GPU)'],
    [/Point visibility/i, 'Verificando visibilidad de puntos'],
    [/Estimated depth-maps|DensifyPointCloud|running openmvs/i, 'Calculando depthmaps'],
    [/Undistorting image/i, 'Undistorsionando imágenes'],
    [/resection inliers|incremental reconstruction/i, 'Reconstruyendo cámaras 3D'],
    [/Matching f_|pairs matching/i, 'Emparejando imágenes'],
    [/Extracting ROOT_|detect_features/i, 'Extrayendo características'],
    [/geotag|exiftool/i, 'Geoetiquetando con tu GPS'],
    [/frames: \d+/, 'Extrayendo frames del video'],
  ];
  for (const [re, label] of M) if (re.test(src)) return label;
  return j.detail || '';
}
function jobDuration(seconds) {
  seconds = Number(seconds || 0);
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return seconds ? `${Math.round(seconds)} s` : '—';
}
function jobTimingLabel(j) {
  if (j?.status === 'queued') return 'esperando turno';
  const duration = jobDuration(j?.elapsed_s);
  return j?.status === 'running' ? `${duration} transcurridos` : `${duration} total`;
}
function presetLabel(value) {
  return ({ rapido: 'Rápido', estandar: 'Estándar', alta: 'Alta', extra: 'Extra',
    ultra: 'Ultra 15K', ultra20: 'Ultra+ 20K', frontier: 'Frontier 30K',
    grandmaster: 'Grandmaster 40K', medium: 'Medium 2K', cinematic: 'Cinematic 7K',
    fast: 'Fast 1K' })[value] || value || '—';
}
function backendBadge(backend) {
  if (!backend) return '';
  const b = String(backend);
  const kind = /cuda|nvidia/i.test(b) ? 'cuda' : /metal|mps/i.test(b) ? 'metal' : 'cpu';
  const label = { cuda: 'NVIDIA CUDA', metal: 'Apple Metal', cpu: 'CPU' }[kind];
  const chip = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6 4V1.5M10 4V1.5M6 14.5V12M10 14.5V12M4 6H1.5M4 10H1.5M14.5 6H12M14.5 10H12"/></svg>';
  return `<span class="jc-backend ${kind}" title="Backend de cómputo: ${esc(b)}">${chip}${label}</span>`;
}
const PHASES_3D = [
  ['frames', 'Frames', 'extracción del video + geotag GPS', 0.05, 0.16],
  ['odm', 'Fotogrametría', 'features → SfM → depthmaps → malla', 0.16, 0.96],
  ['publish', 'Publicar', 'ortofoto, DSM y visor web', 0.96, 1.0],
];
function fmtDur(sec) {
  if (sec == null || sec < 0) return '—';
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.round(sec % 3600 / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.round(sec)}s`;
}
function phaseKey(stage) {
  const value = String(stage || '').trim().toLowerCase();
  if (value === 'frames') return 'frames';
  if (value === 'publish' || value === 'browser-qa') return 'publish';
  if (value === 'odm' || value.startsWith('odm-')) return 'odm';
  return value;
}
function phaseDash(j, pct) {
  if (j.kind !== '3d') return '';
  const hist = j.stage_history || [];
  const now = Date.now() / 1000;
  const starts = {};
  hist.forEach(h => { const k = phaseKey(h.stage); if (!(k in starts)) starts[k] = h.ts; });
  if (j.started && !('frames' in starts)) starts.frames = j.started;
  const activeKey = phaseKey(j.stage);
  // done/act por ORDEN de pipeline — los timestamps solo aportan duraciones:
  // un job anterior al tracking de stages no debe mostrar fases pasadas como pendientes
  const activeIdx = Math.max(0, PHASES_3D.findIndex(ph => ph[0] === activeKey));
  const rows = PHASES_3D.map(([key, name, sub, lo, hi], i) => {
    const st = starts[key];
    const nextSt = PHASES_3D.slice(i + 1).map(ph => starts[ph[0]]).find(Boolean);
    const done = j.status === 'done' || i < activeIdx;
    const act = !done && i === activeIdx && ['running', 'queued'].includes(j.status);
    const end = nextSt ?? (j.status === 'done' ? (j.finished || now) : null);
    const dur = st != null ? ((done ? end : now) != null ? (done ? end : now) - st : null) : null;
    const width = done ? 100 : act && pct != null
      ? Math.round(100 * Math.min(1, Math.max(0, (pct / 100 - lo) / (hi - lo)))) : 0;
    return `<div class="jc-ph-row ${done ? 'done' : act ? 'act' : 'pend'}">
      <span class="jc-ph-dot"></span>
      <div class="jc-ph-main"><b>${name}</b><span>${sub}</span></div>
      <div class="jc-ph-bar"><div style="--p:${width / 100}"></div></div>
      <span class="jc-ph-time mono">${done ? (st != null ? fmtDur(dur) : icon('check'))
        : act ? `<b>${width}%</b>${st != null ? ' · ' + fmtDur(dur) : ''}` : '—'}</span>
    </div>`;
  }).join('');
  return `<div class="jc-ph">${rows}</div>`;
}
function phaseRateText(j) {
  const units = { cameras: 'cámaras', features: 'features', images: 'imágenes', points: 'puntos' };
  const unit = units[j.phase_unit] || 'elementos';
  return `${Number(j.phase_items_per_minute).toFixed(1)} ${unit}/min`;
}
function jobDataGrid(j) {
  const cells = [];
  if (j.input_mb) cells.push(['PESO ENTRADA', j.input_mb >= 1024
    ? (j.input_mb / 1024).toFixed(1) + ' GB' : j.input_mb + ' MB']);
  // backend del row cuando existe; si no, el detail del worker es autoritativo
  // ("...en NVIDIA CUDA") — jamás asumir Mac por defecto en un job remoto
  const cudaJob = /cuda|nvidia/i.test(j.effective_backend || j.backend || j.requested_backend || '') ||
    (['running', 'queued'].includes(j.status) && /NVIDIA CUDA/i.test(j.detail || ''));
  const hw = cudaJob ? 'RTX 4060 Ti · 8c WSL'
    : j.backend ? 'Mac M4 · 10 cores'
    : ['3d', 'splat'].includes(j.kind) && !['running', 'queued'].includes(j.status)
      ? 'Mac M4 · 10 cores' : null;
  if (hw) cells.push(['PROCESADOR', hw]);
  if (j.images_total) cells.push(['IMÁGENES', j.images_total]);
  else if (j.cameras_registered != null)
    cells.push(['CÁMARAS', `${j.cameras_registered}/${j.cameras_total || '?'}`, 'registered-cameras']);
  if (j.active_sources != null && j.total_sources)
    cells.push(['FUENTES ACTIVAS', `${j.active_sources}/${j.total_sources}`, 'active-sources']);
  if (j.good_tracks)
    cells.push(['TRACKS ROBUSTOS', Number(j.good_tracks).toLocaleString(), 'good-tracks']);
  const iterations = j.iterations || j.requested_iterations;
  if (iterations) cells.push(['ITERACIONES', iterations >= 1000
    ? (iterations / 1000) + 'k' : iterations]);
  if (j.current_iteration != null && j.target_iterations)
    cells.push(['PASO EN VIVO', `${Number(j.current_iteration).toLocaleString()} / ${Number(j.target_iterations).toLocaleString()}`, 'iteration']);
  if (j.phase_completed != null && j.phase_total)
    cells.push(['FASE EN VIVO', `${Number(j.phase_completed).toLocaleString()} / ${Number(j.phase_total).toLocaleString()}`, 'phase-count']);
  if (j.iterations_per_second)
    cells.push(['RITMO MEDIDO', `${Number(j.iterations_per_second).toFixed(1)} iter/s`, 'rate']);
  if (j.phase_items_per_minute)
    cells.push(['RITMO FASE', phaseRateText(j), 'phase-rate']);
  if (j.eta_remaining_s != null)
    cells.push([j.eta_source === 'trainer_live' ? 'ETA TRAINER' : 'ETA FASE',
      fmtDur(j.eta_remaining_s), 'eta']);
  if (j.image_cache_device) {
    const cacheMiB = Number(j.decoded_image_cache_mib || 0);
    const cacheSize = cacheMiB >= 1024 ? `${(cacheMiB / 1024).toFixed(1)} GB`
      : cacheMiB ? `${Math.round(cacheMiB)} MiB` : '';
    cells.push(['CACHE IMÁGENES', `${String(j.image_cache_device).toUpperCase()}${cacheSize ? ` · ${cacheSize}` : ''}`]);
  }
  if (j.resumed_from_step)
    cells.push([j.status === 'queued' ? 'REANUDARÁ DESDE' : 'REANUDADO DESDE',
      `Paso ${Number(j.resumed_from_step).toLocaleString()}`]);
  else if (j.resume_available && j.checkpoint_step)
    cells.push(['CHECKPOINT SEGURO', `Paso ${Number(j.checkpoint_step).toLocaleString()}`]);
  if (j.gaussians) cells.push(['GAUSSIANAS', j.gaussians >= 1e6
    ? (j.gaussians / 1e6).toFixed(2) + ' M' : Math.round(j.gaussians / 1000) + ' k']);
  if (!cells.length) return '';
  const sentence = t => t.charAt(0) + t.slice(1).toLowerCase();
  return `<dl class="jcx-dl">${cells.map(([lb, v, field]) =>
    `<div class="jcx-row"${field ? ` data-live-field="${field}"` : ''}><dt>${esc(sentence(lb))}</dt><dd class="mono">${v}</dd></div>`).join('')}</dl>`;
}
// línea de meta de UNA sola línea: preset · backend · iteraciones · ritmo · tiempo
function jobMetaLine(j) {
  const b = String(j.effective_backend || j.backend || j.requested_backend || '');
  const backend = /cuda|nvidia/i.test(b) ? 'NVIDIA CUDA' : /metal|mps/i.test(b) ? 'Apple Metal' : b ? 'CPU' : '';
  const iters = j.iterations || j.requested_iterations;
  const parts = [
    j.effective_preset || j.requested_preset ? presetLabel(j.effective_preset || j.requested_preset) : '',
    backend,
    iters ? `${iters >= 1000 && iters % 1000 === 0 ? `${iters / 1000}k` : iters} iteraciones` : '',
    j.iterations_per_second ? `${Number(j.iterations_per_second).toFixed(1)} iter/s` : '',
    j.cameras_registered != null ? `${j.cameras_registered}/${j.cameras_total || j.cameras_registered} cámaras` : '',
    j.eta_remaining_s != null && ['running', 'queued'].includes(j.status) ? `ETA ${fmtDur(j.eta_remaining_s)}` : '',
    jobTimingLabel(j),
  ].filter(Boolean);
  return parts.join(' · ');
}
function jobLogLines(j, n = 14) {
  return cleanLog(j.log_tail || '').split('\n').filter(Boolean).slice(-n).join('\n');
}
function jobCard(j, flightsIdx, entering = true) {
  const meta = KIND_META[j.kind] || { ic: 'activity', name: j.kind };
  const f = flightsIdx?.[j.label];
  const subject = j.title || (f ? (f.label || fmt.date(f.date) + ' ' + f.time) : j.label || 'trabajo');
  const titleText = `${meta.name} · ${subject}`;
  const stLabel = { running: 'procesando', queued: 'en cola', done: 'listo',
    error: 'falló', cancelled: 'cancelado', cancel_failed: 'cancel falló' }[j.status] || j.status;
  const outcomeLabel = j.outcome === 'completed_with_fallback' ? 'listo con fallback' : stLabel;
  const pct = Number.isFinite(+j.progress) ? Math.round(+j.progress * 100) : null;
  const active = ['running', 'queued'].includes(j.status);
  const quality = [];
  if (j.requested_preset) quality.push(`<b>${j.kind === 'splat' ? 'Splat' : 'ODM'}</b> · ${esc(presetLabel(j.requested_preset))} solicitada`);
  if (j.effective_preset) quality.push(`<b>Efectiva</b> · ${esc(presetLabel(j.effective_preset))}`);
  if (j.dense_quality) quality.push(`<b>Nube densa</b> · ${esc(presetLabel(j.dense_quality))}${j.dense_quality_requested && j.dense_quality_requested !== j.dense_quality ? ` (solicitada ${esc(j.dense_quality_requested)})` : ''}`);
  if (j.input_scale > 1) quality.push(`<b>Entrada</b> · -d ${esc(j.input_scale)}`);
  if (j.kind === 'splat' && j.requested_resolution)
    quality.push(`<b>Resolución solicitada</b> · ${esc({ auto: 'Auto · completa primero', full: 'Completa', half: '½ resolución' }[j.requested_resolution] || j.requested_resolution)}`);
  if (j.kind === 'splat' && j.effective_resolution)
    quality.push(`<b>Resolución efectiva</b> · ${esc(j.effective_resolution === 'half' ? '½ resolución' : 'Completa')}`);
  if (j.kind === 'splat' && /cuda/i.test(j.requested_backend || ''))
    quality.push('<b>Política</b> · CUDA estricto');
  if (j.kind === 'splat' && j.image_cache_device)
    quality.push(`<b>Cache</b> · ${String(j.image_cache_device).toUpperCase()}${j.image_cache_device === 'cpu' ? ' · VRAM libre para gaussianas' : ' · acceso rápido en GPU'}`);
  if (j.kind === 'splat' && j.resume_available && j.checkpoint_step)
    quality.push(`<b>Recuperación</b> · checkpoint ${Number(j.checkpoint_step).toLocaleString()} verificado`);
  if (j.kind === 'splat' && j.resumed_from_step)
    quality.push(`<b>Continuidad</b> · ${j.status === 'queued' ? 'preparado para reanudar desde' : 'reanudado desde'} ${Number(j.resumed_from_step).toLocaleString()}`);
  const attempts = Array.isArray(j.attempts) ? j.attempts : [];
  const attemptScales = [...new Set(attempts.map(a => Number(a.d)).filter(Boolean))];
  const facts = [
    j.source_count ? `${j.source_count} video${j.source_count === 1 ? '' : 's'}` : '',
    j.photo_count ? `${j.photo_count} foto${j.photo_count === 1 ? '' : 's'}` : '',
    j.product_mode ? String(j.product_mode).replaceAll('_', ' ') : '',
    j.peak_mib ? `pico ${j.peak_mib} MiB${j.memory_cap_mib ? ` / ${j.memory_cap_mib}` : ''}` : '',
    attemptScales.length > 1 ? 'OOM CUDA: completa → ½ resolución' :
      attempts.length ? `${attempts.length} intento${attempts.length === 1 ? '' : 's'} CUDA` : '',
  ].filter(Boolean);
  const search = `${titleText} ${j.kind} ${j.status} ${j.backend || ''} ${j.detail || ''} ${quality.join(' ')}`.toLowerCase();
  const stage = active ? (humanStage(j) || 'procesando…') : '';
  const log = jobLogLines(j);
  const line = jobMetaLine(j);
  const detailRows = [...quality, ...facts.map(esc)];
  return `
  <article class="job-card jcx${entering ? '' : ' upd'}" data-jid="${esc(j.id)}" data-kind="${esc(j.kind)}" data-status="${esc(j.status)}" data-search="${esc(search)}">
    <div class="jcx-top">
      <span class="jcx-ic">${icon(meta.ic)}</span>
      <div class="jcx-tt"><span class="jc-title" title="${esc(subject)}">${esc(subject)}</span><span class="jcx-kind">${esc(meta.name)}</span></div>
      <span class="jc-status ${esc(j.status)}${j.fallback ? ' fallback' : ''}">${active ? '<i class="jc-pulse"></i>' : ''}${esc(outcomeLabel)}</span>
    </div>
    ${active ? `
    <div class="jcx-run">
      <span class="jcx-stage">${esc(stage)}</span>
      <b class="jcx-pct mono">${pct != null ? pct + '%' : ''}</b>
    </div>
    ${pct != null ? `<div class="jc-bar jcx-bar" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="--p:${pct / 100}"></div></div>` : ''}` : ''}
    <p class="jcx-line" title="${esc(line)}">${esc(line)}</p>
    ${j.status === 'queued' ? '<p class="jcx-note">Esperando turno: el worker procesa un trabajo pesado a la vez.</p>' : ''}
    ${!active && j.detail ? `<p class="jcx-note${j.status === 'error' ? ' err' : ''}">${esc(j.detail)}</p>` : ''}
    <div class="jcx-actions">
      ${j.status === 'done' && ['3d', 'splat'].includes(j.kind) ? `<a class="btn sm primary" href="tresd.html">${j.kind === '3d' ? 'Ver escena' : 'Ver splat'}</a>` : ''}
      ${j.status === 'done' && !['3d', 'splat'].includes(j.kind) && j.artifact && j.artifact_exists ? `<a class="btn sm primary" href="data/${esc(j.artifact)}" target="_blank">Abrir</a>` : ''}
      ${active && ['3d', 'splat'].includes(j.kind) ? `<button class="btn sm danger" data-cancel="${esc(j.id)}">Cancelar</button>` : ''}
    </div>
    <details class="jcx-more">
      <summary><span>Ver log</span>${icon('chevD')}</summary>
      <div class="jcx-more-b">
        ${active && j.kind === '3d' ? phaseDash(j, pct) : ''}
        ${jobDataGrid(j)}
        ${detailRows.length ? `<ul class="jcx-list">${detailRows.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
        <pre class="jcx-pre" tabindex="0">${esc(log || 'Sin salida registrada todavía.')}</pre>
        <div class="jcx-more-a">
          <span class="jcx-id mono">${esc(j.id)}</span>
          <button class="btn sm" data-job-log="${esc(j.id)}">${icon('list')} Logs completos</button>
        </div>
      </div>
    </details>
  </article>`;
}

let jobLogState = null;
function renderJobLog() {
  const drawer = document.getElementById('job-log-drawer');
  if (!drawer || !jobLogState) return;
  const q = (drawer.querySelector('[data-log-search]')?.value || '').toLowerCase();
  const level = drawer.querySelector('[data-log-level]')?.value || 'all';
  const classify = line => /error|traceback|failed|falló|oom/i.test(line) ? 'error'
    : /warn|warning|aviso|fallback|retry/i.test(line) ? 'warning' : 'info';
  const visible = jobLogState.lines.filter(line => (!q || line.toLowerCase().includes(q))
    && (level === 'all' || classify(line) === level));
  const pre = drawer.querySelector('.jl-pre');
  pre.textContent = visible.join('\n') || 'Sin líneas para este filtro.';
  drawer.querySelector('.jl-count').textContent = `${visible.length}/${jobLogState.lines.length} líneas cargadas`;
  if (jobLogState.autoscroll) pre.scrollTop = pre.scrollHeight;
}
async function fetchJobLogChunk(force = false) {
  const st = jobLogState;
  if (!st) return;
  if (force && st.inflight) await st.inflight.catch(() => {});
  if (jobLogState !== st || st.loading || st.eof || (st.paused && !force)) return;
  st.loading = true;
  st.inflight = (async () => {
    const r = await authFetch(`/api/job_log?id=${encodeURIComponent(st.id)}&after=${st.cursor}&limit=500`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const chunk = await r.json();
    st.lines.push(...(chunk.lines || []));
    st.cursor = chunk.next || st.cursor;
    st.eof = !!chunk.eof;
    if (jobLogState === st) renderJobLog();
  })();
  try { await st.inflight; } finally { st.loading = false; st.inflight = null; }
}
async function openJobLog(jid) {
  document.getElementById('job-log-drawer')?.remove();
  const detail = await (await authFetch(`/api/job?id=${encodeURIComponent(jid)}`)).json();
  const job = detail.job || {};
  jobLogState = { id: jid, cursor: 0, lines: [], eof: false, paused: false,
    autoscroll: true, loading: false, timer: 0 };
  const drawer = document.createElement('section');
  drawer.id = 'job-log-drawer';
  drawer.className = 'job-log-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', `Logs de ${jid}`);
  const requested = presetLabel(job.requested_preset);
  const effective = presetLabel(job.effective_preset);
  drawer.innerHTML = `<div class="jl-head"><div><b>${esc(job.title || job.label || jid)}</b>
      <span>${esc(job.kind || '')} · solicitada ${esc(requested)}${job.effective_preset ? ` · efectiva ${esc(effective)}` : ''}</span></div>
      <button class="btn" data-log-close aria-label="Cerrar logs">Cerrar</button></div>
    <div class="jl-events">${(job.events || []).map(e => `<span class="${esc(e.level)}"><b>${esc(e.event)}</b>${esc(e.message || '')}</span>`).join('')}</div>
    <div class="jl-tools">
      <div class="search">${icon('search')}<input type="search" data-log-search placeholder="Buscar en logs…" aria-label="Buscar en logs"></div>
      <select class="ctl" data-log-level aria-label="Nivel del log"><option value="all">Todos</option><option value="info">Info</option><option value="warning">Avisos</option><option value="error">Errores</option></select>
      <button class="btn" data-log-wrap>Ajustar líneas</button>
      <button class="btn" data-log-pause>Pausar</button>
      <button class="btn on" data-log-autoscroll>Autoscroll</button>
      <button class="btn" data-log-copy>Copiar</button>
      <button class="btn" data-log-download>Descargar</button>
    </div>
    <div class="jl-meta"><span class="jl-count">0 líneas</span><button class="linklike" data-log-more>Cargar más</button></div>
    <pre class="jl-pre" tabindex="0"></pre>`;
  document.body.appendChild(drawer);
  drawer.querySelector('[data-log-close]').focus();
  await fetchJobLogChunk();
  if (!jobLogState.lines.length && job.log_tail) {
    jobLogState.lines = ['[histórico] Este trabajo es anterior al log completo.', ...job.log_tail.split('\n')];
    renderJobLog();
  }
  jobLogState.timer = setInterval(() => { if (!jobLogState?.paused) { jobLogState.eof = false; fetchJobLogChunk(); } }, 2500);
}
function closeJobLog() {
  if (jobLogState?.timer) clearInterval(jobLogState.timer);
  jobLogState = null;
  document.getElementById('job-log-drawer')?.remove();
}
function orderJobsForDisplay(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const running = rows.filter(j => j.status === 'running')
    .sort((a, b) => Number(b.started || 0) - Number(a.started || 0));
  const queued = rows.filter(j => j.status === 'queued')
    .sort((a, b) => Number(a.started || 0) - Number(b.started || 0));
  const history = rows.filter(j => !['running', 'queued'].includes(j.status));
  return [...running, ...queued, ...history];
}
// opts: { filter(j)→bool, limit:n, emptyText } — recorta lo que muestra esta página (Dron solo ingest)
async function pollJobs(el, every = 2500, onDone = null, opts = {}) {
  let flightsIdx = null;
  try {
    const fl = await getFlights();
    flightsIdx = Object.fromEntries(fl.map(f => [f.clip_id, f]));
  } catch {}
  let busy = false;
  const prevStatus = {};   // detectar transición running/queued → done (hook onDone)
  const paint = async () => {
    if (busy) return;                                     // guard de overlap: polls lentos no se pisan (#44)
    busy = true;
    try {
      const res = await authFetch('/api/jobs');
      if (res.status === 401) { redirectToLogin(); return; }
      const { jobs = [], counts = {} } = await res.json(); // respuesta sin jobs → [] (no crash) (#46)
      if (onDone) {
        for (const j of jobs) {
          if (j.status === 'done' && ['running', 'queued'].includes(prevStatus[j.id])) {
            try { onDone(j); } catch { /* el hook jamás rompe el poller */ }
          }
          prevStatus[j.id] = j.status;
        }
      }
      const shown = opts.filter ? jobs.filter(opts.filter) : jobs;
      if (!shown.length) {
        el.dataset.ids = '';
        el.innerHTML = emptyState({ icon: 'activity', title: opts.emptyText || 'Sin trabajos aún' });
        el.dispatchEvent(new CustomEvent('jobs:paint', { detail: { jobs, counts } }));
        return;
      }
      // El operador necesita ver primero lo que realmente consume el worker. Las campañas
      // pueden llevar timestamps futuros para preservar su orden de claim; el orden crudo
      // DESC del API las pondría delante del job en ejecución y además invertiría la cola.
      const list = orderJobsForDisplay(shown).slice(0, opts.limit || Infinity);
      // hash ESTRUCTURAL: solo lo que cambia la forma de la card. Los valores vivos
      // (progreso, ticker, tiempos) se parchan in-place — reemplazar el nodo cada poll
      // re-disparaba animaciones y producía el jitter de 1s en la card activa
      const hash = j => [j.status, j.stage, j.requested_preset,
        j.effective_preset, j.outcome, j.backend,
        j.resume_available ? j.checkpoint_step : '', j.resumed_from_step || '',
        j.current_iteration != null ? 'live-iterations' : '',
        j.phase_items_per_minute != null ? 'counted_phase_live' : '',
        j.cameras_registered != null ? 'registered-cameras' : '',
        j.active_sources != null ? 'active-sources' : '',
        j.good_tracks != null ? 'good-tracks' : '',
        (j.stage_history || []).length].join('|');
      const patchLive = (node, j) => {
        const pct = Number.isFinite(+j.progress) ? Math.round(+j.progress * 100) : null;
        const setTxt = (sel, v) => { const n = node.querySelector(sel);
          if (n && v != null && n.textContent !== String(v)) n.textContent = v; };
        setTxt('.jcx-pct', pct != null ? pct + '%' : '');
        const bar = node.querySelector('.jc-bar > div');
        if (bar && pct != null) {
          bar.style.setProperty('--p', pct / 100);
          bar.parentElement.setAttribute('aria-valuenow', pct);
        }
        setTxt('.jcx-stage', humanStage(j) || 'procesando…');
        const line = node.querySelector('.jcx-line');
        const lineTxt = jobMetaLine(j);
        if (line && line.textContent !== lineTxt) { line.textContent = lineTxt; line.title = lineTxt; }
        const pre = node.querySelector('.jcx-pre');
        const logTxt = jobLogLines(j) || 'Sin salida registrada todavía.';
        if (pre && pre.textContent !== logTxt) {
          const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
          pre.textContent = logTxt;
          if (stick) pre.scrollTop = pre.scrollHeight;
        }
        const D = (f, v) => setTxt(`[data-live-field="${f}"] dd`, v);
        D('iteration', j.current_iteration != null && j.target_iterations
          ? `${Number(j.current_iteration).toLocaleString()} / ${Number(j.target_iterations).toLocaleString()}` : null);
        D('phase-count', j.phase_completed != null && j.phase_total
          ? `${Number(j.phase_completed).toLocaleString()} / ${Number(j.phase_total).toLocaleString()}` : null);
        D('rate', j.iterations_per_second ? `${Number(j.iterations_per_second).toFixed(1)} iter/s` : null);
        D('phase-rate', j.phase_items_per_minute ? phaseRateText(j) : null);
        D('registered-cameras', j.cameras_registered != null
          ? `${Number(j.cameras_registered).toLocaleString()} / ${Number(j.cameras_total).toLocaleString()}` : null);
        D('active-sources', j.active_sources != null
          ? `${Number(j.active_sources).toLocaleString()} / ${Number(j.total_sources).toLocaleString()}` : null);
        D('good-tracks', j.good_tracks != null ? Number(j.good_tracks).toLocaleString() : null);
        D('eta', j.eta_remaining_s != null ? fmtDur(j.eta_remaining_s) : null);
        // dashboard de fases: solo anchos y tiempos (misma estructura)
        node.querySelectorAll('.jc-ph-row').forEach((row, i) => {
          const tmp = document.createElement('div');
          tmp.innerHTML = phaseDash(j, pct);
          const fresh = tmp.querySelectorAll('.jc-ph-row')[i];
          if (!fresh) return;
          if (row.className !== fresh.className) { row.replaceWith(fresh); return; }
          const b1 = row.querySelector('.jc-ph-bar > div'), b2 = fresh.querySelector('.jc-ph-bar > div');
          if (b1 && b2) b1.style.setProperty('--p', b2.style.getPropertyValue('--p'));
          const t1 = row.querySelector('.jc-ph-time'), t2 = fresh.querySelector('.jc-ph-time');
          if (t1 && t2 && t1.textContent !== t2.textContent) t1.textContent = t2.textContent;
        });
      };
      const ids = list.map(j => j.id).join(',');
      if (el.dataset.ids !== ids) {
        el.dataset.ids = ids;
        el.innerHTML = list.map(j => jobCard(j, flightsIdx)).join('');
        list.forEach(j => { el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`)?.setAttribute('data-h', hash(j)); });
      } else {
        list.forEach(j => {
          const node = el.querySelector(`[data-jid="${CSS.escape(j.id)}"]`);
          if (!node) return;
          if (node.dataset.h === hash(j)) {
            if (['running', 'queued'].includes(j.status)) patchLive(node, j);
            return;
          }
          const tmp = document.createElement('div');
          tmp.innerHTML = jobCard(j, flightsIdx, false);
          const next = tmp.firstElementChild;
          next.dataset.h = hash(j);
          if (node.querySelector('.jcx-more')?.open) next.querySelector('.jcx-more')?.setAttribute('open', '');   // el log abierto sobrevive al cambio de estructura
          node.replaceWith(next);
        });
      }
      el.dispatchEvent(new CustomEvent('jobs:paint', { detail: { jobs, counts } }));
    } catch {} finally { busy = false; }
  };
  paint();
  if (!el._pollBound) {                                   // listener idempotente (no lo dupliques por llamada) (#47)
    el._pollBound = true;
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-cancel]');
      if (c) api('/api/job_cancel', { id: c.dataset.cancel }).catch(() => {});   // no unhandled rejection (#68)
      const logs = e.target.closest('[data-job-log]');
      if (logs) openJobLog(logs.dataset.jobLog).catch(err => alert(`No se pudo abrir el log: ${err.message}`));
    });
  }
  clearInterval(el._pollTimer);                           // no acumules intervalos si se re-llama (#47)
  el._pollTimer = setInterval(paint, every);
  return el._pollTimer;
}

document.addEventListener('click', async e => {
  const drawer = e.target.closest('#job-log-drawer');
  if (e.target.closest('[data-log-close]')) return closeJobLog();
  if (!drawer || !jobLogState) return;
  if (e.target.closest('[data-log-wrap]')) drawer.classList.toggle('wrap');
  if (e.target.closest('[data-log-pause]')) {
    jobLogState.paused = !jobLogState.paused;
    e.target.closest('[data-log-pause]').textContent = jobLogState.paused ? 'Continuar' : 'Pausar';
  }
  if (e.target.closest('[data-log-autoscroll]')) {
    jobLogState.autoscroll = !jobLogState.autoscroll;
    e.target.closest('[data-log-autoscroll]').classList.toggle('on', jobLogState.autoscroll);
  }
  if (e.target.closest('[data-log-more]')) { jobLogState.eof = false; await fetchJobLogChunk(); }
  if (e.target.closest('[data-log-copy]')) await navigator.clipboard.writeText(jobLogState.lines.join('\n'));
  if (e.target.closest('[data-log-download]')) {
    const st = jobLogState;
    try {
      while (jobLogState === st && !st.eof) {
        const before = st.cursor;
        await fetchJobLogChunk(true);
        if (st.cursor === before) break; // sin avance: evita bucle infinito
      }
    } catch (err) { console.warn('descarga de log incompleta', err); }
    if (jobLogState !== st) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([jobLogState.lines.join('\n')], { type: 'text/plain' }));
    a.download = `${jobLogState.id}.log`; a.click(); URL.revokeObjectURL(a.href);
  }
});
document.addEventListener('input', e => { if (e.target.matches('[data-log-search], [data-log-level]')) renderJobLog(); });

// tema: aplicar ANTES de pintar para evitar flash
try { document.documentElement.dataset.theme = localStorage.getItem('ab_theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
// Los toggles muestran el tema ACTUAL (icono luna/sol + «Tema oscuro/claro»), con aria-pressed = tema oscuro activo.
function syncThemeToggles() {
  const light = document.documentElement.dataset.theme === 'light';
  const name = light ? 'Tema claro' : 'Tema oscuro';
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    const svg = b.querySelector('svg.ic');
    if (svg) svg.outerHTML = icon(light ? 'sun' : 'moon');
    const lb = b.querySelector('.theme-lb'); if (lb) lb.textContent = name;
    b.setAttribute('aria-pressed', String(!light));
    b.setAttribute('aria-label', name);
    b.title = `Cambiar a tema ${light ? 'oscuro' : 'claro'}`;
  });
}
let _themeT = 0;
function toggleTheme() {
  const root = document.documentElement;
  const t = root.dataset.theme === 'light' ? 'dark' : 'light';
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {   // fundido de color 160ms (solo bg/color/border)
    root.classList.add('theme-anim');
    clearTimeout(_themeT);
    _themeT = setTimeout(() => root.classList.remove('theme-anim'), 220);
  }
  root.dataset.theme = t;
  try { localStorage.setItem('ab_theme', t); } catch {}
  syncThemeToggles();
}

document.addEventListener('click', async e => {
  if (e.target.closest('[data-theme-toggle]')) toggleTheme();
  if (e.target.closest('#auth-link, [data-auth-link]')) {
    e.preventDefault();
    const session = await requireSession();
    if (!session || session.dev_mode) return;
    try {
      await authFetch('/api/logout', { method: 'POST', body: '{}' });
    } finally {
      location.replace('/login.html');
    }
  }
});

// Hoja «Más» del móvil: diálogo de navegación (título + ×, Esc por la pila de capas, Tab atrapado, scroll lock,
// el foco vuelve al disparador).
function setupMoreSheet() {
  const btn = document.getElementById('mnav-more');
  const ov = document.getElementById('msheet-ov');
  if (!btn || !ov) return;
  const sheet = ov.querySelector('.msheet');
  let layer = null, closeT = 0;
  const close = () => {
    if (ov.hidden || !layer) return;
    ov.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
    popLayer(layer); layer = null;
    unlockScroll();
    clearTimeout(closeT);
    closeT = setTimeout(() => { if (!layer) ov.hidden = true; }, 220);
    btn.focus({ preventScroll: true });
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('a[href],button:not([disabled])')].filter(el => !el.hidden && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const open = () => {
    clearTimeout(closeT);
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('on'));
    btn.setAttribute('aria-expanded', 'true');
    layer = pushLayer({ onKey });
    lockScroll();
    sheet.querySelector('a[href]')?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => (ov.hidden || !layer ? open() : close()));
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-msheet-close]')) close(); });
  sheet.addEventListener('click', e => { if (e.target.closest('[data-theme-toggle]')) setTimeout(close, 120); });
}

function renderShell(active) {
  const cur = active || location.pathname.split('/').pop() || 'index.html';
  const isMore = NAV_MORE.some(n => n.href === cur);
  const light = document.documentElement.dataset.theme === 'light';
  document.body.insertAdjacentHTML('afterbegin', `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="index.html">
          <span class="mark">${icon('drone')}</span>
          <span><b>AeroBrain</b><span>Flight Intelligence</span></span>
        </a>
        ${NAV.map(n => `
          <a class="nav-item ${n.href === cur ? 'active' : ''}" href="${n.href}"${n.href === cur ? ' aria-current="page"' : ''}>
            ${icon(n.ic)}<span>${n.label}</span>
          </a>`).join('')}
        <button class="nav-item" type="button" data-theme-toggle aria-pressed="${!light}" aria-label="${light ? 'Tema claro' : 'Tema oscuro'}" title="Cambiar a tema ${light ? 'oscuro' : 'claro'}">${icon(light ? 'sun' : 'moon')}<span class="theme-lb">${light ? 'Tema claro' : 'Tema oscuro'}</span></button>
        <div class="foot">
          <span class="foot-status"><span class="dot"></span>Mac Mini M4 · vault local<span class="chip sm foot-dev" id="dev-chip" hidden>Dev local</span></span>
          <div class="foot-btns">
            <a class="btn sm ghost${cur === 'guia.html' ? ' on' : ''}" href="guia.html">${icon('list')} Guía</a>
            <a class="btn sm ghost" href="#" id="auth-link">${icon('logOut')} Salir</a>
          </div>
        </div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>
    <nav class="mnav" aria-label="Navegación principal">
      ${NAV.filter(n => n.tab).map(n => `
        <a class="mnav-i${n.href === cur ? ' active' : ''}" href="${n.href}"${n.href === cur ? ' aria-current="page"' : ''}>${icon(n.ic)}<span>${n.label}</span></a>`).join('')}
      <button class="mnav-i${isMore ? ' active' : ''}" id="mnav-more" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="msheet-ov">${icon('more')}<span>Más</span></button>
    </nav>
    <div class="msheet-ov" id="msheet-ov" hidden>
      <div class="msheet" role="dialog" aria-modal="true" aria-labelledby="msheet-t">
        <div class="msheet-grip" aria-hidden="true"></div>
        <div class="msheet-head"><b id="msheet-t">Más</b><button class="btn icon ghost sm" type="button" data-msheet-close aria-label="Cerrar">${icon('close')}</button></div>
        <div class="msheet-grid">
          ${NAV_MORE.map(n => `
            <a class="ms-item${n.href === cur ? ' active' : ''}" href="${n.href}"${n.href === cur ? ' aria-current="page"' : ''}>${icon(n.ic)}<span>${n.label}</span></a>`).join('')}
        </div>
        <div class="msheet-foot">
          <button class="btn ghost" type="button" data-theme-toggle aria-pressed="${!light}" aria-label="${light ? 'Tema claro' : 'Tema oscuro'}" title="Cambiar a tema ${light ? 'oscuro' : 'claro'}">${icon(light ? 'sun' : 'moon')} <span class="theme-lb">${light ? 'Tema claro' : 'Tema oscuro'}</span></button>
          <a class="btn ghost" href="#" data-auth-link id="auth-link-m">${icon('logOut')} Salir</a>
        </div>
      </div>
    </div>`);
  setupMoreSheet();
  document.querySelector('.skip-link')?.addEventListener('click', e => {
    e.preventDefault();
    const m = document.getElementById('main'); if (m) { m.focus({ preventScroll: true }); m.scrollIntoView({ block: 'start' }); }
  });
  requireSession().then(session => {
    if (!session) return;
    const links = document.querySelectorAll('#auth-link, #auth-link-m');
    if (session.dev_mode) {
      // sesión local de desarrollo: no hay nada que cerrar → «Salir» desaparece y queda una etiqueta
      links.forEach(l => { l.hidden = true; });
      document.getElementById('dev-chip')?.removeAttribute('hidden');
      document.querySelector('.foot-btns')?.classList.add('solo');
    } else if (session.expires_at) {
      const expiresInColombia = new Date(session.expires_at).toLocaleString('es-CO', {
        timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
      });
      links.forEach(l => { l.title = `Sesión activa hasta ${expiresInColombia}`; });
    }
  });
  return document.getElementById('main');
}

const fmt = {
  // Math.floor en los segundos también (no Math.round) → nunca "0:60"/"1:60"; guard de NaN
  dur: s => {
    s = Math.max(0, Math.round(+s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  km: m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
  gb: b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`,
  date: d => {
    if (!d || typeof d !== 'string') return '';        // fmt.date(undefined) ya no tumba la página
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const [y, m, day] = d.split('-');
    return `${+day} ${M[+m - 1]} ${y}`;
  },
  hours: s => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`,
};

let _flights = null;
async function getFlights() {
  if (!_flights) {
    try {
      const r = await fetch(`${DATA}/manifest/flights.json`);
      _flights = (await r.json()).flights || [];        // manifest vacío/malo → [] (no undefined)
    } catch { return []; }                               // no cachea el fallo: reintentará
  }
  return _flights;
}
// AI viene embebido en flights.json (0 requests extra — clave en móvil)
async function getAI(cid) {
  // la página de detalle lee el JSON completo (director_notes, edit_suggestions…);
  // el embebido de flights.json es solo el resumen para las listas
  // flights.json trae `ai` (resumen) SOLO si el vuelo tiene análisis: sin él no existe /data/ai/<id>.json
  // y pedirlo dejaba un 404 en consola en cada vuelo sin AI.
  const fl = await getFlights();
  const summary = fl.find(f => f.clip_id === cid)?.ai || null;
  if (!summary) return null;
  try {
    const r = await fetch(`${DATA}/ai/${encodeURIComponent(cid)}.json`);
    if (r.ok) return await r.json();
  } catch {}
  return summary;
}
async function getAIAll(flights) {
  const out = {};
  flights.forEach(f => { out[f.clip_id] = f.ai || null; });
  return out;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// maxzoom 19 en el source: más allá, MapLibre sobre-escala la tile en vez de
// mostrar "Map data not available" (vuelos cortos fuerzan zoom 20+)
// satelite: maxzoom 17 — mas alla MapLibre ESCALA el tile (suave) en vez de
// pedir niveles que Esri no tiene en zonas rurales (tiles "not available");
// la ortofoto del dron va encima con su propia nitidez de todos modos
// paneles colapsables (opt-in): <section class="panel" data-collapsible> — click en el título (no en sus botones)
// pliega el cuerpo; el chevron lo dibuja style.css.
document.addEventListener('click', e => {
  const ph = e.target.closest('.panel[data-collapsible] > .ph');
  if (!ph || e.target.closest('button, a, input, select, label, .seg, .chip')) return;
  const panel = ph.parentElement;
  const collapsed = panel.classList.contains('clpsd');
  const from = panel.offsetHeight;
  panel.classList.toggle('clpsd');
  const to = panel.offsetHeight;
  panel.style.overflow = 'hidden';
  panel.animate([{ height: from + 'px' }, { height: to + 'px' }],
                { duration: 230, easing: 'cubic-bezier(.25,.1,.25,1)' })
       .finished.then(() => { panel.style.overflow = ''; });
});

const SAT_STYLE = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Esri World Imagery' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const FIT_OPTS = { padding: 50, maxZoom: 17.5 };
const DARK_STYLE = {
  version: 8,
  sources: { c: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: 'CARTO · OSM' } },
  layers: [{ id: 'c', type: 'raster', source: 'c' }],
};
