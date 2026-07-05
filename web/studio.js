// Studio v4 — editor táctil: carrusel de clips, timeline visual arrastrable,
// Momentos AI (1 tap = reel), cortes como cards, barra de export sticky.
const main = renderShell('studio.html');
main.innerHTML = `
  <div class="page-head"><h1>Studio</h1><span class="count">edición y 3D</span></div>

  <div class="panel" style="margin-bottom:16px">
    <div class="ph">${icon('film')} Editor</div>
    <div class="pb">
      <p style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:8px">1 · Elige el clip</p>
      <div class="clip-rail" id="rail"></div>

      <video id="ed-video" controls playsinline webkit-playsinline preload="metadata"
        style="width:100%;max-height:44dvh;background:#000;border-radius:8px;display:none"></video>

      <div id="trange-wrap" style="display:none">
        <p style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3);margin:14px 0 0">2 · Arrastra los bordes para elegir el corte</p>
        <div class="trange" id="trange">
          <div class="bg" id="tr-bg"></div>
          <div class="shade" id="sh-l"></div><div class="shade" id="sh-r"></div>
          <div class="win" id="tr-win"></div>
          <div class="playhead" id="tr-ph"></div>
          <div class="handle" id="h-a"></div><div class="handle" id="h-b"></div>
        </div>
        <div class="trange-times"><span id="t-a">0:00</span><span id="t-len" style="color:var(--text-2)"></span><span id="t-b">0:00</span></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn" id="btn-try">${icon('play')} Probar</button>
          <button class="btn primary big" id="btn-add">Añadir corte</button>
          <select class="ctl" id="ed-speed">
            <option value="0.25">0.25x</option><option value="0.5">0.5x</option>
            <option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option>
          </select>
        </div>
      </div>

      <div class="toolbar" style="margin-top:14px">
        <p style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3)">3 · Tu timeline</p>
        <span class="spacer"></span>
        <button class="btn ai-magic" id="btn-magic">${icon('spark')} Momentos AI</button>
      </div>
      <div id="cuts"></div>
    </div>
  </div>

  <div class="exportbar" id="exportbar" style="display:none">
    <select class="ctl" id="ed-aspect">
      <option value="16:9">16:9</option><option value="9:16">9:16 Reels</option>
      <option value="1:1">1:1</option><option value="4:5">4:5</option>
    </select>
    <select class="ctl" id="ed-lut">
      <option value="none">Sin look</option><option value="cine">Cine</option>
      <option value="vivid">Vivid</option><option value="warm">Cálido</option>
      <option value="moody">Moody</option><option value="bw">B&amp;N</option>
    </select>
    <input class="ctl" id="ed-title" placeholder="Título…" style="flex:1;min-width:110px" maxlength="60">
    <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="ed-fade" checked>Fades</label>
    <button class="btn primary big" id="ed-export">${icon('check')} Exportar</button>
  </div>

  <div class="fl-layout" style="margin-top:16px">
    <div>
      <div class="panel">
        <div class="ph">${icon('film')} Reels y fotos</div>
        <div class="pb" id="reels"><div class="sk" style="height:60px"></div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('activity')} Trabajos</div>
        <div class="pb" id="jobs"></div>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="ph">${icon('cube')} 3D</div>
        <div class="pb">
          <p style="font-size:12.5px;color:var(--text-2)">Fotogrametría ODM y gaussian splats del archivo.</p>
          <a class="btn" href="tresd.html" style="margin-top:10px">${icon('cube')} Abrir 3D</a>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('spark')} Mejores momentos</div>
        <div class="pb" id="moments"><div class="sk" style="height:80px"></div></div>
      </div>
    </div>
  </div>`;

