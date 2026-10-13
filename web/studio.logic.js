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
export function highlightSuggestions(flights, insights) {
  return flights.flatMap(f => {
    const insight = insights[f.clip_id];
    return (insight?.highlight_segments || []).flatMap(h => {
      const { start: a, end: b, score } = h;
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > f.duration_s
          || !Number.isFinite(f.duration_s) || !Number.isFinite(score) || score < 0 || score > 1) return [];
      return [{ cid: f.clip_id, a, b, label: f.label || f.date,
        caption: insight.caption_short || analysisCaption(insight.caption),
        description: insight.caption || '', reason: h.reason || '', score }];
    });
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}

// Use only subjects present in the stored text. Keep the original in the details row.
export function analysisCaption(text) {
  const subjects = [
    [/\b(ciudad|urban[oa]|bogot[aá])/i, 'Ciudad'],
    [/\b(monta[ñn]|cerros?|cordillera)/i, 'Montañas'],
    [/\b(casa|vivienda)/i, 'Casa'],
    [/\b(persona|gente)/i, 'Personas'],
    [/\b(parque|jardin)/i, 'Parque'],
    [/\b(valle)/i, 'Valle'],
    [/\b(colina)/i, 'Colinas'],
    [/\b(edific|fachada|arquitectura)/i, 'Edificios'],
    [/\b(tejados?|techos?)/i, 'Tejados'],
    [/\b(calles?|carretera|intersecci[oó]n)/i, 'Calles'],
    [/\b(tr[aá]fico|veh[ií]culos?)/i, 'Tráfico'],
    [/\b(bosque|[aá]rbol|vegetaci[oó]n|zonas? verdes?)/i, 'Vegetación'],
    [/\b(r[ií]o|cascada)/i, 'Río'],
    [/\b(lago|embalse)/i, 'Lago'],
    [/\b(playa|costa)/i, 'Costa'],
    [/\b(nubes?|cielo)/i, 'Cielo'],
    [/\b(atardecer|ocaso)/i, 'Atardecer'],
    [/\b(amanecer)/i, 'Amanecer'],
  ];
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shot = /\b(panoram|plano abierto)/i.test(normalized) ? 'Plano abierto'
    : /\b(cenital|zenital)/i.test(normalized) ? 'Vista cenital' : '';
  const caption = subjects.filter(([pattern]) => pattern.test(normalized)).slice(0, shot ? 2 : 3)
    .map(([, label]) => label).join(' · ');
  return [shot, caption].filter(Boolean).join(': ') || 'Momento del vuelo';
}
