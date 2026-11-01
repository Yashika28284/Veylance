import test from 'node:test';import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,copyFileSync } from 'node:fs';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import { harness,waitFor } from './helpers.js';import { hash,openStore } from '../server/store.js';
test('actual three-client Flower run, live restricted-feature denial, queued revocation and continued A/C training',{timeout:360000},async()=>{
 const h=await harness();try{
  const ids={};for(const hospital of ['A','B','C'])ids[hospital]=await h.approved(hospital);
  let r=await h.call('owner','/api/v1/training/sessions',{plannedRounds:3,experiment:'legacy'});assert.equal(r.status,201);const id=r.data.id;
  assert.equal((await h.call('A',`/api/v1/training/${id}/advance`,{})).status,403);
  assert.equal((await h.call('owner',`/api/v1/training/${id}/advance`,{})).status,202);
  let j=await waitFor(h,j=>j?.round===1&&j.status==='ready');assert.deepEqual(j.rounds[0].accepted.sort(),['A','B','C']);assert.equal(j.rounds[0].metrics.n,540);
  r=await h.call('owner',`/api/v1/training/${id}/restricted-attempt`,{});assert.equal(r.data.allowed,false);assert.equal(r.data.code,'FEATURE_DENIED');
  // Let all clients train and queue before revocation, then reauthorize on acceptance.
  await new Promise(r=>setTimeout(r,500));assert.equal((await h.call('owner',`/api/v1/training/${id}/advance`,{pauseBeforeAcceptance:true})).status,202);await waitFor(h,j=>j?.status==='queued');
  await h.call('risk',`/api/v1/warrants/${ids.B}/revoke`,{reason:'Live API scope review'});await h.call('owner',`/api/v1/training/${id}/commit`,{});
  j=await waitFor(h,j=>j?.round===2&&j.status==='ready');assert.deepEqual(j.rounds[1].accepted.sort(),['A','C']);assert.equal(j.rounds[1].rejected.find(x=>x.hospitalId==='B').code,'REVOKED');assert.equal(h.policy.get(ids.B).used,1);
  await new Promise(r=>setTimeout(r,500));await h.call('owner',`/api/v1/training/${id}/advance`,{});j=await waitFor(h,j=>j?.status==='completed');assert.deepEqual(j.rounds[2].accepted.sort(),['A','C']);
  const snapshot=(await h.call('owner','/api/v1/snapshot')).data;assert.ok(snapshot.events.some(e=>e.code==='FEATURE_DENIED'));assert.ok(snapshot.events.some(e=>e.code==='REVOKED'));assert.equal(snapshot.rounds.length,3);assert.ok(h.store.verify().valid);
  assert.equal((await h.call('B','/api/v1/training')).data.parameters,undefined);assert.equal((await h.call(null,`/artifacts/${id}-v3.json`)).status,404);
  const bytes=readFileSync(join(h.config.artifacts,`${id}-v3.json`));assert.equal(hash(bytes),j.modelHash);
  r=await h.call('B',`/api/v1/warrants/${ids.B}/download`,{});assert.equal(r.status,403);
  const dl=await fetch(h.config.origin+`/api/v1/warrants/${ids.A}/download`,{method:'POST',headers:{Cookie:h.users.A.cookie,Origin:h.config.origin,'X-CSRF-Token':h.users.A.csrf,'Content-Type':'application/json'},body:'{}'});assert.equal(dl.status,200);assert.equal(hash(Buffer.from(await dl.arrayBuffer())),j.modelHash);
  const persisted=openStore(h.config.dbFile);assert.equal(persisted.get('jobs',id).modelHash,j.modelHash);persisted.close();
  mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/executed-session.json',JSON.stringify({label:'Executed automated test harness · offline test identities · actual Flower training',session:j,snapshot,ledger:h.store.verify()},null,2));
  for(const round of j.rounds)copyFileSync(join(h.config.artifacts,`${id}-v${round.number}.json`),`docs/evidence/model-v${round.number}.json`);
  copyFileSync(join(h.config.datasets,'metadata.json'),'docs/evidence/dataset-metadata.json');
  const backup=join(h.root,'backup');const env={...process.env,APP_ORIGIN:h.config.origin,DB_FILE:h.config.dbFile,ARTIFACTS_DIR:h.config.artifacts};
  execFileSync(process.execPath,['scripts/admin.mjs','backup',backup],{env});
  const restored=join(h.root,'restored.db'),artifacts=join(h.root,'restored-artifacts');execFileSync(process.execPath,['scripts/admin.mjs','restore',backup],{env:{...env,DB_FILE:restored,ARTIFACTS_DIR:artifacts,RESTORE_OFFLINE:'yes'}});
  const restoredStore=openStore(restored);assert.equal(restoredStore.get('jobs',id).modelHash,j.modelHash);assert.ok(restoredStore.verify().valid);restoredStore.close();assert.equal(hash(readFileSync(join(artifacts,`${id}-v3.json`))),j.modelHash);
 }finally{await h.stop();}
});
