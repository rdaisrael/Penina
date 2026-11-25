const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const DAY=86400000,START=Date.parse('2026-01-01T13:00:00Z');
const quiz='custom-'+'a'.repeat(32),other='custom-'+'b'.repeat(32),hash='c'.repeat(64);
function harness(){
 const data=new Map(),state={now:START,sends:[],failEmail:false,failDelete:false,revision:0,pageSize:2};
 const env={CRON_SECRET:'local-secret',RESEND_API_KEY:'local-email',QUIZ_EMAIL_FROM:'penina@example.test'};
 const seal=value=>'sealed:'+JSON.stringify(value),unseal=value=>JSON.parse(value.slice(7));
 const add=(pathname,body,uploadedAt=START)=>data.set(pathname,{pathname,url:'https://blob.test/'+pathname,body,uploadedAt:new Date(uploadedAt),size:Buffer.byteLength(body),etag:'v'+(++state.revision)});
 const putRecord=(path,value,date)=>add(path,seal(value),date);
 const pathOf=value=>String(value).replace('https://blob.test/','').split('?')[0];
 class BlobNotFoundError extends Error{}class BlobPreconditionFailedError extends Error{}
 const blob={BlobNotFoundError,BlobPreconditionFailedError,
  list:async({prefix,cursor,limit=1000})=>{const rows=[...data.values()].filter(b=>b.pathname.startsWith(prefix)).sort((a,b)=>a.pathname.localeCompare(b.pathname)),offset=Number(cursor)||0,end=offset+Math.min(limit,state.pageSize);return {blobs:rows.slice(offset,end).map(({body,...b})=>b),hasMore:end<rows.length,cursor:String(end)};},
  put:async(path,body,options)=>{const old=data.get(path);if(options.ifMatch && old?.etag!==options.ifMatch)throw new BlobPreconditionFailedError();if(old && !options.allowOverwrite)throw Error('Exists');add(path,body,state.now);return data.get(path);},
  head:async path=>{const value=data.get(pathOf(path));if(!value)throw new BlobNotFoundError();return value;},
  get:async url=>{const value=data.get(pathOf(url));return value?{statusCode:200,blob:value,stream:new Response(value.body).body}:null;},
  del:async(paths,options={})=>{for(const value of Array.isArray(paths)?paths:[paths]){const path=pathOf(value);if(options.ifMatch && data.get(path)?.etag!==options.ifMatch)throw new BlobPreconditionFailedError();if(state.failDelete && path.startsWith('quiz-recordings/') && !path.endsWith('/0.json'))throw Error('Delete interrupted');data.delete(path);}}
 };
 const context={module:{exports:{}},Buffer,Response,AbortSignal,process:{env},Date:class extends Date{constructor(...args){super(...(args.length?args:[state.now]));}static now(){return state.now;}},
  require:name=>name==='crypto'?require('node:crypto'):name==='@vercel/blob'?blob:name==='./quiz-account'?{seal,unseal}:(()=>{throw Error(name);})(),
  fetch:async(url,options)=>{
   if(url==='https://api.resend.com/emails'){state.sends.push({payload:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return {ok:!state.failEmail};}
   const value=data.get(pathOf(url));return {ok:!!value,text:async()=>value.body};
  }
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../lib/quiz-recording-retention'),'utf8'),context);
 putRecord('quiz-builder/published/'+quiz+'.txt',{id:quiz,owner:'teacher-a',title:'Reading quiz'});
 putRecord('quiz-google/teachers/teacher-a.txt',{email:'owner@school.test'});
 const audio=(id=quiz,h=hash,day=0,parts=false)=>{
  const base='quiz-recordings/'+id+'/'+h;
  add(base+'.json','encrypted audio',START+day*DAY);
  if(parts)for(let i=0;i<3;i++)add(base+'-parts/'+i+'.json','encrypted part '+i,START+day*DAY);
  return base;
 };
 return {api:context.module.exports,data,state,env,add,putRecord,audio,day:n=>state.now=START+n*DAY,unseal};
}
test('90-day cleanup sends owner reminders at days 80 and 85, retains results, and deletes every audio part',async()=>{
 const h=harness(),base=h.audio(quiz,hash,0,true),recent=h.audio(quiz,'d'.repeat(64),30),foreign=h.audio(other,'e'.repeat(64),30);
 for(const prefix of ['quiz-submissions/','quiz-corrections/','quiz-reviews/'])h.putRecord(prefix+quiz+'/answer.json',{grade:5});
 h.day(79);await h.api.sweep();assert.equal(h.state.sends.length,0);
 h.day(80);await h.api.sweep();assert.equal(h.state.sends.length,1);
 assert.deepEqual(h.state.sends[0].payload.to,['owner@school.test']);assert.match(h.state.sends[0].payload.subject,/10 days/);
 assert.match(h.state.sends[0].payload.text,/Reading quiz/);assert.match(h.state.sends[0].payload.text,/teacher\.html\?quiz=/);
 await h.api.sweep();h.day(84);await h.api.sweep();assert.equal(h.state.sends.length,1);
 h.day(85);await h.api.sweep();assert.equal(h.state.sends.length,2);assert.match(h.state.sends[1].payload.subject,/5 days/);
 h.day(89);await h.api.sweep();assert(h.data.has(base+'.json'));
 h.day(90);const result=await h.api.sweep();assert.equal(result.recordingsDeleted,1);
 assert(![...h.data.keys()].some(p=>p.startsWith(base)));assert(h.data.has(recent+'.json'));assert(h.data.has(foreign+'.json'));
 for(const prefix of ['quiz-submissions/','quiz-corrections/','quiz-reviews/'])assert(h.data.has(prefix+quiz+'/answer.json'));
 await assert.rejects(h.api.assertAvailable(base+'.json'),e=>e.status===410);
 h.day(91);await h.api.sweep();assert.equal(h.state.sends.length,2);
 assert(![...h.data.keys()].some(p=>p.startsWith('quiz-recording-retention/'+quiz+'/')),'finished plans do not accumulate');
});
test('Legacy audio and failed reminders get both full warning periods before removal',async()=>{
 const h=harness(),base=h.audio();h.day(100);h.state.failEmail=true;
 assert.equal((await h.api.sweep()).failed,1);assert(h.data.has(base+'.json'));
 h.day(101);h.state.failEmail=false;await h.api.sweep();assert(h.data.has(base+'.json'));
 h.day(106);h.state.failEmail=true;await h.api.sweep();assert(h.data.has(base+'.json'));
 h.day(108);h.state.failEmail=false;await h.api.sweep();
 h.day(112);await h.api.sweep();assert(h.data.has(base+'.json'));
 h.day(113);await h.api.sweep();assert(!h.data.has(base+'.json'));
});
test('A daily batch includes later recordings on the same date without dropping them or deleting them early',async()=>{
 const h=harness(),first=h.audio(),second=h.audio(quiz,'d'.repeat(64),0.25);
 h.day(80);await h.api.sweep();assert.equal(h.state.sends.length,0);
 h.day(81);await h.api.sweep();assert.equal(h.state.sends.length,1);assert.match(h.state.sends[0].payload.text,/2 saved recording/);
 h.day(86);await h.api.sweep();h.day(90);await h.api.sweep();assert(h.data.has(first+'.json'));assert(h.data.has(second+'.json'));
 h.day(91);await h.api.sweep();assert(!h.data.has(first+'.json'));assert(!h.data.has(second+'.json'));
});
test('Owner lookup failures never redirect reminders to the administrator or permit deletion',async()=>{
 const h=harness(),base=h.audio();h.data.delete('quiz-google/teachers/teacher-a.txt');h.day(100);
 assert.equal((await h.api.sweep()).failed,1);assert.equal(h.state.sends.length,0);assert(h.data.has(base+'.json'));
 h.putRecord('quiz-google/teachers/teacher-a.txt',{email:'restored-owner@school.test'});
 await h.api.sweep();assert.deepEqual(h.state.sends[0].payload.to,['restored-owner@school.test']);
 h.day(105);h.putRecord('quiz-google/teachers/teacher-a.txt',{email:'updated-owner@school.test'});await h.api.sweep();
 assert.deepEqual(h.state.sends[1].payload.to,['updated-owner@school.test']);
});
test('Cleanup recovers from partial multipart deletion and includes abandoned parts',async()=>{
 const h=harness(),base=h.audio(quiz,hash,0,true),orphan='quiz-recordings/'+quiz+'/'+'f'.repeat(64)+'-parts/0.json';h.add(orphan,'unfinished');
 h.day(80);await h.api.sweep();h.day(85);await h.api.sweep();h.day(90);h.state.failDelete=true;
 assert.equal((await h.api.sweep()).failed,1);assert(!h.data.has(base+'-parts/0.json'));assert(h.data.has(base+'.json'));
 h.state.failDelete=false;await h.api.sweep();assert(!h.data.has(base+'.json'));assert(!h.data.has(orphan));assert.equal(h.state.sends.length,2);
});
test('Manual deletion requires a fresh confirmed owner-bound preview and preserves other quiz data',async()=>{
 const h=harness(),base=h.audio(quiz,hash,0,true),foreign=h.audio(other),q={id:quiz},owner={sub:'teacher-a'};
 h.putRecord('quiz-submissions/'+quiz+'/result.json',{answers:['recording']});
 const preview=await h.api.manual(q,owner,{action:'recordings-delete-preview'});assert.equal(preview.count,1);
 await assert.rejects(h.api.manual(q,owner,{action:'recordings-delete',token:preview.token}),e=>e.status===400);
 await assert.rejects(h.api.manual(q,{sub:'other'},{action:'recordings-delete',token:preview.token,confirmPermanentDeletion:true}),e=>e.status===400);
 await assert.rejects(h.api.manual({id:other},owner,{action:'recordings-delete',token:preview.token,confirmPermanentDeletion:true}),e=>e.status===400);
 h.audio(quiz,'d'.repeat(64));await assert.rejects(h.api.manual(q,owner,{action:'recordings-delete',token:preview.token,confirmPermanentDeletion:true}),e=>e.status===409);
 const refreshed=await h.api.manual(q,owner,{action:'recordings-delete-preview'});
 const deleted=await h.api.manual(q,owner,{action:'recordings-delete',token:refreshed.token,confirmPermanentDeletion:true});assert.equal(deleted.deleted,2);
 assert(![...h.data.keys()].some(p=>p.startsWith(base)));assert(h.data.has(foreign+'.json'));assert(h.data.has('quiz-submissions/'+quiz+'/result.json'));
 assert.equal(h.state.sends.length,0);
});
test('Expired previews, invalid dates and unrecognized files are never silently deleted',async()=>{
 const h=harness();h.audio();const q={id:quiz},owner={sub:'teacher-a'};
 const preview=await h.api.manual(q,owner,{action:'recordings-delete-preview'});h.day(1);
 await assert.rejects(h.api.manual(q,owner,{action:'recordings-delete',token:preview.token,confirmPermanentDeletion:true}),e=>e.status===400);
 h.data.get('quiz-recordings/'+quiz+'/'+hash+'.json').uploadedAt='invalid';h.add('quiz-recordings/'+quiz+'/unrecognized.txt','keep');
 h.day(200);await h.api.sweep();assert.equal(h.state.sends.length,0);assert(h.data.has('quiz-recordings/'+quiz+'/'+hash+'.json'));
});
test('Overlapping cron requests use a conditional lease and do not double-send reminders',async()=>{
 const h=harness();h.audio();h.day(80);const results=await Promise.all([h.api.sweep(),h.api.sweep()]);
 assert.equal(results.filter(r=>r.busy).length,1);assert.equal(h.state.sends.length,1);
 h.putRecord('quiz-recording-retention-lock/run.txt',{until:h.state.now-1});await h.api.sweep();assert.equal(h.state.sends.length,1);
});
test('Cron fails closed without its secret and requires the matching bearer token',async()=>{
 const h=harness();h.audio();h.day(100);
 async function call(method,authorization){const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await h.api.handle({method,headers:{authorization}},res);return res;}
 assert.equal((await call('POST','Bearer local-secret')).code,405);
 assert.equal((await call('GET','Bearer wrong')).code,401);
 assert.equal((await call('GET',undefined)).code,401);assert.equal(h.state.sends.length,0);
 delete h.env.CRON_SECRET;assert.equal((await call('GET','Bearer local-secret')).code,503);assert.equal(h.state.sends.length,0);
 h.env.CRON_SECRET='local-secret';assert.equal((await call('GET','Bearer local-secret')).code,200);assert.equal(h.state.sends.length,1);
});
test('Scheduled route uses the existing function once daily',()=>{
 const config=require('../vercel.json');assert.deepEqual(config.crons,[{path:'/api/recording-retention',schedule:'0 13 * * *'}]);
 assert.equal(config.routes.find(r=>r.src && new RegExp(r.src).test('/api/recording-retention')).dest,'/api/game-scores?game=quiz-recording-retention');
});
