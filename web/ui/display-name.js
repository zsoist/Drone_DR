import { fmt } from './format.js?v=450';

export function flightFallback(flight = {}) {
  const time = flight.time?.slice(0, 5) || /DJI_\d{8}(\d{2})(\d{2})/.exec(flight.clip_id || '')?.slice(1).join(':');
  return [flight.place || 'Lugar sin identificar', time].filter(Boolean).join(' · ');
}

export function sceneDisplayName(scene, flights = []) {
  const name = scene.name || '';
  if (!/^(?:Escena(?:\s+\d+)?|Render\s+\S+\s+\d{1,2}\s+\S+\s+\d{4}(?:\s+\d{1,2}:\d{2})?)$/i.test(name.trim())) return name;
  const ids = [scene.clip_id, ...(scene.sources || []).map(source => typeof source === 'string' ? source : source.clip_id)];
  const flight = flights.find(row => ids.includes(row.clip_id));
  const stamp = ids.map(id => /DJI_(\d{4})(\d{2})(\d{2})/.exec(id || '')).find(Boolean);
  const date = flight?.date || (stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}` : '');
  return [flight?.place || 'Lugar sin identificar', fmt.date(date).replace(/\s+\d{4}$/, '')].filter(Boolean).join(' · ');
}

// One display name per scene, shared by Escenas and Mundo so both pages name a scene the same.
// Generic stored names become "Place · d mmm"; equal names get the flight time (or "Captura N").
export function uniqueSceneNames(scenes, flights = [], { nameOf = scene => scene.name || '', clean = name => name, sourcesOf = scene => [scene.clip_id] } = {}) {
  const base = scenes.map(scene => clean(sceneDisplayName({ ...scene, name: clean(nameOf(scene)), sources: sourcesOf(scene) }, flights))
    .replace(/(Bogotá) · Bogotá$/i, '$1'));
  const counts = new Map();
  base.forEach(title => counts.set(title, (counts.get(title) || 0) + 1));
  const used = new Set();
  return new Map(scenes.map((scene, i) => {
    const flight = flights.find(row => sourcesOf(scene).includes(row.clip_id));
    const title = counts.get(base[i]) > 1 ? `${base[i]} · ${flight?.time?.slice(0, 5) || 'Captura ' + (i + 1)}` : base[i];
    let name = title, n = 2;
    while (used.has(name)) name = `${title} · ${n++}`;
    used.add(name);
    return [scene.clip_id, name];
  }));
}
