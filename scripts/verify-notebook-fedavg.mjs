// Runs the complete notebook experiment through the real Flower and warrant gateway.
// Uses offline test identities and a temporary database; never changes live data.
import assert from 'node:assert/strict';
import { harness, waitFor } from '../tests/helpers.js';

const expected=[.5211,.5237,.5316,.5342,.5342,.5421,.5474,.5526,.5579,.5605,
 .5632,.5737,.5789,.5895,.5921,.5974,.6132,.6105,.6079,.6079];
const h=await harness();
try{
 for(const hospital of ['A','B','C'])await h.approved(hospital,{quota:20});
 const created=await h.call('owner','/api/v1/training/sessions',{experiment:'notebook-fedavg',plannedRounds:20});
 assert.equal(created.status,201,JSON.stringify(created.data));
 for(let round=1;round<=20;round++){
  const start=await h.call('owner',`/api/v1/training/${created.data.id}/advance`,{});
  assert.equal(start.status,202,JSON.stringify(start.data));
  const job=await waitFor(h,j=>j?.round===round&&j.status===(round===20?'completed':'ready'));
  const result=job.rounds.at(-1);
  assert.equal(Number(result.metrics.accuracy.toFixed(4)),expected[round-1],`round ${round}`);
  console.log(JSON.stringify({round,accuracy:Number(result.metrics.accuracy.toFixed(4)),
   precision:Number(result.metrics.precision.toFixed(4)),
   recall:Number(result.metrics.recall.toFixed(4)),
   f1:Number(result.metrics.f1.toFixed(4)),
   accepted:result.accepted}));
 }
 console.log('PASS: all 20 Flower rounds match the notebook accuracy curve.');
}finally{await h.stop();}
