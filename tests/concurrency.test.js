import test from 'node:test';import assert from 'node:assert/strict';import { EventEmitter } from 'node:events';import { createHmac } from 'node:crypto';
import { harness } from './helpers.js';import { FEATURES,RESOURCE,PURPOSE } from '../server/policy.js';
test('atomic idempotent API acceptance, concurrent duplicates, signatures, dimensions, binding, quotas and revocation',async()=>{
 let config;const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin={end:x=>config=JSON.parse(x)};c.kill=()=>queueMicrotask(()=>c.emit('exit',1));return c;};
 const h=await harness({testDependencies:{spawnProcess}});try{
  const ids={};for(const hospital of ['A','B','C'])ids[hospital]=await h.approved(hospital,{quota:1});
  const session=(await h.call('owner','/api/v1/training/sessions',{plannedRounds:3,experiment:'legacy'})).data;await h.call('owner',`/api/v1/training/${session.id}/advance`,{});
  const envelope=(hospital,patch={})=>{const w=config.workers.find(w=>w.hospitalId===hospital);const p={sessionId:session.id,hospitalId:hospital,round:1,modelVersion:0,baseHash:null,scopeVersion:w.scopeVersion,resource:RESOURCE,purpose:PURPOSE,features:FEATURES,parameters:{weight:[.1,.2,.3,.4],bias:[.1]},numExamples:{A:540,B:468,C:612}[hospital],...patch};const payload=JSON.stringify(p);return {hospitalId:hospital,payload,signature:createHmac('sha256',w.token).update(payload).digest('hex')};};
  const finalize=async updates=>{const r=await fetch(h.config.origin+'/internal/finalize',{method:'POST',headers:{authorization:'Bearer '+config.coordinator,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id,round:1,updates})});return {status:r.status,data:await r.json()};};
  let r=await finalize([{...envelope('A'),signature:'0'.repeat(64)}]);assert.equal(r.status,409);assert.equal(h.policy.get(ids.A).used,0);
  r=await finalize([envelope('A',{parameters:{weight:[1],bias:[0]}})]);assert.equal(r.status,409);assert.equal(h.policy.get(ids.A).used,0);
  r=await finalize([envelope('A',{baseHash:'stale'})]);assert.equal(r.status,409);
  r=await finalize([envelope('A',{scopeVersion:88})]);assert.equal(r.status,409);
  r=await finalize([envelope('A',{parameters:{weight:[null,0,0,0],bias:[0]}})]);assert.equal(r.status,409);
  const replies=await Promise.all(Array.from({length:12},()=>finalize([envelope('A')])));assert.ok(replies.every(r=>r.status===200));assert.equal(h.policy.get(ids.A).used,1);assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM contributions').get().n,1);
  r=await finalize([envelope('A',{parameters:{weight:[.2,.2,.3,.4],bias:[.1]}})]);assert.equal(r.status,409);assert.equal(h.policy.get(ids.A).used,1);
  await h.call('risk',`/api/v1/warrants/${ids.B}/revoke`,{reason:'Before acceptance'});r=await finalize([envelope('B')]);assert.equal(r.status,409);assert.equal(h.policy.get(ids.B).used,0);
  const job=h.training.get(session.id);job.round=1;h.store.put('jobs',job);const w=config.workers.find(w=>w.hospitalId==='A');assert.throws(()=>h.training.accept(w.token,{...JSON.parse(envelope('A').payload),round:2,modelVersion:1}),e=>e.code==='EXHAUSTED');
  assert.ok(h.store.verify().valid);
 }finally{await h.stop();}
});
