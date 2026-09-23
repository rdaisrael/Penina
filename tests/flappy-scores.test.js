const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness(){
 const blobs=[];let page=0;
 const ctx={module:{exports:{}},console,require:name=>name==='@vercel/blob'?{
  list:async({prefix,cursor})=>{const matches=blobs.filter(b=>b.pathname.startsWith(prefix));const start=Number(cursor)||0;return{blobs:matches.slice(start,start+2),hasMore:start+2<matches.length,cursor:String(start+2)}},
  put:async(pathname)=>{if(blobs.some(b=>b.pathname===pathname)){const e=new Error();e.name='BlobAlreadyExistsError';throw e;}blobs.push({pathname,uploadedAt:String(++page).padStart(5,'0')});}
 }:{getPage:async id=>['sixth','seventh'].includes(id)?{id}:null}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/flappy-scores.js'),'utf8'),ctx);
 return async(method,grade,body)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=JSON.parse(JSON.stringify(value));return this;}};await ctx.module.exports({method,query:{grade},body},res);return res;};
}
test('Class board persists top three across paginated submissions, isolates classes and handles duplicate submissions',async()=>{
 const request=harness();
 for(const [i,score] of [-300,500,400,600].entries())assert.equal((await request('POST','sixth',{initials:'ABC',score,rounds:3,runId:'completed-run-'+i})).code,200);
 await request('POST','sixth',{initials:'ABC',score:600,rounds:3,runId:'completed-run-3'});
 assert.deepEqual((await request('GET','sixth')).body.scores.map(s=>s.score),[600,500,400]);
 assert.deepEqual((await request('GET','seventh')).body.scores,[]);
});
test('Board rejects names, invalid scores, incomplete runs, missing classes and unsupported methods',async()=>{
 const request=harness(),valid={initials:'AB',score:500,rounds:3,runId:'completed-run-1'};
 for(const edit of [{initials:'David'},{initials:'<x>'},{score:-5},{score:1505},{score:NaN},{score:501},{runId:'../x'}])assert.equal((await request('POST','sixth',{...valid,...edit})).code,400);
 assert.equal((await request('GET','missing')).code,404);assert.equal((await request('DELETE','sixth')).code,405);
});
