// Paneles táctiles movibles: una sola implementación para Menú, Combate e
// Imagen. La posición se guarda normalizada para sobrevivir orientación y
// tamaños distintos, y siempre se limita al visualViewport de Safari.
export function makeDraggablePanel(panel, handle, storageKey) {
  if (!panel || !handle) return { clamp() {}, reset() {} };
  const EDGE = 8;
  const interactive = 'button,input,select,textarea,a,[role="button"]';
  let drag = null;

  const viewport = () => {
    const v = window.visualViewport;
    return {
      left: v?.offsetLeft || 0,
      top: v?.offsetTop || 0,
      width: v?.width || innerWidth,
      height: v?.height || innerHeight,
    };
  };
  const clamp = (x, y, save = false) => {
    if (!panel.getClientRects().length) return false;
    const v = viewport();
    let r = panel.getBoundingClientRect();
    // Al soltar right/bottom, width:auto colapsaba el inspector y aumentaba su
    // altura después de calcular los límites. Fijar el ancho visual primero
    // mantiene la geometría estable durante todo el gesto.
    panel.style.width = `${Math.min(r.width, v.width - EDGE * 2)}px`;
    r = panel.getBoundingClientRect();
    const maxX = Math.max(v.left + EDGE, v.left + v.width - r.width - EDGE);
    const maxY = Math.max(v.top + EDGE, v.top + v.height - r.height - EDGE);
    const nx = Math.min(maxX, Math.max(v.left + EDGE, x ?? r.left));
    const ny = Math.min(maxY, Math.max(v.top + EDGE, y ?? r.top));
    panel.style.left = `${nx}px`;
    panel.style.top = `${ny}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    panel.classList.add('vl-panel-positioned');
    if (save) {
      const dx = Math.max(1, v.width - r.width - EDGE * 2);
      const dy = Math.max(1, v.height - r.height - EDGE * 2);
      localStorage.setItem(storageKey, JSON.stringify({
        x: Math.max(0, Math.min(1, (nx - v.left - EDGE) / dx)),
        y: Math.max(0, Math.min(1, (ny - v.top - EDGE) / dy)),
      }));
    }
    return true;
  };
  const restore = () => {
    let p;
    try { p = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { p = null; }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !panel.getClientRects().length) return false;
    const v = viewport(), r = panel.getBoundingClientRect();
    return clamp(
      v.left + EDGE + p.x * Math.max(1, v.width - r.width - EDGE * 2),
      v.top + EDGE + p.y * Math.max(1, v.height - r.height - EDGE * 2));
  };
  const end = e => {
    if (!drag || (e?.pointerId != null && e.pointerId !== drag.id)) return;
    clamp(undefined, undefined, true);
    // Safari puede actualizar visualViewport al terminar el gesto (barras del
    // navegador). Un segundo clamp en el frame estable evita dejar 20-40px fuera.
    requestAnimationFrame(() => clamp(undefined, undefined, true));
    panel.classList.remove('vl-panel-dragging');
    drag = null;
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest(interactive)) return;
    const r = panel.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('vl-panel-dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    clamp(e.clientX - drag.dx, e.clientY - drag.dy);
    e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    handle.addEventListener(type, end);
  const reclamp = () => requestAnimationFrame(() => restore() || clamp());
  addEventListener('resize', reclamp);
  window.visualViewport?.addEventListener('resize', reclamp);
  return {
    clamp: () => requestAnimationFrame(() => restore() || clamp()),
    reset() {
      localStorage.removeItem(storageKey);
      panel.removeAttribute('style');
      panel.classList.remove('vl-panel-positioned');
    },
  };
}
