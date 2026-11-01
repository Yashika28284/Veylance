import { adapter, ui, getState, clearState, initialize, dispatch, switchLocalActor } from './state.js';
import { landing,shell,overview,warrants,training,security,audit,requestForm,warrantDetail,narrowForm,revokeForm,predictionPanel } from './pages.js';
import { esc,wordmark,icon } from './components.js';
import { renderChart,destroyCharts } from './charts.js';
const app=document.getElementById('app'),drawer=document.getElementById('drawer');
const pages={overview,warrants,training,security,audit};
let chartMetric='accuracy',toastTimer,predictionResult=null;
function notify(message,error=false){const t=document.getElementById('toast');t.textContent=message;t.className=error?'visible error':'visible';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='',5000);}
function route(){const hash=location.hash;const key=hash.startsWith('#/')?hash.slice(2).split('?')[0]:'';return key;}
function showError(error){destroyCharts();app.innerHTML=`<main id="main-content" class="error-page">${wordmark()}<div class="eyebrow">${adapter.mode==='live'?'LIVE MODE · UNAVAILABLE':'WORKSPACE UNAVAILABLE'}</div><h1>${adapter.mode==='live'?(error.status===401?'Sign in to the research workspace.':'Live workspace unavailable.'):'We couldn’t open the workspace.'}</h1><p>${adapter.mode==='live'?'Veylance requires a verified server session, authorization service and live data contracts before opening a protected workspace. Demo data is never substituted in live mode.':'Reload the workspace to try again. Your last saved demo state is retained.'}</p><p class="error-detail">${esc(error.message)}</p>${adapter.mode==='live'?'<a class="btn primary" href="/auth/login">Sign in with NamoID</a><a class="btn secondary" href="/demo/#/overview">Open interactive demo</a>':''}<button class="btn primary" data-action="retry">Try again ${icon('refresh',15)}</button>${adapter.mode==='demo'?'<button class="btn secondary" data-action="reset">Reset demo</button>':''}</main>`;}
function render({preserveSearch=false}={}){
 const key=route();destroyCharts();
 if(!key){app.innerHTML=landing();document.title='Veylance — Purpose-bound collaboration';return;}
 if(!pages[key]){app.innerHTML=`<main class="error-page" id="main-content">${wordmark()}<h1>Page not found.</h1><p>Choose a workspace view to continue.</p><a href="#/overview" class="btn primary">Open overview</a></main>`;return;}
 if(!getState())return;
 ui.page=key;
 const active=document.activeElement,wasSearch=preserveSearch&&active?.id==='table-search',position=wasSearch?active.selectionStart:null;
 const localActor=globalThis.VEYLANCE_CONFIG?.localDemo;
 const actorSelect=localActor?`<label class="role-select"><span class="sr-only">Local demo actor</span><select id="local-actor" aria-label="Local demo actor">${[['owner','Resource owner'],['manager','Manager'],['risk','Risk reviewer'],['A','Requester · Hospital A'],['B','Requester · Hospital B'],['C','Requester · Hospital C']].map(([id,label])=>`<option value="${id}" ${getState().user.sub===(['A','B','C'].includes(id)?`local-demo:requester:${id}`:`local-demo:${id}`)?'selected':''}>${label}</option>`).join('')}</select></label>`:'';
 app.innerHTML=shell(getState(),ui,pages[key](getState(),ui)+(key==='training'&&adapter.mode==='live'?predictionPanel(getState(),predictionResult):''),adapter.mode).replace('<div class="topbar-right">',`<div class="topbar-right">${actorSelect}`).replace(localActor?'<button class="text-button" data-action="logout">Sign out</button>':'__never__','');
 document.title=`${{overview:'Overview',warrants:'Digital warrants',training:'Federated training',security:'Security events',audit:'Audit history'}[key]} — Veylance`;
 if(wasSearch){const input=document.getElementById('table-search');input?.focus();try{input?.setSelectionRange(position,position);}catch{}}
 renderChart(getState(),chartMetric);syncChartButtons();
}
function syncChartButtons(){document.querySelectorAll('[data-action="chart"]').forEach(b=>{const selected=b.dataset.metric===chartMetric;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});const label=document.getElementById('chart-metric-label');if(label)label.textContent=chartMetric==='accuracy'?'Global accuracy':'Global loss';}
function openDrawer(type,id){ui.drawer={type,id};renderDrawer();if(!drawer.open)drawer.showModal();}
function renderDrawer(){if(!ui.drawer)return;const {type,id}=ui.drawer;drawer.innerHTML=(adapter.mode==='demo'?'<div class="drawer-demo"><span class="demo-tag"><span class="status-dot"></span>Interactive demo · synthetic data</span></div>':'')+(type==='request'?requestForm(getState()):type==='narrow'?narrowForm(getState(),id):type==='revoke'?revokeForm(getState(),id):warrantDetail(getState(),id,ui.actorId,adapter.mode==='demo'));}
function closeDrawer(){ui.drawer=null;drawer.close();}
function sessionExpired(error){if(drawer.open)closeDrawer();clearState();showError(Object.assign(new Error('Your session expired or was signed out. Sign in again to continue.'),{status:401}));}
async function command(action,payload={},message='Demo state updated.'){
 if(ui.busy)return;if(action==='reset'){ui.actorId='reviewer-manager';chartMetric='accuracy';}ui.busy=true;document.body.setAttribute('aria-busy','true');
 try{await dispatch(action,payload);render();if(ui.drawer)renderDrawer();notify(message);}
 catch(error){if(error.status===401&&adapter.mode==='live'){sessionExpired(error);return;}const formError=drawer.open?drawer.querySelector('.form-error'):null;if(formError){formError.textContent=error.message;formError.scrollIntoView({block:'nearest'});}else notify(error.message,true);}
 finally{ui.busy=false;document.body.removeAttribute('aria-busy');}
}
async function boot(){try{await initialize();if(adapter.mode==='live')ui.actorId=getState().user.sub;render();}catch(error){showError(error);}}
window.addEventListener('hashchange',()=>{closeDrawer();ui.search='';ui.filter='all';ui.hospital='all';chartMetric='accuracy';if(!getState()&&route())boot();else render();window.scrollTo({top:0});document.getElementById('main-content')?.focus({preventScroll:true});});
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;const {action,id,kind}=b.dataset;
 if(action==='menu'){const side=document.getElementById('sidebar');const open=side.classList.toggle('open');b.setAttribute('aria-expanded',String(open));return;}
 if(action==='detail'||action==='request'||action==='narrow'||action==='revoke'){openDrawer(action,id);return;}
 if(action==='close'){closeDrawer();return;}
 if(action==='retry'){await boot();return;}
 if(action==='chart'){chartMetric=b.dataset.metric;destroyCharts();renderChart(getState(),chartMetric);syncChartButtons();return;}
 if(action==='reset'){closeDrawer();ui.search='';ui.filter='all';ui.hospital='all';await command('reset',{},'Demo reset. All three hospitals are authorized.');return;}
 if(action==='advance'){const plannedRounds=Number(document.getElementById('planned-rounds')?.value??4);await command('advanceRound',{plannedRounds},adapter.mode==='demo'?'Illustrative round advanced. No model training executed.':'Flower round started. Progress is updated automatically.');return;}
 if(action==='new-session'){const plannedRounds=Number(document.getElementById('planned-rounds')?.value??4);await command('newSession',{plannedRounds},`New ${plannedRounds}-round session created.`);return;}
 if(action==='prepare'){const plannedRounds=Number(document.getElementById('planned-rounds')?.value??4);await command('prepareRound',{plannedRounds},'Training started; updates will wait before acceptance.');return;}
 if(action==='commit'){await command('commitRound',{},'Queued updates released for current authorization checks.');return;}
 if(action==='restricted-live'){await command('restrictedAttempt',{},'Actual authorization denial recorded. See security events.');return;}
 if(action==='download'){try{await adapter.download(id);notify('Authorized model downloaded.');}catch(e){notify(e.message,true);}return;}
 if(action==='logout'){try{const sessionResponse=await fetch('/api/v1/session');if(!sessionResponse.ok)throw new Error('Your session has expired. Reload the page.');const session=await sessionResponse.json();const response=await fetch('/auth/logout',{method:'POST',headers:{'x-csrf-token':session.csrfToken,'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Sign out failed. Please try again.');const result=await response.json();if(!result.providerLogout)window.alert('Signed out of Veylance. NamoID sign-out was unavailable, so your NamoID session may still be active.');location.assign(result.redirect);}catch(e){notify(e.message,true);}return;}
 if(action==='scenario'){
   const step=getState().scenario;
   if(step===2){openDrawer('revoke','WRT-2026-002');return;}
   if(step===5){await command('reset',{},'Scenario reset.');return;}
   await command(step===1?'restrictedAttempt':'advanceRound',{},step===1?'Simulated denial: the field is outside the approved scope.':step===3?'Hospital B’s contribution was rejected. A and C were accepted.':'Illustrative round advanced.');return;
 }
 if(action==='approve'||action==='accept'||action==='reject'){await command(action==='approve'?'review':action,{id},action==='approve'?'Reviewer decision recorded.':action==='accept'?'Requester consent recorded. Warrant is active.':'Warrant rejected.');return;}
 if(action==='probe'){await command('probe',{kind},'Sandbox denial recorded in security events and audit history.');return;}
 if(action==='verify'){
   b.disabled=true;
   try{ui.verification=await adapter.verifyLedger();render();notify(ui.verification.message,!ui.verification.valid);}catch(error){notify(error.message,true);}finally{b.disabled=false;}
 }
});
document.addEventListener('input',event=>{if(event.target.id==='table-search'){ui.search=event.target.value;render({preserveSearch:true});}});
document.addEventListener('change',async event=>{if(event.target.id==='status-filter'){ui.filter=event.target.value;render();}else if(event.target.id==='hospital-filter'){ui.hospital=event.target.value;render();}else if(event.target.id==='local-actor'){try{await switchLocalActor(event.target.value);render();if(ui.drawer)renderDrawer();}catch(e){notify(e.message,true);render();}}else if(['demo-actor','drawer-actor'].includes(event.target.id)){ui.actorId=event.target.value;render();if(ui.drawer)renderDrawer();}});
document.addEventListener('submit',async event=>{
 if(event.target.id==='prediction-form'){
  event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const values=new FormData(form),features=Object.fromEntries(['emergency_admission','prior_inpatient_visits','length_of_stay','medication_count'].map(k=>[k,Number(values.get(k))]));predictionResult={...(await adapter.predict(values.get('warrantId'),features)),warrantId:values.get('warrantId')};render();}catch(error){if(error.status===401){sessionExpired(error);return;}form.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}return;
 }
 if(!['warrant-request','narrow-form','revoke-form'].includes(event.target.id))return;
 event.preventDefault();const form=event.target,data=new FormData(form);
 const errorBox=form.querySelector('.form-error');if(errorBox)errorBox.textContent='';
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 try{
   if(form.id==='warrant-request'){
     const before=getState().warrants.length;
     await command('request',{hospitalId:data.get('hospitalId'),resource:data.get('resource'),purpose:data.get('purpose'),duration:Number(data.get('duration')),quota:Number(data.get('quota')),operations:data.getAll('operations'),features:data.getAll('features'),controls:data.getAll('controls')},'Request submitted. Three independent approvals are required.');
     if(getState().warrants.length>before)openDrawer('detail',getState().warrants.at(-1).id);
   } else if(form.id==='narrow-form') {
     const id=form.dataset.id;
     await command('narrow',{id,scope:{features:data.getAll('features'),operations:data.getAll('operations'),quota:Number(data.get('quota')),expiresAt:new Date(data.get('expiresAt')+':00Z').toISOString()}},'Scope narrowed. Previous approvals cleared; requester consent required after review.');
     if(!drawer.querySelector('.form-error')?.textContent)openDrawer('detail',id);
   } else {
     const id=form.dataset.id;
     await command('revoke',{id,reason:data.get('reason')},'Warrant revoked. Future contributions will be rejected.');
     if(getState().warrants.find(w=>w.id===id).status==='revoked')openDrawer('detail',id);
   }
 }catch(error){errorBox.textContent=error.message;}finally{button.disabled=false;}
});
drawer.addEventListener('close',()=>{ui.drawer=null;});
drawer.addEventListener('click',event=>{if(event.target===drawer&&event.clientX<drawer.getBoundingClientRect().left)closeDrawer();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const side=document.getElementById('sidebar');if(side?.classList.contains('open')){side.classList.remove('open');document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded','false');}}});
if(!route())render();else boot();
let liveFingerprint='';
if(adapter.mode==='live')setInterval(async()=>{if(!getState()||ui.busy||ui.drawer||!route())return;try{await initialize();const next=JSON.stringify({...getState(),clock:null});if(next!==liveFingerprint){liveFingerprint=next;render({preserveSearch:true});}}catch(e){if(e.status===401)sessionExpired(e);else notify('Live refresh failed: '+e.message,true);}},1500);
