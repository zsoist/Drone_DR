// Inicio — flight deck v5: dron interactivo con acrobacias, cielo vivo (nubes/hojas/viento),
// arte especial por card (nube de puntos 3D, globo, dúo de drones), smash cósmico.
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
  const durH = flights.reduce((a, f) => a + (f.duration_s || 0), 0);
  const kmT = flights.reduce((a, f) => a + (f.stats?.distance_m || 0), 0);
  const last = [...flights].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
  const byDate = [...flights].sort((a, b) => b.date.localeCompare(a.date));
  const firstDate = byDate[byDate.length - 1]?.date, lastDate = byDate[0]?.date;

  const h = new Date().getHours();
  const saludo = h < 6 ? 'Vuelos nocturnos' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';

  const thumb = f => f ? `${DATA}/thumbs/${f.clip_id}.jpg` : '';
  const otherDay = byDate.find(f => f.date !== last?.date) || byDate[1];
  const ortho = models[0] ? `data/models/${models[0].clip_id}/${models[0].ortho_asset || 'ortho.jpg'}` : '';
  const photo = (sys.photos || [])[0] ? `/data/photos/${encodeURIComponent(sys.photos[0].name)}` : '';

  // texto útil + chips de datos reales; media = capa especial (cloud/globe/drones)
  const SECTIONS = [
    { href: 'index.html', ic: 'grid', ac: '#4da3ff', t: 'Vuelos', wide: true,
      d: 'Reproduce con scrub instantáneo, filtra por lugar o fecha, y salta al mapa, al análisis AI o al 3D de cada vuelo.',
      chips: [`${flights.length} clips`, fmt.hours(durH) + ' en el aire', fmt.km(kmT), `${withVideo} streaming`],
      img: thumb(last) },
    { href: 'trips.html', ic: 'pin', ac: '#3ddc97', t: 'Viajes', media: 'globe',
      d: 'Tus vuelos agrupados por ciudad, con diarios por fecha y postales listas para compartir.',
      chips: [`${days} días`, `${fmt.date(firstDate)} → ${fmt.date(lastDate)}`],
      img: thumb(otherDay) },
    { href: 'tresd.html', ic: 'cube', ac: '#ff9f43', t: '3D', media: 'cloud',
      d: 'Ortomosaicos con medición de volumen y perfiles, mallas texturizadas y gaussian splats.',
      chips: [`${models.length} modelos`, `${splats.length} splats`, '~5 cm/px'],
      img: ortho },
    { href: 'drone.html', ic: 'drone', ac: '#38d9e5', t: 'Dron', media: 'fleet',
      d: 'Escanea la micro SD, importa con verificación de tamaño y libera espacio con un toque.',
      chips: [sys.last_ingest ? `${sys.last_ingest.files} archivos` : 'SD lista', 'DJI Flip · Neo 2'],
      img: thumb(byDate[2]) },
    { href: 'studio.html', ic: 'film', ac: '#b78cff', t: 'Studio',
      d: 'Timeline multi-clip con razor, color por corte, títulos y export hasta 4K.',
      chips: [`${(sys.reels || []).length} reels`, `${(sys.photos || []).length} fotos`, '15 transiciones'],
      img: photo },
    { href: 'subir.html', ic: 'dl', ac: '#ff7eb0', t: 'Subir',
      d: 'Suelta cualquier video DJI: el proxy, la telemetría y el análisis salen solos.',
      chips: ['arrastra y suelta', 'hasta 25 GB'],
      img: thumb(byDate[3]) },
    { href: 'system.html', ic: 'db', ac: '#8fa3c0', t: 'Sistema',
      d: 'Cola de trabajos en vivo, bóveda por tipo de dato y papelera restaurable.',
      chips: [fmt.gb(vaultBytes), 'papelera segura'],
      img: thumb(byDate[4]) },
  ];

  // dron héroe v5: cuerpo con gradiente, guardas, tren, props y LEDs — interactivo
  const DRONE = `
    <svg class="fly-drone v5" id="hero-drone" viewBox="0 0 140 70" data-tip="Tócame">
      <defs><linearGradient id="dbody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a4656"/><stop offset="1" stop-color="#161c26"/>
      </linearGradient></defs>
      <circle class="guard" cx="22" cy="16" r="15"/><circle class="guard" cx="118" cy="16" r="15"/>
      <g class="rotor r1"><ellipse cx="22" cy="16" rx="12.5" ry="2.6"/></g>
      <g class="rotor r2"><ellipse cx="118" cy="16" rx="12.5" ry="2.6"/></g>
      <path class="arm" d="M28 20L56 30M112 20L84 30"/>
      <rect class="body" x="52" y="26" width="36" height="15" rx="7" fill="url(#dbody)"/>
      <rect class="visor" x="57" y="29" width="14" height="5" rx="2.5"/>
      <circle class="cam" cx="66" cy="46" r="5.5"/><circle class="cam-i" cx="66" cy="46" r="2.2"/>
      <path class="leg" d="M58 41l-4 8M82 41l4 8"/>
      <circle class="led l1" cx="55" cy="33" r="1.8"/><circle class="led l2" cx="85" cy="33" r="1.8"/>
    </svg>`;

  main.innerHTML = `
    <div class="deck-sky" aria-hidden="true">
      <i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>
      <i class="wind w1"></i><i class="wind w2"></i><i class="wind w3"></i><i class="wind w4"></i>
      <i class="leaf lf1"></i><i class="leaf lf2"></i><i class="leaf lf3"></i><i class="leaf lf4"></i>
      <i class="dust d1"></i><i class="dust d2"></i><i class="dust d3"></i><i class="dust d4"></i><i class="dust d5"></i><i class="dust d6"></i><i class="dust d7"></i><i class="dust d8"></i>
    </div>

    <div class="deck-hero rise">
      <div class="hero-flight" id="hero-flight">${DRONE}<i class="fly-trail"></i></div>
      <div class="deck-greet mono">${saludo} · ${fmt.date(new Date().toISOString().slice(0, 10))}</div>
      <h1 class="deck-title v5">Flight <em>Deck</em></h1>
      <p class="deck-sub">Todo lo que vuelas, bajo tu mando. Elige tu camino.</p>
      <div class="deck-jobs" id="deck-jobs"></div>
    </div>

    <h2 class="deck-h rise" style="animation-delay:80ms">Explora</h2>
    <div class="deck-grid v4" id="deck-grid">
      ${SECTIONS.map((s, i) => `
        <a class="deck-card dc4 dc5 ${s.wide ? 'wide' : ''}" href="${s.href}"
           style="--ac:${s.ac};animation-delay:${110 + i * 55}ms">
          ${s.img ? `<span class="dc-art" style="background-image:url('${s.img}')"></span>` : `<span class="dc-art dc-art-ic">${icon(s.ic)}</span>`}
          <span class="dc-shade"></span>
          <span class="dc-glare"></span>
          ${s.media === 'cloud' ? '<canvas class="dc-cloud"></canvas>' : ''}
          ${s.media === 'globe' ? `
            <svg class="dc-globe" viewBox="0 0 100 100">
              <circle class="g-out" cx="50" cy="50" r="43"/>
              <ellipse class="g-par" cx="50" cy="50" rx="43" ry="15"/>
              <ellipse class="g-par p2" cx="50" cy="50" rx="36" ry="8"/>
              <ellipse class="g-mer m1" cx="50" cy="50" rx="43" ry="43"/>
              <ellipse class="g-mer m2" cx="50" cy="50" rx="43" ry="43"/>
              <ellipse class="g-mer m3" cx="50" cy="50" rx="43" ry="43"/>
              <circle class="g-dot gd1" cx="38" cy="42" r="2.4"/>
              <circle class="g-dot gd2" cx="60" cy="58" r="2"/>
            </svg>` : ''}
          ${s.media === 'fleet' ? `
            <svg class="dc-fleet" viewBox="0 0 160 70">
              <g class="fd big">
                <circle class="guard" cx="16" cy="14" r="12"/><circle class="guard" cx="84" cy="14" r="12"/>
                <g class="rotor"><ellipse cx="16" cy="14" rx="10" ry="2.2"/></g>
                <g class="rotor"><ellipse cx="84" cy="14" rx="10" ry="2.2"/></g>
                <path class="arm" d="M21 18l17 8M79 18l-17 8"/>
                <rect class="body" x="36" y="22" width="28" height="12" rx="6"/>
                <circle class="cam" cx="50" cy="38" r="4"/>
              </g>
              <g class="fd small">
                <g class="rotor"><ellipse cx="118" cy="34" rx="7" ry="1.8"/></g>
                <g class="rotor"><ellipse cx="152" cy="34" rx="7" ry="1.8"/></g>
                <path class="arm" d="M121 37l10 5M149 37l-10 5"/>
                <rect class="body" x="128" y="40" width="16" height="8" rx="4"/>
              </g>
            </svg>` : ''}
          <span class="dc-body">
            <span class="dc-head">
              <span class="dc-ic5">${icon(s.ic)}</span>
              <span class="dc-t">${s.t}</span>
            </span>
            <span class="dc-d">${s.d}</span>
            <span class="dc-chips">${s.chips.map(c => `<span class="gchip">${esc(c)}</span>`).join('')}</span>
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

  // ---- dron interactivo: click = acrobacia aleatoria ----
  const drone = document.getElementById('hero-drone');
  const TRICKS = ['trick-roll', 'trick-dip', 'trick-spin', 'trick-boost'];
  drone.addEventListener('click', e => {
    e.preventDefault();
    if (drone._busy) return;
    drone._busy = true;
    const t = TRICKS[Math.floor(Math.random() * TRICKS.length)];
    drone.classList.add(t);
    drone.addEventListener('animationend', function done(ev) {
      if (!ev.animationName.startsWith('drone-')) return;
      drone.classList.remove(t);
      drone._busy = false;
      drone.removeEventListener('animationend', done);
    });
  });

  // ---- nube de puntos 3D en la card de 3D (canvas, rotación suave) ----
  document.querySelectorAll('.dc-cloud').forEach(cv => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => { cv.width = cv.offsetWidth * dpr; cv.height = cv.offsetHeight * dpr; };
    fit();
    const ctx = cv.getContext('2d');
    const N = 240, pts = [];
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 2, z = (Math.random() - 0.5) * 2;
      pts.push({ x, z, y: (Math.sin(x * 2.6) + Math.cos(z * 2.2)) * 0.16 + (Math.random() - 0.5) * 0.07 });
    }
    let a = 0;
    (function frame() {
      if (!cv.isConnected) return;
      a += 0.0038;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const s = Math.sin(a), c = Math.cos(a);
      for (const p of pts) {
        const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
        const pr = 1.6 / (2.6 + z);
        const X = W / 2 + x * W * 0.62 * pr;
        const Y = H * 0.48 + p.y * H * 2.2 * pr + z * H * 0.1;
        ctx.fillStyle = `rgba(255,159,67,${(0.2 + 0.6 * pr).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(X, Y, Math.max(0.7, 3.4 * pr * dpr), 0, 7); ctx.fill();
      }
      requestAnimationFrame(frame);
    })();
  });

  // ---- tilt 3D + glare (hover) ----
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

  // ---- smash v3: squash + onda + partículas + AGUJERO CÓSMICO (adiós flash beige) ----
  document.getElementById('deck-grid').addEventListener('click', e => {
    const card = e.target.closest('.deck-card');
    if (!card) return;
    e.preventDefault();
    if (card._busy) return;
    card._busy = true;
    card.classList.add('smash');
    const r = card.getBoundingClientRect();
    const cx = (e.clientX || r.left + r.width / 2), cy = (e.clientY || r.top + r.height / 2);
    const ring = document.createElement('span');
    ring.className = 'dc-ring';
    ring.style.left = `${cx - r.left}px`; ring.style.top = `${cy - r.top}px`;
    card.appendChild(ring);
    const host = document.createElement('span');
    host.className = 'dc-burst';
    host.style.left = `${cx - r.left}px`; host.style.top = `${cy - r.top}px`;
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('i');
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      p.style.animationDelay = `${Math.random() * 80}ms`;
      host.appendChild(p);
    }
    card.appendChild(host);
    // agujero cósmico: velo oscuro con estrellas que absorbe la pantalla desde el click
    const veil = document.createElement('div');
    veil.className = 'nav-veil v3';
    veil.style.setProperty('--ac', getComputedStyle(card).getPropertyValue('--ac'));
    veil.style.setProperty('--cx', `${cx}px`);
    veil.style.setProperty('--cy', `${cy}px`);
    for (let i = 0; i < 14; i++) {
      const st = document.createElement('i');
      st.style.left = `${Math.random() * 100}%`;
      st.style.top = `${Math.random() * 100}%`;
      st.style.animationDelay = `${Math.random() * 200}ms`;
      veil.appendChild(st);
    }
    document.body.appendChild(veil);
    // rAF no dispara con tab oculto (patrón del repo)
    (document.hidden ? fn => setTimeout(fn, 16) : requestAnimationFrame.bind(window))(() => veil.classList.add('on'));
    setTimeout(() => { location.href = card.getAttribute('href'); }, 500);
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
