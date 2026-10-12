import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPropertyURL } from './ventas.logic.js';
test('links use the server canonical slug, never the submitted title',()=>{
 const result=canonicalPropertyURL({ok:true,url:'https://vuelos.metislab.work/p.html?id=casacajic'},'http://127.0.0.1:8805');
 assert.equal(result.slug,'casacajic'); assert.equal(result.href,'p.html?id=casacajic');
});
test('rejected or incomplete responses cannot show success',()=>{
 for(const result of [{error:'slug requerido'},{ok:false,url:'/p.html?id=x'},{ok:true},{ok:true,url:'/p.html?id=!!!'},{ok:true,url:'https://bad.test/'},{ok:true,url:'https://bad.test/p.html?id=x'}]) assert.throws(()=>canonicalPropertyURL(result,'http://127.0.0.1:8805'));
});
