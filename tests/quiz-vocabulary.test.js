'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const v=require('../lib/quiz-vocabulary'),model=require('../lib/quiz-builder-model');
function rows(n=15){return Array.from({length:n},(_,i)=>({word:'מילה'+i,definition:'meaning'+i,definitionDistractors:['wrong meaning '+i+'a','wrong meaning '+i+'b','wrong meaning '+i+'c'],wordDistractors:['decoy'+i+'a','decoy'+i+'b','decoy'+i+'c']}));}
function config(overrides={}){return {rows:rows(),count:15,types:['text','choice','multi','match','gaps','order'],wordBank:true,direction:'ltr',...overrides};}
const sentenceAI=async prompt=>JSON.stringify({sentences:JSON.parse(prompt.split('\nData: ')[1]).map(r=>({index:r.index,sentence:'The context for '+r.definition+' is ___.'}))});
test('CSV/TSV imports preserve quoted commas, multiline definitions, Unicode, BOM and optional headers',()=>{
 assert.deepEqual(v.parseTable('\uFEFFword,definition\r\nlucid,"clear, understandable"\r\nreluctant,"unwilling\nto proceed"').map(r=>[r.word,r.definition]),[['lucid','clear, understandable'],['reluctant','unwilling\nto proceed']]);
 assert.equal(v.parseTable('term\tmeaning\nשָׁלוֹם\tpeace\nאוֹר\tlight')[0].word,'שָׁלוֹם');
 assert.equal(v.parseTable('a,"a ""quote"""\nb,second')[0].definition,'a "quote"');
 for(const input of ['a,one','a,one,extra\nb,two','a,"open\nb,two','a,one\na,two','a,\nb,two','x'.repeat(100001)])assert.throws(()=>v.parseTable(input));
});
test('Draft source permits incomplete added rows but validates bounds, settings and duplicate words',()=>{
 assert.equal(v.source({rows:[{word:'',definition:''}]}).rows.length,1);
 assert.equal(v.source({rows:[]}).count,15);
 for(const input of [{rows:rows(51)},{rows:rows(),count:101},{rows:rows(),types:['bad']},{rows:rows(),types:['text','text']},{rows:[rows()[0],rows()[0]]}])assert.throws(()=>v.source(input));
 assert.throws(()=>v.validateRows([{word:'a',definition:'b',wordDistractors:[' A ']}],1));
});
test('Regeneration updates only requested rows and preserves edited correct definitions',async()=>{
 const original=rows(),before=structuredClone(original);original[3].definition='Teacher-edited meaning';
 let calls=0;
 const generated=await v.distractors({rows:original,indices:[3,7]},async(prompt,options)=>{
  calls++;assert.equal(options.textFormat.strict,true);assert.match(prompt,/Teacher-edited meaning/);
  return JSON.stringify({rows:[3,7].map(index=>({index,definitionDistractors:['new A'+index,'new B'+index,'new C'+index],wordDistractors:['word A'+index,'word B'+index,'word C'+index]}))});
 });
 assert.equal(calls,1);assert.equal(generated[3].definition,'Teacher-edited meaning');assert.deepEqual(generated[4],before[4]);assert.equal(original[3].definitionDistractors[0],before[3].definitionDistractors[0]);
 for(const bad of [{rows:[]},{rows:[{index:3,definitionDistractors:['meaning0','b','c'],wordDistractors:['x','y','z']}]},{rows:[{index:99,definitionDistractors:['a','b','c'],wordDistractors:['x','y','z']}]}])await assert.rejects(v.distractors({rows:original,index:3},async()=>JSON.stringify(bad)));
 await assert.rejects(v.distractors({rows:original,index:-1},async()=>assert.fail('must not call AI')));
 await assert.rejects(v.distractors({rows:original,index:0},async()=>{throw Error('SECRET API KEY');}),error=>error.status===503&&!error.message.includes('SECRET'));
});
test('All selected formats, exact counts, editable banks and grading survive generation',async()=>{
 const c=config({count:23}),all=[];
 for(let offset=0;offset<c.count;offset+=10)all.push(...await v.questions({...c,offset},sentenceAI));
 assert.equal(all.length,23);assert.deepEqual([...new Set(all.map(q=>q.type))],c.types);
 const quiz=model.validateQuiz({title:'Generated',durationMinutes:null,questions:all},true);
 const answers=all.map(q=>q.type==='text'?['A student explanation']:q.answer);
 assert(model.validAnswers(quiz,answers));assert.equal(model.grade(quiz,answers).automaticScore,all.filter(q=>q.type!=='text').length);
 assert.deepEqual(all[1].answer,['meaning1']);assert(all[1].choices.includes('wrong meaning 1a'));
 assert(all[3].choices.includes('wrong meaning 3a'));assert(all[4].choices.includes('wrong meaning 4a'));assert.deepEqual(all[4].answer,['meaning4']);
 assert(model.publicQuestions(quiz).every(q=>!Object.hasOwn(q,'answer')));
});
test('100 questions are generated in bounded batches; selected type count and input bounds are enforced',async()=>{
 const c=config({count:100,types:['choice']}),all=[];
 for(let offset=0;offset<100;offset+=10)all.push(...await v.questions({...c,offset},async()=>assert.fail('no AI needed')));
 assert.equal(all.length,100);
 for(const overrides of [{count:0},{count:101},{count:2},{types:[]},{offset:11},{offset:100},{rows:rows(1)}])await assert.rejects(v.questions(config(overrides),sentenceAI));
});
test('Translation blanks use opposite-language answers without requesting context sentences',async()=>{
 const c=config({count:3,types:['gaps'],wordBank:false,rows:rows().map(r=>({...r,wordDistractors:[],definitionDistractors:[]}))});
 const generated=await v.questions(c,async()=>assert.fail('No context generation needed'));
 assert.equal(generated.length,3);assert.deepEqual(generated[0].choices,[]);assert.deepEqual(generated[0].answer,['meaning0']);assert.equal(generated[0].wordBank,false);
 await assert.rejects(v.questions({...c,wordBank:true}),/distractors/);
});
test('Hebrew terms generate English-only distractors and English terms generate Hebrew-only distractors',async()=>{
 const input=[{word:'שָׁלוֹם',definition:'peace'},{word:'light',definition:'אור'}];
 const result=await v.distractors({rows:input,indices:[0,1]},async(prompt,options)=>{
  assert.match(prompt,/ENGLISH ONLY/);assert.match(prompt,/HEBREW ONLY/);
  assert(!options.textFormat.schema.properties.rows.items.properties.wordDistractors);
  return JSON.stringify({rows:[{index:0,definitionDistractors:['war','noise','darkness']},{index:1,definitionDistractors:['חושך','רעש','מים']}]});
 });
 assert.deepEqual(result[0].definitionDistractors,['war','noise','darkness']);assert.deepEqual(result[1].definitionDistractors,['חושך','רעש','מים']);assert.deepEqual(result[0].wordDistractors,[]);
 await assert.rejects(v.distractors({rows:input,index:0},async()=>JSON.stringify({rows:[{index:0,definitionDistractors:['מלחמה','רעש','חושך']}]})),/English/);
 await assert.rejects(v.distractors({rows:input,index:1},async()=>JSON.stringify({rows:[{index:1,definitionDistractors:['darkness','noise','water']}]})),/Hebrew/);
});
test('Every generated answer bank follows its term language, including mixed lists',async()=>{
 const mixed=[{word:'שלום',definition:'peace',definitionDistractors:['war','noise']},{word:'אור',definition:'light',definitionDistractors:['darkness','water']},{word:'water',definition:'מים',definitionDistractors:['אש','אדמה']},{word:'night',definition:'לילה',definitionDistractors:['יום','בוקר']}];
 for(const type of ['choice','multi','match','gaps','text']){
  const generated=await v.questions(config({rows:mixed,count:4,types:[type]}));
  for(let i=0;i<4;i++){
   const q=generated[i],answers=type==='text'?[q.answer]:q.choices;
   assert(answers.every(a=>i<2?!/[א-ת]/.test(a):/[א-ת]/.test(a)&&!/[a-z]/i.test(a)));
   assert.equal(q.direction,i<2?'ltr':'rtl');
  }
 }
 const bad=structuredClone(mixed);bad[0].definitionDistractors=['מלחמה'];await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/English/);
 bad[0].definitionDistractors=['war'];bad[2].definition='water';await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/Hebrew/);
});
