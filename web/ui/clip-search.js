import { fmt } from './format.js?v=438';
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
  // Semantic matches use stored tags or the short caption, never a generated explanation.
  const evidence = (Array.isArray(row.tags) ? row.tags : []).filter(tag => typeof tag === 'string' && tag.trim());
  if (evidence.length) return `Relacionado por etiquetas: ${evidence.slice(0, 3).join(' · ')}`;
  const description = row.caption_short?.trim() || caption.trim();
  return description ? `Relacionado por descripción: ${description.slice(0, 100)}${description.length > 100 ? '…' : ''}` : '';
}
async function fetchCover(clipId, signal) {
  const response = await fetch(`/api/clip/${encodeURIComponent(clipId)}/insight`, { signal });
  if (!response.ok) throw new Error('Clip cover unavailable');
  const { cover } = await response.json();
  return (cover?.selection === 'owner' || cover?.quality?.status === 'ok') && /^\/?data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(cover.frame_url || '')
    ? cover.frame_url : '';
}
async function fetchContext() {
  const read = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Clip context unavailable');
    return response.json();
  };
  const [manifest, places] = await Promise.allSettled([
    read('/data/manifest/flights.json'), read('/api/collections?all=1'),
  ]);
  const flights = new Map((manifest.value?.flights || []).map(flight => [flight.clip_id, flight]));
  for (const collection of places.value?.collections || []) {
    if (collection.kind === 'place') for (const id of collection.clip_ids || []) {
      flights.set(id, { ...flights.get(id), clip_id: id, collectionPlace: collection.label });
    }
  }
  return [...flights.values()];
}
// Never show generated coordinate labels, including legacy "Zona lat,lon" names.
const placeName = value => typeof value === 'string' && !/[−-]?\d+[.,]\d+\s*°?\s*[,;]\s*[−-]?\d+[.,]\d+/.test(value) ? value.trim() : '';
export function createClipSearchSource({ loadContext = fetchContext, loadCover = fetchCover } = {}) {
  let context;
  const getContext = () => context ||= Promise.resolve().then(loadContext).catch(() => { context = null; return []; });
  const cache = new Map();
  const covers = new Map();
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
    const items = await Promise.all(data.results.filter(row => /^[\w-]{1,120}$/.test(row.clip_id || '') && matchEvidence(row, q)).map(async row => {
      if (!covers.has(row.clip_id)) {
        try {
          const cover = await loadCover(row.clip_id, signal);
          signal.throwIfAborted();
          covers.set(row.clip_id, cover);
        } catch { signal.throwIfAborted(); } // Keep results available when a cover request fails.
      }
      const time = Math.max(0, Number(row.matched_moment?.time_s) || 0);
      const seconds = Number.isFinite(time) ? time : 0;
      const flight = flights.find(flight => flight.clip_id === row.clip_id) || {};
      const place = [flight.collectionPlace, row.place, flight.place, flight.location_name, row.trip_label, flight.trip_label]
        .map(placeName).find(Boolean) || 'Lugar sin identificar';
      const context = [place, fmt.date(row.date || flight.date)].filter(Boolean);
      if (seconds > 0) context.push(`a los ${fmt.clock(Math.floor(seconds))}`);
      return {
        id: `clip-${row.clip_id}`, group: 'Clips', suggested: true, queryMatch: true,
        label: flight.title?.trim() || row.caption_short?.trim() || row.caption?.trim().slice(0, 100) || 'Clip de tu archivo',
        hint: context.join(' · ') || 'Ver vuelo', matchText: matchEvidence(row, q), thumbnail: covers.get(row.clip_id) || '',
        href: `flight.html?id=${encodeURIComponent(row.clip_id)}&t=${seconds}`,
      };
    }));
    signal.throwIfAborted();
    cache.set(q, items);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return items;
  };
}
