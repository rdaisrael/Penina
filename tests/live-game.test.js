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
 h.advance(4*60*60*1000+1);assert.equal((await h.request(null,{code:h.code},h.hostToken)).code,401);
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

test('Timed pacing enforces each deadline, reveals for two seconds, advances once and finishes',async()=>{
 for(const seconds of [5,7,10]){
  const h=harness(),created=await h.create({seconds}),{code,hostToken}=created.body,joined=await h.join(code),student=joined.body.studentToken;
  await h.request('start',{code,version:0},hostToken);
  for(let index=0;index<5;index++){
   let view=(await h.request(null,{code},student)).body;
   assert.equal(view.index,index);assert.equal(view.phase,'question');assert.equal(view.deadline-view.serverNow,seconds*1000);
   const choice=view.question.options.indexOf(h.cards.find(c=>c.term===view.question.term).english);
   await h.request('answer',{code,index,choice},student);
   h.advance(seconds*1000-1);assert.equal((await h.request(null,{code},student)).body.phase,'question');
   h.advance(1);assert.equal((await h.request('answer',{code,index,choice},student)).code,409);
   view=(await h.request(null,{code},student)).body;assert.equal(view.phase,'reveal');assert.equal(view.me.score,(index+1)*100);
   h.advance(1999);assert.equal((await h.request(null,{code},student)).body.phase,'reveal');h.advance(1);
   const views=await Promise.all([h.request(null,{code},student),h.request(null,{code},hostToken)]);
   assert.equal(views[0].body.version,3+index*2);assert.equal(views[1].body.version,3+index*2);
  }
  assert.equal((await h.request(null,{code},student)).body.phase,'ended');
 }
});
test('Manual pacing never advances on its own and unsupported timers are rejected',async()=>{
 const h=await setup();await h.request('start',{code:h.code,version:0},h.hostToken);h.advance(60000);
 const view=(await h.request(null,{code:h.code},h.hostToken)).body;assert.equal(view.phase,'question');assert.equal(view.deadline,null);
 for(const seconds of [1,6,15,'5',-1])assert.equal((await h.create({seconds})).code,400);
});
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const client=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
test('Correct-answer fireworks run only after reveal, only once, and honor reduced motion',()=>{
 const start=client.indexOf(' function fireworks(data){'),end=client.indexOf(' function draw(data){');
 function run(host=false,reduced=false){
  const bursts=[],timers=[];
  const element=()=>({style:{},children:[],setAttribute(){},append(child){this.children.push(child);},remove(){this.removed=true;}});
  const context={host,celebrated:new Set(),window:{matchMedia:()=>({matches:reduced})},document:{createElement:element,body:{append:el=>bursts.push(el)}},setTimeout:fn=>timers.push(fn)};
  vm.createContext(context);vm.runInContext(client.slice(start,end),context);
  const data={index:0,phase:'question',me:{choice:1},question:{correct:1}};
  context.fireworks(data);assert.equal(bursts.length,0);
  data.phase='reveal';context.fireworks(data);context.fireworks(data);
  assert.equal(bursts.length,host||reduced?0:1);
  if(bursts.length){assert.equal(bursts[0].children.length,48);timers[0]();assert.equal(bursts[0].removed,true);}
  context.fireworks({...data,index:1,me:{choice:2}});context.fireworks({...data,index:2,me:{choice:null}});
  assert.equal(bursts.length,host||reduced?0:1);
 }
 run();run(true);run(false,true);
});
test('Countdown shows remaining seconds and disables student choices at zero',()=>{
 const clock={textContent:''},button={disabled:false};
 const context={snapshot:{deadline:10000,phase:'question'},clockOffset:0,Date:{now:()=>5100},stage:{querySelector:()=>clock,querySelectorAll:()=>[button]}};
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function updateClock(){'),client.indexOf(' function fireworks(data){')),context);
 context.updateClock();assert.equal(clock.textContent,'Time left: 5s');assert.equal(button.disabled,false);
 context.Date.now=()=>10000;context.updateClock();assert.equal(clock.textContent,'Time left: 0s');assert.equal(button.disabled,true);
 context.snapshot.phase='reveal';context.snapshot.deadline=13000;context.updateClock();assert.equal(clock.textContent,'Next question in 3s');
});

test('Teacher pause freezes timing and student answers; resume preserves remaining time',async()=>{
 const h=harness(),created=await h.create({seconds:5}),{code,hostToken}=created.body,student=(await h.join(code)).body.studentToken;
 await h.request('start',{code,version:0},hostToken);h.advance(2000);
 assert.equal((await h.request('pause',{code,version:1},student)).code,403);
 assert.equal((await h.request('pause',{code,version:1},hostToken)).code,200);
 h.advance(30000);let view=(await h.request(null,{code},student)).body;assert.equal(view.paused,true);assert.equal(view.phase,'question');assert.equal(view.deadline,null);
 assert.equal((await h.request('answer',{code,index:0,choice:0},student)).code,409);
 await h.request('resume',{code,version:2},hostToken);view=(await h.request(null,{code},student)).body;assert.equal(view.deadline-view.serverNow,3000);
 h.advance(3000);view=(await h.request(null,{code},student)).body;assert.equal(view.phase,'reveal');
 await h.request('pause',{code,version:view.version},hostToken);h.advance(10000);view=(await h.request(null,{code},student)).body;assert.equal(view.phase,'reveal');assert.equal(view.paused,true);
 await h.request('resume',{code,version:view.version},hostToken);h.advance(2000);view=(await h.request(null,{code},student)).body;assert.equal(view.phase,'question');assert.equal(view.lastReveal.question.correct>=0,true);
});
test('Live standings expose only three places while preserving each personal score',async()=>{
 const h=await setup();for(const name of ['CD','EF','GH','IJ'])await h.join(h.code,name);
 await h.request('start',{code:h.code,version:0},h.hostToken);await h.request('reveal',{code:h.code,version:1},h.hostToken);
 const view=(await h.request(null,{code:h.code},h.studentToken)).body;assert.equal(view.scores.length,3);assert.equal(view.me.score,0);
});
test('A screen that misses the server reveal still displays the answer for two seconds',()=>{
 let now=1000;const drawn=[];
 const context={Date:{now:()=>now},revealSeen:new Set(),revealUntil:0,snapshot:null,clockOffset:0,draw:data=>{context.snapshot=data;drawn.push(data.phase);},updateClock(){}};
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function present(data){'),client.indexOf(' function draw(data){')),context);
 const data={phase:'question',index:1,lastReveal:{phase:'reveal',index:0}};
 context.present(data);assert.deepEqual(drawn,['reveal']);now=2999;context.present(data);assert.deepEqual(drawn,['reveal']);now=3000;context.present(data);assert.deepEqual(drawn,['reveal','question']);
});

test('Wrong answers show a brief X only to that student after reveal, once per question',()=>{
 const marks=[],timers=[];
 const context={host:false,celebrated:new Set(),document:{createElement:()=>({children:[],setAttribute(){},append(...items){this.children.push(...items);},remove(){this.removed=true;}}),body:{append:mark=>marks.push(mark)}},setTimeout:fn=>timers.push(fn)};
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function wrongAnswer(data){'),client.indexOf(' function present(data){')),context);
 const data={phase:'question',index:0,me:{choice:1},question:{correct:0}};
 context.wrongAnswer(data);assert.equal(marks.length,0);data.phase='reveal';context.wrongAnswer(data);context.wrongAnswer(data);
 assert.equal(marks.length,1);assert.equal(marks[0].children[0].textContent,'✕');timers[0]();assert.equal(marks[0].removed,true);
 context.wrongAnswer({...data,index:1,me:{choice:0}});context.wrongAnswer({...data,index:2,me:{choice:null}});context.host=true;context.wrongAnswer({...data,index:3});assert.equal(marks.length,1);
});

test('Concurrent classroom reads share storage work, while answers invalidate the cache',async()=>{
 const h=await setup();await h.request('start',{code:h.code,version:0},h.hostToken);
 const before=h.operations.lists;
 const views=await Promise.all(Array.from({length:26},()=>h.request(null,{code:h.code},h.studentToken)));
 assert.equal(h.operations.lists-before,1);assert(views.every(v=>v.body.phase==='question'));
 await h.request('answer',{code:h.code,index:0,choice:1},h.studentToken);
 const refreshed=await h.request(null,{code:h.code},h.studentToken);assert.equal(refreshed.body.me.choice,1);
 const cached=h.operations.lists;await h.request(null,{code:h.code},h.studentToken);assert.equal(h.operations.lists,cached);
 h.advance(751);await h.request(null,{code:h.code},h.studentToken);assert.equal(h.operations.lists,cached+1);
 const unauth=h.operations.lists;assert.equal((await h.request(null,{code:h.code})).code,401);assert.equal(h.operations.lists,unauth);
});

test('Finished games keep listening for replay; hidden games stop polling and failures back off',async()=>{
 const source=client.slice(client.indexOf(' async function poll(){'),client.indexOf(' async function act('));
 let calls=0;const scheduled=[];
 const context={inFlight:false,connectRealtime(){},disconnectRealtime(){},nextPollDelay(){return Math.min(30000,2000*2**Math.min(context.failures,4));},clearTimeout(){},timer:null,stopped:false,auth:'token',document:{hidden:false},pollId:0,snapshot:null,failures:0,online:true,status:{},host:false,showError(){},draw(){},updateClock(){},present(data){context.snapshot=data;},request:async()=>{calls++;return {phase:'ended',version:2};},setTimeout(fn,ms){scheduled.push(ms);}};
 vm.createContext(context);vm.runInContext(source,context);
 await context.poll();assert.equal(context.stopped,false);assert.equal(scheduled.length,1);scheduled.length=0;
 context.stopped=false;context.snapshot=null;context.document.hidden=true;await context.poll();assert.equal(calls,1);
 context.document.hidden=false;context.request=async()=>{throw new Error('Storage unavailable');};await context.poll();await context.poll();assert.deepEqual(scheduled,[4000,8000]);
});

test('Supabase classroom game uses zero Blob operations after loading vocabulary, preserves first answers and scores',async()=>{
 const h=harness({database:true}),created=await h.create({seconds:5}),{code,hostToken}=created.body;
 const before={...h.operations};const students=[];
 for(let i=0;i<26;i++)students.push((await h.join(code,'A'+String.fromCharCode(65+i))).body.studentToken);
 await h.request('start',{code,version:0},hostToken);
 for(let index=0;index<5;index++){
  const view=(await h.request(null,{code},hostToken)).body;
  assert.equal(view.realtime.key,'publishable-test');assert.match(view.realtime.topic,/^penina-[a-f0-9]{64}$/);
  assert.equal(view.question.correct,undefined);
  const correct=view.question.options.indexOf(h.cards.find(c=>c.term===view.question.term).english);
  const responses=await Promise.all(students.map(student=>h.request('answer',{code,index,choice:correct},student)));assert(responses.every(r=>r.code===200));
  await h.request('answer',{code,index,choice:(correct+1)%4},students[0]);
  h.advance(5000);const reveal=(await h.request(null,{code},students[0])).body;assert.equal(reveal.phase,'reveal');assert.equal(reveal.me.score,100*(index+1));assert.equal(reveal.scores.length,3);
  h.advance(2000);await h.request(null,{code},hostToken);
 }
 const end=(await h.request(null,{code},students[0])).body;assert.equal(end.phase,'ended');assert.equal(end.me.score,500);
 assert.equal(h.operations.lists,before.lists);assert.equal(h.operations.writes,before.writes);assert(h.operations.dbWrites>130);
});
test('Realtime scheduling uses a quiet fallback and local deadlines rather than constant polling',()=>{
 const context={failures:0,realtimeReady:true,snapshot:{phase:'question',deadline:null},revealUntil:0,clockOffset:0,Date:{now:()=>1000}};
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function nextPollDelay(){'),client.indexOf(' async function poll(){')),context);
 assert.equal(context.nextPollDelay(),15000);context.snapshot.deadline=6000;assert.equal(context.nextPollDelay(),5100);
 context.snapshot={phase:'reveal',deadline:3000};context.revealUntil=2500;assert.equal(context.nextPollDelay(),1520);
 context.failures=4;assert.equal(context.nextPollDelay(),30000);
});

test('Score email is opt-in, validates recipient, and requires configured sending service',async()=>{
 const h=harness();
 assert.equal((await h.create({sendScoresToTeacher:true,teacherEmail:'invalid'})).code,400);
 assert.equal((await h.create({sendScoresToTeacher:true,teacherEmail:'teacher@example.com'})).code,503);
 assert.equal((await h.create({sendScoresToTeacher:false,teacherEmail:'ignored@example.com'})).code,201);
 assert.equal(h.emails.length,0);
});

test('Final score email includes every student, stays private, and is not resent after refresh',async()=>{
 const h=harness({env:{RESEND_API_KEY:'test-key',LIVE_SCORE_EMAIL_FROM:'Penina <scores@example.com>'}});
 const created=await h.create({sendScoresToTeacher:true,teacherEmail:' teacher@example.com '}),{code,hostToken}=created.body;
 assert.equal(created.code,201);
 const students=await Promise.all(['AA','BB','CC','DD'].map(name=>h.join(code,name)));
 await h.request('start',{code,version:0},hostToken);
 const question=(await h.request(null,{code},hostToken)).body.question;
 const correct=question.options.indexOf(h.cards.find(card=>card.term===question.term).english);
 await h.request('answer',{code,index:0,choice:correct},students[3].body.studentToken);
 assert.equal(h.emails.length,0);
 await h.request('reveal',{code,version:1},hostToken);
 await h.request('end',{code,version:2},hostToken);
 assert.equal(h.emails.length,1);
 assert.deepEqual(h.emails[0].body.to,['teacher@example.com']);
 for(const name of ['AA','BB','CC','DD'])assert(h.emails[0].body.text.includes(name+':'));
 assert(h.emails[0].body.text.includes('DD: 100 points'));
 assert(h.emails[0].body.text.includes('Questions scored: 1'));
 assert(h.emails[0].headers['Idempotency-Key']);
 const host=await h.request(null,{code},hostToken),student=await h.request(null,{code},students[0].body.studentToken);
 assert.equal(host.body.scoreEmail.status,'sent');assert.equal(host.body.finalScores.length,4);
 assert.equal(student.body.finalScores,undefined);assert.equal(student.body.scoreEmail,undefined);
 assert(!JSON.stringify(student.body).includes('teacher@example.com'));
 assert.equal(h.emails.length,1);
 for(const [pathname,entry]of h.storage)if(pathname.startsWith('live-vocab/'))assert(!entry.body.includes('teacher@example.com'));
});

test('Email provider failures do not stop final scores and retries use the same idempotency key',async()=>{
 const options={env:{RESEND_API_KEY:'test-key',LIVE_SCORE_EMAIL_FROM:'scores@example.com'},emailFailure:true};
 const h=harness(options),created=await h.create({sendScoresToTeacher:true,teacherEmail:'teacher@example.com'}),{code,hostToken}=created.body;
 await h.join(code);await h.request('end',{code,version:0},hostToken);
 const failed=await h.request(null,{code},hostToken);
 assert.equal(failed.code,200);assert.equal(failed.body.phase,'ended');assert.equal(failed.body.scoreEmail.status,'failed');
 options.emailFailure=false;
 const success=await h.request(null,{code},hostToken);assert.equal(success.body.scoreEmail.status,'sent');
 assert.equal(new Set(h.emails.map(email=>email.headers['Idempotency-Key'])).size,1);
 assert.deepEqual(h.emails[0].body,h.emails[h.emails.length-1].body);
});

test('Timed games send scores automatically after their final reveal',async()=>{
 const h=harness({env:{RESEND_API_KEY:'test-key',LIVE_SCORE_EMAIL_FROM:'scores@example.com'}});
 const {code,hostToken}=(await h.create({seconds:5,sendScoresToTeacher:true,teacherEmail:'teacher@example.com'})).body;
 const student=(await h.join(code)).body.studentToken;
 await h.request('start',{code,version:0},hostToken);
 for(let i=0;i<5;i++){h.advance(5000);await h.request(null,{code},student);h.advance(2000);await h.request(null,{code},student);}
 assert.equal(h.emails.length,1);assert(h.emails[0].body.text.includes('Questions scored: 5'));
});


test('Replay retains every student and code, resets scores, rejects stale answers, and supports repeated rounds',async()=>{
 for(const database of [false,true]){
  const h=harness({database}),created=await h.create(),{code,hostToken}=created.body;
  const students=await Promise.all(['AB','CD'].map(name=>h.join(code,name)));
  let version=0;
  for(let round=0;round<3;round++){
   let view=(await h.request(null,{code},students[0].body.studentToken)).body;
   assert.equal(view.phase,'lobby');assert.equal(view.round,round);assert.equal(view.playerCount,2);
   assert.equal(view.me.score,0);assert.equal(view.me.choice,null);assert.equal(view.lastReveal,undefined);
   assert.equal(view.settings,undefined);
   assert.equal((await h.request('start',{code,version},hostToken)).code,200);version++;
   view=(await h.request(null,{code},students[0].body.studentToken)).body;
   const choice=view.question.options.indexOf(h.cards.find(card=>card.term===view.question.term).english);
   if(round)assert.equal((await h.request('answer',{code,index:0,round:round-1,choice},students[0].body.studentToken)).code,409);
   assert.equal((await h.request('answer',{code,index:0,round,choice},students[0].body.studentToken)).code,200);
   await h.request('reveal',{code,version},hostToken);version++;
   view=(await h.request(null,{code},students[0].body.studentToken)).body;
   assert.equal(view.me.score,100);assert.equal(view.answeredCount,1);
   await h.request('end',{code,version},hostToken);version++;
   const results=await Promise.all([h.request('restart',{code,version},hostToken),h.request('restart',{code,version},hostToken)]);
   assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);version++;
  }
 }
});

test('Teacher can configure replay timing, question count and excluded wordlists without losing the lobby',async()=>{
 const h=harness({database:true});
 const second='vocabulary-cards/sixth/second--'+Buffer.from('Second list').toString('base64url')+'.html';
 const term='חדש בלבד',definition='second list only';
 const extra={term,english:definition,alternativeAnswers:{english:{term,definition,answers:['a','b','c','d']}}};
 h.storage.set(second,{body:'<script id="peninaCardData" type="application/json">'+JSON.stringify([extra])+'</script>'});
 const created=await h.create({pathnames:[h.setPath,second]}),{code,hostToken}=created.body;
 const student=(await h.join(code)).body.studentToken;
 await h.request('end',{code,version:0},hostToken);
 assert.equal((await h.request('restart',{code,version:1},student)).code,403);
 await h.request('restart',{code,version:1},hostToken);
 let view=(await h.request(null,{code},hostToken)).body;
 assert.deepEqual(view.settings.wordlists.map(s=>s.title),['Class vocabulary','Second list']);
 assert(!JSON.stringify(view.settings).includes('correct'));assert(!JSON.stringify(view.settings).includes('horse'));
 for(const invalid of [{count:1},{seconds:6},{revealSeconds:1},{pathnames:[]},{pathnames:[second,second]},{pathnames:['vocabulary-cards/other/a.html']}]){
  assert.equal((await h.request('configure',{code,version:2,...invalid},hostToken)).code,400);
 }
 assert.equal((await h.request('configure',{code,version:2,count:10,seconds:7,revealSeconds:10,pathnames:[h.setPath]},student)).code,403);
 assert.equal((await h.request('configure',{code,version:2,count:10,seconds:7,revealSeconds:10,pathnames:[h.setPath]},hostToken)).code,200);
 view=(await h.request(null,{code},hostToken)).body;
 assert.equal(view.total,10);assert.equal(view.seconds,7);assert.equal(view.revealSeconds,10);assert.equal(view.playerCount,1);
 assert.deepEqual(view.settings.pathnames,[h.setPath]);
 await h.request('start',{code,version:3},hostToken);
 for(let index=0;index<10;index++){
  view=(await h.request(null,{code},student)).body;
  assert.equal(view.phase,'question');assert.notEqual(view.question.term,term);
  h.advance(7000);view=(await h.request(null,{code},student)).body;
  assert.equal(view.phase,'reveal');assert.equal(view.deadline-view.serverNow,10000);
  h.advance(9999);assert.equal((await h.request(null,{code},student)).body.phase,'reveal');
  h.advance(1);await h.request(null,{code},student);
 }
 view=(await h.request(null,{code},hostToken)).body;
 assert.equal(view.phase,'ended');
 await h.request('restart',{code,version:view.version,pathnames:[second],count:20},hostToken);
 view=(await h.request(null,{code},hostToken)).body;
 assert.equal(view.total,1);assert.deepEqual(view.settings.pathnames,[second]);
 await h.request('start',{code,version:view.version},hostToken);
 assert.equal((await h.request(null,{code},student)).body.question.term,term);
 assert.equal((await h.request('configure',{code,version:view.version+1},hostToken)).code,409);
});

test('Each replay sends its own final report with fresh scores and a distinct idempotency key',async()=>{
 const h=harness({env:{RESEND_API_KEY:'test',LIVE_SCORE_EMAIL_FROM:'scores@example.com'}});
 const created=await h.create({sendScoresToTeacher:true,teacherEmail:'teacher@example.com'}),{code,hostToken}=created.body;
 await h.join(code);
 await h.request('end',{code,version:0},hostToken);
 await h.request('restart',{code,version:1},hostToken);
 await h.request('end',{code,version:2},hostToken);
 await h.request(null,{code},hostToken);
 assert.equal(h.emails.length,2);
 assert.notEqual(h.emails[0].headers['Idempotency-Key'],h.emails[1].headers['Idempotency-Key']);
 assert(h.emails.every(email=>email.body.text.includes('AB: 0 points')));
});

test('New-round question zero receives feedback and bypasses any previous reveal delay',()=>{
 let now=1000;const drawn=[];
 const context={Date:{now:()=>now},revealSeen:new Set(),revealUntil:0,snapshot:null,clockOffset:0,draw:data=>{context.snapshot=data;drawn.push([data.phase,data.round]);},updateClock(){}};
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function present(data){'),client.indexOf(' function gameSettings(){')),context);
 context.present({phase:'reveal',round:0,index:0});
 context.present({phase:'lobby',round:1,index:-1});
 context.present({phase:'reveal',round:1,index:0});
 assert.deepEqual(drawn,[['reveal',0],['lobby',1],['reveal',1]]);
});
