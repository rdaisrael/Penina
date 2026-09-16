const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const app=require('../PeninaPlus-vocab-builder/offline-study-cards');
function harness(){
 const set='vocabulary-cards/sixth/sample.html',blobs=[{pathname:set,url:'memory:sample'}],card={n:1,term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['dog','cat','bird','fish']}}};
 const ctx={module:{exports:{}},Buffer,console,fetch:async()=>({ok:true,text:async()=>app.makeApp('Test',[card])}),require:name=>name==='@vercel/blob'?{
 list:async({prefix,cursor})=>{const all=blobs.filter(b=>b.pathname.startsWith(prefix)),start=Number(cursor||0);return{blobs:all.slice(start,start+2),hasMore:start+2<all.length,cursor:String(start+2)}},
 put:async(pathname)=>{if(blobs.some(b=>b.pathname===pathname))throw new Error('exists');blobs.push({pathname,uploadedAt:new Date().toISOString()})}
 }:name.includes('vocabulary-pages')?{getPage:async id=>['sixth','seventh'].includes(id)?{id}:null}:app};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/matching-scores.js'),'utf8'),ctx);
 return async(method,body,grade='sixth')=>{const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.body=JSON.parse(JSON.stringify(data));return this;}};await ctx.module.exports({method,query:{grade,set},body},res);return res;};
}
const valid={initials:'AB',milliseconds:15000,language:'english',matched:1,runId:'completed-run-1'};
test('Timed match board ranks fastest three per set and language and deduplicates retry submissions',async()=>{
 const request=harness();
 for(const [i,milliseconds] of [15000,12000,18000,10000].entries())assert.equal((await request('POST',{...valid,milliseconds,runId:'completed-run-'+i})).code,200);
 await request('POST',{...valid,milliseconds:10000,runId:'completed-run-3'});
 const result=await request('GET');assert.equal(result.body.boards.length,1);assert.deepEqual(result.body.boards[0].scores.map(s=>s.milliseconds),[10000,12000,15000]);
 assert.deepEqual((await request('GET',null,'seventh')).body.boards,[]);
});
test('Timed match submissions require initials, valid duration and every term from the published set',async()=>{
 const request=harness();for(const edit of [{initials:'David'},{milliseconds:0},{milliseconds:86400001},{milliseconds:1.5},{matched:2},{language:'hebrew'},{runId:'bad'}])assert.equal((await request('POST',{...valid,...edit})).code,400);
 assert.equal((await request('DELETE')).code,405);
});
