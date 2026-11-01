import test from 'node:test';import assert from 'node:assert/strict';
import { harness,request } from './helpers.js';
import { FEATURES,RESOURCE,PURPOSE } from '../server/policy.js';
import { openStore } from '../server/store.js';
test('a requester assigned A, B and C can request a separate warrant for each hospital',async()=>{
 const h=await harness();try{
  const sub=h.users.A.sub;
  for(const hospital of ['A','B','C'])h.store.db.prepare('INSERT INTO user_hospitals(sub,hospital) VALUES(?,?)').run(sub,hospital);
  for(const hospital of ['A','B','C']){
   const response=await h.call('A','/api/v1/warrants',request(hospital));
   assert.equal(response.status,201);
   assert.equal(response.data.hospitalId,hospital);
   assert.equal(response.data.requesterId,sub);
  }
  h.store.db.prepare("DELETE FROM user_hospitals WHERE sub=? AND hospital='C'").run(sub);
  assert.equal((await h.call('A','/api/v1/warrants',request('C'))).status,403);
 }finally{await h.stop();}
});
test('independent roles, narrowing, consent, expiry, terminal state and scope validation',async()=>{
 const h=await harness();try{
  assert.equal((await h.call(null,'/api/v1/snapshot')).status,401);
  assert.equal((await h.call('A','/api/v1/warrants',request('B'))).status,403);
  assert.equal((await h.call('A','/api/v1/warrants',request('A',{features:[...FEATURES,'readmitted_lt30d']}))).status,400);
  const id=(await h.call('A','/api/v1/warrants',request())).data.id;
  assert.equal((await h.call('A',`/api/v1/warrants/${id}/reviews`,{})).data.code,'SELF_APPROVAL');
  h.store.db.prepare('UPDATE users SET roles=? WHERE sub=?').run(JSON.stringify(['manager','risk']),h.users.manager.sub);
  await h.call('manager',`/api/v1/warrants/${id}/reviews`,{slot:'manager'});
  assert.equal((await h.call('manager',`/api/v1/warrants/${id}/reviews`,{slot:'risk'})).data.code,'DISTINCT_REVIEWERS');
  assert.equal((await h.call('risk',`/api/v1/warrants/${id}/reviews`,{scopeVersion:0})).data.code,'SCOPE_VERSION');
  const original=h.policy.get(id),scope={features:FEATURES.slice(0,3),operations:['submit_update'],quota:5,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const narrowed=await h.call('risk',`/api/v1/warrants/${id}/reviews`,{scope});assert.equal(narrowed.status,200);assert.equal(narrowed.data.scopeVersion,2);assert.equal(narrowed.data.reviews.length,1);
  assert.equal((await h.call('owner',`/api/v1/warrants/${id}/reviews`,{scope:{...scope,features:FEATURES}})).data.code,'EXPANSION_DENIED');
  await h.call('manager',`/api/v1/warrants/${id}/reviews`,{});const r=await h.call('owner',`/api/v1/warrants/${id}/reviews`,{});assert.equal(r.data.status,'awaiting_acceptance');
  assert.equal((await h.call('B',`/api/v1/warrants/${id}/accept`,{})).status,403);assert.equal((await h.call('A',`/api/v1/warrants/${id}/accept`,{})).data.status,'approved');
  const w=h.policy.get(id),p={hospitalId:'A',resource:RESOURCE,purpose:PURPOSE,operation:'submit_update',features:scope.features,scopeVersion:2};
  assert.equal(h.policy.authorize(w,p).id,id);
  for(const [patch,code] of [[{purpose:'advertising'},'PURPOSE_MISMATCH'],[{resource:'other'},'RESOURCE_MISMATCH'],[{operation:'download_model'},'OPERATION_DENIED'],[{features:['age_band']},'FEATURE_DENIED'],[{scopeVersion:1},'SCOPE_VERSION'],[{hospitalId:'B'},'HOSPITAL_MISMATCH']])assert.throws(()=>h.policy.authorize(w,{...p,...patch}),e=>e.code===code);
  assert.throws(()=>h.policy.authorize({...w,used:w.quota},p),e=>e.code==='EXHAUSTED');assert.throws(()=>h.policy.authorize({...w,expiresAt:new Date(0).toISOString()},p),e=>e.code==='EXPIRED');
  assert.equal((await h.call('A',`/api/v1/warrants/${id}/revoke`,{reason:'x'})).status,403);assert.equal((await h.call('owner',`/api/v1/warrants/${id}/revoke`,{reason:'Scope withdrawn'})).data.status,'revoked');assert.throws(()=>h.policy.authorize(h.policy.get(id),p),e=>e.code==='REVOKED');
  const rejected=(await h.call('B','/api/v1/warrants',request('B'))).data.id;await h.call('risk',`/api/v1/warrants/${rejected}/reviews`,{decision:'reject'});assert.equal((await h.call('owner',`/api/v1/warrants/${rejected}/reviews`,{})).status,409);
  assert.ok(h.store.verify().valid);
 }finally{await h.stop();}
});
test('CSRF, unknown APIs, NamoID blocker and callback rejection do not provide bypasses',async()=>{
 const h=await harness();try{
  for(const path of ['/api/v1/warrants','/api/v1/training/sessions']){const r=await fetch(h.config.origin+path,{method:'POST',headers:{Cookie:h.users.owner.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);}
  assert.equal((await h.call(null,'/api/ready')).status,503);assert.equal((await h.call(null,'/auth/login')).status,503);assert.equal((await h.call(null,'/auth/callback?state=x&code=x')).status,400);
  assert.equal((await h.call(null,'/auth/demo',{})).status,404);assert.equal((await h.call(null,'/.env')).status,404);assert.equal((await h.call(null,'/api/unknown')).status,404);assert.equal((await h.call(null,'/worker/authorize',{})).status,401);
  const r=await fetch(h.config.origin+'/api/v1/warrants',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);
 }finally{await h.stop();}
});
test('ledger verifies range and trusted checkpoint and detects deliberate storage tampering',async()=>{
 const h=await harness();try{await h.approved();const result=h.store.verify();assert.ok(result.valid);assert.ok(result.count>=4);assert.deepEqual(result.range,[1,result.count]);assert.equal(result.independentCheckpointSupplied,false);
  assert.ok(h.store.verify({seq:result.count,hash:result.head}).independentCheckpointVerified);assert.equal(h.store.verify({seq:result.count,hash:'f'.repeat(64)}).valid,false);
  h.store.db.prepare('UPDATE ledger SET data=? WHERE seq=2').run('{"tampered":true}');const broken=h.store.verify();assert.equal(broken.valid,false);assert.equal(broken.firstInvalid,2);
 }finally{await h.stop();}
});
