/** mountActivity({fetchJobs?, interval=10000}) -> stop().
 * Reads GET /api/jobs only. Shows queued/running jobs; opens a Sistema sheet.
 * Polls only while visible. Unknown state retains the last count with a stale label.
 * fetchJobs must resolve to a job array or {jobs: []}. stop removes all listeners.
 */
import { createSheet } from './sheet.js?v=433';
export function mountActivity({ fetchJobs = async signal => {
  const r = await fetch('/api/jobs', { signal });
  if (!r.ok) throw new Error(`jobs: ${r.status}`);
  return r.json();
}, interval = 10000 } = {}) {
  const pill = document.createElement('button'); pill.type = 'button';
  pill.className = 'ui-activity'; pill.hidden = true;
  pill.setAttribute('aria-haspopup', 'dialog');
  document.body.append(pill);
  let timer, controller, stopped = false, jobs = [], sheet;
  const content = document.createElement('div');
  function render() {
    content.replaceChildren();
    for (const job of jobs) {
      const p = document.createElement('p');
      const labels = { splat: 'Escena 3D', '3d': 'Modelo 3D', edit: 'Render', upload: 'Subida' };
      p.textContent = `${labels[job.kind] || 'Trabajo'} · ${job.status === 'queued' ? 'En cola' : 'En proceso'}`;
      content.append(p);
    }
    if (!jobs.length) { const p = document.createElement('p'); p.textContent = 'No hay trabajos en curso.'; content.append(p); }
    const link = document.createElement('a'); link.href = 'system.html';
    link.className = 'ui-button ui-button--secondary'; link.textContent = 'Abrir Sistema'; content.append(link);
  }
  pill.addEventListener('click', () => {
    if (!sheet) sheet = createSheet({ title: 'Sistema', content, size: 'half' });
    render(); sheet.open(pill);
  });
  async function poll() {
    clearTimeout(timer);
    if (stopped || document.hidden || controller) return;
    controller = new AbortController();
    try {
      const data = await fetchJobs(controller.signal);
      if (stopped) return;
      jobs = (Array.isArray(data) ? data : data.jobs || []).filter(j => ['running', 'queued'].includes(j.status));
      pill.hidden = !jobs.length;
      pill.textContent = `${jobs.length} ${jobs.length === 1 ? 'trabajo en curso' : 'trabajos en curso'}`;
      pill.removeAttribute('data-stale');
      if (sheet?.element.open) render();
    } catch (e) {
      if (e.name !== 'AbortError' && jobs.length) { pill.dataset.stale = ''; pill.textContent = 'Actividad · Sin conexión'; }
    } finally {
      controller = null;
      if (!stopped && !document.hidden) timer = setTimeout(poll, interval);
    }
  }
  const visibility = () => { clearTimeout(timer); if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', visibility); poll();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); sheet?.destroy(); pill.remove(); };
}
