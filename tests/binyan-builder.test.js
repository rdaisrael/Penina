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
    },async()=>{});
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


test('Learn offers every binyan without learned marks; only supported forms are offered',()=>{
    assert.deepEqual(core.binyanim,['פעל','פיעל','הפעיל','התפעל','נפעל','פועל','הופעל']);
    for(const binyan of core.binyanim){
        for(const group of [`${binyan} שלם`,`${binyan} — כל הגזרות`]){
            const pair=`${group}|עבר`;
            assert.equal(core.validPair(pair),true,pair);
            const req=core.validateRequest({...input,pairs:[pair],vocabulary:{verbs:['כתב'],binyanim:[]}});
            core.validateResult(fixture(req),req);
            assert.deepEqual(req.pairs,[pair]);
            assert.throws(()=>core.validateRequest({...req,mode:'practice'}),/marked X/);
        }
    }
    for(const pair of ['פעל שלם|שם פעולה','פועל שלם|ציווי','הופעל — כל הגזרות|שם הפועל','לא קיים|עבר'])assert.equal(core.validPair(pair),false);
    const req=core.validateRequest({...input,vocabulary:{verbs:['אכל','שתה','הלך'],binyanim:['פעל שלם|עבר','פיעל שלם|עבר']}});
    assert.deepEqual(req.vocabulary.binyanim,['פעל שלם|עבר','פיעל שלם|עבר']);
});
test('Practice follows exact marked squares across binyanim, root types and tenses',()=>{
    const marks=['פעל שלם|עבר','פיעל ל-ה|הווה','הפעיל ע"ו|עתיד'];
    const request={...input,mode:'practice',vocabulary:{verbs:['כתב','נסה','קום'],binyanim:marks},pairs:marks};
    assert.deepEqual(core.validateRequest(request).pairs,marks);
    for(const pair of ['פעל שלם|הווה','פיעל ל-ה|עבר','פיעל שלם|הווה','הפעיל ע"ו|הווה','הפעיל — כל הגזרות|עתיד']){
        assert.throws(()=>core.validateRequest({...request,pairs:[pair]}),/marked X/,pair);
        assert.deepEqual(core.validateRequest({...request,mode:'learn',pairs:[pair]}).pairs,[pair]);
    }
});
test('specific root classes retain their filters while All root types permits irregular learning',()=>{
    for(const root of ['אכל','הלך','כתב'])assert.equal(core.eligibleRoot(root,'פעל שלם|הווה'),true);
    for(const root of ['שתה','בנה','קנה']){assert.equal(core.eligibleRoot(root,'פעל ל-ה|הווה'),true);assert.equal(core.eligibleRoot(root,'פעל שלם|הווה'),false);}
    for(const root of ['היה','חיה','נתן','ישב','קום'])assert.equal(core.eligibleRoot(root,'פעל שלם|עבר'),false);
    for(const root of ['היה','חיה','נתן','ישב','קום','טלפן'])assert.equal(core.eligibleRoot(root,'פעל — כל הגזרות|עבר'),true);
    for(const [root,pair] of [['קום','פעל ע"ו|הווה'],['נתן','פעל חפ"נ|עבר'],['ישב','פעל פ"י|עבר'],['נסה','פיעל ל-ה|עבר'],['נקה','פיעל ל-ה|עבר'],['ירד','הפעיל פ"י|עבר'],['קום','הפעיל ע"ו|עתיד'],['נגן','פיעל שלם|עבר']])assert.equal(core.eligibleRoot(root,pair),true,`${root}: ${pair}`);
    for(const pair of ['פעל ע"ו|עבר','פעל חפ"נ|עבר','פעל פ"י|עבר','פיעל ל-ה|עבר','הפעיל ע"ו|עבר'])assert.equal(core.eligibleRoot('כתב',pair),false,pair);
});
test('unsupported pairs give actionable errors',async()=>{
    await assert.rejects(generateWorksheet(input,async()=>JSON.stringify({unavailablePairs:input.pairs,lessons:[],questions:[]})),/another binyan or root type/);
    await assert.rejects(generateWorksheet({...input,vocabulary:{verbs:['שתה'],binyanim:[]}},()=>{throw new Error('must not call AI');}),/No suitable roots/);
});
test('generation teaches all seven binyanim without marks and always verifies them',async()=>{
    for(const binyan of core.binyanim){
        const pair=`${binyan} שלם|עבר`,request=core.validateRequest({...input,pairs:[pair],vocabulary:{verbs:['כתב'],binyanim:[]}});
        let verified=false;
        const output=await generateWorksheet(request,async prompt=>{
            assert.match(prompt,/All seven binyanim are supported/);
            assert.doesNotMatch(prompt,/Only Paal \/ Kal is supported|No other binyan is allowed/);
            assert.deepEqual(JSON.parse(prompt.match(/Eligible roots per pair: (.*)/)[1]),{[pair]:['כתב']});
            return JSON.stringify(fixture(request));
        },async result=>{verified=true;assert.equal(result.lessons[0].pair,pair);});
        assert.equal(verified,true);assert.equal(output.questions.length,6);
    }
});
test('generation always invokes verification and propagates failures',async()=>{
    let called=false;
    await assert.rejects(generateWorksheet(input,async()=>JSON.stringify(fixture(core.validateRequest(input))),async()=>{called=true;throw new Error('unverified');}),/unverified/);
    assert.equal(called,true);
});

