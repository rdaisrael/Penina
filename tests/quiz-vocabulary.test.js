'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const v=require('../lib/quiz-vocabulary'),model=require('../lib/quiz-builder-model');
function rows(n=15){return Array.from({length:n},(_,i)=>({word:'מילה'+i,definition:'meaning'+i,additionalAnswers:['alternate meaning'+i],definitionDistractors:['wrong meaning '+i+'a','wrong meaning '+i+'b','wrong meaning '+i+'c'],wordDistractors:['decoy'+i+'a','decoy'+i+'b','decoy'+i+'c']}));}
function config(overrides={}){return {rows:rows(),count:15,autoCount:false,types:['text','choice','multi','match','gaps','order'],wordBank:true,direction:'ltr',...overrides};}
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
 const c=config({count:23,rows:rows(50)}),all=[];
 for(let offset=0;offset<c.count;offset+=10)all.push(...await v.questions({...c,offset},sentenceAI));
 assert.equal(all.length,23);assert.deepEqual([...new Set(all.map(q=>q.type))],c.types);
 const quiz=model.validateQuiz({title:'Generated',durationMinutes:null,questions:all},true);
 const answers=all.map(q=>q.type==='text'?['A student explanation']:q.answer);
 assert(model.validAnswers(quiz,answers));assert.equal(model.grade(quiz,answers).automaticScore,all.filter(q=>q.type!=='text').length);
 const choiceIndex=v.plan(c).entries[1].indices[0];assert.deepEqual(all[1].answer,['meaning'+choiceIndex]);assert(all[1].choices.includes('wrong meaning '+choiceIndex+'a'));
 const plans=v.plan(c).entries;assert(all[3].choices.includes('wrong meaning '+plans[3].indices[0]+'a'));assert(all[4].choices.includes('wrong meaning '+plans[4].indices[0]+'a'));assert.deepEqual(all[4].answer,['meaning'+plans[4].indices[0]]);
 assert(model.publicQuestions(quiz).every(q=>!Object.hasOwn(q,'answer')));
});
test('50 distinct words generate in bounded batches and excessive counts are rejected',async()=>{
 const c=config({count:50,rows:rows(50),types:['choice']}),all=[];
 for(let offset=0;offset<50;offset+=10)all.push(...await v.questions({...c,offset},async()=>assert.fail('no AI needed')));
 assert.equal(all.length,50);
 for(const overrides of [{count:0},{count:101},{count:100},{count:2},{types:[]},{offset:11},{offset:100},{rows:rows(1)}])await assert.rejects(v.questions(config(overrides),sentenceAI));
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
 const mixed=[
  {word:'שלום',definition:'peace',definitionDistractors:['war','noise']},
  {word:'אור',definition:'light',definitionDistractors:['darkness','water']},
  {word:'ספר',definition:'book',definitionDistractors:['chair','table']},
  {word:'בית',definition:'house',definitionDistractors:['road','field']},
  {word:'water',definition:'מים',definitionDistractors:['אש','אדמה']},
  {word:'night',definition:'לילה',definitionDistractors:['יום','בוקר']},
  {word:'sun',definition:'שמש',definitionDistractors:['ענן','רוח']},
  {word:'tree',definition:'עץ',definitionDistractors:['פרח','עלה']}
 ];
 mixed.forEach((r,i)=>r.additionalAnswers=[i<4?'alternate meaning '+i:'חלופה'+i]);
 for(const type of ['choice','multi','match','gaps','text']){
  const c=config({rows:mixed,autoCount:true,types:[type]}),planned=v.plan(c);
  const generated=await v.questions(c);
  for(let i=0;i<generated.length;i++){
   const q=generated[i],answers=type==='text'?[q.answer]:q.choices;
   const first=planned.entries[i].indices[0];
   assert(answers.every(a=>first<4?!/[א-ת]/.test(a):/[א-ת]/.test(a)&&!/[a-z]/i.test(a)));
   assert.equal(q.direction,first<4?'ltr':'rtl');
  }
 }
 const bad=structuredClone(mixed);bad[0].definitionDistractors=['מלחמה'];await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/English/);
 bad[0].definitionDistractors=['war'];bad[4].definition='water';await assert.rejects(v.questions(config({rows:bad,count:4,types:['choice']})),/Hebrew/);
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


test('Suggested counts cover every word exactly once across all selected formats',()=>{
 for(const n of [10,12,15])for(const types of [['choice','match','gaps'],['text','choice','multi','match','gaps','order'],['match'],['multi'],['order']]){
  const p=v.plan(config({rows:rows(n),autoCount:true,types})),used=new Set();
  for(const entry of p.entries){
   assert.equal(new Set(entry.indices).size,entry.indices.length);
   for(const index of entry.indices){assert(!used.has(index));used.add(index);}
  }
  assert.equal(p.coverage.coveredWords,n);assert.equal(p.coverage.repeatedUses,0);
 }
});
test('Matching groups keep 4–6 terms and coverage stays consistent across ten-question batches',async()=>{
 // Three four-term matching groups and seven single-term questions use 19 words.
 const c=config({rows:rows(19),count:10,types:['choice','match','gaps']});
 const p=v.plan(c);assert.equal(p.coverage.repeatedUses,0);assert.equal(p.coverage.coveredWords,19);
 assert(p.entries.filter(e=>e.type==='match').every(e=>e.indices.length>=4&&e.indices.length<=6));
 const long=config({rows:rows(50),count:21,types:['choice','match','multi','order','gaps']});
 const expected=v.plan(long),generated=[];
 for(let offset=0;offset<long.count;offset+=10)generated.push(...await v.questions({...long,offset}));
 assert.equal(generated.length,21);
 generated.forEach((q,i)=>{
  const terms=expected.entries[i].indices;
  if(q.type==='match'){assert(q.items.length>=4&&q.items.length<=6);assert.deepEqual(q.items,terms.map(j=>long.rows[j].word));}
  else if(q.type==='order')assert.deepEqual(new Set(q.answer),new Set(terms.map(j=>long.rows[j].word)));
  else if(q.type==='multi')assert.deepEqual(q.answer,[long.rows[terms[0]].definition,...long.rows[terms[0]].additionalAnswers]);
  else assert.deepEqual(q.answer,terms.map(j=>long.rows[j].definition));
 });
 assert.deepEqual(v.coverage(long),{...expected.coverage,error:''});
});
test('Short mixed-language groups cannot silently repeat before covering the other language',()=>{
 const short=[...rows(2),{word:'night',definition:'לילה',definitionDistractors:['יום']}];
 assert.throws(()=>v.plan(config({rows:short,count:3,types:['match']})),/4–6 untested terms in one language/);
 const mixed=[...rows(4),short[2]];
 assert.throws(()=>v.plan(config({rows:mixed,count:3,types:['match']})),/suggested/);
 const p=v.plan(config({rows:mixed,count:2,types:['match','choice']}));
 assert.equal(p.coverage.coveredWords,5);assert.equal(p.coverage.repeatedUses,0);
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
 const c=config({count:23,rows:rows(50)}),p=v.plan(c),generated=[];
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
 const input=rows(4);input[0].definitionDistractors=[];
 for(const type of ['choice','multi'])await assert.rejects(v.questions(config({rows:input,count:1,types:[type]}),async()=>assert.fail('No invented distractors')),/table rows/);
 const gaps=await v.questions(config({rows:input,count:1,types:['gaps'],wordBank:false}));assert.deepEqual(gaps[0].choices,[input[0].definition]);assert.equal(gaps[0].wordBank,true);
 const match=await v.questions(config({rows:input,count:1,types:['match']}));
 assert.deepEqual(new Set(match[0].choices.filter(c=>!match[0].answer.includes(c))),new Set(input.flatMap(r=>r.definitionDistractors)));
 input.forEach(r=>r.definitionDistractors=[]);
 await assert.rejects(v.questions(config({rows:input,count:1,types:['match']})),/table rows/);
});

test('Generation excludes words tested anywhere in legacy and manually edited draft questions',async()=>{
 const input=rows(12),existingQuestions=[
  {type:'choice',prompt:'What does “מילה0” mean?',answer:['meaning0'],choices:['meaning0','מילה11']},
  {type:'gaps',prompt:'The meaning of מילה1 is ___.',answer:['meaning1']},
  {type:'text',prompt:'Write the Hebrew translation.',answer:'מילה2'},
  {type:'multi',prompt:'Explain מילה3.',answer:['meaning3','alternate meaning3']},
  {type:'match',prompt:'Match these.',items:['מילה4','מילה5','מילה11'],answer:['meaning4','meaning5','']},
  {type:'order',prompt:'Sort these.',answer:['מילה6','מילה7']},
  {type:'text',prompt:'Explain this term in your own words.',answer:'meaning8',vocabularyTerms:[{word:'מילה8',definition:'meaning8'}]},
  {type:'text',prompt:'A reworded question about מילה0.',answer:'meaning0'}
 ];
 const c=config({rows:input,existingQuestions,autoCount:true,types:['choice']}),p=v.plan(c);
 assert.equal(p.config.count,3);assert.equal(p.coverage.existingWords,9);assert.equal(p.coverage.coveredWords,12);
 assert.deepEqual(p.entries.map(e=>e.indices[0]),[9,10,11]);
 assert.deepEqual(p.coverage.words[0].existingQuestions,[1,8]);
 const generated=await v.questions(c);
 assert.deepEqual(generated.map(q=>q.vocabularyTerms[0].word),['מילה9','מילה10','מילה11']);
 await assert.rejects(v.questions({...c,existingQuestions:[...existingQuestions,...generated]}),/already tested/);
});
test('Deleting or retargeting questions releases their words; rewording retains their identity',async()=>{
 const c=config({count:1,types:['choice']}),[q]=await v.questions(c);
 q.prompt='Choose its translation.';
 assert.equal(v.coverage({...c,existingQuestions:[q]}).existingWords,1);
 q.prompt='Translate מילה1.';q.answer=['meaning1'];
 const after=v.coverage({...c,existingQuestions:[q]});
 assert.equal(after.words[0].existingQuestions.length,0);assert.equal(after.words[1].existingQuestions.length,1);
 assert.equal(v.coverage({...c,existingQuestions:[]}).existingWords,0);
});
test('Coverage uses whole words, Unicode normalization and correct answers, not distractor mentions',()=>{
 const input=[{word:'אור',definition:'light'},{word:'מאור',definition:'luminary'},{word:'café',definition:'קפה'},{word:'sun',definition:'שמש'}];
 const c=config({rows:input,autoCount:true,types:['text'],existingQuestions:[
  {type:'text',prompt:'Translate מאור.',answer:'luminary'},
  {type:'choice',prompt:'Translate CAFE\u0301.',answer:['קפה'],choices:['קפה','sun']}
 ]});
 const result=v.coverage(c);assert.equal(result.existingWords,2);
 assert.deepEqual(result.words.map(w=>w.existingQuestions.length),[0,1,1,0]);
});
test('Suggestions fit remaining draft capacity and report incomplete or impossible coverage',async()=>{
 const c=config({autoCount:true,types:['choice'],existingQuestions:Array.from({length:98},()=>({type:'text',prompt:'Unrelated question',answer:''}))});
 const coverage=v.coverage(c);assert.equal(coverage.suggestedCount,2);assert.equal(coverage.untestedWords,13);
 await assert.rejects(v.questions({...c,autoCount:false,count:3}),/suggested 2/);
 c.existingQuestions.push(...c.existingQuestions.slice(0,2));assert.match(v.coverage(c).error,/100 questions/);
 assert.match(v.coverage(config({rows:rows(3),autoCount:true,types:['match']})).error,/without repeats/);
 const partial=v.coverage(config({rows:rows(7),autoCount:true,types:['match']}));assert.equal(partial.coveredWords,6);assert.equal(partial.untestedWords,1);
});
test('Mixed-language groups reserve scarce approved alternatives for multiple-answer questions',()=>{
 const input=rows(5).map(({additionalAnswers,...row})=>row);
 input[0].additionalAnswers=['alternate'];
 input.push({word:'night',definition:'לילה',definitionDistractors:['יום']});
 const p=v.plan(config({rows:input,autoCount:true,types:['choice','multi','match']}));
 assert.equal(p.coverage.coveredWords,6);assert.equal(p.coverage.repeatedUses,0);
 assert.deepEqual(p.entries.find(e=>e.type==='multi').indices,[0]);
 assert.deepEqual(p.entries.find(e=>e.type==='choice').indices,[5]);
 assert.deepEqual(new Set(p.entries.find(e=>e.type==='match').indices),new Set([1,2,3,4]));
});
test('Suggested count covers 2–50 words without repeating a target or exceeding group limits',()=>{
 for(let n=2;n<=50;n++){
  const input=rows(n);
  for(const types of [['text'],['choice','gaps'],...(n>=6?[['choice','match','gaps']]:[])]){
   const p=v.plan(config({rows:input,autoCount:true,types}));
   assert.equal(p.coverage.coveredWords,n,JSON.stringify({n,types}));
   const indices=p.entries.flatMap(e=>e.indices);assert.equal(new Set(indices).size,n);assert.equal(indices.length,n);
   assert.deepEqual(new Set(p.entries.map(e=>e.type)),new Set(types));
   for(const e of p.entries)if(e.type==='match')assert(e.indices.length>=4 && e.indices.length<=6);
  }
 }
});
test('Existing draft metadata is validated and never exposes vocabulary targets to students',async()=>{
 const [q]=await v.questions(config({count:1,types:['choice']}));
 const quiz=model.validateQuiz({title:'Generated',questions:[q]},true);
 assert.deepEqual(quiz.questions[0].vocabularyTerms,q.vocabularyTerms);
 const publicQuestion=model.publicQuestions(quiz)[0];assert(!('vocabularyTerms' in publicQuestion));assert(!('vocabularyGenerated' in publicQuestion));
 for(const existingQuestions of [Array(101).fill(q),[null],[{...q,items:['x'.repeat(5001)]}],[{...q,vocabularyTerms:[{word:7,definition:'answer'}]}]])assert.throws(()=>v.coverage({...config(),existingQuestions}));
 assert.throws(()=>model.validateQuiz({title:'Bad metadata',questions:[{...q,vocabularyTerms:[{word:'',definition:'a'}]}]}));
});
test('An unambiguous approved answer detects an older rephrased question without guessing shared meanings',()=>{
 const input=rows(3);input[1].definition=input[2].definition='shared meaning';
 const c=config({rows:input,autoCount:true,types:['text'],existingQuestions:[
  {type:'text',prompt:'Translate the highlighted term.',answer:'meaning0'},
  {type:'choice',prompt:'Choose the correct translation.',answer:['shared meaning']}
 ]});
 const result=v.coverage(c);assert.deepEqual(result.words.map(w=>w.existingQuestions.length),[1,0,0]);
});
test('The same translation imported in both directions is tested once',async()=>{
 const c=config({rows:[{word:'אור',definition:'light'},{word:'light',definition:'אור'}],autoCount:true,types:['text']});
 const p=v.plan(c);assert.equal(p.config.count,1);assert.equal(p.coverage.coveredWords,2);assert.equal(p.coverage.existingWords,0);
 const generated=await v.questions(c);assert.equal(generated.length,1);
 const next=v.coverage({...c,existingQuestions:generated});assert.equal(next.existingWords,2);assert.match(next.error,/already tested/);
 const draft=v.coverage({...c,existingQuestions:[{type:'text',prompt:'Translate אור.',answer:''}]});assert.equal(draft.existingWords,2);assert.equal(draft.questionCount,0);
});
