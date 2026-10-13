import { fmt } from './format.js?v=402';
import { Suggested } from './suggested.js?v=402';
import { mountTabs } from './tabs.js?v=402';
import { skinMap, mapSkinOptions } from './map-skin.js?v=402';
import { skinPlayer } from './player.js?v=402';
import { registerPaletteSource } from './palette.js?v=402';
await shell.ready;
const main = renderShell(); main.classList.add('ab-page');
main.innerHTML = `${shell.backLink('Inicio', '/home.html')}
  <header class="demo-heading"><h1>Componentes compartidos</h1><p>Demostración de controles. El mapa y el video usan un vuelo del archivo. Las cifras de ejemplo no son mediciones del vuelo.</p></header>
  <div class="demo-actions"><button class="ui-button ui-button--secondary" id="demo-palette">Buscar en el archivo</button><button class="ui-button ui-button--quiet" id="demo-more">Más</button></div>
  <dl class="demo-stats"><div><dt>Duración de ejemplo</dt><dd class="ui-figure">3 <span class="ui-unit">min</span> 39 <span class="ui-unit">s</span></dd></div><div><dt>Distancia de ejemplo</dt><dd class="ui-figure">1,2 <span class="ui-unit">km</span></dd></div><div><dt>Área de ejemplo</dt><dd class="ui-figure">16,2 <span class="ui-unit">ha</span></dd></div></dl>
  <div class="ui-tabs" aria-label="Vista de demostración"><button type="button" role="tab" aria-selected="true" aria-controls="demo-map-panel">Mapa</button><button type="button" role="tab" aria-selected="false" aria-controls="demo-video-panel">Video</button></div>
  <section class="demo-panel" id="demo-map-panel"><h2>Recorrido</h2><div id="demo-map" class="demo-map"></div><p class="demo-note" id="demo-map-note"></p></section>
  <section class="demo-panel demo-player" id="demo-video-panel" hidden><h2>Video del vuelo</h2><video id="demo-video" muted playsinline preload="metadata"></video><p class="demo-note" id="demo-video-note"></p></section>`;
const suggestion = Suggested({ content: 'Prueba una descripción antes de guardarla en el vuelo.', onAccept: () => {}, onDismiss: () => {} });
main.append(suggestion);
const tabs = mountTabs(main.querySelector('.ui-tabs'), { onChange: () => { map?.resize(); video.pause(); } });
const video = main.querySelector('video');
const player = skinPlayer(video);
let map;
document.getElementById('demo-palette').onclick = () => document.querySelector('[data-palette]').click();
document.getElementById('demo-more').onclick = () => document.querySelector('[data-more]').click();
try {
  const response = await fetch('/data/manifest/flights.json');
  if (!response.ok) throw new Error('No se pudo leer el archivo.');
  const { flights } = await response.json();
  const flight = flights.find(f => f.has_proxy && f.stats?.home?.length === 2);
  if (!flight) throw new Error('No hay un vuelo con video y GPS para esta demostración.');
  video.src = `/data/proxies/${encodeURIComponent(flight.clip_id)}.mp4`;
  video.poster = `/data/thumbs/${encodeURIComponent(flight.clip_id)}.jpg`;
  document.getElementById('demo-video-note').textContent = `${flight.label || 'Vuelo del archivo'} · ${fmt.date(flight.date)}`;
  document.getElementById('demo-map-note').textContent = `Ubicación de salida · ${fmt.date(flight.date)} · Abre Info para consultar las fuentes del mapa.`;
  map = new maplibregl.Map({ ...mapSkinOptions, container: 'demo-map', style: SAT_STYLE, center: flight.stats.home, zoom: 15, cooperativeGestures: true });
  const mapSkin = skinMap(map);
  window.demoMap = map;
  registerPaletteSource(() => [{ id: 'demo-current', label: 'Componentes compartidos', href: '/ui/demo.html', hint: 'Mapa y reproductor' }]);
  window.demoReady = true;
  addEventListener('pagehide', () => { player.destroy(); mapSkin.destroy(); map.remove(); tabs.destroy(); }, { once: true });
} catch (error) {
  const status = document.createElement('p'); status.className = 'demo-error'; status.textContent = error.message; main.append(status);
}
