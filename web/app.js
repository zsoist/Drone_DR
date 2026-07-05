// Flight gallery: renders flights.json into cards + aggregate stats.
const DATA = 'data'; // swap to the R2 public bucket URL on deploy

const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDate = d => {
  const [y, m, day] = d.split('-');
  return `${+day} ${MESES[+m - 1]} ${y}`;
};

async function main() {
  const res = await fetch(`${DATA}/manifest/flights.json`);
  const { flights } = await res.json();

  const totalDist = flights.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
  const totalDur = flights.reduce((a, f) => a + f.duration_s, 0);
  const maxAlt = Math.max(0, ...flights.map(f => f.stats.max_rel_alt_m || 0));
  document.getElementById('stats').innerHTML = `
    <div class="stat"><b>${flights.length}</b><span>vuelos</span></div>
    <div class="stat"><b>${fmtKm(totalDist)}</b><span>recorridos</span></div>
    <div class="stat"><b>${fmtDur(totalDur)}</b><span>en el aire</span></div>
    <div class="stat"><b>${Math.round(maxAlt)} m</b><span>alt máxima</span></div>`;

  document.getElementById('grid').innerHTML = flights.map(f => `
    <a class="card" href="flight.html?id=${f.clip_id}">
      <div class="thumb">
        <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="Vuelo ${f.clip_id}" loading="lazy" width="960" height="540">
        <span class="badge ${f.tier}">${f.tier}</span>
        <span class="dur">${fmtDur(f.duration_s)}</span>
      </div>
      <div class="body">
        <div class="title">${fmtDate(f.date)} · ${f.time}</div>
        <div class="meta">
          <span>📏 <b>${fmtKm(f.stats.distance_m || 0)}</b></span>
          <span>⛰️ <b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
          <span>🎞️ <b>${f.resolution.split('x')[1]}p${Math.round(f.fps)}</b></span>
        </div>
      </div>
    </a>`).join('');
}

main().catch(e => {
  document.getElementById('grid').innerHTML =
    `<p style="color:#ff8080;padding:20px">Error cargando vuelos: ${e.message}</p>`;
});
