// Automated browser QA only. This file is never imported by the application entry point.
import express from 'express';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/store.js';
const root=mkdtempSync(join(tmpdir(),'veylance-browser-qa-'));
const portIndex=process.argv.indexOf('--port');
const config={...loadConfig(),port:portIndex<0?Number(process.env.PORT??3000):Number(process.argv[portIndex+1]),host:'0.0.0.0',dbFile:join(root,'qa.db'),artifacts:join(root,'artifacts')};
const ctx=createApp(config);const evidence=JSON.parse(readFileSync(new URL('../docs/evidence/executed-session.json',import.meta.url),'utf8'));
ctx.store.put('jobs',evidence.session);for(const w of evidence.snapshot.warrants)ctx.store.put('warrants',w);
for(const e of evidence.snapshot.events)ctx.store.db.prepare('INSERT INTO events(data) VALUES(?)').run(JSON.stringify(e));
for(const a of evidence.snapshot.audit)ctx.store.audit(a.actor,a.action,a.warrantId,{hospitalId:a.hospitalId,detail:a.detail},a.at);
const sid=randomBytes(24).toString('hex'),csrf=randomBytes(24).toString('hex');ctx.store.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('qa-browser','Offline identity · browser test harness',JSON.stringify(['owner']),null);ctx.store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(sid),'qa-browser',csrf,Date.now()+3600000);
const wrapper=express();
wrapper.get('/qa-demo-config.js',(_req,res)=>res.type('application/javascript').send("window.VEYLANCE_CONFIG={mode:'demo'};location.hash='/overview';"));
wrapper.get('/qa-mobile',(_req,res)=>res.type('html').send(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').replace('/runtime-config.js','/qa-demo-config.js')));
wrapper.get('/qa-responsive',(_req,res)=>{
 res.type('html').send(`<html><head><title>Veylance · responsive browser test harness</title></head><body style="background:#DFE3D8;font:14px Arial;margin:24px"><h1>390px mobile viewport · automated browser test</h1><p>Interactive demo · synthetic fixtures · iframe used to exercise responsive CSS.</p><iframe title="Mobile Veylance" width="390" height="844" style="border:1px solid #A58A50;background:#F5F2E9" src="/qa-mobile"></iframe></body></html>`);
});
wrapper.use((req,res,next)=>{if(!req.path.startsWith('/demo'))res.append('Set-Cookie',`vl_sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);next();});wrapper.use(ctx.app);
const server=wrapper.listen(config.port,config.host,()=>{ctx.bind(server);console.log('Automated browser test harness; offline identity, persisted measured evidence');});
process.on('SIGTERM',async()=>{await ctx.close();server.close(()=>process.exit(0));});
