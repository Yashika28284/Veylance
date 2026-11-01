import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, waitFor } from './helpers.js';

test('exhausted warrants produce an actionable error before a round starts',{timeout:180000},async()=>{
 const h=await harness();
 try{
  for(const hospital of ['A','B','C'])await h.approved(hospital,{quota:1});
  const created=await h.call('owner','/api/v1/training/sessions',{plannedRounds:2});
  const id=created.data.id;
  assert.equal((await h.call('owner',`/api/v1/training/${id}/advance`,{})).status,202);
  await waitFor(h,j=>j?.round===1&&j.status==='ready');
  const response=await h.call('owner',`/api/v1/training/${id}/advance`,{});
  assert.equal(response.status,409);
  assert.equal(response.data.code,'NO_CONTRIBUTIONS');
  assert.match(response.data.message,/Hospital A: exhausted/);
  assert.equal(h.training.get(id).status,'ready');
 }finally{await h.stop();}
});

test('notebook FedAvg trains through Flower, persists scalers, and predicts for the warrant holder', {timeout:180000}, async()=>{
 const h=await harness();
 try{
  const warrants={};
  for(const hospital of ['A','B','C'])warrants[hospital]=await h.approved(hospital,{quota:3});
  assert.equal((await h.call('owner','/api/v1/training/sessions',{plannedRounds:35})).status,201);
  assert.equal((await h.call('owner','/api/v1/training/sessions',{plannedRounds:0})).status,400);
  const created=await h.call('owner','/api/v1/training/sessions',{plannedRounds:3});
  assert.equal(created.status,201);
  assert.equal(created.data.experiment,'notebook-fedavg');
  assert.equal(created.data.round,0);
  assert.equal((await h.call('owner',`/api/v1/training/${created.data.id}/advance`,{})).status,202);
  const job=await waitFor(h,j=>j?.round===1&&j.status==='ready');
  assert.deepEqual(job.rounds[0].accepted.sort(),['A','B','C']);
  assert.equal(job.rounds[0].metrics.n,380);
  assert.equal(Number(job.rounds[0].metrics.accuracy.toFixed(4)),.5211);
  const artifact=JSON.parse(readFileSync(join(h.config.artifacts,`${job.id}-v1.json`)));
  assert.equal(artifact.experiment,'notebook-fedavg');
  assert.equal(artifact.hospitalScalers.A.minimum.length,4);
  const input={emergency_admission:1,prior_inpatient_visits:2,length_of_stay:5,medication_count:7};
  const predicted=await h.call('A',`/api/v1/warrants/${warrants.A}/predict`,{features:input});
  assert.equal(predicted.status,200);
  const x=Object.values(input).map((value,i)=>(value-artifact.hospitalScalers.A.minimum[i])/artifact.hospitalScalers.A.span[i]);
  const z=x.reduce((sum,value,i)=>sum+value*artifact.parameters.weight[i],artifact.parameters.bias[0]);
  assert.ok(Math.abs(predicted.data.probability-1/(1+Math.exp(-z)))<1e-12);
 }finally{await h.stop();}
});

test('notebook participation cutoff excludes B without revoking its warrant', {timeout:180000}, async()=>{
 const h=await harness();
 try{
  const warrants={};
  for(const hospital of ['A','B','C'])warrants[hospital]=await h.approved(hospital,{quota:20});
  const created=await h.call('owner','/api/v1/training/sessions',{experiment:'notebook-fedavg',plannedRounds:20});
  assert.equal(created.status,201);
  // Jump to the cutoff boundary to exercise the live coordinator without 14 redundant rounds.
  const job=h.training.get(created.data.id);
  job.round=14;
  h.store.put('jobs',job);
  assert.equal((await h.call('owner',`/api/v1/training/${job.id}/advance`,{})).status,202);
  const result=await waitFor(h,j=>j?.round===15&&j.status==='ready');
  assert.deepEqual(result.rounds[0].accepted.sort(),['A','C']);
  assert.equal(result.rounds[0].rejected.find(x=>x.hospitalId==='B').code,'NOTEBOOK_PARTICIPATION_CUTOFF');
  assert.equal(h.policy.get(warrants.B).used,0);
  assert.equal(h.policy.status(h.policy.get(warrants.B)),'approved');
 }finally{await h.stop();}
});
