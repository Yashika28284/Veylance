import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.js';

test('logout requires CSRF and invalidates the local session even if provider discovery is unavailable',async()=>{
 const h=await harness();
 try{
  const denied=await fetch(h.config.origin+'/auth/logout',{method:'POST',headers:{Cookie:h.users.owner.cookie,Origin:h.config.origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,403);
  const logout=await h.call('owner','/auth/logout',{});
  assert.equal(logout.status,200);assert.equal(logout.data.providerLogout,false);
  assert.equal((await h.call('owner','/api/v1/session')).status,401);
 }finally{await h.stop();}
});
