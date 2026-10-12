import { galleryFrames } from './p.logic.js?v=390';
import { createSheet } from './ui/sheet.js?v=390';
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
  let p,clip;
  try {
    const r=await fetch(`data/properties/${encodeURIComponent(slug)}.json`);
    if (!r.ok) { empty('Propiedad no disponible','Pide un enlace actualizado a quien te lo compartió.'); return; }
    p=await r.json();
    if (p.clip && !Array.isArray(p.gallery)) {
      try { const r=await fetch('data/manifest/flights.json'); if(r.ok) clip=(await r.json()).flights?.find(f=>f.clip_id===p.clip); } catch { /* Hero and property remain available. */ }
    }
  } catch { empty('No se pudo cargar la propiedad','Revisa tu conexión y vuelve a intentarlo.',true); return; }
  document.title=`${p.titulo || 'Propiedad'} — AeroBrain`;
  const poster=p.clip?`data/thumbs/${encodeURIComponent(p.clip)}.jpg`:'';
  const video=p.video?(p.video.endsWith('.mp4')?`data/reels/${encodeURIComponent(p.video)}`:`data/proxies/${encodeURIComponent(p.video)}.mp4`):'';
  const frames=galleryFrames(p,clip);
  const hero=frames[0] || poster;
  const specs=[[p.area,'m² de área'],[p.habitaciones,'habitaciones'],[p.banos,'baños'],[p.parqueaderos,'parqueaderos'],[p.estrato,'estrato']].filter(([v])=>v);
  const wa=String(p.whatsapp || '').replace(/\D/g,''),tel=String(p.telefono || '').replace(/[^\d+]/g,'');
  const coords=Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && p.lat != null && p.lon != null && p.lat !== '' && p.lon !== '';
  root.innerHTML=`<header class="p-top"><span class="p-brand">AeroBrain</span><span>Propiedad · acceso privado</span></header>
    <section class="p-intro"><div><p class="p-location">${esc(p.ubicacion || 'Ubicación por confirmar')}</p><h1>${esc(p.titulo || 'Propiedad en venta')}</h1></div><div class="p-price">${esc(p.precio || 'Precio a consultar')}</div></section>
    <div class="p-hero">${hero?`<img src="${hero}" alt="Vista aérea de ${esc(p.titulo || 'la propiedad')}" fetchpriority="high">`:'<div class="p-no-cover">La vista aérea aún no está disponible.</div>'}${video?'<button class="ui-button ui-button--primary p-play" id="p-video">Ver recorrido</button>':''}</div>
    <div class="p-content"><div>${specs.length?`<dl class="p-specs">${specs.map(([v,l])=>`<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:''}
      <section class="p-description"><h2>Un lugar para conocer</h2><p>${esc(p.descripcion?.replace(/\\n/g, '\n') || 'La descripción de esta propiedad aún está pendiente.')}</p></section>
      ${frames.length?`<section class="p-gallery-section"><h2>Desde el aire</h2><div class="p-gallery">${frames.map((f,i)=>`<button class="p-frame" data-frame="${i}" aria-label="Ampliar vista aérea ${i+1}"><img src="${f}" loading="lazy" alt="Vista aérea ${i+1}"></button>`).join('')}</div></section>`:''}
      ${coords?`<section class="p-location-section"><h2>Ubicación</h2><p>${esc(p.ubicacion || 'Ubicación de la propiedad')}</p><a class="ui-button ui-button--secondary" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat+','+p.lon)}" target="_blank" rel="noopener">Ver ubicación en el mapa ${icon('ext')}</a></section>`:''}
    </div><aside class="p-contact"><h2>Conoce la propiedad</h2><p>Consulta los detalles y acuerda una visita.</p>${wa?`<a class="ui-button ui-button--primary" href="https://wa.me/${wa}?text=${encodeURIComponent('Hola, me interesa '+(p.titulo || 'esta propiedad'))}">Consultar por WhatsApp</a>`:tel?`<a class="ui-button ui-button--primary" href="tel:${tel}">Llamar para consultar</a>`:'<p>Los datos de contacto aún no están disponibles.</p>'}${wa&&tel?`<a class="ui-button ui-button--quiet" href="tel:${tel}">Llamar</a>`:''}</aside></div>
    <footer class="p-footer">Imágenes del archivo aéreo de AeroBrain.</footer>`;
  root.setAttribute('aria-busy','false');
  function openMedia(title, node, opener) {
    const view=createSheet({title,content:node,size:'full',className:'p-media-sheet',onClose:()=>{node.querySelector('video')?.pause();view.destroy();}}); view.open(opener);
  }
  document.getElementById('p-video')?.addEventListener('click',e=>{
    const content=document.createElement('div'); content.innerHTML=`<video controls playsinline preload="metadata" poster="${poster}" src="${video}"></video><p>Usa los controles para iniciar el recorrido.</p>`;
    openMedia('Recorrido aéreo',content,e.currentTarget);
  });
  root.addEventListener('click',e=>{
    const button=e.target.closest('[data-frame]'); if(!button) return;
    const i=Number(button.dataset.frame),content=document.createElement('div');
    content.innerHTML=`<img src="${frames[i]}" alt="Vista aérea ${i+1}"><p>Vista ${i+1} de ${frames.length}</p>`;
    openMedia('Vista aérea',content,button);
  });
}
load();
