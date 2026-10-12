import { jobState, jobRelativeTime, jobEmptyState } from './system.logic.js?v=380';
import { createSheet } from './ui/sheet.js?v=374';
import { showToast } from './ui/toast.js?v=374';
import { registerPaletteSource } from './ui/palette.js?v=374';

const main = renderShell('system.html');
main.classList.add('ab-page', 'sy-page');
const kinds = { '3d': 'Modelo 3D', splat: 'Splat', foto4k: 'Foto', edit: 'Edición', upload: 'Subida', analyze: 'Análisis', ingest: 'Importación' };
const active = j => jobState(j)[1] === 'active';
const failed = j => jobState(j)[1] === 'error';
const skeleton = '<div class="sy-loading" aria-hidden="true"><div class="ui-skeleton ui-skeleton--text"></div><div class="ui-skeleton ui-skeleton--text"></div></div>';
let jobs = [], filter = 'active', loaded = false, busy = false;
main.innerHTML = `
  <header class="sy-head"><div><h1>Sistema</h1><p>El estado de tu archivo y de cada trabajo.</p></div><button class="ui-button ui-button--primary" id="sy-refresh">Actualizar</button></header>
  <div class="sy-layout">
    <section class="sy-work" aria-labelledby="sy-work-title"><div class="sy-section-head"><h2 id="sy-work-title">Trabajos</h2><span id="sy-count" class="sy-note"></span></div>
      <div class="ui-segmented" role="group" aria-label="Filtrar trabajos">${[['active','En curso'],['error','Con errores'],['all','Todos']].map(([key,label]) => `<button data-filter="${key}" aria-pressed="${key === filter}">${label}</button>`).join('')}</div>
      <p id="sy-job-error" role="status" class="sy-error" hidden></p>
      <div id="sy-jobs" aria-busy="true">${skeleton.repeat(3)}</div><button class="ui-button ui-button--quiet" id="sy-more" hidden>Mostrar más</button>
    </section>
    <aside class="sy-health" aria-labelledby="sy-health-title"><div class="sy-section-head"><h2 id="sy-health-title">Salud del equipo</h2></div>
      <p id="sy-connection" role="status">Consultando el Mac…</p><dl id="sy-metrics">${skeleton}</dl>
      <div class="sy-node"><h3>PC de procesamiento</h3><p id="sy-gpu">Consultando…</p><div class="sy-actions"><button class="ui-button ui-button--secondary" id="sy-wake" disabled>Despertar</button><button class="ui-button ui-button--quiet" id="sy-sleep" disabled>Suspender</button></div></div>
    </aside>
  </div>
  <section class="sy-tools" aria-label="Consultas del sistema">
    <div><h2>Almacenamiento</h2><p>Espacio ocupado por originales y archivos generados.</p><button class="ui-button ui-button--secondary" id="sy-inventory">Ver almacenamiento</button></div>
    <div><h2>Diagnósticos</h2><p>Errores recientes e informes guardados.</p><button class="ui-button ui-button--secondary" id="sy-reports">Ver diagnósticos</button></div>
  </section>
  <section class="sy-review"><div><h2>Revisión de duplicados</h2><p>La cola de revisión aún no está disponible. Tus originales se conservan.</p></div><a class="ui-button ui-button--secondary" href="studio.html">Abrir Studio</a></section>`;
