const main = renderShell('guia.html');   // activo = ninguna tab del nav (antes resaltaba Sistema en falso)
main.classList.add('gd-page');

// valor de fila: texto HTML de confianza, o { cmd } para un comando con botón de copiar
const FLOWS = [
  { id: 'sd', title: 'Vuelos del dron (tarjeta SD)', rows: [
    ['Vuela', 'DJI Flip o Neo 2, graba con normalidad.'],
    ['Inserta la SD', 'En el Mac Mini. Dron detecta la tarjeta solo.'],
    ['Importa', 'En <b>Dron</b>, pulsa <b>Importar nuevos</b>. Cada copia se verifica byte a byte.'],
    ['Procesa', { cmd: 'python3 pipeline/process.py --all' }],
    ['Analiza', { cmd: 'python3 ai/analyze.py --all' }],
    ['Reindexa', { cmd: 'python3 pipeline/build_index.py' }],
    ['Resultado', 'Todo aparece en Vuelos, con mapa y análisis AI.'],
  ], note: 'Los originales quedan intocables en <span class="mono">raw/</span>; el borrado de la SD es opcional.' },
  { id: 'subir', title: 'Subir un video desde la web', rows: [
    ['Abre Dron', 'En la pestaña <b>Subida directa</b>, desde cualquier dispositivo.'],
    ['Arrastra el video', 'MP4, MOV, MKV, AVI, MTS o WEBM. Puedes soltar varios a la vez.'],
    ['Inicia sesión', 'Con tu contraseña. La sesión dura 24 horas.'],
    ['Espera', 'El Mac hace el proxy y el análisis AI por su cuenta.'],
  ] },
  { id: 'venta', title: 'Video de una propiedad en venta', rows: [
    ['Graba', 'Dron para el exterior, teléfono para los interiores.'],
    ['Sube ambos', 'El dron por SD, el teléfono por Subida directa.'],
    ['Edita', 'Studio: marca los mejores cortes y pulsa Exportar.'],
    ['Publica', 'En <b>Ventas</b> obtienes una página aislada con link y QR.'],
  ], note: 'El link de un vuelo (<span class="mono">flight.html?id=…</span>) conserva video, mapa y datos, pero solo abre dentro de tu sesión privada.' },
  { id: 'reels', title: 'Editar y crear reels', rows: [
    ['Editor manual', 'Studio: elige un clip, marca IN y OUT, Exportar.'],
    ['Reel automático', { cmd: 'python3 ai/reel.py --vertical' }],
    ['Reel de un día', { cmd: 'python3 ai/reel.py --date 2026-07-04' }],
    ['Formatos', '16:9 para YouTube o 9:16 para Instagram y TikTok.'],
  ] },
  { id: 'buscar', title: 'Buscar en tu archivo', rows: [
    ['Por contenido', 'Vuelos: escribe «selva», «atardecer» o «canchas».'],
    ['Por lugar', 'Mapa: haz click en cualquier ruta.'],
    ['Por viaje', 'Viajes: agrupado por día.'],
    ['Atajo', 'Pulsa <kbd>/</kbd> para enfocar la búsqueda.'],
  ] },
  { id: '3d', title: '3D y Gaussian Splats', rows: [
    ['Procesa', '3D › Procesamiento: elige vuelo y calidad (estándar, alta, extra o ultra).'],
    ['Explora', 'Proyectos › Abrir: mapa, nube, malla y descargas.'],
    ['Entrena el splat', '«Generar splat…» de Rápido a Ultra. Puede correr toda la noche.'],
    ['Navega', 'Arrastra para mover, rueda o pellizco para zoom, click derecho o dos dedos para rotar, doble click para enfocar.'],
    ['Pule', 'Editar abre SuperSplat (quitar floaters, recortar). Cada re-subida guarda una versión.'],
    ['Comparte', 'El botón Compartir de la tarjeta crea un link público del visor.'],
  ], note: 'Las tarjetas muestran calidad (loss), gaussianas, cámaras e iteraciones. Borrar un splat lo manda a la papelera y no toca el modelo 3D ni el video.' },
  { id: 'atajos', title: 'Atajos del reproductor', rows: [
    ['Espacio', 'Reproducir o pausar.'],
    ['← →', 'Saltar 5 segundos.'],
    ['F', 'Pantalla completa.'],
    ['Click', 'En la ruta, la gráfica o el filmstrip salta a ese momento.'],
  ] },
];
const val = v => typeof v === 'string' ? `<span class="gd-txt">${v}</span>`
  : `<span class="gd-cmd"><code>${esc(v.cmd)}</code><button class="btn sm icon ghost" type="button" data-copy-cmd="${esc(v.cmd)}" aria-label="Copiar comando" data-tip="Copiar">${icon('copy')}</button></span>`;

main.innerHTML = `
  ${pageHead('Guía de operación', 'Cómo hacer cada cosa, paso a paso.')}
  <div class="gd-wrap">
    <nav class="gd-index" aria-label="Flujos">
      ${FLOWS.map((f, i) => `<a href="#g-${f.id}" data-gi="${f.id}"><span>${i + 1}</span>${f.title}</a>`).join('')}
    </nav>
    <div class="gd-flows">
      ${FLOWS.map((f, i) => `
      <section class="panel gd-flow" id="g-${f.id}">
        <div class="ph gd-ph"><span class="gd-n">${i + 1}</span><b>${f.title}</b></div>
        <div class="pb">
          <dl class="gd-rows">
            ${f.rows.map(([k, v]) => `<div class="gd-row"><dt>${k}</dt><dd>${val(v)}</dd></div>`).join('')}
          </dl>
          ${f.note ? `<p class="gd-note">${f.note}</p>` : ''}
        </div>
      </section>`).join('')}
    </div>
  </div>`;

main.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy-cmd]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copyCmd);
    b.classList.add('done');
    b.innerHTML = icon('check');
    b.setAttribute('aria-label', 'Copiado');
    setTimeout(() => { b.classList.remove('done'); b.innerHTML = icon('copy'); b.setAttribute('aria-label', 'Copiar comando'); }, 1400);
  } catch { toast('No se pudo copiar. Selecciona el comando a mano.'); }
});

// índice: resalta el flujo visible
if ('IntersectionObserver' in window) {
  const links = Object.fromEntries([...main.querySelectorAll('[data-gi]')].map(a => [a.dataset.gi, a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        Object.values(links).forEach(a => a.classList.remove('on'));
        links[en.target.id.slice(2)]?.classList.add('on');
      }
    });
  }, { rootMargin: '-15% 0px -70% 0px' });
  main.querySelectorAll('.gd-flow').forEach(s => io.observe(s));
}
