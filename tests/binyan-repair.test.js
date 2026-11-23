const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const {verifyWorksheet,parseRows}=require('../lib/binyan-dicta');
const {planRepair,mergeRepair}=require('../lib/binyan-repair');
const recorded=require('./fixtures/binyan-dicta-repair.json');
const recordedPaal=require('./fixtures/binyan-dicta-paal.json');
const pair='פיעל שלם|הווה',persons=core.persons(pair);
const pronouns=['הוּא','הִיא','הֵם','הֵן'];
// לבש is excluded before morphology verification. Use recorded Paal אכל forms
// as wrong-binyan candidates for the dictionary-backed Piel verb איכל instead.
const candidates=[
    ...recordedPaal.items.filter(item=>item.root==='אכל'&&item.pair==='פעל שלם|הווה'),
    ...recorded.items.filter(item=>item.root==='למד')
].map(item=>({...item,pair,pronoun:pronouns[persons.indexOf(item.person)]}));
const form=(root,person)=>candidates.find(item=>item.root===root&&item.person===person).answer;
const request=core.validateRequest({mode:'learn',pairs:[pair],count:12,exercises:['choice','conjugate','sentence'],footnotes:'page',
    // The correction must not reintroduce the excluded לבש from the workbook.
    vocabulary:{verbs:['לבש','אכל','למד'],binyanim:[],adverbs:['כאן']}});
function question(q,root){
    const subject=pronouns[persons.indexOf(q.person)];
    return {...q,root,meaning:root==='למד'?'teach':'eat',answer:form(root,q.person),
        alternative:q.exercise==='choice'?form(root,core.alternativeTarget(q).person):'',
        sentence:q.exercise==='sentence'?`${subject} ___ כָּאן.`:'',
        words:q.exercise==='sentence'?[
            {word:subject,mastered:true,translation:'subject',match:'__pronoun__',form:'',prefix:'',isName:false},
            {word:'כָּאן',mastered:true,translation:'here',match:'כאן',form:'',prefix:'',isName:false}
        ]:[],phrases:[]};
}
function worksheet(root='למד'){
    return {unavailablePairs:[],lessons:[{pair,root,meaning:root==='למד'?'teach':'eat',explanation:'Present-tense model.',
        forms:persons.map(person=>({person,answer:form(root,person)}))}],questions:core.plan(request).map(q=>question(q,root))};
}
// Reassemble the recorded Dicta analyses in the order submitted by the real
// verifier; no mock morphology labels are substituted for the provider's rows.
function recordedAnalysis(text){
    const rows=[...parseRows(recordedPaal.payload),...parseRows(recorded.payload)],keys=Object.keys(rows[0]),output=[];
    for(const line of text.split('\n')){
        const item=candidates.find(item=>line===`${item.pronoun} ${item.answer}.`);
        assert.ok(item,`Unexpected analysis text: ${line}`);
        const index=rows.findIndex(row=>row.POS==='VERB'&&row.menukad===item.answer);
        assert.notEqual(index,-1,`Unexpected analysis text: ${line}`);
        output.push(...rows.slice(index-1,index+2));
    }
    return {BGU:[keys.join('\t'),...output.map(row=>keys.map(key=>row[key]).join('\t'))].join('\n')};
}
const verify=(result,input,unused,options)=>verifyWorksheet(result,input,async text=>recordedAnalysis(text),options);
function mixedCandidate(){
    const bad=worksheet(),wrong=worksheet('אכל');
    bad.lessons=wrong.lessons;
    for(const index of [0,8])bad.questions[index]=wrong.questions[index];
    return bad;
}
const replacement=()=>({unavailablePairs:[],lessons:worksheet().lessons,questions:[worksheet().questions[0],worksheet().questions[8]]});

