// Studio: editor de cortes, reels generados, mejores momentos, y modelos 3D.
const main = renderShell('studio.html');
main.innerHTML = `
  <div class="page-head"><h1>Studio</h1><span class="count">edición y 3D</span></div>
  <div class="panel" style="margin-bottom:16px">
    <div class="ph">${icon('film')} Editor de cortes</div>
    <div class="pb">
      <div class="toolbar" style="margin-bottom:12px">
        <select class="ctl" id="ed-clip" style="max-width:340px"></select>
        <div class="seg"><button id="ed-h" class="on">16:9</button><button id="ed-v">9:16 vertical</button></div>
      </div>
      <video id="ed-video" controls playsinline webkit-playsinline preload="metadata"
        style="width:100%;max-height:46dvh;background:#000;border-radius:8px;display:none"></video>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn" id="ed-in">${icon('chevR')} Marcar IN</button>
        <button class="btn" id="ed-out">${icon('chevL')} Marcar OUT · añadir corte</button>
        <span class="mono" id="ed-cur" style="color:var(--text-3);font-size:12px"></span>
        <span class="spacer"></span>
        <button class="btn primary" id="ed-export">${icon('check')} Exportar</button>
      </div>
      <div id="ed-segs" style="margin-top:10px"></div>
      <p class="footer-note">Marca IN y OUT sobre el video para acumular cortes; el M4 los une
      con ffmpeg por hardware. El resultado aparece abajo en Reels.</p>
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
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('activity')} Generar contenido</div>
        <div class="pb">
          <table class="kv">
            <tr><td>Reel del día</td><td><span class="mono">ai/reel.py --date YYYY-MM-DD</span></td></tr>
            <tr><td>Reel vertical 9:16</td><td><span class="mono">ai/reel.py --vertical</span></td></tr>
            <tr><td>Análisis AI nuevo</td><td><span class="mono">ai/analyze.py --all</span></td></tr>
            <tr><td>Modelo 3D de un vuelo</td><td><span class="mono">splat/make_splat.sh &lt;clip&gt;</span></td></tr>
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
  let segs = [], inPoint = null, vertical = false;

  sel.addEventListener('change', () => {
    segs = []; inPoint = null; paintSegs();
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
    if (inPoint == null || vid.currentTime <= inPoint) return;
    segs.push([+inPoint.toFixed(1), +vid.currentTime.toFixed(1)]);
    inPoint = null; paintSegs();
  });
  document.getElementById('ed-h').addEventListener('click', () => setAR(false));
  document.getElementById('ed-v').addEventListener('click', () => setAR(true));
  function setAR(v) {
    vertical = v;
    document.getElementById('ed-h').classList.toggle('on', !v);
    document.getElementById('ed-v').classList.toggle('on', v);
  }
  function paintSegs() {
    document.getElementById('ed-segs').innerHTML = segs.map((s, i) => `
      <div class="hl-item">
        <button class="tc" data-play="${s[0]}">${fmt.dur(s[0])} → ${fmt.dur(s[1])}</button>
        <p>corte ${i + 1} · ${(s[1] - s[0]).toFixed(1)}s</p>
        <button class="btn" data-rm="${i}" style="padding:3px 9px;font-size:11px">Quitar</button>
      </div>`).join('');
  }
  document.getElementById('ed-segs').addEventListener('click', e => {
    if (e.target.dataset.play) { vid.currentTime = +e.target.dataset.play; vid.play(); }
    if (e.target.dataset.rm) { segs.splice(+e.target.dataset.rm, 1); paintSegs(); }
  });
  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!sel.value || !segs.length) return alert('Elige un clip y marca al menos un corte (IN → OUT).');
    const token = getToken();
    if (!token) return;
    const r = await fetch(`/api/edit?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip_id: sel.value, segments: segs, vertical }),
    });
    if (r.status === 403) return getToken(true);
    segs = []; paintSegs();
  });

  pollJobs(document.getElementById('jobs'));
})();
