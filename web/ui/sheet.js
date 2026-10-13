/** createSheet({title, content: Node, size: 'peek'|'half'|'full', className, onClose})
 * Returns {element, body, open(opener?), close(), destroy(), setSize(size)}.
 * Native modal dialog provides inert background; the shared layer stack owns Escape.
 * Close restores focus. Use textContent for data. Destroy a sheet after its last use.
 */
let sequence = 0;
export function createSheet({ title, content, size = 'half', className = '', onClose } = {}) {
  const element = document.createElement('dialog');
  element.className = `ui-sheet ${className}`.trim();
  element.dataset.size = size;
  const heading = document.createElement('h2');
  heading.id = `ui-sheet-title-${++sequence}`;
  heading.textContent = title || 'Detalles';
  element.setAttribute('aria-labelledby', heading.id);
  const header = document.createElement('header');
  header.className = 'ui-sheet-header';
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.className = 'ui-button ui-button--quiet';
  dismiss.textContent = 'Cerrar'; dismiss.setAttribute('aria-label', `Cerrar ${heading.textContent}`);
  header.append(heading, dismiss);
  const body = document.createElement('div'); body.className = 'ui-sheet-body';
  if (content) body.append(content);
  const handle = document.createElement('div'); handle.className = 'ui-sheet-handle'; handle.setAttribute('aria-hidden', 'true');
  element.append(handle, header, body);
  document.body.append(element);
  let opener, layer, locked = false, downOutside = false;
  const outside = e => {
    const r = element.getBoundingClientRect();
    return e.target === element && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  const close = () => { if (element.open) { element.close(); cleanup(); } };
  function cleanup() {
    if (!locked) return;
    locked = false;
    if (layer) window.popLayer?.(layer);
    layer = null;
    window.unlockScroll?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key !== 'Tab') return;
    const items = [...element.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(n => n.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { e.preventDefault(); element.focus(); }
    else if (e.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  dismiss.addEventListener('click', close);
  element.addEventListener('cancel', e => { e.preventDefault(); close(); });
  element.addEventListener('close', () => { if (!element.open) cleanup(); });
  element.addEventListener('keydown', e => { if (!layer) onKey(e); });
  element.addEventListener('pointerdown', e => { downOutside = outside(e); });
  element.addEventListener('click', e => { if (downOutside && outside(e)) close(); downOutside = false; });
  return {
    element, body, close,
    open(trigger = document.activeElement) {
      if (element.open) return;
      opener = trigger;
      element.showModal(); locked = true;
      window.lockScroll?.();
      layer = window.pushLayer?.({ onKey });
      (body.querySelector('[autofocus]') || dismiss).focus({ preventScroll: true });
    },
    setSize(value) { if (['peek', 'half', 'full'].includes(value)) element.dataset.size = value; },
    destroy() { close(); element.remove(); },
  };
}
