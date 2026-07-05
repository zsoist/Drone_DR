// Vuelos: gallery with instant search (incl. AI tags), filters, sort, views.
const main = renderShell('index.html');
let flights = [], ai = {}, state = { q: '', tier: 'all', sort: 'date', view: 'grid', scene: null };

main.innerHTML = `
  <div class="page-head"><h1>Vuelos</h1><span class="count" id="count"></span></div>
  <div class="statgrid" id="stats">${'<div class="sk" style="height:74px"></div>'.repeat(4)}</div>
  <div class="toolbar">
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Buscar por fecha, lugar, tags AI…" autocomplete="off"><kbd>/</kbd></label>
    <select class="ctl" id="tier" aria-label="Filtrar por tier">
      <option value="all">Todos los tiers</option>
      <option value="full">Full — con video</option>
      <option value="standard">Standard</option>
      <option value="skim">Skim</option>
      <option value="archived">Archivados</option>
    </select>
    <select class="ctl" id="sort" aria-label="Ordenar">
      <option value="date">Más recientes</option>
      <option value="dur">Más largos</option>
      <option value="dist">Más distancia</option>
      <option value="alt">Más altura</option>
      <option value="score">Mejor score AI</option>
    </select>
    <div class="seg" role="group" aria-label="Vista">
      <button id="v-grid" class="on" title="Cuadrícula">${icon('grid')}</button>
      <button id="v-list" title="Lista">${icon('list')}</button>
    </div>
  </div>
  <div class="chips" id="scene-chips" style="margin-bottom:14px"></div>
  <div class="grid" id="grid">${'<div class="sk" style="aspect-ratio:16/11"></div>'.repeat(6)}</div>
  <p class="footer-note">Los clips en tier full incluyen video 1080p; standard tienen análisis AI sin proxy; skim solo telemetría. Procesado localmente en el Mac Mini M4.</p>`;

function stats(list) {
  const dist = list.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
  const dur = list.reduce((a, f) => a + f.duration_s, 0);
  const alt = Math.max(0, ...list.map(f => f.stats.max_rel_alt_m || 0));
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="lb">${icon('drone')} Vuelos</div><div class="v">${list.length}</div></div>
    <div class="stat"><div class="lb">${icon('route')} Distancia</div><div class="v">${fmt.km(dist)}</div></div>
    <div class="stat"><div class="lb">${icon('clock')} En el aire</div><div class="v">${fmt.hours(dur)}</div></div>
    <div class="stat"><div class="lb">${icon('mountain')} Alt máx</div><div class="v">${Math.round(alt)}<small> m</small></div></div>`;
}

function matches(f) {
  if (state.tier === 'archived') { if (!f.archived) return false; }
  else if (f.archived) return false;
  if (state.tier !== 'all' && state.tier !== 'archived' && f.tier !== state.tier) return false;
  if (state.scene && ai[f.clip_id]?.scene_type !== state.scene) return false;
  if (!state.q) return true;
  const a = ai[f.clip_id];
  const hay = [f.clip_id, f.date, f.time, f.label, a?.summary, a?.scene_type, ...(a?.tags || [])]
    .join(' ').toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}
const SORTS = {
  date: (a, b) => b.clip_id.localeCompare(a.clip_id),
  dur: (a, b) => b.duration_s - a.duration_s,
  dist: (a, b) => (b.stats.distance_m || 0) - (a.stats.distance_m || 0),
  alt: (a, b) => (b.stats.max_rel_alt_m || 0) - (a.stats.max_rel_alt_m || 0),
  score: (a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0),
};

function card(f) {
  const a = ai[f.clip_id];
  return `
  <a class="card" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
    <div class="thumb">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
      <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
      ${a?.travel_score != null ? `<span class="score-pill">${a.travel_score}/10</span>` : ''}
      <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
      <button class="rename-btn" data-rename="${f.clip_id}" title="Renombrar">${icon('tag')}</button>
    </div>
    <div class="body">
      <div class="t"><span>${f.label || fmt.date(f.date)}</span><time>${f.label ? fmt.date(f.date) + ' ' : ''}${f.time}</time></div>
      <div class="metrics">
        <span>${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b></span>
        <span>${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
        <span>${icon('film')}<b>${f.resolution.split('x')[1]}p${Math.round(f.fps)}</b></span>
      </div>
      ${a?.summary ? `<p class="ai-line">${a.summary}</p>` : ''}
    </div>
  </a>`;
}

function render() {
  const list = flights.filter(matches).sort(SORTS[state.sort]);
  document.getElementById('count').textContent =
    `${list.length} de ${flights.length}` + (state.q ? ` · "${state.q}"` : '');
  const grid = document.getElementById('grid');
  grid.className = `grid ${state.view === 'list' ? 'list' : ''}`;
  grid.innerHTML = list.length ? list.map(card).join('') :
    `<div class="empty" style="grid-column:1/-1">${icon('search')}<p>Sin resultados para esa búsqueda.</p></div>`;
  grid.querySelectorAll('.card').forEach((c, i) => {
    c.style.animation = `cardIn 340ms cubic-bezier(.25,.1,.25,1) both ${Math.min(i * 35, 420)}ms`;
  });
  hoverScrub(grid);
  stats(list);
  // chips de escena (derivados del AI)
  const scenes = [...new Set(flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
  document.getElementById('scene-chips').innerHTML = scenes.map(sc =>
    `<button class="chip ${state.scene === sc ? 'on' : ''}" data-scene="${sc}">${sc}</button>`).join('');
}
document.addEventListener('click', async e => {
  const sc = e.target.closest('[data-scene]');
  if (sc) { state.scene = state.scene === sc.dataset.scene ? null : sc.dataset.scene; render(); }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    e.preventDefault(); e.stopPropagation();
    const token = getToken();
    if (!token) return;
    const f = flights.find(x => x.clip_id === rn.dataset.rename);
    const label = prompt('Nombre para este vuelo:', f?.label || '');
    if (label == null) return;
    await fetch(`/api/clip?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip_id: rn.dataset.rename, label }) });
    f.label = label; render();
  }
}, true);

// hover sobre la card = scrub por los keyframes del clip
function hoverScrub(grid) {
  grid.querySelectorAll('.card').forEach(c => {
    const n = +c.dataset.frames;
    if (!n) return;
    const img = c.querySelector('img');
    const orig = img.src;
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      const i = Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * n));
      img.src = `${DATA}/frames/${c.dataset.cid}/f_${String(i).padStart(4, '0')}.jpg`;
    });
    c.addEventListener('mouseleave', () => { img.src = orig; });
  });
}

document.getElementById('q').addEventListener('input', e => { state.q = e.target.value; render(); });
document.getElementById('tier').addEventListener('change', e => { state.tier = e.target.value; render(); });
document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
document.getElementById('v-grid').addEventListener('click', () => setView('grid'));
document.getElementById('v-list').addEventListener('click', () => setView('list'));
function setView(v) {
  state.view = v;
  document.getElementById('v-grid').classList.toggle('on', v === 'grid');
  document.getElementById('v-list').classList.toggle('on', v === 'list');
  render();
}
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault(); document.getElementById('q').focus();
  }
});

(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) { state.q = params.get('q'); document.getElementById('q').value = state.q; }
  flights = await getFlights();
  render();                       // pinta ya con manifests
  ai = await getAIAll(flights);   // enriquece con AI cuando llegue
  render();
})().catch(e => {
  main.querySelector('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('warn')}<p>Error: ${e.message}</p></div>`;
});
