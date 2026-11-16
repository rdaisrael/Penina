const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const {generateReaderAnalysis}=require('../lib/reader-response');
const pair='פיעל שלם|הווה',forms=['מְלַמֵּד','מְלַמֶּדֶת','מְלַמְּדִים','מְלַמְּדוֹת'];
const input=(count=12,exercises=['choice','conjugate','sentence'])=>core.validateRequest({mode:'learn',pairs:[pair],count,exercises,
    vocabulary:{verbs:['למד'],binyanim:[],adverbs:['כאן']}});
function fixture(request){
    const answer=person=>forms[core.persons(pair).indexOf(person)];
    return {unavailablePairs:[],lessons:[{pair,root:'למד',meaning:'teach',explanation:'Present-tense model.',forms:core.persons(pair).map(person=>({person,answer:answer(person)}))}],
        questions:core.plan(request).map(q=>({...q,root:'למד',meaning:'teach',answer:answer(q.person),
            alternative:q.exercise==='choice'?answer(core.alternativeTarget(q).person):'',
            sentence:['sentence','writing'].includes(q.exercise)?`${core.subject(q.person)} ___ כָּאן.`:'',
            words:['sentence','writing'].includes(q.exercise)?[
                {word:core.subject(q.person),translation:'subject',match:'__pronoun__',mastered:true,form:'',prefix:'',isName:false},
                {word:'כָּאן',translation:'here',match:'כאן',mastered:true,form:'',prefix:'',isName:false}
            ]:[],phrases:[]}))};
}
const timeout=()=>Object.assign(new Error('AI generation took too long.'),{retryable:true,code:'OPENAI_TIMEOUT'});

test('6, 12, 24 and 30 questions are generated together and fully checked, including sentence-only worksheets',async()=>{
    for(const count of [6,12,24,30])for(const exercises of [['choice','conjugate','sentence'],['sentence'],['writing']]){
        const request=input(count,exercises);let calls=0,checks=0,clock=0;
        const result=await generateWorksheet(request,async(prompt,options)=>{
            calls++;assert.equal(options.timeoutMs,110000);assert.equal(options.maxAttempts,1);
            assert.equal(JSON.parse(prompt.match(/^Question plan: (.*)$/m)[1]).length,count);
            clock=95000; // A successful response after the old 70-second cutoff.
            return JSON.stringify(fixture(request));
        },async(candidate,checkedRequest,unused,options)=>{
            checks++;assert.equal(candidate.questions.length,count);assert.equal(checkedRequest.count,count);
            assert.equal(options.timeoutMs,25000);
        },{now:()=>clock});
        assert.equal(calls,1);assert.equal(checks,1);assert.equal(result.questions.length,count);
        assert.deepEqual(result.questions.map(q=>q.number),Array.from({length:count},(_,i)=>i+1));
        for(const q of result.questions.filter(q=>['sentence','writing'].includes(q.exercise)))assert.equal(q.sentenceWords.length,2);
    }
});
test('Binyan uses the same per-call timeout and structured-output allowance as Penina Hebrew Reader',async()=>{
    const stop=new Error('capture only');let readerOptions,binyanOptions;
    await assert.rejects(generateReaderAnalysis('Analyze',{
        mode:'upload',words:[],verbs:[],nouns:[],adjs:[],forms:[]
    },'כותרת\nהוא כאן.',async(prompt,options)=>{readerOptions=options;throw stop;}),error=>error===stop);
    await assert.rejects(generateWorksheet(input(),async(prompt,options)=>{binyanOptions=options;throw stop;},()=>assert.fail('no verification')),error=>error===stop);
    for(const field of ['timeoutMs','maxOutputTokens','maxAttempts'])assert.equal(binyanOptions[field],readerOptions[field]);
});
test('one transient failure retries the complete request with a fresh Reader-length allowance',async()=>{
    const request=input(24),prompts=[],reports=[];let clock=0,checks=0;
    const result=await generateWorksheet(request,async(prompt,options)=>{
        prompts.push(prompt);assert.equal(options.timeoutMs,110000);
        if(prompts.length===1){clock=110000;throw timeout();}
        clock=205000;return JSON.stringify(fixture(request));
    },async(candidate,request,unused,options)=>{checks++;assert.equal(options.timeoutMs,25000);clock+=25000;},
    {now:()=>clock,onGeneration:report=>reports.push(report)});
    assert.equal(prompts.length,2);assert.equal(prompts[0],prompts[1]);assert.equal(checks,1);assert.equal(result.questions.length,24);
    assert.deepEqual(reports.map(r=>[r.stage,r.status,r.durationMs]),[['generation','failed',110000],['generation-retry','completed',95000]]);
    assert.doesNotMatch(JSON.stringify(reports),/למד|כאן|answer|root|vocabulary|prompt/);
});
test('permanent failures do not retry; repeated transient failures stop after two calls',async()=>{
    for(const retryable of [false,true]){
        let calls=0;
        await assert.rejects(generateWorksheet(input(),async()=>{calls++;throw Object.assign(timeout(),{retryable});},()=>assert.fail('no unverified output')),
            error=>error.code==='OPENAI_TIMEOUT'&&error.worksheetStage===(retryable?'generation-retry':'generation')&&error.status===503);
        assert.equal(calls,retryable?2:1);
    }
});
test('a service retry consumes the same second-call budget as a morphology correction',async()=>{
    const request=input(),mismatch=Object.assign(new Error('Could not verify generated form'),{code:'DICTA_FORM_MISMATCH',rejectedForms:[{pair,root:'למד'}]});
    let calls=0,checks=0;
    await assert.rejects(generateWorksheet(request,async()=>{
        if(++calls===1)throw timeout();return JSON.stringify(fixture(request));
    },async()=>{checks++;throw mismatch;}),error=>error===mismatch&&error.status===422);
    assert.equal(calls,2);assert.equal(checks,1);
});
