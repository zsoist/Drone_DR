/* Classic head script. AeroTheme.set('dark'|'light'|'system') persists a preference.
   Explicit preferences win. Guide and sales pages default to paper; others follow OS.
   The ab-theme-change event lets existing and new controls update their labels. */
(() => {
  // Start font loading before page styles and scripts. shell.css keeps the visual cascade.
  const source = document.currentScript?.src;
  if (source && !document.querySelector('link[data-ui-fonts]')) {
    const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.dataset.uiFonts = '';
    fonts.href = new URL('./fonts.css', source).href;
    document.head.append(fonts);
  }
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: light)');
  const paper = /\/(guia|ventas|p)\.html$/.test(location.pathname);
  let preference = null;
  try { preference = localStorage.getItem('ab_theme'); } catch {}
  const apply = () => {
    root.dataset.theme = ['light', 'dark'].includes(preference) ? preference : paper || system.matches ? 'light' : 'dark';
    root.dataset.themePreference = preference || 'system';
    document.dispatchEvent(new Event('ab-theme-change'));
  };
  window.AeroTheme = {
    set(value) {
      preference = ['light', 'dark'].includes(value) ? value : null;
      try { if (preference) localStorage.setItem('ab_theme', preference); else localStorage.removeItem('ab_theme'); } catch {}
      apply();
    },
    get preference() { return preference || 'system'; },
  };
  system.addEventListener('change', apply);
  addEventListener('storage', e => { if (e.key === 'ab_theme' || e.key === null) { preference = e.newValue; apply(); } });
  apply();
  document.addEventListener('DOMContentLoaded', apply, { once: true });
})();
