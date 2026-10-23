'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const v=require('../lib/quiz-vocabulary'),model=require('../lib/quiz-builder-model');
function rows(n=15){return Array.from({length:n},(_,i)=>({word:'מילה'+i,definition:'meaning'+i,additionalAnswers:['alternate meaning'+i],definitionDistractors:['wrong meaning '+i+'a','wrong meaning '+i+'b','wrong meaning '+i+'c'],wordDistractors:['decoy'+i+'a','decoy'+i+'b','decoy'+i+'c']}));}
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
 const plans=v.plan(c).entries;assert(all[3].choices.includes('wrong meaning '+plans[3].indices[0]+'a'));assert(all[4].choices.includes('wrong meaning '+plans[4].indices[0]+'a'));assert.deepEqual(all[4].answer,['meaning'+plans[4].indices[0]]);
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
 assert.equal(generated.length,3);assert.deepEqual(generated[0].choices,['meaning0']);assert.deepEqual(generated[0].answer,['meaning0']);assert.equal(generated[0].wordBank,true);
 assert((await v.questions({...c,wordBank:true})).every(q=>q.wordBank));
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
 mixed.forEach((r,i)=>r.additionalAnswers=[i<2?'alternate meaning '+i:'חלופה'+i]);
 for(const type of ['choice','multi','match','gaps','text']){
  const generated=await v.questions(config({rows:mixed,count:4,types:[type]}));
  for(let i=0;i<4;i++){
   const q=generated[i],answers=type==='text'?[q.answer]:q.choices;
   const first=v.plan(config({rows:mixed,count:4,types:[type]})).entries[i].indices[0];
   assert(answers.every(a=>first<2?!/[א-ת]/.test(a):/[א-ת]/.test(a)&&!/[a-z]/i.test(a)));
   assert.equal(q.direction,first<2?'ltr':'rtl');
  }
 }
 const bad=structuredClone(mixed);bad[0].definitionDistractors=['מלחמה'];await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/English/);
 bad[0].definitionDistractors=['war'];bad[2].definition='water';await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/Hebrew/);
});

test('Pasted Hebrew Markdown table retains all ten entries, including the apparent header entry',()=>{
 const pasted=`| דָּבָר שֶׁלֹּא בָּא לָעוֹלָם | something which does not yet exist               |
| ---------------------------: | ------------------------------------------------ |
|              יוֹצֵא - לָצֵאת | fulfills his obligation - to fulfill obligation  |
|                      כֵּלִים | objects                                          |
|                      מַקְנֶה | initiate agreement (verb) / sell (verb)          |
|       מֵתָה מֵחֲמַת מְלָאכָה | Died doing its normal work / being used normally |
|           נְפַק / לַאֲפוּקָה | go out / take out                                |
|                   פִּקָּדוֹן | A deposit (of an object/animal with a Shomer)    |
|                   פְּשִׁיעָה | Negligent / doing less than the minimum required |
|                     קָשְׁיָא | Objection/Attack                                 |
|                      תֵּרוּץ | Solution / defense                               |`;
 const result=v.parseTable(pasted);
 assert.equal(result.length,10);
 assert.deepEqual(result.map(r=>[r.word,r.definition]),[
  ['דָּבָר שֶׁלֹּא בָּא לָעוֹלָם','something which does not yet exist'],
  ['יוֹצֵא - לָצֵאת','fulfills his obligation - to fulfill obligation'],
  ['כֵּלִים','objects'],['מַקְנֶה','initiate agreement (verb) / sell (verb)'],
  ['מֵתָה מֵחֲמַת מְלָאכָה','Died doing its normal work / being used normally'],
  ['נְפַק / לַאֲפוּקָה','go out / take out'],['פִּקָּדוֹן','A deposit (of an object/animal with a Shomer)'],
  ['פְּשִׁיעָה','Negligent / doing less than the minimum required'],['קָשְׁיָא','Objection/Attack'],['תֵּרוּץ','Solution / defense']
 ]);
});
test('Markdown accepts named headers, optional outside pipes, alignments and escaped pipes',()=>{
 const data='Term | Translation\n:--- | ---:\nשלום | peace, calm\nאור | light';
 assert.deepEqual(v.parseTable(data).map(r=>r.definition),['peace, calm','light']);
 assert.equal(v.parseTable('```markdown\n'+data+'\n```').length,2);
 assert.equal(v.parseTable('| מילה | פירוש |\n| --- | --- |\n| א | first |\n| ב | second |').length,2);
 assert.equal(v.parseTable('| א | first \\| one |\n| ב | second |')[0].definition,'first | one');
 assert.throws(()=>v.parseTable('| א | first | extra |\n| ב | second | extra |'),/two columns/);
 assert.throws(()=>v.parseTable('| א | |\n| ב | second |'),/word and definition/);
 assert.equal(v.parseTable('word,definition\nא,"first | one"\nב,second')[0].definition,'first | one');
 assert.equal(v.parseTable('א\tfirst | one\nב\tsecond')[0].definition,'first | one');
});


