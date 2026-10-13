import { createSheet } from './sheet.js?v=431';
export const mapLocale = Object.freeze({
  'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar',
  'NavigationControl.ResetBearing': 'Orientar al norte',
  'FullscreenControl.Enter': 'Pantalla completa', 'FullscreenControl.Exit': 'Salir de pantalla completa',
  'GeolocateControl.FindMyLocation': 'Mostrar mi ubicación', 'GeolocateControl.LocationNotAvailable': 'Ubicación no disponible',
  'AttributionControl.ToggleAttribution': 'Información del mapa',
  'Map.Title': 'Mapa', 'Map.Description': 'Usa las flechas para mover el mapa.',
  'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl y la rueda para acercar el mapa',
  'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ y la rueda para acercar el mapa',
  'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa',
});
export const mapSkinOptions = { attributionControl: false, locale: mapLocale };
// Attribution originates in style metadata. Retain provider links without copying HTML.
function attributionNode(html) {
  const parsed = new DOMParser().parseFromString(String(html), 'text/html');
  const node = document.createElement('p');
  function append(source, target) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) target.append(document.createTextNode(child.textContent));
      else if (child.nodeName === 'A') {
        const href = child.getAttribute('href');
        let url; try { url = new URL(href, location.href); } catch {}
        if (url && ['https:', 'http:'].includes(url.protocol)) {
          const link = document.createElement('a'); link.href = url.href; link.textContent = child.textContent;
          link.target = '_blank'; link.rel = 'noopener noreferrer'; target.append(link);
        } else target.append(document.createTextNode(child.textContent));
      } else if (!['SCRIPT', 'STYLE', 'IFRAME'].includes(child.nodeName)) append(child, target);
    }
  }
  append(parsed.body, node); return node;
}
/** Create the map with mapSkinOptions first. Call destroy before removing the map. */
export function skinMap(map, { library = window.maplibregl, navigation = true, position = 'top-right' } = {}) {
  const container = map.getContainer(); container.classList.add('ui-map');
  map.getCanvas().setAttribute('aria-label', 'Mapa del recorrido');
  const content = document.createElement('div'); content.className = 'ui-map-attribution';
  const sheet = createSheet({ title: 'Información del mapa', content, size: 'peek' });
  const info = document.createElement('button'); info.type = 'button'; info.className = 'ui-map-info';
  info.setAttribute('aria-label', 'Información del mapa'); info.title = 'Información del mapa';
  info.setAttribute('aria-haspopup', 'dialog');
  info.textContent = 'Info';
  info.addEventListener('click', () => {
    content.replaceChildren();
    const credits = new Set(Object.values(map.getStyle()?.sources || {}).map(source => source.attribution).filter(Boolean));
    credits.add('<a href="https://maplibre.org/">MapLibre</a>');
    credits.forEach(credit => content.append(attributionNode(credit))); sheet.open(info);
  });
  const control = { onAdd() { const node = document.createElement('div'); node.className = 'maplibregl-ctrl maplibregl-ctrl-group'; node.append(info); return node; }, onRemove() { info.parentElement?.remove(); } };
  map.addControl(control, position);
  const nav = navigation ? new library.NavigationControl() : null;
  if (nav) map.addControl(nav, position);
  let destroyed = false;
  function destroy() {
    if (destroyed) return; destroyed = true;
    sheet.destroy(); map.removeControl(control); if (nav) map.removeControl(nav);
    container.classList.remove('ui-map'); map.off('remove', destroy);
  }
  map.on('remove', destroy);
  return { destroy };
}
