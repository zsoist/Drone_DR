import { approvedFrame } from './p.logic.js?v=438';
const main = renderShell('guia.html');
main.classList.add('ab-page', 'gd-page');
const guides = [
  {id:'importar',title:'Traer tus vuelos',intro:'De la tarjeta al archivo, con el video y su ruta juntos.',href:'drone.html',action:'Abrir Dron',steps:[['Conecta la tarjeta','Inserta la microSD en el Mac y abre Dron.'],['Busca la tarjeta','Pulsa Buscar tarjeta. Cuando aparezca, pulsa Importar (N nuevos).'],['Elige los archivos','Revisa la selección y la carpeta de destino. Confirma con Importar archivos.'],['Conserva la tarjeta','Espera a que termine la importación. Revisa el resultado antes de borrar archivos por tu cuenta.']],note:'El archivo SRT del video aporta la ruta, la altura y la velocidad. Conserva ambos archivos juntos.'},
  {id:'subir',title:'Subir videos y fotos',intro:'También puedes empezar desde el teléfono o el computador.',href:'subir.html',action:'Abrir Subir',steps:[['Abre Subir','En Studio, pulsa Subir.'],['Selecciona el material','Pulsa Seleccionar videos y fotos o arrastra los archivos desde el computador.'],['Consulta el avance','Abre Más y luego Sistema para ver el progreso y los errores.']],note:'Un video sin su archivo de telemetría no incluye una ruta GPS. Las fotos pueden conservar el GPS de sus metadatos.'},
  {id:'editar',title:'Crear un reel',intro:'Elige los momentos que cuentan la historia.',href:'studio.html',action:'Abrir Studio',steps:[['Elige un clip','En Studio, busca un video del archivo y pulsa Insertar aquí.'],['Marca los cortes','Selecciona el inicio y el final de cada segmento.'],['Exporta','Pulsa Exportar, elige el formato y confirma con Exportar ahora. Revisa el trabajo en Sistema.']],note:'El montaje genera otro archivo. El video original se conserva.'},
  {id:'buscar',title:'Encontrar un vuelo',intro:'Busca lo que aparece en tus clips o vuelve a un lugar conocido.',href:'trips.html',action:'Ver viajes',steps:[['Abre la búsqueda','Usa la lupa o pulsa ⌘K en Mac y Ctrl+K en Windows.'],['Escribe lo que recuerdas','Prueba con atardecer o edificios. Abre un resultado para ver el momento encontrado.'],['Explora el mapa','En Viajes puedes volver a las rutas de tus vuelos.']]},
  {id:'3d',title:'Explorar en 3D',intro:'Transforma una captura en un lugar que puedes recorrer.',href:'tresd.html',action:'Abrir 3D',steps:[['Elige la captura','Abre 3D y pulsa Crear escena para seleccionar la captura.'],['Revisa la calidad','El procesamiento usa el PC. Puedes seguir su avance en Sistema.'],['Abre el resultado','Arrastra para explorar y usa la rueda o pellizca para acercarte.']],note:'Los enlaces del visor requieren tu sesión privada. No permiten acceso a otras personas sin iniciar sesión.'},
  {id:'propiedades',title:'Preparar una propiedad',intro:'Reúne los datos del lugar y su recorrido aéreo.',href:'ventas.html',action:'Abrir Ventas',steps:[['Crea la ficha','Pulsa Nueva propiedad y escribe el nombre, la ubicación y el precio.'],['Elige la vista aérea','Selecciona un vuelo como portada y un video para el recorrido.'],['Revisa y guarda','Si hay un análisis del vuelo, pulsa Aceptar o Descartar en la descripción sugerida. Guarda la ficha con Guardar propiedad.']],note:'La ficha y su enlace son privados. El acceso para compradores aún no está disponible.'},
];
main.innerHTML=`<header class="gd-head"><h1>Guía</h1><a class="ui-button ui-button--primary" href="#g-importar">Empezar con una tarjeta</a></header><div class="gd-layout"><nav class="gd-index" aria-label="En esta guía"><p>En esta guía</p>${guides.map(g=>`<a href="#g-${g.id}" data-guide="${g.id}">${g.title}${icon('chevR')}</a>`).join('')}</nav><div class="gd-content">${guides.map(g=>`<section class="gd-section" id="g-${g.id}"><div class="gd-topic"><h2>${g.title}</h2><p class="gd-intro">${g.intro}</p><div class="gd-media" aria-busy="true"><div class="ui-skeleton ui-skeleton--media" aria-hidden="true"></div></div><a class="ui-button ui-button--secondary" href="${g.href}">${g.action} ${icon('chevR')}</a></div><div class="gd-instructions"><ol>${g.steps.map(([title,text])=>`<li><div><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>${g.note?`<p class="gd-note">${g.note}</p>`:''}</div></section>`).join('')}</div></div>`;
registerPaletteSource(()=>guides.map(g=>({id:`guide-${g.id}`,label:g.title,keywords:'Guía ayuda',href:`guia.html#g-${g.id}`})));
const observer=new IntersectionObserver(entries=>{ for(const e of entries) if(e.isIntersecting) main.querySelectorAll('[data-guide]').forEach(a=>{ const current=a.dataset.guide===e.target.id.slice(2); if(current) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); }); },{rootMargin:'-10% 0px -65% 0px'});
main.querySelectorAll('.gd-section').forEach(s=>observer.observe(s));

// Use only reviewed archive frames, with one distinct image per guide section.
async function loadGuideFrames() {
  const slots=[...main.querySelectorAll('.gd-media')];
  try {
    const response=await authFetch('/api/collections');
    if (!response.ok) throw new Error('collections');
    const data=await response.json(), seen=new Set();
    const frames=(data.collections || []).map(c=>c.cover).filter(frame=>{
      if (!approvedFrame(frame) || seen.has(frame.frame_url)) return false;
      seen.add(frame.frame_url); return true;
    });
    slots.forEach((slot,index)=>{
      const frame=frames[index];
      if (!frame) { slot.remove(); return; }
      const image=document.createElement('img'); image.src=frame.frame_url;
      image.alt='Vista aérea del archivo'; image.loading=index ? 'lazy' : 'eager';
      image.addEventListener('error',()=>{slot.textContent='No se pudo cargar la imagen.';},{once:true});
      slot.replaceChildren(image); slot.setAttribute('aria-busy','false');
    });
  } catch { slots.forEach(slot=>{slot.textContent='No se pudieron cargar las imágenes del archivo.';slot.setAttribute('aria-busy','false');}); }
}
loadGuideFrames();
