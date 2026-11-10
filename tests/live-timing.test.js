const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./helpers/live-harness');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
async function setup(options={}){
 const h=harness({database:true,now:100000,...options}),created=await h.create({seconds:options.seconds??5}),{code,hostToken}=created.body;
 const student=(await h.join(code)).body.studentToken;
 await h.request('start',{code,version:0},hostToken);
 const view=(await h.request(null,{code},student)).body;
 const correct=view.question.options.indexOf(h.cards.find(c=>c.term===view.question.term).english);
 return Object.assign(h,{code,hostToken,student,correct});
}
function legacyStates(h){
 const key=crypto.createHash('sha256').update('penina-live-v1:test-only-secret-not-for-production').digest();
 for(const [path,entry]of h.storage){
  if(!path.includes('/state/'))continue;
  const packed=JSON.parse(entry.body),decoder=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(packed.iv,'base64'));
  decoder.setAuthTag(Buffer.from(packed.tag,'base64'));
  const state=JSON.parse(Buffer.concat([decoder.update(Buffer.from(packed.data,'base64')),decoder.final()]).toString());delete state.changedAt;
  const iv=crypto.randomBytes(12),encoder=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([encoder.update(JSON.stringify(state)),encoder.final()]);
  entry.body=JSON.stringify({iv:iv.toString('base64'),tag:encoder.getAuthTag().toString('base64'),data:data.toString('base64')});
 }
}
test('an answer received before the deadline survives a database read that crosses it',async()=>{
 let onRead;const h=await setup({beforeRead:()=>onRead?.()});
 h.advance(4900);onRead=()=>{onRead=null;h.advance(200);};
 const saved=await h.request('answer',{code:h.code,index:0,choice:h.correct},h.student);
 assert.equal(saved.code,200);assert.equal(saved.body.choice,h.correct);
 const reveal=(await h.request(null,{code:h.code},h.student)).body;
 assert.equal(reveal.phase,'reveal');assert.equal(reveal.me.score,125);
});
test('an answer received before closure still counts when another request reveals during its read',async()=>{
 for(const seconds of [0,5]){
  let onRead;const h=await setup({seconds,beforeRead:()=>onRead?.()}),entered=deferred(),resume=deferred();
  h.advance(4900);onRead=()=>{onRead=null;entered.resolve();return resume.promise;};
  const pending=h.request('answer',{code:h.code,index:0,choice:h.correct},h.student);await entered.promise;
  h.advance(100);
  if(seconds)await h.request(null,{code:h.code},h.hostToken);
  else await h.request('reveal',{code:h.code,version:1},h.hostToken);
  resume.resolve();assert.equal((await pending).code,200);
  const view=(await h.request(null,{code:h.code},h.student)).body;assert.equal(view.phase,'reveal');assert.equal(view.me.score,125);
  assert.equal((await h.request('answer',{code:h.code,index:0,choice:h.correct,submittedAt:100000,receivedAt:100000},h.student)).code,409,'client-supplied timestamps cannot reopen answers');
 }
});
test('request arrival controls pause eligibility even when pause or resume occurs during storage work',async()=>{
 let onRead;const h=await setup({seconds:0,beforeRead:()=>onRead?.()}),entered=deferred(),resume=deferred();
 h.advance(10);onRead=()=>{onRead=null;entered.resolve();return resume.promise;};
 const beforePause=h.request('answer',{code:h.code,index:0,choice:h.correct},h.student);await entered.promise;
 h.advance(10);await h.request('pause',{code:h.code,version:1},h.hostToken);resume.resolve();assert.equal((await beforePause).code,200);
 const second=(await h.join(h.code,'CD')).body.studentToken,pausedRead=deferred(),unblock=deferred();
 h.advance(10);onRead=()=>{onRead=null;pausedRead.resolve();return unblock.promise;};
 const duringPause=h.request('answer',{code:h.code,index:0,choice:0},second);await pausedRead.promise;
 h.advance(10);await h.request('resume',{code:h.code,version:2},h.hostToken);unblock.resolve();assert.equal((await duringPause).code,409);
 assert.equal((await h.request('answer',{code:h.code,index:0,choice:0},second)).code,200);
});
test('rooms created before transition timestamps preserve pause and resume eligibility',async()=>{
 let onRead;const h=await setup({beforeRead:()=>onRead?.()}),entered=deferred(),unblock=deferred();
 h.advance(2000);await h.request('pause',{code:h.code,version:1},h.hostToken);h.advance(9000);
 onRead=()=>{onRead=null;entered.resolve();return unblock.promise;};
 const paused=h.request('answer',{code:h.code,index:0,choice:h.correct},h.student);await entered.promise;
 h.advance(1000);await h.request('resume',{code:h.code,version:2},h.hostToken);legacyStates(h);unblock.resolve();
 assert.equal((await paused).code,409,'the shifted countdown origin is not the resume time');
 h.advance(2999);assert.equal((await h.request('answer',{code:h.code,index:0,choice:h.correct},h.student)).code,200);
 h.advance(1);assert.equal((await h.request(null,{code:h.code},h.student)).body.me.score,125);
});
test('the exact timed cutoff stays closed and network delay is not accepted as a client timestamp',async()=>{
 for(const lateBy of [0,1,1000]){
  const h=await setup();h.advance(5000+lateBy);
  const answer=await h.request('answer',{code:h.code,index:0,choice:h.correct,at:100000,submittedAt:100000},h.student);
  assert.equal(answer.code,409);
  assert.equal((await h.request(null,{code:h.code},h.student)).body.me.score,0);
 }
});
test('clock samples include request arrival and response time after storage processing',async()=>{
 let onRead;const h=await setup({beforeRead:()=>onRead?.()});
 onRead=()=>{onRead=null;h.advance(300);};
 const view=(await h.request(null,{code:h.code},h.student)).body;
 assert.equal(view.serverReceivedAt,100000);assert.equal(view.serverNow,100300);
});
test('concurrent Supabase refreshes share only in-flight reads and immediately see later answers',async()=>{
 const h=await setup(),before=h.operations.dbLists;
 const views=await Promise.all(Array.from({length:26},()=>h.request(null,{code:h.code},h.student)));
 assert(views.every(v=>v.code===200));assert.equal(h.operations.dbLists-before,2,'one metadata read and one answer read for the concurrent group');
 await h.request('answer',{code:h.code,index:0,choice:h.correct},h.student);
 const view=(await h.request(null,{code:h.code},h.student)).body;assert.equal(view.me.choice,h.correct);
 const after=h.operations.dbLists;await h.request(null,{code:h.code},h.student);
 assert.equal(h.operations.dbLists-after,2,'no stale cross-request cache for database state');
});
test('concurrent deadline refreshes share one timed transition within a server instance',async()=>{
 const h=await setup();h.advance(5000);const before=h.operations.dbWrites;
 const views=await Promise.all(Array.from({length:26},()=>h.request(null,{code:h.code},h.student)));
 assert(views.every(v=>v.body.phase==='reveal'&&v.body.version===2));assert.equal(h.operations.dbWrites-before,1);
});
test('answer writes and replay snapshots omit unrelated students and old answers from database reads',async()=>{
 const h=await setup({seconds:0});await h.join(h.code,'CD');
 for(let index=0;index<5;index++){
  const view=(await h.request(null,{code:h.code},h.hostToken)).body;
  await h.request('answer',{code:h.code,index,choice:0},h.student);
  await h.request('reveal',{code:h.code,version:view.version},h.hostToken);
  await h.request('next',{code:h.code,version:view.version+1},h.hostToken);
 }
 let view=(await h.request(null,{code:h.code},h.hostToken)).body;
 await h.request('restart',{code:h.code,version:view.version},h.hostToken);
 view=(await h.request(null,{code:h.code},h.hostToken)).body;await h.request('start',{code:h.code,version:view.version},h.hostToken);
 const oldAnswers=[...h.storage.keys()].filter(p=>p.includes('/answers/')&&!p.includes('/rounds/'));assert.equal(oldAnswers.length,5);
 h.reads.length=0;
 const answer=await h.request('answer',{code:h.code,round:1,index:0,choice:0},h.student);assert.equal(answer.code,200);
 assert.equal(h.reads.length,1);assert.equal(h.reads[0].returned.filter(p=>p.includes('/players/')).length,1);
 assert(!h.reads.flatMap(r=>r.returned).some(p=>oldAnswers.includes(p)));
 h.reads.length=0;view=(await h.request(null,{code:h.code},h.student)).body;
 assert.equal(view.round,1);assert.equal(view.me.choice,0);assert.equal(view.me.score,0);
 assert(!h.reads.flatMap(r=>r.returned).some(p=>oldAnswers.includes(p)));
 assert(h.reads.some(r=>r.prefix.endsWith('/rounds/1/answers/')));
});
