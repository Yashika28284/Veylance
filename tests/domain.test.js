import test from 'node:test';import assert from 'node:assert/strict';
import {createDemoAdapter} from '../dist/js/adapters/demo.js';
import {createLiveAdapter} from '../dist/js/adapters/live.js';
import {authorize,FEATURES,RESOURCE,PURPOSE,validateNarrowing} from '../dist/js/domain.js';
import {createFixtures} from '../dist/js/fixtures.js';
const isolated=()=>createDemoAdapter({getItem:()=>null,setItem:()=>{}});
const request={hospitalId:'A',duration:24,quota:6,resource:RESOURCE,purpose:PURPOSE,features:FEATURES,operations:['submit_update'],controls:['No patient identifiers']};
test('repeatable guided scenario produces a denied feature, revoked contribution and continued A/C rounds',async()=>{
 const a=isolated();let s=await a.load();assert.equal(s.warrants.filter(w=>w.status==='approved').length,3);
 s=await a.command('advanceRound');assert.equal(s.rounds.at(-1).number,5);assert.equal(s.scenario,1);
 s=await a.command('restrictedAttempt');assert.equal(s.events.at(-1).code,'FEATURE_DENIED');assert.equal(s.warrants[1].features.includes('age_band'),false);
 s=await a.command('revoke',{id:'WRT-2026-002',actorId:'reviewer-manager',reason:'Scope review'});
 s=await a.command('advanceRound');assert.deepEqual(s.rounds.at(-1).accepted,['A','C']);assert.equal(s.rounds.at(-1).rejected[0].code,'REVOKED');assert.equal(s.warrants[1].used,5);
 s=await a.command('advanceRound');assert.deepEqual(s.rounds.at(-1).accepted,['A','C']);assert.equal(s.rounds.at(-1).rejected.length,0);assert.equal(s.scenario,5);
 assert.equal(s.rounds[0].accepted.includes('B'),true);assert.ok(s.audit.some(e=>e.action==='Warrant revoked'));
 assert.equal((await a.verifyLedger()).valid,true);assert.equal((await a.verifyLedger()).cryptographic,false);
 s=await a.command('reset');assert.equal(s.events.length,0);assert.equal(s.rounds.length,4);assert.equal(s.warrants[1].status,'approved');
});
test('narrowed scope needs three distinct reviewers and original requester consent',async()=>{
 const a=isolated();let s=await a.command('request',request);const id=s.warrants.at(-1).id;
 await assert.rejects(a.command('review',{id,actorId:'requester-A'}),/Self-approval/);
 s=await a.command('narrow',{id,actorId:'reviewer-manager',scope:{features:FEATURES.slice(0,3),operations:['submit_update'],quota:4,expiresAt:'2026-11-01T08:00:00.000Z'}});
 await assert.rejects(a.command('review',{id,actorId:'reviewer-manager'}),/already approved/);
 s=await a.command('review',{id,actorId:'reviewer-risk'});assert.equal(s.warrants.at(-1).status,'pending');
 s=await a.command('review',{id,actorId:'reviewer-owner'});assert.equal(s.warrants.at(-1).status,'awaiting_acceptance');
 await assert.rejects(a.command('accept',{id,actorId:'requester-B'}),/original requester/);
 s=await a.command('accept',{id,actorId:'requester-A'});assert.equal(s.warrants.at(-1).status,'approved');assert.ok(s.warrants.at(-1).consentAt);
});
test('later narrowing clears earlier approvals and expansion fails atomically',async()=>{
 const a=isolated();let s=await a.command('request',request);const id=s.warrants.at(-1).id;
 await a.command('review',{id,actorId:'reviewer-manager'});
 s=await a.command('narrow',{id,actorId:'reviewer-risk',scope:{features:FEATURES.slice(0,2),operations:['submit_update'],quota:3,expiresAt:'2026-11-01T08:00:00.000Z'}});
 assert.equal(s.warrants.at(-1).reviews.length,1);assert.equal(s.warrants.at(-1).reviews[0].role,'risk');
 const before=await a.load();await assert.rejects(a.command('narrow',{id,actorId:'reviewer-owner',scope:{features:[...FEATURES,'age_band'],operations:['submit_update'],quota:3,expiresAt:'2026-11-01T08:00:00.000Z'}}),/subset/);assert.deepEqual(await a.load(),before);
});
test('expiry, quota, purpose, operation and restricted fields are denied',()=>{
 const s=createFixtures(),w=s.warrants[0],req={resource:RESOURCE,purpose:PURPOSE,operation:'submit_update',features:FEATURES};
 assert.equal(authorize(w,req,s.clock).allowed,true);
 assert.equal(authorize({...w,expiresAt:s.clock},req,s.clock).code,'EXPIRED');
 assert.equal(authorize({...w,used:w.quota},req,s.clock).code,'EXHAUSTED');
 assert.equal(authorize(w,{...req,purpose:'advertising'},s.clock).code,'PURPOSE_MISMATCH');
 assert.equal(authorize(w,{...req,resource:'other'},s.clock).code,'RESOURCE_MISMATCH');
 assert.equal(authorize(w,{...req,features:['age_band']},s.clock).code,'FEATURE_DENIED');
 assert.equal(authorize(w,{...req,operation:'export_data'},s.clock).code,'OPERATION_DENIED');
 assert.throws(()=>validateNarrowing(w,{features:[],operations:w.operations,quota:1,expiresAt:w.expiresAt}),/nonempty/);
});
test('restricted requests and malformed allowances never enter pending review',async()=>{
 const a=isolated();await assert.rejects(a.command('request',{...request,features:['age_band']}),/approved model features/);await assert.rejects(a.command('request',{...request,quota:1.5}),/allowance/);assert.equal((await a.load()).warrants.length,3);
});
test('rejection is final and a requester cannot revoke',async()=>{const a=isolated();let s=await a.command('request',request);const id=s.warrants.at(-1).id;s=await a.command('reject',{id,actorId:'reviewer-risk'});assert.equal(s.warrants.at(-1).status,'rejected');await assert.rejects(a.command('review',{id,actorId:'reviewer-owner'}),/not awaiting/);await assert.rejects(a.command('revoke',{id:'WRT-2026-001',actorId:'requester-A'}),/demo reviewer/);});
test('security probes do not change active warrants',async()=>{const a=isolated();const before=(await a.load()).warrants;for(const kind of ['PURPOSE_MISMATCH','EXPIRED','EXHAUSTED'])await a.command('probe',{kind});const s=await a.load();assert.deepEqual(s.warrants,before);assert.equal(s.events.length,3);assert.ok(s.events.every(e=>e.sandbox));});
test('live adapter never falls back to demo and removes untrusted actor identity',async()=>{
 let sent;const a=createLiveAdapter(async(url,options)=>{sent={url,options};return {ok:true,json:async()=>url.endsWith('/session')?{csrfToken:'test-token'}:{}};});
 await a.load();await a.command('revoke',{id:'abc',actorId:'imposter',reason:'x'});assert.equal(sent.url,'/api/v1/snapshot');
 const b=createLiveAdapter(async(url,options)=>{if(url.includes('/revoke')){assert.equal(JSON.parse(options.body).actorId,undefined);assert.equal(options.credentials,'same-origin');}return {ok:true,json:async()=>({})};});await b.command('revoke',{id:'abc',actorId:'imposter'});await assert.rejects(b.command('reset'),/confined to demo/);
 const failed=createLiveAdapter(async()=>({ok:false,status:503,json:async()=>({message:'No backend'})}));await assert.rejects(failed.load(),/No backend/);
});
