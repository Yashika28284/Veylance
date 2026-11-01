import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
export const canonical = x => Array.isArray(x) ? `[${x.map(canonical)}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')}}` : JSON.stringify(x);
export const hash = x => createHash('sha256').update(x).digest('hex');
export function openStore(file) {
  if(file!==':memory:') mkdirSync(dirname(file),{recursive:true});
  const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
  if(!db.prepare('SELECT * FROM migrations WHERE version=1').get()) {db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));db.exec('INSERT INTO migrations VALUES(1); COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  if(!db.prepare('SELECT * FROM migrations WHERE version=2').get()) {db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(new URL('../migrations/002_identity_profiles.sql',import.meta.url),'utf8'));db.exec('INSERT INTO migrations VALUES(2); COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  if(!db.prepare('SELECT * FROM migrations WHERE version=3').get()) {db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(new URL('../migrations/003_user_hospitals.sql',import.meta.url),'utf8'));db.exec('INSERT INTO migrations VALUES(3); COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const list=table=>db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(x=>JSON.parse(x.data));
  const get=(table,id)=>{const r=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return r?JSON.parse(r.data):null;};
  const put=(table,x)=>db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(x.id,canonical(x));
  function audit(actor,action,warrantId,payload,at=new Date().toISOString()) {
    const last=db.prepare('SELECT seq,hash FROM ledger ORDER BY seq DESC LIMIT 1').get();
    const e={id:(last?.seq??0)+1,at,actor,action,warrantId,hospitalId:payload?.hospitalId??null,detail:canonical(payload??{})};
    const previousHash=last?.hash??'0'.repeat(64),digest=hash(previousHash+'\n'+canonical(e));
    db.prepare('INSERT INTO ledger VALUES(?,?,?,?)').run(e.id,canonical(e),previousHash,digest);return e;
  }
  function verify(checkpoint=null) {
    const rows=db.prepare('SELECT * FROM ledger ORDER BY seq').all();let previous='0'.repeat(64),firstInvalid=null,checked=0;
    for(const r of rows){if(r.seq!==checked+1||r.previous_hash!==previous||hash(previous+'\n'+r.data)!==r.hash){firstInvalid=r.seq;break;}previous=r.hash;checked++;}
    const anchored=checkpoint!=null,anchor=anchored?rows.find(r=>r.seq===checkpoint.seq):null;
    const checkpointVerified=anchored&&anchor?.hash===checkpoint.hash;
    return {valid:firstInvalid===null&&(!anchored||checkpointVerified),count:checked,range:rows.length?[1,rows.at(-1).seq]:[],firstInvalid,method:'SHA-256 over canonical JSON and previous hash',cryptographic:true,independentCheckpointSupplied:anchored,independentCheckpointVerified:checkpointVerified,head:previous,verifiedAt:new Date().toISOString(),message:firstInvalid?`Invalid ledger entry ${firstInvalid}`:anchored&&!checkpointVerified?'Checkpoint mismatch':`Chain consistent · ${checked} entries · ${anchored?'checkpoint matches':'no independent anchor'}`};
  }
  return {db,tx,list,get,put,audit,verify,ledger:()=>db.prepare('SELECT * FROM ledger ORDER BY seq').all().map(r=>({...JSON.parse(r.data),previousHash:r.previous_hash,hash:r.hash})),close:()=>db.close()};
}