test('Coverage includes grouped words and never repeats until the complete list has been covered',()=>{
 for(const n of [10,12,15])for(const types of [['choice','match','gaps'],['text','choice','multi','match','gaps','order'],['match'],['multi'],['order']]){
  const p=v.plan(config({rows:rows(n),count:23,types})),used=new Set();
  for(const entry of p.entries){
   assert.equal(new Set(entry.indices).size,entry.indices.length);
   for(const index of entry.indices){if(used.has(index))assert.equal(used.size,n);used.add(index);}
  }
  assert.equal(p.coverage.coveredWords,n);assert(p.coverage.repeatedUses>0);
 }
});
test('Groups shrink to avoid repeats and coverage stays consistent across ten-question batches',async()=>{
 const c=config({rows:rows(15),count:10,types:['choice','match','gaps']});
 const p=v.plan(c);assert.equal(p.coverage.repeatedUses,0);assert.equal(p.coverage.coveredWords,15);
 const long=config({rows:rows(15),count:21,types:['choice','match','multi','order','gaps']});
 const expected=v.plan(long),generated=[];
 for(let offset=0;offset<long.count;offset+=10)generated.push(...await v.questions({...long,offset}));
 assert.equal(generated.length,21);
 generated.forEach((q,i)=>{
  const terms=expected.entries[i].indices;
  if(q.type==='match')assert.deepEqual(q.items,terms.map(j=>long.rows[j].word));
  else if(q.type==='order')assert.deepEqual(new Set(q.answer),new Set(terms.map(j=>long.rows[j].word)));
  else if(q.type==='multi')assert.deepEqual(q.answer,[long.rows[terms[0]].definition,...long.rows[terms[0]].additionalAnswers]);
  else assert.deepEqual(q.answer,terms.map(j=>long.rows[j].definition));
 });
 assert.deepEqual(v.coverage(long),expected.coverage);
});
test('Short mixed-language groups cannot silently repeat before covering the other language',()=>{
 const mixed=[...rows(2),{word:'night',definition:'לילה',definitionDistractors:['יום']}];
 assert.throws(()=>v.plan(config({rows:mixed,count:3,types:['match']})),/cover every word/);
 const p=v.plan(config({rows:mixed,count:2,types:['match','choice']}));
 assert.equal(p.coverage.coveredWords,3);assert.equal(p.coverage.repeatedUses,0);
});

test('Multiple answers uses one term and teacher-approved answers, with incorrect distractors',async()=>{
 const c=config({rows:rows(2),count:2,types:['multi']});
 const qs=await v.questions(c);
 qs.forEach((q,i)=>{
  assert.equal(v.plan(c).entries[i].indices.length,1);
  assert(q.prompt.includes(c.rows[i].word));assert(!q.prompt.includes(c.rows[1-i].word));
  assert.deepEqual(q.answer,[c.rows[i].definition,...c.rows[i].additionalAnswers]);
  assert(q.answer.every(a=>q.choices.includes(a)));
  assert(c.rows[i].definitionDistractors.every(a=>q.choices.includes(a)&&!q.answer.includes(a)));
 });
 const unavailable=rows(2).map(({additionalAnswers,...r})=>r);
 unavailable[0].definition='meaning / another meaning';
 await assert.rejects(v.questions({...c,rows:unavailable}),/additional correct answer/);
 const mixed=rows(3);delete mixed[0].additionalAnswers;delete mixed[2].additionalAnswers;
 const p=v.plan(config({rows:mixed,count:3,types:['multi','choice','text']}));
 assert.deepEqual(p.entries.find(e=>e.type==='multi').indices,[1]);assert.equal(p.coverage.repeatedUses,0);
});
test('Approved alternatives persist, follow answer language, and cannot become distractors',async()=>{
 const r=rows(2);assert.deepEqual(v.source({rows:r}).rows[0].additionalAnswers,r[0].additionalAnswers);
 assert.throws(()=>v.validateRows([{...r[0],definitionDistractors:r[0].additionalAnswers}],1),/correct answer/);
 assert.throws(()=>v.validateRows([{...r[0],additionalAnswers:[r[0].definition]}],1),/differ/);
 await assert.rejects(v.questions(config({rows:[{...r[0],additionalAnswers:['אור']},r[1]]})),/English/);
 const result=await v.distractors({rows:r,index:0},async()=>JSON.stringify({rows:[{index:0,definitionDistractors:['wrong a','wrong b','wrong c']}]}));
 assert.deepEqual(result[0].additionalAnswers,r[0].additionalAnswers);
 await assert.rejects(v.distractors({rows:r,index:0},async()=>JSON.stringify({rows:[{index:0,definitionDistractors:[r[1].additionalAnswers[0],'wrong b','wrong c']}]})),/repeat vocabulary answers/);
});

test('Every incorrect generated choice comes exclusively from its participating table rows',async()=>{
 const c=config({count:23}),p=v.plan(c),generated=[];
 c.rows.forEach((r,i)=>r.definitionDistractors=['teacher edited wrong '+i]);
 for(let offset=0;offset<c.count;offset+=10)generated.push(...await v.questions({...c,offset},async()=>assert.fail('Quiz generation must never invent distractors')));
 generated.forEach((q,i)=>{
  if(['text','order'].includes(q.type))return;
  const indices=p.entries[i].indices;
  const permitted=indices.flatMap(j=>c.rows[j].definitionDistractors);
  const wrong=q.choices.filter(choice=>!q.answer.includes(choice));
  assert.deepEqual(new Set(wrong),new Set(permitted));
 });
});
test('Missing table distractors never fall back to other rows or generated choices',async()=>{
 const input=rows(3);input[0].definitionDistractors=[];
 for(const type of ['choice','multi'])await assert.rejects(v.questions(config({rows:input,count:1,types:[type]}),async()=>assert.fail('No invented distractors')),/table rows/);
 const gaps=await v.questions(config({rows:input,count:1,types:['gaps'],wordBank:false}));assert.deepEqual(gaps[0].choices,[input[0].definition]);assert.equal(gaps[0].wordBank,true);
 const match=await v.questions(config({rows:input,count:1,types:['match']}));
 assert.deepEqual(new Set(match[0].choices.filter(c=>!match[0].answer.includes(c))),new Set(input.flatMap(r=>r.definitionDistractors)));
 input.forEach(r=>r.definitionDistractors=[]);
 await assert.rejects(v.questions(config({rows:input,count:1,types:['match']})),/table rows/);
});
