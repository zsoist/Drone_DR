import { fmt } from './format.js?v=416';
// One source per shell. Cache only completed queries for this page session.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function matchEvidence(row, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const includes = value => words.some(word => normalize(value).includes(word));
  const tags = (Array.isArray(row.tags) ? row.tags : []).filter(tag => typeof tag === 'string' && includes(tag));
  if (tags.length) return `Etiqueta: ${tags.join(' · ')}`;
  const caption = typeof row.caption === 'string' ? row.caption : '';
  if (includes(caption)) {
    const index = Math.min(...words.map(word => normalize(caption).indexOf(word)).filter(i => i >= 0));
    const start = Math.max(0, index - 48), end = Math.min(caption.length, index + 112);
    return `${start ? '…' : ''}${caption.slice(start, end)}${end < caption.length ? '…' : ''}`;
  }
  return 'Contenido relacionado';
}
async function fetchContext() {
  const response = await fetch('/data/manifest/flights.json');
  if (!response.ok) return [];
  const data = await response.json(); return data.flights || [];
}
export function createClipSearchSource({ loadContext = fetchContext } = {}) {
  let context;
  const getContext = () => context ||= Promise.resolve().then(loadContext).catch(() => { context = null; return []; });
  const cache = new Map();
  return async ({ query, signal }) => {
    const q = query.trim().toLocaleLowerCase('es');
    if (q.length < 2) return [];
    signal.throwIfAborted();
    if (cache.has(q)) return cache.get(q);
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200);
      signal.addEventListener('abort', abort, { once: true });
    });
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`, { signal });
    if (!response.ok) throw new Error('Clip search unavailable');
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error('Invalid clip search response');
    signal.throwIfAborted();
    const flights = await getContext();
    signal.throwIfAborted();
    const items = data.results.filter(row => /^[\w-]{1,120}$/.test(row.clip_id || '')).map(row => {
      const time = Math.max(0, Number(row.matched_moment?.time_s) || 0);
      const seconds = Number.isFinite(time) ? time : 0;
      const flight = flights.find(flight => flight.clip_id === row.clip_id) || {};
      const home = flight.stats?.home;
      const place = row.place || flight.place || flight.location_name || (Array.isArray(home) && home.length === 2 ? `${fmt.number(home[1], 3)}°, ${fmt.number(home[0], 3)}°` : '');
      const context = [place, fmt.date(row.date || flight.date)].filter(Boolean);
      if (seconds > 0) context.push(`a los ${fmt.clock(Math.floor(seconds))}`);
      return {
        id: `clip-${row.clip_id}`, group: 'Clips', suggested: true, queryMatch: true,
        label: row.caption_short?.trim() || 'Clip de tu archivo',
        hint: context.join(' · ') || 'Ver vuelo', matchText: matchEvidence(row, q), thumbnail: row.matched_moment?.frame_url || `/data/thumbs/${row.clip_id}.jpg`,
        href: `flight.html?id=${encodeURIComponent(row.clip_id)}&t=${seconds}`,
      };
    });
    cache.set(q, items);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return items;
  };
}
