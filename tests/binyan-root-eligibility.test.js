const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const {verifyWorksheet}=require('../lib/binyan-dicta');
const recorded=require('./fixtures/binyan-dicta-piel-authenticated.json');
const pielGroups=core.groups.filter(group=>group.startsWith('פיעל '));
const request=(pair,mode='learn',verbs=['לבש','למד'])=>core.validateRequest({
    mode,pairs:[pair],count:6,exercises:['choice','conjugate'],vocabulary:{verbs,binyanim:[pair]}
});
function candidate(input,root='למד'){
    const pair=input.pairs[0];
    // The reported Piel candidate is deliberately constructed, not a recording
    // of the user's worksheet. The accepted למד forms use a saved Dicta fixture.
    const answers=root==='למד'?recorded.items.map(item=>item.answer):['מְלַבֵּשׁ','מְלַבֶּשֶׁת','מְלַבְּשִׁים','מְלַבְּשׁוֹת'];
    const form=person=>answers[core.persons(pair).indexOf(person)];
    return {unavailablePairs:[],lessons:input.mode==='learn'?[{
        pair,root,meaning:root==='למד'?'teach':'dress',explanation:'Present-tense model.',
        forms:core.persons(pair).map(person=>({person,answer:form(person)}))
    }]:[],questions:core.plan(input).map(q=>({...q,root,meaning:root==='למד'?'teach':'dress',answer:form(q.person),
        alternative:q.exercise==='choice'?form(core.alternativeTarget(q).person):'',sentence:'',words:[],phrases:[]}))};
}

test('לבש is excluded from every Piel group and tense, including normalized roots',()=>{
    for(const group of pielGroups)for(const tense of core.tenses)for(const root of ['לבש','לָבַשׁ','ל־ב־ש']){
        assert.equal(core.eligibleRoot(root,`${group}|${tense}`),false,`${root}: ${group}|${tense}`);
    }
    for(const binyan of ['פעל','הפעיל','התפעל'])for(const tense of ['עבר','הווה']){
        const pair=`${binyan} שלם|${tense}`;
        if(core.validPair(pair)&&pair!=='פעל שלם|שם הפועל')assert.equal(core.eligibleRoot('לבש',pair),true,pair);
    }
    assert.equal(core.eligibleRoot('לבש','פעל שלם|עתיד','exception'),true);
    for(const root of ['למד','דבר','ספר'])assert.equal(core.eligibleRoot(root,'פיעל שלם|הווה'),true,root);
});

test('Learn and Practice generation omit לבש from Piel while reusing eligible uploaded roots',async()=>{
    for(const group of ['פיעל שלם','פיעל — כל הגזרות'])for(const mode of ['learn','practice']){
        const input=request(`${group}|הווה`,mode);let checks=0;
        const output=await generateWorksheet(input,async prompt=>{
            assert.deepEqual(JSON.parse(prompt.match(/^Eligible roots per pair: (.*)$/m)[1]),{[input.pairs[0]]:['למד']});
            return JSON.stringify(candidate(input));
        },async result=>{checks++;assert.ok(result.questions.every(q=>q.root==='למד'));});
        assert.equal(checks,1);assert.equal(output.questions.length,6);
        assert.ok(output.lessons.every(lesson=>lesson.root==='למד'));
    }
});

test('a Piel request with only לבש fails before generation or Dicta',async()=>{
    for(const group of ['פיעל שלם','פיעל — כל הגזרות'])for(const mode of ['learn','practice']){
        await assert.rejects(generateWorksheet(request(`${group}|הווה`,mode,['לבש']),
            ()=>assert.fail('generation must not run'),()=>assert.fail('Dicta must not run')),
        error=>error.status===422&&error.worksheetStage==='eligibility'&&/No suitable roots/.test(error.message));
    }
});

test('generated לבש Piel lessons and questions are rejected even if the provider ignores eligibility',async()=>{
    for(const mode of ['learn','practice']){
        const input=request('פיעל שלם|הווה',mode);
        const variants=[()=>candidate(input,'לבש'),()=>{
            const result=candidate(input);result.questions[0]=candidate(input,'לבש').questions[0];return result;
        }];
        if(mode==='learn')variants.push(()=>{const result=candidate(input);result.lessons=candidate(input,'לבש').lessons;return result;});
        for(const makeCandidate of variants){
            assert.throws(()=>core.validateResult(makeCandidate(),input),/did not pass/);
            await assert.rejects(generateWorksheet(input,async()=>JSON.stringify(makeCandidate()),
                ()=>assert.fail('ineligible forms must not reach Dicta')),/did not pass/);
            await assert.rejects(verifyWorksheet(makeCandidate(),input,
                ()=>assert.fail('an analyzer accepting this form must not override eligibility')),{code:'DICTA_INELIGIBLE_FORM'});
        }
    }
});
