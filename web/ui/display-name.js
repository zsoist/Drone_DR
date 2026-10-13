import { fmt } from './format.js?v=449';

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
