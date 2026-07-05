// Viajes: vuelos agrupados por día + ubicación, con resumen AI del día si existe.
const main = renderShell('trips.html');
main.innerHTML = `
  <div class="page-head"><h1>Viajes</h1><span class="count" id="count"></span></div>
  <div id="trips">${'<div class="sk" style="height:120px;margin-bottom:16px"></div>'.repeat(3)}</div>
  <p class="footer-note">Cada día de vuelo se agrupa como una sesión. Cuando subas footage de un viaje,
  el diario AI (DeepSeek) resume el día completo — genera con <span class="mono">python3 ai/trips.py</span>.</p>`;

(async () => {
  const flights = await getFlights();
  const ai = await getAIAll(flights);
  let diaries = {};
  try {
    const r = await fetch(`${DATA}/ai/trips.json`);
    if (r.ok) diaries = await r.json();
  } catch {}

  // agrupar por fecha; dentro de un día, separar por cluster geográfico (>25km = otro lugar)
  const byDay = {};
  flights.forEach(f => (byDay[f.date] = byDay[f.date] || []).push(f));

  const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  document.getElementById('count').textContent = `${days.length} días de vuelo`;

  document.getElementById('trips').innerHTML = days.map(([date, list]) => {
    const dist = list.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    const dur = list.reduce((a, f) => a + f.duration_s, 0);
    const best = list.map(f => ai[f.clip_id]?.travel_score || 0).reduce((a, b) => Math.max(a, b), 0);
    const scenes = [...new Set(list.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
    const diary = diaries[date];
    return `
    <section class="trip">
      <div class="trip-head">
        <h2>${fmt.date(date)}</h2>
        <span class="mono">${list.length} vuelos · ${fmt.km(dist)} · ${fmt.hours(dur)}${best ? ` · mejor score ${best}/10` : ''}</span>
        ${scenes.length ? `<span class="chips">${scenes.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</span>` : ''}
      </div>
      ${diary ? `<div class="summary">${esc(diary)}</div>` : ''}
      <div class="grid">${list.map(f => `
        <a class="card" href="flight.html?id=${f.clip_id}">
          <div class="thumb">
            <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
            <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
            <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
          </div>
          <div class="body">
            <div class="t"><span>${f.time}</span></div>
            <div class="metrics">
              <span>${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b></span>
              <span>${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
            </div>
            ${ai[f.clip_id]?.summary ? `<p class="ai-line">${esc(ai[f.clip_id].summary)}</p>` : ''}
          </div>
        </a>`).join('')}
      </div>
    </section>`;
  }).join('');
})();
