'use strict';
const core=require('../PeninaPlus-Binyan-Builder/core');
const pronouns={first_sg:'אֲנִי',second_m_sg:'אַתָּה',second_f_sg:'אַתְּ',third_m_sg:'הוּא',third_f_sg:'הִיא',first_pl:'אֲנַחְנוּ',second_m_pl:'אַתֶּם',second_f_pl:'אַתֶּן',third_m_pl:'הֵם',third_f_pl:'הֵן',masculine_singular:'הוּא',feminine_singular:'הִיא',masculine_plural:'הֵם',feminine_plural:'הֵן',form:''};
const context=item=>item.pair.endsWith('|ציווי')?'אָנָּא':pronouns[item.person];
const tenseCodes={'עבר':'PAST','הווה':'PRESENT','עתיד':'FUTURE','שם הפועל':'TOINFINITIVE','ציווי':'IMPERATIVE'};
// Canonical mark order, qamatz qatan and holam-haser display variants only.
const pointed=s=>String(s).normalize('NFD').replace(/[\u0591-\u05AF\u05BD]/g,'').replace(/\u05C7/g,'\u05B8').replace(/\u05BA/g,'\u05B9').normalize('NFD');
function rootMatches(lex,root,pair){
    const actual=core.normalize(lex), expected=core.normalize(root);
    return actual===expected || (pair.startsWith('פעל ל-ה|') && actual===expected.slice(0,-1)+'י');
}
function matches(row,item){
    const tense=item.pair.split('|')[1], person=item.person;
    if(row.POS!=='VERB'||row.Binyan!=='BINYAN_PAAL'||row.Tense!==tenseCodes[tense]||row.Prefix||row.Suffix||row.fAramaic!=='False')return false;
    if(!rootMatches(row.lex,item.root,item.pair)||pointed(row.menukad)!==pointed(item.answer))return false;
    if(person==='form')return true;
    const plural=person.endsWith('_pl')||person.endsWith('_plural');
    if(row.Number!==(plural?'PLURAL':'SINGULAR'))return false;
    const feminine=person.includes('_f_')||person.startsWith('feminine');
    const first=person.startsWith('first');
    // Standard modern feminine plural future/imperative may use masculine forms.
    const sharedPlural=feminine&&plural&&['עתיד','ציווי'].includes(tense);
    if(!first&&!row.Gender.includes(feminine?'FEMININE':'MASCULINE')&&!(sharedPlural&&row.Gender==='MASCULINE'))return false;
    if(tense!=='הווה'){
        const expected=first?'PERSON_1':person.startsWith('second')?'PERSON_2':'PERSON_3';
        if(row.Person!==expected)return false;
    }
    return true;
}
function parseRows(payload){
    if(typeof payload?.BGU!=='string')throw new Error('Dicta did not return grammatical analysis. Please try again.');
    const [header,...lines]=payload.BGU.trim().split(/\r?\n/), keys=header.split('\t');
    if(!['word','menukad','lex','POS','Binyan','Tense','Gender','Person','Number','Prefix','Suffix','fAramaic'].every(k=>keys.includes(k)))throw new Error('Dicta returned an unsupported analysis format.');
    return lines.filter(line=>line.trim()).map(line=>Object.fromEntries(line.split('\t').map((value,i)=>[keys[i],value])));
}
async function analyze(text){
    const key=process.env.DICTA_API_KEY;
    const endpoint=key?'https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud':'https://nakdan-u2-1a.loadbalancer.dicta.org.il/api';
    let response;
    try{
        response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({task:'nakdan',...(key?{apiKey:key}:{}),genre:'modern',data:text,useTokenization:true,matchpartial:false,keepnikud:true,keepqq:true,addmorph:true,freturnfullmorphstr:true})});
        if(!response.ok)throw new Error();
        return await response.json();
    }catch{throw new Error('Dicta verification is unavailable. No unverified worksheet was created. Please try again.');}
}
async function verifyWorksheet(result,request,analyzer=analyze){
    const all=[...result.lessons.flatMap(l=>l.forms.map(f=>({...f,pair:l.pair,root:l.root}))),...result.questions,...result.questions.filter(q=>q.exercise==='choice').map(q=>({...core.alternativeTarget(q),root:q.root,answer:q.alternative}))];
    const items=[...new Map(all.map(item=>[JSON.stringify([item.root,item.pair,item.person,item.answer]),item])).values()];
    for(const item of items){
        if(!core.eligibleRoot(item.root,item.pair)||!/^[א-ת\u05B0-\u05BC\u05C1\u05C2\u05C7]+$/.test(item.answer))throw new Error('An answer is outside the supported Paal patterns. Please build again.');
    }
    const payload=await analyzer(items.map(item=>`${context(item)} ${item.answer}.`.trim()).join('\n'));
    const rows=parseRows(payload);let cursor=0;
    for(const item of items){
        const pronoun=context(item);
        if(pronoun && core.normalize(rows[cursor++]?.word)!==core.normalize(pronoun))throw new Error('Dicta returned misaligned analysis. Please try again.');
        const row=rows[cursor++];
        if(!row||!matches(row,item))throw new Error(`Could not verify ${core.groupLabel(item.pair.split('|')[0])}, ${core.tenseNames[core.tenses.indexOf(item.pair.split('|')[1])]}, root ${item.root}. No unverified worksheet was created. Please build again or choose another combination.`);
        if(rows[cursor++]?.word!=='.')throw new Error('Dicta returned misaligned analysis. Please try again.');
    }
    if(cursor!==rows.length)throw new Error('Dicta returned unexpected analysis. Please try again.');
}
module.exports={verifyWorksheet,parseRows,matches,analyze};
