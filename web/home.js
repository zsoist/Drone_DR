// Inicio — flight deck: resumen vivo de toda la app con tarjetas de sección.
const main = renderShell('home.html');

(async () => {
  const flights = await getFlights();
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}

  // ---- métricas agregadas ----
  const dur = flights.reduce((a, f) => a + (f.duration_s || 0), 0);
  const dist = flights.reduce((a, f) => a + (f.stats?.distance_m || 0), 0);
  const alt = Math.max(0, ...flights.map(f => f.stats?.max_rel_alt_m || 0));
  const days = new Set(flights.map(f => f.date)).size;
  const models = sys.models || [];
  const splats = sys.splats || [];
  const vaultBytes = Object.values(sys.storage || {}).reduce((a, b) => a + b, 0);
  const withVideo = flights.filter(f => f.has_proxy).length;
  const withAI = flights.filter(f => f.ai).length;
  const last = [...flights].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];

  const h = new Date().getHours();
  const saludo = h < 6 ? 'Vuelos nocturnos' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';

  // ---- tarjetas de sección: acento propio + dato vivo ----
  const SECTIONS = [
    { href: 'index.html', ic: 'grid', ac: '#4da3ff', t: 'Vuelos',
      sub: `${flights.length} clips · ${withVideo} con streaming`, d: 'Galería, lista, mapa, lugares y fechas.' },
    { href: 'trips.html', ic: 'pin', ac: '#3ddc97', t: 'Viajes',
      sub: `${days} días de vuelo`, d: 'Ciudades, postales y diarios por fecha.' },
    { href: 'tresd.html', ic: 'cube', ac: '#ff9f43', t: '3D',
      sub: `${models.length} modelos · ${splats.length} splats`, d: 'Ortomosaicos, mallas y gaussian splats.' },
    { href: 'drone.html', ic: 'drone', ac: '#38d9e5', t: 'Dron',
      sub: sys.last_ingest ? `último ingest: ${sys.last_ingest.files} archivos` : 'SD y flota', d: 'Importa, verifica y limpia la micro SD.' },
    { href: 'studio.html', ic: 'film', ac: '#b78cff', t: 'Studio',
      sub: `${(sys.reels || []).length} reels · ${(sys.photos || []).length} fotos`, d: 'Reels, exportes y edición de fotos.' },
    { href: 'subir.html', ic: 'dl', ac: '#ff7eb0', t: 'Subir',
      sub: 'ingesta manual', d: 'Arrastra videos DJI y procesa el pipeline.' },
    { href: 'system.html', ic: 'db', ac: '#8fa3c0', t: 'Sistema',
      sub: fmt.gb(vaultBytes), d: 'Bóveda, trabajos y salud del servidor.' },
  ];

  const STATS = [
    { ic: 'drone', v: flights.length, lb: 'Vuelos', f: 'int' },
    { ic: 'clock', v: dur, lb: 'En el aire', f: 'hours' },
    { ic: 'route', v: dist, lb: 'Recorridos', f: 'km' },
    { ic: 'mountain', v: alt, lb: 'Alt. máxima', f: 'alt' },
    { ic: 'cube', v: models.length + splats.length, lb: 'Escenas 3D', f: 'int' },
    { ic: 'spark', v: withAI, lb: 'Con análisis AI', f: 'int' },
  ];

  main.innerHTML = `
    <div class="deck-hero rise">
      <div class="deck-greet mono">${saludo} · ${fmt.date(new Date().toISOString().slice(0, 10))}</div>
      <h1 class="deck-title">Flight <em>Deck</em></h1>
      <p class="deck-sub">Tu plataforma de inteligencia de vuelo — DJI Flip · Neo 2 · Bogotá y más allá.</p>
      <div class="deck-jobs" id="deck-jobs"></div>
    </div>

    <div class="deck-stats rise" style="animation-delay:70ms">
      ${STATS.map(s => `
        <div class="dstat">
          <span class="dstat-ic">${icon(s.ic)}</span>
          <b class="dstat-v" data-count="${s.v}" data-fmt="${s.f}">0</b>
          <span class="dstat-lb">${s.lb}</span>
        </div>`).join('')}
    </div>

    <h2 class="deck-h rise" style="animation-delay:120ms">Explora</h2>
    <div class="deck-grid">
      ${SECTIONS.map((s, i) => `
        <a class="deck-card" href="${s.href}" style="--ac:${s.ac};animation-delay:${140 + i * 55}ms">
          <span class="dc-ic">${icon(s.ic)}</span>
          <span class="dc-t">${s.t}</span>
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
          <span class="tierdot ${last.tier}"><i></i>${last.tier}</span></div>
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
      <div class="dv-total">Total <b>${fmt.gb(vaultBytes)}</b> en la SSD · $0/mes</div>
    </div>` : ''}`;

  attachScrub(main);
  countUp(main);
  liveJobs();
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

// contador animado: 0 → valor con ease-out (formato según tipo)
function countUp(root) {
  const F = {
    int: v => Math.round(v).toLocaleString('es'),
    hours: v => fmt.hours(v),
    km: v => fmt.km(v),
    alt: v => `${Math.round(v)} m`,
  };
  root.querySelectorAll('[data-count]').forEach(el => {
    const target = +el.dataset.count, f = F[el.dataset.fmt] || F.int;
    const t0 = performance.now(), D = 900;
    const sched = document.hidden ? fn => setTimeout(fn, 16) : requestAnimationFrame.bind(window);
    (function tick(now) {
      const k = Math.min(1, ((now || performance.now()) - t0) / D);
      el.textContent = f(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) sched(tick);
    })(t0);
  });
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
