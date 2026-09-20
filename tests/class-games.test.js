const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {scheduleClassTerms,makeClassGames}=require('../PeninaPlus-vocab-builder/offline-study-cards');
const pool=(set,date,count)=>Array.from({length:count},(_,i)=>({id:set+i,term:set+i,studySet:set,studyDate:date}));
for(const count of [1,2,3])test(`${count} latest sets get ${count*3} questions before each older question`,()=>{
 const input=[...Array.from({length:count},(_,i)=>pool('new'+i,'2026-09-20',5)).flat(),...pool('old','2026-09-19',4)];
 const before=JSON.stringify(input),deck=scheduleClassTerms(input,()=>0.5),stride=count*3+1;
 assert.equal(deck.length%stride,0);
 for(let i=0;i<deck.length;i+=stride){
  const recent=deck.slice(i,i+stride-1);
  for(let set=0;set<count;set++)assert.equal(recent.filter(row=>row.studySet==='new'+set).length,3);
  assert.equal(deck[i+stride-1].studySet,'old');
 }
 assert.equal(new Set(deck.map(row=>row.id)).size,deck.length);
 for(const row of input)assert(deck.some(item=>item.term===row.term));
 assert.equal(JSON.stringify(input),before);
});
test('Only newest sets: every term appears once without unnecessary repeats; empty classes are safe',()=>{
 const rows=[...pool('one','2026-09-20',2),...pool('two','2026-09-20',3)];
 assert.equal(scheduleClassTerms(rows).length,5);
 assert.deepEqual(scheduleClassTerms([]),[]);
});
test('A small newest set repeats as needed and the entire older pool is reviewed',()=>{
 const deck=scheduleClassTerms([...pool('new','2026-09-20',1),...pool('old','2026-09-19',10)]);
 assert.equal(deck.length,40);assert.equal(deck.filter(row=>row.studySet==='new').length,30);
 assert.equal(new Set(deck.filter(row=>row.studySet==='old').map(row=>row.term)).size,10);
});
test('Class games embed a self-contained scheduler and have no per-set flashcard interface',()=>{
 const card={term:'סוס',english:'horse',studySet:'new',studyDate:'2026-09-20',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['cow','dog','cat','bird']}}};
 const html=makeClassGames('Class',[card],{homeUrl:'/class'});
 assert(html.includes('id="gamesDialog"'));assert(!html.includes('id="card"'));
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert(html.includes('scheduleClassTerms'));
});
