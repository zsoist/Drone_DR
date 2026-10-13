import { fmt } from './ui/format.js?v=423';

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

// Keep each attempt available while collapsing repeated failures for the same source.
export function groupFailedJobs(jobs) {
  const groups = [], failures = new Map();
  for (const job of jobs) {
    const key = JSON.stringify([job.kind, job.label || job.title || job.id]);
    if (jobState(job)[1] !== 'error') { groups.push([job]); continue; }
    if (!failures.has(key)) { const group = []; failures.set(key, group); groups.push(group); }
    failures.get(key).push(job);
  }
  return groups;
}

export function jobFailureReason(job) {
  const detail = `${job.detail || ''}\n${job.log_tail || ''}`;
  if (/out of memory|memoryerror|sin memoria/i.test(detail)) return 'El equipo se quedó sin memoria durante el procesamiento.';
  if (/illegal memory access/i.test(detail)) return 'Un error de memoria en el PC interrumpió el procesamiento.';
  if (/SyntaxError/i.test(detail)) return 'Un error del programa impidió iniciar el procesamiento en el PC.';
  if (/KeyError: ['"]step['"]/.test(detail)) return 'El PC no pudo guardar el registro final del procesamiento.';
  if (/no space left|disk full|espacio insuficiente/i.test(detail)) return 'El equipo no tiene espacio suficiente para guardar el resultado.';
  if (/timed out|timeout|connection refused|unreachable/i.test(detail)) return 'Se interrumpió la conexión con el equipo de procesamiento.';
  const stages = { train: 'al crear la escena', transfer: 'al transferir los archivos', publish: 'al guardar el resultado', prepare: 'al preparar los archivos' };
  return `El trabajo se interrumpió ${stages[job.stage] || 'durante el procesamiento'}. Consulta el registro para revisar la causa.`;
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
