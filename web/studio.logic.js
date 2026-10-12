// Timeline calculations shared by the editor and its regression tests.
export const segmentDuration = s => s.freeze > 0 ? s.freeze : (s.b - s.a) / s.speed;
export const sourceTime = (s, local) => s.freeze > 0 ? s.a
  : Math.max(s.a, Math.min(s.b, s.reverse ? s.b - local * s.speed : s.a + local * s.speed));
export function splitSegment(s, local) {
  if (s.freeze > 0) return [{ ...s, freeze: local }, { ...s, freeze: s.freeze - local, title: '', transition: 'none' }];
  const cut = +sourceTime(s, local).toFixed(2);
  return s.reverse
    ? [{ ...s, a: cut }, { ...s, b: cut, title: '', transition: 'none' }]
    : [{ ...s, b: cut }, { ...s, a: cut, title: '', transition: 'none' }];
}
export function joinOverlap(segments, index, fps = 30) {
  if (!index || !segments.slice(1).some(s => s.transition && s.transition !== 'none')) return 0;
  const s = segments[index];
  if (!s.transition || s.transition === 'none') return Math.max(1.2 / (Number(fps) || 30), .034);
  return Math.min(Math.max(.2, Math.min(1.5, s.transDur || .4)),
    Math.max(Math.min(segmentDuration(segments[index - 1]), segmentDuration(s)) - .05, .05));
}
export function missingSources(project, byId) {
  return (project.tl || []).filter(s => !s || !byId[s.clip_id]).length;
}
export function highlightSuggestions(flights, ai) {
  return flights.flatMap(f => (ai[f.clip_id]?.highlights || []).flatMap(h => {
    const t = Number(h.t);
    if (!Number.isFinite(t) || !(f.duration_s > 0)) return [];
    const a = Math.max(0, t - 2.5), b = Math.min(f.duration_s, t + 2.5);
    return b > a ? [{ cid: f.clip_id, a, b, label: f.label || f.date, reason: h.reason || h.label || '', score: ai[f.clip_id].travel_score || 0 }] : [];
  })).sort((a, b) => b.score - a.score).slice(0, 10);
}
