import { spawn } from 'node:child_process';
import { randomBytes,randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import { mkdirSync,writeFileSync,renameSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical,hash } from './store.js';
import { fail,FEATURES,RESOURCE,PURPOSE } from './policy.js';
const token=()=>randomBytes(32).toString('base64url');
const NOTEBOOK='notebook-fedavg';
const notebookInitial={weight:[0.3822692632675171,0.4150039553642273,-0.11713624000549316,0.45930564403533936],bias:[-0.10955178737640381]};
const sampleCounts={legacy:{A:540,B:468,C:612},[NOTEBOOK]:{A:640,B:480,C:400}};
export const validParameters=p=>p&&Array.isArray(p.weight)&&p.weight.length===4&&Array.isArray(p.bias)&&p.bias.length===1&&[...p.weight,...p.bias].every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=10000);
export function createTraining(store,policy,config,now,{spawnProcess=spawn}={}){
 const running=new Map(),identities=new Map(),coordinators=new Map();let address;
 const put=j=>{j.updatedAt=new Date(now()).toISOString();store.put('jobs',j);};
 const get=id=>store.get('jobs',id)??fail('NO_SESSION','Training session not found',404);
 const current=()=>store.list('jobs').at(-1)??null;
 function issue(j){for(const b of j.bindings){const k=token();identities.set(k,{job:j.id,...b});}const k=token();coordinators.set(k,j.id);return k;}
 function worker(k){return identities.get(k)??fail('WORKER_AUTH','Worker credential is invalid or expired',401);}
 function authWorker(k,p){const b=worker(k),j=get(b.job);const w=policy.get(b.warrantId);if(p.sessionId!==j.id||p.hospitalId!==b.hospitalId)fail('WORKER_BINDING','Worker session/hospital mismatch');return policy.authorize(w,p);}
 function create(user,planned=4,experiment=NOTEBOOK){if(!user.roles.includes('owner'))fail('OWNER_REQUIRED','Resource owner required');if(!['legacy',NOTEBOOK].includes(experiment))fail('EXPERIMENT','Unknown training experiment',400);if(!Number.isSafeInteger(planned)||planned<1)fail('ROUND_COUNT','Choose a positive whole number of rounds',400);
  if(store.list('jobs').some(j=>['running','preparing','queued','finishing'].includes(j.status)))fail('TRAINING_BUSY','An existing training process is active',409);
  const ws=store.list('warrants');const bindings=['A','B','C'].map(h=>{const w=ws.findLast(w=>w.hospitalId===h&&policy.status(w)==='approved');if(!w||FEATURES.some(f=>!w.features.includes(f))||['train_local','submit_update','download_model'].some(op=>!w.operations.includes(op)))fail('WARRANT_REQUIRED',`Hospital ${h} requires an approved four-feature training warrant`,409);return {hospitalId:h,warrantId:w.id,scopeVersion:w.scopeVersion};});
  const j={id:'FL-'+randomUUID().slice(0,8),status:'ready',experiment,plannedRounds:planned,round:0,rounds:[],bindings,parameters:experiment===NOTEBOOK?notebookInitial:{weight:[0,0,0,0],bias:[0]},modelHash:null,baselines:[],createdAt:new Date(now()).toISOString(),error:null};store.tx(()=>{put(j);store.audit(user.sub,'Training session created',null,{sessionId:j.id,experiment,bindings});});issue(j);return j;
 }
 function accept(k,p){
  const b=worker(k),digest=hash(canonical(p)),j=get(b.job);
  if(p.sessionId!==j.id||p.hospitalId!==b.hospitalId)fail('WORKER_BINDING','Worker binding mismatch');
  if(!Number.isInteger(p.round)||p.round<1||p.round>j.plannedRounds)fail('ROUND_BINDING','Invalid round',400);
  const existing=store.db.prepare('SELECT * FROM contributions WHERE job=? AND hospital=? AND round=?').get(j.id,b.hospitalId,p.round);
  if(existing){if(existing.digest!==digest)fail('IDEMPOTENCY_CONFLICT','This round already has a different update',409);return {...JSON.parse(existing.data),idempotent:true};}
  if(p.round!==j.round+1||p.modelVersion!==j.round||p.baseHash!==j.modelHash)fail('MODEL_VERSION','Stale round or model version',409);
  if(!validParameters(p.parameters)||p.features.length!==4||p.features.some((f,i)=>f!==FEATURES[i]))fail('UPDATE_FORMAT','Invalid dimensions, finite bounds or feature order',422);
  const expected=sampleCounts[j.experiment??'legacy'];if(p.numExamples!==expected[b.hospitalId])fail('SAMPLE_COUNT','Unexpected synthetic training sample count',422);
  let accepted;
  store.tx(()=>{
   const w=policy.get(b.warrantId);policy.authorize(w,{...p,scopeVersion:p.scopeVersion,resource:p.resource,purpose:p.purpose,operation:'submit_update'});
   // BEGIN IMMEDIATE serializes this acceptance/quota commit with revocation and other submissions.
   w.used++;store.put('warrants',w);accepted={accepted:true,hospitalId:b.hospitalId,warrantId:w.id,round:p.round,updateHash:hash(canonical(p.parameters)),numExamples:p.numExamples};
   store.db.prepare('INSERT INTO contributions VALUES(?,?,?,?,?)').run(j.id,b.hospitalId,p.round,digest,canonical(accepted));
   store.audit('worker:'+b.hospitalId,'Contribution accepted',w.id,{hospitalId:b.hospitalId,sessionId:j.id,round:p.round,scopeVersion:w.scopeVersion,updateHash:accepted.updateHash});
  });return accepted;
 }
 function signedAccept(envelope){
  const b=[...identities.entries()].find(([,v])=>v.job===envelope.sessionId&&v.hospitalId===envelope.hospitalId);
  if(!b)fail('WORKER_AUTH','No bound hospital worker');const [secret]=b;
  if(typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>32000||typeof envelope.signature!=='string'||envelope.signature.length!==64)fail('UPDATE_SIZE','Invalid update envelope',422);
  const expected=createHmac('sha256',secret).update(envelope.payload).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(envelope.signature)))fail('WORKER_SIGNATURE','Invalid worker signature');
  let p;try{p=JSON.parse(envelope.payload);}catch{fail('UPDATE_FORMAT','Invalid JSON',422);}return accept(secret,p);
 }
 function finalize(k,p){
  const id=coordinators.get(k);if(!id||id!==p.sessionId)fail('COORDINATOR_AUTH','Coordinator credential rejected',401);const j=get(id);
  if(!running.has(id)||p.round!==j.round+1)fail('ROUND_BINDING','Coordinator round mismatch',409);
  if(!Array.isArray(p.updates)||p.updates.length>3)fail('UPDATE_FORMAT','Invalid update count',422);
  const runtime=running.get(id);
  if(runtime.pause&&!runtime.commit){if(j.status!=='queued'){j.status='queued';put(j);store.tx(()=>store.audit('coordinator','Round queued before acceptance',null,{sessionId:id,round:p.round}));}return {waiting:true};}
  const accepted=[],rejected=[];
  for(const e of p.updates){try{const a=signedAccept({...e,sessionId:id});if(accepted.includes(a.hospitalId))fail('DUPLICATE_WORKER','Duplicate hospital');accepted.push(a.hospitalId);}catch(error){const b=j.bindings.find(x=>x.hospitalId===e.hospitalId);const w=b?policy.get(b.warrantId):null;store.tx(()=>policy.event(error.code??'UPDATE_REJECTED',error.message,w,{operation:'submit_update',hospitalId:e.hospitalId}));rejected.push({hospitalId:e.hospitalId,code:error.code??'UPDATE_REJECTED'});}}
  for(const b of j.bindings)if(!accepted.includes(b.hospitalId)&&!rejected.some(r=>r.hospitalId===b.hospitalId)){const w=policy.get(b.warrantId);const code=j.experiment===NOTEBOOK&&p.round>14&&b.hospitalId==='B'?'NOTEBOOK_PARTICIPATION_CUTOFF':policy.status(w)==='approved'?'CLIENT_FAILURE':policy.status(w).toUpperCase();rejected.push({hospitalId:b.hospitalId,code});}
  runtime.accepted=accepted;runtime.rejected=rejected;if(!accepted.length){runtime.failure='No hospital updates were authorized: '+rejected.map(r=>`Hospital ${r.hospitalId}: ${r.code.toLowerCase().replaceAll('_',' ')}`).join(', ')+'. Review the warrants before retrying.';fail('NO_CONTRIBUTIONS',runtime.failure,409);}
  j.status='running';put(j);return {accepted,rejected};
 }
 function complete(k,p){
  const id=coordinators.get(k);if(id!==p.sessionId)fail('COORDINATOR_AUTH','Invalid coordinator',401);const j=get(id),runtime=running.get(id);
  if(!runtime||p.round!==j.round+1||!validParameters(p.parameters))fail('RESULT_BINDING','Invalid result',422);
  const acceptedRows=store.db.prepare('SELECT data FROM contributions WHERE job=? AND round=?').all(id,p.round).map(x=>JSON.parse(x.data));
  if(acceptedRows.length!==runtime.accepted?.length)fail('RESULT_BINDING','Accepted contribution set mismatch',422);
  const notebook=j.experiment===NOTEBOOK;
  const notebookScalers=notebook?Object.fromEntries(['A','B','C'].map(h=>[h,JSON.parse(readFileSync(join(config.datasets,NOTEBOOK,h,'preprocessing.json'),'utf8'))])):undefined;
  const artifact={schema:1,sessionId:id,version:p.round,createdAt:new Date(now()).toISOString(),experiment:j.experiment??'legacy',features:FEATURES,positiveClass:'readmitted_lt30d=1',parameters:p.parameters,preprocessing:notebook?'Per-hospital full-dataset min-max, as in FL.ipynb cell 4; test-set information leaks into scaling':'hospital training partitions only; transformed back to common raw coordinates',...(notebook?{hospitalScalers:notebookScalers}:{}),evaluation:p.evaluation};
  const bytes=Buffer.from(canonical(artifact)),modelHash=hash(bytes);mkdirSync(config.artifacts,{recursive:true});const path=join(config.artifacts,`${id}-v${p.round}.json`);writeFileSync(path+'.tmp',bytes);renameSync(path+'.tmp',path);
  const metrics=p.evaluation?.pooled??{};for(const name of ['accuracy','precision','recall','f1','loss'])if(!Number.isFinite(metrics[name]))fail('METRICS','Evaluation is missing metrics',422);
  const r={number:p.round,at:artifact.createdAt,modelVersion:'v'+p.round,modelHash,modelHashAlgorithm:'SHA-256 of downloadable artifact bytes',metrics:{...metrics,rocAuc:metrics.roc_auc},accepted:runtime.accepted,rejected:runtime.rejected,aggregation:'Flower FedAvg · training-sample weighted parameters',evaluation:notebook?`FL.ipynb FedAvg reproduction · pooled test n=${metrics.n} · full-data scaling before split`:`Measured on synthetic data · pooled untouched test n=${metrics.n} · positive class readmitted_lt30d=1`,details:p.evaluation};
  j.round=p.round;j.parameters=p.parameters;j.modelHash=modelHash;j.rounds.push(r);j.status='finishing';j.baselines=p.baselines??j.baselines;runtime.done=true;
  store.tx(()=>{put(j);store.audit('coordinator','Flower round and model persisted',null,{sessionId:id,round:p.round,modelHash,accepted:r.accepted,rejected:r.rejected,metrics:r.metrics});});return {ok:true,modelHash};
 }
 async function start(user,id,pause=false){
  if(!user.roles.includes('owner'))fail('OWNER_REQUIRED','Resource owner required');const j=get(id);
  if(running.has(id))fail('TRAINING_BUSY','Round is already running',409);if(j.round>=j.plannedRounds)fail('COMPLETED','All rounds are complete',409);
  const participating=j.bindings.filter(b=>!(j.experiment===NOTEBOOK&&j.round>=14&&b.hospitalId==='B'));
  const statuses=participating.map(b=>({hospitalId:b.hospitalId,status:policy.status(policy.get(b.warrantId))}));
  if(!statuses.some(x=>x.status==='approved'))fail('NO_CONTRIBUTIONS','No hospitals can contribute: '+statuses.map(x=>`Hospital ${x.hospitalId}: ${x.status}`).join(', ')+'. Request and approve new warrants before starting another session.',409);
  if(!address)fail('WORKER_ADDRESS','Server has not started',503);
  for(const [k,v] of identities)if(v.job===id)identities.delete(k);for(const [k,v] of coordinators)if(v===id)coordinators.delete(k);const coordinator=issue(j);
  const workers=j.bindings.filter(b=>!(j.experiment===NOTEBOOK&&j.round>=14&&b.hospitalId==='B')).map(b=>({...b,token:[...identities].find(([,v])=>v.job===id&&v.hospitalId===b.hospitalId)[0]}));
  j.status='preparing';j.error=null;put(j);
  const child=spawnProcess(config.python,['-u','ml/runner.py'],{cwd:new URL('..',import.meta.url),env:{...Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','TMP','TEMP','PYTHONPATH','LD_LIBRARY_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',FLWR_TELEMETRY_ENABLED:'0'},stdio:['pipe','pipe','pipe']});
  const runtime={child,pause,commit:!pause,accepted:[],rejected:[]};running.set(id,runtime);
  let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8000);});child.stdout.on('data',()=>{});
  child.stdin.end(JSON.stringify({sessionId:id,round:j.round+1,plannedRounds:j.plannedRounds,experiment:j.experiment??'legacy',parameters:j.parameters,baseHash:j.modelHash,workers,coordinator,api:address,dataDir:j.experiment===NOTEBOOK?join(config.datasets,NOTEBOOK):config.datasets,baselines:j.baselines}));
  const timer=setTimeout(()=>child.kill(),180000);timer.unref();
  const ended=(code)=>{if(!running.has(id))return;clearTimeout(timer);running.delete(id);const latest=get(id);if(code!==0||!runtime.done){latest.status='failed';latest.error=runtime.failure||('Flower process failed; check Python dependencies and worker connectivity. '+stderr.split('\n').filter(x=>/Error|Exception/.test(x)).slice(-2).join(' ').slice(0,300));put(latest);store.tx(()=>store.audit('coordinator','Training failed',null,{sessionId:id,exitCode:code}));}else{latest.status=latest.round>=latest.plannedRounds?'completed':'ready';put(latest);}};
  child.on('error',()=>ended(-1));child.on('exit',ended);return j;
 }
 async function restricted(user,id){if(!user.roles.includes('owner'))fail('OWNER_REQUIRED','Owner required');const j=get(id);const entry=[...identities].find(([,v])=>v.job===id&&v.hospitalId==='B');if(!entry)fail('WORKER_UNAVAILABLE','Start or resume a training round first',409);const [secret,b]=entry;
  const response=await fetch(address+'/worker/authorize',{method:'POST',headers:{authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({sessionId:id,hospitalId:'B',resource:RESOURCE,purpose:PURPOSE,operation:'train_local',features:[...FEATURES,'age_band'],scopeVersion:b.scopeVersion})});const result=await response.json();return {allowed:response.ok,...result};
 }
 function download(user,warrantId){const w=policy.get(warrantId),j=current();if(!j?.round)fail('NO_MODEL','No measured model yet',404);if(user.sub!==w.requesterId||!(user.hospitals??[user.hospital]).includes(w.hospitalId))fail('NOT_REQUESTER','Warrant holder required');policy.authorize(w,{hospitalId:w.hospitalId,resource:RESOURCE,purpose:PURPOSE,operation:'download_model',features:FEATURES,scopeVersion:w.scopeVersion});const bytes=readFileSync(join(config.artifacts,`${j.id}-v${j.round}.json`));if(hash(bytes)!==j.modelHash)fail('ARTIFACT_HASH','Stored model integrity check failed',500);store.tx(()=>store.audit(user.sub,'Model downloaded',w.id,{modelHash:j.modelHash,version:j.round}));return bytes;}
 function predict(user,warrantId,features){
  if(!user.roles.includes('requester')||!(user.hospitals??[user.hospital]).length)fail('NOT_REQUESTER','A hospital requester is required');
  const w=policy.get(warrantId);if(user.sub!==w.requesterId||!(user.hospitals??[user.hospital]).includes(w.hospitalId))fail('NOT_REQUESTER','Only this warrant’s requester can predict');
  const j=current();if(!j?.round)fail('NO_MODEL','Train at least one FL round before predicting',409);
  if(!j.bindings.some(b=>b.warrantId===w.id&&b.hospitalId===w.hospitalId))fail('MODEL_SCOPE','The latest model was not trained under this warrant',403);
  policy.authorize(w,{hospitalId:w.hospitalId,resource:RESOURCE,purpose:PURPOSE,operation:'download_model',features:FEATURES,scopeVersion:w.scopeVersion});
  const limits={emergency_admission:[0,1],prior_inpatient_visits:[0,8],length_of_stay:[1,18],medication_count:[1,30]};
  if(!features||typeof features!=='object'||Array.isArray(features)||Object.keys(features).length!==FEATURES.length||FEATURES.some(f=>!Number.isInteger(features[f])||features[f]<limits[f][0]||features[f]>limits[f][1]))fail('INVALID_FEATURES','Supply four integer features within the displayed ranges',400);
  const bytes=readFileSync(join(config.artifacts,`${j.id}-v${j.round}.json`));if(hash(bytes)!==j.modelHash)fail('ARTIFACT_HASH','Stored model integrity check failed',500);
  const artifact=JSON.parse(bytes);if(artifact.sessionId!==j.id||artifact.version!==j.round||!validParameters(artifact.parameters)||JSON.stringify(artifact.features)!==JSON.stringify(FEATURES))fail('ARTIFACT_FORMAT','Stored model does not match the feature schema',500);
  const scaler=artifact.experiment===NOTEBOOK?artifact.hospitalScalers?.[w.hospitalId]:null;
  if(artifact.experiment===NOTEBOOK&&(!Array.isArray(scaler?.minimum)||!Array.isArray(scaler?.span)||scaler.minimum.length!==4||scaler.span.length!==4||scaler.span.some(v=>!Number.isFinite(v)||v<=0)))fail('ARTIFACT_FORMAT','Notebook hospital scaler is invalid',500);
  const z=FEATURES.reduce((n,f,i)=>n+artifact.parameters.weight[i]*(scaler?(features[f]-scaler.minimum[i])/scaler.span[i]:features[f]),artifact.parameters.bias[0]);const probability=1/(1+Math.exp(-Math.max(-500,Math.min(500,z))));
  store.tx(()=>store.audit(user.sub,'Model prediction requested',w.id,{sessionId:j.id,modelVersion:j.round,modelHash:j.modelHash}));
  return {probability,prediction:probability>=.5?1:0,threshold:.5,modelVersion:artifact.version,sessionId:j.id,modelHash:j.modelHash,synthetic:true};
 }
 return {create,current,get,start,worker,authWorker,accept,finalize,complete,restricted,download,predict,bindAddress:x=>address=x,commit:(u,id)=>{if(!u.roles.includes('owner'))fail('OWNER_REQUIRED','Owner required');const r=running.get(id);if(!r)fail('NO_QUEUED_ROUND','No running round',409);r.commit=true;return get(id);},close:async()=>{await Promise.all([...running.values()].map(r=>new Promise(resolve=>{r.child.once('exit',resolve);r.child.kill();})));}};
}
