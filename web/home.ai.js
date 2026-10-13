// Read-only AI views shared by the H1 pages.
const insightRequests = new Map();
export function credibleHighlights(insight) {
  const rows = (insight?.highlight_segments || []).filter(h => Number.isFinite(h.start) && h.start > 0 && h.end > h.start);
  // Legacy analyses used fixed 90-second windows, not observed events.
  const all = insight?.highlight_segments || [];
  const synthetic = all.length >= 3 && all.every((h, i) => i === 0 || h.start - all[i - 1].start === 90);
  return synthetic ? [] : rows;
}
export async function readAI(url) {
  const response = await authFetch(url);
  if (!response.ok) throw new Error('No se pudo cargar el análisis.');
  return response.json();
}

export async function loadInsights(flights) {
  const result = {}, queue = [...flights];
  let failed = false;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const flight = queue.shift();
      try {
        if (!insightRequests.has(flight.clip_id)) insightRequests.set(flight.clip_id, readAI(`/api/clip/${encodeURIComponent(flight.clip_id)}/insight`).catch(error => { insightRequests.delete(flight.clip_id); throw error; }));
        const data = await insightRequests.get(flight.clip_id);
        result[flight.clip_id] = data.insight;
      } catch { failed = true; }
    }
  }));
  return { insights: result, failed };
}

export function captionView(insight, fullText = '') {
  const short = insight?.caption_short;
  const full = insight?.caption || fullText;
  return `${short ? `<p class="ai-caption">${esc(short)}</p>` : ''}${full ? `<details class="ai-caption-detail"><summary>Ver descripción</summary><p>${esc(full)}</p>${fullText && fullText !== full ? `<p>${esc(fullText)}</p>` : ''}</details>` : ''}`;
}

export const qualityLabels = { inestable: 'Inestable', horizonte: 'Horizonte', sobreexpuesto: 'Sobreexpuesto' };
export function clipChips(insight, { compact = false } = {}) {
  return `<div class="ai-clip-chips">${(insight?.tags || []).filter(tag => !/^(drone|dron)$/i.test(tag)).slice(0, 3).map(tag => compact ? `<span class="ai-tag">${esc(tag)}</span>` : `<a class="ui-chip" href="index.html?tag=${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}${(insight?.quality_flags || []).filter(flag => qualityLabels[flag]).map(flag => compact ? `<span class="ai-tag">${qualityLabels[flag]}</span>` : `<a class="ai-quality" href="index.html?flag=${encodeURIComponent(flag)}">${qualityLabels[flag]}</a>`).join('')}</div>`;
}
