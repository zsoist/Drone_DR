

// Dron still loads this file for its legacy capture panel. That page owns its uploader.
(async () => {
if (location.pathname.endsWith('/subir.html')) {
  const { showToast } = await import('./ui/toast.js?v=402');
  const { registerPaletteSource } = await import('./ui/palette.js?v=402');
  const { fmt } = await import('./ui/format.js?v=402');
  await shell.ready;
  const main = renderShell('studio.html');
  main.classList.add('sb-page', 'ab-page');
  main.innerHTML = `
    ${shell.backLink('Studio', '/studio.html')}
    <header class="sb-heading"><h1>Subir</h1></header>
    <section class="sb-drop" id="sb-drop" aria-label="Añadir archivos">
      <h2>Añade videos y fotos</h2>
      <p class="sb-desktop-hint">Arrastra los archivos aquí o elígelos en tu dispositivo.</p>
      <p class="sb-phone-hint">Selecciona videos y fotos de tu dispositivo.</p>
      <div class="sb-pickers">
        <button class="ui-button ui-button--primary" id="sb-pick">${icon('plus')} Seleccionar videos y fotos</button>
      </div>
      <input type="file" id="sb-file" multiple hidden accept="video/*,image/*,.mp4,.mov,.m4v,.mkv,.avi,.mts,.webm,.jpg,.jpeg,.png,.heic,.heif,.webp,.dng">
      <small>MP4, MOV, JPG, HEIC y DNG, entre otros.</small>
    </section>
    <div class="sb-sidebar"><section class="sb-queue" aria-labelledby="sb-queue-title">
      <div class="sb-queue-head"><h2 id="sb-queue-title">Archivos</h2><span id="sb-count" role="status">Sin archivos pendientes</span></div>
      <div id="sb-list"><p class="sb-empty">Aquí verás el avance de los archivos que selecciones.</p></div>
      <p class="sb-note">Mantén esta página abierta durante la transferencia. Si se interrumpe, puedes reintentar el archivo desde el inicio.</p>
    </section>
    <aside class="sb-next"><h2>Después de subir</h2><p>Los videos pasan a la cola de procesamiento. Consulta el avance en Actividad y edítalos cuando estén listos.</p><a class="ui-button ui-button--quiet" href="studio.html">Volver a Studio ${icon('chevR')}</a></aside></div>`;
  const items = [];
  let running = false;
  const input = main.querySelector('#sb-file');
  main.querySelector('#sb-pick').onclick = () => input.click();
  registerPaletteSource(() => [{ id:'studio-upload', label:'Subir videos y fotos', action:()=>input.click() }]);
  const size = bytes => fmt.gb(bytes);
  function update(item) {
    item.status.textContent = item.message;
    item.progress.value = item.percent;
    item.progress.setAttribute('aria-label', `Transferencia de ${item.file.name}`);
    item.retry.hidden = item.state !== 'error';
    item.cancel.hidden = !['queued','uploading'].includes(item.state);
    item.el.dataset.state = item.state;
    const pending=items.filter(x=>['queued','uploading'].includes(x.state)).length;
    main.querySelector('#sb-count').textContent = pending ? `${pending} pendientes · ${items.filter(x=>x.state==='done').length} enviados` : `${items.filter(x=>x.state==='done').length} enviados · ${items.filter(x=>x.state==='error').length} con error`;
  }
  function add(files) {
    if (!files.length) return;
    if (!items.length) main.querySelector('#sb-list').replaceChildren();
    for (const file of files) {
      if(items.some(i=>i.file.name===file.name && i.file.size===file.size && i.file.lastModified===file.lastModified && i.state!=='cancelled')) continue;
      const video = /\.(mp4|mov|m4v|mkv|avi|mts|webm)$/i.test(file.name);
      const valid = video || /\.(jpe?g|png|heic|heif|webp|dng)$/i.test(file.name);
      const item={file,video,state:valid?'queued':'error',message:valid?'En cola':'Formato no compatible',percent:0};
      const row=document.createElement('article');row.className='sb-file-row';
      row.innerHTML=`<span class="sb-file-icon">${icon(video?'film':'image')}</span><div class="sb-file-info"><h3></h3><span class="sb-file-size"></span><p role="status"></p><progress max="100" value="0"></progress></div><div class="sb-file-actions"><button class="ui-button ui-button--secondary" data-retry>Reintentar</button><button class="ui-button ui-button--quiet" data-cancel>Cancelar</button></div>`;
      row.querySelector('h3').textContent=file.name;const [amount, unit] = size(file.size).split(' '); row.querySelector('.sb-file-size').innerHTML=`<span class="ui-figure">${amount}</span> <span class="ui-unit">${unit}</span>`;
      Object.assign(item,{el:row,status:row.querySelector('[role=status]'),progress:row.querySelector('progress'),retry:row.querySelector('[data-retry]'),cancel:row.querySelector('[data-cancel]')});
      item.retry.onclick=()=>{if(!valid)return showToast('Elige un formato compatible.');item.state='queued';item.message='En cola';item.percent=0;update(item);drain();};
      item.cancel.onclick=()=>{item.state='cancelled';item.message='Cancelado';item.xhr?.abort();update(item);};
      items.push(item);main.querySelector('#sb-list').append(row);update(item);
    }
    drain();
  }
  function send(item) {
    return new Promise(resolve=>{
      const xhr=item.xhr=new XMLHttpRequest();
      item.state='uploading';item.message='Conectando…';update(item);
      xhr.open('POST',`${item.video?'/upload':'/api/photo_upload'}?name=${encodeURIComponent(item.file.name)}`);
      xhr.setRequestHeader('X-AeroBrain-CSRF','1');
      xhr.withCredentials=true; xhr.timeout=30*60*1000;
      xhr.upload.onprogress=e=>{if(!e.lengthComputable)return;item.percent=Math.round(e.loaded/e.total*100);item.message=item.percent===100?'Transferido · esperando confirmación':`${item.percent}% · ${size(e.loaded)} de ${size(e.total)}`;update(item);};
      const fail=message=>{if(item.state!=='cancelled'){item.state='error';item.message=message;update(item);}resolve();};
      xhr.onload=()=>{
        let data;try{data=JSON.parse(xhr.responseText);}catch{return fail('Respuesta no válida. Reintenta.');}
        if(xhr.status<200||xhr.status>=300||data.error||data.ok===false)return fail(xhr.status===403?'Esta vista de prueba no permite subir archivos.':data.error||`No se pudo subir (${xhr.status}).`);
        item.state='done';item.percent=100;item.message=item.video?'Recibido · consulta el procesamiento en Actividad':'Foto recibida';update(item);resolve();
      };
      xhr.onerror=()=>fail('Sin conexión. Reintenta desde el inicio.');
      xhr.ontimeout=()=>fail('La transferencia tardó demasiado. Reintenta.');
      xhr.onabort=()=>{resolve();};xhr.send(item.file);
    });
  }
  async function drain(){if(running)return;running=true;try{let next;while((next=items.find(i=>i.state==='queued')))await send(next);}finally{running=false;}}
  for(const field of [input])field.onchange=()=>{add([...field.files]);field.value='';};
  const drop=main.querySelector('#sb-drop');
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};
  drop.ondragleave=e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('dragging');};
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');add([...e.dataTransfer.files]);};
  window.addEventListener('beforeunload',e=>{if(items.some(i=>['queued','uploading'].includes(i.state))){e.preventDefault();e.returnValue='';}});
}

})();

