// Local browser regression. Every API and storage request uses in-memory fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),study=require('../lib/study-sets'),games=require('../PeninaPlus-vocab-builder/offline-study-cards'),vocab=require('../lib/quiz-vocabulary'),model=require('../lib/quiz-builder-model');
const h=require('./helpers/live-harness')(),kpath='knowledge-cards/sixth/plants.json';
const picture={src:'data:image/png;base64,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',alt:'A plant with two leaves',target:{x:.375,y:.42}};
const deck={format:'penina-knowledge-cards',version:1,title:'Plant knowledge',cards:[{id:'leaf',question:'What is the marked part of this plant?',answer:'Leaf',picture,distractors:{english:['Root','Stem','Seed','Flower'],hebrew:['שורש','גבעול','זרע','פרח']}}]};
h.storage.set(kpath,{body:JSON.stringify(deck),uploadedAt:new Date().toISOString()});
const storage={list:async({prefix})=>({blobs:[...h.storage.keys()].filter(p=>p.startsWith(prefix)).map(pathname=>({pathname,url:'mock:'+pathname,uploadedAt:h.storage.get(pathname).uploadedAt}))}),put:async(pathname,body)=>{h.storage.set(pathname,{body,uploadedAt:new Date().toISOString()});return {pathname};}};
const fetcher=async url=>{assert(url.startsWith('mock:'));const value=h.storage.get(url.slice(5));return {ok:!!value,text:async()=>value.body,json:async()=>JSON.parse(value.body)};};
function load(file){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{module,Buffer,console,fetch:fetcher,require:name=>{
 if(name==='@vercel/blob')return storage;if(name.includes('study-sets'))return study;
 if(name.includes('vocabulary-pages'))return {listPages:async()=>[h.page],getPage:async()=>h.page,publicPage:p=>p,authorizePage:()=>null};
 if(name.includes('teacher-apps'))return {requireApps:async()=>{}};
 if(name.includes('offline-study-cards'))return games;if(name==='./quiz-vocabulary')return vocab;
 if(name.includes('vocabulary-sheets'))return require('../PeninaPlus-vocab-builder/vocabulary-sheets');throw Error(name);
}});return module.exports;}
const flashcards=load('api/flashcard-sets.js'),library=load('lib/quiz-vocabulary-library.js');let saved=null;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');let raw='';for await(const data of req)raw+=data;const body=raw?JSON.parse(raw):{},query=Object.fromEntries(url.searchParams);
 const request={method:req.method,headers:{...req.headers,cookie:'owner-session'},query,body},reply={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(v){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));},send:v=>res.end(v)};
 try{
  if(url.pathname==='/api/flashcard-sets'){
   if(query.kind==='knowledge')return reply.json({sets:[{title:deck.title,pathname:kpath,cardCount:1,url:'#',hasPractice:true,practiceUrl:'#'}]});
   return await flashcards(request,reply);
  }
  if(url.pathname==='/api/game-scores'){
   if(query.game==='live')return await h.handler(request,reply);
   if(query.game==='quiz-builder'){
    const action=body.action;
    if(['vocabulary-library','import-vocabulary-library'].includes(action))return reply.json(await library.handle({userId:7},body));
    if(action==='vocabulary-coverage')return reply.json({coverage:vocab.coverage(body)});
    if(action==='vocabulary-questions')return reply.json({questions:await vocab.questions(body)});
    if(action==='save'){saved={...model.validateQuiz(body.quiz),vocabulary:vocab.source(body.quiz.vocabulary),id:'custom-local',published:false};return reply.json({quiz:saved});}
    if(action==='load')return reply.json({quiz:saved});
    if(action==='list')return reply.json({email:'local@example.test',quizzes:saved?[{id:saved.id,title:saved.title,count:saved.questions.length,published:false}]:[]});
   }
   if(query.game==='quiz-account')return reply.json({userId:7,email:'local@example.test',role:'teacher'});
   return reply.json({scores:[],boards:[]});
  }
  if(url.pathname.startsWith('/api/'))return reply.json({userId:7,role:'teacher'});
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){reply.status(e.status||500).json({error:e.message});}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(origin+'/Penina-Quizzes/builder/')).status,200);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 const errors=[];
 try{
 const context=await browser.newContext({viewport:{width:1200,height:900}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/?page=sixth');
 await page.getByRole('button',{name:'Open teacher tools',exact:true}).click();
 assert.equal(await page.locator('.remove-select').count(),2);assert.equal(await page.locator('.practice-list-select').count(),2);
 // Keep just knowledge in Gamify so every renderer must display its picture.
  await page.locator('.practice-list-select').first().uncheck();
 await page.getByRole('button',{name:'Save Included Lists and Exercises',exact:true}).click();
 await page.getByText('Included wordlists and exercises saved.',{exact:false}).waitFor();
 for(const width of [1200,390]){
  await page.setViewportSize({width,height:900});
  for(const game of ['quiz','lines','cards','asteroids','chomp','flappy','snowblaster']){
   await page.goto(origin+'/api/flashcard-sets?grade=sixth&games=1&case='+game+'-'+width+'#gamify');
   await page.locator('[data-game="'+game+'"]').click();
   if(await page.locator('#gameInitials').isVisible())await page.locator('#gameInitials').fill('AB');
   await page.locator('#gameLaunch').click();
   if(game==='flappy')await page.getByRole('button',{name:'Start flying →'}).click();
   if(game==='snowblaster')await page.getByRole('button',{name:'Start blasting',exact:true}).click();
   const img=page.locator('#gameBoard .study-picture img').first();await img.waitFor({state:'visible'});
   assert.equal(await img.getAttribute('src'),picture.src,game+' picture');
   assert(await img.evaluate(el=>el.naturalWidth>0),game+' decoded picture');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,game+' page overflow at '+width);
   if(['quiz','asteroids','snowblaster'].includes(game))await page.screenshot({path:'/tmp/penina-'+game+'-'+width+'.png'});
  }
 }
 await page.setViewportSize({width:1200,height:900});await page.goto(origin+'/Penina-Quizzes/builder/');
 await page.locator('#vocabularyPanel > summary').click();await page.locator('#vocabularyLibraryRefresh').click();
 await page.locator('[data-vocab-list]').first().waitFor();for(const checkbox of await page.locator('[data-vocab-list]').all())await checkbox.check();await page.locator('#vocabularyLibraryImport').click();await page.locator('#vocabularyLibraryApply').click();
 assert.equal(await page.locator('#vocabularyRows tr').count(),11);assert.equal(await page.locator('#vocabularyRows .quiz-picture img').count(),1);
 const knowledge=page.locator('#vocabularyRows tr').filter({has:page.locator('[data-knowledge-language]')});
 await knowledge.locator('[data-knowledge-language]').selectOption('hebrew');assert.match(await knowledge.locator('[data-vocab-field="definitionDistractors"]').inputValue(),/שורש/);
 await knowledge.locator('[data-knowledge-language]').selectOption('english');assert.match(await knowledge.locator('[data-vocab-field="definitionDistractors"]').inputValue(),/Root/);
 await page.locator('#vocabularyGenerate').click();await page.getByText(/Generated \d+ editable questions/).waitFor();
 assert.equal(await page.locator('#questions .quiz-picture img').count(),1);
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();
 assert(saved.questions.some(q=>q.image?.src===picture.src));assert(saved.vocabulary.rows.some(r=>r.picture?.src===picture.src));
 await page.reload();await page.locator('[data-id="custom-local"]').click();await page.locator('#questions .quiz-picture img').waitFor({state:'attached'});assert.equal(await page.locator('#questions .quiz-picture img').count(),1);
 const previewPromise=context.waitForEvent('page');await page.locator('#preview').click();const preview=await previewPromise;await preview.waitForLoadState();
 // Confirm the student preview retains the image even if another question is initially shown.
 await preview.locator('.quiz-picture img').waitFor({state:'attached'});assert.equal(await preview.locator('.quiz-picture img').count(),1);await preview.close();
 for(const width of [1200,390]){await page.setViewportSize({width,height:900});await page.locator('#questions .quiz-picture').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'quiz overflow');await page.screenshot({path:'/tmp/penina-quiz-builder-'+width+'.png'});}
 // Start a knowledge-only Live room, inspect teacher and student presentation.
 const made=await h.create({pathnames:[kpath],seconds:0}),{code,hostToken}=made.body,joined=await h.join(code);
 await page.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/live/');await page.evaluate(({code,hostToken})=>sessionStorage.setItem('penina-live-host-'+code,hostToken),{code,hostToken});
 await page.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/live/?host=1&code='+code);await page.locator('[data-action="start"]').click();await page.locator('.live-picture img').waitFor({state:'visible'});
 for(const width of [1200,390]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('.live-picture img').getAttribute('src'),picture.src);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'live overflow');await page.screenshot({path:'/tmp/penina-live-'+width+'.png'});}
 const student=await context.newPage();await student.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/live/');await student.evaluate(({code,token})=>sessionStorage.setItem('penina-live-student-'+code,token),{code,token:joined.body.studentToken});await student.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/live/?code='+code);await student.locator('.live-picture img').waitFor({state:'visible'});assert.equal(await student.locator('.live-picture img').getAttribute('src'),picture.src);
 assert.deepEqual(errors,[]);console.log('Passed mixed-list selection, 7 Gamify games at desktop/mobile widths, quiz import/language/generation/save/reload/preview, and Live host/student pictures.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
