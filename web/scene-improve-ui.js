import { createSheet } from './ui/sheet.js?v=391';
import { showToast } from './ui/toast.js?v=391';
import { registerPaletteSource } from './ui/palette.js?v=391';
export { createSheet, showToast };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const areaNav = active => `<nav class="area-nav" aria-label="Área 3D">${[['escenas','tresd.html','Escenas'],['mundo','mundo.html','Mundo'],['volar','volar.html','Volar']].map(([key,href,label]) => `<a href="${href}"${key===active?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
export const skeletonCards = () => `<div class="scene-skeleton" aria-hidden="true">${Array.from({length:2},()=>'<div><div class="ui-skeleton ui-skeleton--media"></div><div class="ui-skeleton ui-skeleton--text"></div></div>').join('')}</div>`;
export function registerScenes(rows, label = 'Escena') {
  return registerPaletteSource(() => rows.map(row => ({id:`world-${row.clip_id}`,label:row.title || row.name || row.clip_id,keywords:`${label} 3D`,href:`share.html?m=${encodeURIComponent(row.clip_id)}`})));
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
// Suggestions stay separate from owner data. Decisions are local until W6 supplies persistence.
export function suggestionBlock({id, title='Descripción de la escena', text, empty='Sin análisis aún. La descripción aparecerá cuando se analice una captura.'}) {
  const node=document.createElement('section');node.className='scene-suggestion';
  const key=`ab.3d.suggestion.${id}`;
  let decision='';try{decision=JSON.parse(localStorage.getItem(key)||'null')?.text===text?JSON.parse(localStorage.getItem(key)).decision:'';}catch{}
  const render=()=>{
    node.replaceChildren();
    const heading=document.createElement('h3');heading.textContent=title;node.append(heading);
    if(!text){const p=document.createElement('p');p.textContent=empty;node.append(p);return;}
    const tag=document.createElement('span');tag.className='ui-chip';tag.textContent=decision==='accepted'?'Aceptado en este dispositivo':decision==='dismissed'?'Descartado en este dispositivo':'Sugerido';node.append(tag);
    const p=document.createElement('p');p.textContent=text;if(decision!=='dismissed')node.append(p);
    const actions=document.createElement('div');actions.className='scene-actions';
    const choices=decision?[['','Revisar sugerencia']]:[['accepted','Aceptar'],['dismissed','Descartar']];
    choices.forEach(([value,label])=>{const b=document.createElement('button');b.className='ui-button ui-button--secondary';b.textContent=label;b.onclick=()=>{try{localStorage.setItem(key,JSON.stringify({text,decision:value}));}catch{showToast('No se pudo guardar la decisión.');return;}decision=value;render();document.dispatchEvent(new CustomEvent('scene:suggestion',{detail:{id}}));};actions.append(b);});node.append(actions);
    if(!decision){const note=document.createElement('small');note.textContent='Tu decisión se guarda solo en este dispositivo.';node.append(note);}
  };render();return node;
}
export function descriptionText(model, ai) {
  if (!ai?.summary) return 'Sin análisis aún';
  try { const stored=JSON.parse(localStorage.getItem(`ab.3d.suggestion.${model.clip_id}.description`) || 'null');
    if (stored?.text===ai.summary && stored.decision==='dismissed') return 'Descripción descartada';
    if (stored?.text===ai.summary && stored.decision==='accepted') return `Aceptado en este dispositivo · ${ai.summary}`;
  } catch {}
  return `Sugerido · ${ai.summary}`;
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
export async function sceneInfo({model, ai, opener}) {
  const content=document.createElement('div');content.className='scene-info';
  content.append(suggestionBlock({id:`${model.clip_id}.description`,text:ai?.summary}));
  const coach=suggestionBlock({id:`${model.clip_id}.coach`,title:'Tu próxima captura',empty:'Consultando el análisis de captura…'});content.append(coach);
  const sheet=contentSheet('Información de la escena',content,opener);
  try {
    const r=await readSceneData(`/api/capture_report?clip_id=${encodeURIComponent(model.clip_id)}`);if(!r.ok)throw Error();
    const report=await r.json();
    const text=[...(report.warnings||[])].filter(v=>typeof v==='string'&&v.trim()).slice(0,3).join(' ');
    coach.replaceWith(suggestionBlock({id:`${model.clip_id}.coach`,title:'Tu próxima captura',text,empty:'Sin análisis aún. No hay recomendaciones de captura para esta escena.'}));
  }catch{coach.querySelector('p').textContent='No se pudo consultar el análisis. Cierra y vuelve a abrir la información.';}
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
