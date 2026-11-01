import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness} from './helpers.js';
import {canonical,hash} from '../server/store.js';
import {FEATURES} from '../server/policy.js';

test('requester prediction uses a bound, approved model artifact and denies other identities',async()=>{
 const h=await harness();try{
  const id=await h.approved('A');await h.approved('B');await h.approved('C');
  const created=await h.call('owner','/api/v1/training/sessions',{plannedRounds:3,experiment:'legacy'});assert.equal(created.status,201);
  const job=h.training.current();const artifact={sessionId:job.id,version:1,features:FEATURES,parameters:{weight:[1,0,0,0],bias:[0]}};
  const bytes=Buffer.from(canonical(artifact));mkdirSync(h.config.artifacts,{recursive:true});writeFileSync(join(h.config.artifacts,`${job.id}-v1.json`),bytes);
  job.round=1;job.modelHash=hash(bytes);h.store.put('jobs',job);
  const path=`/api/v1/warrants/${id}/predict`,features={emergency_admission:1,prior_inpatient_visits:2,length_of_stay:4,medication_count:7};
  const result=await h.call('A',path,{features});assert.equal(result.status,200);assert.ok(Math.abs(result.data.probability-0.7310585786)<1e-8);assert.equal(result.data.prediction,1);
  assert.equal((await h.call('B',path,{features})).status,403);
  assert.equal((await h.call('A',path,{features:{...features,age_band:3}})).status,400);
  h.policy.revoke(h.users.risk,id,'test');assert.equal((await h.call('A',path,{features})).status,403);
 }finally{await h.stop();}
});
