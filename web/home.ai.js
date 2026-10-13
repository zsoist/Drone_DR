import { fmt } from './ui/format.js?v=442';
// Read-only AI views shared by the H1 pages.
const insightRequests = new Map();
// Reviewed against this exact image. Other frames keep their own stored description.
const reviewedFrameCaptions = {
  '/data/frames/DJI_20260724162423_0219_D/f_0078.jpg': 'Edificios y montañas bajo un cielo parcialmente nublado.',
};
export function credibleHighlights(insight, sampledTimes = insight?.sampled_frame_times || []) {
  const rows = (insight?.highlight_segments || []).filter(h => h.synthetic !== true
    && Number.isFinite(h.start) && h.start >= 0 && Number.isFinite(h.end) && h.end > h.start);
  const samples = sampledTimes.length ? sampledTimes : insight?.best_frame_times || [];
  const sampled = t => samples.some(sample => Math.abs(sample - t) < 1);
  // Legacy records can mark the sampling grid as real. Reject equal-length grid segments.
  const grid = rows.length > 1 && rows.every(h => Math.abs((h.end - h.start) - (rows[0].end - rows[0].start)) < 1)
    && rows.filter(h => sampled(h.start) && sampled(h.end)).length >= Math.min(2, rows.length);
  const onSampleGrid = sampledTimes.length > 1 && rows.every(h => sampled(h.start) && sampled(h.end));
  return grid || onSampleGrid ? [] : rows;
}
export function eligibleFrame(frame) {
  return frame?.quality?.eligible === true && /^\/?data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(frame.frame_url || '');
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
        result[flight.clip_id] = data.insight ? { ...data.insight, cover: data.cover, frames: data.frames || [], sampled_frame_times: data.sampled_frame_times || [] } : null;
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

// Every automatic image requires the backend's frame-specific quality decision.
export async function bestCover(flight, insight, { exclude = new Set() } = {}) {
  const frames = [insight?.cover, ...(insight?.frames || [])];
  const frame = frames.find(frame => eligibleFrame(frame) && frame.clip_id === flight.clip_id
    && !exclude.has(frame.frame_url.replace(/^\//, '')));
  const time = frame?.frame_time_s ?? frame?.time_s;
  return frame ? { url: frame.frame_url, time,
    // Legacy frame records repeat the clip's short caption, which can describe another moment.
    caption: reviewedFrameCaptions['/' + frame.frame_url.replace(/^\//, '')]
      || (frame.caption_short && frame.caption_short !== insight?.caption_short
        ? frame.caption_short : frame.caption || insight?.caption || insight?.caption_short || ''), flight } : null;
}
export function flightCaption(flight, insight) {
  if (flight.label) return flight.label;
  const short = insight?.caption_short || flight.ai?.caption_short;
  if (short) return short;
  return [fmt.date(flight.date), flight.time].filter(Boolean).join(' · ');
}