if (!location.pathname.endsWith('/subir.html')) (function () {
  const KEY = 'ab_capture_tips_open';
  const ic = n => (typeof icon === 'function' ? icon(n) : '');

  const TIPS = [
    '<b>Fotos fijas para malla</b> (Timed Shot 2–3 s). El video solo sirve para splats: vuela lento, 1–2 m/s.',
    '<b>Exposición manual:</b> obturador ≥ <span class="mono">1/500 s</span>, ISO bajo, balance de blancos y enfoque fijos.',
    '<b>Techo:</b> pasada nadir en líneas paralelas a 40–60 m, cámara a −90°, con 80 % de traslape.',
    '<b>Fachadas:</b> 3 órbitas a 10–20 m del muro (cámara −25°, −45°, −60°), una foto cada 10–15° de giro.',
    '<b>Cantidad:</b> 150–300 fotos por edificio. Revisa nitidez al 100 % antes de irte.',
    '<b>Escala:</b> 3–4 puntos de control medidos o una regla de 1–2 m visible en las fotos.',
    '<b>Neo 2:</b> solo JPEG, lente muy ancho; se procesa con modelo de lente Brown.',
  ];

  const FULL = [
    ['Antes de volar', [
      'Viento por debajo de 8 m/s, luz estable (nublado o sol alto). Zona legal y despejada.',
      'Modo <b>fotos</b>, Timed Shot 2–3 s, resolución completa, JPEG (Neo 2 no ofrece RAW).',
      'Exposición manual: obturador ≥ 1/500 s (1/800 con viento u órbitas), ISO ≤ 800, EV por histograma.',
      'Balance de blancos en Kelvin fijo, enfoque bloqueado, sin recorte ni filtros del app.',
      'Coloca 3–4 marcas (o una regla de 1–2 m) y anota sus coordenadas o su longitud.',
    ]],
    ['Vuelo de un edificio', [
      '<b>1 · Nadir:</b> líneas paralelas a 40–60 m, cámara −90°, traslape ≥ 80 % de frente y 70 % lateral.',
      '<b>2 · Anillo A:</b> a 1/3 de la altura del edificio, cámara −25°, 10–20 m del muro.',
      '<b>3 · Anillo B:</b> a 2/3 de la altura, cámara −45°.',
      '<b>4 · Anillo C:</b> altura del techo + 5 m, cámara −60°.',
      'En cada anillo dispara cada 10–15° de giro y mira siempre al centro. Si sale movido, para y dispara.',
      '<b>5 · Fachada a 0°:</b> solo si es seguro y legal, en tiras horizontales paralelas al muro.',
    ]],
    ['Terreno abierto', [
      'Solo nadir a 60–100 m con cuadrícula cruzada (gira 90° y cambia ±20 m de altura). Evita agua y vegetación en viento.',
    ]],
    ['Video para splats', [
      'Velocidad 1–2 m/s, giros suaves, obturador fijo, sin zoom. Cierra el circuito donde empezaste.',
      'AeroBrain elige los fotogramas más nítidos; no hace falta escogerlos a mano.',
    ]],
    ['Al aterrizar', [
      '150–300 fotos por edificio. Cada muro con al menos 3 fotos oblicuas.',
      'Abre 10 fotos al 100 %: si 3 salen blandas, sube el obturador o vuela más lento.',
      'Cada marca visible en 5 fotos o más. No renombres ni borres fotos de la tarjeta.',
    ]],
    ['Problemas típicos', [
      '<b>Huecos:</b> falta traslape. Repite la pasada o añade una cuadrícula cruzada.',
      '<b>Suelo curvo (doming):</b> una sola altura o lente sin calibrar. Añade otra altura y puntos de control.',
      '<b>Flotadores:</b> gente, autos o árboles con viento. Vuela rápido y sin movimiento; se limpian en Splat Lab.',
      '<b>Textura con manchas:</b> exposición o balance automáticos. Bloquéalos.',
    ]],
  ];

  const lis = a => a.map(x => `<li><span>${x}</span></li>`).join("");

  function build() {
    const wrap = document.querySelector('.dr-mod[data-mod="up"] .dr-up-wrap');
    const zone = wrap && (wrap.querySelector('#up-panes') || wrap.querySelector('#drop'));
    if (!wrap || !zone || wrap.querySelector('.sb-cap')) return !!(wrap && wrap.querySelector('.sb-cap'));
    let open = true;
    try { open = localStorage.getItem(KEY) !== '0'; } catch (e) {}
    const d = document.createElement('details');
    d.className = 'panel sb-cap';
    d.id = 'sb-cap';
    if (open) d.open = true;
    d.innerHTML = `<summary class="ph">${ic('image')} Cómo capturar para 3D</summary>
      <div class="pb">
        <ul class="sb-list">${lis(TIPS)}</ul>
        <div class="sb-foot">
          <p class="dr-note">DJI Flip y Neo 2 no tienen misiones automáticas: el traslape depende de ti.</p>
          <button type="button" class="btn sm" id="sb-full">${ic('list')} Protocolo completo</button>
        </div>
      </div>`;
    zone.insertAdjacentElement('afterend', d);
    d.addEventListener('toggle', () => { try { localStorage.setItem(KEY, d.open ? '1' : '0'); } catch (e) {} });
    d.querySelector('#sb-full').addEventListener('click', openFull);
    return true;
  }

  async function openFull() {
    const { createSheet } = await import('./ui/sheet.js?v=402');
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal sb-modal">
      <div class="modal-h"><b>${ic('list')} Protocolo de captura 3D</b>
        <button class="modal-x" type="button" aria-label="Cerrar">${ic('close')}</button></div>
      <div class="modal-b">${FULL.map(([t, l]) => `<h3>${t}</h3><ul class="sb-list">${lis(l)}</ul>`).join('')}</div>
      <div class="modal-foot"><span class="modal-hint">Buenas prácticas generales de fotogrametría, no verificadas en estos dos modelos: contrasta con tu primer vuelo.</span></div>
    </div>`;
    const content = ov.querySelector('.modal-b');
    const sheet = createSheet({ title: 'Protocolo de captura 3D', content, size:'full', onClose:()=>queueMicrotask(()=>sheet.destroy()) });
    sheet.open();
  }

  if (!build()) {
    const mo = new MutationObserver(() => { if (build()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
