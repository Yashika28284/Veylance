import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createPolicy,Fault,FEATURES,OPERATIONS,RESOURCE,PURPOSE } from './policy.js';
import { setupAuth } from './auth.js';
import { createTraining } from './training.js';
export function createApp(config,{store=openStore(config.dbFile),now=()=>Date.now(),spawnProcess}={}){
 const app=express(),policy=createPolicy(store,now),training=createTraining(store,policy,config,now,{spawnProcess});app.disable('x-powered-by');
 if(config.localDemo){
  const controls=['No patient identifiers','Aggregate model updates only','Four-feature allowlist'];
  for(const hospitalId of ['A','B','C']){
   const existing=store.list('warrants').findLast(w=>w.hospitalId===hospitalId&&policy.status(w)==='approved');
   if(existing)continue;
   const requester={sub:`local-demo:requester:${hospitalId}`,name:`Local demo · Hospital ${hospitalId}`,roles:['requester'],hospital:hospitalId};
   const warrant=policy.request(requester,{hospitalId,resource:RESOURCE,purpose:PURPOSE,features:FEATURES,operations:OPERATIONS,duration:72,quota:20,controls});
   for(const role of ['manager','risk','owner'])policy.review({sub:`local-demo:${role}`,name:`Local demo ${role}`,roles:[role],hospital:null},warrant.id,{scopeVersion:warrant.scopeVersion,decision:'approve'});
  }
 }
 // A restarted process cannot silently resume an update whose worker credentials were lost.
 for(const j of store.list('jobs'))if(['preparing','running','queued','finishing'].includes(j.status)){j.status='failed';j.error='Server restarted during a round. Create a fresh session; committed models and decisions remain.';store.put('jobs',j);}
 app.use((req,res,next)=>{req.id=randomUUID();res.set({'X-Request-ID':req.id,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(),microphone=(),geolocation=()','Cache-Control':'no-store'});if(config.production)res.set('Strict-Transport-Security','max-age=31536000');res.on('finish',()=>{if(!req.path.startsWith('/internal')&&!req.path.startsWith('/worker'))console.log(JSON.stringify({time:new Date().toISOString(),requestId:req.id,path:req.path,status:res.statusCode}));});next();});
 app.use(express.json({limit:'128kb',strict:true}));
 const auth=setupAuth(app,store,config,now);
 const session=(req,res)=>res.json({user:req.user,csrfToken:req.session.csrf});
 app.get('/api/health',(_req,res)=>res.json({ok:true,database:'connected',synthetic:true}));
 app.get('/api/ready',(_req,res)=>{const ledger=store.verify(),ready=auth.ready()&&ledger.valid;res.status(ready?200:503).json({ok:ready,namoidConfigured:!!config.issuer,localDemo:!!config.localDemo,ledger:ledger.valid,blocker:ready?null:'NamoID issuer/client authentication settings missing'});});
 const api=express.Router();api.use(auth.readUser);api.get('/session',session);
 function snapshot(user){const j=training.current(),warrants=store.list('warrants');return {schema:1,clock:new Date(now()).toISOString(),user,provenance:{kind:'measured',label:'Measured on synthetic data'},hospitals:['A','B','C'].map((id,i)=>({id,name:'Hospital '+id,subtitle:['Northfield Research Hospital','Westbridge Medical Centre','Oakridge University Hospital'][i],records:(j?.experiment==='notebook-fedavg'?{A:640,B:480,C:400}:{A:540,B:468,C:612})[id],baseline:j?.baselines.find(b=>b.hospitalId===id)?.evaluation.pooled.accuracy??null})),warrants:warrants.map(w=>({...w,status:policy.status(w)})),rounds:j?.rounds??[],events:store.db.prepare('SELECT id,data FROM events ORDER BY id').all().map(r=>({...JSON.parse(r.data),id:r.id})),audit:store.ledger(),session:j?{id:j.id,status:j.status,experiment:j.experiment??'legacy',round:j.round,plannedRounds:j.plannedRounds,error:j.error?.includes('HTTP Error 409')&&j.bindings.every(b=>policy.status(policy.get(b.warrantId))==='exhausted')?'All three bound warrants have exhausted their contribution allowances. Request and approve new warrants, then start a new session.':j.error,bindings:j.bindings,baselines:j.baselines}:null,scenario:0};}
 api.get('/snapshot',(req,res)=>res.json(snapshot(req.user)));
 api.get('/warrants',(_req,res)=>res.json(store.list('warrants')));
 const publicJob=j=>j?Object.fromEntries(Object.entries(j).filter(([k])=>k!=='parameters')):null;
 api.get('/training',(_req,res)=>res.json(publicJob(training.current())));
 api.get('/audit/verify',(_req,res)=>res.json(store.verify()));
 api.use(auth.csrf);
 api.post('/audit/verify',(req,res)=>{const p=req.body.checkpoint??null;if(p&&(!Number.isInteger(p.seq)||!/^[a-f0-9]{64}$/.test(p.hash)))throw new Fault('CHECKPOINT','Invalid checkpoint',400);res.json(store.verify(p));});
 api.post('/warrants',(req,res)=>res.status(201).json(policy.request(req.user,req.body)));
 api.post('/warrants/:id/reviews',(req,res)=>res.json(policy.review(req.user,req.params.id,req.body)));
 api.post('/warrants/:id/accept',(req,res)=>res.json(policy.accept(req.user,req.params.id,req.body)));
 api.post('/warrants/:id/revoke',(req,res)=>res.json(policy.revoke(req.user,req.params.id,req.body.reason)));
 api.post('/warrants/:id/download',(req,res)=>res.type('application/json').attachment('veylance-model.json').send(training.download(req.user,req.params.id)));
 api.post('/warrants/:id/predict',(req,res)=>res.json(training.predict(req.user,req.params.id,req.body.features)));
 api.post('/training/sessions',(req,res)=>res.status(201).json(publicJob(training.create(req.user,req.body.plannedRounds??4,req.body.experiment??'notebook-fedavg'))));
 api.post('/training/:id/advance',async(req,res)=>res.status(202).json(publicJob(await training.start(req.user,req.params.id,!!req.body.pauseBeforeAcceptance))));
 api.post('/training/:id/commit',(req,res)=>res.json(publicJob(training.commit(req.user,req.params.id))));
 api.post('/training/:id/restricted-attempt',async(req,res)=>res.json(await training.restricted(req.user,req.params.id)));
 app.use('/api/v1',api);app.use('/api',(_req,res)=>res.status(404).json({code:'NOT_FOUND',message:'Unknown API route'}));
 const bearer=req=>(req.get('authorization')??'').startsWith('Bearer ')?req.get('authorization').slice(7):'';
 app.post('/worker/authorize',(req,res)=>{training.authWorker(bearer(req),req.body);res.json({allowed:true});});
 app.post('/internal/finalize',(req,res)=>res.json(training.finalize(bearer(req),req.body)));
 app.post('/internal/complete',(req,res)=>res.json(training.complete(bearer(req),req.body)));
 app.get('/runtime-config.js',(_req,res)=>res.type('application/javascript').send(config.localDemo?"window.VEYLANCE_CONFIG={mode:'live',localDemo:true};":"window.VEYLANCE_CONFIG={mode:location.pathname.startsWith('/demo')?'demo':'live'};"));
 const dist=fileURLToPath(new URL('../dist/',import.meta.url));app.use(express.static(dist,{dotfiles:'deny',fallthrough:true,index:'index.html'}));
 app.get('/demo/',(_req,res)=>res.sendFile(dist+'index.html'));
 app.use((_req,res)=>res.status(404).type('text').send('Not found'));
 app.use((e,req,res,_next)=>{const status=e instanceof Fault?e.status:e.type==='entity.parse.failed'?400:e.type==='entity.too.large'?413:500;res.status(status).json({code:e.code??(status===500?'INTERNAL_ERROR':'BAD_REQUEST'),message:status===500?'Request failed; inspect the server configuration.':e.message,requestId:req.id});if(status===500)console.error(JSON.stringify({requestId:req.id,error:e.name}));});
 return {app,store,policy,training,snapshot,bind:server=>training.bindAddress('http://127.0.0.1:'+server.address().port),close:()=>training.close()};
}
