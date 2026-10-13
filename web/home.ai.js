import { frameFor } from './home-shared.js?v=423';
import { fmt } from './ui/format.js?v=423';
// Read-only AI views shared by the H1 pages.
const insightRequests = new Map();
export function credibleHighlights(insight) {
  // The API validates these segments. A regular sampling cadence is not evidence of a placeholder.
  return (insight?.highlight_segments || []).filter(h => h.synthetic !== true
    && Number.isFinite(h.start) && h.start >= 0 && Number.isFinite(h.end) && h.end > h.start);
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
  return `<div class="ai-clip-chips">${(insight?.tags || []).filter(tag => !/^(drone|dron)$/i.test(tag)).slice(0, 3).map(tag => compact ? `<span class="ui-chip">${esc(tag)}</span>` : `<a class="ui-chip" href="index.html?tag=${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}${(insight?.quality_flags || []).filter(flag => qualityLabels[flag]).map(flag => compact ? `<span class="ui-chip">${qualityLabels[flag]}</span>` : `<a class="ai-quality" href="index.html?flag=${encodeURIComponent(flag)}">${qualityLabels[flag]}</a>`).join('')}</div>`;
}

// Keep covers and recap frames on the same conservative selection path.
// Text evidence excludes whole clips; pixel luminance ranks their sampled best frames.
export function coverEligible(insight) {
  if (!insight) return false;
  const evidence = [insight.caption, insight.caption_short, ...(insight.subjects || []), ...(insight.tags || [])].join(' ');
  return !/\b(persona[s]?|hombre[s]?|mujer(?:es)?|niñ[oa]s?|pareja[s]?|rostro[s]?|brazo[s]?|letrero[s]?|cartel(?:es)?|teléfono[s]?|anuncio[s]?|texto|aviso[s]?|banner|gente|humano[s]?|selfie|en venta|se vende)\b/i.test(evidence);
}
const frameRequests = new Map();
export async function bestCover(flight, insight, { exclude = new Set() } = {}) {
  if (!coverEligible(insight) || !flight.frame_count) return null;
  const times = [...new Set(insight.best_frame_times || [])]
    .filter(t => Number.isFinite(t) && t >= 0 && t < flight.duration_s);
  const candidates = await Promise.all(times.map(async time => {
    const url = frameFor(flight, time);
    if (exclude.has(url)) return null;
    if (!frameRequests.has(url)) frameRequests.set(url, new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 32;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 48, 32);
          const pixels = ctx.getImageData(0, 0, 48, 32).data;
          let luma = 0, clipped = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const value = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
            luma += value; if (value > 248) clipped++;
          }
          luma /= 48 * 32;
          resolve(luma >= 48 && clipped / (48 * 32) < .35 ? luma : null);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null); img.src = url;
    }));
    const luma = await frameRequests.get(url);
    return luma == null ? null : { url, time, luma, flight };
  }));
  return candidates.filter(Boolean).sort((a, b) => b.luma - a.luma)[0] || null;
}
export function flightCaption(flight, insight) {
  if (flight.label) return flight.label;
  const short = insight?.caption_short || flight.ai?.caption_short;
  if (short && short.split(/\s+/).length > 3) return short;
  const shot = insight?.shot_type;
  const altitude = flight.stats?.max_rel_alt_m;
  return [short || 'Vuelo', shot && shot !== 'mixto' ? shot : null,
    Number.isFinite(altitude) && altitude > 0 ? `a ${fmt.distance(altitude)}` : fmt.duration(flight.duration_s)].filter(Boolean).join(' · ');
}
