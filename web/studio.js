// Studio: reels generados, ranking de mejores momentos, y modelos 3D (splats).
const main = renderShell('studio.html');
main.innerHTML = `
  <div class="page-head"><h1>Studio</h1><span class="count">edición y 3D</span></div>
  <div class="fl-layout">
    <div>
      <div class="panel">
        <div class="ph">${icon('film')} Reels generados</div>
        <div class="pb" id="reels"><div class="sk" style="height:60px"></div></div>
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
      <video src="${DATA}/reels/${r.name}" controls preload="metadata" style="width:100%;border-radius:8px;background:#000"></video>
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
})();
