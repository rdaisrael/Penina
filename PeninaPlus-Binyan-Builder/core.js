(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BinyanBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const generalGroups = [];
    const groups = ['פעל שלם','פעל ל-ה'];
    const binyanLabel = () => 'קל (פעל)';
    const rootTypeLabel = group => group==='פעל ל-ה'?'ל״ה — Lamed hey':'Regular — שלם';
    const groupLabel = group => `${binyanLabel(group)} · ${rootTypeLabel(group)}`;
    const tenses = ['עבר','הווה','עתיד','שם הפועל','ציווי'];
    const tenseNames = ['Past','Present','Future','Infinitive','Imperative'];
    const exerciseTypes = {
        choice:'Circle the correct form', conjugate:'Conjugate for a pronoun',
        sentence:'Complete the sentence', writing:'Write your own sentence'
    };
    const subjectLabels = {masculine_singular:'הוא',feminine_singular:'היא',masculine_plural:'הם',feminine_plural:'הן'};
    const people = {
        first_sg:'אני', second_m_sg:'אתה', second_f_sg:'את', third_m_sg:'הוא', third_f_sg:'היא',
        first_pl:'אנחנו', second_m_pl:'אתם', second_f_pl:'אתן', third_m_pl:'הם', third_f_pl:'הן',
        masculine_singular:'זכר יחיד', feminine_singular:'נקבה יחידה', masculine_plural:'זכר רבים', feminine_plural:'נקבה רבות', form:'צורה'
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
        return !rest.length && groups.includes(group) && tenses.includes(tense);
    }
    // Classroom scope: exclude other weak-root groups; gutturals and הלך/אכל
    // remain eligible, with each actual conjugation independently verified.
    function eligibleRoot(root, pair) {
        root=normalize(root);
        if(root.length!==3 || !validPair(pair))return false;
        if(pair.startsWith('פעל ל-ה|'))return root.endsWith('ה') && !['היה','חיה'].includes(root);
        return !root.endsWith('ה') && !/^[ני]/.test(root) && !/[וי]/.test(root[1]);
    }
    function validateRequest(input) {
        const fail = message => {throw new Error(message);};
        if(!input || !['learn','practice'].includes(input.mode))fail('Choose Learn or Practice.');
        const {mode, vocabulary:v, pairs, count}=input;
        const exercises=input.exercises===undefined?['conjugate']:input.exercises;
        if(!Array.isArray(exercises)||!exercises.length||exercises.some(x=>!Object.hasOwn(exerciseTypes,x))||new Set(exercises).size!==exercises.length)fail('Choose at least one exercise type.');
        if(!v || !Array.isArray(v.verbs) || !v.verbs.length || v.verbs.length>500)fail('Upload a Reader spreadsheet containing 1–500 mastered roots.');
        if(v.verbs.some(x=>typeof x!=='string'||x.length>30||!/^[א-ת\u0591-\u05C7 .־״"׳'-]+$/.test(x)||normalize(x).length<2||normalize(x).length>4))fail('Roots must contain two to four Hebrew letters. Check column A.');
        if(!Array.isArray(v.binyanim)||v.binyanim.length>100||v.binyanim.some(x=>typeof x!=='string'||x.length>80))fail('Invalid learned combinations in the spreadsheet.');
        if(!Array.isArray(pairs)||!pairs.length||pairs.length>8||pairs.some(x=>!validPair(x))||new Set(pairs).size!==pairs.length)fail('Select 1–8 different binyan and tense combinations.');
        if(mode==='practice' && pairs.some(x=>!v.binyanim.includes(x)))fail('Practice can only use combinations marked X in the uploaded spreadsheet.');
        if(!Number.isInteger(count)||count<6||count>30||count<pairs.length)fail('Choose 6–30 questions, with at least one per selected combination.');
        return {mode,vocabulary:{verbs:[...new Set(v.verbs.map(normalize))],binyanim:v.binyanim.filter(validPair)},pairs:[...pairs],count,exercises:[...exercises]};
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
        if(q.person==='form')return {pair:q.pair.replace('|שם הפועל','|עבר'),person:'third_m_sg'};
        const person=q.person.endsWith('_singular')?q.person.replace('_singular','_plural'):
            q.person.endsWith('_plural')?q.person.replace('_plural','_singular'):
            q.person.endsWith('_sg')?q.person.replace('_sg','_pl'):q.person.replace('_pl','_sg');
        return {pair:q.pair,person};
    }
    function validateResult(result, request) {
        const fail=()=>{throw new Error('The generated worksheet did not pass its checks. Please try again or choose another combination.');};
        const text=(x,max=1600)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
        const rootOK=x=>typeof x==='string'&&request.vocabulary.verbs.includes(normalize(x));
        const hebrew=x=>text(x,120)&&/[א-ת]/.test(x)&&/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/.test(x)&&!/[a-zA-Z<>]/.test(x);
        if(!result || !Array.isArray(result.lessons)||!Array.isArray(result.questions))fail();
        if(result.lessons.length!==(request.mode==='learn'?request.pairs.length:0))fail();
        result.lessons.forEach((lesson,i)=>{
            if(lesson.pair!==request.pairs[i]||!rootOK(lesson.root)||!eligibleRoot(lesson.root,lesson.pair)||!text(lesson.meaning,150)||!text(lesson.explanation))fail();
            const ps=persons(lesson.pair);
            if(!Array.isArray(lesson.forms)||lesson.forms.length!==ps.length)fail();
            lesson.forms.forEach((row,j)=>{if(row.person!==ps[j]||!hebrew(row.answer))fail();});
        });
        if(result.questions.length!==request.count)fail();
        plan(request).forEach((expected,i)=>{
            const q=result.questions[i];
            if(!q||(q.exercise||'conjugate')!==expected.exercise||q.number!==expected.number||q.pair!==expected.pair||q.person!==expected.person||!rootOK(q.root)||!eligibleRoot(q.root,q.pair)||!hebrew(q.answer)||!text(q.meaning,150)||!text(q.hint,300))fail();
            if(['sentence','writing'].includes(expected.exercise)){
                if(!text(q.sentence,400)||q.sentence.split('___').length!==2||!/[א-ת]/.test(q.sentence)||/[<>]/.test(q.sentence))fail();
                // The target answer must be blanked, never already supplied in the stem.
                if(q.sentence.split(/[^א-ת\u0591-\u05C7]+/).some(word=>word&&normalize(word)===normalize(q.answer)))fail();
            }
            if(expected.exercise==='choice'){
                if(!hebrew(q.alternative)||normalize(q.alternative)===normalize(q.answer))fail();
            }
        });
        return result;
    }
    return {exerciseTypes,subject,alternativeTarget,eligibleRoot,binyanLabel,rootTypeLabel,groupLabel,generalGroups,groups,tenses,tenseNames,people,persons,normalize,validPair,validateRequest,plan,validateResult};
});