(async () => {
  const flights = await getFlights();
  const ai = await getAIAll(flights);
  const editable = flights.filter(f => f.has_proxy && !f.archived);
  const vid = document.getElementById('ed-video');
  let cur = null, dur = 0, A = 0, B = 8, segs = [];

  // ---- 1: carrusel de clips ----
  document.getElementById('rail').innerHTML = editable.map(f => `
    <div class="cr-item" data-cid="${f.clip_id}">
      <img src="${DATA}/thumbs/${f.clip_id}.jpg" loading="lazy" alt="">
      <span class="cr-lb">${esc(f.label) || fmt.date(f.date)} · ${fmt.dur(f.duration_s)}</span>
    </div>`).join('');
  document.getElementById('rail').addEventListener('click', e => {
    const it = e.target.closest('.cr-item');
    if (it) loadClip(it.dataset.cid);
  });

  // llegada desde la vista de vuelo: ?clip=<id>&a=&b= precarga clip y corte
  const params = new URLSearchParams(location.search);
  const pClip = params.get('clip');
  if (pClip && editable.some(f => f.clip_id === pClip)) {
    setTimeout(() => {
      loadClip(pClip);
      document.querySelector(`.cr-item[data-cid="${pClip}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
      if (params.get('a') != null) {
        A = Math.max(0, +params.get('a'));
        B = Math.min(dur, +params.get('b') || A + 5);
        paintRange();
        vid.currentTime = A;
      }
    }, 100);
  }

  function loadClip(cid) {
    cur = editable.find(f => f.clip_id === cid);
    dur = cur.duration_s;
    A = 0; B = Math.min(8, dur);
    document.querySelectorAll('.cr-item').forEach(i => i.classList.toggle('on', i.dataset.cid === cid));
    vid.src = `${DATA}/proxies/${cid}.mp4`;
    vid.style.display = 'block';
    document.getElementById('trange-wrap').style.display = 'block';
    // fondo del timeline: 8 keyframes repartidos
    const n = cur.frame_count || 0;
    document.getElementById('tr-bg').innerHTML = n
      ? Array.from({ length: 8 }, (_, i) => {
          const fi = Math.max(1, Math.round(((i + 0.5) / 8) * n));
          return `<img src="${DATA}/frames/${cid}/f_${String(fi).padStart(4, '0')}.jpg" alt="">`;
        }).join('')
      : `<div style="flex:1;background:var(--surface-2)"></div>`;
    paintRange();
  }

  // ---- 2: timeline arrastrable (pointer events = touch + mouse) ----
  const tr = document.getElementById('trange');
  const pct = t => `${(t / dur) * 100}%`;
  function paintRange() {
    document.getElementById('sh-l').style.cssText = `left:0;width:${pct(A)}`;
    document.getElementById('sh-r').style.cssText = `right:0;left:${pct(B)}`;
    const w = document.getElementById('tr-win');
    w.style.left = pct(A); w.style.width = pct(B - A);
    document.getElementById('h-a').style.left = pct(A);
    document.getElementById('h-b').style.left = pct(B);
    document.getElementById('t-a').textContent = fmt.dur(A);
    document.getElementById('t-b').textContent = fmt.dur(B);
    document.getElementById('t-len').textContent = `${(B - A).toFixed(1)}s`;
  }
  let drag = null;
  function evT(e) {
    const r = tr.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
  }
  tr.addEventListener('pointerdown', e => {
    const t = evT(e);
    drag = Math.abs(t - A) < Math.abs(t - B) ? 'a' : 'b';
    tr.setPointerCapture(e.pointerId);
    move(t);
  });
  tr.addEventListener('pointermove', e => { if (drag) move(evT(e)); });
  tr.addEventListener('pointerup', () => {
    drag = null;
    vid.currentTime = A;   // al soltar, el video muestra el inicio del corte
  });
  function move(t) {
    if (drag === 'a') A = Math.min(t, B - 0.5);
    else B = Math.max(t, A + 0.5);
    paintRange();
    vid.currentTime = t;   // scrub visual mientras arrastras
  }
  vid.addEventListener('timeupdate', () => {
    document.getElementById('tr-ph').style.left = pct(vid.currentTime);
    if (window._trying && vid.currentTime >= B) { vid.pause(); window._trying = false; }
  });

  document.getElementById('btn-try').addEventListener('click', () => {
    if (!cur) return;
    window._trying = true; vid.currentTime = A; vid.play();
  });
  document.getElementById('btn-add').addEventListener('click', () => {
    if (!cur) return;
    segs.push({ clip_id: cur.clip_id, a: +A.toFixed(1), b: +B.toFixed(1),
                speed: +document.getElementById('ed-speed').value });
    paintCuts();
  });

  // ---- Momentos AI: 1 tap = timeline lleno con los highlights ----
  document.getElementById('btn-magic').addEventListener('click', () => {
    const magic = [];
    editable.forEach(f => (ai[f.clip_id]?.highlights || []).forEach(h =>
      magic.push({ clip_id: f.clip_id, a: Math.max(0, +h.t - 2.5), b: Math.min(f.duration_s, +h.t + 2.5),
                   speed: 1, score: ai[f.clip_id].travel_score || 0 })));
    magic.sort((x, y) => y.score - x.score);
    const top = magic.slice(0, 10);
    top.sort((x, y) => x.clip_id.localeCompare(y.clip_id) || x.a - y.a);
    segs = top;
    paintCuts();
  });

  // ---- 3: cortes como cards ----
  const SPEEDS = [0.25, 0.5, 1, 2, 4];
  const thumbFor = s => {
    const f = editable.find(x => x.clip_id === s.clip_id);
    const n = f?.frame_count || 0;
    const fi = n ? Math.max(1, Math.min(n, Math.round(s.a / 2) + 1)) : 0;
    return fi ? `${DATA}/frames/${s.clip_id}/f_${String(fi).padStart(4, '0')}.jpg` : `${DATA}/thumbs/${s.clip_id}.jpg`;
  };
  function paintCuts() {
    const total = segs.reduce((a, s) => a + (s.b - s.a) / s.speed, 0);
    document.getElementById('cuts').innerHTML = segs.map((s, i) => `
      <div class="cutcard">
        <img src="${thumbFor(s)}" alt="" data-play="${i}" style="cursor:pointer">
        <div class="cc-info"><b>${fmt.dur(s.a)}–${fmt.dur(s.b)}</b><br>${(s.b - s.a).toFixed(1)}s</div>
        <span class="speed-chip" data-speed="${i}">${s.speed}x</span>
        <div class="cc-btns">
          <button data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-dn="${i}" ${i === segs.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-rm="${i}">✕</button>
        </div>
      </div>`).join('') +
      (segs.length ? `<p class="footer-note" style="margin-top:10px">${segs.length} cortes · reel de ${total.toFixed(1)}s</p>` : '<p class="footer-note">Sin cortes aún — usa el timeline o Momentos AI.</p>');
    document.getElementById('exportbar').style.display = segs.length ? 'flex' : 'none';
  }
  paintCuts();
  document.getElementById('cuts').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.play != null) {
      const s = segs[+d.play];
      if (cur?.clip_id !== s.clip_id) loadClip(s.clip_id);
      A = s.a; B = s.b; paintRange();
      setTimeout(() => { window._trying = true; vid.currentTime = A; vid.play(); }, 80);
    }
    if (d.speed != null) {
      const s = segs[+d.speed];
      s.speed = SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length];
      paintCuts();
    }
    if (d.rm != null) { segs.splice(+d.rm, 1); paintCuts(); }
    if (d.up != null) { const i = +d.up; [segs[i - 1], segs[i]] = [segs[i], segs[i - 1]]; paintCuts(); }
    if (d.dn != null) { const i = +d.dn; [segs[i + 1], segs[i]] = [segs[i], segs[i + 1]]; paintCuts(); }
  });

  // look en vivo
  const CSS_LUTS = { none: '', cine: 'contrast(1.07) saturate(1.1) hue-rotate(-6deg)',
    vivid: 'saturate(1.35) contrast(1.1)', warm: 'sepia(0.18) saturate(1.2)',
    moody: 'contrast(1.16) brightness(0.94) saturate(0.82)', bw: 'grayscale(1) contrast(1.2)' };
  document.getElementById('ed-lut').addEventListener('change', e => {
    vid.style.filter = CSS_LUTS[e.target.value] || '';
  });

  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!segs.length) return;
    const token = getToken();
    if (!token) return;
    await api('/api/edit', {
      segments: segs,
      aspect: document.getElementById('ed-aspect').value,
      filter: document.getElementById('ed-lut').value,
      title: document.getElementById('ed-title').value.trim(),
      fade: document.getElementById('ed-fade').checked,
    });
    segs = []; paintCuts();
  });

  // ---- reels + fotos + jobs + momentos ----
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  const reels = sys.reels || [], photos = (sys.photos || []).slice(0, 6);
  document.getElementById('reels').innerHTML =
    (reels.length ? reels.map(r => `
      <div style="margin-bottom:14px">
        <video src="${DATA}/reels/${encodeURIComponent(r.name)}" controls playsinline webkit-playsinline preload="metadata"
          style="width:100%;border-radius:8px;background:#000"></video>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          <span class="mono" style="font-size:12px">${esc(r.name)}</span>
          <a class="mono" href="${DATA}/reels/${encodeURIComponent(r.name)}" download style="font-size:12px;color:var(--accent)">Descargar</a>
        </div>
      </div>`).join('') : `<p class="footer-note">Aún no hay reels.</p>`) +
    (photos.length ? `<p style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3);margin:12px 0 8px">Fotos 4K capturadas</p>
      <div class="gal" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      ${photos.map(p => `<a href="${DATA}/photos/${encodeURIComponent(p.name)}" target="_blank"><img src="${DATA}/photos/${encodeURIComponent(p.name)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px" loading="lazy" alt=""></a>`).join('')}</div>` : '');

  const moments = [];
  flights.forEach(f => (ai[f.clip_id]?.highlights || []).forEach(h =>
    moments.push({ f, h, score: ai[f.clip_id].travel_score || 0 })));
  moments.sort((a, b) => b.score - a.score);
  document.getElementById('moments').innerHTML = moments.slice(0, 6).map(m => `
    <div class="hl-item">
      <a class="tc" href="flight.html?id=${m.f.clip_id}">${fmt.date(m.f.date)} · ${fmt.dur(m.h.t)}</a>
      <p>${esc(m.h.reason)}</p>
    </div>`).join('') || `<p class="footer-note">Corre el análisis AI primero.</p>`;

  pollJobs(document.getElementById('jobs'));
})();
