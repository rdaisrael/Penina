'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {practiceRows}=require('../PeninaPlus-vocab-builder/offline-study-cards');
const {validateRows,parseTable}=require('../lib/quiz-vocabulary');
const code=fs.readFileSync(require.resolve('../lib/quiz-vocabulary-library'),'utf8');
function harness(){
 const state={reads:[],prefixes:[],pages:[{id:'mine',name:'My class'}],blobs:[],html:''};
 const module={exports:{}};
 vm.runInNewContext(code,{module,Buffer,require:n=>n==='./study-sets'?require('../lib/study-sets'):n==='@vercel/blob'?{list:async({prefix})=>{state.prefixes.push(prefix);return {blobs:state.blobs};}}:n==='./vocabulary-pages'?{listPages:async id=>{assert.equal(id,7);return state.pages;}}:n==='./quiz-vocabulary'?{validateRows}:{practiceRows},fetch:async url=>{state.reads.push(url);return {ok:true,text:async()=>state.html};}});
 return {state,...module.exports};
}
const card=(term='שלום',definition='peace')=>({term,english:definition,alternativeAnswers:{english:{term,definition,answers:['chair','window','door','book']}}});
test('Saved Gamify distractors survive import; stale choices are omitted and reported',()=>{
 const h=harness(),a=card(),b=card('אור','light');b.english='brightness';
 const result=h.mergeCards([{title:'One',cards:[a,b]}]);
 assert.deepEqual(Array.from(result.rows[0].definitionDistractors),a.alternativeAnswers.english.answers);
 assert.equal(result.rows[1].definitionDistractors.length,0);assert.equal(result.warnings.length,1);
});
test('Duplicate words merge; conflicting definitions require review and cannot be distractors',()=>{
 const h=harness(),a=card(),b=card('שלום','chair');
 const result=h.mergeCards([{title:'One',cards:[a,a]},{title:'Two',cards:[b]}]);
 assert.equal(result.rows.length,1);assert.equal(result.conflicts.length,1);
 assert.deepEqual(Array.from(result.conflicts[0].definitions),['peace','chair']);
 assert(!result.rows[0].definitionDistractors.includes('chair'));
});
test('English terms use Hebrew definitions, missing definitions are reported, and limits are enforced',()=>{
 const h=harness();const result=h.mergeCards([{title:'One',cards:[{term:'light',hebrew:'אור'}, {term:'חסר',english:'N'}]}]);
 assert.equal(result.rows[0].definition,'אור');assert.equal(result.warnings.length,1);
 assert.throws(()=>h.mergeCards([{title:'Too many',cards:Array.from({length:51},(_,i)=>({term:'word'+i,hebrew:'אור'}))}]),/50/);
});
test('Only lists on the signed-in teacher’s webpages can be imported; unknown paths never fetch',async()=>{
 const h=harness();h.state.blobs=[{pathname:'vocabulary-cards/mine/now--VGVzdA.html',url:'https://storage.test/known'}];
 h.state.html='<script id="peninaCardData" type="application/json">'+JSON.stringify([card()])+'</script>';
 const listed=await h.handle({userId:7},{action:'vocabulary-library'});
 assert.equal(listed.sets[0].title,'Test');assert.equal(listed.sets[0].url,undefined);
 await assert.rejects(h.handle({userId:7},{action:'import-vocabulary-library',pathnames:['vocabulary-cards/other/no.html']}),/does not belong/);
 assert.equal(h.state.reads.length,0);
 const imported=await h.handle({userId:7},{action:'import-vocabulary-library',pathnames:[listed.sets[0].pathname]});
 assert.equal(imported.rows[0].word,'שלום');assert.deepEqual(h.state.reads,['https://storage.test/known']);
 await assert.rejects(h.handle({},{action:'vocabulary-library'}),/registered teacher/);
});
test('Downloadable CSV template imports directly',()=>{
 const rows=parseTable(fs.readFileSync(require.resolve('../Penina-Quizzes/builder/quiz-vocabulary-template.csv'),'utf8'));
 assert.equal(rows.length,2);assert.equal(rows[0].word,'שלום');
});
