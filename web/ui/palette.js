/** registerPaletteSource(fn) -> unregister(). fn({query, signal}) returns items or a Promise.
 * Items: {id, label, keywords?, icon?, hint?, group?, href? OR action?}. Use same-origin hrefs.
 * Sources may return unfiltered items; accent-insensitive fuzzy ranking runs here.
 * mountPalette(items) -> {open(opener?), close(), destroy()}. One palette per shell.
 */
import { createSheet } from './sheet.js?v=379';
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
// Match positions use the same accent-insensitive order as fuzzyScore.
export function matchPositions(query, label) {
  const q = normalize(query).trim(), text = normalize(label);
  if (!q) return [];
  const exact = text.indexOf(q);
  if (exact >= 0) return Array.from({ length: q.length }, (_, i) => exact + i);
  const positions = []; let position = -1;
  for (const char of q) {
    position = text.indexOf(char, position + 1);
    if (position < 0) return [];
    positions.push(position);
  }
  return positions;
}
const recentKey = 'ab_palette_recent';
const groupNames = ['Acciones', 'Secciones', 'Viajes', 'Clips', 'Mundos'];
const groupOf = item => groupNames.includes(item.group) ? item.group : typeof item.action === 'function' ? 'Acciones' : 'Secciones';
const groupIcons = { Acciones: 'bolt', Secciones: 'grid', Viajes: 'route', Clips: 'film', Mundos: 'globe' };
function destination(href) {
  try { const url = new URL(href, location.href); return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url : null; }
  catch { return null; }
}
export function readRecents() {
  try {
    const data = JSON.parse(localStorage.getItem(recentKey) || '[]');
    return Array.isArray(data) ? data.filter(item => item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.href === 'string' && destination(item.href)).slice(0, 5) : [];
  } catch { return []; }
}
export function rememberVisit(item) {
  if (!item?.href || item.action || !destination(item.href)) return;
  const { id, label, href, icon, hint, group } = item;
  const recent = { id, label, href, icon, hint, group };
  const url = destination(href).href;
  try { localStorage.setItem(recentKey, JSON.stringify([recent, ...readRecents().filter(old => destination(old.href).href !== url)].slice(0, 5))); } catch {}
}
function highlightedLabel(label, query) {
  const node = document.createElement('span');
  const positions = new Set(matchPositions(query, label));
  // Use text nodes so source labels never become HTML.
  Array.from(label).forEach((char, i) => {
    if (positions.has(i)) { const mark = document.createElement('mark'); mark.textContent = char; node.append(mark); }
    else node.append(document.createTextNode(char));
  });
  return node;
}
export function mountPalette(items = []) {
  const content = document.createElement('div'); content.className = 'ui-palette-content';
  const input = document.createElement('input'); input.type = 'search';
  input.placeholder = 'Buscar en AeroBrain'; input.setAttribute('aria-label', 'Buscar en AeroBrain');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true'); input.setAttribute('autofocus', ''); input.autocomplete = 'off';
  const list = document.createElement('div'); list.id = 'ui-palette-results'; list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Resultados'); input.setAttribute('aria-controls', list.id);
  const status = document.createElement('p'); status.className = 'ui-palette-status'; status.setAttribute('role', 'status');
  content.append(input, status, list);
  const sheet = createSheet({ title: 'Buscar', content, size: 'full', className: 'ui-palette', onClose: () => controller?.abort() });
  let selected = 0, matches = [], controller, revision = 0;
  const current = items.find(item => item.href && destination(item.href)?.href === location.href);
  if (current) rememberVisit(current);
  const rows = () => [...list.querySelectorAll('[role="option"]')];
  function select(index) {
    selected = (index + matches.length) % (matches.length || 1);
    rows().forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
    if (matches.length) { input.setAttribute('aria-activedescendant', rows()[selected].id); rows()[selected].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function activate(index) {
    const item = matches[index]; if (!item) return;
    sheet.close();
    if (typeof item.action === 'function') Promise.resolve().then(() => item.action()).catch(() => window.toast?.('No se pudo completar la acción.'));
    else if (item.href) {
      const url = destination(item.href);
      if (url) { rememberVisit(item); location.assign(url.href); }
    }
  }
  async function search() {
    const mine = ++revision; controller?.abort(); controller = new AbortController();
    const query = input.value, signal = controller.signal;
    matches = []; selected = 0;
    function display(all) {
      const previousId = matches[selected]?.id;
      const seen = new Set();
      const ranked = all.filter(item => item && typeof item.id === 'string' && typeof item.label === 'string' && !seen.has(item.id) && seen.add(item.id))
        .map(item => ({ item, score: fuzzyScore(query, `${item.label} ${item.keywords || ''}`) }))
        .filter(r => Number.isFinite(r.score)).sort((a, b) => a.score - b.score).slice(0, 40).map(r => r.item);
      const recent = query.trim() ? [] : readRecents();
      const recentURLs = new Set(recent.map(item => destination(item.href).href));
      const groups = [['Recientes', recent], ...groupNames.map(name => [name, ranked.filter(item => groupOf(item) === name && !(name !== 'Acciones' && item.href && recentURLs.has(destination(item.href)?.href)))])].filter(([, entries]) => entries.length);
      if (query.trim()) groups.sort((a, b) => ranked.indexOf(a[1][0]) - ranked.indexOf(b[1][0]));
      matches = []; list.replaceChildren();
      for (const [name, entries] of groups) {
        const group = document.createElement('div'); group.className = 'ui-palette-group'; group.setAttribute('role', 'group');
        const heading = document.createElement('div'); heading.className = 'ui-palette-group-label';
        heading.id = `ui-palette-group-${groups.findIndex(g => g[0] === name)}`; heading.textContent = name;
        group.setAttribute('aria-labelledby', heading.id); group.append(heading);
        for (const item of entries) {
          const i = matches.length; matches.push(item);
          const row = document.createElement('div'); row.className = 'ui-palette-result';
          row.id = `ui-palette-option-${i}`; row.setAttribute('role', 'option');
          if (window.icon) row.innerHTML = window.icon(item.icon || groupIcons[groupOf(item)]);
          const copy = document.createElement('span'); copy.className = 'ui-palette-copy';
          const hint = document.createElement('small');
          hint.textContent = item.hint || (groupOf(item) === 'Acciones' ? 'Acción' : groupOf(item) === 'Secciones' ? `${item.label} · sección` : groupOf(item));
          copy.append(highlightedLabel(item.label, query), hint); row.append(copy);
          row.addEventListener('mousedown', e => e.preventDefault());
          row.addEventListener('click', () => activate(i)); group.append(row);
        }
        list.append(group);
      }
      status.textContent = matches.length ? (query.trim() ? `${matches.length} resultados` : 'Busca un destino o elige una acción') : 'Sin resultados. Prueba con «Viajes» o «Subir».';
      select(Math.max(0, matches.findIndex(item => item.id === previousId)));
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
