import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/store.js';
import { FEATURES,OPERATIONS,RESOURCE,PURPOSE } from '../server/policy.js';
export const request=(hospitalId='A',extra={})=>({hospitalId,resource:RESOURCE,purpose:PURPOSE,features:FEATURES,operations:OPERATIONS,duration:24,quota:12,controls:['No patient identifiers','Aggregate model updates only','Four-feature allowlist'],...extra});
export async function harness(options={}){
 const root=mkdtempSync(join(tmpdir(),'veylance-test-'));const config={...loadConfig({}),dbFile:join(root,'veylance.db'),artifacts:join(root,'artifacts'),datasets:join(root,'datasets'),python:process.env.PYTHON_BIN??resolve('../.venv/bin/python'),...options};
 const ctx=createApp(config,options.testDependencies);const server=ctx.app.listen(0,'127.0.0.1');await once(server,'listening');ctx.bind(server);config.origin='http://127.0.0.1:'+server.address().port;
 const users={};for(const [id,roles,hospital] of [['manager',['manager'],null],['risk',['risk'],null],['owner',['owner'],null],['A',['requester'],'A'],['B',['requester'],'B'],['C',['requester'],'C']]){
  const sub='offline-test:'+id,sid=randomBytes(24).toString('hex'),csrf=randomBytes(24).toString('hex');ctx.store.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(sub,'Test '+id,JSON.stringify(roles),hospital);ctx.store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(sid),sub,csrf,Date.now()+3600000);users[id]={sub,name:'Test '+id,roles,hospital,cookie:'vl_sid='+sid,csrf};
 }
 const call=async(user,path,body)=>{const match=path.match(/\/warrants\/([^/]+)\/(?:reviews|accept)$/);if(match&&body)body={scopeVersion:ctx.policy.get(match[1]).scopeVersion,...body};const response=await fetch(config.origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:config.origin,...(user?{Cookie:users[user].cookie,'X-CSRF-Token':users[user].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();return {status:response.status,data};};
 async function approved(h='A',extra={}){let r=await call(h,'/api/v1/warrants',request(h,extra));if(r.status!==201)throw new Error(JSON.stringify(r));const id=r.data.id;for(const reviewer of ['manager','risk','owner']){r=await call(reviewer,'/api/v1/warrants/'+id+'/reviews',{});if(r.status!==200)throw new Error(JSON.stringify(r));}return id;}
 return {...ctx,root,config,server,users,call,approved,async stop(){await ctx.close();await new Promise(r=>server.close(r));ctx.store.close();}};
}
export async function waitFor(h,test,timeout=170000){const end=Date.now()+timeout;while(Date.now()<end){const j=h.training.current();if(j?.status==='failed')throw new Error(j.error);if(test(j))return j;await new Promise(r=>setTimeout(r,150));}throw new Error('Training timeout');}
