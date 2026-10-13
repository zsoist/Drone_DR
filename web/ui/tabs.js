/** Wire a tablist. Buttons need role=tab and aria-controls pointing to a panel ID. */
export function mountTabs(element, { onChange } = {}) {
  const tabs = [...element.querySelectorAll('[role="tab"]')];
  element.setAttribute('role', 'tablist');
  element.classList.add('ui-tabs');
  function select(tab, notify = true) {
    if (!tabs.includes(tab) || tab.disabled) return;
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) {
        item.id ||= `ui-tab-${panel.id}`;
        panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', item.id);
        panel.tabIndex = 0; panel.hidden = !active;
      }
    });
    if (notify) onChange?.(tab);
  }
  const click = e => select(e.target.closest('[role="tab"]'));
  const keydown = e => {
    const enabled = tabs.filter(tab => !tab.disabled), index = enabled.indexOf(e.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled.at(-1)
      : enabled[(index + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    next.focus(); select(next);
  };
  element.addEventListener('click', click); element.addEventListener('keydown', keydown);
  select(tabs.find(tab => !tab.disabled && tab.getAttribute('aria-selected') === 'true') || tabs.find(tab => !tab.disabled), false);
  return { select, destroy() { element.removeEventListener('click', click); element.removeEventListener('keydown', keydown); } };
}
