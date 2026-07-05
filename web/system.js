// Sistema: storage del vault, estado del pipeline, servicios, y modelo de costos.
const main = renderShell('system.html');
main.innerHTML = `
  <div class="page-head"><h1>Sistema</h1><span class="count">vault · pipeline · costos</span></div>
  <div class="statgrid" id="top">${'<div class="sk" style="height:74px"></div>'.repeat(4)}</div>
  <div class="fl-layout">
    <div>
      <div class="panel">
        <div class="ph">${icon('db')} Storage del vault</div>
        <div class="pb" id="storage"><div class="sk" style="height:120px"></div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('layers')} Pipeline de procesamiento</div>
        <div class="pb" id="pipeline"></div>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="ph">${icon('wifi')} Servicios</div>
        <div class="pb"><table class="kv">
          <tr><td>Web server</td><td>com.aerobrain.web · :8790</td></tr>
          <tr><td>Túnel Cloudflare</td><td>com.metislab.tunnel</td></tr>
          <tr><td>Dominio</td><td>vuelos.metislab.work</td></tr>
          <tr><td>Compute</td><td>Mac Mini M4 · VideoToolbox</td></tr>
        </table></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('check')} Modelo de costos</div>
        <div class="pb"><table class="kv">
          <tr><td>Hosting + streaming</td><td>$0 (túnel + SSD)</td></tr>
          <tr><td>Storage</td><td>$0 (vault local)</td></tr>
          <tr><td>AI vision (Gemini)</td><td>~$0.002 / clip</td></tr>
          <tr><td>Síntesis (DeepSeek)</td><td>centavos / mes</td></tr>
          <tr><td><b>Total mensual</b></td><td><b style="color:var(--mint)">≈ $0</b></td></tr>
        </table></div>
      </div>
    </div>
  </div>`;

(async () => {
  let sys = {};
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  const flights = await getFlights();
  const st = sys.storage || {};
  const tiers = { full: 0, standard: 0, skim: 0 };
  flights.forEach(f => tiers[f.tier] = (tiers[f.tier] || 0) + 1);

  document.getElementById('top').innerHTML = `
    <div class="stat"><div class="lb">${icon('drone')} Clips</div><div class="v">${flights.length}</div></div>
    <div class="stat"><div class="lb">${icon('db')} Raw 4K</div><div class="v">${fmt.gb(st.raw || 0)}</div></div>
    <div class="stat"><div class="lb">${icon('film')} Proxies web</div><div class="v">${fmt.gb(st.proxies || 0)}</div></div>
    <div class="stat"><div class="lb">${icon('spark')} Analizados AI</div><div class="v">${sys.ai_count ?? 0}<small> / ${flights.length}</small></div></div>`;

  const cats = [['raw', 'Originales 4K (intocables)'], ['proxies', 'Proxies 1080p'], ['frames', 'Keyframes AI'],
                ['thumbs', 'Thumbnails'], ['tracks', 'Tracks GPS'], ['reels', 'Reels']];
  const maxB = Math.max(...cats.map(([k]) => st[k] || 0), 1);
  document.getElementById('storage').innerHTML = cats.map(([k, lb]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--text-2)">${lb}</span>
        <span class="mono" style="color:var(--text-3)">${fmt.gb(st[k] || 0)}</span>
      </div>
      <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${((st[k] || 0) / maxB * 100).toFixed(1)}%;background:var(--accent);border-radius:3px"></div>
      </div>
    </div>`).join('');

  document.getElementById('pipeline').innerHTML = `<table class="kv">
    <tr><td>Ingesta</td><td>${sys.last_ingest ? `${sys.last_ingest.files} archivos · ${fmt.gb(sys.last_ingest.bytes)}` : '—'}</td></tr>
    <tr><td>Tier full (video web)</td><td>${tiers.full} clips</td></tr>
    <tr><td>Tier standard (AI sin proxy)</td><td>${tiers.standard} clips</td></tr>
    <tr><td>Tier skim (solo telemetría)</td><td>${tiers.skim} clips</td></tr>
    <tr><td>Índice generado</td><td class="mono">${sys.generated_at || '—'}</td></tr>
  </table>
  <p class="footer-note">La política de tiers vive en <span class="mono">pipeline/policy.py</span> —
  ajusta los umbrales para decidir qué clips merecen proxy completo.</p>`;
})();
