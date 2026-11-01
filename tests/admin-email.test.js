import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openStore } from '../server/store.js';
import { identityProfile } from '../server/auth.js';

const issuer='https://issuer.example.test';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'veylance-admin-')),dbFile=join(root,'veylance.db');
 const store=openStore(dbFile);
 const add=(id,name,email,verified=1)=>{
  const sub=`${issuer}|${id}`;
  store.db.prepare("INSERT INTO users(sub,name,roles,hospital) VALUES(?,?,'[]',NULL)").run(sub,name);
  store.db.prepare('INSERT INTO user_identity_profiles VALUES(?,?,?,?)').run(sub,email,email.toLowerCase(),verified);
  return sub;
 };
 return {store,dbFile,add};
}
function admin(dbFile,...args){
 return spawnSync(process.execPath,['scripts/admin.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,DB_FILE:dbFile,NAMOID_ISSUER:issuer}});
}

test('identity profile accepts only provider-verified, mutually consistent email claims',()=>{
 assert.deepEqual(identityProfile({email:'Person@Example.com',email_verified:true},{}),{email:'Person@Example.com',emailNormalized:'person@example.com',emailVerified:true});
 assert.equal(identityProfile({email:'one@example.com',email_verified:true},{email:'two@example.com',email_verified:true}).emailVerified,false);
 assert.equal(identityProfile({email:'pending@example.com',email_verified:false},{}).emailVerified,false);
});

test('administrator can list identities and assign a verified email case-insensitively',()=>{
 const f=fixture();try{
  const sub=f.add('risk-1','Risk Reviewer','Reviewer@Example.com');f.store.close();
  let result=admin(f.dbFile,'users');assert.equal(result.status,0,result.stderr);const listed=JSON.parse(result.stdout.trim());
  assert.equal(listed.email,'Reviewer@Example.com');assert.equal(listed.emailVerified,true);assert.equal(listed.name,'Risk Reviewer');assert.equal(listed.roles,'[]');
  result=admin(f.dbFile,'assign-email','REVIEWER@example.COM','risk');assert.equal(result.status,0,result.stderr);
  const check=openStore(f.dbFile);try{const user=check.db.prepare('SELECT roles,hospital FROM users WHERE sub=?').get(sub);assert.equal(user.roles,'["risk"]');assert.equal(user.hospital,null);assert.equal(check.ledger().at(-1).actor,'local administrator');}finally{check.close();}
 }finally{try{f.store.close();}catch{}}
});

test('email assignment refuses unverified and ambiguous identities',()=>{
 const f=fixture();try{
  f.add('unverified','Unverified','pending@example.com',0);
  f.add('duplicate-a','Duplicate A','shared@example.com');f.add('duplicate-b','Duplicate B','shared@example.com');f.store.close();
  let result=admin(f.dbFile,'assign-email','pending@example.com','manager');assert.notEqual(result.status,0);assert.match(result.stderr,/not verified by NamoID/);
  result=admin(f.dbFile,'assign-email','shared@example.com','owner');assert.notEqual(result.status,0);assert.match(result.stderr,/ambiguous \(2 accounts\)/);
  const check=openStore(f.dbFile);try{for(const user of check.db.prepare('SELECT roles FROM users').all())assert.equal(user.roles,'[]');}finally{check.close();}
 }finally{try{f.store.close();}catch{}}
});

test('verified requester can be assigned multiple distinct hospitals',()=>{
 const f=fixture();try{
  const sub=f.add('requester-1','Research Requester','research@example.com');f.store.close();
  let result=admin(f.dbFile,'assign-email','research@example.com','requester','A,B,C');assert.equal(result.status,0,result.stderr);
  result=admin(f.dbFile,'users');assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()).hospitals,['A','B','C']);
  const check=openStore(f.dbFile);try{assert.deepEqual(check.db.prepare('SELECT hospital FROM user_hospitals WHERE sub=? ORDER BY hospital').all(sub).map(x=>x.hospital),['A','B','C']);}finally{check.close();}
  result=admin(f.dbFile,'assign-email','research@example.com','requester','A,A');assert.notEqual(result.status,0);
 }finally{try{f.store.close();}catch{}}
});
