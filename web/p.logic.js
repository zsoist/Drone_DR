// Featured media requires an affirmative frame-quality decision from the property API.
export function approvedFrame(frame) {
  return frame?.quality?.status === 'ok'
    && /^\/?data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(frame.frame_url || '');
}

export function galleryFrames(property) {
  const linked = new Set([property.clip, ...(property.clips || [])]);
  const selected = [], urls = new Set();
  for (const frame of Array.isArray(property.gallery) ? property.gallery : []) {
    if (!approvedFrame(frame) || !linked.has(frame.clip_id) || urls.has(frame.frame_url)) continue;
    if (selected.some(other => other.clip_id === frame.clip_id
      && Math.abs(other.frame_time_s - frame.frame_time_s) < 10)) continue;
    urls.add(frame.frame_url); selected.push(frame);
    if (selected.length === 6) break;
  }
  return selected.map(frame => frame.frame_url);
}

export function propertyCover(property) {
  const cover = property.cover;
  if (approvedFrame(cover) && [property.clip, ...(property.clips || [])].includes(cover.clip_id)) return cover.frame_url;
  // The owner chose this clip for the listing: its thumbnail is owner data, never filtered away.
  return property.clip ? `data/thumbs/${encodeURIComponent(property.clip)}.jpg` : '';
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
