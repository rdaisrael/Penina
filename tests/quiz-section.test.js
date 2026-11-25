const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../lib/quiz-builder-model'),scoring=require('../Penina-Quizzes/custom/scoring'),print=require('../Penina-Quizzes/builder/print'),email=require('../lib/quiz-correction-email'),vocabulary=require('../lib/quiz-vocabulary');
const image={src:'data:image/png;base64,AAAA',alt:'Section illustration'};
const text={type:'text',prompt:'Explain',points:2,answer:'PRIVATE MODEL'};
const choice={type:'choice',prompt:'Choose',points:3,choices:['Yes','No'],answer:['Yes']};
const section={type:'section',prompt:'Introduction',content:'Read this paragraph.\nThen continue.',image};
const quiz=pages=>({title:'Sections quiz',durationMinutes:null,questions:pages});
test('Section pages accept a title, paragraph, picture, or both; empty drafts remain saveable',()=>{
 for(const page of [section,{type:'section',content:'A paragraph'},{type:'section',image},{type:'section',prompt:'A heading'}]){
  const saved=model.validateQuiz(quiz([page,text]),true).questions[0];
  assert.equal(saved.type,'section');assert.equal(saved.points,0);assert.equal(saved.scoringMode,'total');assert.equal(saved.answer,undefined);
 }
 assert.equal(model.validateQuiz(quiz([{type:'section'}])).questions[0].content,'');
 assert.throws(()=>model.validateQuiz(quiz([{type:'section'},text]),true),/title, paragraph, picture, or teacher recording/);
 assert.throws(()=>model.validateQuiz(quiz([section]),true),/regular question/);
 assert.throws(()=>model.validateQuiz(quiz([section,{...text,extraCredit:true}]),true),/regular question/);
 for(const change of [{content:42},{content:'a'.repeat(10001)},{prompt:'a'.repeat(5001)},{image:{src:'https://example.test/x.png',alt:''}}])assert.throws(()=>model.validateQuiz(quiz([{...section,...change},text]),true));
});
test('Section pages cannot carry points, bonus points, answer keys, or student answers',()=>{
 const draft=quiz([{...section,points:500,extraCredit:true,scoringMode:'response',potentialPoints:600,answer:'PRIVATE'},text]);
 const saved=model.validateQuiz(draft,true),page=saved.questions[0],safe=model.publicQuestions(saved)[0];
 assert.equal(page.points,0);assert.equal(page.extraCredit,false);assert.equal(scoring.maxPoints(draft.questions[0]),0);assert.equal(scoring.responseCount(page),0);assert.equal(scoring.score(page,[]),0);
 assert.equal(safe.content,section.content);assert.equal(safe.image.src,image.src);assert.equal(safe.maxPoints,0);assert.equal(safe.responseCount,0);assert.equal(safe.answer,undefined);
 assert(model.validAnswers(saved,[[],['answer']]));assert(model.validAnswers(saved,[[],['']],true));
 for(const answers of [[['fake'],['answer']],[['answer']],['',['answer']]])assert(!model.validAnswers(saved,answers,true));
});
test('Grading, corrections, overrides, feedback, and summaries retain raw indexes but exclude section pages',()=>{
 const q=model.validateQuiz(quiz([section,text,section,choice]),true),answers=[[],['answer'],[],['Yes']];
 const pending=model.grade(q,answers);assert.equal(pending.pending,1);assert.equal(pending.baseMax,5);assert.deepEqual(pending.manual.map(q=>q.index),[1]);assert.deepEqual(pending.automatic.map(q=>q.index),[3]);
 assert(model.validCorrections(q,[2]));assert(!model.validCorrections(q,[0,2]));
 assert(!model.validOverrides({0:1},pending.automatic,{},pending.manual));
 const graded=model.grade(q,answers,{scores:[2],overrides:{3:1},explanations:{3:'Review this answer.'}});assert.equal(graded.total,3);
 assert.deepEqual(model.summarize(q,[{grading:graded}]).map(q=>q.index),[1,3]);assert.deepEqual(scoring.feedback(q.questions,answers,true).map(q=>q.index),[3]);
});
test('Printed and corrected copies preserve section text without adding question numbers or scores',()=>{
 const q=model.validateQuiz(quiz([{...section,prompt:'<Title>',content:'Line one\n<script>not code</script>'},text,section,choice]),true),answers=[[],['answer'],[],['Yes']];
 const paper=print.render(q);assert.match(paper,/2 questions/);assert.match(paper,/5 points/);assert.equal((paper.match(/class="qp-section-page"/g)||[]).length,2);assert.match(paper,/aria-label="Question 2"/);assert.doesNotMatch(paper,/Question 3|PRIVATE|<script>/);assert.match(paper,/&lt;Title&gt;/);assert.match(paper,/data:image\/png/);
 const corrected=email.correctedTest({record:{name:'Student',answers},questions:q.questions,grading:model.grade(q,answers,{scores:[2]}),title:q.title});
 assert.match(corrected.text,/Question 1: Explain/);assert.match(corrected.text,/Question 2: Choose/);assert.doesNotMatch(corrected.text,/Question 3|PRIVATE/);assert.match(corrected.html,/&lt;script&gt;/);assert.doesNotMatch(corrected.html,/<script>/);
});
test('Section headings never count as vocabulary tested or block adding generated questions',()=>{
 const config={rows:[{word:'house',definition:'בית',definitionDistractors:[],wordDistractors:[]}],types:['text'],autoCount:true,existingQuestions:[{type:'section',prompt:'house'},{...text,prompt:'Other question'}]};
 const plan=vocabulary.plan(config);assert.equal(plan.entries.length,1);assert.deepEqual(plan.coverage.words[0].existingQuestions,[]);assert.deepEqual(plan.coverage.words[0].newQuestions,[2]);
});
