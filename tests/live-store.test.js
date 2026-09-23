const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../lib/live-store'),'utf8');
function harness(responses){const calls=[];const ctx={module:{exports:{}},URLSearchParams,Date,AbortSignal,process:{env:{PENINA_SUPABASE_URL:'https://example.supabase.co',PENINA_SUPABASE_SECRET_KEY:'sb_secret_test',PENINA_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}},fetch:async(url,options)=>{calls.push({url,options});const next=responses.shift()||{status:201};return{ok:next.status<400,status:next.status,json:async()=>next.rows};}};vm.runInNewContext(source,ctx);return{store:ctx.module.exports,calls};}
test('Database adapter paginates events and sends the secret only in server request headers',async()=>{
 const first=Array.from({length:1000},(_,i)=>({path:'live-vocab/v1/123456/'+i,payload:'encrypted'}));const h=harness([{status:200,rows:first},{status:200,rows:[{path:'last',payload:'encrypted'}]}]);
 const rows=await h.store.list('live-vocab/v1/123456/');assert.equal(rows.length,1001);assert(h.calls[1].url.includes('offset=1000'));assert.equal(h.calls[0].options.headers.apikey,'sb_secret_test');assert(!h.calls[0].url.includes('sb_secret'));
 assert.equal(h.store.realtime('topic').key,'sb_publishable_test');assert(!JSON.stringify(h.store.realtime('topic')).includes('sb_secret'));
});
test('Immutable database writes preserve conflicts and never overwrite another answer',async()=>{
 const h=harness([{status:409}]);await assert.rejects(h.store.put('path','encrypted','topic'),e=>e.status===409);assert.equal(h.calls[0].options.method,'POST');assert(!h.calls[0].options.headers.Prefer.includes('merge'));
});
test('Database errors fail closed and expired record cleanup is limited by expiry',async()=>{
 const h=harness([{status:503},{status:204}]);await assert.rejects(h.store.list('prefix'),/503/);await h.store.prune();assert.equal(h.calls[1].options.method,'DELETE');assert(h.calls[1].url.includes('expires_at=lt.'));
});
