const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/flash-cards/live/shofar.js'),'utf8');
async function setup({host=false,reduced=false,blocked=false,artFails=false,storage=new Map()}={}){
 const overlays=[],timers=new Map(),events={},oscillators=[],gains=[];let nextTimer=1,contexts=0;
 const element=()=>({children:[],style:{setProperty(){}},setAttribute(){},append(child){this.children.push(child);},remove(){this.removed=true;}});
 const param=()=>({values:[],setValueAtTime(value,at){this.values.push({value,at});},linearRampToValueAtTime(value,at){this.values.push({value,at});},exponentialRampToValueAtTime(value,at){this.values.push({value,at});}});
 class AudioContext{
  constructor(){contexts++;this.state='suspended';this.currentTime=10;this.sampleRate=44100;this.destination={};}
  resume(){if(blocked)return Promise.reject(Error('Playback blocked'));this.state='running';return Promise.resolve();}
  createBuffer(){return {};}
  createBufferSource(){return {connect(){},disconnect(){},start(){}};}
  createPeriodicWave(){return {};}
  createOscillator(){const oscillator={frequency:param(),setPeriodicWave(){},connect(){},disconnect(){},start(at){this.started=at;},stop(at){this.stopped=at??'now';}};oscillators.push(oscillator);return oscillator;}
  createGain(){const gain={gain:param(),connect(){},disconnect(){}};gains.push(gain);return gain;}
 }
 const context={URLSearchParams,location:{search:host?'?host=1&code=123456':'?code=123456'},Image:class{decode(){return artFails?Promise.reject(Error('Unavailable')):Promise.resolve();}},window:{AudioContext,matchMedia:()=>({matches:reduced}),addEventListener:(name,fn)=>events[name]=fn},document:{hidden:false,createElement:element,body:{append:el=>overlays.push(el)},addEventListener:(name,fn)=>events[name]=fn},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);await Promise.resolve();
 return {context,api:context.window.PeninaShofar,overlays,timers,events,oscillators,gains,storage,get contexts(){return contexts;}};
}
const winner=(overrides={})=>({phase:'reveal',round:1,index:2,question:{correct:1},me:{choice:1,bonuses:{first:25}},...overrides});

test('Only the server-confirmed first correct student gets two Leviim and flowing notes, once per question',async()=>{
 const h=await setup();
 for(const data of [winner({phase:'question'}),winner({me:{choice:1,bonuses:{first:0}}}),winner({me:{choice:0,bonuses:{first:25}}})])h.api.update(data);
 assert.equal(h.overlays.length,0);
 h.api.update(winner());h.api.update(winner());
 assert.equal(h.overlays.length,1);assert.equal(h.overlays[0].children.length,2);
 assert.match(h.overlays[0].children[0].className,/levi-left/);assert.match(h.overlays[0].children[1].className,/levi-right/);
 for(const side of h.overlays[0].children)assert.equal(side.children[1].children.length,6);
 assert.equal(h.oscillators.length,0,'no sound without an ordinary user gesture');
 [...h.timers.values()][0]();assert.equal(h.overlays[0].removed,true);
 h.api.update(winner());assert.equal(h.overlays.length,1);
 h.api.update(winner({round:2}));assert.equal(h.overlays.length,2);
 const reload=await setup({storage:h.storage});reload.api.update(winner());assert.equal(reload.overlays.length,0,'refresh must not replay an old award');
 const host=await setup({host:true});assert.equal(host.api,undefined);assert.equal(host.contexts,0);
});

test('Normal touch unlocks three soft horn blasts; changing questions cancels scheduled audio immediately',async()=>{
 const h=await setup();h.events.touchend({type:'touchend'});h.api.update(winner());
 assert.equal(h.contexts,1);assert.equal(h.oscillators.length,6,'three blasts with two soft voices');
 const starts=[...new Set(h.oscillators.map(voice=>voice.started))];assert.equal(starts.length,3);
 assert(Math.abs(starts[1]-starts[0]-.46)<.001);
 assert(h.gains.every(gain=>Math.max(...gain.gain.values.map(p=>p.value))<=.025));
 assert(h.oscillators.every(voice=>voice.stopped-voice.started<.38));
 h.api.update(winner({phase:'question',index:3}));
 assert.equal(h.overlays[0].removed,true);assert(h.oscillators.every(voice=>voice.stopped==='now'));assert.equal(h.timers.size,0);
});

test('Pause, hidden tabs, page exit, reduced motion and unavailable media do not hold up the game',async()=>{
 for(const event of ['visibilitychange','pagehide']){
  const h=await setup();h.events.pointerup({type:'pointerup'});h.api.update(winner());h.context.document.hidden=true;h.events[event]();assert.equal(h.overlays[0].removed,true);assert.equal(h.timers.size,0);
 }
 const paused=await setup();paused.api.update(winner());paused.api.update(winner({paused:true}));assert.equal(paused.overlays[0].removed,true);
 const hidden=await setup();hidden.context.document.hidden=true;hidden.api.update(winner());hidden.context.document.hidden=false;hidden.api.update(winner());assert.equal(hidden.overlays.length,0,'no delayed replay on foregrounding');
 const reduced=await setup({reduced:true});reduced.api.update(winner());assert.match(reduced.overlays[0].className,/reduced-motion/);
 const blocked=await setup({blocked:true});blocked.events.pointerup({type:'pointerup'});await Promise.resolve();assert.doesNotThrow(()=>blocked.api.update(winner()));assert.equal(blocked.oscillators.length,0);
 const missing=await setup({artFails:true});await Promise.resolve();assert.doesNotThrow(()=>missing.api.update(winner()));assert.equal(missing.overlays.length,0);
});
