const test=require('node:test'),assert=require('node:assert/strict');
const {partsFor,generateParts,readPart}=require('../lib/binyan-generation');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const core=require('../PeninaPlus-Binyan-Builder/core');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=part=>JSON.stringify({unavailablePairs:[],lessons:part.lessonPairs.map(pair=>({pair})),questions:part.questions});
const input=count=>core.validateRequest({mode:'learn',pairs:['פיעל שלם|הווה'],count,exercises:['choice','conjugate','sentence'],vocabulary:{verbs:['למד'],binyanim:[]}});

test('the reported twelve-question request is split into three independently generated parts',async()=>{
    const request=input(12),plan=core.plan(request),parts=partsFor(plan,request.pairs);
    let active=0,maxActive=0;const releases=[];
    const pending=generateParts(parts,async part=>{
        assert.ok(part.questions.length<=4);active++;maxActive=Math.max(maxActive,active);
        return new Promise(resolve=>releases.push(()=>{active--;resolve(response(part));}));
    });
    assert.equal(releases.length,3,'all parts start before any response arrives');
    releases.reverse().forEach(release=>release());
    const result=await pending;
    assert.equal(maxActive,3);assert.deepEqual(result.questions,plan);
    assert.deepEqual(result.lessons,[{pair:request.pairs[0]}]);
});
test('large worksheets cap concurrent calls and preserve question order across queued parts',async()=>{
    const request=input(30),plan=core.plan(request),parts=partsFor(plan,request.pairs);
    let active=0,maxActive=0;const releases=[];
    const pending=generateParts(parts,async part=>{
        active++;maxActive=Math.max(maxActive,active);
        return new Promise(resolve=>releases.push(()=>{active--;resolve(response(part));}));
    });
    assert.equal(releases.length,4);
    releases[3]();await tick();assert.equal(releases.length,5,'one free slot starts one queued part');
    for(const index of [2,1,0])releases[index]();await tick();
    assert.equal(releases.length,8);
    for(const index of [7,6,5,4])releases[index]();
    const result=await pending;assert.equal(maxActive,4);assert.deepEqual(result.questions,plan);
});
test('queued parts share the initial generation deadline instead of restarting it',async()=>{
    const request={...input(30),mode:'practice',exercises:['conjugate'],vocabulary:{verbs:['למד'],binyanim:['פיעל שלם|הווה']}};
    for(const elapsed of [20000,70000]){
        let clock=0;const timeouts=[],releases=[];
        const pending=generateWorksheet(request,async(prompt,options)=>{
            timeouts.push(options.timeoutMs);
            const questions=JSON.parse(prompt.match(/^Question plan: (.*)$/m)[1]).map(q=>({...q,root:'למד',meaning:'teach',answer:'מְלַמֵּד'}));
            return new Promise(resolve=>releases.push(()=>resolve(JSON.stringify({unavailablePairs:[],lessons:[],questions}))));
        },async()=>{}, {now:()=>clock});
        // Attach the rejection handler before advancing the simulated clock.
        const settled=pending.then(result=>({result}),error=>({error}));
        assert.deepEqual(timeouts,[70000,70000,70000,70000]);
        clock=elapsed;releases.slice().forEach(release=>release());await tick();
        if(elapsed===70000){
            const {error}=await settled;
            assert.equal(error.code,'OPENAI_TIMEOUT');assert.equal(error.worksheetStage,'generation');
            assert.equal(timeouts.length,4,'no queued provider request starts after the deadline');
        }else{
            assert.deepEqual(timeouts.slice(4),[50000,50000,50000,50000]);
            releases.slice(4).forEach(release=>release());
            const {result,error}=await settled;assert.equal(error,undefined);assert.equal(result.questions.length,30);
        }
    }
});
test('mixed patterns allocate each model once, including parts containing models only',async()=>{
    const pairs=[...core.binyanim.map(b=>`${b} שלם|עבר`),'פעל שלם|הווה'];
    const request={...input(8),pairs},parts=partsFor(core.plan(request),pairs);
    assert.ok(parts.some(part=>!part.questions.length&&part.lessonPairs.length));
    assert.ok(parts.every(part=>part.lessonPairs.length<=2));
    const result=await generateParts(parts,async part=>response(part));
    assert.deepEqual(result.lessons.map(l=>l.pair),pairs);assert.deepEqual(result.questions,core.plan(request));
});
test('one provider failure cancels in-flight siblings and never starts queued parts or returns partial work',async()=>{
    const request=input(30),parts=partsFor(core.plan(request),request.pairs);
    let calls=0,cancelled=0;const original=Object.assign(new Error('AI generation took too long.'),{code:'OPENAI_TIMEOUT'});
    await assert.rejects(generateParts(parts,async(part,signal)=>{
        calls++;if(part.questions[0].number===1)throw original;
        return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled++;reject(new Error('cancelled sibling'));}));
    }),error=>error===original);
    assert.equal(calls,4);assert.equal(cancelled,3);
});
test('a part cannot duplicate another part’s questions, omit a model or change a requested subject',()=>{
    const request=input(12),parts=partsFor(core.plan(request),request.pairs);
    for(const mutate of [
        r=>r.questions[0].number=9,r=>r.questions[0].person='first_sg',
        r=>r.questions.push(parts[1].questions[0]),r=>r.lessons=[]
    ]){
        const result=JSON.parse(response(parts[0]));mutate(result);
        assert.throws(()=>readPart(JSON.stringify(result),parts[0]),/checks/);
    }
    assert.throws(()=>readPart('{',parts[0]),/unreadable/);
    assert.throws(()=>readPart(JSON.stringify({unavailablePairs:request.pairs,lessons:[],questions:[]}),parts[0]),/No suitable verbs/);
});
