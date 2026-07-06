// Inicio — flight deck: portal de la app. Cards premium con visual real,
// flip del título, física de click (bounce + partículas) y copy directo.
const main = renderShell('home.html');

(async () => {
  const flights = await getFlights();
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}

  const days = new Set(flights.map(f => f.date)).size;
  const models = sys.models || [];
  const splats = sys.splats || [];
  const vaultBytes = Object.values(sys.storage || {}).reduce((a, b) => a + b, 0);
  const withVideo = flights.filter(f => f.has_proxy).length;
  const last = [...flights].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];

  const h = new Date().getHours();
  const saludo = h < 6 ? 'Vuelos nocturnos' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';

  // visual real por sección: miniaturas y ortos que ya existen en la bóveda
  const thumb = f => f ? `${DATA}/thumbs/${f.clip_id}.jpg` : '';
  const byDate = [...flights].sort((a, b) => b.date.localeCompare(a.date));
  const otherDay = byDate.find(f => f.date !== last?.date) || byDate[1];
  const ortho = models[0] ? `data/models/${models[0].clip_id}/${models[0].ortho_asset || 'ortho.jpg'}` : '';
  const photo = (sys.photos || [])[0] ? `/data/photos/${encodeURIComponent(sys.photos[0].name)}` : '';

  // copy directo, sin relleno. verb = cara trasera del flip del título.
  const SECTIONS = [
    { href: 'index.html', ic: 'grid', ac: '#4da3ff', t: 'Vuelos', verb: 'Explora',
      metric: `${flights.length}`, sub: `${flights.length} clips · ${withVideo} con streaming`,
      d: 'El archivo completo. Cada vuelo, cada metro.', img: thumb(last) },
    { href: 'trips.html', ic: 'pin', ac: '#3ddc97', t: 'Viajes', verb: 'Viaja',
      metric: `${days}`, sub: `${days} días de vuelo`,
      d: 'Las ciudades, vistas desde arriba.', img: thumb(otherDay) },
    { href: 'tresd.html', ic: 'cube', ac: '#ff9f43', t: '3D', verb: 'Entra',
      metric: `${models.length + splats.length}`, sub: `${models.length} modelos · ${splats.length} splats`,
      d: 'La realidad, reconstruida.', img: ortho },
    { href: 'drone.html', ic: 'drone', ac: '#38d9e5', t: 'Dron', verb: 'Prepara',
      metric: sys.last_ingest ? `${sys.last_ingest.files}` : '', sub: sys.last_ingest ? `último ingest: ${sys.last_ingest.files} archivos` : 'SD y flota',
      d: 'La SD limpia. Siempre lista.', img: thumb(byDate[2]) },
    { href: 'studio.html', ic: 'film', ac: '#b78cff', t: 'Studio', verb: 'Crea',
      metric: `${(sys.reels || []).length + (sys.photos || []).length}`, sub: `${(sys.reels || []).length} reels · ${(sys.photos || []).length} fotos`,
      d: 'Corta. Pule. Publica.', img: photo },
    { href: 'subir.html', ic: 'dl', ac: '#ff7eb0', t: 'Subir', verb: 'Sube',
      metric: '', sub: 'ingesta directa',
      d: 'Trae el material. El pipeline hace el resto.', img: '' },
    { href: 'system.html', ic: 'db', ac: '#8fa3c0', t: 'Sistema', verb: 'Vigila',
      metric: fmt.gb(vaultBytes), sub: `${fmt.gb(vaultBytes)} en bóveda`,
      d: 'La sala de máquinas.', img: '' },
  ];

  main.innerHTML = `
    <div class="deck-hero rise">
      <div class="deck-greet mono">${saludo} · ${fmt.date(new Date().toISOString().slice(0, 10))}</div>
      <h1 class="deck-title">Flight <em>Deck</em></h1>
      <p class="deck-sub">Todo lo que vuelas, bajo tu mando. Elige tu camino.</p>
      <div class="deck-jobs" id="deck-jobs"></div>
    </div>

    <h2 class="deck-h rise" style="animation-delay:80ms">Explora</h2>
    <div class="deck-grid" id="deck-grid">
      ${SECTIONS.map((s, i) => `
        <a class="deck-card dc3" href="${s.href}" style="--ac:${s.ac};animation-delay:${110 + i * 55}ms">
          ${s.img ? `<span class="dc-img" style="background-image:url('${s.img}')"></span><span class="dc-scrim"></span>` : ''}
          <span class="dc-sheen"></span>
          <span class="dc-ic">${icon(s.ic)}</span>
          <span class="dc-flip"><span class="dc-face dc-front">${s.t}</span><span class="dc-face dc-back" style="color:${s.ac}">${s.verb} ${icon('chevR')}</span></span>
          ${s.metric ? `<span class="dc-metric">${s.metric}</span>` : ''}
          <span class="dc-sub mono">${esc(s.sub)}</span>
          <span class="dc-d">${s.d}</span>
          <span class="dc-arrow">${icon('ext')}</span>
        </a>`).join('')}
    </div>

    ${last ? `
    <h2 class="deck-h rise" style="animation-delay:180ms">Último vuelo</h2>
    <a class="card scrub deck-last rise" href="flight.html?id=${last.clip_id}"
       data-cid="${last.clip_id}" data-frames="${last.frame_count || 0}" style="animation-delay:220ms">
      <div class="thumb">
        <img src="${DATA}/thumbs/${last.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
        <span class="ovl mono">${icon('clock')} ${fmt.dur(last.duration_s)}</span>
        ${last.has_proxy ? `<span class="play-badge">${icon('play')}</span>` : ''}
        <span class="scrub-line"></span>
      </div>
      <div class="body">
        <div class="t"><span>${fmt.date(last.date)} · ${last.time || ''}</span>
          <span class="gchip">${esc(last.tier)}</span></div>
        <div class="metrics">
          <span>${icon('route')}<b>${fmt.km(last.stats?.distance_m || 0)}</b></span>
          <span>${icon('mountain')}<b>${Math.round(last.stats?.max_rel_alt_m || 0)} m</b></span>
          <span>${icon('gauge')}<b>${last.resolution || ''}</b></span>
        </div>
        ${last.ai?.summary ? `<p class="ai-line">${esc(last.ai.summary)}</p>` : ''}
      </div>
    </a>` : ''}

    ${sys.storage ? `
    <h2 class="deck-h rise" style="animation-delay:240ms">Bóveda</h2>
    <div class="glass deck-vault rise" style="animation-delay:280ms">
      <div class="dv-bar">${vaultBar(sys.storage)}</div>
      <div class="dv-legend mono">${vaultLegend(sys.storage)}</div>
      <div class="dv-total">Total <b>${fmt.gb(vaultBytes)}</b> en la bóveda local</div>
    </div>` : ''}`;

  attachScrub(main);
  liveJobs();

  // física de click: bounce + estallido de partículas, luego navega
  document.getElementById('deck-grid').addEventListener('click', e => {
    const card = e.target.closest('.deck-card');
    if (!card) return;
    e.preventDefault();
    if (card._busy) return;
    card._busy = true;
    card.classList.add('smash');
    const r = card.getBoundingClientRect();
    const host = document.createElement('span');
    host.className = 'dc-burst';
    host.style.left = `${(e.clientX || r.left + r.width / 2) - r.left}px`;
    host.style.top = `${(e.clientY || r.top + r.height / 2) - r.top}px`;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('i');
      const a = Math.random() * Math.PI * 2, d = 36 + Math.random() * 52;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      p.style.animationDelay = `${Math.random() * 70}ms`;
      host.appendChild(p);
    }
    card.appendChild(host);
    setTimeout(() => { location.href = card.getAttribute('href'); }, 430);
  });
})();

