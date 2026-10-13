/** Owner data changes only through the supplied callbacks. Text is never parsed as HTML. */
export function Suggested({ content, onAccept, onDismiss } = {}) {
  const element = document.createElement('section'); element.className = 'ui-suggested';
  element.setAttribute('aria-label', 'Sugerido');
  const label = document.createElement('span'); label.className = 'ui-suggested-label'; label.textContent = 'Sugerido';
  const body = document.createElement('div'); body.className = 'ui-suggested-content';
  if (content instanceof Node) body.append(content); else body.textContent = content ?? '';
  const actions = document.createElement('div'); actions.className = 'ui-suggested-actions';
  const status = document.createElement('p'); status.className = 'ui-suggested-status'; status.setAttribute('role', 'status'); status.hidden = true;
  for (const [text, callback] of [['Aceptar', onAccept], ['Descartar', onDismiss]]) {
    if (!callback) continue;
    const button = document.createElement('button'); button.type = 'button';
    button.className = `ui-button ui-button--${text === 'Aceptar' ? 'secondary' : 'quiet'}`; button.textContent = text;
    button.addEventListener('click', async () => {
      actions.querySelectorAll('button').forEach(control => { control.disabled = true; });
      element.setAttribute('aria-busy', 'true'); status.hidden = true;
      try {
        await callback();
        status.textContent = text === 'Aceptar' ? 'Sugerencia aceptada' : 'Sugerencia descartada';
        actions.hidden = true;
      } catch {
        status.textContent = 'No se pudo guardar. Inténtalo de nuevo.';
        actions.querySelectorAll('button').forEach(control => { control.disabled = false; });
      } finally { element.removeAttribute('aria-busy'); status.hidden = false; }
    });
    actions.append(button);
  }
  element.append(label, body);
  if (actions.childElementCount) element.append(actions);
  element.append(status);
  return element;
}
