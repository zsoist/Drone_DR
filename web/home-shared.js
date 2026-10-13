import { flightFallback } from './ui/display-name.js?v=451';
import { thumbnailURL } from './ui/thumbnail.js?v=451';
// Page contracts for Inicio, Viajes, and Flight Deck.
import { createSheet } from './ui/sheet.js?v=451';
import { registerPaletteSource } from './ui/palette.js?v=451';
import { showToast } from './ui/toast.js?v=451';
import { fmt } from './ui/format.js?v=451';
import { Suggested } from './ui/suggested.js?v=451';

// Use only for standalone statistics, telemetry, and timecodes; use esc() in prose.
export function figure(value) {
  return esc(value).replace(/([\d.,:−-]+)/g, '<span class="ui-figure">$1</span>').replace(/\b(km\/h|km|ha|min|fps|m|h|s)\b/g, '<span class="ui-unit">$1</span>');
}
export function suggestedContent(html, actions = {}) {
  const content = document.createElement('div');
  content.innerHTML = html;
  return Suggested({ content, ...actions });
}

export { showToast };
export async function loadFlights() {
  const response = await authFetch(`${DATA}/manifest/flights.json`);
  if (!response.ok) throw new Error('No se pudieron cargar los vuelos.');
  const data = await response.json();
  if (!Array.isArray(data.flights)) throw new Error('La lista de vuelos no está disponible.');
  return data.flights;
}
export async function save(url, body) {
  let result;
  try { result = await api(url, body); } catch { throw new Error('No se pudo guardar. Revisa la conexión e inténtalo de nuevo.'); }
  if (!result?.ok) throw new Error(result?.error === 'preview server is read-only' ? 'Esta vista es de solo lectura. Tus cambios no se han guardado.' : 'No se pudo guardar. Inténtalo de nuevo.');
  return result;
}
let unregisterFlights;
export function registerFlights(flights) {
  unregisterFlights?.();
  const clips = flights.filter(f => !f.archived).map(f => ({
    id: `clip-${f.clip_id}`, label: f.label || flightFallback(f),
    keywords: [f.clip_id, f.ai?.summary, ...(f.ai?.tags || [])].join(' '),
    thumbnail: thumbnailURL(f),
    href: `flight.html?id=${encodeURIComponent(f.clip_id)}`,
  }));
  const trips = authFetch(`${DATA}/manifest/trips_meta.json`).then(async response => {
    if (!response.ok) return [];
    const data = await response.json();
    return Object.entries(data).filter(([, trip]) => trip.name).map(([key, trip]) => ({
      id: `trip-${key}`, label: trip.name, keywords: 'Viaje lugar', href: `trips.html?trip=${encodeURIComponent(key)}`,
    }));
  }).catch(() => []);
  unregisterFlights = registerPaletteSource(async () => [...clips, ...await trips]);
}
export { registerPaletteSource };
export function openPageSheet(node, { title, size = 'half', initialFocus, opener = document.activeElement, onClose } = {}) {
  const heading = node.querySelector('.modal-h');
  const label = title || heading?.querySelector('b')?.textContent || 'Detalles';
  heading?.remove();
  node.classList.remove('modal-ov');
  node.querySelector('.modal')?.classList.remove('modal');
  const sheet = createSheet({ title: label, content: node, size, className: 'w2-sheet', onClose: () => {
    node.querySelectorAll('video').forEach(v => v.pause());
    onClose?.();
    sheet.element.remove();
  } });
  sheet.open(opener);
  if (initialFocus) node.querySelector(initialFocus)?.focus({ preventScroll: true });
  return () => sheet.destroy();
}
export const skeleton = (count = 3) => `<div class="w2-loading" aria-busy="true" aria-label="Cargando">${Array.from({ length: count }, () => '<div aria-hidden="true"><div class="ui-skeleton ui-skeleton--media"></div><div class="ui-skeleton ui-skeleton--text"></div></div>').join('')}</div>`;
export const failure = () => `<div class="ui-empty" role="alert"><h2>No pudimos cargar los vuelos</h2><p>Revisa la conexión y vuelve a intentarlo.</p><button class="ui-button ui-button--primary">Reintentar</button></div>`;
export function renderFailure(main, retry) {
  main.innerHTML = failure();
  main.querySelector('button').addEventListener('click', retry || (() => location.reload()));
}
export function frameFor(f, time) {
  if (Number.isFinite(+time) && f.frame_count > 0) {
    const index = Math.min(f.frame_count, Math.max(1, Math.floor(+time / 2) + 1));
    return `${DATA}/frames/${encodeURIComponent(f.clip_id)}/f_${String(index).padStart(4, '0')}.jpg`;
  }
  return thumbnailURL(f);
}
export function decision(key) {
  try { return JSON.parse(localStorage.getItem(`ab.suggestion.${key}`) || 'null'); } catch { return null; }
}
export function suggestion(key, copy, href = '', content = '') {
  const state = decision(key);
  if (state === 'dismissed') return '<p class="w2-note">Sugerencia descartada en este dispositivo.</p>';
  return `<section class="w2-suggestion" data-suggestion="${esc(key)}"><span class="ui-chip">${state === 'accepted' ? 'Aceptado en este dispositivo' : 'Sugerido'}</span><div class="w2-suggestion-content">${copy ? `<p>${esc(copy)}</p>` : ''}${content}</div><div class="w2-actions">${href ? `<a class="ui-button ui-button--secondary" href="${esc(href)}">Ver selección</a>` : ''}${state !== 'accepted' ? '<button class="ui-button ui-button--quiet" data-decision="accepted">Aceptar</button><button class="ui-button ui-button--quiet" data-decision="dismissed">Descartar</button>' : ''}</div></section>`;
}
export function wireSuggestions(root) {
  root.addEventListener('click', e => {
    const button = e.target.closest('[data-decision]');
    if (!button) return;
    const panel = button.closest('[data-suggestion]');
    try { localStorage.setItem(`ab.suggestion.${panel.dataset.suggestion}`, JSON.stringify(button.dataset.decision)); }
    catch { showToast('No se pudo guardar la elección en este dispositivo.'); return; }
    panel.querySelector('.ui-chip').textContent = button.dataset.decision === 'accepted' ? 'Aceptado en este dispositivo' : 'Descartado en este dispositivo';
    panel.querySelectorAll('[data-decision]').forEach(b => b.remove());
    if (button.dataset.decision === 'dismissed') {
      panel.querySelector('.w2-suggestion-content')?.remove();
      panel.querySelectorAll('a').forEach(n => n.remove());
      showToast('Sugerencia descartada en este dispositivo', { undo: () => {
        try { localStorage.removeItem(`ab.suggestion.${panel.dataset.suggestion}`); location.reload(); } catch { showToast('No se pudo restaurar la sugerencia.'); }
      } });
    }
  });
}
export function dataColor(strength = 100) {
  // Canvas converts the W1 OKLCH token to a color supported by MapLibre.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const tokens = getComputedStyle(document.documentElement);
  context.fillStyle = `color-mix(in oklch, ${tokens.getPropertyValue('--data').trim()} ${strength}%, ${tokens.getPropertyValue('--bg').trim()})`;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r},${g},${b})`;
}

export function summaryExcerpt(text) {
  return [...new Intl.Segmenter('es', { granularity: 'sentence' }).segment(String(text || ''))]
    .slice(0, 2).map(part => part.segment).join('').trim();
}
