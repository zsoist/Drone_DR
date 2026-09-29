// Ficha pública de propiedad — /p.html?id=<slug>. Sin shell.js: sigue la preferencia del sistema.
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('root');

function emptyState(ic, title, text, retry) {
  root.innerHTML = `<div class="p-empty">
    <span class="p-empty-ic" aria-hidden="true">${icon(ic)}</span>
    <h1>${title}</h1>
    <p>${text}</p>
    ${retry ? '<button class="btn" type="button" id="p-retry">Reintentar</button>' : ''}
  </div>`;
  document.getElementById('p-retry')?.addEventListener('click', () => location.reload());
}

(async () => {
  const slug = new URLSearchParams(location.search).get('id');
  if (!slug || !/^[\w-]+$/.test(slug)) {   // sin ?id válido no se pide properties/null.json (404 en consola)
    emptyState('link', 'Enlace incompleto', 'Este enlace no incluye una propiedad. Pide el enlace completo a quien te lo compartió.');
    return;
  }
  let p;
  try {
    const r = await fetch(`data/properties/${slug}.json`);
    if (!r.ok) { emptyState('search', 'Propiedad no encontrada', 'Es posible que ya no esté disponible. Pide un enlace actualizado a quien te lo compartió.'); return; }
    p = await r.json();
  } catch {
    emptyState('wifi', 'No se pudo cargar', 'Revisa tu conexión e inténtalo de nuevo.', true);
    return;
  }
  document.title = `${(p.titulo || '').replace(/[<>]/g, '')} — en venta`;
  const video = p.video ? (p.video.endsWith('.mp4') ? `data/reels/${p.video}` : `data/proxies/${p.video}.mp4`) : null;
  const poster = p.clip ? `data/thumbs/${p.clip}.jpg` : '';
  const frames = p.clip ? Array.from({ length: Math.min(p.gallery_n || 8, 12) }, (_, i) =>
    `data/frames/${p.clip}/f_${String(i * 3 + 2).padStart(4, '0')}.jpg`) : [];
  const specs = [
    [p.area, 'm²'], [p.habitaciones, 'habitaciones'], [p.banos, 'baños'],
    [p.parqueaderos, 'parqueaderos'], [p.estrato, 'estrato'],
  ].filter(([v]) => v);
  const wa = p.whatsapp ? `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent('Hola, me interesa: ' + (p.titulo || ''))}` : '';
  const tel = p.telefono ? String(p.telefono).replace(/[^\d+]/g, '') : '';
  root.innerHTML = `
    <div class="hero">${video
      ? `<video src="${video}" controls playsinline webkit-playsinline preload="metadata" ${poster ? `poster="${poster}"` : ''} autoplay muted loop></video>`
      : poster ? `<img src="${poster}" alt="">` : '<div class="hero-empty"></div>'}</div>
    <header class="head">
      <h1>${esc(p.titulo) || 'Propiedad en venta'}</h1>
      ${p.ubicacion ? `<div class="loc">${icon('pin')}<span>${esc(p.ubicacion)}</span></div>` : ''}
      ${p.precio ? `<div class="price">${esc(p.precio)}</div>` : ''}
    </header>
    ${specs.length ? `<div class="specs">${specs.map(([v, l]) => `<div class="spec"><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>` : ''}
    ${p.descripcion ? `<section class="sec"><h2 class="sec-t">Descripción</h2><div class="desc">${esc(p.descripcion)}</div></section>` : ''}
    ${p.lat && p.lon ? `<section class="sec"><h2 class="sec-t">Ubicación</h2><div id="pmap" role="img" aria-label="Mapa de la ubicación"></div></section>` : ''}
    ${frames.length ? `<section class="sec"><h2 class="sec-t">Vistas aéreas</h2><div class="gal">
      ${frames.map(f => `<a href="${f}" target="_blank" rel="noopener"><img src="${f}" loading="lazy" alt="Vista aérea de la propiedad"></a>`).join('')}</div></section>` : ''}
    <div class="brandline">Recorrido aéreo real capturado con dron · metislab.work</div>
    ${wa || tel ? `<div class="cta">
      ${wa ? `<a class="btn primary lg" href="${wa}">WhatsApp</a>` : ''}
      ${tel ? `<a class="btn lg" href="tel:${tel}">Llamar</a>` : ''}
    </div>` : ''}`;
  if (p.lat && p.lon) {
    const map = new maplibregl.Map({
      cooperativeGestures: true,               // página de cliente: el mapa no debe secuestrar el scroll
      container: 'pmap', center: [p.lon, p.lat], zoom: 16.5,
      style: { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
      attributionControl: { compact: true },
    });
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1E7FD1';
    new maplibregl.Marker({ color: accent }).setLngLat([p.lon, p.lat]).addTo(map);
  }
})();
