'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const planner=require('../Penina-Quizzes/builder/vocabulary-plan');
const vocabulary=require('../lib/quiz-vocabulary');
const code=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/builder/vocabulary.js'),'utf8');
function source(){return {rows:Array.from({length:15},(_,i)=>({word:'word'+i,definition:'definition'+i,definitionDistractors:['old definition'+i],wordDistractors:['old word'+i]})),count:15,types:['choice'],wordBank:true,direction:'ltr'};}
function harness(api){
 const elements=new Map(),types=['text','choice','multi','match','gaps','order'].map(value=>({value,checked:false}));
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(selector){return id==='vocabularyPanel'&&selector==='input,textarea,select,button'?[...elements.values()]:id==='vocabularyTypes'?types.filter(t=>selector==='input:checked'?t.checked:true):[];},focus(){this.focused=true;}});return elements.get(id);};
 const state={changes:0,confirmed:[],status:'',error:null};
 const ctx={$,QuizVocabularyPlan:planner,quiz:{title:'My original quiz',questions:[{type:'text',prompt:'Existing question'}],vocabulary:source()},busy:false,connected:true,structuredClone,console,
  esc:v=>String(v).replaceAll('<','&lt;'),changed:()=>{state.changes++;ctx.refreshVocabularyCoverage();},status:message=>state.status=message,confirm:message=>{state.confirmed.push(message);return state.confirm!==false;},api:async(action,body)=>action==='vocabulary-coverage'?{coverage:state.coverage??planner.analyze(body,body.existingQuestions)}:api(action,body),
  run:async fn=>{if(ctx.busy)return;ctx.busy=true;ctx.vocabularyButtons();try{await fn();}catch(e){state.error=e.message;}finally{ctx.busy=false;ctx.vocabularyButtons();}},render:()=>ctx.renderVocabulary()};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,$,state};
}
test('Generating 15 questions appends exactly 15 only after all batches succeed and keeps the title',async()=>{
 let calls=0;const h=harness(async(action,body)=>{assert.equal(action,'vocabulary-questions');assert.equal(h.ctx.quiz.questions.length,1);assert.equal(h.$('vocabularyGenerate').disabled,true);calls++;return {questions:Array.from({length:Math.min(10,body.count-body.offset)},(_,i)=>({type:'choice',prompt:'Generated '+(body.offset+i)}))};});
 await h.$('vocabularyGenerate').onclick();assert.equal(calls,2);assert.equal(h.ctx.quiz.questions.length,16);assert.equal(h.ctx.quiz.title,'My original quiz');assert.equal(h.ctx.quiz.questions[0].prompt,'Existing question');assert.equal(h.$('vocabularyGenerate').disabled,false);assert.match(h.state.status,/15 editable/);
});
test('A failed second question batch preserves the complete original draft',async()=>{
 const h=harness(async(_,body)=>{if(body.offset)throw Error('Service unavailable');return {questions:Array(10).fill({prompt:'temporary'})};});
 const before=JSON.stringify(h.ctx.quiz);await h.$('vocabularyGenerate').onclick();assert.equal(JSON.stringify(h.ctx.quiz),before);assert.equal(h.state.error,'Service unavailable');assert.equal(h.$('vocabularyGenerate').disabled,false);
});
test('Whole-table regeneration is atomic and row regeneration preserves every other row',async()=>{
 const h=harness(async(_,body)=>{if(body.indices[0]===10)throw Error('Try again');return {rows:body.rows.map((r,i)=>body.indices.includes(i)?{...r,definitionDistractors:['new definition']}:r)};});
 const before=JSON.stringify(h.ctx.quiz.vocabulary);await h.ctx.regenerateVocabulary();assert.equal(JSON.stringify(h.ctx.quiz.vocabulary),before);
 await h.ctx.regenerateVocabulary(2);assert.deepEqual(h.ctx.quiz.vocabulary.rows[2].definitionDistractors,['new definition']);assert.equal(h.ctx.quiz.vocabulary.rows[3].wordDistractors[0],'old word3');assert.equal(h.ctx.quiz.vocabulary.rows[2].definition,'definition2');
});
test('Cancelling regeneration retains manual edits and makes no provider request',async()=>{
 const h=harness(async()=>assert.fail('No request expected'));h.state.confirm=false;
 const before=JSON.stringify(h.ctx.quiz);await h.ctx.regenerateVocabulary(3);assert.equal(JSON.stringify(h.ctx.quiz),before);
});
test('Published quizzes and full drafts cannot generate extra questions',async()=>{
 const h=harness(async()=>assert.fail('No request expected'));h.ctx.quiz.published=true;await h.$('vocabularyGenerate').onclick();assert.equal(h.ctx.quiz.questions.length,1);
 h.ctx.quiz.published=false;h.ctx.quiz.questions=Array(100).fill({type:'text',prompt:'Existing question'});await h.$('vocabularyGenerate').onclick();assert.match(h.state.error,/100 questions/);
});
test('Import failure retains the previous table and imported strings are escaped in its markup',async()=>{
 const h=harness(async()=>{throw Error('Two columns required');});const before=JSON.stringify(h.ctx.quiz.vocabulary);
 await h.$('vocabularyImport').onclick();assert.equal(JSON.stringify(h.ctx.quiz.vocabulary),before);
 h.ctx.quiz.vocabulary.rows[0].word='<img src=x>';h.ctx.renderVocabulary();assert(!h.$('vocabularyRows').innerHTML.includes('<img'));assert(h.$('vocabularyRows').innerHTML.includes('&lt;img'));
});
test('Settings and table edits are included in the next generation request',async()=>{
 let sent;const h=harness(async(_,body)=>{sent=body;return {questions:[{type:'text',prompt:'generated'}]};});
 h.$('vocabularyAutomatic').checked=false;h.$('vocabularyCount').value='1';h.$('vocabularyDirection').value='rtl';h.$('vocabularyBank').checked=false;
 for(const el of h.$('vocabularyTypes').querySelectorAll('input'))el.checked=el.value==='text';h.$('vocabularyCount').listeners.change();
 h.$('vocabularyRows').listeners.input({target:{dataset:{vocabField:'definitionDistractors'},value:'manual one\nmanual two',closest:()=>({dataset:{vocabRow:'0'}})}});
 await h.$('vocabularyGenerate').onclick();assert.equal(sent.count,1);assert.equal(sent.direction,'rtl');assert.equal(sent.wordBank,true);assert.deepEqual(Array.from(sent.types),['text']);assert.deepEqual(Array.from(sent.rows[0].definitionDistractors),['manual one','manual two']);
});

