import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,request} from './helpers.js';

test('reviewer can reject a pending warrant after approving; requester cannot',async()=>{
 const h=await harness();
 try{
  const created=await h.call('A','/api/v1/warrants',request('A'));const id=created.data.id;
  assert.equal((await h.call('manager',`/api/v1/warrants/${id}/reviews`,{})).status,200);
  assert.equal((await h.call('A',`/api/v1/warrants/${id}/reviews`,{decision:'reject'})).status,403);
  const rejected=await h.call('manager',`/api/v1/warrants/${id}/reviews`,{decision:'reject'});
  assert.equal(rejected.status,200);assert.equal(rejected.data.status,'rejected');
  assert.equal((await h.call('risk',`/api/v1/warrants/${id}/reviews`,{})).status,409);
 }finally{await h.stop();}
});
