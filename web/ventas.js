import { canonicalPropertyURL } from './ventas.logic.js?v=379';
import { createSheet } from './ui/sheet.js?v=374';
import { showToast } from './ui/toast.js?v=374';
import { registerPaletteSource } from './ui/palette.js?v=374';

const main = renderShell('ventas.html');
main.classList.add('vt-page');
let properties = [], flights = [], reels = [], editor = null;
const fields = [['titulo','Nombre','Casa campestre en Cajicá'],['slug','Nombre del enlace','casa-cajica'],['ubicacion','Ubicación','Cajicá, Cundinamarca'],['precio','Precio','850.000.000 COP'],['area','Área (m²)','240'],['habitaciones','Habitaciones','4'],['banos','Baños','3'],['parqueaderos','Parqueaderos','2'],['estrato','Estrato','5'],['whatsapp','WhatsApp con indicativo','573001234567'],['telefono','Teléfono','300 123 4567']];
async function read(url, options) {
  const r = await authFetch(url, options), d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || 'No se pudo conectar.');
  return d;
}
main.innerHTML = `<header class="vt-head"><div><h1>Propiedades</h1><p>El lugar, desde una nueva perspectiva.</p></div><button class="ui-button ui-button--primary" id="vt-new">Nueva propiedad</button></header>
  <p class="vt-private">Acceso privado · Los enlaces requieren tu sesión de AeroBrain.</p>
  <div id="plist" class="vt-list" aria-busy="true"><article class="vt-property" aria-hidden="true"><div class="vt-cover ui-skeleton"></div><div class="vt-property-info"><div class="ui-skeleton ui-skeleton--text"></div><div class="ui-skeleton ui-skeleton--text"></div></div></article></div>`;