test('A count that needs repeats is blocked without changing the draft',async()=>{
 const h=harness(async()=>assert.fail('No duplicate questions should be requested'));
 h.ctx.quiz.vocabulary.autoCount=false;h.ctx.quiz.vocabulary.count=16;h.ctx.refreshVocabularyCoverage();
 assert.equal(h.$('vocabularyGenerate').disabled,true);
 assert.match(h.$('vocabularyCoverage').textContent,/suggested 15/);
 const before=JSON.stringify(h.ctx.quiz);await h.$('vocabularyGenerate').onclick();assert.equal(JSON.stringify(h.ctx.quiz),before);
 assert.match(h.state.error,/each word once/);assert.equal(h.state.confirmed.length,0);
});
test('Typing a custom count immediately refreshes coverage and disables invalid generation',()=>{
 const h=harness(async()=>assert.fail('No request expected'));
 h.$('vocabularyAutomatic').checked=false;h.$('vocabularyAutomatic').listeners.change();
 h.$('vocabularyCount').value='16';h.$('vocabularyCount').listeners.input();
 assert.equal(h.ctx.quiz.vocabulary.count,16);assert.equal(h.$('vocabularyGenerate').disabled,true);
 h.$('vocabularyCount').value='10';h.$('vocabularyCount').listeners.input();
 assert.equal(h.ctx.quiz.vocabulary.count,10);assert.equal(h.$('vocabularyGenerate').disabled,false);assert.match(h.$('vocabularyCoverage').textContent,/10 new questions/);
 h.$('vocabularyCount').value='';h.$('vocabularyCount').listeners.input();assert.equal(h.$('vocabularyGenerate').disabled,true);
});
test('Suggested count updates with formats and previously tested words',()=>{
 const h=harness(async()=>({}));
 assert.equal(h.$('vocabularyCount').value,15);assert.equal(h.$('vocabularyCount').readOnly,true);
 h.ctx.quiz.vocabulary.types=['choice','match','gaps'];h.ctx.renderVocabulary();
 assert.equal(h.$('vocabularyCount').value,5);assert.match(h.$('vocabularyCoverage').textContent,/15 of 15/);
 h.ctx.quiz.questions.push({type:'text',prompt:'Translate word0',answer:'definition0'});h.ctx.changed();
 assert.match(h.$('vocabularyCoverage').textContent,/1 words already tested/);
 assert.match(h.$('vocabularyWordCoverage').innerHTML,/already in question 2/);
 h.ctx.quiz.vocabulary.autoCount=false;h.ctx.quiz.vocabulary.count=15;h.ctx.renderVocabulary();
 assert.equal(h.$('vocabularyUseSuggestion').hidden,false);
 h.$('vocabularyUseSuggestion').onclick();assert.equal(h.ctx.quiz.vocabulary.autoCount,true);assert.equal(h.$('vocabularyCount').readOnly,true);
});