const $ = id => document.getElementById(id);
async function read(url, options) {
  const r = await authFetch(url, options);
  const d = await r.json();
  if (!r.ok || d.error || d.ok === false) throw new Error(d.error || d.reason || 'La solicitud no se completó.');
  return d;
}
function sheet(title, html, opener) {
  const content = document.createElement('div'); content.className = 'sy-sheet-content'; content.innerHTML = html;
  const view = createSheet({ title, content, size: 'half', onClose: () => view.destroy() });
  view.open(opener); return view;
}
let shown = 20;
function paintJobs() {
  const rows = jobs.filter(j => filter === 'all' || (filter === 'active' ? active(j) : failed(j)))
    .sort((a,b) => Number(active(b)) - Number(active(a)) || Number(b.started || 0) - Number(a.started || 0));
  $('sy-count').textContent = `${jobs.filter(active).length} en curso · ${jobs.filter(failed).length} con errores`;
  $('sy-jobs').setAttribute('aria-busy', 'false');
  const empty = jobEmptyState(jobs, filter, Date.now());
  const html = rows.length ? rows.slice(0, shown).map(j => {
    const [label,tone] = jobState(j);
    const progress = Math.round(Math.max(0, Math.min(1, Number(j.progress) || 0)) * 100);
    return `<article class="sy-job"><div class="sy-job-top"><span class="sy-state ${tone}">${label}</span><span class="sy-note">${esc(kinds[j.kind] || j.kind || 'Trabajo')}</span></div>
      <h3>${esc(j.title || j.label || 'Sin título')}</h3>
      ${active(j) ? `<div class="sy-progress"><progress max="100" value="${progress}" aria-label="Progreso"></progress><span class="ui-figures">${progress}%</span></div>` : ''}
      <p>${esc(j.detail || (j.status === 'queued' ? 'Esperando su turno.' : label))}</p>
      <div class="sy-job-foot"><span class="sy-note">${esc(jobRelativeTime(j, Date.now()))}</span><button class="ui-button ui-button--secondary" data-job="${esc(j.id)}">Ver detalles</button></div></article>`;
  }).join('') : `<div class="ui-empty"><h3>${empty.title}</h3>${empty.action ? `<button class="ui-button ui-button--primary" data-review-errors>${empty.action}</button>` : `<small>${esc(empty.note)}</small>`}</div>`;
  if ($('sy-jobs').dataset.html !== html) { $('sy-jobs').innerHTML = html; $('sy-jobs').dataset.html = html; }
  $('sy-more').hidden = rows.length <= shown;
}
async function loadJobs() {
  try {
    const d = await read('/api/jobs'); jobs = d.jobs || []; loaded = true; paintJobs(); $('sy-job-error').hidden = true;
  } catch {
    $('sy-job-error').hidden = false; $('sy-job-error').textContent = loaded ? 'Sin conexión. Los trabajos muestran la última consulta. Pulsa Actualizar.' : 'No se pudieron cargar los trabajos. Pulsa Actualizar para reintentar.';
    if (!loaded) { $('sy-jobs').innerHTML = ''; $('sy-jobs').setAttribute('aria-busy','false'); }
  }
}
async function openJob(job, opener) {
  const [label] = jobState(job);
  const retryHref = ['3d','splat'].includes(job.kind) ? 'tresd.html' : job.kind === 'ingest' ? 'drone.html' : 'studio.html';
  const view = sheet(job.title || job.label || 'Trabajo', `<p class="ui-chip">${label}</p><p>${esc(job.detail || 'Sin detalles adicionales.')}</p>
    ${failed(job) || job.status === 'cancelled' ? `<a class="ui-button ui-button--primary" href="${retryHref}">Preparar reintento</a><p class="sy-note">Revisa los archivos y los ajustes antes de iniciar otro trabajo.</p>` : ''}
    ${active(job) && !job.cancel_requested && !['cancel_requested','cancelling'].includes(job.status) ? '<button class="ui-button ui-button--danger" id="sy-cancel">Solicitar cancelación</button>' : ''}
    <dl class="sy-storage">${[['Calidad solicitada',job.requested_preset],['Procesamiento',job.effective_backend || job.requested_backend],['Archivos de origen',job.source_count || job.photo_count]].filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <h3>Registro</h3><pre class="sy-log" role="status">Cargando registro…</pre>`, opener);
  view.body.querySelector('#sy-cancel')?.addEventListener('click', async e => {
    const button = e.currentTarget; button.disabled = true;
    try {
      await read('/api/job_cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:job.id}) });
      job.cancel_requested = true; view.body.querySelector('.ui-chip').textContent = 'Cancelación solicitada'; button.remove(); paintJobs();
    } catch (err) { showToast(`No se pudo cancelar: ${err.message}`); button.disabled = false; }
  });
  let cursor = 0, lines = [];
  const more = document.createElement('button'); more.className = 'ui-button ui-button--secondary'; more.textContent = 'Cargar más líneas'; more.hidden = true; view.body.append(more);
  async function loadLog() {
    more.disabled = true;
    try {
      const d = await read(`/api/job_log?id=${encodeURIComponent(job.id)}&after=${cursor}&limit=500`);
      if (!view.element.isConnected) return;
      lines.push(...(d.lines || [])); cursor = d.next || cursor;
      view.body.querySelector('pre').textContent = lines.map(line => typeof line === 'string' ? line : line.text || line.line || JSON.stringify(line)).join('\n') || 'Este trabajo no tiene un registro guardado.';
      more.hidden = d.eof !== false; more.textContent = 'Cargar más líneas';
    } catch {
      if (!view.element.isConnected) return;
      if (!lines.length) view.body.querySelector('pre').textContent = 'No se pudo cargar el registro.';
      more.hidden = false; more.textContent = 'Reintentar registro';
    } finally { more.disabled = false; }
  }
  more.addEventListener('click', loadLog); loadLog();
}
async function loadHealth() {
  try {
    const d = await read('/api/perf'), n = d.now;
    if (!n) throw new Error('Sin muestra');
    const age = Math.max(0, Date.now()/1000 - Number(n.ts || 0));
    $('sy-connection').textContent = age > 15 ? 'Datos desactualizados · esperando una muestra' : `Mac conectado · ${new Date(n.ts*1000).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    $('sy-connection').className = age > 15 ? 'sy-error' : 'sy-note';
    $('sy-metrics').innerHTML = [['CPU',`${n.cpu ?? '—'} %`],['Memoria',`${n.ram_used_gb ?? '—'} / ${n.ram_total_gb ?? '—'} GB`],['Disco libre',`${n.disk_free_gb ?? '—'} GB`],['Temperatura',n.thermal ? n.thermal.throttling ? 'Rendimiento limitado' : 'Normal' : 'Sin datos']].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  } catch { $('sy-connection').textContent = 'Sin conexión · los valores no están actualizados'; $('sy-connection').className = 'sy-error'; }
}
async function loadGPU() {
  try {
    const d = await read('/api/gpu_node');
    $('sy-gpu').textContent = d.status === 'awake' ? `${d.gpu || 'PC conectado'} · ${d.util_pct ?? '—'} % de uso` : d.status === 'asleep' ? 'En reposo. Se activa al iniciar un trabajo 3D.' : 'No se pudo comprobar el estado del PC.';
    $('sy-wake').disabled = d.status !== 'asleep'; $('sy-sleep').disabled = d.status !== 'awake';
  } catch { $('sy-gpu').textContent = 'Sin conexión con el PC.'; $('sy-wake').disabled = $('sy-sleep').disabled = true; }
}
for (const action of ['wake','sleep']) $('sy-'+action).addEventListener('click', async e => {
  const button = e.currentTarget; button.disabled = true;
  try { const d = await read('/api/gpu_node/'+action,{method:'POST'}); if (d.ok === false) throw new Error(d.reason || 'Solicitud rechazada'); showToast(action === 'wake' ? 'Solicitud de encendido enviada.' : 'Solicitud de suspensión enviada.'); }
  catch (err) { showToast(err.message); } finally { await loadGPU(); }
});
$('sy-inventory').addEventListener('click', async e => {
  const view = sheet('Almacenamiento', skeleton, e.currentTarget);
  try {
    const d = await read(`${DATA}/manifest/system.json`);
    if (!view.element.isConnected) return;
    view.body.innerHTML = `<dl class="sy-storage">${[['raw','Originales'],['proxies','Copias de reproducción'],['frames','Fotogramas'],['reels','Reels'],['splats','Splats']].map(([k,v])=>`<div><dt>${v}</dt><dd class="ui-figures">${fmt.gb(d.storage?.[k] || 0)}</dd></div>`).join('')}</dl><p class="sy-note">Inventario actualizado: ${esc(d.generated_at || 'fecha no disponible')}.</p>`;
  } catch { if (view.element.isConnected) view.body.textContent = 'No se pudo cargar el inventario. Cierra y vuelve a intentarlo.'; }
});
$('sy-reports').addEventListener('click', async e => {
  const view = sheet('Diagnósticos', skeleton, e.currentTarget);
  try {
    const d = await read('/api/error_reports');
    if (!view.element.isConnected) return;
    view.body.innerHTML = `<h3>Errores recientes</h3>${(d.recent_errors || []).map(x=>`<p class="sy-diagnostic">${esc(x.msg)}</p>`).join('') || '<p>No hay errores registrados en esta consulta.</p>'}<h3 class="sy-reports-title">Informes guardados</h3>${(d.reports || []).slice(0,5).map(x=>`<button class="ui-button ui-button--secondary" data-report="${esc(x.name)}">${esc(x.name)}</button>`).join('') || '<p>Sin análisis aún.</p>'}<pre class="sy-log" id="pf-report-body" hidden></pre>`;
    view.body.addEventListener('click', async event => {
      const button = event.target.closest('[data-report]'); if (!button) return;
      const pre = view.body.querySelector('pre'); pre.hidden = false; pre.textContent = 'Cargando informe…';
      try { const report = await read(`/api/error_report_content?name=${encodeURIComponent(button.dataset.report)}`); pre.textContent = report.content || 'Informe vacío.'; }
      catch { pre.textContent = 'No se pudo cargar el informe. Pulsa su nombre para reintentar.'; }
    });
  } catch { if (view.element.isConnected) view.body.textContent = 'No se pudieron cargar los diagnósticos.'; }
});
main.addEventListener('click', e => {
  if (e.target.closest('[data-review-errors]')) {
    const tab = main.querySelector('[data-filter="error"]'); tab.click(); tab.focus();
  }
  const f = e.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; shown = 20; main.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b===f)); paintJobs(); }
  const b = e.target.closest('[data-job]'); if (b) openJob(jobs.find(j=>j.id===b.dataset.job), b);
});
$('sy-more').addEventListener('click',()=>{ shown += 20; paintJobs(); });
async function refresh() { if (busy) return; busy = true; $('sy-refresh').disabled = true; await Promise.allSettled([loadJobs(),loadHealth(),loadGPU()]); $('sy-refresh').disabled = false; busy = false; }
$('sy-refresh').addEventListener('click', refresh);
registerPaletteSource(()=>jobs.map(j=>({id:`job-${j.id}`, label:j.title || j.label || 'Trabajo', keywords:`Sistema ${kinds[j.kind] || ''} ${jobState(j)[0]}`, action:()=>openJob(j)})));
refresh();
const timer = setInterval(()=>{ if (!document.hidden) refresh(); },10000);
addEventListener('pagehide',()=>clearInterval(timer),{once:true});
