// Local browser fixture; every external request is blocked. Server handlers are
// covered separately by quiz-builder.test.js with the real storage/auth flow.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const model=require('../lib/quiz-builder-model'),scoring=require('../Penina-Quizzes/custom/scoring');
const root=path.resolve(__dirname,'..'),output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-section-'));
const quizId='custom-'+'a'.repeat(32),classId='b'.repeat(32),attempts=new Map(),records=[];
let quiz,correction;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},game=url.searchParams.get('game'),action=body.action || url.searchParams.get('action');
   let result={role:'teacher',userId:7,name:'Local Teacher'};
   if(game==='quiz-builder'){
    if(action==='list')result={email:'teacher@example.test',quizzes:quiz?[{id:quizId,title:quiz.title,count:quiz.questions.filter(q=>q.type!=='section').length}]:[]};
    else if(action==='save'){quiz={...model.validateQuiz(body.quiz),id:quizId,published:false};result={quiz};}
    else if(action==='load')result={quiz};else throw Error('Unexpected builder action '+action);
   }else if(game==='quiz-account'){
    if(action==='teacher')result={...result,apps:['quizzes']};
    else if(action==='student')result={...quiz,questions:model.publicQuestions(quiz),sub:'student',name:'Local Student',email:'student@example.test',className:'Test class'};
    else if(action==='config')result={configured:true};else if(action==='courses')result={email:'teacher@example.test',courses:[]};else if(action==='assignments')result={assignments:[]};else throw Error('Unexpected account action '+action);
   }else if(game==='assessment-custom'){
    const attempt=attempts.get(body.id);
    if(action==='start'){const created={id:body.id,token:body.id,deadline:null,lockedThrough:-1,forwardOnly:false,lockedAnswers:[]};attempts.set(body.id,created);result=created;}
    else if(action==='state')result=attempt;
    else if(action==='advance'){assert(model.validAnswers({questions:quiz.questions.slice(0,body.through+1)},body.answers.slice(0,body.through+1)));Object.assign(attempt,{lockedThrough:body.through,forwardOnly:true,lockedAnswers:body.answers.slice(0,body.through+1)});result=attempt;}
    else if(action==='submit'){
     assert(model.validAnswers(quiz,body.answers));const record={id:body.id,sub:'student',name:'Local Student',email:'student@example.test',classId,className:'Test class',answers:body.answers,submittedAt:new Date().toISOString(),grading:model.grade(quiz,body.answers)};records.push(record);result={accepted:true,answers:record.answers,submittedAt:record.submittedAt,automatic:scoring.feedback(quiz.questions,body.answers,true)};
    }else if(action==='report')result={title:quiz.title,questions:quiz.questions,submissions:records,roster:null};
    else if(action==='correct'){correction=body;const r=records.find(r=>r.id===body.id);assert(model.validCorrections(quiz,body.scores));r.grading=model.grade(quiz,r.answers,{...body,savedAt:new Date().toISOString()});result={grading:r.grading};}
    else throw Error('Unexpected submission action '+action);
   }
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
  }
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:1200,height:900}}),errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin || route.request().url().startsWith('data:')?route.continue():route.abort());
  context.on('page',page=>{page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('dialog',dialog=>dialog.accept());});
  const builder=await context.newPage();await builder.goto(origin+'/Penina-Quizzes/builder/');await builder.getByText('Connected as teacher@example.test').waitFor();
  assert.equal(await builder.locator('#type option').first().textContent(),'Title/Section Page');assert.equal(await builder.locator('#type').inputValue(),'section');
  await builder.locator('#title').fill('A lesson in two sections');await builder.locator('#add').click();
  await builder.locator('[data-field="prompt"]').fill('Welcome to the lesson');await builder.locator('[data-field="content"]').fill('Read each passage carefully.\nUse the picture to help you. <This is plain text>');
  assert.equal(await builder.locator('[data-field="points"],[data-field="answer"]').count(),0);
  await builder.locator('[data-picture-file]').setInputFiles(path.join(root,'Penina-favicon.png'));await builder.locator('.quiz-picture img').waitFor();
  await builder.locator('[data-picture-alt]').fill('Penina classroom illustration');
  // Copy and reorder use the same established controls as quiz questions.
  await builder.locator('[data-action="copy"]').click();assert.equal(await builder.locator('[data-index]').count(),2);
  await builder.locator('[data-index="1"] [data-field="prompt"]').fill('Picture section');
  await builder.locator('[data-index="1"] [data-action="up"]').click();assert.equal(await builder.locator('[data-index="0"] [data-field="prompt"]').inputValue(),'Picture section');
  await builder.locator('[data-index="0"] [data-action="down"]').click();await builder.locator('[data-index="1"] [data-action="remove"]').click();
  await builder.locator('#type').selectOption('text');await builder.locator('#add').click();await builder.locator('[data-index="1"] [data-field="prompt"]').fill('What did you learn?');await builder.locator('[data-index="1"] [data-field="answer"]').fill('PRIVATE MODEL');await builder.locator('[data-index="1"] [data-field="points"]').fill('2');
  await builder.locator('#type').selectOption('section');await builder.locator('#add').click();await builder.locator('[data-index="2"] [data-picture-file]').setInputFiles(path.join(root,'Penina-favicon.png'));await builder.locator('[data-index="2"] img').waitFor();
  await builder.locator('#type').selectOption('choice');await builder.locator('#add').click();await builder.locator('[data-index="3"] [data-field="prompt"]').fill('Choose yes.');await builder.locator('[data-choice="0"]').fill('Yes');await builder.locator('[data-choice="1"]').fill('No');await builder.locator('[data-correct="0"]').check();await builder.locator('[data-index="3"] [data-field="points"]').fill('3');
  await builder.locator('#type').selectOption('section');await builder.locator('#add').click();await builder.locator('[data-index="4"] [data-field="content"]').fill('כל הכבוד!\nNow submit your work.');await builder.locator('[data-index="4"] [data-field="direction"]').selectOption('rtl');
  await builder.locator('#checkpoint').selectOption('2');assert.match(await builder.locator('#checkpoint option:checked').textContent(),/Before section page/);
  await builder.locator('#save').click();await builder.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(quiz,true);
  await builder.reload();await builder.locator('#library [data-id]').click();await builder.getByText('Draft loaded.',{exact:true}).waitFor();assert.equal(await builder.locator('[data-index="4"] [data-field="content"]').inputValue(),'כל הכבוד!\nNow submit your work.');assert.match(await builder.locator('#summary').textContent(),/2 questions.*3 title\/section pages.*5 regular points/);
  for(const width of [1200,390]){await builder.setViewportSize({width,height:900});assert(await builder.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await builder.locator('[data-index="0"]').screenshot({path:path.join(output,'builder-'+width+'.png')});}
  await builder.locator('#printQuiz').click();assert.equal(await builder.locator('.qp-section-page').count(),3);assert.equal(await builder.locator('.qp-question').count(),2);assert.match(await builder.locator('.qp-meta').innerText(),/2 questions.*5 points/);assert(!await builder.locator('#quizPrint').innerText().then(s=>s.includes('PRIVATE MODEL')));await builder.pdf({path:path.join(output,'sections.pdf'),format:'Letter',printBackground:true});await builder.locator('#closeQuizPrint').click();
  const student=await context.newPage();await student.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+classId);await student.locator('#start').click();await student.locator('[data-question="0"]').waitFor();assert.equal(await student.locator('#progress').textContent(),'Title/Section Page');assert.equal(await student.locator('[data-question="0"] input,[data-question="0"] textarea').count(),0);assert.match(await student.locator('[data-question="0"]').innerText(),/<This is plain text>/);
  for(const width of [1200,390]){await student.setViewportSize({width,height:900});assert(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await student.locator('[data-question="0"]').screenshot({path:path.join(output,'student-'+width+'.png')});}
  await student.locator('#next').click();assert.equal(await student.locator('#progress').textContent(),'Question 1 of 2');await student.locator('[name="q1-0"]').fill('I learned to read carefully.');await student.locator('#previous').click();assert.equal(await student.locator('#progress').textContent(),'Title/Section Page');await student.locator('#next').click();await student.locator('#next').click();await student.locator('#checkpointPage').waitFor();
  await student.locator('#confirmCheckpoint').click();await student.locator('[data-question="2"]').waitFor();await student.reload();await student.locator('[data-question="2"]').waitFor();assert(await student.locator('#previous').isDisabled());assert.equal(await student.locator('#next').textContent(),'Next');
  await student.locator('#next').click();await student.locator('[data-question="3"]').waitFor();assert.equal(await student.locator('#progress').textContent(),'Question 2 of 2');await student.locator('[name="q3-0"][value="Yes"]').check();await student.locator('#next').click();await student.locator('[data-question="4"]').waitFor();assert.equal(await student.locator('[data-question="4"] .section-paragraph').getAttribute('dir'),'rtl');
  await student.locator('#next').click();await student.locator('#reviewed').check();await student.locator('#submit').click();await student.locator('#receipt').waitFor();assert.deepEqual(records[0].answers,[[],['I learned to read carefully.'],[],['Yes'],[]]);assert.equal(records[0].grading.pending,1);assert.equal(records[0].grading.baseMax,5);assert.equal(await student.locator('#answerFeedback .needs-correction').count(),1);assert.equal(await student.locator('#answerFeedback .section-content').count(),3);
  const teacher=await context.newPage();await teacher.goto(origin+'/Penina-Quizzes/custom/teacher.html?quiz='+quizId);await teacher.locator('#reports details summary').click();assert.equal(await teacher.locator('#reports .review-question').count(),2);assert.equal(await teacher.locator('#reports .section-content').count(),3);assert.deepEqual(await teacher.locator('#reports .question-number').allTextContents(),['Question 1','Question 2']);assert.equal(await teacher.locator('#resultsHead button').count(),2);assert.equal(await teacher.locator('#summaryRows > tr').count(),2);
  await teacher.locator('[name="manual1"]').fill('2');await teacher.getByRole('button',{name:'Save corrections',exact:true}).click();await teacher.locator('.saveStatus').filter({hasText:'Corrections saved.'}).waitFor();assert.deepEqual(correction.scores,[2]);assert.equal(records[0].grading.total,5);
  const downloadPromise=teacher.waitForEvent('download');await teacher.locator('#export').click();const download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/1\. What did you learn\?/);assert.match(csv,/2\. Choose yes\./);assert(!csv.includes('Welcome to the lesson'));
  for(const width of [1200,390]){await teacher.setViewportSize({width,height:900});assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  // Preview navigates and submits section pages without an API submission.
  const before=records.length,popupPromise=context.waitForEvent('page');await builder.locator('#preview').click();const preview=await popupPromise;await preview.locator('#start').click();await preview.locator('[data-question="0"]').waitFor();await preview.locator('#next').click();await preview.locator('[name="q1-0"]').fill('Preview answer');await preview.locator('#next').click();await preview.locator('#confirmCheckpoint').click();await preview.locator('#next').click();await preview.locator('[name="q3-0"][value="Yes"]').check();await preview.locator('#next').click();await preview.locator('#next').click();await preview.locator('#reviewed').check();await preview.locator('#submit').click();await preview.locator('#receipt').waitFor();assert.equal(records.length,before);assert.equal(await preview.locator('#answerFeedback .needs-correction').count(),1);
  assert.deepEqual(errors,[]);console.log('Passed section-first authoring, paragraph/picture options, copy/reorder, save/reload, print, RTL, student navigation, checkpoints, receipt, grading, results, CSV, isolated preview, and mobile layouts.');console.log('Artifacts: '+output);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
