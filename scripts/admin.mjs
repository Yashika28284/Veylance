import { DatabaseSync,backup } from 'node:sqlite';
import { mkdirSync,existsSync,copyFileSync,readFileSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { resolve,join,dirname,basename } from 'node:path';
import { loadConfig } from '../server/config.js';
import { openStore,hash,canonical } from '../server/store.js';
const config=loadConfig(),cmd=process.argv[2]??'init';
const integrity=file=>{const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity check failed');}finally{db.close();}};
const allowedRoles=['requester','manager','risk','owner'];
function assignmentArgs(args,label){
 const [identity,roleText,hospitalText]=args;const roles=String(roleText??'').split(',').filter(Boolean);
 if(!identity||!roles.length||roles.some(r=>!allowedRoles.includes(r)))throw new Error(`${label} requires an identity and comma-separated roles: requester, manager, risk, owner`);
 const hospitals=hospitalText?.split(',')??[];
 if(roles.includes('requester')&&(!hospitals.length||new Set(hospitals).size!==hospitals.length||hospitals.some(h=>!['A','B','C'].includes(h))))throw new Error('Requester requires a unique comma-separated hospital list from A, B, C');
 if(!roles.includes('requester')&&hospitalText)throw new Error('Hospitals are only valid for the requester role');
 return {identity,roles,hospitals};
}
function saveAssignment(s,subject,roles,hospitals,method){
 const existing=s.db.prepare('SELECT sub FROM users WHERE sub=?').get(subject);if(!existing)throw new Error('Identity has not signed in to Veylance');
 s.tx(()=>{s.db.prepare('UPDATE users SET roles=?,hospital=? WHERE sub=?').run(JSON.stringify(roles),hospitals[0]??null,subject);s.db.prepare('DELETE FROM user_hospitals WHERE sub=?').run(subject);for(const hospital of hospitals)s.db.prepare('INSERT INTO user_hospitals(sub,hospital) VALUES(?,?)').run(subject,hospital);s.audit('local administrator','Server role assignment',null,{subject,roles,hospitals,method});});
}
if(cmd==='init'){const s=openStore(config.dbFile);s.close();console.log('Database initialized at DB_FILE');}
else if(cmd==='users'){
 const s=openStore(config.dbFile);
 try{const users=s.db.prepare('SELECT u.name,u.sub,p.email,p.email_verified AS emailVerified,u.roles,u.hospital FROM users u LEFT JOIN user_identity_profiles p ON p.sub=u.sub ORDER BY u.name,u.sub').all();if(!users.length)console.log('No accounts found. Sign in with NamoID first.');else for(const user of users)console.log(JSON.stringify({...user,emailVerified:user.emailVerified===1,hospitals:s.db.prepare('SELECT hospital FROM user_hospitals WHERE sub=? ORDER BY hospital').all(user.sub).map(x=>x.hospital)}));}finally{s.close();}
}
else if(cmd==='assign'){
 const {identity:subject,roles,hospitals}=assignmentArgs(process.argv.slice(3),'assign');
 if(!config.issuer||!subject.startsWith(config.issuer+'|')||subject.length<=config.issuer.length+1)throw new Error('Use the full identity from db:users: exact configured issuer followed by | and the subject ID');
 const s=openStore(config.dbFile);try{saveAssignment(s,subject,roles,hospitals,'issuer-sub');}finally{s.close();}console.log('Server-managed subject assignment saved');
}else if(cmd==='assign-email'){
 const {identity:email,roles,hospitals}=assignmentArgs(process.argv.slice(3),'assign-email');const normalized=email.trim().toLowerCase();
 if(!normalized||normalized.length>320||!normalized.includes('@'))throw new Error('Enter a valid email address');
 const s=openStore(config.dbFile);try{
  const verified=s.db.prepare('SELECT u.sub,u.name FROM users u JOIN user_identity_profiles p ON p.sub=u.sub WHERE p.email_normalized=? AND p.email_verified=1 ORDER BY u.sub').all(normalized);
  if(verified.length>1)throw new Error(`Verified email is ambiguous (${verified.length} accounts). Resolve these identities first: ${verified.map(x=>x.sub).join(', ')}`);
  if(!verified.length){const unverified=s.db.prepare('SELECT COUNT(*) AS count FROM user_identity_profiles WHERE email_normalized=? AND email_verified=0').get(normalized).count;if(unverified)throw new Error('Email exists but is not verified by NamoID. The account owner must verify it and sign in again.');throw new Error('No signed-in Veylance account has that verified email. Ask the user to sign in first.');}
  saveAssignment(s,verified[0].sub,roles,hospitals,'verified-email');console.log(`Server-managed assignment saved for ${verified[0].name} <${normalized}>`);
 }finally{s.close();}
}else if(cmd==='backup'){
 const out=resolve(process.argv[3]??('backups/'+new Date().toISOString().replaceAll(':','-')));if(existsSync(out))throw new Error('Choose a new backup directory');mkdirSync(out,{recursive:true});
 const source=new DatabaseSync(config.dbFile,{readOnly:true});try{await backup(source,join(out,'veylance.db'));}finally{source.close();}integrity(join(out,'veylance.db'));
 const s=openStore(join(out,'veylance.db'));const artifacts=[];
 try{if(!s.verify().valid)throw new Error('Ledger inconsistent');mkdirSync(join(out,'artifacts'));for(const j of s.list('jobs'))for(const r of j.rounds){const name=`${j.id}-v${r.number}.json`,bytes=readFileSync(join(config.artifacts,name));if(hash(bytes)!==r.modelHash)throw new Error('Model hash mismatch');copyFileSync(join(config.artifacts,name),join(out,'artifacts',name));artifacts.push({name,sha256:r.modelHash});}
  writeFileSync(join(out,'manifest.json'),canonical({databaseHash:hash(readFileSync(join(out,'veylance.db'))),artifacts,ledgerHead:s.verify().head}));
 }finally{s.close();}console.log('Online backup verified: '+out);
}else if(cmd==='restore'){
 if(process.env.RESTORE_OFFLINE!=='yes')throw new Error('Stop the app and set RESTORE_OFFLINE=yes before restoring');
 const source=resolve(process.argv[3]??'');const m=JSON.parse(readFileSync(join(source,'manifest.json')));const dbPath=join(source,'veylance.db');integrity(dbPath);
 if(hash(readFileSync(dbPath))!==m.databaseHash)throw new Error('Backup database hash mismatch');
 for(const a of m.artifacts){if(a.name!==basename(a.name)||hash(readFileSync(join(source,'artifacts',a.name)))!==a.sha256)throw new Error('Backup artifact validation failed');}
 const check=openStore(dbPath);try{if(!check.verify().valid||check.verify().head!==m.ledgerHead)throw new Error('Backup ledger verification failed');}finally{check.close();}
 mkdirSync(dirname(config.dbFile),{recursive:true});mkdirSync(config.artifacts,{recursive:true});const stamp=Date.now();
 for(const suffix of ['','-wal','-shm'])if(existsSync(config.dbFile+suffix))renameSync(config.dbFile+suffix,config.dbFile+suffix+'.pre-restore-'+stamp);
 copyFileSync(dbPath,config.dbFile);for(const a of m.artifacts)copyFileSync(join(source,'artifacts',a.name),join(config.artifacts,a.name));integrity(config.dbFile);console.log('Restore verified; earlier database retained with pre-restore suffix');
}else throw new Error('Unknown command');
