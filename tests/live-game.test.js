const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./helpers/live-harness');
async function setup(){const h=harness(),created=await h.create();assert.equal(created.code,201);const {code,hostToken}=created.body;const joined=await h.join(code);return{...h,code,hostToken,studentToken:joined.body.studentToken};}
test('Only the class editing code creates rooms; selected sets and approved language are validated',async()=>{
 const h=harness(),body={grade:'sixth',password:'wrong',pathnames:[h.setPath],language:'english',count:5};
 assert.equal((await h.request('create',body)).code,401);
 assert.equal((await h.request('create',{...body,password:'demo',pathnames:['vocabulary-cards/seventh/x.html']})).code,400);
 assert.equal((await h.request('create',{...body,password:'demo',language:'hebrew'})).code,400);
 const result=await h.create();assert.equal(result.body.total,5);assert.match(result.body.code,/^\d{6}$/);
 for(const [p,entry]of h.storage)if(p.startsWith('live-vocab/')){assert(!entry.body.includes('correct'));assert(!entry.body.includes('horse'));assert(!entry.body.includes('demo'));}
});
test('Lobby join is idempotent; students cannot reveal, skip, or read host state without authorization',async()=>{
 const h=await setup(),joinKey=crypto.randomUUID();
 await h.join(h.code,'CD',joinKey);await h.join(h.code,'CD',joinKey);
 const view=await h.request(null,{code:h.code},h.hostToken);assert.equal(view.body.playerCount,2);assert.equal(view.body.phase,'lobby');
 assert.equal((await h.request(null,{code:h.code})).code,401);
 assert.equal((await h.request('start',{code:h.code,version:0},h.studentToken)).code,403);
 const student=await h.request(null,{code:h.code},h.studentToken);assert.equal(student.body.players,undefined);
 assert.equal((await h.request('start',{code:h.code,version:0},h.hostToken)).code,200);
 assert.equal((await h.join(h.code,'Late')).code,409);
 assert.equal((await h.request('start',{code:h.code,version:0},h.hostToken)).code,409);
});
test('Answers remain secret until reveal, first tap wins, concurrent answers are retained, and scores update after reveal',async()=>{
 const h=await setup(),second=await h.join(h.code,'CD');await h.request('start',{code:h.code,version:0},h.hostToken);
 const active=(await h.request(null,{code:h.code},h.studentToken)).body;
 assert.equal(active.question.correct,undefined);assert.equal(active.scores,undefined);assert.equal(active.distribution,undefined);
 const definition=h.cards.find(c=>c.term===active.question.term).english,correct=active.question.options.indexOf(definition),wrong=(correct+1)%4;
 await Promise.all([h.request('answer',{code:h.code,index:0,choice:correct},h.studentToken),h.request('answer',{code:h.code,index:0,choice:wrong},second.body.studentToken)]);
 await h.request('answer',{code:h.code,index:0,choice:wrong},h.studentToken);
 const before=(await h.request(null,{code:h.code},h.studentToken)).body;assert.equal(before.me.choice,correct);assert.equal(before.me.score,0);assert.equal(before.answeredCount,2);
 await h.request('reveal',{code:h.code,version:1},h.hostToken);
 const after=(await h.request(null,{code:h.code},h.studentToken)).body;assert.equal(after.question.correct,correct);assert.equal(after.me.score,100);assert.equal(after.distribution.reduce((a,b)=>a+b,0),2);
 assert.equal((await h.request('answer',{code:h.code,index:0,choice:correct},h.studentToken)).code,409);
 await h.request('next',{code:h.code,version:2},h.hostToken);
 const next=(await h.request(null,{code:h.code},h.studentToken)).body;assert.equal(next.index,1);assert.equal(next.me.choice,null);assert.equal(next.me.score,100);assert.equal(next.question.correct,undefined);
});
test('Two host controllers cannot advance the same state twice; refresh reconstructs state and end stops answers',async()=>{
 const h=await setup();const results=await Promise.all([h.request('start',{code:h.code,version:0},h.hostToken),h.request('start',{code:h.code,version:0},h.hostToken)]);assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);
 const refresh=(await h.request(null,{code:h.code},h.hostToken)).body;assert.equal(refresh.version,1);assert.equal(refresh.phase,'question');
 await h.request('end',{code:h.code,version:1},h.hostToken);assert.equal((await h.request(null,{code:h.code},h.studentToken)).body.phase,'ended');assert.equal((await h.request('answer',{code:h.code,index:0,choice:0},h.studentToken)).code,409);
});
test('Tokens are room-scoped and tamper-proof; sessions expire after four hours',async()=>{
 const h=await setup(),other=await h.create();assert.equal((await h.request(null,{code:other.body.code},h.hostToken)).code,401);
 assert.equal((await h.request(null,{code:h.code},h.studentToken+'x')).code,401);
 h.advance(4*60*60*1000+1);assert.equal((await h.request(null,{code:h.code},h.hostToken)).code,410);
});
test('All five questions complete a game and the final board preserves student totals',async()=>{
 const h=await setup();await h.request('start',{code:h.code,version:0},h.hostToken);
 for(let i=0;i<5;i++){
  const view=(await h.request(null,{code:h.code},h.hostToken)).body;
  const correct=view.question.options.indexOf(h.cards.find(c=>c.term===view.question.term).english);
  await h.request('answer',{code:h.code,index:i,choice:correct},h.studentToken);
  await h.request('reveal',{code:h.code,version:view.version},h.hostToken);
  await h.request('next',{code:h.code,version:view.version+1},h.hostToken);
 }
 const final=(await h.request(null,{code:h.code},h.studentToken)).body;assert.equal(final.phase,'ended');assert.equal(final.me.score,500);assert.equal(final.scores[0].score,500);
});

test('Students use at most three letter initials, normalized to uppercase',async()=>{
 const h=harness(),created=await h.create(),code=created.body.code;
 for(const name of ['ABCD','123','A B','A!',''])assert.equal((await h.join(code,name)).code,400);
 for(const name of ['a','ab','abc','אבג'])assert.equal((await h.join(code,name)).code,200);
 const lobby=await h.request(null,{code},created.body.hostToken);
 assert.deepEqual(lobby.body.players.map(p=>p.name),['A','AB','ABC','אבג']);
});
