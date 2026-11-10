const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
function setup(respond,time){
 let renders=0,markup='';const count={textContent:''},clock={textContent:''},requests=[],listeners={},error={};
 const stage={set innerHTML(value){markup=value;renders++;},get innerHTML(){return markup;},querySelector:selector=>selector==='[data-answered-count]'?count:selector==='[data-clock]'&&markup.includes('data-clock')?clock:null,querySelectorAll:()=>[],addEventListener:(event,handler)=>listeners[event]=handler};
 const ctx={Date:time?class extends Date{static now(){return time.now;}}:Date,URLSearchParams,location:{search:'?code=123456'},document:{createElement:()=>({}),head:{append(){}},getElementById:id=>id==='stage'?stage:id==='error'?error:{},addEventListener(){},hidden:true},window:{matchMedia:()=>({matches:true}),addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},AbortController,fetch:async(url,options)=>{const body=options.body?JSON.parse(options.body):{action:null};requests.push(body);return respond?respond(body):reply(body.action==='answer'?{saved:true,round:body.round,index:body.index,choice:body.choice}:question());}};
 vm.runInNewContext(source.slice(0,source.indexOf(" auth=stored(storageKey())"))+" globalThis.client={present,act,poll,syncClock,updateClock,connect:()=>{auth='test-student';document.hidden=false;},getSnapshot:()=>snapshot};})();",ctx);
 return {client:ctx.client,count,clock,requests,listeners,error,get renders(){return renders;},get markup(){return markup;}};
}
const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function assertSelection(h,choice,confirmed=true){
 assert.match(h.markup,new RegExp('class="answer selected" data-choice="'+choice+'" disabled aria-pressed="true"'));
 assert.doesNotMatch(h.markup,/role="status"/,'selection uses only the highlight, without a status message');
 assert.equal(h.client.getSnapshot().me.choice,confirmed?choice:null);
}
const question=()=>({phase:'question',round:1,index:1,version:2,serverNow:Date.now(),className:'Demo',playerCount:20,answeredCount:0,total:5,paused:false,deadline:null,question:{term:'בית',options:['House','Water','Book','Light']},me:{name:'AB',avatar:1,score:0,choice:null},lastReveal:{phase:'reveal',round:1,index:0,version:1,serverNow:Date.now()}});
test('routine polls and classmate answers preserve student answer buttons and refresh submission version',async()=>{
 const h=setup(),data=question();h.client.present(data);const initial=h.renders;
 h.client.present({...data,serverNow:data.serverNow+1000,version:3,answeredCount:7,lastReveal:{...data.lastReveal,serverNow:data.serverNow+1000}});
 assert.equal(h.renders,initial,'no DOM replacement during a tap');assert.equal(h.count.textContent,7);
 await h.client.act('answer',{choice:2});assert.equal(h.requests[0].version,3);assert.equal(h.requests[0].choice,2);
});
test('pause, answer acknowledgement, and new questions still update controls',()=>{
 const h=setup(),data=question();h.client.present(data);
 const initial=h.renders;h.client.present({...data,paused:true});assert.equal(h.renders,initial+1);assert.match(h.markup,/data-choice="0" disabled/);
 h.client.present({...data,me:{...data.me,choice:1}});assertSelection(h,1);
 h.client.present({...data,index:2,question:{...data.question,term:'ספר'}});assert.match(h.markup,/ספר/);assert.match(h.markup,/data-choice="0"  aria-pressed="false"/);
});
test('rapid repeated taps submit only once while a request is pending',async()=>{
 const h=setup();h.client.present(question());
 const button={disabled:false,dataset:{choice:'1'},hasAttribute:()=>false};
 await Promise.all([h.listeners.click({target:{closest:()=>button}}),h.listeners.click({target:{closest:()=>button}})]);
 assert.equal(h.requests.length,1);
});

