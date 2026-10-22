const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
function setup(){
 let renders=0,markup='';const count={textContent:''},requests=[],listeners={};
 const stage={set innerHTML(value){markup=value;renders++;},get innerHTML(){return markup;},querySelector:selector=>selector==='[data-answered-count]'?count:null,addEventListener:(event,handler)=>listeners[event]=handler};
 const ctx={URLSearchParams,location:{search:'?code=123456'},document:{getElementById:id=>id==='stage'?stage:{},addEventListener(){},hidden:true},window:{matchMedia:()=>({matches:true}),addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},AbortController,fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};}};
 vm.runInNewContext(source.slice(0,source.indexOf(" auth=stored(storageKey())"))+" globalThis.client={present,act,getSnapshot:()=>snapshot};})();",ctx);
 return {client:ctx.client,count,requests,listeners,get renders(){return renders;},get markup(){return markup;}};
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
 h.client.present({...data,me:{...data.me,choice:1}});assert.match(h.markup,/Answer B saved/);assert.match(h.markup,/aria-pressed="true"/);
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
