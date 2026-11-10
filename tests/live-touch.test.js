const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
function setup(respond){
 let renders=0,markup='';const count={textContent:''},requests=[],listeners={},error={};
 const stage={set innerHTML(value){markup=value;renders++;},get innerHTML(){return markup;},querySelector:selector=>selector==='[data-answered-count]'?count:null,addEventListener:(event,handler)=>listeners[event]=handler};
 const ctx={URLSearchParams,location:{search:'?code=123456'},document:{createElement:()=>({}),head:{append(){}},getElementById:id=>id==='stage'?stage:id==='error'?error:{},addEventListener(){},hidden:true},window:{matchMedia:()=>({matches:true}),addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},AbortController,fetch:async(url,options)=>{const body=options.body?JSON.parse(options.body):{action:null};requests.push(body);return respond?respond(body):reply(body.action==='answer'?{saved:true,round:body.round,index:body.index,choice:body.choice}:question());}};
 vm.runInNewContext(source.slice(0,source.indexOf(" auth=stored(storageKey())"))+" globalThis.client={present,act,poll,connect:()=>{auth='test-student';document.hidden=false;},getSnapshot:()=>snapshot};})();",ctx);
 return {client:ctx.client,count,requests,listeners,error,get renders(){return renders;},get markup(){return markup;}};
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

test('background refreshes wait while an answer is saving',async()=>{
 const saving=deferred(),h=setup(body=>body.action?saving.promise:reply(question()));h.client.present(question());h.client.connect();
 const pending=h.client.act('answer',{choice:0});
 await h.client.poll();assert.equal(h.requests.length,1);
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
