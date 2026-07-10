    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    (async () => {
      const slug = new URLSearchParams(location.search).get('id');
      const r = await fetch(`data/properties/${slug}.json`);
      if (!r.ok) { document.getElementById('root').innerHTML = '<p style="padding:40px">Propiedad no encontrada.</p>'; return; }
      const p = await r.json();
      document.title = `${(p.titulo || '').replace(/[<>]/g, '')} — en venta`;
      const video = p.video ? (p.video.endsWith('.mp4') ? `data/reels/${p.video}` : `data/proxies/${p.video}.mp4`) : null;
      const poster = p.clip ? `data/thumbs/${p.clip}.jpg` : '';
      const frames = p.clip ? Array.from({ length: Math.min(p.gallery_n || 8, 12) }, (_, i) =>
        `data/frames/${p.clip}/f_${String(i * 3 + 2).padStart(4, '0')}.jpg`) : [];
      document.getElementById('root').addEventListener('click', e => { const g = e.target.closest('[data-full]'); if (g) window.open(g.dataset.full); });
      document.getElementById('root').innerHTML = `
        <div class="hero">${video
          ? `<video src="${video}" controls playsinline webkit-playsinline preload="metadata" ${poster ? `poster="${poster}"` : ''} autoplay muted loop></video>`
          : `<img src="${poster}" alt="">`}</div>
        <div class="head">
          <h1>${esc(p.titulo) || 'Propiedad en venta'}</h1>
          <div class="loc">${esc(p.ubicacion || '')}</div>
          ${p.precio ? `<div class="price">${esc(p.precio)}</div>` : ''}
        </div>
        <div class="specs">
          ${p.area ? `<div class="spec"><b>${esc(p.area)}</b><span>m²</span></div>` : ''}
          ${p.habitaciones ? `<div class="spec"><b>${esc(p.habitaciones)}</b><span>habitaciones</span></div>` : ''}
          ${p.banos ? `<div class="spec"><b>${esc(p.banos)}</b><span>baños</span></div>` : ''}
          ${p.parqueaderos ? `<div class="spec"><b>${esc(p.parqueaderos)}</b><span>parqueaderos</span></div>` : ''}
          ${p.estrato ? `<div class="spec"><b>${esc(p.estrato)}</b><span>estrato</span></div>` : ''}
        </div>
        ${p.descripcion ? `<div class="desc">${esc(p.descripcion)}</div>` : ''}
        ${p.lat && p.lon ? `<div class="sec-t">Ubicación</div><div id="pmap"></div>` : ''}
        ${frames.length ? `<div class="sec-t">Vistas aéreas</div><div class="gal">
          ${frames.map(f => `<img src="${f}" loading="lazy" alt="" data-full="${f}">`).join('')}</div>` : ''}
        <div class="brandline">Recorrido aéreo real capturado con dron · metislab.work</div>
        <div class="cta">
          ${p.whatsapp ? `<a class="wa" href="https://wa.me/${p.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, me interesa: ' + (p.titulo || ''))}">WhatsApp</a>` : ''}
          ${p.telefono ? `<a class="call" href="tel:${p.telefono}">Llamar</a>` : ''}
        </div>`;
      if (p.lat && p.lon) {
        const map = new maplibregl.Map({
          cooperativeGestures: true,               // página de cliente: el mapa no debe secuestrar el scroll
          container: 'pmap', center: [p.lon, p.lat], zoom: 16.5,
          style: { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
          attributionControl: { compact: true },
        });
        new maplibregl.Marker({ color: '#1E7FD1' }).setLngLat([p.lon, p.lat]).addTo(map);
      }
    })();
