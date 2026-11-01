import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, request } from './helpers.js';
import { loadConfig } from '../server/config.js';

test('loopback local demo supports a real warrant request and independent approvals',async()=>{
 assert.throws(()=>loadConfig({LOCAL_LIVE_DEMO:'true',HOST:'0.0.0.0'}),/loopback HOST/);
 const h=await harness({localDemo:true});
 try{
  const send=async(actor,path,body)=>{
   const response=await fetch(h.config.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:h.config.origin,'Content-Type':'application/json','X-CSRF-Token':'local-demo-csrf',Cookie:`vl_local_actor=${actor}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json()};
  };
  const created=await send('A','/api/v1/warrants',request('A'));
  assert.equal(created.status,201);
  const id=created.data.id;
  assert.equal((await send('A',`/api/v1/warrants/${id}/reviews`,{scopeVersion:1})).status,403);
  for(const actor of ['manager','risk','owner'])assert.equal((await send(actor,`/api/v1/warrants/${id}/reviews`,{scopeVersion:1})).status,200);
  const snapshot=await send('owner','/api/v1/snapshot');
  assert.equal(snapshot.data.warrants.find(w=>w.id===id).status,'approved');
  assert.equal((await send('owner','/api/v1/training/sessions',{plannedRounds:4})).status,201);
 }finally{await h.stop();}
});
