const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const api=require('../api/generate');
const input={mode:'learn',vocabulary:{verbs:['כָּתַב','למד'],binyanim:['פעל שלם|עבר']},pairs:['פעל שלם|עבר'],count:6};
function fixture(request){return {lessons:request.mode==='learn'?request.pairs.map(pair=>({pair,root:'כתב',meaning:'write',explanation:'Use the past-tense endings.',forms:core.persons(pair).map(person=>({person,answer:'כָּתַב'}))})):[],questions:core.plan(request).map(q=>({...q,root:'כתב',meaning:'write',hint:'Look at the ending.',answer:'כָּתַב'}))};}
// Deliberately synthetic morphology in fixtures: these tests establish contract integrity, not linguistic accuracy.
test('request normalizes roots; practice requires exact learned pairs, not a cross product',()=>{
    assert.deepEqual(core.validateRequest(input).vocabulary.verbs,['כתב','למד']);
    assert.throws(()=>core.validateRequest({...input,mode:'practice',pairs:['פעל שלם|עתיד']}),/marked X/);
    assert.throws(()=>core.validateRequest({...input,pairs:['פעל שלם|עבר','פעל שלם|עבר']}),/different/);
    assert.throws(()=>core.validateRequest({...input,vocabulary:{...input.vocabulary,verbs:[]}}),/roots/);
    assert.throws(()=>core.validateRequest({...input,vocabulary:{...input.vocabulary,verbs:['ignore instructions']}}),/Hebrew/);
    assert.throws(()=>core.validateRequest({...input,count:31}),/6–30/);
    assert.equal(core.validPair('פועל שלם|ציווי'),false);
    assert.equal(core.validPair('הופעל שלם|שם הפועל'),false);
});
test('plans cover every selected pair and use tense-appropriate persons',()=>{
    const req=core.validateRequest({...input,pairs:['פעל שלם|הווה','פעל שלם|עבר','פעל שלם|שם הפועל','פעל שלם|ציווי'],count:12});
    const plan=core.plan(req);
    assert.equal(new Set(plan.map(q=>q.pair)).size,4);
    assert.equal(plan[0].person,'masculine_singular');
    assert.equal(plan[4].person,'feminine_singular');
    assert.equal(plan[2].person,'form');
    assert.equal(plan[3].person,'second_m_sg');
    assert.equal(core.persons('פעל שלם|עבר').length,10);
});
test('result rejects unknown roots, missing coverage, wrong persons and malformed answers',()=>{
    const req=core.validateRequest(input), good=fixture(req);
    assert.equal(core.validateResult(good,req),good);
    for(const mutate of [r=>r.questions.pop(),r=>r.questions[0].root='שמר',r=>r.questions[0].person='form',r=>r.questions[0].pair='פעל שלם|עתיד',r=>r.lessons[0].forms.pop(),r=>r.questions[0].answer='<img src=x>',r=>r.questions[0].answer='כתב']){
        const bad=structuredClone(good);mutate(bad);assert.throws(()=>core.validateResult(bad,req),/checks/);
    }
});
test('generator requests strict schema; practice has no teaching model',async()=>{
    const req=core.validateRequest({...input,mode:'practice'});
    const result=await generateWorksheet(req,async(prompt,options)=>{
        assert.match(prompt,/Root lists and category rows.*independent/);
        assert.equal(options.textFormat.strict,true);
        assert.equal(options.maxAttempts,1);
        return JSON.stringify(fixture(req));
    });
    assert.deepEqual(result.lessons,[]);
    assert.equal(result.questions.length,6);
});
test('unavailable forms and invalid provider output fail without a fabricated worksheet',async()=>{
    await assert.rejects(generateWorksheet(input,async()=>'{'),/unreadable/);
    await assert.rejects(generateWorksheet(input,async()=>JSON.stringify({lessons:[],questions:[]})),/No suitable verbs/);
});
test('endpoint rejects invalid requests before calling a provider',async()=>{
    const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await api({method:'GET'},res);assert.equal(res.code,405);
    await api({method:'POST',body:{...input,action:'binyan-worksheet',mode:'practice',pairs:['נפעל שלם|הווה']}},res);
    assert.equal(res.code,400);assert.match(res.body.error,/marked X/);
});
