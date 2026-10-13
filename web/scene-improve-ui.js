import { createSheet } from './ui/sheet.js?v=402';
import { showToast } from './ui/toast.js?v=402';
import { registerPaletteSource } from './ui/palette.js?v=402';
export { createSheet, showToast };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Display only: keep the saved title intact for edits and provenance.
export const sceneTitle = value => String(value || 'Escena')
  .replace(/\s+[—–·-]\s+(?=[^\n]*(?:\bODM\b|\bCUDA\b|\bF\d+\s+v\d+\b|\bentity E2E\b|\bsitio progresivo\b)).*$/i, '')
  .replace(/\s+(?:alta\s+(?:fixed|stable)\b|iso\s+low\b).*$/i, '')
  .replace(/\s+v\d+(?:\.\d+)*\s*$/i, '').trim().replace(/^(\d+)$/, 'Escena $1') || 'Escena';
export const sceneVersionLabel = splat => [
  splat.current ? 'Actual' : (splat.archived_at || 'Versión anterior'),
  (splat.preset_label || splat.preset || '').replace(/\s*\d+K\b/gi, '').trim(),
].filter(Boolean).join(' · ');
export const areaNav = active => `<nav class="area-nav" aria-label="Área 3D">${[['escenas','tresd.html','Escenas'],['mundo','mundo.html','Mundo'],['volar','volar.html','Volar']].map(([key,href,label]) => `<a href="${href}"${key===active?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
export const skeletonCards = () => `<div class="scene-skeleton" aria-hidden="true">${Array.from({length:2},()=>'<div><div class="ui-skeleton ui-skeleton--media"></div><div class="ui-skeleton ui-skeleton--text"></div></div>').join('')}</div>`;
export function registerScenes(rows, label = 'Escena') {
  return registerPaletteSource(() => rows.map(row => ({id:`world-${row.clip_id}`,label:sceneTitle(row.title || row.name || row.clip_id),keywords:`${label} 3D`,href:`share.html?m=${encodeURIComponent(row.clip_id)}`})));
}
export function contentSheet(title, content, opener, className = '') {
  const sheet = createSheet({title,content,size:'full',className:`scene-sheet ${className}`,onClose:()=>sheet.destroy()});
  sheet.open(opener);
  return sheet;
}
export function confirmSheet(message, opener) {
  return new Promise(resolve => {
    let accepted=false;
    const content=document.createElement('div');
    const p=document.createElement('p');p.textContent=message;
    const button=document.createElement('button');button.className='ui-button ui-button--danger';button.textContent='Confirmar';
    content.append(p,button);
    const sheet=createSheet({title:'Confirmar cambio',content,size:'peek',className:'scene-sheet',onClose:()=>{resolve(accepted);sheet.destroy();}});
    button.onclick=()=>{accepted=true;sheet.close();};sheet.open(opener);
  });
}
export async function copyLink(url, opener) {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(url);
    showToast('Enlace privado copiado. Requiere tu sesión.');
  } catch {
    const input = document.createElement('input');
    input.className = 'ctl'; input.value = url; input.readOnly = true;
    input.setAttribute('aria-label', 'Enlace privado. Requiere tu sesión.');
    contentSheet('Enlace privado · requiere tu sesión', input, opener);
    input.select();
  }
}
// Descriptions inform the owner; they do not change saved scene data.
export function suggestionBlock({title='Descripción de la escena', text, fullText, empty='Aún no hay una descripción disponible.'}) {
  const node=document.createElement('section');node.className='scene-suggestion';
  const heading=document.createElement('h3');heading.textContent=title;node.append(heading);
  if(text){const tag=document.createElement('span');tag.className='ui-chip';tag.textContent='Sugerido';node.append(tag);}
  const p=document.createElement('p');p.textContent=text || empty;node.append(p);
  if(text && fullText && fullText!==text){
    const details=document.createElement('details');
    const summary=document.createElement('summary');summary.textContent='Ver más';
    const full=document.createElement('p');full.textContent=fullText;
    details.append(summary,full);node.append(details);
  }
  return node;
}
export function sceneSources(model) {
  const effective=model.site?.effective_sources;
  const rows=effective?.length ? effective : model.reconstruction?.sources || [];
  return [...new Set(rows.filter(row=>typeof row==='string' || (row && row.merged!==false))
    .map(row=>typeof row==='string'?row:row.clip_id).filter(Boolean)
    .concat(rows.length || /^recon_/.test(model.clip_id || '') ? [] : [model.clip_id]))]
    .filter(id=>/^[A-Za-z0-9_-]{1,120}$/.test(id || ''));
}
const insightRequests=new Map();
export async function sceneInsight(model) {
  const results=await Promise.allSettled(sceneSources(model).map(clipId=>{
    if(!insightRequests.has(clipId)){
      const request=readSceneData(`/api/clip/${encodeURIComponent(clipId)}/insight`).then(async response=>{
        if(!response.ok)throw Error('Insight unavailable');
        const data=await response.json();
        return data.status==='ready' && data.insight?.caption_short ? {...data.insight,clip_id:clipId} : null;
      }).catch(error=>{insightRequests.delete(clipId);throw error;});
      insightRequests.set(clipId,request);
    }
    return insightRequests.get(clipId);
  }));
  const score=insight=>Math.max(0,...(insight.highlight_segments||[]).map(segment=>Number(segment.score)||0));
  const ready=results.filter(result=>result.status==='fulfilled' && result.value).map(result=>result.value);
  ready.sort((a,b)=>score(b)-score(a) || (a.quality_flags?.length||0)-(b.quality_flags?.length||0));
  if(ready.length)return ready[0];
  if(results.some(result=>result.status==='rejected'))throw Error('Insight unavailable');
  return null;
}
async function readSceneData(path) {
  if (globalThis.authFetch) return globalThis.authFetch(path);
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 401) {
    const next = location.pathname + location.search + location.hash;
    location.replace(`/login.html?next=${encodeURIComponent(next)}`);
    throw new Error('Sesión expirada');
  }
  return response;
}
export async function sceneInfo({model, processing, opener}) {
  const content=document.createElement('div');content.className='scene-info';
  const description=document.createElement('section');description.className='scene-suggestion';
  description.setAttribute('aria-busy','true');
  description.innerHTML='<h3>Descripción de la escena</h3><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div>';
  content.append(description);
  const detailsButton=document.createElement('button');
  detailsButton.className='ui-button ui-button--quiet';detailsButton.textContent='Detalles';
  detailsButton.onclick=async()=>{
    const details=document.createElement('div');
    const label=document.createElement('h3');label.textContent='Nombre guardado';
    const saved=document.createElement('p');saved.textContent=model.title || model.name || model.clip_id;
    const id=document.createElement('p');id.textContent=model.clip_id;
    details.append(label,saved,id);
    if(processing){
      const title=document.createElement('h3');title.textContent='Procesamiento';
      const text=document.createElement('p');text.textContent=processing;
      details.append(title,text);
    }
    const coach=suggestionBlock({title:'Tu próxima captura',empty:'Consultando el análisis de captura…'});
    details.append(coach);contentSheet('Detalles',details,detailsButton);
    try {
      const response=await readSceneData(`/api/capture_report?clip_id=${encodeURIComponent(model.clip_id)}`);
      if(!response.ok)throw Error('Capture report unavailable');
      const report=await response.json();
      const text=(report.warnings||[]).filter(value=>typeof value==='string' && value.trim()).slice(0,3).join(' ');
      coach.replaceWith(suggestionBlock({title:'Tu próxima captura',text,empty:'No hay recomendaciones de captura para esta escena.'}));
    }catch{coach.querySelector('p').textContent='No se pudo consultar el análisis de captura.';}
  };
  content.append(detailsButton);
  const sheet=contentSheet('Información de la escena',content,opener);
  try {
    const insight=await sceneInsight(model);
    description.replaceWith(suggestionBlock({text:insight?.caption_short,fullText:insight?.caption}));
  }catch{
    description.replaceWith(suggestionBlock({empty:'No se pudo cargar la descripción. Cierra y vuelve a abrir la información.'}));
  }
  return sheet;
}
// One short, muted preview at a time. Only play an actual published orbit asset.
let playing;
export function wireOrbitPreview(card, url) {
  if(!url)return;
  let timer, video;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const stop=()=>{clearTimeout(timer);if(video){video.pause();video.remove();video=null;}if(playing===stop)playing=null;};
  const play=()=>{
    if(reducedMotion()||document.hidden||video)return;
    playing?.();playing=stop;
    video=document.createElement('video');video.className='scene-orbit';video.muted=true;video.playsInline=true;video.src=url;
    video.onended=stop;video.onerror=stop;card.append(video);video.play().catch(stop);timer=setTimeout(stop,5000);
  };
  card.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')play();});
  card.addEventListener('pointerleave',stop);
  card.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')timer=setTimeout(play,500);});
  card.addEventListener('pointerup',stop);card.addEventListener('pointercancel',stop);
  const onVisibility=()=>{if(document.hidden)stop();};
  document.addEventListener('visibilitychange',onVisibility);preference.addEventListener('change',stop);
  return ()=>{stop();document.removeEventListener('visibilitychange',onVisibility);preference.removeEventListener('change',stop);};
}