test('one correction replaces rejected models and exercises, preserves passing questions, and verifies everything again',async()=>{
    const bad=mixedCandidate();let calls=0,checks=0;
    const result=await generateWorksheet(request,async(prompt,options)=>{
        assert.equal(options.maxAttempts,1);
        if(++calls===1)return JSON.stringify(bad);
        assert.match(prompt,/CORRECTION PASS/);
        const targets=JSON.parse(prompt.match(/Repair targets: (.*)$/)[1]);
        assert.deepEqual(targets.questions.map(q=>q.number),[1,9]);
        assert.equal(targets.lessons[0].root,'אכל');
        assert.deepEqual(JSON.parse(prompt.match(/Replacement roots per pair: (.*)/)[1]),{[pair]:['למד']});
        assert.deepEqual(JSON.parse(prompt.match(/Preferred verified roots per pair: (.*)/)[1]),{[pair]:['למד']});
        return JSON.stringify(replacement());
    },async(...args)=>{checks++;return verify(...args);});
    assert.equal(calls,2);assert.equal(checks,1,'dictionary mismatch is repaired before calling Dicta');
    assert.equal(result.lessons[0].root,'למד');assert.equal(result.questions.length,12);
    assert.equal(result.questions[0].meaning,'teach');assert.equal(result.questions[8].meaning,'teach');
    assert.equal(result.questions[8].sentenceWords.length,2,'sentence vocabulary is checked after replacement');
    assert.deepEqual(result.questions[1],{...bad.questions[1],sentenceWords:[],notes:[]});
    await verify(result,request);
});
test('Dicta reports every rejected form together, including choice distractors',async()=>{
    await assert.rejects(verify(mixedCandidate(),request),error=>{
        assert.equal(error.code,'DICTA_FORM_MISMATCH');
        assert.equal(error.rejectedForms.length,4,'repeated model/question forms are deduplicated');
        assert.deepEqual(new Set(error.rejectedForms.map(item=>item.person)),new Set(persons));return true;
    });
});
test('a wrong choice distractor causes its question to be repaired',async()=>{
    const candidate=worksheet();
    candidate.questions[0].alternative=form('אכל','masculine_plural');
    let calls=0;
    const result=await generateWorksheet(request,async prompt=>{
        if(++calls===1)return JSON.stringify(candidate);
        const targets=JSON.parse(prompt.match(/Repair targets: (.*)$/)[1]);
        assert.equal(targets.lessons.length,1,'the shared root is replaced consistently in its model');
        assert.equal(targets.questions.length,12);
        // The alternative is wrong for root למד. The other uploaded root is
        // eligible, but its correctly pointed Piel paradigm is not in this
        // fixture; report unavailable instead of fabricating a valid analysis.
        return JSON.stringify({unavailablePairs:[pair],lessons:[],questions:[]});
    },verify).catch(error=>error);
    assert.equal(calls,2);assert.match(result.message,/replacement forms/);
});
test('corrections cannot add questions, change target pairs, or reuse an excluded root',()=>{
    const bad=mixedCandidate(),plan=planRepair(bad,{[pair]:['אכל','למד']},candidates.slice(0,4));
    for(const mutate of [
        patch=>patch.questions.push(worksheet().questions[1]),
        patch=>patch.questions[0].number=2,
        patch=>patch.questions[0].pair='פעל שלם|הווה',
        patch=>patch.questions[0].root='אכל',
        patch=>patch.lessons=[]
    ]){
        const patch=replacement();mutate(patch);assert.throws(()=>mergeRepair(bad,patch,plan),/replacement forms/);
    }
    const infinitive={pair:'פעל שלם|שם הפועל',root:'כתב',person:'form',exercise:'choice',number:1};
    const altPlan=planRepair({lessons:[],questions:[infinitive]},{[infinitive.pair]:['כתב','למד']},[{pair:'פעל שלם|עבר',root:'כתב'}]);
    assert.equal(altPlan.questions[0],infinitive,'past-tense distractor repairs its infinitive question');
});
test('one failed correction stops; provider outages do not trigger a correction',async()=>{
    const sole={...request,vocabulary:{...request.vocabulary,verbs:['אכל']}},bad=worksheet('אכל');
    let calls=0,checks=0;
    await assert.rejects(generateWorksheet(sole,async()=>{calls++;return JSON.stringify(bad);},async(...args)=>{checks++;return verify(...args);}),{code:'CATALOGUE_FORM_MISMATCH'});
    assert.equal(calls,2);assert.equal(checks,0);
    calls=0;
    await assert.rejects(generateWorksheet(request,async()=>{calls++;return JSON.stringify(worksheet());},async()=>{throw Object.assign(new Error('Dicta unavailable'),{code:'DICTA_UNAVAILABLE',status:503});}),/Dicta unavailable/);
    assert.equal(calls,1);
});
test('generation, correction and verification share one deadline',async()=>{
    let clock=0,calls=0,checks=0;const generationTimeouts=[],verificationTimeouts=[];
    await generateWorksheet(request,async(prompt,options)=>{
        generationTimeouts.push(options.timeoutMs);clock+=110000;++calls;
        return JSON.stringify(calls===1?mixedCandidate():replacement());
    },async(result,input,unused,options)=>{
        checks++;verificationTimeouts.push(options.timeoutMs);clock+=25000;
        return verify(result,input,unused,options);
    },{now:()=>clock});
    assert.deepEqual(generationTimeouts,[110000,110000]);assert.deepEqual(verificationTimeouts,[25000]);
    assert.equal(checks,1);assert.equal(clock,245000);
    clock=0;calls=0;
    await assert.rejects(generateWorksheet(request,async()=>{calls++;clock=275000;return JSON.stringify(mixedCandidate());},verify,{now:()=>clock}),/verified in time/);
    assert.equal(calls,1,'no correction starts after the deadline');
});
