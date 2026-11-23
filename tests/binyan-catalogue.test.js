const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const data=require('../PeninaPlus-Binyan-Builder/verb-data');
const {extract,persons}=require('../scripts/build-binyan-catalogue');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const {matches}=require('../lib/binyan-dicta');
const {render}=require('../PeninaPlus-Binyan-Builder/exercises');
const pair=(binyan,tense,group='שלם')=>`${binyan} ${group}|${tense}`;
const input=(root,pair,patternMode='standard')=>core.validateRequest({mode:'learn',patternMode,pairs:[pair],count:6,vocabulary:{verbs:[root],binyanim:[pair]}});
function candidate(request){
    const root=request.vocabulary.verbs[0],pair=request.pairs[0],reference=core.catalogue.reference(root,pair,request.patternMode);
    return {unavailablePairs:[],lessons:[{pair,root,meaning:reference.meaning,explanation:reference.pattern.reason,
        forms:core.persons(pair).map(person=>({person,answer:reference.forms[person][0]}))}],
        questions:core.plan(request).map(q=>({...q,root,meaning:reference.meaning,answer:reference.forms[q.person][0],sentence:'',alternative:'',words:[],phrases:[]}))};
}

test('every binyan and supported form has dictionary-backed standard and exception coverage',()=>{
    assert.ok(data.entries.length>2000);
    assert.equal(data.license,'CC-BY-SA-4.0');assert.match(data.sourceSha256,/^[0-9a-f]{64}$/);
    for(const binyan of core.binyanim)for(const tense of core.tenses){
        const p=pair(binyan,tense,'— כל הגזרות');
        if(!core.validPair(p))continue;
        for(const kind of ['standard','exception']){
            const entries=data.entries.filter(e=>e.binyan===binyan&&e.patterns[tense]?.kind===kind);
            assert.ok(entries.length,`${binyan} ${tense} ${kind}`);
            for(const entry of entries){
                assert.deepEqual(Object.keys(entry.forms[tense]),persons(tense));
                assert.match(entry.source,/^https:\/\/en.wiktionary.org\/wiki\//);
                assert.ok(Object.values(entry.forms[tense]).every(answers=>answers.length&&answers.every(answer=>/^[א-ת\u05B0-\u05BC\u05C1\u05C2\u05C7]+$/.test(answer))));
            }
        }
    }
});

test('independent familiar paradigms are standard across all their supported forms',()=>{
    const examples=[['פעל','כתב'],['פיעל','למד'],['הפעיל','כתב'],['התפעל','כתב'],['נפעל','כתב'],['פועל','ספר'],['הופעל','כנס']];
    for(const [binyan,root] of examples)for(const tense of core.tenses){
        const p=pair(binyan,tense);if(!core.validPair(p))continue;
        assert.equal(core.eligibleRoot(root,p,'standard'),true,p);
        assert.equal(core.eligibleRoot(root,p,'exception'),false,p);
    }
    assert.equal(core.catalogue.accepts('כתב',pair('פעל','עבר'),'first_sg','כָּתַבְתִּי'),true);
    assert.equal(core.catalogue.accepts('למד',pair('פיעל','הווה'),'feminine_singular','מְלַמֶּדֶת'),true);
    assert.equal(core.catalogue.accepts('כנס',pair('הופעל','עתיד'),'third_m_sg','יֻכְנַס'),true);
});

test('exceptions are classified per tense, not per root, in all seven binyanim',()=>{
    const examples=[['פעל','למד','עתיד'],['פיעל','ברך','הווה'],['הפעיל','עמד','שם הפועל'],['התפעל','ספר','עבר'],['נפעל','אכל','עתיד'],['פועל','ברך','הווה'],['הופעל','קום','עבר']];
    for(const [binyan,root,tense] of examples){
        const p=pair(binyan,tense,'— כל הגזרות');
        assert.equal(core.eligibleRoot(root,p,'standard'),false,`${root} ${p}`);
        assert.equal(core.eligibleRoot(root,p,'exception'),true,`${root} ${p}`);
    }
    assert.equal(core.eligibleRoot('למד',pair('פעל','עבר')),true);
    assert.equal(core.catalogue.accepts('למד',pair('פעל','עתיד'),'third_m_sg','יִלְמַד','exception'),true);
    assert.equal(core.catalogue.accepts('למד',pair('פעל','עתיד'),'third_m_sg','יִלְמֹד','exception'),false);
    assert.equal(core.eligibleRoot('נגן',pair('פיעל','הווה')),true);
    assert.equal(core.eligibleRoot('נגן',pair('פיעל','עבר'),'exception'),true);
    assert.equal(core.eligibleRoot('הלך',pair('פעל','הווה')),true,'final kaf silent sheva is ordinary spelling');
    assert.equal(core.eligibleRoot('הלך',pair('פעל','שם הפועל'),'exception'),true);
    assert.equal(core.eligibleRoot('היה',pair('פעל','עתיד','ל-ה')),true,'even an irregular verb can match a standard pattern in one tense');
    assert.equal(core.eligibleRoot('היה',pair('פעל','עבר','ל-ה'),'exception'),true);
    assert.equal(core.eligibleRoot('היה',pair('פעל','הווה','ל-ה'),'exception'),false,'parenthesized source forms are not everyday be');
});

test('weak-root standard models stay separate from regular roots and from exceptions',()=>{
    for(const [root,group] of [['שתה','פעל ל-ה'],['קום','פעל ע"ו'],['ישב','פעל פ"י'],['נסה','פיעל ל-ה'],['ירד','הפעיל פ"י']]){
        assert.equal(core.eligibleRoot(root,`${group}|הווה`),true,group);
        assert.equal(core.eligibleRoot(root,`${group.split(' ')[0]} שלם|הווה`),false,group);
    }
    assert.equal(core.eligibleRoot('נתן','פעל חפ"נ|עבר'),false);
    assert.equal(core.eligibleRoot('נתן','פעל חפ"נ|עבר','exception'),true);
    assert.equal(core.eligibleRoot('קום','הופעל שלם|עבר','exception'),false,'hollow root is not relabeled shalem');
});

test('unknown roots and unattested binyan combinations never enter either selection',async()=>{
    for(const root of ['אבג','לבש'])for(const kind of ['standard','exception']){
        const p=pair('פיעל','הווה','— כל הגזרות');
        assert.equal(core.eligibleRoot(root,p,kind),false);
        assert.equal(core.catalogue.describe(root,p).unverified,true);
        await assert.rejects(generateWorksheet(input(root,p,kind),()=>assert.fail('no AI'),()=>assert.fail('no Dicta')),/No suitable roots verified/);
    }
});

test('standard and exception worksheets cannot be mixed or forged on the server',async()=>{
    const p=pair('פעל','עתיד'),req=input('למד',p,'exception'),good=candidate(req);
    core.validateResult(good,req);
    assert.throws(()=>core.validateResult(good,{...req,patternMode:'standard'}),/checks/);
    assert.throws(()=>core.validateRequest({...req,patternMode:'all'}),/standard patterns or exceptions/);
    let calls=0;
    const result=await generateWorksheet(req,async prompt=>{
        calls++;assert.match(prompt,/exclusively Exceptions/);
        const refs=JSON.parse(prompt.match(/^Dictionary reference per pair: (.*)$/m)[1]);
        assert.equal(refs[p][0].pattern.kind,'exception');
        return JSON.stringify(good);
    },async()=>{});
    assert.equal(calls,1);assert.equal(result.request.patternMode,'exception');
    const wrong=structuredClone(good);wrong.questions[0].answer='אֶלְמֹד';
    assert.throws(()=>core.validateResult(wrong,req),{code:'CATALOGUE_FORM_MISMATCH'});
});

test('verbal nouns require the source verb relationship and exact pointed noun',async()=>{
    const p=pair('פעל','שם פעולה'),req=input('כתב',p),good=candidate(req);
    assert.equal(good.questions[0].answer.normalize('NFD'),'כְּתִיבָה'.normalize('NFD'));
    core.validateResult(good,req);
    const row={word:'כתיבה',menukad:'כְּתִיבָה',lex:'כתיבה',POS:'NOUN',Prefix:'',Suffix:'',fAramaic:'False'};
    const item={root:'כתב',pair:p,person:'form',answer:'כְּתִיבָה'};
    assert.equal(matches(row,item),true);
    for(const change of [{root:'למד'},{pair:pair('הפעיל','שם פעולה')},{answer:'כְּתִיבַה'}])assert.equal(matches(row,{...item,...change}),false);
    assert.equal(matches({...row,POS:'VERB'},item),false);
    assert.equal(matches({...row,Prefix:'HE'},item),false);
    assert.equal(core.catalogue.accepts('למד',pair('פיעל','שם פעולה'),'form','לִמּוּד'),true);
    assert.equal(core.catalogue.accepts('למד',pair('פעל','שם פעולה'),'form','לִמּוּד'),false);
    const html=render(good.questions);assert.match(html,/Verbal noun/);assert.doesNotMatch(html,/Infinitive/);
    assert.equal(core.validPair(pair('פועל','שם פעולה')),false);
    assert.equal(core.validPair(pair('הופעל','שם פעולה')),false);
});

test('a choice distractor uses its source lexeme even when the other tense is exceptional',()=>{
    const p=pair('פעל','שם פעולה','חפ"נ'),q={root:'נתן',pair:p,person:'form',exercise:'choice'};
    assert.equal(core.eligibleRoot('נתן',p),true);
    assert.equal(core.eligibleRoot('נתן','פעל חפ"נ|עבר','exception'),true);
    assert.ok(core.alternativeAnswers(q).some(answer=>answer.normalize('NFD')==='נָתַן'.normalize('NFD')));
});

test('reference spelling equivalence preserves vowels, dagesh and shin/sin identity',()=>{
    const p=pair('פעל','שם הפועל');
    for(const form of ['לִכְתּוֹב','לִכְתֹּב'])assert.equal(core.catalogue.accepts('כתב',p,'form',form),true);
    for(const form of ['לכתוב','לִכְתַּב','לִכְתּוּב','לִכְתֹב'])assert.equal(core.catalogue.accepts('כתב',p,'form',form),false,form);
    assert.equal(core.catalogue.accepts('שמר',pair('פעל','עבר'),'third_m_sg','שָׂמַר'),false);
});

test('import rejects a constructed root, excluded-only senses, and incomplete paradigms',()=>{
    const raw={word:'לימד',pos:'verb',inflection_templates:[{name:'he-conj',args:{1:'pi',2:'למד'}}],
        senses:[{glosses:['to teach']}],forms:[{form:'מְלַמֵּד',source:'conjugation',tags:['masculine','singular','present']}]};
    assert.equal(extract(raw),null,'one form cannot establish a complete tense');
    for(const tag of ['archaic','Biblical','rare','vulgar'])assert.equal(extract({...raw,senses:[{glosses:['to teach'],tags:[tag]}]}),null);
    assert.equal(extract({...raw,inflection_templates:[]}),null,'no invented root from a word spelling');
});