test('Additional correct answers are editable separately from distractors',()=>{
 const h=harness(async()=>({}));
 assert.match(h.$('vocabularyRows').innerHTML,/Additional correct answers/);
 h.$('vocabularyRows').listeners.input({target:{dataset:{vocabField:'additionalAnswers'},value:'valid one\nvalid two',closest:()=>({dataset:{vocabRow:'0'}})}});
 assert.deepEqual(Array.from(h.ctx.quiz.vocabulary.rows[0].additionalAnswers),['valid one','valid two']);
 assert.deepEqual(Array.from(h.ctx.quiz.vocabulary.rows[0].definitionDistractors),['old definition0']);
});

test('Generate missing targets only empty rows and preserves reviewed distractors',async()=>{
 const h=harness(async(action,body)=>{assert.equal(action,'vocabulary-distractors');assert.deepEqual(Array.from(body.indices),[1]);const rows=structuredClone(body.rows);rows[1].definitionDistractors=['new'];return {rows};});
 h.ctx.quiz.vocabulary.rows[1].definitionDistractors=[];
 await h.$('vocabularyMissing').onclick();
 assert.equal(h.state.confirmed.length,0);assert.deepEqual(Array.from(h.ctx.quiz.vocabulary.rows[0].definitionDistractors),['old definition0']);assert.deepEqual(Array.from(h.ctx.quiz.vocabulary.rows[1].definitionDistractors),['new']);
});
test('Saved-list conflicts block replacement until resolved; import preserves choices and questions',async()=>{
 const h=harness(async action=>{assert.equal(action,'import-vocabulary-library');return {rows:[{word:'שלום',definition:'peace',definitionDistractors:['chair'],wordDistractors:[]}],conflicts:[{index:0,word:'שלום',definitions:['peace','hello']}],warnings:[]};});
 h.$('vocabularyLibrary').querySelectorAll=()=>[{value:'my-list'}];
 const select={value:'',dataset:{vocabConflict:'0'}};
 h.$('vocabularyConflicts').querySelectorAll=()=>[select];
 await h.$('vocabularyLibraryImport').onclick();
 await h.$('vocabularyLibraryApply').onclick();assert.match(h.state.error,/every conflicting/);assert.equal(h.ctx.quiz.vocabulary.rows.length,15);
 select.value='1';await h.$('vocabularyLibraryApply').onclick();
 assert.equal(h.ctx.quiz.vocabulary.rows[0].definition,'hello');assert.deepEqual(Array.from(h.ctx.quiz.vocabulary.rows[0].definitionDistractors),['chair']);assert.equal(h.ctx.quiz.questions.length,1);
});

