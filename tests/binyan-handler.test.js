const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const {verifyWorksheet,parseRows}=require('../lib/binyan-dicta');
const {items,payload}=require('./fixtures/binyan-dicta-paal.json');

const input={mode:'practice',pairs:['פעל שלם|עבר'],count:6,vocabulary:{verbs:['כתב'],binyanim:['פעל שלם|עבר']}};
const candidate={lessons:[],questions:core.plan(core.validateRequest(input)).map(q=>({
    ...q,root:'כתב',meaning:'write',answer:items.find(item=>item.root==='כתב'&&item.pair===q.pair&&item.person===q.person).answer
}))};
function handler(generate,verify){
    const messages=[],context={module:{exports:{}},console:{error:(...args)=>messages.push(args)},require(name){
        if(name==='./openai-text')return {generateOpenAIText:generate};
        if(name==='./binyan-worksheet')return {generateWorksheet:(input,generate)=>generateWorksheet(input,generate,verify)};
        if(name==='../PeninaPlus-Binyan-Builder/core')return core;
        throw new Error(`Unexpected dependency ${name}`);
    }};
    vm.runInNewContext(fs.readFileSync(require.resolve('../lib/binyan-handler'),'utf8'),context);
    return {run:context.module.exports,messages};
}
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('rejected morphology remains a specific JSON application error, with a private server diagnostic',async()=>{
    const bad={...payload,BGU:payload.BGU.replaceAll('כָּתַבְתִּי','כִּתַּבְתִּי')};
    const {run,messages}=handler(async()=>JSON.stringify(candidate),(result,request)=>verifyWorksheet(result,request,async()=>bad));
    const res=response();await run({method:'POST',body:input},res);
    assert.equal(res.code,422);
    assert.match(res.body.error,/Could not verify/);
    assert.equal(res.body.questions,undefined);
    assert.equal(messages[0][1].stage,'dicta');
    assert.equal(messages[0][1].code,'DICTA_FORM_MISMATCH');
    assert.doesNotMatch(JSON.stringify(messages),/כתב|כִּתַּבְתִּי|write/);
});
test('missing Dicta analysis and generation outages have separate diagnostic stages',async()=>{
    for(const [generate,verify,stage,code,message] of [
        [async()=>JSON.stringify(candidate),async()=>parseRows({data:[]}), 'dicta','DICTA_ANALYSIS_MISSING',/grammatical analysis/],
        [async()=>{throw new Error('Provider unavailable');},()=>assert.fail('must not verify'),'generation','WORKSHEET_FAILED',/Provider unavailable/]
    ]){
        const {run,messages}=handler(generate,verify),res=response();await run({method:'POST',body:input},res);
        assert.equal(res.code,503);assert.match(res.body.error,message);
        assert.equal(messages[0][1].stage,stage);assert.equal(messages[0][1].code,code);
    }
});
test('successful worksheet and invalid request handling remain unchanged',async()=>{
    const {run,messages}=handler(async()=>JSON.stringify(candidate),async()=>{});
    const res=response();await run({method:'POST',body:input},res);
    assert.equal(res.code,200);assert.equal(res.body.questions.length,6);assert.equal(messages.length,0);
    await run({method:'POST',body:{...input,pairs:['פיעל שלם|הווה']}},res);
    assert.equal(res.code,400);assert.match(res.body.error,/marked X/);assert.equal(messages.length,0);
});
