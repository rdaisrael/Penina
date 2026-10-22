'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/builder/vocabulary.js'),'utf8');
function source(){return {rows:Array.from({length:15},(_,i)=>({word:'word'+i,definition:'definition'+i,definitionDistractors:['old definition'+i],wordDistractors:['old word'+i]})),count:15,types:['choice'],wordBank:true,direction:'ltr'};}
function harness(api){
 const elements=new Map(),types=['text','choice','multi','match','gaps','order'].map(value=>({value,checked:false}));
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(selector){return id==='vocabularyPanel'&&selector==='input,textarea,select,button'?[...elements.values()]:id==='vocabularyTypes'?types.filter(t=>selector==='input:checked'?t.checked:true):[];},focus(){this.focused=true;}});return elements.get(id);};
 const state={changes:0,confirmed:[],status:'',error:null};
 const ctx={$,quiz:{title:'My original quiz',questions:[{type:'text',prompt:'Existing question'}],vocabulary:source()},busy:false,connected:true,structuredClone,console,
  esc:v=>String(v).replaceAll('<','&lt;'),changed:()=>state.changes++,status:message=>state.status=message,confirm:message=>{state.confirmed.push(message);return state.confirm!==false;},api,
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
 h.ctx.quiz.published=false;h.ctx.quiz.questions=Array(95).fill({type:'text'});await h.$('vocabularyGenerate').onclick();assert.match(h.state.error,/100 questions/);
});
test('Import failure retains the previous table and imported strings are escaped in its markup',async()=>{
 const h=harness(async()=>{throw Error('Two columns required');});const before=JSON.stringify(h.ctx.quiz.vocabulary);
 await h.$('vocabularyImport').onclick();assert.equal(JSON.stringify(h.ctx.quiz.vocabulary),before);
 h.ctx.quiz.vocabulary.rows[0].word='<img src=x>';h.ctx.renderVocabulary();assert(!h.$('vocabularyRows').innerHTML.includes('<img'));assert(h.$('vocabularyRows').innerHTML.includes('&lt;img'));
});
test('Settings and table edits are included in the next generation request',async()=>{
 let sent;const h=harness(async(_,body)=>{sent=body;return {questions:[{type:'text',prompt:'generated'}]};});
 h.$('vocabularyCount').value='1';h.$('vocabularyDirection').value='rtl';h.$('vocabularyBank').checked=false;
 for(const el of h.$('vocabularyTypes').querySelectorAll('input'))el.checked=el.value==='text';h.$('vocabularyCount').listeners.change();
 h.$('vocabularyRows').listeners.input({target:{dataset:{vocabField:'definitionDistractors'},value:'manual one\nmanual two',closest:()=>({dataset:{vocabRow:'0'}})}});
 await h.$('vocabularyGenerate').onclick();assert.equal(sent.count,1);assert.equal(sent.direction,'rtl');assert.equal(sent.wordBank,false);assert.deepEqual(Array.from(sent.types),['text']);assert.deepEqual(Array.from(sent.rows[0].definitionDistractors),['manual one','manual two']);
});
