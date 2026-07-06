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
    { href: 'drone.html?via=subir', ic: 'dl', ac: '#ff7eb0', t: 'Subir',
      d: 'Suelta cualquier video DJI: el proxy, la telemetría y el análisis salen solos.',
      chips: ['arrastra y suelta', 'hasta 25 GB'],
      img: thumb(byDate[3]) },
    { href: 'system.html', ic: 'db', ac: '#8fa3c0', t: 'Sistema',
      d: 'Cola de trabajos en vivo, bóveda por tipo de dato y papelera restaurable.',
      chips: [fmt.gb(vaultBytes), 'papelera segura'],
      img: thumb(byDate[4]) },
  ];

  // dron héroe v6: modelo detallado con gimbal estabilizado, props con blur, LEDs y tren.
  // El vuelo (posición, banking, giro) lo maneja un motor de física en JS.
  const DRONE = `
    <svg class="fly-drone v6" id="hero-drone" viewBox="0 0 170 104" data-tip="Tócame — vuela conmigo">
      <defs>
        <linearGradient id="dbody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#48566a"/><stop offset=".5" stop-color="#2b3444"/><stop offset="1" stop-color="#12171f"/>
        </linearGradient>
        <linearGradient id="dcanopy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fb6e6"/><stop offset="1" stop-color="#2b5f9c"/>
        </linearGradient>
        <radialGradient id="ddisc" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#7fb4ff" stop-opacity=".05"/>
          <stop offset=".75" stop-color="#7fb4ff" stop-opacity=".22"/>
          <stop offset="1" stop-color="#7fb4ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <!-- brazos -->
      <path class="arm" d="M64 58L40 36M106 58L130 36"/>
      <!-- hélices izq/der: disco de blur + aspas girando -->
      <circle class="guard" cx="40" cy="34" r="21"/>
      <circle class="disc" cx="40" cy="34" r="20" fill="url(#ddisc)"/>
      <g class="prop" style="transform-origin:40px 34px"><rect x="20" y="32.6" width="40" height="2.8" rx="1.4"/><rect x="38.6" y="14" width="2.8" height="40" rx="1.4"/></g>
      <circle class="hub" cx="40" cy="34" r="3"/>
      <circle class="guard" cx="130" cy="34" r="21"/>
      <circle class="disc" cx="130" cy="34" r="20" fill="url(#ddisc)"/>
      <g class="prop" style="transform-origin:130px 34px"><rect x="110" y="32.6" width="40" height="2.8" rx="1.4"/><rect x="128.6" y="14" width="2.8" height="40" rx="1.4"/></g>
      <circle class="hub" cx="130" cy="34" r="3"/>
      <!-- tren de aterrizaje -->
      <path class="leg" d="M70 70l-8 16M100 70l8 16M56 86h16M98 86h16"/>
      <!-- fuselaje -->
      <rect class="body" x="58" y="50" width="54" height="24" rx="11" fill="url(#dbody)"/>
      <rect class="canopy" x="66" y="53" width="26" height="9" rx="4.5" fill="url(#dcanopy)"/>
      <path class="antenna" d="M62 50l-3-9M108 50l3-9"/>
      <!-- gimbal + cámara (se mantiene nivelado: rotación por JS) -->
      <g id="d-gimbal">
        <path class="gmount" d="M85 74v6"/>
        <circle class="gball" cx="85" cy="87" r="7.5"/>
        <circle class="glens" cx="85" cy="87" r="3.4"/>
        <circle class="gspec" cx="83" cy="85" r="1.1"/>
      </g>
      <!-- LEDs: verde adelante, rojo atrás -->
      <circle class="led fwd" cx="62" cy="62" r="2.1"/>
      <circle class="led aft" cx="108" cy="62" r="2.1"/>
    </svg>`;

  main.innerHTML = `
    <div class="deck-sky" aria-hidden="true">
      <i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>
      <i class="wind w1"></i><i class="wind w2"></i><i class="wind w3"></i><i class="wind w4"></i>
      <i class="leaf lf1"></i><i class="leaf lf2"></i><i class="leaf lf3"></i><i class="leaf lf4"></i>
      <i class="dust d1"></i><i class="dust d2"></i><i class="dust d3"></i><i class="dust d4"></i><i class="dust d5"></i><i class="dust d6"></i><i class="dust d7"></i><i class="dust d8"></i>
    </div>

    <div class="deck-hero rise">
      <div class="hero-air" id="hero-air">${DRONE}</div>
      <div class="deck-greet mono">${saludo} · ${fmt.date(new Date().toISOString().slice(0, 10))}</div>
      <h1 class="deck-title v6" id="deck-title">Flight <em>Deck</em></h1>
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

  // ---- motor de vuelo del dron: resorte hacia un objetivo, banking, gimbal, giro ----
  const drone = document.getElementById('hero-drone');
  const air = document.getElementById('hero-air');
  const gimbal = drone.querySelector('#d-gimbal');
  const titleEl = document.getElementById('deck-title');
  const clmp = (v, a, b) => Math.max(a, Math.min(b, v));
  const D = { x: 130, y: 60, vx: 70, vy: 0, face: 1, faceT: 1, lean: 0,
              tx: 130, ty: 60, hover: false, trick: 0, t: 0, over: false };

  const airBox = () => air.getBoundingClientRect();
  // objetivo de crucero: patrulla lateral con onda vertical suave
  function cruise(now) {
    const b = airBox();
    const px = Math.sin(now * 0.00019) * 0.5 + 0.5;            // 0..1 vaivén
    D.tx = 46 + px * Math.max(60, b.width - 92);
    D.ty = b.height * 0.46 + Math.sin(now * 0.0013) * Math.min(30, b.height * 0.3);
  }
  // seguir el cursor cuando el ratón está sobre el héroe (interactivo)
  const hero = air.closest('.deck-hero');
  hero.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const b = airBox();
    D.hover = true; D.tx = clmp(e.clientX - b.left, 20, b.width - 20); D.ty = clmp(e.clientY - b.top, 8, b.height - 8);
  });
  hero.addEventListener('pointerleave', () => { D.hover = false; });
  drone.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); if (D.trick <= 0) D.trick = 1; });

  let flyLast = 0, flyRaf = 0;
  function frame(now) {
    if (!drone.isConnected) { flyRaf = 0; return; }
    const dt = flyLast ? Math.min(0.05, (now - flyLast) / 1000) : 0.016; flyLast = now;
    D.t += dt;
    if (!D.hover) cruise(now);
    // resorte hacia el objetivo (más firme al seguir el cursor)
    const K = D.hover ? 46 : 19, DP = D.hover ? 9.5 : 6.2;
    D.vx += ((D.tx - D.x) * K - D.vx * DP) * dt;
    D.vy += ((D.ty - D.y) * K - D.vy * DP) * dt;
    D.x += D.vx * dt; D.y += D.vy * dt;
    // giro suave hacia la dirección de avance (al cruzar 0 se ve de canto = otro ángulo)
    if (D.vx > 14) D.faceT = 1; else if (D.vx < -14) D.faceT = -1;
    D.face += (D.faceT - D.face) * Math.min(1, dt * 5.5);
    // lean: nariz hacia el avance, corrige por ascenso
    const leanT = clmp(Math.abs(D.vx) * 0.055, 0, 19) * Math.sign(D.vx || 1) + clmp(D.vy * 0.03, -8, 8);
    D.lean += (leanT - D.lean) * Math.min(1, dt * 9);
    // truco: rizo de 360° al hacer click
    if (D.trick > 0) D.trick = Math.max(0, D.trick - dt / 0.85);
    const roll = D.trick > 0 ? (1 - D.trick) * 360 * (D.face < 0 ? -1 : 1) : 0;
    const bob = Math.sin(D.t * 3.4) * 1.5;
    const speed = Math.hypot(D.vx, D.vy);
    drone.style.transform =
      `translate(${D.x.toFixed(1)}px,${(D.y + bob).toFixed(1)}px) translate(-50%,-50%) scaleX(${D.face.toFixed(3)}) rotate(${(D.lean + roll).toFixed(1)}deg)`;
    // gimbal contra-rota el lean (la cámara se mantiene nivelada) — no el truco
    gimbal.setAttribute('transform', `rotate(${(-D.lean * 0.85).toFixed(1)} 85 74)`);
    drone.style.setProperty('--spin', `${(0.16 - clmp(speed * 0.0004, 0, 0.09)).toFixed(3)}s`);
    // ráfaga en el título cuando el dron cruza por encima
    if (titleEl) {
      const tb = titleEl.getBoundingClientRect(), ab = airBox();
      const sx = ab.left + D.x, sy = ab.top + D.y;
      const over = sx > tb.left - 24 && sx < tb.right + 24 && sy < tb.bottom + 34 && sy > tb.top - 60;
      if (over && !D.over) { titleEl.classList.remove('gust'); void titleEl.offsetWidth; titleEl.classList.add('gust'); }
      D.over = over;
    }
    flyRaf = requestAnimationFrame(frame);
  }
  // primer render sincrónico: coloca el dron en su carril (evita el flash en 0,0 antes del 1er frame)
  (function prime() {
    const b = airBox();
    D.x = b.width * 0.7; D.y = b.height * 0.42; D.tx = D.x; D.ty = D.y;
    drone.style.transform = `translate(${D.x.toFixed(1)}px,${D.y.toFixed(1)}px) translate(-50%,-50%) scaleX(1) rotate(0deg)`;
    drone.style.setProperty('--spin', '0.16s');
  })();
  const flyStart = () => { if (!flyRaf) { flyLast = 0; flyRaf = requestAnimationFrame(frame); } };
  const flyStop = () => { if (flyRaf) { cancelAnimationFrame(flyRaf); flyRaf = 0; } };
  document.addEventListener('visibilitychange', () => document.hidden ? flyStop() : flyStart());
  flyStart();

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