test('touch answer survives a pause redraw and submits once even after completion',async()=>{
 const h=setup(),data=question();h.client.present(data);
 const button={disabled:false,dataset:{choice:'2'},hasAttribute:()=>false};
 let prevented=false;
 h.listeners.pointerdown({pointerType:'touch',isPrimary:true,button:0,target:{closest:()=>button},preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.equal(h.requests.length,1,'submit before a click can be lost');
 assert.deepEqual(h.requests[0],{action:'answer',code:'123456',version:2,index:1,round:1,choice:2});
 const beforePause=h.renders;
 h.client.present({...data,version:3,paused:true});
 assert.equal(h.renders,beforePause+1);
 assert.match(h.markup,/data-choice="0" disabled/);
 // Let the request finish so busy cannot hide duplicate-click bugs.
 await new Promise(resolve=>setImmediate(resolve));
 await h.listeners.click({pointerType:'touch',target:{closest:()=>button}});
 await h.listeners.click({target:{closest:()=>button}});
 assert.equal(h.requests.length,1,'late compatibility clicks must not resubmit');
});

test('a slow save immediately highlights the choice without a submission status message',async()=>{
 const saving=deferred(),h=setup(()=>saving.promise);h.client.present(question());
 const pending=h.client.act('answer',{choice:2});
 assertSelection(h,2,false);
 assert.equal(h.client.getSnapshot().me.choice,null,'selection alone is not a server acknowledgement');
 await h.client.act('answer',{choice:1});assert.equal(h.requests.length,1);
 saving.resolve(reply({saved:true,round:1,index:1,choice:2}));await pending;
 assertSelection(h,2);
});

test('save acknowledgement preserves the highlight before a slow refresh and through stale snapshots',async()=>{
 const refresh=deferred(),h=setup(body=>body.action?reply({saved:true,round:1,index:1,choice:1}):refresh.promise),data=question();
 h.client.present(data);h.client.connect();
 const pending=h.client.act('answer',{choice:1});await flush();
 assertSelection(h,1);
 refresh.resolve(reply(data));await pending;
 assertSelection(h,1);
 await h.client.act('answer',{choice:2});assert.equal(h.requests.filter(r=>r.action==='answer').length,1);
 h.client.present({...data,index:2,question:{...data.question,term:'ספר'}});
 assert.doesNotMatch(h.markup,/answer selected/);assert.match(h.markup,/data-choice="0"  aria-pressed="false"/);
});

test('an answer is confirmed even while an older poll is still in flight',async()=>{
 const oldPoll=deferred(),h=setup(body=>body.action?reply({saved:true,round:1,index:1,choice:0}):oldPoll.promise),data=question();
 h.client.present(data);h.client.connect();const polling=h.client.poll();
 await h.client.act('answer',{choice:0});
 assertSelection(h,0);
 oldPoll.resolve(reply(data));await polling;
 assertSelection(h,0);
});

test('background refreshes continue while an answer is saving',async()=>{
 const saving=deferred(),h=setup(body=>body.action?saving.promise:reply(question()));h.client.present(question());h.client.connect();
 const pending=h.client.act('answer',{choice:0});
 await h.client.poll();assert.equal(h.requests.length,2);assertSelection(h,0,false);
 saving.resolve(reply({saved:true,round:1,index:1,choice:0}));
 await pending;assertSelection(h,0);
});

test('failed saves restore the choices and show the error without claiming success',async()=>{
 const saving=deferred(),h=setup(()=>saving.promise);h.client.present(question());
 const pending=h.client.act('answer',{choice:3});saving.reject(new Error('Connection interrupted'));
 assert.equal(await pending,false);
 assert.doesNotMatch(h.markup,/answer selected/);
 assert.match(h.markup,/data-choice="0"  aria-pressed="false"/);assert.equal(h.error.textContent,'Connection interrupted');
});

test('duplicate acknowledgement shows the first stored answer, and a late reply cannot select a new question',async()=>{
 const h=setup(()=>reply({saved:true,round:1,index:1,choice:0}));h.client.present(question());
 await h.client.act('answer',{choice:2});assertSelection(h,0);assert.doesNotMatch(h.markup,/class="answer selected" data-choice="2"/);
 const saving=deferred(),late=setup(()=>saving.promise),data=question();late.client.present(data);
 const pending=late.client.act('answer',{choice:2});
 late.client.present({...data,round:2});saving.resolve(reply({saved:true,round:1,index:1,choice:2}));await pending;
 assert.doesNotMatch(late.markup,/answer selected/);
 assert.match(late.markup,/data-choice="0"  aria-pressed="false"/);
});

test('late and missed reveals never consume the next question countdown',()=>{
 for(const seconds of [5,7,10])for(const missReveal of [false,true]){
  const time={now:1000},h=setup(undefined,time),data={...question(),index:0,version:1,seconds,deadline:1000+seconds*1000,lastReveal:undefined};
  h.client.present(data);
  const reveal={...data,phase:'reveal',version:2,revealSeconds:5,deadline:data.deadline+5000,question:{...data.question,correct:0},me:{...data.me,choice:0},distribution:[1,0,0,0]};
  if(!missReveal){time.now=data.deadline+2000;h.client.present(reveal);assert.equal(h.client.getSnapshot().phase,'reveal');}
  time.now=reveal.deadline;
  h.client.present({...data,index:1,version:3,deadline:time.now+seconds*1000,lastReveal:reveal});
  assert.equal(h.client.getSnapshot().phase,'question');assert.equal(h.client.getSnapshot().index,1);
  assert.equal(h.clock.textContent,'Time left: '+seconds+'s');
 }
});

test('clock synchronization accounts for server work and network time and blocks expired answers',async()=>{
 const time={now:104000},h=setup(undefined,time);
 // Client sent at 100000; network took 2 seconds each way, server work took zero.
 h.client.syncClock({serverReceivedAt:102000,serverNow:102000},100000,104000);
 h.client.present({...question(),deadline:105000});assert.equal(h.clock.textContent,'Time left: 1s');
 time.now=105000;h.client.updateClock();assert.equal(h.clock.textContent,'Time left: 0s');
 await h.client.act('answer',{choice:0});assert.equal(h.requests.length,0);
 // A skewed server clock and three seconds of processing must not count as network lag.
 time.now=108000;h.client.syncClock({serverReceivedAt:208000,serverNow:211000},104000,108000);
 h.client.present({...question(),deadline:212000});assert.equal(h.clock.textContent,'Time left: 1s');
});

test('phase changes and the next answer proceed while the previous submission is pending',async()=>{
 const first=deferred(),second=deferred(),data=question();let current=data;
 const h=setup(body=>body.action==='answer'?(body.index===1?first.promise:second.promise):reply(current));
 h.client.present(data);h.client.connect();const oldAnswer=h.client.act('answer',{choice:0});
 current={...data,phase:'reveal',version:3,question:{...data.question,correct:0},distribution:[0,0,0,0]};
 await h.client.poll();assert.equal(h.client.getSnapshot().phase,'reveal');
 assert.doesNotMatch(h.markup,/No answer submitted|Correct! \+100/,'wait for authoritative scoring without claiming the pending answer was missed');
 current={...data,index:2,version:4};await h.client.poll();
 const nextAnswer=h.client.act('answer',{choice:1});assert.equal(h.requests.filter(r=>r.action==='answer').length,2);
 first.resolve(reply({saved:true,round:1,index:1,choice:0}));await oldAnswer;
 assert.equal(h.client.getSnapshot().index,2);assertSelection(h,1,false);
 second.resolve(reply({saved:true,round:1,index:2,choice:1}));await nextAnswer;assertSelection(h,1);
});

test('a late failure from a previous question cannot clear the new selection or show an obsolete error',async()=>{
 const first=deferred(),second=deferred(),data=question(),h=setup(body=>body.index===1?first.promise:second.promise);
 h.client.present(data);const oldAnswer=h.client.act('answer',{choice:0});
 h.client.present({...data,index:2,version:4});const nextAnswer=h.client.act('answer',{choice:1});
 first.reject(new Error('Old request timed out'));await oldAnswer;
 assertSelection(h,1,false);assert.equal(h.error.textContent,'');
 second.resolve(reply({saved:true,round:1,index:2,choice:1}));await nextAnswer;assertSelection(h,1);
});

test('a confirmed answer survives a lost submission response without an error',async()=>{
 const sending=deferred(),h=setup(()=>sending.promise),data=question();h.client.present(data);
 const pending=h.client.act('answer',{choice:0});h.client.present({...data,me:{...data.me,choice:0}});
 sending.reject(new Error('Response lost'));assert.equal(await pending,true);assertSelection(h,0);assert.equal(h.error.textContent,'');
});
