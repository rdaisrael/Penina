const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../PeninaPlus-Binyan-Builder/core');
const reader=require('../PeninaPlus-Reader/reader-core');
const {prepare}=require('../PeninaPlus-Binyan-Builder/vocabulary');
const {render}=require('../PeninaPlus-Binyan-Builder/exercises');
const {generateWorksheet}=require('../lib/binyan-worksheet');
const input={mode:'practice',vocabulary:{verbs:['כתב'],binyanim:['פעל שלם|הווה']},pairs:['פעל שלם|הווה'],count:6,exercises:['sentence'],footnotes:'page'};
const word=(word,match='',translation='supporting word',form='')=>({word,match,translation,form,mastered:true,prefix:'',isName:false});
function question(sentence='הוּא ___ בַּמַּחְבֶּרֶת.',words=[word('הוּא','__pronoun__','he'),{...word('בַּמַּחְבֶּרֶת','מחברת','in the notebook'),prefix:'ב'}],phrases=[]){return {number:1,exercise:'sentence',pair:input.pairs[0],person:'masculine_singular',root:'כתב',meaning:'write',answer:'כּוֹתֵב',sentence,words,phrases};}
const prepared=(q=question(),v={})=>prepare({questions:[q]},core.validateRequest({...input,vocabulary:{...input.vocabulary,...v}})).questions[0];
test('all Reader sheets and context forms survive repeated request validation',()=>{
 const v={...input.vocabulary,binyanim:[...input.vocabulary.binyanim,'פיעל שלם|עבר']};
 for(const key of core.vocabularyKeys)v[key]=['סֵפֶר','סֵפֶר'];
 const request=core.validateRequest({...input,vocabulary:v});
 assert.deepEqual(core.validateRequest(request),request);
 assert.deepEqual(request.vocabulary.binyanim,input.vocabulary.binyanim);
 assert.ok(request.vocabulary.forms.includes('פיעל שלם|עבר'));
 for(const key of core.vocabularyKeys)assert.deepEqual(request.vocabulary[key],['סֵפֶר']);
 for(const value of [null,'ספר',['English'],['<script>ספר'],Array(5001).fill('ספר')])assert.throws(()=>core.validateRequest({...input,vocabulary:{...input.vocabulary,nouns:value}}),/Vocabulary/);
 assert.throws(()=>core.validateRequest({...input,footnotes:'invalid'}),/notes/);
});
test('Reader mastery checks suppress known nouns and pronouns, but reject invented mastery',()=>{
 const unknown=prepared();assert.deepEqual(unknown.notes.map(n=>n.translation),['in the notebook']);
 assert.equal(prepared(question(),{nouns:['מחברת']}).notes.length,0);
 assert.equal(prepared(question(),{nouns:['ספר']}).notes.length,1,'a claimed match does not invent mastery');
 assert.ok(unknown.sentenceWords.every(w=>!w.word.includes('___')&&!w.word.includes('כּוֹתֵב')));
 const token=unknown.sentenceWords.at(-1);assert.equal(unknown.sentence.slice(token.start,token.start+token.word.length),token.word);
});
test('a familiar root does not make an unlearned context conjugation familiar',()=>{
 const q=question('הוּא רוֹצֶה ___ בַּמַּחְבֶּרֶת.',[word('הוּא','__pronoun__','he'),word('רוֹצֶה','רצה','wants','פעל ל-ה|הווה'),word('בַּמַּחְבֶּרֶת','מחברת','in the notebook')]);
 const v={verbs:['כתב','רצה'],nouns:['מחברת']};
 assert.equal(prepared(q,v).notes[0].word,'רוֹצֶה');
 assert.equal(prepared(q,{...v,binyanim:[...input.vocabulary.binyanim,'פעל ל-ה|הווה']}).notes.length,0);
});
test('learned expressions apply to their complete span and cannot cross the missing verb',()=>{
 const q=question('הוּא ___ בְּבֵית סֵפֶר.',[word('הוּא','__pronoun__','he'),word('בְּבֵית'),word('סֵפֶר')],[{...word('בְּבֵית סֵפֶר','בית ספר','at school'),start:1,end:3}]);
 assert.equal(prepared(q,{expressions:['בית ספר']}).notes.length,0);
 assert.equal(prepared(q).notes.length,1);
 const broken={...q,sentence:'הוּא בְּבֵית ___ סֵפֶר.'};
 assert.throws(()=>prepared(broken),/punctuation/);
 const negative=structuredClone(q);negative.phrases[0].start=-1;
 assert.throws(()=>prepared(negative),/indexes/);
});
test('incomplete or misaligned analysis fails; forged rendered notes are replaced',()=>{
 for(const mutate of [q=>delete q.words,q=>q.words.pop(),q=>q.words[1].word='סֵפֶר',q=>q.words[1].translation='',q=>q.phrases.push({})]){
  const q=question();mutate(q);assert.throws(()=>prepared(q));
 }
 const q=question();q.notes=[{id:1,word:q.answer,translation:'the answer'}];q.sentenceWords=[{word:q.answer,start:0,noteId:1}];
 assert.deepEqual(prepared(q).notes.map(n=>n.translation),['in the notebook']);
});
test('student notes exclude writing examples, deduplicate, and can be switched off',()=>{
 const q=prepared(),writing={...prepared(question('הוּא ___ בַּבַּיִת.',[word('הוּא','__pronoun__','he'),word('בַּבַּיִת','','at home')])),number:3,exercise:'writing'};
 const questions=[q,{...q,number:2},writing];
 const html=render(questions,{footnotes:'page'});
 assert.equal((html.match(/class="vocabulary-note"/g)||[]).length,1);
 assert.equal((html.match(/class="vocabulary-marker"/g)||[]).length,2);
 assert.doesNotMatch(html,/at home|כּוֹתֵב/);
 assert.match(render(questions,{key:true,footnotes:'end'}),/at home/);
 assert.doesNotMatch(render(questions,{footnotes:'none'}),/vocabulary-marker|vocabulary-notes/);
 q.notes[0].translation='<img src=x>';
 assert.doesNotMatch(render([q],{footnotes:'end'}),/<img/);
});
test('generation requests familiar vocabulary and checks every sentence before returning notes',async()=>{
 const request=core.validateRequest({...input,vocabulary:{...input.vocabulary,nouns:['ספר'],adverbs:['היום']}});
 const forms=['כּוֹתֵב','כּוֹתֶבֶת','כּוֹתְבִים','כּוֹתְבוֹת'];
 const result={unavailablePairs:[],lessons:[],questions:core.plan(request).map((q,i)=>({...question(),...q,answer:forms[i%4]}))};
 const output=await generateWorksheet(request,async(prompt,options)=>{
  assert.match(prompt,/Familiar sentence vocabulary is a priority/);assert.match(prompt,/היום/);
  assert.ok(options.textFormat.schema.properties.questions.items.required.includes('words'));
  return JSON.stringify(result);
 },async()=>{});
 assert.equal(output.questions[0].notes[0].translation,'in the notebook');
 const bad=structuredClone(result);bad.questions[0].words=[];
 await assert.rejects(generateWorksheet(request,async()=>JSON.stringify(bad),()=>assert.fail('must fail before Dicta')),/Word analysis/);
});
