/** showToast(message, {undo?, duration=5000}) -> dismiss().
 * One message at a time. undo is a callback; its button reads "Deshacer".
 * Undo messages persist until action or dismissal. Never use this for long jobs.
 */
let current;
export function showToast(message, { undo, duration = 5000 } = {}) {
  current?.();
  const el = document.createElement('div'); el.className = 'ui-toast';
  const text = document.createElement('span'); text.setAttribute('role', 'status');
  el.append(text);
  let timer;
  const dismiss = () => { clearTimeout(timer); el.remove(); if (current === dismiss) current = null; };
  if (undo) {
    const action = document.createElement('button'); action.type = 'button';
    action.className = 'ui-button ui-button--secondary'; action.textContent = 'Deshacer';
    action.addEventListener('click', () => { dismiss(); undo(); }); el.append(action);
  }
  const close = document.createElement('button'); close.type = 'button';
  close.className = 'ui-button ui-button--quiet'; close.textContent = 'Cerrar';
  close.addEventListener('click', dismiss); el.append(close);
  document.body.append(el); current = dismiss;
  requestAnimationFrame(() => { text.textContent = String(message); });
  if (!undo && duration > 0) {
    const start = () => { clearTimeout(timer); timer = setTimeout(dismiss, duration); };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start); el.addEventListener('focusout', start); start();
  }
  return dismiss;
}
