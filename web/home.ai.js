// Read-only AI views shared by the G2 pages.
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
        const data = await readAI(`/api/clip/${encodeURIComponent(flight.clip_id)}/insight`);
        result[flight.clip_id] = data.insight;
      } catch { failed = true; }
    }
  }));
  return { insights: result, failed };
}

export function captionView(insight, fullText = '') {
  const short = insight?.caption_short;
  const full = insight?.caption || fullText;
  return `${short ? `<p class="ai-caption">${esc(short)}</p>` : ''}${full ? `<details class="ai-caption-detail"><summary>Ver más</summary><p>${esc(full)}</p>${fullText && fullText !== full ? `<p>${esc(fullText)}</p>` : ''}</details>` : ''}`;
}

export const qualityLabels = { inestable: 'Inestable', horizonte: 'Horizonte', sobreexpuesto: 'Sobreexpuesto' };
export function clipChips(insight) {
  return `<div class="ai-clip-chips">${(insight?.tags || []).slice(0, 3).map(tag => `<a class="ui-chip" href="index.html?tag=${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}${(insight?.quality_flags || []).filter(flag => qualityLabels[flag]).map(flag => `<a class="ai-quality" href="index.html?flag=${encodeURIComponent(flag)}">${qualityLabels[flag]}</a>`).join('')}</div>`;
}
