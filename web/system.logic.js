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
  const minutes = Math.max(0, Math.floor((now / 1000 - timestamp) / 60));
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.floor(minutes / 60)} h`;
  return `hace ${Math.floor(minutes / 1440)} días`;
}
