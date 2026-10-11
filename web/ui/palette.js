/** registerPaletteSource(fn) -> unregister(). fn({query, signal}) returns items or a Promise.
 * Items: {id, label, keywords?, href? OR action?}. Use same-origin hrefs.
 * Sources may return unfiltered items; accent-insensitive fuzzy ranking runs here.
 * mountPalette(items) -> {open(opener?), close(), destroy()}. One palette per shell.
 */
import { createSheet } from './sheet.js?v=374';
const sources = new Set();
const listeners = new Set();
export function registerPaletteSource(fn) {
  sources.add(fn); listeners.forEach(fn => fn());
  return () => { sources.delete(fn); listeners.forEach(fn => fn()); };
}
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function fuzzyScore(query, value) {
  const q = normalize(query).trim(), text = normalize(value);
  if (!q) return 0;
  const exact = text.indexOf(q);
  if (exact >= 0) return exact;
  let position = -1, score = 100;
  for (const char of q) { const next = text.indexOf(char, position + 1); if (next < 0) return Infinity; score += next - position; position = next; }
  return score;
}
export function mountPalette(items = []) {
  const content = document.createElement('div'); content.className = 'ui-palette-content';
  const input = document.createElement('input'); input.type = 'search';
  input.placeholder = 'Buscar secciones y acciones'; input.setAttribute('aria-label', 'Buscar en AeroBrain');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true'); input.setAttribute('autofocus', ''); input.autocomplete = 'off';
  const list = document.createElement('div'); list.id = 'ui-palette-results'; list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Resultados'); input.setAttribute('aria-controls', list.id);
  const status = document.createElement('p'); status.className = 'ui-palette-status'; status.setAttribute('role', 'status');
  content.append(input, status, list);
  const sheet = createSheet({ title: 'Buscar', content, size: 'full', className: 'ui-palette', onClose: () => controller?.abort() });
  let selected = 0, matches = [], controller, revision = 0;
  function select(index) {
    selected = (index + matches.length) % (matches.length || 1);
    [...list.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
    if (matches.length) { input.setAttribute('aria-activedescendant', list.children[selected].id); list.children[selected].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function activate(index) {
    const item = matches[index]; if (!item) return;
    sheet.close();
    if (typeof item.action === 'function') Promise.resolve().then(() => item.action()).catch(() => window.toast?.('No se pudo completar la acción.'));
    else if (item.href) {
      const url = new URL(item.href, location.href);
      if (url.origin === location.origin) location.assign(url.href);
    }
  }
  async function search() {
    const mine = ++revision; controller?.abort(); controller = new AbortController();
    const query = input.value, signal = controller.signal;
    function display(all) {
      const seen = new Set();
      matches = all.filter(item => item && typeof item.label === 'string' && !seen.has(item.id) && seen.add(item.id))
        .map(item => ({ item, score: fuzzyScore(query, `${item.label} ${item.keywords || ''}`) }))
        .filter(r => Number.isFinite(r.score)).sort((a, b) => a.score - b.score).slice(0, 40).map(r => r.item);
      list.replaceChildren();
      matches.forEach((item, i) => {
        const row = document.createElement('div'); row.className = 'ui-palette-result';
        row.id = `ui-palette-option-${i}`; row.setAttribute('role', 'option');
        row.textContent = item.label;
        row.addEventListener('mousedown', e => e.preventDefault());
        row.addEventListener('click', () => activate(i)); list.append(row);
      });
      status.textContent = matches.length ? `${matches.length} resultados` : 'Sin resultados. Prueba con «Viajes» o «Subir».';
      select(0);
    }
    display(items);
    // A slow or failed source cannot hide local navigation.
    const all = [...items];
    await Promise.allSettled([...sources].map(async fn => {
      const result = await fn({ query, signal });
      if (mine !== revision || signal.aborted) return;
      if (Array.isArray(result)) { all.push(...result); display(all); }
    }));
  }
  input.addEventListener('input', search);
  input.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) && !e.isComposing) {
      e.preventDefault();
      if (e.key === 'Enter') activate(selected); else select(selected + (e.key === 'ArrowDown' ? 1 : -1));
    }
  });
  const refresh = () => { if (sheet.element.open) search(); }; listeners.add(refresh);
  const open = opener => { input.value = ''; sheet.open(opener); search(); };
  const key = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (sheet.element.open) sheet.close(); else open(document.activeElement); } };
  document.addEventListener('keydown', key);
  return { open, close: sheet.close, destroy() { controller?.abort(); listeners.delete(refresh); document.removeEventListener('keydown', key); sheet.destroy(); } };
}
