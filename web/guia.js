import { fmt } from './ui/format.js?v=415';
const main = renderShell('guia.html');
main.classList.add('ab-page', 'gd-page');
const guides = [
  {id:'importar',title:'Traer tus vuelos',intro:'De la tarjeta al archivo, con el video y su ruta juntos.',href:'drone.html',action:'Abrir Dron',steps:[['Conecta la tarjeta','Inserta la microSD en el Mac y abre Dron.'],['Elige los archivos','Pulsa Importar archivos. Con la tarjeta conectada, pulsa Importar y elige los videos y las fotos.'],['Conserva la tarjeta','Espera a que termine la importación. Revisa el resultado antes de borrar archivos por tu cuenta.']],note:'El archivo SRT del video aporta la ruta, la altura y la velocidad. Conserva ambos archivos juntos.'},
  {id:'subir',title:'Subir videos y fotos',intro:'También puedes empezar desde el teléfono o el computador.',href:'drone.html?via=subir',action:'Abrir Subida directa',steps:[['Abre Subida directa','En Dron, abre Subida directa. Elige Videos o Fotos en Tipo de archivo.'],['Selecciona el material','Usa Elegir videos, Elegir fotos o arrastra los archivos desde el computador.'],['Consulta el avance','La actividad de la parte inferior abre Sistema. Ahí puedes ver el progreso y los errores.']],note:'Un video sin su archivo de telemetría no incluye una ruta GPS. Las fotos pueden conservar el GPS de sus metadatos.'},
  {id:'editar',title:'Crear un reel',intro:'Elige los momentos que cuentan la historia.',href:'studio.html',action:'Abrir Studio',steps:[['Elige un clip','Abre Studio y elige un video del archivo para añadirlo al montaje.'],['Marca los cortes','Selecciona el inicio y el final de cada segmento.'],['Exporta','Cuando tengas un montaje, elige el formato de salida y expórtalo. Revisa el trabajo en Sistema.']],note:'El montaje genera otro archivo. El video original se conserva.'},
  {id:'buscar',title:'Encontrar un vuelo',intro:'Busca lo que aparece en tus clips o vuelve a un lugar conocido.',href:'trips.html',action:'Ver viajes',steps:[['Abre la búsqueda','Usa la lupa o pulsa ⌘K en Mac y Ctrl+K en Windows.'],['Escribe lo que recuerdas','Prueba con atardecer o edificios. Abre un resultado para ver el momento encontrado.'],['Explora el mapa','En Viajes puedes volver a las rutas de tus vuelos.']]},
  {id:'3d',title:'Explorar en 3D',intro:'Transforma una captura en un lugar que puedes recorrer.',href:'tresd.html',action:'Abrir 3D',steps:[['Elige la captura','Abre 3D y pulsa Crear escena para seleccionar la captura.'],['Revisa la calidad','El procesamiento usa el PC. Puedes seguir su avance en Sistema.'],['Abre el resultado','Arrastra para explorar y usa la rueda o pellizca para acercarte.']],note:'Los enlaces del visor requieren tu sesión privada. No permiten acceso a otras personas sin iniciar sesión.'},
  {id:'propiedades',title:'Preparar una propiedad',intro:'Reúne los datos del lugar y su recorrido aéreo.',href:'ventas.html',action:'Abrir Ventas',steps:[['Crea la ficha','Pulsa Nueva propiedad y escribe el nombre, la ubicación y el precio.'],['Elige la vista aérea','Selecciona un vuelo como portada y un video para el recorrido.'],['Revisa y guarda','Si hay un análisis del vuelo, pulsa Aceptar o Descartar en la descripción sugerida. Guarda la ficha con Guardar propiedad.']],note:'La ficha y su enlace son privados. El acceso para compradores aún no está disponible.'},
];
main.innerHTML=`<header class="gd-head"><h1>Guía</h1><a class="ui-button ui-button--primary" href="#g-importar">Empezar con una tarjeta</a></header><div class="gd-layout"><nav class="gd-index" aria-label="En esta guía"><p>En esta guía</p>${guides.map(g=>`<a href="#g-${g.id}" data-guide="${g.id}">${g.title}${icon('chevR')}</a>`).join('')}</nav><div class="gd-content">${guides.map(g=>`<section class="gd-section" id="g-${g.id}"><div class="gd-step-content"><h2>${g.title}</h2><p class="gd-intro">${g.intro}</p><ol>${g.steps.map(([title,text])=>`<li><div><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>${g.note?`<p class="gd-note">${g.note}</p>`:''}<a class="ui-button ui-button--secondary" href="${g.href}">${g.action} ${icon('chevR')}</a></div><figure class="gd-frame" data-guide-frame="${g.id}" aria-busy="true"><div class="ui-skeleton ui-skeleton--media" aria-hidden="true"></div></figure></section>`).join('')}</div></div>`;
registerPaletteSource(()=>guides.map(g=>({id:`guide-${g.id}`,label:g.title,keywords:'Guía ayuda',href:`guia.html#g-${g.id}`})));
const observer=new IntersectionObserver(entries=>{ for(const e of entries) if(e.isIntersecting) main.querySelectorAll('[data-guide]').forEach(a=>{ const current=a.dataset.guide===e.target.id.slice(2); if(current) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); }); },{rootMargin:'-10% 0px -65% 0px'});
main.querySelectorAll('.gd-section').forEach(s=>observer.observe(s));

async function loadGuideFrames() {
  try {
    const response=await fetch(`${DATA}/manifest/flights.json`);
    if (!response.ok) throw new Error('frames');
    const flights=(await response.json()).flights.filter(f=>!f.archived && f.frame_count > 0 && f.has_srt && f.stats?.max_rel_alt_m > 30);
    main.querySelectorAll('[data-guide-frame]').forEach((figure,i)=>{
      const flight=flights[Math.floor(i * Math.max(0,flights.length - 1) / guides.length)];
      if (!flight) { figure.remove(); return; }
      const frame=String(Math.max(1,Math.ceil(flight.frame_count/2))).padStart(4,'0');
      figure.innerHTML=`<img src="${DATA}/frames/${encodeURIComponent(flight.clip_id)}/f_${frame}.jpg" alt="Vista aérea del archivo" loading="eager"><figcaption>Fotograma del archivo · ${fmt.date(flight.date)}</figcaption>`;
      figure.setAttribute('aria-busy','false');
    });
  } catch { main.querySelectorAll('[data-guide-frame]').forEach(figure=>{ figure.textContent='No se pudieron cargar las imágenes.'; figure.setAttribute('aria-busy','false'); }); }
}
loadGuideFrames();
