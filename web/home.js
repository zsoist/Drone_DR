// Inicio — flight deck v4: héroe con dron en vuelo, fondo vivo (viento+partículas),
// cards estilo game-card (arte + tilt 3D + glare) en bento sin huecos, smash pulido.
const main = renderShell('home.html');
main.classList.add('deck-main');

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

  // arte real por sección (bóveda local)
  const thumb = f => f ? `${DATA}/thumbs/${f.clip_id}.jpg` : '';
  const byDate = [...flights].sort((a, b) => b.date.localeCompare(a.date));
  const otherDay = byDate.find(f => f.date !== last?.date) || byDate[1];
  const ortho = models[0] ? `data/models/${models[0].clip_id}/${models[0].ortho_asset || 'ortho.jpg'}` : '';
  const photo = (sys.photos || [])[0] ? `/data/photos/${encodeURIComponent(sys.photos[0].name)}` : '';

  // texto útil de verdad: qué puedes HACER en cada sección
  const SECTIONS = [
    { href: 'index.html', ic: 'grid', ac: '#4da3ff', t: 'Vuelos', wide: true,
      sub: `${flights.length} clips · ${withVideo} con streaming`,
      d: 'Busca cualquier vuelo, reprodúcelo con scrub instantáneo y salta a su mapa, análisis AI o modelo 3D.',
      img: thumb(last) },
    { href: 'trips.html', ic: 'pin', ac: '#3ddc97', t: 'Viajes',
      sub: `${days} días de vuelo`,
      d: 'Tus vuelos agrupados por ciudad y fecha, con postales descargables.',
      img: thumb(otherDay) },
    { href: 'tresd.html', ic: 'cube', ac: '#ff9f43', t: '3D',
      sub: `${models.length} modelos · ${splats.length} splats`,
      d: 'Ortomosaicos medibles, mallas y gaussian splats desde tus tomas.',
      img: ortho },
    { href: 'drone.html', ic: 'drone', ac: '#38d9e5', t: 'Dron',
      sub: sys.last_ingest ? `último ingest: ${sys.last_ingest.files} archivos` : 'SD y flota',
      d: 'Conecta la micro SD: importa verificado, limpia y deja todo listo.',
      img: thumb(byDate[2]) },
    { href: 'studio.html', ic: 'film', ac: '#b78cff', t: 'Studio',
      sub: `${(sys.reels || []).length} reels · ${(sys.photos || []).length} fotos`,
      d: 'Timeline profesional: corta, colorea, pon títulos y exporta a redes.',
      img: photo },
    { href: 'subir.html', ic: 'dl', ac: '#ff7eb0', t: 'Subir',
      sub: 'ingesta directa',
      d: 'Arrastra videos DJI: proxy, telemetría y análisis salen solos.',
      img: thumb(byDate[3]) },
    { href: 'system.html', ic: 'db', ac: '#8fa3c0', t: 'Sistema',
      sub: `${fmt.gb(vaultBytes)} en bóveda`,
      d: 'Bóveda, cola de trabajos, papelera y salud del servidor.',
      img: thumb(byDate[4]) },
  ];

  // dron SVG con rotores girando + LED — vuela por el héroe
  const DRONE = `
    <svg class="fly-drone" viewBox="0 0 120 54" aria-hidden="true">
      <g class="rotor r1"><ellipse cx="18" cy="12" rx="15" ry="3"/></g>
      <g class="rotor r2"><ellipse cx="102" cy="12" rx="15" ry="3"/></g>
      <path class="arm" d="M18 14L48 26M102 14L72 26"/>
      <rect class="body" x="44" y="22" width="32" height="13" rx="6"/>
      <circle class="cam" cx="60" cy="38" r="5"/>
      <circle class="led" cx="74" cy="28" r="2"/>
    </svg>`;

  main.innerHTML = `
    <div class="deck-sky" aria-hidden="true">
      <i class="wind w1"></i><i class="wind w2"></i><i class="wind w3"></i>
      <i class="dust d1"></i><i class="dust d2"></i><i class="dust d3"></i><i class="dust d4"></i><i class="dust d5"></i><i class="dust d6"></i>
    </div>

    <div class="deck-hero rise">
      <div class="hero-flight">${DRONE}<i class="fly-trail"></i></div>
      <div class="deck-greet mono">${saludo} · ${fmt.date(new Date().toISOString().slice(0, 10))}</div>
      <h1 class="deck-title v4">Flight <em>Deck</em></h1>
      <p class="deck-sub">Todo lo que vuelas, bajo tu mando. Elige tu camino.</p>
      <div class="deck-jobs" id="deck-jobs"></div>
    </div>

    <h2 class="deck-h rise" style="animation-delay:80ms">Explora</h2>
    <div class="deck-grid v4" id="deck-grid">
      ${SECTIONS.map((s, i) => `
        <a class="deck-card dc4 ${s.wide ? 'wide' : ''}" href="${s.href}"
           style="--ac:${s.ac};animation-delay:${110 + i * 55}ms">
          ${s.img ? `<span class="dc-art" style="background-image:url('${s.img}')"></span>` : `<span class="dc-art dc-art-ic">${icon(s.ic)}</span>`}
          <span class="dc-shade"></span>
          <span class="dc-glare"></span>
          <span class="dc-ic">${icon(s.ic)}</span>
          <span class="dc-body">
            <span class="dc-t">${s.t}</span>
            <span class="dc-sub mono">${esc(s.sub)}</span>
            <span class="dc-d">${s.d}</span>
            <span class="dc-go">Entrar ${icon('chevR')}</span>
          </span>
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

  // ---- tilt 3D + glare que sigue al cursor (solo dispositivos con hover) ----
  if (matchMedia('(hover:hover)').matches) {
    document.querySelectorAll('.dc4').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
        card.style.setProperty('--gx', `${(x * 100 + 50).toFixed(1)}%`);
        card.style.setProperty('--gy', `${(y * 100 + 50).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  // ---- smash v2: squash + onda expansiva + partículas + velo de transición ----
  document.getElementById('deck-grid').addEventListener('click', e => {
    const card = e.target.closest('.deck-card');
    if (!card) return;
    e.preventDefault();
    if (card._busy) return;
    card._busy = true;
    card.classList.add('smash');
    const r = card.getBoundingClientRect();
    const cx = (e.clientX || r.left + r.width / 2) - r.left;
    const cy = (e.clientY || r.top + r.height / 2) - r.top;
    const ring = document.createElement('span');
    ring.className = 'dc-ring';
    ring.style.left = `${cx}px`; ring.style.top = `${cy}px`;
    card.appendChild(ring);
    const host = document.createElement('span');
    host.className = 'dc-burst';
    host.style.left = `${cx}px`; host.style.top = `${cy}px`;
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('i');
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      p.style.animationDelay = `${Math.random() * 80}ms`;
      host.appendChild(p);
    }
    card.appendChild(host);
    // velo: la página funde suave antes de navegar (adiós corte seco)
    const veil = document.createElement('div');
    veil.className = 'nav-veil';
    veil.style.setProperty('--ac', getComputedStyle(card).getPropertyValue('--ac'));
    document.body.appendChild(veil);
    requestAnimationFrame(() => veil.classList.add('on'));
    setTimeout(() => { location.href = card.getAttribute('href'); }, 480);
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
