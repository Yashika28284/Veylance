export function createLiveAdapter(fetcher=globalThis.fetch.bind(globalThis)){
 let csrfToken,cached;const call=async(path,body)=>{const r=await fetcher('/api/v1'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.message??'Backend request failed'),{code:data.code,status:r.status});return data;};
 const load=async()=>{const session=await call('/session');csrfToken=session.csrfToken;cached=await call('/snapshot');return cached;};
 return {mode:'live',load,async switchActor(actor){
   if(!globalThis.VEYLANCE_CONFIG?.localDemo)throw new Error('Actor switching requires local demo mode');
   const r=await fetcher('/local-demo/actor',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({actor})});
   if(!r.ok)throw new Error((await r.json()).message??'Could not change actor');
   return load();
 },async command(action,payload={}){const {actorId,...p}=payload;
   const id=encodeURIComponent(p.id??'');const scopeVersion=cached?.warrants?.find(w=>w.id===p.id)?.scopeVersion;
   if(action==='newSession')await call('/training/sessions',{plannedRounds:p.plannedRounds??4});
   else if(action==='request')await call('/warrants',p);
   else if(action==='review'||action==='narrow'||action==='reject')await call('/warrants/'+id+'/reviews',{scopeVersion,...(action==='narrow'?{scope:p.scope}:{}),decision:action==='reject'?'reject':'approve'});
   else if(action==='accept'||action==='revoke')await call('/warrants/'+id+'/'+action,{reason:p.reason,scopeVersion});
   else if(action==='advanceRound'||action==='prepareRound'||action==='commitRound'||action==='restrictedAttempt'){
    let s=await call('/training');if(s&&(!s.experiment||s.experiment==='legacy')&&['advanceRound','prepareRound'].includes(action))s=null;if(!s){if(!['advanceRound','prepareRound'].includes(action))throw new Error('Start a training session first');s=await call('/training/sessions',{plannedRounds:p.plannedRounds??4});}
    if(action==='commitRound')await call('/training/'+s.id+'/commit',{});
    else if(action==='restrictedAttempt'){const result=await call('/training/'+s.id+'/restricted-attempt',{});if(result.allowed)throw new Error('Unexpected authorization of a restricted field');}
    else await call('/training/'+s.id+'/advance',{pauseBeforeAcceptance:action==='prepareRound'});
   } else throw new Error(action==='reset'?'Reset is confined to demo mode':'Unsupported live operation');
   cached=await call('/snapshot');return cached;
 },verifyLedger:()=>call('/audit/verify'),predict:(id,features)=>call('/warrants/'+encodeURIComponent(id)+'/predict',{features}),async download(id){const r=await fetcher('/api/v1/warrants/'+encodeURIComponent(id)+'/download',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:'{}'});if(!r.ok)throw new Error((await r.json()).message);const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='veylance-model.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}};
}