test('regular infinitives use a conservative tense-specific list',()=>{
    const pair='פעל שלם|שם הפועל';
    for(const root of ['כתב','כָּתַב','שמר','למד','קפץ','בדק'])assert.equal(core.eligibleRoot(root,pair),true,root);
    for(const root of ['הלך','אכל','הרס','הפך','שמע','פתח','לקח','שכב','רכב','קום','שוב','בנה','שתה','ישב','נתן','xyz','אבג'])assert.equal(core.eligibleRoot(root,pair),false,root);
    assert.equal(core.eligibleRoot('הלך','פעל שלם|עבר'),true);
    assert.equal(core.eligibleRoot('שמע','פעל שלם|הווה'),true);
    assert.equal(core.eligibleRoot('בנה','פעל ל-ה|שם הפועל'),true);
});
function infinitiveFixture(mode='learn') {
    const pair='פעל שלם|שם הפועל';
    const req=core.validateRequest({...input,mode,pairs:[pair],vocabulary:{verbs:['כתב','הלך','שמע'],binyanim:[pair]}});
    const result=fixture(req);
    result.lessons.forEach(l=>l.forms.forEach(f=>f.answer='לִכְתּוֹב'));
    result.questions.forEach(q=>q.answer='לִכְתּוֹב');
    return {req,result};
}
test('both model and practice reject irregular roots and nonstandard infinitive answers',()=>{
    const {req,result}=infinitiveFixture();
    core.validateResult(result,req);
    for(const mutate of [r=>r.lessons[0].root='הלך',r=>r.questions[0].root='שמע',r=>r.lessons[0].forms[0].answer='לִכְתַּב',r=>r.questions[0].answer='לִכְתַּב']) {
        const bad=structuredClone(result);mutate(bad);
        assert.throws(()=>core.validateResult(bad,req),/checks/);
    }
    const decomposed=structuredClone(result);
    decomposed.questions[0].answer=decomposed.questions[0].answer.normalize('NFD');
    core.validateResult(decomposed,req);
});
test('infinitive generation filters roots, allows repetition, and still verifies forms',async()=>{
    for(const mode of ['learn','practice']) {
        const {req,result}=infinitiveFixture(mode);let verified=false;
        const output=await generateWorksheet(req,async prompt=>{
            const eligible=JSON.parse(prompt.match(/Eligible roots per pair: (.*)/)[1]);
            assert.deepEqual(eligible,{'פעל שלם|שם הפועל':['כתב']});
            assert.match(prompt,/לִכְתּוֹב/);assert.match(prompt,/reuse them/);
            return JSON.stringify(result);
        },async()=>{verified=true;});
        assert.equal(verified,true);assert.equal(output.questions.length,6);
        assert.ok(output.questions.every(q=>q.root==='כתב'));
    }
});
test('no standard infinitive roots fails before contacting generation or verification',async()=>{
    const {req}=infinitiveFixture();req.vocabulary.verbs=['הלך','שמע','בנה'];
    await assert.rejects(generateWorksheet(req,()=>assert.fail('generation called'),()=>assert.fail('verification called')),/No vetted standard Kal infinitive roots/);
});
