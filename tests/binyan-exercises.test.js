const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const {render}=require('../PeninaPlus-Binyan-Builder/exercises');
const {verifyWorksheet}=require('../lib/binyan-dicta');
const input={mode:'practice',vocabulary:{verbs:['כתב'],binyanim:['פעל שלם|הווה']},pairs:['פעל שלם|הווה'],count:10,exercises:Object.keys(core.exerciseTypes)};
function fixture(){
 const request=core.validateRequest(input), forms={masculine_singular:'כּוֹתֵב',feminine_singular:'כּוֹתֶבֶת',masculine_plural:'כּוֹתְבִים',feminine_plural:'כּוֹתְבוֹת'};
 return {request,lessons:[],questions:core.plan(request).map(q=>({...q,root:'כתב',meaning:'to write',hint:'Check the subject and ending.',answer:forms[q.person],sentence:['sentence','writing'].includes(q.exercise)?`${core.subject(q.person)} ___ בַּמַּחְבֶּרֶת.`:'',alternative:q.exercise==='choice'?forms[core.alternativeTarget(q).person]:''}))};
}
test('mixed plans cover every exercise while preserving each pair/person assignment',()=>{
 const request=core.validateRequest(input),plan=core.plan(request);
 assert.deepEqual([...new Set(plan.map(q=>q.exercise))],input.exercises);
 assert.equal(plan.filter(q=>q.exercise==='writing').length,2);
 assert.equal(core.validateRequest({...input,exercises:undefined}).exercises[0],'conjugate');
 for(const exercises of [[],['made-up'],['sentence','sentence']])assert.throws(()=>core.validateRequest({...input,exercises}),/exercise type/);
 const f=fixture();core.validateResult(f,f.request);
});
test('missing blanks, leaked answers, duplicate choices and wrong exercise types are rejected',()=>{
 for(const mutate of [f=>f.questions.find(q=>q.exercise==='sentence').sentence='הוּא כּוֹתֵב.',f=>f.questions.find(q=>q.exercise==='sentence').sentence='___ ___',f=>{const q=f.questions.find(q=>q.exercise==='sentence');q.sentence=`הוּא ___ ${q.answer}.`;},f=>f.questions[0].alternative=f.questions[0].answer,f=>f.questions[0].exercise='writing']){
  const f=fixture();mutate(f);assert.throws(()=>core.validateResult(f,f.request),/checks/);
 }
});
test('student rendering hides writing examples; key labels them',()=>{
 const f=fixture(),student=render(f.questions),key=render(f.questions,{key:true});
 assert.equal((student.match(/class="exercise-section"/g)||[]).length,4);
 assert.doesNotMatch(student,/word.bank/i);assert.match(student,/writing-lines/);assert.doesNotMatch(student,/Example only/);
 assert.match(key,/Example only/);assert.doesNotMatch(key,/sentence-blank/);
 const writing=render(f.questions.filter(q=>q.exercise==='writing'));
 assert.doesNotMatch(writing,/מַּחְבֶּרֶת/);
 assert.match(student,/Circle the form/);assert.match(student,/subject, gender, number and tense/);
});
test('rendering escapes imported text and does not mark the correct choice',()=>{
 const f=fixture();f.questions[0].alternative='<img src=x onerror=alert(1)>';
 const html=render(f.questions);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/data-correct/);
});
test('Dicta also receives alternate forms and refuses unchecked choice distractors',async()=>{
 const f=fixture(),q=f.questions[0];
 await assert.rejects(verifyWorksheet({lessons:[],questions:[q]},f.request,async text=>{
  assert.ok(text.includes(q.answer));assert.ok(text.includes(q.alternative));throw Error('expected verification');
 }),/expected verification/);
 const alternative=core.alternativeTarget({pair:'פעל ל-ה|שם הפועל',person:'form'});
 assert.deepEqual(alternative,{pair:'פעל ל-ה|עבר',person:'third_m_sg'});
});
