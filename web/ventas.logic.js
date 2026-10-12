export function canonicalPropertyURL(result, origin = location.origin) {
  if (!result.ok || !result.url) throw new Error(result.error || 'No se pudo guardar la propiedad.');
  const url = new URL(result.url, origin);
  const slug = url.searchParams.get('id');
  if (![origin, 'https://vuelos.metislab.work'].includes(url.origin) || url.pathname !== '/p.html' || !/^[a-z0-9-]+$/.test(slug || '')) throw new Error('El servidor no devolvió un enlace válido.');
  return { slug, href:`p.html?id=${encodeURIComponent(slug)}`, url: url.href };
}
