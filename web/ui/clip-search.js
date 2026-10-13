// One source per shell. Cache only completed queries for this page session.
export function createClipSearchSource() {
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
    const items = data.results.filter(row => /^[\w-]{1,120}$/.test(row.clip_id || '')).map(row => {
      const time = Math.max(0, Number(row.matched_moment?.time_s) || 0);
      const seconds = Number.isFinite(time) ? time : 0;
      const stamp = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      return {
        id: `clip-${row.clip_id}`, group: 'Clips', suggested: true, queryMatch: true,
        label: row.caption_short?.trim() || 'Clip de tu archivo',
        hint: `a los ${stamp}`, thumbnail: row.matched_moment?.frame_url || `/data/thumbs/${row.clip_id}.jpg`,
        href: `flight.html?id=${encodeURIComponent(row.clip_id)}&t=${seconds}`,
      };
    });
    cache.set(q, items);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return items;
  };
}
