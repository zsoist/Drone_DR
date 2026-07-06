// Splat Lab — SuperSplat (MIT, self-hosted en /supersplat/) integrado al shell.
// Picker de splats del vault → editor embebido. Flujo: limpiar floaters / crop /
// transformar → File > Export → descarga local (re-subida versionada: próximo reto).
const main = renderShell('splatlab.html');
main.classList.add('lab-main');

(async () => {
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  const splats = sys.splats || [];
  const models = sys.models || [];
  const title = s => {
    const m = models.find(x => x.clip_id === s.clip_id);
    if (m && m.title) return m.title;
    const ts = (s.clip_id.split('_')[1] || '');
    return ts ? `${fmt.date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`)} · ${ts.slice(8, 10)}:${ts.slice(10, 12)}` : s.clip_id;
  };
  const editorUrl = s =>
    `/supersplat/?load=${encodeURIComponent('/data/splats/' + s.name)}&filename=${encodeURIComponent(s.name)}`;

  main.innerHTML = `
    <div class="deck-greet mono" style="margin-bottom:2px">edición de gaussian splats · SuperSplat</div>
    <div class="lab-bar">
      <h1 class="lab-h">Splat Lab</h1>
      <div class="lab-picker" id="lab-picker">
        ${splats.map((s, i) => `
          <button class="chip ${i === 0 ? 'on' : ''}" data-i="${i}" title="${esc(s.name)}">
            ${esc(title(s))} <span class="mono" style="opacity:.6">${(s.bytes / 1e6).toFixed(1)}MB</span>
          </button>`).join('') || '<span class="footer-note">Sin splats aún — entrena uno en el tab 3D.</span>'}
      </div>
      <span class="spacer" style="flex:1"></span>
      <a class="btn" id="lab-full" target="_blank" title="Abrir el editor a pantalla completa">${icon('ext')} Completo</a>
    </div>
    <div class="lab-frame-wrap">
      <iframe id="lab-frame" class="lab-frame" allow="fullscreen"
        title="SuperSplat editor"></iframe>
    </div>
    <p class="footer-note lab-tip">Selecciona splats con el pincel o el lazo y bórralos para limpiar
      floaters · recorta con la caja de crop · <b>File → Export</b> descarga el resultado
      (.ply/.splat/comprimido). El original del vault no se toca.</p>`;

  const frame = document.getElementById('lab-frame');
  const full = document.getElementById('lab-full');
  const load = i => {
    const s = splats[i];
    if (!s) return;
    frame.src = editorUrl(s);
    full.href = editorUrl(s);
    document.querySelectorAll('#lab-picker .chip').forEach((c, j) => c.classList.toggle('on', j === i));
  };
  document.getElementById('lab-picker').addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) load(+b.dataset.i);
  });
  if (splats.length) load(0);
})();