const VKEYS = [
  ['raw', 'Originales', '#4da3ff'], ['proxies', 'Proxies', '#38d9e5'], ['frames', 'Frames', '#3ddc97'],
  ['splats', 'Splats', '#ff9f43'], ['reels', 'Reels', '#b78cff'], ['thumbs', 'Thumbs', '#8fa3c0'],
];
function vaultBar(st) {
  const tot = Object.values(st).reduce((a, b) => a + b, 0) || 1;
  return VKEYS.filter(([k]) => st[k]).map(([k, , c]) =>
    `<i style="width:${(st[k] / tot * 100).toFixed(2)}%;background:${c}" title="${k}"></i>`).join('');
}
function vaultLegend(st) {
  return VKEYS.filter(([k]) => st[k]).map(([k, lb, c]) =>
    `<span><i style="background:${c}"></i>${lb} ${fmt.gb(st[k])}</span>`).join('');
}

// trabajos activos: solo si hay sesión — falla en silencio
async function liveJobs() {
  try {
    const d = await api('/api/jobs', {});
    const act = (d.jobs || []).filter(j => ['running', 'queued'].includes(j.status));
    if (!act.length) return;
    document.getElementById('deck-jobs').innerHTML =
      `<a class="gchip mint pulse" href="system.html" data-tip="Ver la cola de trabajos">
        ${icon('activity')} ${act.length} ${act.length === 1 ? 'trabajo activo' : 'trabajos activos'}</a>`;
  } catch {}
}
