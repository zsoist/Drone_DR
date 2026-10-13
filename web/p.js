import { fmt } from './ui/format.js?v=428';
import { Suggested } from './ui/suggested.js?v=428';
import { skinPlayer } from './ui/player.js?v=428';
import { galleryFrames, propertyCover, propertyDescription, propertyMedia } from './p.logic.js?v=428';
import { createSheet } from './ui/sheet.js?v=428';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root = document.getElementById('root');
function empty(title, text, retry=false) {
  root.innerHTML=`<section class="p-empty"><span class="p-brand">AeroBrain</span><h1>${title}</h1><p>${text}</p>${retry?'<button class="ui-button ui-button--primary" id="p-retry">Reintentar</button>':'<a class="ui-button ui-button--primary" href="ventas.html">Ver propiedades</a>'}</section>`;
  document.getElementById('p-retry')?.addEventListener('click',load);
  root.setAttribute('aria-busy','false');
}
async function load() {
  const slug=new URLSearchParams(location.search).get('id');
  if (!slug || !/^[\w-]+$/.test(slug)) { empty('Enlace incompleto','Pide el enlace completo de la propiedad a quien te lo compartió.'); return; }
  let p,media=[];
  try {
    const r=await fetch(`data/properties/${encodeURIComponent(slug)}.json`);
    if (!r.ok) { empty('Propiedad no disponible','Pide un enlace actualizado a quien te lo compartió.'); return; }
    p=await r.json();
    try { media=await propertyMedia(p.clip); } catch { /* Keep the saved property available. */ }
  } catch { empty('No se pudo cargar la propiedad','Revisa tu conexión y vuelve a intentarlo.',true); return; }
  document.title=`${p.titulo || 'Propiedad'} — AeroBrain`;
  const video=p.video?(p.video.endsWith('.mp4')?`data/reels/${encodeURIComponent(p.video)}`:`data/proxies/${encodeURIComponent(p.video)}.mp4`):'';
  const frames=galleryFrames(p,media);
  const hero=propertyCover(p,media);
  const specs=[[p.habitaciones,'habitaciones'],[p.banos,'baños'],[p.parqueaderos,'parqueaderos'],[p.estrato,'estrato']].filter(([v])=>v);
  const wa=String(p.whatsapp || '').replace(/\D/g,''),tel=String(p.telefono || '').replace(/[^\d+]/g,'');
  const coords=Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && p.lat != null && p.lon != null && p.lat !== '' && p.lon !== '';
  root.innerHTML=`<header class="p-top"><span class="p-brand">AeroBrain</span><span>Ficha privada · Requiere tu sesión</span></header>
    <section class="p-intro"><div><p class="p-location">${esc(p.ubicacion || 'Ubicación por confirmar')}${p.area ? ` · ${esc(fmt.number(p.area))} m²` : ''}</p><h1>${esc(p.titulo || 'Propiedad en venta')}</h1></div><div class="p-price">${esc(p.precio || 'Precio a consultar')}</div></section>
    <div class="p-hero">${hero?`<img src="${hero}" alt="Vista aérea de ${esc(p.titulo || 'la propiedad')}" fetchpriority="high">`:'<div class="p-no-cover">La vista aérea aún no está disponible.</div>'}${video?'<button class="ui-button ui-button--secondary p-play" id="p-video">Ver recorrido</button>':''}</div>
    <div class="p-content"><div>${specs.length?`<dl class="p-specs">${specs.map(([v,l])=>`<div><dt>${l}</dt><dd><span class="ui-figure">${esc(Number.isFinite(Number(v)) ? fmt.number(v) : v)}</span></dd></div>`).join('')}</dl>`:''}
      <section class="p-description"><h2>Sobre la propiedad</h2><div id="p-description"></div></section>
      ${frames.length?`<section class="p-gallery-section"><h2>Desde el aire</h2><div class="p-gallery">${frames.map((f,i)=>`<button class="p-frame" data-frame="${i}" aria-label="Ampliar vista aérea ${i+1}"><img src="${f}" loading="eager" decoding="async" alt="Vista aérea ${i+1}"></button>`).join('')}</div></section>`:'<section class="p-gallery-section"><h2>Desde el aire</h2><p>No hay imágenes revisadas disponibles para esta propiedad.</p></section>'}
      ${coords?`<section class="p-location-section"><h2>Ubicación</h2><p>${esc(p.ubicacion || 'Ubicación de la propiedad')}</p><a class="ui-button ui-button--secondary" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat+','+p.lon)}" target="_blank" rel="noopener">Ver ubicación en el mapa ${icon('ext')}</a></section>`:''}
    </div><aside class="p-contact"><h2>Conoce la propiedad</h2><p>Consulta los detalles y acuerda una visita.</p>${wa?`<a class="ui-button ui-button--primary" href="https://wa.me/${wa}?text=${encodeURIComponent('Hola, me interesa '+(p.titulo || 'esta propiedad'))}">Consultar por WhatsApp</a>`:tel?`<a class="ui-button ui-button--primary" href="tel:${tel}">Llamar para consultar</a>`:'<p>Los datos de contacto aún no están disponibles.</p>'}${wa&&tel?`<a class="ui-button ui-button--quiet" href="tel:${tel}">Llamar</a>`:''}</aside></div>
    <footer class="p-footer">Imágenes del archivo aéreo de AeroBrain.</footer>`;
  const description=document.getElementById('p-description');
  // Hide the old fact-only template. Keep owner descriptions intact.
  const generated=String(p.descripcion_source || '').startsWith('ai');
  const text=propertyDescription(p);
  if (!text) description.closest('section').remove();
  const copy=document.createElement('div');
  for (const paragraph of text.split(/\n\s*\n/)) {
    const lines=paragraph.split('\n');
    if (lines.every(line=>/^\s*[·•-]\s+/.test(line))) {
      const list=document.createElement('ul');
      for (const line of lines) { const item=document.createElement('li'); item.textContent=line.replace(/^\s*[·•-]\s+/,''); list.append(item); }
      copy.append(list);
    } else { const node=document.createElement('p'); node.textContent=paragraph; copy.append(node); }
  }
  document.title = `${(p.titulo || '').replace(/[<>]/g, '')} — en venta`;
  const video = p.video ? (p.video.endsWith('.mp4') ? `data/reels/${p.video}` : `data/proxies/${p.video}.mp4`) : null;
  const poster = p.cover?.quality?.status === 'ok' ? p.cover.frame_url : '';
  const frames = (p.gallery || []).filter(frame => frame.quality?.status === 'ok')
    .map(frame => frame.frame_url);
  const specs = [
    [p.area, 'm²'], [p.habitaciones, 'habitaciones'], [p.banos, 'baños'],
    [p.parqueaderos, 'parqueaderos'], [p.estrato, 'estrato'],
  ].filter(([v]) => v);
  const wa = p.whatsapp ? `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent('Hola, me interesa: ' + (p.titulo || ''))}` : '';
  const tel = p.telefono ? String(p.telefono).replace(/[^\d+]/g, '') : '';
  root.innerHTML = `
    <div class="hero">${video
      ? `<video src="${video}" controls playsinline webkit-playsinline preload="metadata" ${poster ? `poster="${poster}"` : ''} autoplay muted loop></video>`
      : poster ? `<img src="${poster}" alt="Vista aérea de ${esc(p.titulo || 'la propiedad')}">` : '<div class="hero-empty"></div>'}</div>
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
  document.getElementById('p-video')?.addEventListener('click',e=>{
    const content=document.createElement('div'); content.innerHTML=`<video playsinline preload="metadata" poster="${hero}" src="${video}"></video>`;
    const player=skinPlayer(content.querySelector('video'), {label:'Recorrido aéreo'});
    openMedia('Recorrido aéreo',content,e.currentTarget,player);
  });
  root.addEventListener('click',e=>{
    const button=e.target.closest('[data-frame]'); if(!button) return;
    const i=Number(button.dataset.frame),content=document.createElement('div');
    content.innerHTML=`<img src="${frames[i]}" alt="Vista aérea ${i+1}"><p>Vista ${i+1} de ${frames.length}</p>`;
    openMedia('Vista aérea',content,button);
  });
}
load();
