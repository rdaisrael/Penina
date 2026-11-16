const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../PeninaPlus-Binyan-Builder/core');
const vocabulary=require('../PeninaPlus-Binyan-Builder/vocabulary');
const source=fs.readFileSync(require.resolve('../PeninaPlus-Binyan-Builder/app'),'utf8');
const handler=source.slice(source.indexOf("    $('generate').addEventListener"),source.indexOf("    $('show-key').addEventListener"));
const input=core.validateRequest({mode:'practice',pairs:['פיעל שלם|הווה'],count:24,exercises:['conjugate'],vocabulary:{verbs:['למד'],binyanim:['פיעל שלם|הווה']}});
const forms=['מְלַמֵּד','מְלַמֶּדֶת','מְלַמְּדִים','מְלַמְּדוֹת'];
const candidate={lessons:[],questions:core.plan(input).map(q=>({...q,root:'למד',meaning:'teach',answer:forms[core.persons(q.pair).indexOf(q.person)]}))};
function harness(){
    const elements={},timers=new Map(),requests=[],renders=[];let clock=0,nextTimer=0;
    const $=id=>elements[id]||=( {value:'test',addEventListener:(name,callback)=>elements[id][name]=callback} );
    const context={$,core,AbortController,request:()=>input,updateButton:()=>{},status:(id,message)=>$(id).textContent=message,
        renderWorksheet:(result,title)=>renders.push({result,title}),serviceError:()=> 'Request failed',
        window:{innerWidth:1200,BinyanVocabulary:vocabulary},document:{fonts:{ready:Promise.resolve()}},
        setTimeout:(callback,delay)=>{timers.set(++nextTimer,{callback,at:clock+delay});return nextTimer;},clearTimeout:id=>timers.delete(id),
        fetch:async(url,options)=>new Promise((resolve,reject)=>{
            options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})));
            requests.push({options,finish:()=>resolve({ok:true,json:async()=>candidate})});
        })};
    vm.runInNewContext('let generationVersion=0,controller=null,busy=false,result=null,worksheetTitle="";\n'+handler,context);
    return {click:()=>$('generate').click(),requests,renders,elements,timers,advance(ms){clock+=ms;for(const [id,timer] of timers)if(timer.at<=clock){timers.delete(id);timer.callback();}}};
}
test('the browser accepts a fully checked 24-question response after the old 110-second client cutoff',async()=>{
    const h=harness(),pending=h.click();
    h.advance(130000);assert.equal(h.requests[0].options.signal.aborted,false);
    h.requests[0].finish();await pending;
    assert.equal(h.renders.length,1);assert.equal(h.renders[0].result.questions.length,24);
    assert.match(h.elements['generation-status'].textContent,/Worksheet ready/);assert.equal(h.timers.size,0);
});
test('the browser still aborts stalled work and preserves the preceding worksheet',async()=>{
    const h=harness();let pending=h.click();h.requests[0].finish();await pending;
    pending=h.click();h.advance(285000);await pending;
    assert.equal(h.requests[1].options.signal.aborted,true);assert.equal(h.renders.length,1);
    assert.match(h.elements['generation-status'].textContent,/took too long/);
    assert.doesNotMatch(h.elements['generation-status'].textContent,/fewer questions/);
    assert.equal(h.timers.size,0);
});