function useRealVocabulary(h,n=15){
 h.ctx.quiz.vocabulary={rows:Array.from({length:n},(_,i)=>({word:'מילה'+i,definition:'meaning'+i,definitionDistractors:['wrong'+i]})),types:['choice'],autoCount:true,count:15};
 h.ctx.renderVocabulary();
}
test('Repeated Generate clicks cannot append duplicates, including after changing formats',async()=>{
 let calls=0;const h=harness(async(_,body)=>{calls++;return {questions:await vocabulary.questions(body)};});useRealVocabulary(h);
 await h.$('vocabularyGenerate').onclick();assert.equal(h.state.error,null);assert.equal(calls,2);assert.equal(h.ctx.quiz.questions.length,16);
 assert.equal(h.$('vocabularyGenerate').disabled,true);assert.match(h.$('vocabularyCoverage').textContent,/already tested/);
 const before=JSON.stringify(h.ctx.quiz);await h.$('vocabularyGenerate').onclick();assert.equal(JSON.stringify(h.ctx.quiz),before);assert.equal(calls,2);
 h.ctx.quiz.vocabulary.types=['text'];h.ctx.renderVocabulary();await h.$('vocabularyGenerate').onclick();assert.equal(calls,2);
 h.ctx.quiz.questions.pop();h.ctx.renderVocabulary();assert.equal(h.$('vocabularyCount').value,1);
 await h.$('vocabularyGenerate').onclick();assert.equal(calls,3);assert.equal(h.ctx.quiz.questions.length,16);
});
test('Replacement keeps manual questions and their checkpoint, and excludes them from new coverage',async()=>{
 const h=harness(async(_,body)=>({questions:await vocabulary.questions(body)}));useRealVocabulary(h);
 await h.$('vocabularyGenerate').onclick();
 const manual={type:'text',prompt:'Explain מילה0.',answer:'meaning0',points:1,image:{src:'private image'}};
 h.ctx.quiz.questions.push(manual);h.ctx.quiz.forwardOnlyFrom=16;
 h.$('vocabularyMode').value='replace';h.$('vocabularyMode').listeners.change();
 assert.equal(h.$('vocabularyCount').value,14);assert.match(h.$('vocabularyCoverage').textContent,/15 generated questions will be replaced/);
 await h.$('vocabularyGenerate').onclick();assert.equal(h.state.error,null);
 assert.equal(h.ctx.quiz.questions.length,16);assert.equal(h.ctx.quiz.questions[1],manual);assert.equal(h.ctx.quiz.forwardOnlyFrom,1);
 assert(h.ctx.quiz.questions.slice(2).every(q=>q.vocabularyTerms[0].word!=='מילה0'));
 assert.equal(h.state.confirmed.length,1);assert(!('image' in h.ctx.vocabularyGenerationContext().existingQuestions[1]));
});
test('Cancelled or failed replacement leaves original questions and checkpoint intact',async()=>{
 let fail=false;const h=harness(async(_,body)=>{if(fail && body.offset)throw Error('Batch failed');return {questions:await vocabulary.questions(body)};});useRealVocabulary(h);
 await h.$('vocabularyGenerate').onclick();h.ctx.quiz.forwardOnlyFrom=3;
 h.$('vocabularyMode').value='replace';h.$('vocabularyMode').listeners.change();
 const before=JSON.stringify(h.ctx.quiz);h.state.confirm=false;await h.$('vocabularyGenerate').onclick();assert.equal(JSON.stringify(h.ctx.quiz),before);
 h.state.confirm=true;fail=true;await h.$('vocabularyGenerate').onclick();assert.equal(h.state.error,'Batch failed');assert.equal(JSON.stringify(h.ctx.quiz),before);
 fail=false;await h.$('vocabularyGenerate').onclick();assert.equal(h.ctx.quiz.forwardOnlyFrom,null);
});
