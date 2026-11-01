const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {scheduleClassTerms,makeClassGames}=require('../PeninaPlus-vocab-builder/offline-study-cards');
const pool=(set,date,count)=>Array.from({length:count},(_,i)=>({id:set+i,term:set+i,studySet:set,studyDate:date}));
test('List weights control frequency independently of list length and cover every term',()=>{
 const input=[...pool('normal','2026-09-20',8).map(x=>({...x,studyWeight:1})),...pool('double','2026-09-19',3).map(x=>({...x,studyWeight:2})),...pool('triple','2026-09-18',2).map(x=>({...x,studyWeight:3}))];
 const before=JSON.stringify(input),deck=scheduleClassTerms(input,()=>0.5);
 assert.equal(deck.length,48);
 assert.equal(deck.filter(x=>x.studySet==='normal').length,8);
 assert.equal(deck.filter(x=>x.studySet==='double').length,16);
 assert.equal(deck.filter(x=>x.studySet==='triple').length,24);
 for(const row of input)assert(deck.some(x=>x.term===row.term));
 assert.equal(new Set(deck.map(x=>x.id)).size,deck.length);
 assert.equal(JSON.stringify(input),before);
});
test('Normal lists receive equal frequency regardless of date; one list needs no repeats',()=>{
 const deck=scheduleClassTerms([...pool('new','2026-09-20',2),...pool('old','2026-09-19',5)]);
 assert.equal(deck.filter(x=>x.studySet==='new').length,5);
 assert.equal(deck.filter(x=>x.studySet==='old').length,5);
 assert.equal(scheduleClassTerms(pool('one','2026-09-20',4).map(x=>({...x,studyWeight:3}))).length,4);
 assert.deepEqual(scheduleClassTerms([]),[]);
});
test('Class games embed a self-contained scheduler and have no per-set flashcard interface',()=>{
 const card={term:'סוס',english:'horse',studySet:'new',studyDate:'2026-09-20',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['cow','dog','cat','bird']}}};
 const html=makeClassGames('Class',[card],{homeUrl:'/class'});
 assert(html.includes('id="gamesDialog"'));assert(!html.includes('id="card"'));
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert(html.includes('scheduleClassTerms'));
});

test('Disabled game types are omitted and disabling every game has a safe empty state',()=>{
 const card={term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['cow','dog','cat','bird']}}};
 const all=['quiz','lines','cards','asteroids','flappy','chomp','snowblaster'];
 for(const id of all){
  const html=makeClassGames('Class',[card],{disabledGames:[id]});
  assert(!html.includes(`data-game="${id}"`));
  for(const other of all.filter(other=>other!==id))assert(html.includes(`data-game="${other}"`));
 }
 const html=makeClassGames('Class',[card],{disabledGames:all});
 assert(!html.includes('id="gamify"'));assert(!html.includes('id="gamesDialog"'));
});

test('Class matching embeds its own leaderboard endpoint',()=>{
 const matchingUrl='/api/game-scores?game=matching&grade=sixth&set=class';
 const html=makeClassGames('Class',[],{matchingUrl});
 const config=JSON.parse(html.match(/<script id="peninaClassConfig" type="application\/json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(config.matchingUrl,matchingUrl);
});
