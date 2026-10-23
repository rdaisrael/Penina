'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=require('../lib/quiz-builder-model');
const student=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/quiz.js'),'utf8');
function restore(q,saved){
 const controls=q.choices.map((value,i)=>({type:'checkbox',name:'q0-choice-'+i,value,checked:false}));
 const context={questions:[q],saved,form:{querySelectorAll:()=>controls,elements:{namedItem(){}}}};
 vm.createContext(context);vm.runInContext(student.slice(student.indexOf('function restoreAnswers()'),student.indexOf('function answer(')),context);context.restoreAnswers();
 return controls.filter(c=>c.checked).map(c=>c.value);
}
test('A pre-update in-progress checkbox answer restores the same words and score',()=>{
 const q={type:'multi',prompt:'Animals',points:1,choices:['dog','car','cat'],answer:['dog','cat']};
 const selected=restore(model.publicQuestions({questions:[q]})[0],{values:{'q0-choice-0':true,'q0-choice-1':false,'q0-choice-2':true}});
 assert.deepEqual(selected,['dog','cat']);assert.equal(model.grade({questions:[q]},[selected]).total,1);
});
test('New answer values override old positional flags even if choice order changes',()=>{
 const selected=restore({type:'multi',choices:['car','cat','dog']},{answers:[['dog','cat']],values:{'q0-choice-0':true,'q0-choice-1':false,'q0-choice-2':true}});
 assert.deepEqual(selected,['cat','dog']);
 assert.deepEqual(restore({type:'multi',choices:['car','cat']},{answers:[[]],values:{'q0-choice-0':true}}),[]);
});
function previewContext(memory,key,saved){
 const context={previewQuiz:{durationMinutes:1},previewKey:key,saved,lockedThrough:-1,forwardOnly:false,Date,sessionStorage:{setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)},localStorage:{setItem:()=>assert.fail('Preview must not write student storage')},fetch:()=>assert.fail('Preview must not call server')};
 vm.createContext(context);
 vm.runInContext(student.slice(student.indexOf('function store()'),student.indexOf('function snapshot()')),context);
 vm.runInContext(student.slice(student.indexOf('async function request('),student.indexOf('function navigate(')),context);
 return context;
}
test('Preview retains answers, page, deadline, and locks across reload without sharing state with another preview',async()=>{
 const memory=new Map(),deadline=Date.now()+60000;
 const saved={page:2,answers:[['cat'],['dog']],values:{'q0-0':'cat'},attempt:{id:'preview',deadline}};
 const first=previewContext(memory,'preview-one',saved);await first.request({action:'advance',through:1,answers:saved.answers});first.store();
 const restored=JSON.parse(memory.get('preview-one:progress')),reloaded=previewContext(memory,'preview-one',restored),state=await reloaded.request({action:'state'});
 assert.equal(restored.page,2);assert.equal(restored.attempt.deadline,deadline);assert.deepEqual(restored.answers,[['cat'],['dog']]);assert.equal(state.lockedThrough,1);assert.equal(state.forwardOnly,true);assert.deepEqual(state.lockedAnswers,[['cat'],['dog']]);
 const other=previewContext(memory,'preview-two',{page:0});other.store();assert.equal(JSON.parse(memory.get('preview-one:progress')).page,2);assert.equal(JSON.parse(memory.get('preview-two:progress')).page,0);
});
function interactions(){const ctx={document:{createElementNS:()=>({setAttribute(){}})}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/interactions.js'),'utf8')+'\nthis.api=QuizInteractions;',ctx);return ctx.api;}
function node(textContent,value){return {textContent,previousElementSibling:{value},attributes:{},setAttribute(k,v){this.attributes[k]=v;},classList:{toggle(){}},getBoundingClientRect:()=>({left:0,right:10,top:0,height:10})};}
test('Filled and cleared blank and ordering slots expose their answers to assistive technology',()=>{
 const api=interactions(),blank=node('Blank 1','חתול'),order=node('Position 2','second');blank.dataset={label:'Blank 1'};order.dataset={label:'Position 2'};
 const root={querySelectorAll:s=>s==='.drop-slot'?[blank,order]:[]};api.refresh(root);
 assert.equal(blank.attributes['aria-label'],'Blank 1: חתול');assert.equal(order.attributes['aria-label'],'Position 2: second');
 blank.previousElementSibling.value='';api.refresh(root);assert.equal(blank.attributes['aria-label'],'Blank 1: empty');assert.equal(blank.textContent,'Blank 1');
});
test('Matching terms expose the connected definition and return to unmatched when cleared',()=>{
 const api=interactions(),term=node('cat','animal'),definition=node('animal','');definition.dataset={value:'animal'};
 const svg={innerHTML:'',append(){}},board={getBoundingClientRect:()=>({left:0,top:0}),querySelector:()=>svg,querySelectorAll:s=>s==='[data-term]'?[term]:[definition]},root={querySelectorAll:s=>s==='.match-board'?[board]:[]};
 api.refresh(root);assert.equal(term.attributes['aria-label'],'cat — matched to animal');term.previousElementSibling.value='';api.refresh(root);assert.equal(term.attributes['aria-label'],'cat — unmatched');
});
