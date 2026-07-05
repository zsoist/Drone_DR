// Studio: editor de cortes, reels generados, mejores momentos, y modelos 3D.
const main = renderShell('studio.html');
main.innerHTML = `
  <div class="page-head"><h1>Studio</h1><span class="count">edición y 3D</span></div>
  <div class="panel" style="margin-bottom:16px">
    <div class="ph">${icon('film')} Editor de cortes</div>
    <div class="pb">
      <div class="toolbar" style="margin-bottom:12px">
        <select class="ctl" id="ed-clip" style="max-width:340px"></select>
        <select class="ctl" id="ed-aspect">
          <option value="16:9">16:9 YouTube</option>
          <option value="9:16">9:16 Reels/TikTok</option>
          <option value="1:1">1:1 cuadrado</option>
          <option value="4:5">4:5 feed IG</option>
        </select>
        <select class="ctl" id="ed-lut" title="Look / LUT">
          <option value="none">Sin look</option>
          <option value="cine">Cine (teal &amp; orange)</option>
          <option value="vivid">Vivid</option>
          <option value="warm">Cálido atardecer</option>
          <option value="moody">Moody</option>
          <option value="bw">Blanco y negro</option>
        </select>
        <select class="ctl" id="ed-speed" title="Velocidad del próximo corte">
          <option value="0.25">0.25x slow-mo</option>
          <option value="0.5">0.5x slow-mo</option>
          <option value="1" selected>1x</option>
          <option value="2">2x</option>
          <option value="4">4x hyperlapse</option>
        </select>
      </div>
      <input class="ctl" id="ed-title" placeholder="Título sobre el video (opcional)"
        style="width:100%;margin-bottom:12px" maxlength="60">
      <video id="ed-video" controls playsinline webkit-playsinline preload="metadata"
        style="width:100%;max-height:46dvh;background:#000;border-radius:8px;display:none"></video>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn" id="ed-in">${icon('chevR')} IN</button>
        <button class="btn" id="ed-out">${icon('chevL')} OUT · añadir corte</button>
        <label class="btn" style="gap:6px"><input type="checkbox" id="ed-fade" checked> Fades</label>
        <span class="mono" id="ed-cur" style="color:var(--text-3);font-size:12px"></span>
        <span class="spacer"></span>
        <button class="btn primary" id="ed-export">${icon('check')} Exportar</button>
      </div>
      <div id="ed-segs" style="margin-top:10px"></div>
      <p class="footer-note">Marca IN/OUT para acumular cortes — cada corte hereda la velocidad
      elegida (slow-mo real: tus clips son 60fps). El look, fades y título aplican al export completo.
      El M4 procesa por hardware y el resultado aparece en Reels.</p>
    </div>
  </div>
  <div class="fl-layout">
    <div>
      <div class="panel">
        <div class="ph">${icon('film')} Reels generados</div>
        <div class="pb" id="reels"><div class="sk" style="height:60px"></div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('activity')} Trabajos</div>
        <div class="pb" id="jobs"></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('spark')} Mejores momentos del archivo</div>
        <div class="pb" id="moments"><div class="sk" style="height:100px"></div></div>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="ph">${icon('cube')} Modelos 3D — Gaussian Splatting</div>
        <div class="pb" id="splats"></div>
        <div class="pb" style="border-top:1px solid var(--line)">
          <a class="btn" href="tresd.html">${icon('cube')} Ir a 3D — ortofotos y splats</a>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('activity')} Generar contenido</div>
        <div class="pb">
          <table class="kv">
            <tr><td>Reel del día</td><td><span class="mono">ai/reel.py --date YYYY-MM-DD</span></td></tr>
            <tr><td>Reel vertical 9:16</td><td><span class="mono">ai/reel.py --vertical</span></td></tr>
            <tr><td>Análisis AI nuevo</td><td><span class="mono">ai/analyze.py --all</span></td></tr>
            <tr><td>Modelo 3D de un vuelo</td><td><span class="mono">splat/make_splat.sh &lt;clip&gt;</span></td></tr>
            <tr><td>Página de venta</td><td><a href="ventas.html" style="color:var(--accent)">Ventas — crear propiedad con link + QR</a></td></tr>
          </table>
          <p class="footer-note">Todo corre local en el M4 — sin cloud, sin costos. Los reels usan los
          highlights que el análisis AI detectó en cada clip.</p>
        </div>
      </div>
    </div>
  </div>`;