async function loadList() {
  const list = document.getElementById('plist');
  try {
    const data = await read('/api/properties'); properties = data.properties || [];
    // The list endpoint only returns title and price. Load the saved media references.
    const details = await Promise.allSettled(properties.map(p=>read(`${DATA}/properties/${encodeURIComponent(p.slug)}.json`)));
    properties = properties.map((p,i)=>details[i].status === 'fulfilled' ? {...p,...details[i].value} : p);
    list.innerHTML = properties.length ? properties.map(p=>`<article class="vt-property">
      <a class="vt-cover" href="p.html?id=${encodeURIComponent(p.slug)}" aria-label="Ver ${esc(p.titulo || p.slug)}">${p.clip ? `<img src="${DATA}/thumbs/${encodeURIComponent(p.clip)}.jpg" alt="Vista aérea de ${esc(p.titulo)}" loading="lazy">` : '<span>Portada pendiente</span>'}</a>
      <div class="vt-property-info"><div><p class="vt-location">${esc(p.ubicacion || 'Ubicación pendiente')}</p><h2><a href="p.html?id=${encodeURIComponent(p.slug)}">${esc(p.titulo || p.slug)}</a></h2><p class="vt-price">${esc(p.precio || 'Precio por definir')}</p></div><div class="vt-property-actions"><a class="ui-button ui-button--secondary" href="p.html?id=${encodeURIComponent(p.slug)}">Ver propiedad</a><button class="ui-button ui-button--quiet" data-edit="${esc(p.slug)}">Editar</button></div></div></article>`).join('') : `<div class="ui-empty"><h2>Tu primera propiedad empieza con un vuelo</h2><p>Añade sus datos y elige una vista aérea de tu archivo.</p><button class="ui-button ui-button--primary" id="vt-empty-new">Nueva propiedad</button><small>Por ejemplo, una casa campestre en Cajicá.</small></div>`;
    list.querySelector('#vt-empty-new')?.addEventListener('click', e=>openEditor({},e.currentTarget));
  } catch { list.innerHTML = '<div class="ui-empty"><p>No se pudieron cargar las propiedades.</p><button class="ui-button ui-button--primary" id="vt-retry">Reintentar</button></div>'; list.querySelector('button').onclick=loadList; }
  finally { list.setAttribute('aria-busy','false'); }
}
async function openEditor(property = {}, opener) {
  if (editor) editor.destroy();
  const content = document.createElement('form'); content.className = 'vt-form';
  content.innerHTML = `<p class="vt-note">Guarda una ficha privada con los datos y las imágenes de la propiedad.</p><div class="vt-fields">${fields.map(([key,label,placeholder],i)=>`<label class="vt-field ${i<4?'vt-full':''}"><span>${label}${['titulo','slug'].includes(key)?' *':''}</span><input class="ctl" name="${key}" value="${esc(property[key] || '')}" placeholder="${placeholder}" ${['titulo','slug'].includes(key)?'required':''} ${i>=4?`inputmode="${i<9?'decimal':'tel'}"`:''} ${key==='slug'?'maxlength="40"':''}></label>`).join('')}</div>
    <h3>Recorrido aéreo</h3><label class="vt-field"><span>Portada y galería</span><select class="ctl" name="clip"><option value="">Sin portada</option>${flights.filter(f=>f.frame_count).map(f=>`<option value="${esc(f.clip_id)}">${esc(f.label || fmt.date(f.date)+' · '+(f.time || ''))}</option>`).join('')}</select></label>
    <label class="vt-field"><span>Video principal</span><select class="ctl" name="video"><option value="">Sin video</option>${flights.filter(f=>f.has_proxy).map(f=>`<option value="${esc(f.clip_id)}">${esc(f.label || fmt.date(f.date)+' · '+(f.time || ''))}</option>`).join('')}${reels.map(r=>`<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('')}</select></label>
    <h3>Descripción</h3><label class="vt-field"><span>Texto de la propiedad</span><textarea class="ctl" name="descripcion" rows="6" placeholder="Qué hace especial este lugar">${esc(property.descripcion || '')}</textarea></label>
    <section class="vt-suggestion" aria-label="Sugerencia de descripción" id="vt-suggestion"></section>
    <p class="vt-error" role="alert" id="vt-error"></p><div id="vt-result" role="status"></div><div class="vt-save"><button class="ui-button ui-button--primary" type="submit">Guardar propiedad</button></div>`;
  const view = createSheet({title:property.slug ? 'Editar propiedad' : 'Nueva propiedad',content,size:'full',className:'vt-editor',onClose:()=>{ view.destroy(); if (editor===view) editor=null; }}); editor=view;
  const input = key=>content.elements.namedItem(key);
  input('clip').value = property.clip || ''; input('video').value=property.video || '';
  function suggestion() {
    const f=flights.find(f=>f.clip_id===input('clip').value), text=f?.ai?.summary || f?.ai?.caption;
    const box=content.querySelector('#vt-suggestion');
    box.innerHTML = text ? `<span class="ui-chip">Sugerido</span><p>${esc(text)}</p><div class="vt-suggestion-actions"><button class="ui-button ui-button--secondary" type="button" data-accept>Usar descripción</button><button class="ui-button ui-button--quiet" type="button" data-dismiss>Descartar</button></div>` : '<h4>Sin análisis aún</h4><p>Elige un vuelo con análisis para revisar una descripción sugerida. También puedes escribir la tuya.</p>';
    box.querySelector('[data-accept]')?.addEventListener('click',()=>{ input('descripcion').value=text; box.innerHTML='<p>Descripción añadida. Puedes editarla antes de guardar.</p>'; });
    box.querySelector('[data-dismiss]')?.addEventListener('click',()=>{ box.innerHTML='<p>Sugerencia descartada. Tu descripción se conserva.</p>'; });
  }
  input('clip').addEventListener('change',suggestion); suggestion();
  content.addEventListener('submit',async e=>{
    e.preventDefault(); const button=content.querySelector('[type=submit]'), error=content.querySelector('#vt-error');
    error.textContent=''; content.querySelector('#vt-result').innerHTML='';
    const p=Object.fromEntries(new FormData(content));
    if (!p.titulo.trim() || !p.slug.trim()) { error.textContent='Escribe el nombre y el nombre del enlace.'; return; }
    const f=flights.find(f=>f.clip_id===p.clip);
    if (f?.stats?.home) { p.lon=f.stats.home[0]; p.lat=f.stats.home[1]; }
    // Store only frame indices that the manifest actually contains.
    p.gallery = f ? Array.from({length:Math.min(8,f.frame_count)},(_,i)=>`data/frames/${f.clip_id}/f_${String(Math.floor(i*f.frame_count/Math.min(8,f.frame_count))+1).padStart(4,'0')}.jpg`) : [];
    button.disabled=true; button.textContent='Guardando…';
    try {
      const result=await read('/api/property',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
      const saved=canonicalPropertyURL(result); input('slug').value=saved.slug;
      content.querySelector('#vt-result').innerHTML=`<p>Propiedad guardada. El enlace requiere tu sesión.</p><a class="ui-button ui-button--secondary" href="${saved.href}">Ver propiedad</a><button type="button" class="ui-button ui-button--quiet" id="vt-copy">Copiar enlace privado</button>`;
      content.querySelector('#vt-copy').onclick=()=>navigator.clipboard.writeText(saved.url).then(()=>showToast('Enlace copiado.'),()=>showToast('No se pudo copiar el enlace.'));
      loadList();
    } catch(err) { error.textContent=`No se guardó. ${err.message}`; }
    finally { button.disabled=false; button.textContent='Guardar propiedad'; }
  });
  view.open(opener);
}
document.getElementById('vt-new').addEventListener('click', e=>openEditor({},e.currentTarget));
main.addEventListener('click',e=>{ const b=e.target.closest('[data-edit]'); if(b) openEditor(properties.find(p=>p.slug===b.dataset.edit),b); });
registerPaletteSource(()=>properties.map(p=>({id:`property-${p.slug}`,label:p.titulo || p.slug,keywords:`Propiedad ${p.ubicacion || ''}`,href:`p.html?id=${encodeURIComponent(p.slug)}`})));
async function loadMedia() {
  try { const d=await read(`${DATA}/manifest/flights.json`); flights=d.flights || []; }
  catch { showToast('No se cargaron los vuelos. Puedes guardar los datos sin portada.'); }
  try { const d=await read(`${DATA}/manifest/system.json`); reels=d.reels || []; } catch { /* optional media */ }
}
document.getElementById('vt-new').disabled=true;
await Promise.allSettled([loadList(),loadMedia()]);
document.getElementById('vt-new').disabled=false;
