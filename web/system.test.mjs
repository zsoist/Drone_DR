import test from 'node:test';
import assert from 'node:assert/strict';
import { jobState, jobRelativeTime } from './system.logic.js';
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