(async () => {
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}

  // reels
  const reels = sys.reels || [];
  document.getElementById('reels').innerHTML = reels.length ? reels.map(r => `
    <div style="margin-bottom:14px">
      <video src="${DATA}/reels/${r.name}" controls playsinline webkit-playsinline preload="metadata" style="width:100%;border-radius:8px;background:#000"></video>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span class="mono" style="font-size:12px">${r.name}</span>
        <span class="mono" style="font-size:12px;color:var(--text-3)">${fmt.gb(r.bytes)}</span>
      </div>
    </div>`).join('') :
    `<div class="empty">${icon('film')}<p>Aún no hay reels. El primero se genera al terminar el análisis AI.</p></div>`;

  // splats
  const splats = sys.splats || [];
  document.getElementById('splats').innerHTML = splats.length ? splats.map(s => `
    <div class="hl-item"><span class="tc">${fmt.gb(s.bytes)}</span><p class="mono">${s.name}</p></div>`).join('') :
    `<div class="empty">${icon('cube')}<p>Sin modelos aún. El pipeline OpenSplat (Metal) convierte un vuelo
    orbital en una escena 3D navegable — próxima fase del roadmap.</p></div>`;

  // best moments ranking (top 8 por score, con jump al vuelo)
  const flights = await getFlights();
  const ai = await getAIAll(flights);
  const moments = [];
  flights.forEach(f => (ai[f.clip_id]?.highlights || []).forEach(h =>
    moments.push({ f, h, score: ai[f.clip_id].travel_score || 0 })));
  moments.sort((a, b) => b.score - a.score);
  document.getElementById('moments').innerHTML = moments.length ? moments.slice(0, 8).map(m => `
    <div class="hl-item">
      <a class="tc" href="flight.html?id=${m.f.clip_id}">${fmt.date(m.f.date)} · ${fmt.dur(m.h.t)}</a>
      <p>${m.h.reason} <span class="mono" style="color:var(--text-3)">· score ${m.score}/10</span></p>
    </div>`).join('') :
    `<div class="empty">${icon('spark')}<p>El análisis AI está corriendo — los momentos aparecen aquí al terminar.</p></div>`;

  // ---------- editor ----------
  const editable = flights.filter(f => f.has_proxy);
  const sel = document.getElementById('ed-clip');
  sel.innerHTML = `<option value="">Elige un clip (tier full)…</option>` +
    editable.map(f => `<option value="${f.clip_id}">${fmt.date(f.date)} ${f.time} · ${fmt.dur(f.duration_s)} · ${f.clip_id.startsWith('UP_') ? 'subido' : 'dron'}</option>`).join('');
  const vid = document.getElementById('ed-video');
  let segs = [], inPoint = null;

  // preview del look EN VIVO sobre el video (aproximación CSS del LUT del server)
  const CSS_LUTS = {
    none: '', cine: 'contrast(1.07) saturate(1.1) hue-rotate(-6deg)',
    vivid: 'saturate(1.35) contrast(1.1)', warm: 'sepia(0.18) saturate(1.2)',
    moody: 'contrast(1.16) brightness(0.94) saturate(0.82)', bw: 'grayscale(1) contrast(1.2)',
  };
  document.getElementById('ed-lut').addEventListener('change', e => {
    vid.style.filter = CSS_LUTS[e.target.value] || '';
  });

  // cambiar de clip NO borra los cortes: cada corte recuerda su clip (timeline multi-clip)
  sel.addEventListener('change', () => {
    inPoint = null;
    if (!sel.value) { vid.style.display = 'none'; return; }
    vid.src = `${DATA}/proxies/${sel.value}.mp4`;
    vid.style.display = 'block';
  });
  vid.addEventListener('timeupdate', () => {
    document.getElementById('ed-cur').textContent =
      `${fmt.dur(vid.currentTime)}${inPoint != null ? ` · IN en ${fmt.dur(inPoint)}` : ''}`;
  });
  document.getElementById('ed-in').addEventListener('click', () => { inPoint = vid.currentTime; vid.dispatchEvent(new Event('timeupdate')); });
  document.getElementById('ed-out').addEventListener('click', () => {
    if (inPoint == null || vid.currentTime <= inPoint || !sel.value) return;
    segs.push({ clip_id: sel.value, a: +inPoint.toFixed(1), b: +vid.currentTime.toFixed(1),
                speed: +document.getElementById('ed-speed').value });
    inPoint = null; paintSegs();
  });
  const clipShort = cid => {
    const f = editable.find(x => x.clip_id === cid);
    return f ? `${f.date.slice(5)} ${f.time}` : cid.slice(-8);
  };
  function paintSegs() {
    const total = segs.reduce((a, s) => a + (s.b - s.a) / s.speed, 0);
    document.getElementById('ed-segs').innerHTML = segs.map((s, i) => `
      <div class="hl-item">
        <button class="tc" data-play="${i}">${fmt.dur(s.a)} → ${fmt.dur(s.b)}</button>
        <p><b>${clipShort(s.clip_id)}</b> · ${(s.b - s.a).toFixed(1)}s${s.speed !== 1 ? ` · <b>${s.speed}x</b>` : ''}</p>
        <span style="display:flex;gap:4px">
          <button class="btn" data-up="${i}" style="padding:3px 8px;font-size:11px" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn" data-dn="${i}" style="padding:3px 8px;font-size:11px" ${i === segs.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn" data-rm="${i}" style="padding:3px 8px;font-size:11px">✕</button>
        </span>
      </div>`).join('') +
      (segs.length ? `<p class="footer-note">Timeline: ${segs.length} cortes · ${total.toFixed(1)}s de reel</p>` : '');
  }
  document.getElementById('ed-segs').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.play != null) {
      const s = segs[+d.play];
      if (sel.value !== s.clip_id) { sel.value = s.clip_id; sel.dispatchEvent(new Event('change')); }
      setTimeout(() => { vid.currentTime = s.a; vid.play(); }, 60);
    }
    if (d.rm != null) { segs.splice(+d.rm, 1); paintSegs(); }
    if (d.up != null) { const i = +d.up; [segs[i - 1], segs[i]] = [segs[i], segs[i - 1]]; paintSegs(); }
    if (d.dn != null) { const i = +d.dn; [segs[i + 1], segs[i]] = [segs[i], segs[i + 1]]; paintSegs(); }
  });
  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!segs.length) return alert('Marca al menos un corte (IN → OUT).');
    const token = getToken();
    if (!token) return;
    const r = await fetch(`/api/edit?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clip_id: sel.value, segments: segs,
        aspect: document.getElementById('ed-aspect').value,
        filter: document.getElementById('ed-lut').value,
        title: document.getElementById('ed-title').value.trim(),
        fade: document.getElementById('ed-fade').checked,
      }),
    });
    if (r.status === 403) return getToken(true);
    segs = []; paintSegs();
  });

  pollJobs(document.getElementById('jobs'));
})();
