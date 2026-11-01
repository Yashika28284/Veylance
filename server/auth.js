import * as oidc from 'openid-client';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { hash } from './store.js';
import { Fault } from './policy.js';
const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
export function identityProfile(info,claims){
 const userinfoEmail=typeof info?.email==='string'?info.email.trim().slice(0,320):null;
 const tokenEmail=typeof claims?.email==='string'?claims.email.trim().slice(0,320):null;
 const email=userinfoEmail??tokenEmail;
 const sourcesAgree=!userinfoEmail||!tokenEmail||userinfoEmail.toLowerCase()===tokenEmail.toLowerCase();
 const emailVerified=!!email&&sourcesAgree&&((!!userinfoEmail&&info.email_verified===true)||(!!tokenEmail&&claims.email_verified===true));
 return {email,emailNormalized:email?.toLowerCase()??null,emailVerified};
}
export function cookies(req){return Object.fromEntries((req.headers.cookie??'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
export function setupAuth(app,store,config,now){
 let pendingDiscovery;
 const logoutHints=new Map();
 const namoidReady=()=>!!(config.issuer&&config.clientId&&config.clientSecret&&config.authMethod);
 const ready=()=>config.localDemo||namoidReady();
 async function discover(){
  if(!namoidReady())throw new Fault('NAMOID_CONFIGURATION','NamoID needs its exact Test issuer, client authentication method and registered callback. No fallback login is available.',503);
  if(!pendingDiscovery)pendingDiscovery=(async()=>{
   if(new URL(config.issuer).protocol!=='https:')throw new Error('Issuer must use HTTPS');
   const method=config.authMethod;
   if(!['client_secret_basic','client_secret_post'].includes(method))throw new Error('Use the method configured for this confidential client');
   const metadata={client_secret:config.clientSecret,id_token_signed_response_alg:'RS256'};
   const auth=method==='client_secret_basic'?oidc.ClientSecretBasic(config.clientSecret):oidc.ClientSecretPost(config.clientSecret);
   const discoveryFetch=async(url,options)=>{
    const first=await fetch(url,options);
    if(first.status===403&&new URL(url).pathname.startsWith('/.well-known/'))return fetch(url,options);
    return first;
   };
   const client=await oidc.discovery(new URL(config.issuer),config.clientId,metadata,auth,{[oidc.customFetch]:discoveryFetch});
   const m=client.serverMetadata();
   if(m.issuer!==config.issuer||!(m.id_token_signing_alg_values_supported??[]).includes('RS256')||!(m.code_challenge_methods_supported??[]).includes('S256')||!(m.token_endpoint_auth_methods_supported??['client_secret_basic']).includes(method))throw new Error('Issuer capabilities do not match required configuration');
   oidc.enableNonRepudiationChecks(client);return client;
  })().catch(e=>{pendingDiscovery=null;throw e;});return pendingDiscovery;
 }
 const setCookie=(res,name,value,age=3600)=>res.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.origin.startsWith('https:')?'; Secure':''}`);
 function readUser(req,res,next){
  if(config.localDemo){
   const actor=cookies(req).vl_local_actor??'owner';
   const selected=['manager','risk','owner'].includes(actor)?{sub:`local-demo:${actor}`,name:`Local demo ${actor}`,roles:[actor],hospital:null,hospitals:[]}:['A','B','C'].includes(actor)?{sub:`local-demo:requester:${actor}`,name:`Local demo · Hospital ${actor}`,roles:['requester'],hospital:actor,hospitals:[actor]}:null;
   if(!selected)return res.status(400).json({code:'LOCAL_ACTOR',message:'Invalid local actor cookie'});
   req.user=selected;req.session={csrf:'local-demo-csrf'};return next();
  }
  const sid=cookies(req).vl_sid;const row=sid?store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(sid),now()):null;
  if(!row)return res.status(401).json({code:'AUTH_REQUIRED',message:'Verified NamoID sign-in required',login:'/auth/login',configurationReady:ready()});
  const u=store.db.prepare('SELECT * FROM users WHERE sub=?').get(row.sub);if(!u)return res.status(401).json({code:'AUTH_REQUIRED',message:'Unknown session'});
  const hospitals=store.db.prepare('SELECT hospital FROM user_hospitals WHERE sub=? ORDER BY hospital').all(u.sub).map(x=>x.hospital);
  req.user={sub:u.sub,name:u.name,roles:JSON.parse(u.roles),hospital:u.hospital,hospitals:hospitals.length?hospitals:[u.hospital].filter(Boolean)};req.session=row;next();
 }
 function csrf(req,res,next){if(!equal(req.get('x-csrf-token')??'',req.session.csrf)||req.get('origin')!==config.origin)return res.status(403).json({code:'CSRF_FAILED',message:'Same-origin CSRF token required'});next();}
 app.get('/auth/login',async(req,res,next)=>{try{
  const client=await discover();const state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier(),key=random();
  store.db.prepare('DELETE FROM auth_transactions WHERE expires<=?').run(now());
  store.db.prepare('INSERT INTO auth_transactions VALUES(?,?,?)').run(hash(key),JSON.stringify({state,nonce,verifier}),now()+600000);setCookie(res,'vl_tx',key,600);
  res.redirect(oidc.buildAuthorizationUrl(client,{response_type:'code',redirect_uri:config.origin+'/auth/callback',scope:'openid profile email',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'}).href);
 }catch(e){next(e);}});
 app.get('/auth/callback',async(req,res)=>{
  const key=cookies(req).vl_tx??'';const row=store.db.prepare('SELECT * FROM auth_transactions WHERE hash=?').get(hash(key));
  store.db.prepare('DELETE FROM auth_transactions WHERE hash=?').run(hash(key));setCookie(res,'vl_tx','',0);
  let stage='transaction';
  try{
   if(!row||row.expires<=now())throw new Error('Transaction expired');const t=JSON.parse(row.data);
   stage='state';
   if(!equal(req.query.state??'',t.state))throw new Error('State mismatch');
   stage='discovery';const client=await discover();stage='token_exchange';const tokens=await oidc.authorizationCodeGrant(client,new URL(req.originalUrl,config.origin),{pkceCodeVerifier:t.verifier,expectedState:t.state,expectedNonce:t.nonce,idTokenExpected:true});
   stage='claims';
   const claims=tokens.claims();if(!claims?.sub||!Number.isFinite(claims.iat)||!Number.isFinite(claims.exp)||claims.iat>now()/1000+30||claims.exp<=now()/1000)throw new Error('Invalid token time claims');
   stage='userinfo';const info=await oidc.fetchUserInfo(client,tokens.access_token,claims.sub);if(info.sub!==claims.sub)throw new Error('Subject mismatch');
   stage='session';
   const sub=config.issuer+'|'+claims.sub;const name=String(info.name??claims.sub).slice(0,120);
   const {email,emailNormalized,emailVerified}=identityProfile(info,claims);
   store.tx(()=>{
    store.db.prepare("INSERT INTO users(sub,name,roles) VALUES(?,?,'[]') ON CONFLICT(sub) DO UPDATE SET name=excluded.name").run(sub,name);
    store.db.prepare('INSERT INTO user_identity_profiles(sub,email,email_normalized,email_verified) VALUES(?,?,?,?) ON CONFLICT(sub) DO UPDATE SET email=excluded.email,email_normalized=excluded.email_normalized,email_verified=excluded.email_verified').run(sub,email,emailNormalized,emailVerified?1:0);
   });
   const old=cookies(req).vl_sid;if(old)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(old));
   const sid=random(),csrf=random(),expires=Math.min(now()+3600000,claims.exp*1000);
   store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(sid),sub,csrf,expires);setCookie(res,'vl_sid',sid,Math.floor((expires-now())/1000));
   if(old)logoutHints.delete(hash(old));for(const [key,value] of logoutHints)if(value.expires<=now())logoutHints.delete(key);
   if(tokens.id_token)logoutHints.set(hash(sid),{token:tokens.id_token,expires});
   store.tx(()=>store.audit(sub,'Verified sign-in',null,{}));res.redirect('/#/overview');
  }catch(e){const oauthErrors=['invalid_client','invalid_grant','invalid_request','invalid_scope','unauthorized_client','access_denied'];const knownCodes=['ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','OAUTH_RESPONSE_BODY_ERROR','OAUTH_AUTHORIZATION_RESPONSE_ERROR','OAUTH_WWW_AUTHENTICATE_CHALLENGE','OAUTH_INVALID_RESPONSE','OAUTH_PARSE_ERROR','OAUTH_RESPONSE_IS_NOT_JSON','OAUTH_RESPONSE_IS_NOT_CONFORM','OAUTH_JWT_TIMESTAMP_CHECK_FAILED','OAUTH_JWT_CLAIM_COMPARISON_FAILED','OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED','OAUTH_KEY_SELECTION_FAILED','OAUTH_UNSUPPORTED_OPERATION','OAUTH_TIMEOUT','OAUTH_ABORT'];const names=['ClientError','TypeError','ResponseBodyError','AuthorizationResponseError','WWWAuthenticateChallengeError','OperationProcessingError','Error'];const code=oauthErrors.includes(e?.error)?e.error:knownCodes.includes(e?.code)?e.code:'unclassified';const name=names.includes(e?.name)?e.name:'other';const causeCode=knownCodes.includes(e?.cause?.code)?e.cause.code:'unclassified';const causeName=names.includes(e?.cause?.name)?e.cause.name:'other';console.error(JSON.stringify({event:'authentication_failed',stage,code,name,causeCode,causeName,status:Number.isInteger(e?.status)?e.status:undefined,requestId:req.id}));setCookie(res,'vl_sid','',0);const message=stage==='token_exchange'&&e?.status===401?'NamoID rejected the token exchange (HTTP 401). Check the Test client credentials and authentication method.':'Authentication validation failed. Start a fresh sign-in attempt.';res.status(400).type('text').send(message+' Reference: '+req.id);}
 });
 app.post('/auth/logout',readUser,csrf,async(req,res)=>{
  let redirect='/',providerLogout=false;
  try{const client=await discover();const hint=logoutHints.get(req.session.hash)?.token;const params={post_logout_redirect_uri:config.origin+'/'};if(hint)params.id_token_hint=hint;redirect=oidc.buildEndSessionUrl(client,params).href;providerLogout=true;}catch{console.error(JSON.stringify({event:'provider_logout_unavailable',requestId:req.id}));}
  logoutHints.delete(req.session.hash);store.db.prepare('DELETE FROM sessions WHERE hash=?').run(req.session.hash);setCookie(res,'vl_sid','',0);res.json({redirect,providerLogout});
 });
 if(config.localDemo)app.post('/local-demo/actor',readUser,csrf,(req,res)=>{
  const actor=req.body?.actor;
  if(!['manager','risk','owner','A','B','C'].includes(actor))return res.status(400).json({code:'LOCAL_ACTOR',message:'Choose a local demonstration role'});
  setCookie(res,'vl_local_actor',actor,86400);res.json({actor});
 });
 return {readUser,csrf,ready};
}
