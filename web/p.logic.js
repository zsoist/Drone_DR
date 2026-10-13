// Automatic media requires an explicit, frame-specific backend quality decision.
export function approvedFrame(frame) {
  return frame?.quality?.eligible === true
    && Array.isArray(frame.quality.reasons) && frame.quality.reasons.length === 0
    && /^\/?data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(frame.frame_url || '');
}

export function galleryFrames(property, frames = []) {
  const saved = Array.isArray(property.gallery) ? new Set(property.gallery.map(path => String(path).replace(/^\//, ''))) : null;
  const selected = [], urls = new Set();
  // Respect backend rank. Spread views across the clip; never invent frame indices.
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (!approvedFrame(frame) || frame.clip_id !== property.clip) continue;
    const path = frame.frame_url.replace(/^\//, '');
    if ((saved && !saved.has(path)) || urls.has(path)) continue;
    const time = frame.frame_time_s;
    if (!Number.isFinite(time) || selected.some(other => Math.abs(other.frame_time_s - time) < 10)) continue;
    urls.add(path); selected.push(frame);
    if (selected.length === 6) break;
  }
  return selected.map(frame => frame.frame_url.replace(/^\//, ''));
}

export function propertyCover(property, frames = []) {
  return galleryFrames(property, frames)[0] || '';
}

// These substitutions apply only to the legacy generated template, never owner text.
export function propertyDescription(property) {
  const text = String(property.descripcion || '').replace(/\\n/g, '\n').trim();
  if (property.descripcion_source !== 'ai_template') return text;
  const title = String(property.titulo || 'Propiedad').replace(/\.$/, '');
  const template = [`${title}${property.ubicacion ? ` en ${property.ubicacion}` : ''}.`];
  for (const [key, label, unit] of [['area', 'Área', ' m²'], ['habitaciones', 'Habitaciones', ''], ['banos', 'Baños', ''], ['precio', 'Precio', '']]) {
    if (property[key]) template.push(`${label}: ${property[key]}${unit}.`);
  }
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  if (normalize(text) === normalize(template.join(' '))) return '';
  const landscape=text.includes('El entorno visible incluye un valle.') && text.includes('Se observan montañas en el paisaje.')
    ? text.replace('El entorno visible incluye un valle.', 'El paisaje combina un valle y montañas.').replace('Se observan montañas en el paisaje.', '').trim()
    : text;
  return landscape.replace('El entorno visible incluye un valle.', 'El paisaje se extiende por un valle.')
    .replace('Se observa una calle entre las construcciones.', 'Una calle pasa entre las construcciones.')
    .replace('Se observan montañas en el paisaje.', 'Las montañas forman parte del entorno.')
    .replace('Se ven construcciones en los alrededores.', 'Hay construcciones en los alrededores.')
    .replace('En el paisaje se observa un cuerpo de agua.', 'El paisaje incluye un cuerpo de agua.');
}

export async function propertyMedia(clip, request = fetch) {
  if (!clip) return [];
  const response = await request(`/api/clip/${encodeURIComponent(clip)}/insight`);
  if (!response.ok) throw new Error('No se pudieron consultar las imágenes.');
  const data = await response.json();
  // Older responses supply only a cover. Do not fill missing quality data locally.
  return [data.cover, ...(data.best_frames || [])].filter(approvedFrame);
}
