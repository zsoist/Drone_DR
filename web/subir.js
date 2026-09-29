// Subir — panel plegable «Cómo capturar para 3D» dentro de Dron > Subida directa (subir.html redirige a drone.html?via=subir).
// Resumen corto + modal con el checklist completo en español. Fuente larga: docs/CAPTURE_PROTOCOL.md.
(function () {
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

  function openFull() {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal sb-modal">
      <div class="modal-h"><b>${ic('list')} Protocolo de captura 3D</b>
        <button class="modal-x" type="button" aria-label="Cerrar">${ic('close')}</button></div>
      <div class="modal-b">${FULL.map(([t, l]) => `<h3>${t}</h3><ul class="sb-list">${lis(l)}</ul>`).join('')}</div>
      <div class="modal-foot"><span class="modal-hint">Buenas prácticas generales de fotogrametría, no verificadas en estos dos modelos: contrasta con tu primer vuelo.</span></div>
    </div>`;
    document.body.appendChild(ov);
    if (typeof openModal === 'function') openModal(ov, { label: 'Protocolo de captura 3D' });
    else { ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.modal-x')) ov.remove(); }); }
  }

  if (!build()) {
    const mo = new MutationObserver(() => { if (build()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
