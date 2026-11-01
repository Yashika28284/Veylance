import { randomUUID } from 'node:crypto';
import { FEATURES,OPERATIONS,RESOURCE,PURPOSE } from '../dist/js/domain.js';
export { FEATURES,OPERATIONS,RESOURCE,PURPOSE };
export class Fault extends Error {constructor(code,message,status=403){super(message);this.code=code;this.status=status;}}
export const fail=(code,message,status)=>{throw new Fault(code,message,status);};
export const roles=['manager','risk','owner'];
const subset=(a,b)=>Array.isArray(a)&&a.length>0&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
export function createPolicy(store,now=()=>Date.now()) {
  const iso=()=>new Date(now()).toISOString();
  const get=id=>store.get('warrants',id)??fail('NO_WARRANT','Warrant not found',404);
  function status(w){return ['revoked','rejected'].includes(w.status)?w.status:Date.parse(w.expiresAt)<=now()?'expired':w.status==='approved'&&w.used>=w.quota?'exhausted':w.status;}
  const audit=(actor,action,w,payload={})=>store.audit(actor,action,w?.id??null,{hospitalId:w?.hospitalId??null,...payload},iso());
  const save=(w,actor,action,payload={})=>{w.history.push({at:iso(),actor,action});store.put('warrants',w);audit(actor,action,w,payload);return w;};
  function event(code,reason,w,context={}){const e={at:iso(),code,reason,warrantId:w?.id??null,hospitalId:w?.hospitalId??context.hospitalId??null,...context};const r=store.db.prepare('INSERT INTO events(data) VALUES(?)').run(JSON.stringify(e));audit(w?.requesterId??'unverified-worker',`Authorization denied: ${code}`,w,{...context,reason});return {...e,id:Number(r.lastInsertRowid)};}
  function request(user,p){return store.tx(()=>{
    if(!user.roles.includes('requester')||!['A','B','C'].includes(p.hospitalId)||!(user.hospitals??[user.hospital]).includes(p.hospitalId)) fail('HOSPITAL_MISMATCH','Only a server-assigned hospital requester can request');
    if(p.resource!==RESOURCE||p.purpose!==PURPOSE||!subset(p.features,FEATURES)||!subset(p.operations,OPERATIONS))fail('INVALID_SCOPE','Resource, purpose, operations and approved model features must match',400);
    if(!Number.isInteger(p.quota)||p.quota<1||p.quota>50||!Number.isFinite(p.duration)||p.duration<1||p.duration>72)fail('INVALID_ALLOWANCE','Duration 1–72 hours; integer contribution allowance 1–50',400);
    const required=['No patient identifiers','Aggregate model updates only','Four-feature allowlist'];
    if(!Array.isArray(p.controls)||!required.every(c=>p.controls.includes(c))||p.controls.some(c=>!required.includes(c)))fail('RISK_CONTROLS','Required risk controls must be retained',400);
    const w={id:'WRT-'+randomUUID().slice(0,8),hospitalId:p.hospitalId,requesterId:user.sub,requesterName:user.name,resource:RESOURCE,purpose:PURPOSE,operations:[...p.operations],features:[...p.features],createdAt:iso(),expiresAt:new Date(now()+p.duration*3600000).toISOString(),quota:p.quota,used:0,controls:[...p.controls],status:'pending',scopeVersion:1,reviews:[],history:[],narrowed:false,consentAt:null};
    return save(w,user.sub,'Warrant requested');
  });}
  function review(user,id,p={}){return store.tx(()=>{
    const w=get(id);if(p.scopeVersion!==w.scopeVersion)fail('SCOPE_VERSION','Review scope version is stale',409);if(status(w)!=='pending')fail('NOT_PENDING','Warrant is not awaiting review',409);
    if(user.sub===w.requesterId)fail('SELF_APPROVAL','Self-approval is forbidden');
    if(p.decision==='reject'){
      const reviewer=p.slot??roles.find(r=>user.roles.includes(r));
      if(!roles.includes(reviewer)||!user.roles.includes(reviewer))fail('REVIEW_ROLE','A server-assigned reviewer slot is required');
      w.status='rejected';return save(w,user.sub,'Warrant rejected',{role:reviewer,reason:String(p.reason??'Scope not approved').slice(0,300)});
    }
    const role=p.slot??roles.find(r=>user.roles.includes(r)&&!w.reviews.some(v=>v.role===r));
    if(!roles.includes(role)||!user.roles.includes(role))fail('REVIEW_ROLE','A server-assigned reviewer slot is required');
    if(w.reviews.some(r=>r.id===user.sub))fail('DISTINCT_REVIEWERS','An identity may occupy only one reviewer slot');
    if(w.reviews.some(r=>r.role===role))fail('SLOT_TAKEN','Reviewer slot already approved',409);
    if(p.scope){const s=p.scope;
      if(!subset(s.features,w.features)||!subset(s.operations,w.operations)||!Number.isInteger(s.quota)||s.quota<1||s.quota>w.quota||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)>Date.parse(w.expiresAt)||Date.parse(s.expiresAt)<=now())fail('EXPANSION_DENIED','Narrowing must retain a nonempty subset, reduce allowance and shorten expiry',400);
      const changed=JSON.stringify(s.features)!==JSON.stringify(w.features)||JSON.stringify(s.operations)!==JSON.stringify(w.operations)||s.quota!==w.quota||s.expiresAt!==w.expiresAt;
      if(!changed)fail('NO_NARROWING','Select a scope change',400);
      Object.assign(w,{features:s.features,operations:s.operations,quota:s.quota,expiresAt:s.expiresAt,scopeVersion:w.scopeVersion+1,reviews:[],narrowed:true,consentAt:null});
      save(w,user.sub,'Scope narrowed; earlier approvals invalidated',{scopeVersion:w.scopeVersion});
    }
    w.reviews.push({role,id:user.sub,name:user.name,at:iso(),decision:'approved',scopeVersion:w.scopeVersion});
    if(roles.every(role=>w.reviews.some(r=>r.role===role&&r.scopeVersion===w.scopeVersion)))w.status=w.narrowed?'awaiting_acceptance':'approved';
    return save(w,user.sub,'Reviewer approved',{role,scopeVersion:w.scopeVersion,status:w.status});
  });}
  function accept(user,id,p={}){return store.tx(()=>{const w=get(id);if(p.scopeVersion!==w.scopeVersion)fail('SCOPE_VERSION','Consent scope version is stale',409);if(user.sub!==w.requesterId)fail('NOT_REQUESTER','Only the original requester can accept');if(status(w)!=='awaiting_acceptance')fail('NO_CONSENT_PENDING','No scope awaiting acceptance',409);w.consentAt=iso();w.status='approved';return save(w,user.sub,'Requester accepted narrowed scope',{scopeVersion:w.scopeVersion});});}
  function revoke(user,id,reason){return store.tx(()=>{const w=get(id);if(!roles.some(r=>user.roles.includes(r))||user.sub===w.requesterId)fail('REVIEW_ROLE','Independent reviewer required');if(!['approved','exhausted','pending','awaiting_acceptance'].includes(status(w)))fail('TERMINAL','Warrant cannot be revoked',409);if(!String(reason??'').trim())fail('REASON_REQUIRED','Revocation reason required',400);w.status='revoked';return save(w,user.sub,'Warrant revoked',{reason:String(reason).slice(0,300)});});}
  function authorize(w,p){
    const s=status(w);let code,reason;
    if(s!=='approved'){code=s.toUpperCase();reason=`Warrant is ${s}`;}
    else if(p.hospitalId!==w.hospitalId){code='HOSPITAL_MISMATCH';reason='Worker hospital does not match warrant';}
    else if(p.resource!==w.resource){code='RESOURCE_MISMATCH';reason='Resource is outside the warrant';}
    else if(p.purpose!==w.purpose){code='PURPOSE_MISMATCH';reason='Purpose is outside the warrant';}
    else if(!w.operations.includes(p.operation)){code='OPERATION_DENIED';reason='Operation is outside the warrant';}
    else if(!Array.isArray(p.features)||!p.features.length||new Set(p.features).size!==p.features.length||p.features.some(f=>!w.features.includes(f)||!FEATURES.includes(f))){code='FEATURE_DENIED';reason='Restricted or unapproved field requested; age_band and the target cannot be inputs';}
    else if(p.scopeVersion!==w.scopeVersion){code='SCOPE_VERSION';reason='Worker scope version is stale';}
    else if(w.narrowed&&!w.consentAt){code='CONSENT_REQUIRED';reason='Original requester acceptance required';}
    if(code){event(code,reason,w,p);fail(code,reason);}
    return w;
  }
  return {get,status,request,review,accept,revoke,authorize,event};
}
