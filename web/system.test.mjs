import test from 'node:test';
import assert from 'node:assert/strict';
import { jobState, jobRelativeTime, jobEmptyState } from './system.logic.js';
test('requested cancellation is not confirmed cancellation',()=>{
 assert.deepEqual(jobState({status:'running',cancel_requested:true}),['Cancelación solicitada','active']);
 assert.deepEqual(jobState({status:'cancelled',cancel_requested:true}),['Cancelado','quiet']);
 assert.deepEqual(jobState({status:'cancel_failed'}),['No se pudo cancelar','error']);
});
test('terminal results win over stale cancellation flags',()=>{
 assert.equal(jobState({status:'done',cancel_requested:true})[0],'Listo');
 assert.equal(jobState({status:'failed',cancel_requested:true})[0],'Falló');
});
test('queued, running, fallback and unknown states remain distinct',()=>{
 assert.equal(jobState({status:'queued'})[0],'En cola');
 assert.equal(jobState({status:'running'})[0],'En proceso');
 assert.equal(jobState({status:'done',fallback:true})[0],'Listo con ajustes');
 assert.equal(jobState({status:'alien'})[0],'Estado desconocido');
});

test('job age uses completion time and never a future queue time',()=>{
 assert.deepEqual([{status:'queued',started:2000},{status:'running',started:940},{status:'done',started:100,finished:880}].map(j=>jobRelativeTime(j,1000000)),['en cola','hace 1 min','hace 2 min']);
});

test('idle jobs direct the owner to every error state', () => {
 const jobs = ['error', 'failed', 'cancel_failed', 'cancelled', 'done'].map(status => ({status}));
 assert.equal(jobEmptyState(jobs, 'active', 1000000).title, 'Sin trabajos activos');
 assert.equal(jobEmptyState(jobs, 'active', 1000000).action, 'Revisar 3 con errores');
 assert.equal(jobEmptyState(jobs, 'error', 1000000).action, '');
});

test('idle jobs use the latest completion, without changing job order', () => {
 const jobs = [{status:'done',title:'Vuelo anterior',started:950,finished:960}, {status:'done',title:'Vuelo reciente',started:100,finished:980}, {status:'cancelled',finished:999}];
 const original = JSON.stringify(jobs);
 assert.deepEqual(jobEmptyState(jobs, 'active', 1040000), {title:'Sin trabajos activos',action:'',note:'Último finalizado: Vuelo reciente · hace 1 min.'});
 assert.equal(JSON.stringify(jobs), original);
 assert.equal(jobEmptyState([], 'all', 1040000).title, 'Sin trabajos registrados');
 assert.equal(jobEmptyState([], 'active', 1040000).action, '');
});

test('month ages cannot be mistaken for minutes',()=>{
 const now=Date.UTC(2026,9,13), finished=Date.UTC(2026,7,13)/1000;
 assert.equal(jobRelativeTime({status:'done',finished},now),'hace 2 meses');
});
