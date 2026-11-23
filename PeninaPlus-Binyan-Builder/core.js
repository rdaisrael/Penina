(function(root, factory) {
    const api = factory(typeof module==='object'&&module.exports?require('./verb-catalogue'):root.BinyanCatalogue);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BinyanBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(catalogue) {
    const binyanim = ['פעל','פיעל','הפעיל','התפעל','נפעל','פועל','הופעל'];
    const generalGroups = binyanim.map(binyan=>`${binyan} — כל הגזרות`);
    const groups = [...generalGroups,'פעל שלם','פעל ל-ה','פעל ע"ו','פעל חפ"נ','פעל פ"י','פיעל שלם','פיעל ל-ה','הפעיל שלם','הפעיל ל-ה','הפעיל ע"ו','הפעיל פ"י','התפעל שלם','נפעל שלם','פועל שלם','הופעל שלם'];
    const binyanLabel = group => ({'פעל':'קל (פעל)','פיעל':'פיעל','הפעיל':'הפעיל','התפעל':'התפעל','נפעל':'נפעל','פועל':'פועל','הופעל':'הופעל'}[group.split(' ')[0]]);
    const rootTypeLabel = group => generalGroups.includes(group)?'All root types — כל הגזרות':
        ({'שלם':'Shalem — שלם','ל-ה':'ל״ה — Lamed hey','ע"ו':'ע״ו — Hollow','חפ"נ':'חפ״נ — Initial nun','פ"י':'פ״י — Initial yod'}[group.split(' ')[1]]);
    const groupLabel = group => `${binyanLabel(group)} · ${rootTypeLabel(group)}`;
    const tenses = ['עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי'];
    const tenseNames = ['Past','Present','Future','Infinitive','Verbal noun','Imperative'];
    const patternModes={standard:'Standard pattern',exception:'Exceptions'};
    const vocabularyKeys = ['nouns','adjs','preps','adverbs','conjunctions','questionWords','expressions'];
    const exerciseTypes = {
        choice:'Circle the correct form', conjugate:'Write the correct form',
        sentence:'Complete the sentence', writing:'Write your own sentence'
    };
    const subjectLabels = {masculine_singular:'הוא',feminine_singular:'היא',masculine_plural:'הם',feminine_plural:'הן'};
    const people = {
        first_sg:'אני', second_m_sg:'אתה', second_f_sg:'את', third_m_sg:'הוא', third_f_sg:'היא',
        first_pl:'אנחנו', second_m_pl:'אתם', second_f_pl:'אתן', third_m_pl:'הם', third_f_pl:'הן',
        masculine_singular:'הוא, אתה, אני (ז.)', feminine_singular:'היא, את, אני (נ.)', masculine_plural:'הם, אתם, אנחנו (ז.)', feminine_plural:'הן, אתן, אנחנו (נ.)', form:'צורה'
    };
    const normalize = value => String(value).normalize('NFD').replace(/[\u0591-\u05C7]/g,'').replace(/[^א-ת]/g,'').replace(/[ךםןףץ]/g,c=>({'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'}[c]));
    function persons(pair) {
        const tense=pair.split('|')[1];
        if(tense==='הווה') return ['masculine_singular','feminine_singular','masculine_plural','feminine_plural'];
        if(tense==='שם הפועל'||tense==='שם פעולה')return ['form'];
        if(tense==='ציווי')return ['second_m_sg','second_f_sg','second_m_pl','second_f_pl'];
        return Object.keys(people).slice(0,10);
    }
    function validPair(pair) {
        if(typeof pair!=='string')return false;
        const [group,tense,...rest]=pair.split('|');
        return !rest.length && groups.includes(group) && tenses.includes(tense) &&
            (!['פועל','הופעל'].includes(group.split(' ')[0]) || ['עבר','הווה','עתיד'].includes(tense));
    }
    // Deliberately conservative: expand only after reviewing the actual infinitive.
    // Eligibility is per tense; this list must not exclude roots from other tenses.
    const regularInfinitives = Object.freeze({
        'כתב':'לִכְתּוֹב', 'שמר':'לִשְׁמוֹר', 'למד':'לִלְמוֹד',
        'סגר':'לִסְגּוֹר', 'גמר':'לִגְמוֹר', 'ספר':'לִסְפּוֹר',
        'מכר':'לִמְכּוֹר', 'קבר':'לִקְבּוֹר', 'שבר':'לִשְׁבּוֹר',
        'קשר':'לִקְשׁוֹר', 'תפר':'לִתְפּוֹר', 'גנב':'לִגְנוֹב',
        'קפצ':'לִקְפּוֹץ', 'רקד':'לִרְקוֹד', 'בדק':'לִבְדּוֹק',
        'זכר':'לִזְכּוֹר'
    });
    const standardInfinitive = (root,pair) => pair==='פעל שלם|שם הפועל'
        ? regularInfinitives[normalize(root)] : undefined;
    function standardAnswer(root,pair,person,answer,patternMode='standard') {
        return !!catalogue?.accepts(root,pair,person,answer,patternMode);
    }
    function eligibleRoot(root, pair, patternMode='standard') {
        return validPair(pair)&&Object.hasOwn(patternModes,patternMode)&&!!catalogue?.entryFor(root,pair,patternMode);
    }
    function validateRequest(input) {
        const fail = message => {throw new Error(message);};
        if(!input || !['learn','practice'].includes(input.mode))fail('Choose Learn or Practice.');
        const {mode, vocabulary:v, pairs, count}=input;
        const patternMode=input.patternMode===undefined?'standard':input.patternMode;
        if(!Object.hasOwn(patternModes,patternMode))fail('Choose standard patterns or exceptions.');
        const exercises=input.exercises===undefined?['conjugate']:input.exercises;
        if(!Array.isArray(exercises)||!exercises.length||exercises.some(x=>!Object.hasOwn(exerciseTypes,x))||new Set(exercises).size!==exercises.length)fail('Choose at least one exercise type.');
        if(!v || !Array.isArray(v.verbs) || !v.verbs.length || v.verbs.length>500)fail('Upload a Reader spreadsheet containing 1–500 mastered roots.');
        if(v.verbs.some(x=>typeof x!=='string'||x.length>30||!/^[א-ת\u0591-\u05C7 .־״"׳'-]+$/.test(x)||normalize(x).length<2||normalize(x).length>4))fail('Roots must contain two to four Hebrew letters. Check column A.');
        if(!Array.isArray(v.binyanim)||v.binyanim.length>100||v.binyanim.some(x=>typeof x!=='string'||x.length>80))fail('Invalid learned combinations in the spreadsheet.');
        if(!Array.isArray(pairs)||!pairs.length||pairs.length>8||pairs.some(x=>!validPair(x))||new Set(pairs).size!==pairs.length)fail('Select 1–8 different binyan and tense combinations.');
        if(mode==='practice' && pairs.some(x=>!v.binyanim.includes(x)))fail('Practice can only use combinations marked X in the uploaded spreadsheet.');
        if(!Number.isInteger(count)||count<6||count>30||count<pairs.length)fail('Choose 6–30 questions, with at least one per selected combination.');
        const footnotes=input.footnotes===undefined?'none':input.footnotes;
        if(!['none','page','end'].includes(footnotes))fail('Choose page-bottom notes, end notes, or no notes.');
        const vocabulary={verbs:[...new Set(v.verbs.map(normalize))],binyanim:v.binyanim.filter(validPair)};
        // Preserve every Reader vocabulary sheet, including learned context-verb forms
        // outside the narrower set of patterns supported as exercise targets.
        const forms=v.forms===undefined?v.binyanim:v.forms;
        if(!Array.isArray(forms)||forms.length>100||forms.some(x=>typeof x!=='string'||x.length>80))fail('Invalid learned vocabulary forms.');
        vocabulary.forms=[...new Set(forms)];
        for(const key of vocabularyKeys){
            const entries=v[key]===undefined?[]:v[key];
            if(!Array.isArray(entries)||entries.length>5000||entries.some(x=>typeof x!=='string'||x.length>160||!/[א-ת]/.test(x)||!/^[א-ת\u0591-\u05C7\s.,־״"׳'!?()-]+$/.test(x)))fail('Vocabulary sheets must contain Hebrew words or expressions (up to 5,000 per sheet).');
            vocabulary[key]=[...new Set(entries.map(x=>x.trim()).filter(Boolean))];
        }
        if(JSON.stringify(vocabulary).length>100000)fail('Please use a smaller vocabulary workbook (up to 100,000 characters).');
        return {mode,patternMode,vocabulary,pairs:[...pairs],count,exercises:[...exercises],footnotes};
    }
    function plan(request) {
        return Array.from({length:request.count},(_,i)=>{
            const pair=request.pairs[i%request.pairs.length], ps=persons(pair);
            const types=request.exercises||['conjugate'];
            return {number:i+1,pair,person:ps[Math.floor(i/request.pairs.length)%ps.length],exercise:types[Math.floor(i*types.length/request.count)]};
        });
    }
    function subject(person) {return subjectLabels[person]||people[person];}
    function alternativeTarget(q) {
        if(q.person==='form')return {pair:q.pair.replace(/\|שם (הפועל|פעולה)$/,'|עבר'),person:'third_m_sg'};
        const person=q.person.endsWith('_singular')?q.person.replace('_singular','_plural'):
            q.person.endsWith('_plural')?q.person.replace('_plural','_singular'):
            q.person.endsWith('_sg')?q.person.replace('_sg','_pl'):q.person.replace('_pl','_sg');
        return {pair:q.pair,person};
    }
    function alternativeAnswers(q,patternMode='standard') {
        const entry=catalogue?.entryFor(q.root,q.pair,patternMode),target=alternativeTarget(q);
        return entry?.forms[target.pair.split('|')[1]]?.[target.person]||[];
    }
    function eligibleRoots(request){
        const questions=plan(request);
        return Object.fromEntries(request.pairs.map(pair=>[pair,request.vocabulary.verbs.filter(root=>eligibleRoot(root,pair,request.patternMode)&&
            questions.filter(q=>q.pair===pair&&q.exercise==='choice').every(q=>
                catalogue.answers(root,pair,q.person,request.patternMode).some(answer=>alternativeAnswers({...q,root},request.patternMode).some(other=>normalize(other)!==normalize(answer))))) ]));
    }
    function validateForms(result,request){
        const rejectedForms=[];
        for(const lesson of result.lessons)for(const row of lesson.forms){
            if(!standardAnswer(lesson.root,lesson.pair,row.person,row.answer,request.patternMode))rejectedForms.push({...row,pair:lesson.pair,root:lesson.root});
        }
        for(const q of result.questions){
            if(!standardAnswer(q.root,q.pair,q.person,q.answer,request.patternMode))rejectedForms.push({pair:q.pair,root:q.root,person:q.person,answer:q.answer});
            if(q.exercise==='choice'&&!alternativeAnswers(q,request.patternMode).some(expected=>catalogue.pointedKey(expected)===catalogue.pointedKey(q.alternative)))
                rejectedForms.push({...alternativeTarget(q),root:q.root,answer:q.alternative});
        }
        if(rejectedForms.length)throw Object.assign(new Error('Some generated forms did not match the verb reference. No unchecked worksheet was created. Please try again.'),{code:'CATALOGUE_FORM_MISMATCH',rejectedForms,status:422});
        return result;
    }
    function validateResult(result, request, {checkForms=true}={}) {
        const fail=()=>{throw new Error('The generated worksheet did not pass its checks. Please try again or choose another combination.');};
        const text=(x,max=1600)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
        const rootOK=x=>typeof x==='string'&&request.vocabulary.verbs.includes(normalize(x));
        const hebrew=x=>text(x,120)&&/[א-ת]/.test(x)&&/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/.test(x)&&!/[a-zA-Z<>]/.test(x);
        if(!result || !Array.isArray(result.lessons)||!Array.isArray(result.questions))fail();
        if(result.lessons.length!==(request.mode==='learn'?request.pairs.length:0))fail();
        result.lessons.forEach((lesson,i)=>{
            if(lesson.pair!==request.pairs[i]||!rootOK(lesson.root)||!eligibleRoot(lesson.root,lesson.pair,request.patternMode)||!text(lesson.meaning,180)||!text(lesson.explanation))fail();
            const ps=persons(lesson.pair);
            if(!Array.isArray(lesson.forms)||lesson.forms.length!==ps.length)fail();
            lesson.forms.forEach((row,j)=>{if(row.person!==ps[j]||!hebrew(row.answer))fail();});
        });
        if(result.questions.length!==request.count)fail();
        plan(request).forEach((expected,i)=>{
            const q=result.questions[i];
            if(!q||(q.exercise||'conjugate')!==expected.exercise||q.number!==expected.number||q.pair!==expected.pair||q.person!==expected.person||!rootOK(q.root)||!eligibleRoot(q.root,q.pair,request.patternMode)||!hebrew(q.answer)||!text(q.meaning,180))fail();
            if(['sentence','writing'].includes(expected.exercise)){
                if(!text(q.sentence,400)||q.sentence.split('___').length!==2||!/[א-ת]/.test(q.sentence)||/[<>]/.test(q.sentence))fail();
                // The target answer must be blanked, never already supplied in the stem.
                if(q.sentence.split(/[^א-ת\u0591-\u05C7]+/).some(word=>word&&normalize(word)===normalize(q.answer)))fail();
            }
            if(expected.exercise==='choice'){
                if(!hebrew(q.alternative)||normalize(q.alternative)===normalize(q.answer))fail();
            }
        });
        return checkForms?validateForms(result,request):result;
    }
    return {binyanim,vocabularyKeys,standardInfinitive,exerciseTypes,subject,alternativeTarget,alternativeAnswers,eligibleRoot,eligibleRoots,catalogue,patternModes,binyanLabel,rootTypeLabel,groupLabel,generalGroups,groups,tenses,tenseNames,people,persons,normalize,validPair,validateRequest,plan,validateResult,validateForms};
});
