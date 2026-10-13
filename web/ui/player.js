import { fmt } from './format.js?v=417';
const players = new WeakMap();
/** Custom controls for a real video. Returns destroy(); does not start playback on mount. */
export function skinPlayer(video, { label = 'Video del vuelo' } = {}) {
  if (players.has(video)) return players.get(video);
  const original = { controls: video.controls, playsInline: video.playsInline };
  const wrapper = document.createElement('div'); wrapper.className = 'ui-player';
  video.before(wrapper); wrapper.append(video); video.controls = false; video.playsInline = true;
  const controls = document.createElement('div'); controls.className = 'ui-player-controls';
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', `Controles: ${label}`);
  const button = (name, glyph) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'ui-button ui-button--quiet';
    el.setAttribute('aria-label', name); el.title = name;
    if (window.icon) el.innerHTML = window.icon(glyph); else el.textContent = name;
    return el;
  };
  const play = button('Reproducir', 'play'), mute = button('Activar sonido', 'volumeOff'), full = button('Pantalla completa', 'fit');
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '0.1'; seek.value = '0';
  seek.setAttribute('aria-label', 'Posición del video');
  const clock = document.createElement('output'); clock.className = 'ui-player-clock ui-figure';
  const status = document.createElement('p'); status.className = 'ui-player-status'; status.setAttribute('role', 'status'); status.hidden = true;
  controls.append(play, clock, seek, mute, full); wrapper.append(controls, status);
  const listeners = [], listen = (node, event, callback) => { node.addEventListener(event, callback); listeners.push(() => node.removeEventListener(event, callback)); };
  const relabel = (node, text, glyph) => { node.setAttribute('aria-label', text); node.title = text; if (window.icon) node.innerHTML = window.icon(glyph); else node.textContent = text; };
  function update() {
    const finite = Number.isFinite(video.duration) && video.duration > 0;
    seek.disabled = !finite; seek.max = finite ? String(video.duration) : '0'; seek.value = String(video.currentTime || 0);
    seek.setAttribute('aria-valuetext', `${fmt.duration(video.currentTime)} de ${finite ? fmt.duration(video.duration) : 'duración desconocida'}`);
    clock.textContent = `${fmt.clock(video.currentTime)} / ${finite ? fmt.clock(video.duration) : '—'}`;
    relabel(play, video.paused ? 'Reproducir' : 'Pausar', video.paused ? 'play' : 'pause');
    relabel(mute, video.muted ? 'Activar sonido' : 'Silenciar', video.muted ? 'volumeOff' : 'volume');
    mute.setAttribute('aria-pressed', String(video.muted));
    relabel(full, document.fullscreenElement === wrapper ? 'Salir de pantalla completa' : 'Pantalla completa', 'fit');
  }
  async function toggle() {
    if (!video.paused) { video.pause(); return; }
    try { await video.play(); status.hidden = true; }
    catch { status.textContent = 'No se pudo reproducir. Inténtalo de nuevo.'; status.hidden = false; }
    update();
  }
  listen(play, 'click', toggle);
  listen(video, 'click', toggle);
  listen(mute, 'click', () => { video.muted = !video.muted; });
  listen(seek, 'input', () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, Math.max(0, Number(seek.value))); });
  listen(full, 'click', async () => {
    try {
      if (document.fullscreenElement === wrapper) await document.exitFullscreen();
      else if (wrapper.requestFullscreen) await wrapper.requestFullscreen();
      else video.webkitEnterFullscreen?.();
    } catch { status.textContent = 'Pantalla completa no disponible.'; status.hidden = false; }
  });
  full.hidden = !wrapper.requestFullscreen && !video.webkitEnterFullscreen;
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'emptied']) listen(video, event, update);
  listen(document, 'fullscreenchange', update);
  listen(video, 'error', () => { status.textContent = 'No se pudo cargar el video.'; status.hidden = false; });
  listen(video, 'waiting', () => { status.textContent = 'Cargando video…'; status.hidden = false; });
  listen(video, 'playing', () => { status.hidden = true; });
  listen(video, 'canplay', () => { status.hidden = true; });
  const api = { element: wrapper, destroy() {
    video.pause(); listeners.forEach(remove => remove()); wrapper.before(video); wrapper.remove();
    video.controls = original.controls; video.playsInline = original.playsInline; players.delete(video);
  } };
  players.set(video, api); update(); return api;
}
