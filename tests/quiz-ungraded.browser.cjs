// Local browser fixture; every external request is blocked. Server handlers are
// covered separately by quiz-builder.test.js with the real storage/auth flow.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const model=require('../lib/quiz-builder-model'),scoring=require('../Penina-Quizzes/custom/scoring');
const root=path.resolve(__dirname,'..'),output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-ungraded-'));
const quizId='custom-'+'a'.repeat(32),classId='b'.repeat(32),attempts=new Map(),records=[];
let quiz,correction,emailFailure=false,emailed;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},game=url.searchParams.get('game'),action=body.action || url.searchParams.get('action');
   let result={role:'teacher',userId:7,name:'Local Teacher'};
   if(game==='quiz-builder'){
    if(action==='list')result={email:'teacher@example.test',quizzes:quiz?[{id:quizId,title:quiz.title,count:quiz.questions.filter(q=>q.type!=='section').length,published:quiz.published}]:[]};
    else if(action==='save'){quiz={...model.validateQuiz(body.quiz),id:quizId,published:false};result={quiz};}
    else if(action==='load')result={quiz};else if(action==='publish'){quiz={...model.validateQuiz(quiz,true),id:quizId,published:true};result={quiz};}else throw Error('Unexpected builder action '+action);
   }else if(game==='quiz-account'){
    if(action==='teacher')result={...result,apps:['quizzes']};
    else if(action==='student')result={...quiz,questions:model.publicQuestions(quiz),sub:'student',name:'Local Student',email:'student@example.test',className:'Test class'};
    else if(action==='config')result={configured:true,gradingMode:quiz.gradingMode};else if(action==='courses')result={email:'teacher@example.test',courses:[]};else if(action==='assignments')result={assignments:[]};else throw Error('Unexpected account action '+action);
   }else if(game==='assessment-custom'){
    const attempt=attempts.get(body.id);
    if(action==='start'){const created={id:body.id,token:body.id,deadline:null,lockedThrough:-1,forwardOnly:false,lockedAnswers:[]};attempts.set(body.id,created);result=created;}
    else if(action==='state')result=attempt;
    else if(action==='advance'){assert(model.validAnswers({questions:quiz.questions.slice(0,body.through+1)},body.answers.slice(0,body.through+1)));Object.assign(attempt,{lockedThrough:body.through,forwardOnly:true,lockedAnswers:body.answers.slice(0,body.through+1)});result=attempt;}
    else if(action==='submit'){
     assert(model.validAnswers(quiz,body.answers));const record={id:body.id,sub:'student',name:'Local Student',email:'student@example.test',classId,className:'Test class',answers:body.answers,submittedAt:new Date().toISOString(),grading:model.grade(quiz,body.answers)};records.push(record);result={accepted:true,answers:record.answers,submittedAt:record.submittedAt,automatic:scoring.feedback(quiz.questions,body.answers,true,quiz.gradingMode)};
    }else if(action==='report')result={title:quiz.title,gradingMode:quiz.gradingMode,questions:quiz.questions,submissions:records,roster:{className:'Test class',classId,assigned:true,students:[{name:'Local Student',status:'submitted',submissionId:records[0]?.id},{name:'Waiting Student',status:'not-started'}]}};
    else if(action==='correct'){
     correction=body;const r=records.find(r=>r.id===body.id);assert(model.validCorrections(quiz,body.scores));assert.equal(body.sendToClassroom,false);
     const studentSentAt=r.grading.feedback===body.feedback?r.grading.studentSentAt:null;
     r.grading=model.grade(quiz,r.answers,{...body,savedAt:new Date().toISOString(),studentSentAt});result={grading:r.grading};
     if(body.emailStudent){
      emailed=require('../lib/quiz-correction-email').correctedTest({record:r,questions:quiz.questions,grading:r.grading,title:quiz.title});
      if(emailFailure)result.emailError='Email unavailable';
      else {r.grading.studentSentAt=new Date().toISOString();result.email={status:'accepted',to:r.email};}
     }
    }
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
  context.on('page',page=>{page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());});
  const builder=await context.newPage();await builder.goto(origin+'/Penina-Quizzes/builder/');await builder.getByText('Connected as teacher@example.test').waitFor();
  assert.equal(await builder.locator('#gradingMode').inputValue(),'graded');
  await builder.locator('#title').fill('Class reflection');await builder.locator('#type').selectOption('text');await builder.locator('#add').click();
  await builder.locator('[data-field="prompt"]').fill('What did you learn?');await builder.locator('[data-field="points"]').fill('5');await builder.locator('[data-field="extraCredit"]').check();
  await builder.locator('#gradingMode').selectOption('ungraded');
  const gradeControls='[data-field="points"],[data-field="extraCredit"],[data-field="allowHalfCredit"],[data-field="scoringMode"]';
  assert.equal(await builder.locator(gradeControls).count(),0);assert.equal(await builder.locator('[data-field="direction"]').count(),2);
  await builder.locator('[data-field="prompt"]').fill('What did you learn?');assert.equal(await builder.locator('.extra-credit-badge:visible').count(),0);assert.equal(await builder.locator('.question.extra-credit').count(),0);assert.match(await builder.locator('#summary').innerText(),/Not graded/);assert.doesNotMatch(await builder.locator('#questions').innerText(),/credit|points|graded by you/i);
  // Re-selecting grading before saving restores the original settings.
  await builder.locator('#gradingMode').selectOption('graded');assert.equal(await builder.locator('[data-field="points"]').inputValue(),'5');assert(await builder.locator('[data-field="extraCredit"]').isChecked());
  await builder.locator('#gradingMode').selectOption('ungraded');
  await builder.locator('#type').selectOption('choice');await builder.locator('#add').click();
  await builder.locator('[data-index="1"] [data-field="prompt"]').fill('How did the lesson feel?');await builder.locator('[data-choice="0"]').fill('Easy');await builder.locator('[data-choice="1"]').fill('Challenging');
  assert.equal(await builder.locator('[data-correct]:visible').count(),0);
  await builder.locator('#type').selectOption('multi');await builder.locator('#add').click();await builder.locator('[data-index="2"] [data-field="prompt"]').fill('Which activities helped?');
  await builder.locator('[data-index="2"] [data-choice="0"]').fill('Reading');await builder.locator('[data-index="2"] [data-choice="1"]').fill('Listening');
  await builder.locator('#save').click();await builder.getByText('Draft saved.',{exact:true}).waitFor();
  assert.equal(quiz.gradingMode,'ungraded');assert(quiz.questions.every(q=>q.points===0 && !q.extraCredit));
  await builder.reload();await builder.locator('#library [data-id]').click();await builder.getByText('Draft loaded.',{exact:true}).waitFor();
  assert.equal(await builder.locator('#gradingMode').inputValue(),'ungraded');assert.equal(await builder.locator(gradeControls).count(),0);
  // A saved ungraded quiz can become graded again with valid default points.
  await builder.locator('#gradingMode').selectOption('graded');assert.equal(await builder.locator('[data-index="0"] [data-field="points"]').inputValue(),'1');
  await builder.locator('#gradingMode').selectOption('ungraded');
  for(const width of [1200,390]){await builder.setViewportSize({width,height:900});assert(await builder.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await builder.screenshot({path:path.join(output,'builder-'+width+'.png'),fullPage:true});}
  await builder.locator('#printQuiz').click();assert.match(await builder.locator('.qp-meta').innerText(),/Not graded/);assert.equal(await builder.locator('.qp-points').count(),0);assert.doesNotMatch(await builder.locator('.qp-paper').innerText(),/points|extra.credit/i);await builder.locator('#closeQuizPrint').click();
  await builder.locator('#publish').click();await builder.locator('#confirmPublish').click();await builder.getByText('Published. Open teacher tools to assign this quiz to a class.',{exact:true}).waitFor();assert(await builder.locator('#gradingMode').isDisabled());assert.equal(quiz.gradingMode,'ungraded');
  async function complete(page){
   await page.locator('#start').click();assert.doesNotMatch(await page.locator('[data-question="0"]').innerText(),/point|credit/i);
   await page.locator('[name="q0-0"]').fill('I learned a new word.');await page.locator('#next').click();await page.locator('[name="q1-0"][value="Challenging"]').check();await page.locator('#next').click();
   await page.getByLabel('Reading',{exact:true}).check();await page.getByLabel('Listening',{exact:true}).check();await page.locator('#next').click();await page.locator('#reviewed').check();await page.locator('#submit').click();await page.locator('#receipt').waitFor();
   assert.doesNotMatch(await page.locator('#answerFeedback').innerText(),/correct|credit|point/i);assert.match(await page.locator('#answerFeedback').innerText(),/I learned a new word/);
  }
  const student=await context.newPage();await student.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+classId);await student.locator('#start').waitFor();
  assert.match(await student.locator('#quizSummary').innerText(),/Not graded/);assert.doesNotMatch(await student.locator('#quiz').innerText(),/graded automatically|await.*correction|score is not shown/i);await complete(student);
  assert.equal(records.length,1);assert.equal(records[0].grading.total,null);assert.equal(records[0].grading.pending,0);
  const teacher=await context.newPage();await teacher.goto(origin+'/Penina-Quizzes/custom/teacher.html?quiz='+quizId);await teacher.locator('#reports details summary').click();
  assert.match(await teacher.locator('#reportHeading').innerText(),/Review responses/);assert.equal(await teacher.locator('.review-question').count(),3);assert.equal(await teacher.locator('#reports input[type="number"]').count(),0);assert.equal(await teacher.locator('#reports').getByRole('button',{name:/Classroom/}).count(),0);
  assert(await teacher.locator('#summaryPanel').isHidden());assert.equal(await teacher.locator('[data-grading-column]:visible').count(),0);
  assert.doesNotMatch(await teacher.locator('#reports').innerText(),/points|awaiting correction|correct answer|extra.credit|save corrections/i);
  const sendFeedback=teacher.getByRole('button',{name:'Save and email feedback',exact:true});
  assert(await sendFeedback.isEnabled());await sendFeedback.click();await teacher.locator('.saveStatus').filter({hasText:'Enter teacher feedback'}).waitFor();assert.equal(correction,undefined);
  await teacher.locator('[name="feedback"]').fill('Thanks for sharing.');await teacher.getByRole('button',{name:'Save feedback',exact:true}).click();await teacher.locator('.saveStatus').filter({hasText:'Feedback saved.'}).waitFor();assert.deepEqual(correction.scores,[]);assert.equal(correction.sendToClassroom,false);
  emailFailure=true;await teacher.locator('[name="feedback"]').fill('Thanks for sharing. Please add an example.');assert(await sendFeedback.isEnabled());await sendFeedback.click();
  await teacher.locator('.saveStatus').filter({hasText:'Your feedback is saved; you can retry emailing.'}).waitFor();assert.equal(correction.emailStudent,true);assert.equal(await teacher.locator('#reports details').getAttribute('open'),'');assert(await sendFeedback.isEnabled());
  assert.equal(await teacher.locator('#rosterRows [aria-label="Emailed to student"]').count(),0);
  await teacher.reload();await teacher.locator('#reports details summary').click();assert.equal(await teacher.locator('[name="feedback"]').inputValue(),'Thanks for sharing. Please add an example.');
  emailFailure=false;await sendFeedback.click();await teacher.locator('#reports summary').filter({hasText:'Feedback emailed to student'}).waitFor();
  assert.equal(await teacher.locator('#reports details').getAttribute('open'),null);assert.equal(await teacher.locator('#rosterRows [aria-label="Emailed to student"]').count(),1);
  assert.match(emailed.text,/Please add an example/);assert.doesNotMatch(emailed.text,/score|points|I learned a new word/);
  await teacher.reload();await teacher.locator('#reports details summary').click();assert.match(await teacher.locator('#reports summary').innerText(),/Feedback emailed/);
  await teacher.locator('[name="feedback"]').fill('Thanks for sharing. Keep practicing!');assert(await sendFeedback.isEnabled());await teacher.getByRole('button',{name:'Save feedback',exact:true}).click();await teacher.locator('.saveStatus').filter({hasText:'Feedback saved.'}).waitFor();
  assert.doesNotMatch(await teacher.locator('#reports summary').innerText(),/Feedback emailed/);assert.equal(await teacher.locator('#rosterRows [aria-label="Emailed to student"]').count(),0);
  const downloadPromise=teacher.waitForEvent('download');await teacher.locator('#export').click();const download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/I learned a new word/);assert.match(csv,/Thanks for sharing/);assert.doesNotMatch(csv,/points|score|awaiting correction/i);
  for(const width of [1200,390]){await teacher.setViewportSize({width,height:900});assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await teacher.screenshot({path:path.join(output,'teacher-'+width+'.png'),fullPage:true});}
  const popupPromise=context.waitForEvent('page');await builder.locator('#preview').click();const preview=await popupPromise;await complete(preview);assert.equal(records.length,1);
  await builder.locator('#duplicate').click();assert.equal(await builder.locator('#gradingMode').inputValue(),'ungraded');assert(!(await builder.locator('#gradingMode').isDisabled()));assert.equal(await builder.locator(gradeControls).count(),0);
  assert.deepEqual(errors,[]);console.log('Passed not-graded authoring, switching, save/reload, publication, duplication, student submission, preview, teacher feedback email, blank-email validation, failure/retry, sent status, CSV, print, and mobile layouts.');console.log('Artifacts: '+output);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
