import { fmt } from './ui/format.js?v=416';

export function jobState(job) {
  if (['cancelled', 'canceled'].includes(job.status)) return ['Cancelado', 'quiet'];
  if (['error', 'failed', 'cancel_failed'].includes(job.status)) return [job.status === 'cancel_failed' ? 'No se pudo cancelar' : 'Falló', 'error'];
  if (job.status === 'done') return [job.fallback ? 'Listo con ajustes' : 'Listo', 'quiet'];
  if (job.cancel_requested || ['cancelling', 'cancel_requested'].includes(job.status)) return ['Cancelación solicitada', 'active'];
  return ({ queued: ['En cola', 'active'], running: ['En proceso', 'active'] })[job.status] || ['Estado desconocido', 'quiet'];
}
export function jobRelativeTime(job, now) {
  if (job.status === 'queued') return 'en cola';
  const timestamp = Number(job.status === 'running' ? job.started : job.finished || job.started);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'sin fecha';
  return fmt.relative(timestamp * 1000, now);
}

export function jobEmptyState(jobs, filter, now) {
  const errors = jobs.filter(job => jobState(job)[1] === 'error').length;
  const latest = jobs.filter(job => job.status === 'done')
    .sort((a, b) => Number(b.finished || b.started || 0) - Number(a.finished || a.started || 0))[0];
  return {
    title: filter === 'active' ? 'Sin trabajos activos' : filter === 'error' ? 'Sin trabajos con errores' : 'Sin trabajos registrados',
    action: filter === 'active' && errors ? `Revisar ${errors} con errores` : '',
    note: latest ? `Último finalizado: ${latest.title || latest.label || 'Trabajo'} · ${jobRelativeTime(latest, now)}.` : 'Los trabajos aparecerán aquí cuando se inicien.',
  };
}
