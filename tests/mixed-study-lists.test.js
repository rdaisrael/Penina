const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const study=require('../lib/study-sets'),games=require('../PeninaPlus-vocab-builder/offline-study-cards'),vocab=require('../lib/quiz-vocabulary'),model=require('../lib/quiz-builder-model');
const liveHarness=require('./helpers/live-harness');
const picture={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=',alt:'Leaf diagram',target:{x:.25,y:.75}};
const deck=()=>({format:'penina-knowledge-cards',version:1,title:'Plant knowledge',cards:[{id:'leaf',question:'What does the marked part do?',answer:'Makes food',picture:structuredClone(picture),distractors:{english:['Absorbs water','Makes seeds','Carries water','Protects the trunk'],hebrew:['קליטת מים','יצירת זרעים','נשיאת מים','הגנה על הגזע']}}]});
const path='knowledge-cards/sixth/plants.json',vpath='vocabulary-cards/sixth/now--V29yZHM.html';
const word={term:'שלום',english:'peace',alternativeAnswers:{english:{term:'שלום',definition:'peace',answers:['chair','window','door','book']}}};
function fixture(){
 const records=new Map([[path,{body:JSON.stringify(deck()),uploadedAt:'2026-11-11T12:00:00Z'}],[vpath,{body:games.makeApp('Words',[word]),uploadedAt:'2026-11-10T12:00:00Z'}]]),reads=[];
 const blob=p=>({pathname:p,url:'mock:'+p,uploadedAt:records.get(p).uploadedAt});
 const storage={list:async({prefix})=>({blobs:[...records.keys()].filter(p=>p.startsWith(prefix)).map(blob)}),put:async(p,body)=>{records.set(p,{body,uploadedAt:'2026-11-11T13:00:00Z'});return blob(p);}};
 const fetcher=async url=>{assert(url.startsWith('mock:'));reads.push(url);return {ok:records.has(url.slice(5)),text:async()=>records.get(url.slice(5)).body,json:async()=>JSON.parse(records.get(url.slice(5)).body)};};
 const page={id:'sixth',name:'Class six',url:'/class'};
 function load(file){const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../'+file),'utf8'),{module,Buffer,console,fetch:fetcher,require:name=>{
  if(name==='@vercel/blob')return storage;
  if(name.includes('study-sets'))return study;
  if(name.includes('vocabulary-pages'))return {listPages:async()=>[page],getPage:async grade=>grade==='sixth'?page:null,publicPage:p=>p,authorizePage:req=>req.headers.cookie==='owner'?null:{status:403,error:'Wrong owner'}};
  if(name.includes('teacher-apps'))return {requireApps:async()=>{}};
  if(name.includes('offline-study-cards'))return games;
  if(name==='./quiz-vocabulary')return vocab;
  if(name.includes('vocabulary-sheets'))return require('../PeninaPlus-vocab-builder/vocabulary-sheets');
  throw Error('Unexpected dependency '+name);
 }});return module.exports;}
 async function request(method,body={},query={},cookie='owner'){
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=JSON.parse(JSON.stringify(body));return this;},send(body){this.body=body;return this;}};
  await load('api/flashcard-sets')({method,body,query,headers:{cookie}},res);return res;
 }
 return {records,reads,load,request};
}
test('Knowledge adapters retain both distractor languages, picture and target, without changing the source',()=>{
 const original=deck(),before=JSON.stringify(original),cards=study.knowledgeCards(original,path).cards;
 for(const lang of ['english','hebrew']){const rows=games.practiceRows(cards,lang);assert.equal(rows.length,1);assert.deepEqual(rows[0].picture,picture);assert.deepEqual(rows[0].answers,original.cards[0].distractors[lang]);assert.equal(rows[0].sourceId,path+'#leaf');}
 assert.equal(JSON.stringify(original),before);
 const stale=structuredClone(cards);stale[0].english='Changed answer';assert.equal(games.practiceRows(stale,'english').length,0);
 const unsafe=deck();unsafe.cards[0].picture.src='javascript:alert(1)';assert.throws(()=>study.knowledgeCards(unsafe,path),/picture/);
 const html=games.makeClassGames('Mixed',[word,...cards],{});assert(html.includes(picture.src));assert(html.includes('Makes food'));for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(script[1]));
});
test('Class list settings accept both types, enforce ownership and exclusion, and retain vocabulary flashcard actions',async()=>{
 const h=fixture(),listing=await h.request('GET',{}, {grade:'sixth'});
 assert.equal(listing.code,200);assert.equal(listing.body.sets.length,1);assert.equal(listing.body.knowledgeSets.length,1);assert.equal(listing.body.knowledgeSets[0].hasGames,true);
 const body={grade:'sixth',action:'game-settings',disabledGames:[],excludedWordlists:[],wordlistEmphasis:{[path]:2,[vpath]:1}};
 assert.equal((await h.request('POST',body,{},'other')).code,403);
 assert.equal((await h.request('POST',{...body,wordlistEmphasis:{'knowledge-cards/other/private.json':2}})).code,400);
 assert.equal((await h.request('POST',body)).code,200);
 let game=await h.request('GET',{}, {grade:'sixth',games:'1'});assert.equal(game.code,200);assert(game.body.includes('Makes food')&&game.body.includes('peace'));
 await h.request('POST',{...body,excludedWordlists:[path]});game=await h.request('GET',{}, {grade:'sixth',games:'1'});assert(!game.body.includes('Makes food'));assert(game.body.includes('peace'));
 await h.request('POST',{...body,excludedWordlists:[vpath]});game=await h.request('GET',{}, {grade:'sixth',games:'1'});assert(game.body.includes('Makes food'));assert(!game.body.includes('"definition":"peace"'));
 assert.equal((await h.request('GET',{}, {grade:'sixth',view:path})).code,404);
});
test('Mixed quiz import retains pictures and both saved banks; generated and public questions retain only the intended content',async()=>{
 const h=fixture(),library=h.load('lib/quiz-vocabulary-library');
 const listed=await library.handle({userId:7},{action:'vocabulary-library'});assert.equal(listed.sets.length,2);assert(listed.sets.every(s=>!s.cards&&!s.url));
 await assert.rejects(library.handle({userId:7},{action:'import-vocabulary-library',pathnames:['knowledge-cards/other/private.json']}),/does not belong/);
 const result=await library.handle({userId:7},{action:'import-vocabulary-library',pathnames:[vpath,path],language:'hebrew'});
 const row=result.rows.find(r=>r.kind==='knowledge');assert.deepEqual(JSON.parse(JSON.stringify(row.picture)),picture);assert.deepEqual(Array.from(row.definitionDistractors),deck().cards[0].distractors.hebrew);assert.deepEqual(Array.from(row.knowledgeDistractors.english),deck().cards[0].distractors.english);
 const config=vocab.source({rows:result.rows,types:['choice'],autoCount:true});
 const questions=await vocab.questions(config),q=questions.find(q=>q.prompt===row.word);
 assert.deepEqual(q.image,{src:picture.src,alt:picture.alt,marker:picture.target});assert(q.choices.includes(row.definition));assert.deepEqual(new Set(q.choices.filter(a=>a!==row.definition)),new Set(row.definitionDistractors));
 const saved=model.validateQuiz({title:'Mixed',questions},true),publicQ=model.publicQuestions(saved).find(q=>q.prompt===row.word);
 assert.equal(publicQ.image.src,picture.src);assert.equal(publicQ.answer,undefined);assert.equal(publicQ.vocabularyTerms,undefined);
 assert.equal(vocab.coverage({...config,existingQuestions:saved.questions}).existingWords,2);
});
test('Pictured facts with identical text stay distinct and generate individually; unsuitable formats give guidance',async()=>{
 const base={kind:'knowledge',word:'What is marked?',definition:'Leaf',definitionDistractors:['Root','Seed','Stem','Flower'],picture};
 const rows=[{...base,sourceId:'one'},{...base,sourceId:'two',picture:{...picture,target:{x:.7,y:.2}}}];
 const config={rows,types:['choice','match','gaps','order'],autoCount:true};
 const coverage=vocab.coverage(config);assert.equal(coverage.coveredWords,2);assert.deepEqual(coverage.skippedTypes,['match','order']);
 const questions=await vocab.questions(config);assert.equal(questions.length,2);assert(questions.every(q=>q.image));
 const partial=vocab.coverage({...config,existingQuestions:[questions[0]]});assert.equal(partial.existingWords,1);assert.equal(partial.coveredWords,2);
 assert.match(vocab.coverage({...config,types:['match']}).error,/pictures/);
 const single=await vocab.questions({rows:[rows[0]],types:['text']});assert.equal(single[0].prompt,base.word);assert.equal(single[0].answer,'Leaf');assert.deepEqual(single[0].image.marker,picture.target);
});
test('Knowledge matching keeps question/answer wording, and regeneration preserves pictures and untouched saved banks',async()=>{
 const rows=Array.from({length:4},(_,i)=>({kind:'knowledge',sourceId:'fact'+i,word:'Why '+i+'?',definition:'Answer '+i,definitionDistractors:['Wrong '+i],knowledgeLanguage:'english',knowledgeDistractors:{hebrew:['שגיאה']}}));
 const matched=await vocab.questions({rows,types:['match']});assert.equal(matched.length,1);assert.deepEqual(matched[0].items,rows.map(r=>r.word));assert.match(matched[0].prompt,/question/);
 rows[0].picture=picture;
 let sent='';const next=await vocab.distractors({rows,indices:[0]},async prompt=>{sent=prompt;return JSON.stringify({rows:[{index:0,definitionDistractors:['Different one','Different two','Different three']}]});});
 assert(!sent.includes(picture.src));assert.deepEqual(next[0].picture,picture);assert.deepEqual(next[0].knowledgeDistractors.hebrew,['שגיאה']);assert.deepEqual(next[1].definitionDistractors,rows[1].definitionDistractors);
});
for(const database of [false,true])test('Live mixes both list types and preserves pictures through reveal and replay ('+(database?'database':'blob')+')',async()=>{
 const h=liveHarness({database});h.storage.set(path,{body:JSON.stringify(deck()),uploadedAt:'2026-11-11T12:00:00Z'});
 let made=await h.create({pathnames:[h.setPath,path],count:20});assert.equal(made.code,201);
 const {code,hostToken}=made.body;const joined=await h.join(code);assert.equal(joined.code,200);
 let result=await h.request('start',{code,version:0},hostToken);assert.equal(result.code,200);result=await h.request(null,{code},hostToken);
 result=await h.request(null,{code},hostToken);
 let sawPicture=false,sawWord=false;
 for(let i=0;i<20&&result.body.phase!=='ended';i++){
  if(result.body.question?.picture){sawPicture=true;assert.deepEqual(result.body.question.picture,picture);assert.equal(result.body.question.correct,undefined);const student=await h.request(null,{code},joined.body.studentToken);assert.deepEqual(student.body.question.picture,picture);}
  else sawWord=true;
  result=await h.request('reveal',{code,version:result.body.version},hostToken);assert.equal(result.code,200);result=await h.request(null,{code},hostToken);
  if(result.body.question?.picture)assert.equal(result.body.question.options[result.body.question.correct],'Makes food');
  result=await h.request('next',{code,version:result.body.version},hostToken);assert.equal(result.code,200);result=await h.request(null,{code},hostToken);
 }
 assert(sawPicture&&sawWord);
 const settings=await h.request('settings',{code},hostToken);assert.equal(settings.code,200);assert(settings.body.settings.wordlists.some(s=>s.title==='Plant knowledge'));
 const replay=await h.request('restart',{code,version:result.body.version,pathnames:[path],wordlistEmphasis:{[path]:1},language:'hebrew'},hostToken);assert.equal(replay.code,200);
 const lobby=await h.request(null,{code},hostToken);await h.request('start',{code,version:lobby.body.version},hostToken);const restarted=await h.request(null,{code},hostToken);assert.deepEqual(restarted.body.question.picture,picture);assert(restarted.body.question.options.some(a=>/[א-ת]/u.test(a)));
});
test('Live rejects a knowledge list from another class and missing saved choices without creating a partial room',async()=>{
 const h=liveHarness();const input=deck();delete input.cards[0].distractors;
 h.storage.set(path,{body:JSON.stringify(input),uploadedAt:'2026-11-11T12:00:00Z'});
 assert.equal((await h.create({pathnames:['knowledge-cards/other/private.json']})).code,400);
 const result=await h.create({pathnames:[h.setPath,path]});assert.equal(result.code,400);assert.match(result.body.error,/Plant knowledge.*English/);
 assert(![...h.storage.keys()].some(p=>p.startsWith('live-vocab/')));
});
