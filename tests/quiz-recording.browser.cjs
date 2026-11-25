// Local fixture API only. Chromium records from a synthetic microphone; no external calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const model=require('../lib/quiz-builder-model'),{validateRecording,completeRecording}=require('../lib/quiz-recording');
const root=path.resolve(__dirname,'..'),output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-recording-'));
const quizId='custom-'+'a'.repeat(32),classId='b'.repeat(32),attempts=new Map(),audio=new Map(),audioParts=new Map(),records=[];
let quiz,failUploads=false,failPart=-1,saves=0,correction;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},game=url.searchParams.get('game'),action=body.action || url.searchParams.get('action');
   let result={role:'teacher',userId:7,name:'Local Teacher'};
   if(game==='quiz-builder'){
    if(action==='list')result={email:'teacher@example.test',quizzes:quiz?[{id:quizId,title:quiz.title,count:quiz.questions.length}]:[]};
    else if(action==='save'){quiz={...model.validateQuiz(body.quiz),id:quizId,published:false};result={quiz};}
    else if(action==='load')result={quiz};else throw Error('Unexpected builder action '+action);
   }else if(game==='quiz-account'){
    if(action==='teacher')result={role:'teacher',userId:7,name:'Local Teacher',apps:['quizzes']};
    else if(action==='student')result={...quiz,questions:model.publicQuestions(quiz),sub:'student',name:'Local Student',email:'student@example.test',className:'Test class'};
    else if(action==='config')result={configured:true};else if(action==='courses')result={email:'teacher@example.test',courses:[]};else if(action==='assignments')result={assignments:[]};else throw Error('Unexpected account action '+action);
   }else if(game==='assessment-custom'){
    const attempt=attempts.get(body.id);
    if(action==='start'){const created={id:body.id,token:body.id,deadline:quiz.durationMinutes===null?null:Date.now()+quiz.durationMinutes*60000,lockedThrough:-1,forwardOnly:false,lockedAnswers:[]};attempts.set(body.id,created);result=created;}
    else if(action==='state')result=attempt;
    else if(action==='recording-save'){
     if(failUploads || body.part===failPart){failPart=-1;throw Error('Temporary upload failure');}
     let value=validateRecording(body,quiz.questions[body.index]);const key=body.id+':'+body.index+':'+body.reference;
     if(value.part!==undefined){
      const parts=audioParts.get(key) || new Map();parts.set(value.part,value);audioParts.set(key,parts);
      if(value.part===value.totalParts-1)value=completeRecording([...parts.values()],value,quiz.questions[body.index]);else result={partSaved:true,part:value.part};
     }
     if(value.part===undefined){audio.set(key,value);saves++;result={saved:true};}
    }
    else if(action==='recording-load'){const key=body.id+':'+body.index+':'+body.reference;result=(body.part===undefined?audio.get(key):audioParts.get(key)?.get(body.part)) || (()=>{throw Error('Recording missing');})();}
    else if(action==='recordings-delete-preview')result={count:audio.size,bytes:500000,token:'local-preview'};
    else if(action==='recordings-delete'){assert.equal(body.token,'local-preview');assert.equal(body.confirmPermanentDeletion,true);result={deleted:audio.size};audio.clear();audioParts.clear();for(const r of records)r.deletedRecordings=[0];}
    else if(action==='recording-review'){const record=records.find(r=>r.id===body.id),key=body.id+':'+body.index+':'+record.answers[body.index][0];result=body.part===undefined?audio.get(key):audioParts.get(key)?.get(body.part);}
    else if(action==='advance'){assert(model.validAnswers({questions:quiz.questions.slice(0,body.through+1)},body.answers.slice(0,body.through+1)));Object.assign(attempt,{lockedThrough:body.through,forwardOnly:true,lockedAnswers:body.answers.slice(0,body.through+1)});result=attempt;}
    else if(action==='submit'){
     assert(model.validAnswers(quiz,body.answers,attempt.deadline!==null && attempt.deadline<=Date.now()));
     for(let i=0;i<quiz.questions.length;i++)if(quiz.questions[i].type==='recording'&&body.answers[i][0])assert(audio.has(body.id+':'+i+':'+body.answers[i][0]));
     const record={id:body.id,sub:'student',name:'Local Student',email:'student@example.test',classId,className:'Test class',answers:body.answers,submittedAt:new Date().toISOString(),grading:model.grade(quiz,body.answers)};records.push(record);result={accepted:true,answers:record.answers,submittedAt:record.submittedAt,automatic:[],classroom:{turnedIn:true}};
    }else if(action==='report')result={title:quiz.title,questions:quiz.questions,submissions:records,roster:null};
    else if(action==='correct'){correction=body;const r=records.find(r=>r.id===body.id);r.grading=model.grade(quiz,r.answers,{...body,savedAt:new Date().toISOString()});result={grading:r.grading};}
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
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1200,height:900}}),errors=[];let acceptDialogs=true;
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin || route.request().url().startsWith('data:')?route.continue():route.abort());
  context.on('page',page=>{page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('dialog',dialog=>acceptDialogs?dialog.accept():dialog.dismiss());});
  const builder=await context.newPage();await builder.goto(origin+'/Penina-Quizzes/builder/');await builder.getByText('Connected as teacher@example.test').waitFor({timeout:10000}).catch(async error=>{console.error(await builder.locator('body').innerText());throw error;});
  await builder.locator('#title').fill('Recorded reading');await builder.locator('#type').selectOption('recording');await builder.locator('#add').click();
  await builder.locator('[data-field="prompt"]').fill('Read the text and describe the picture.');
  await builder.locator('[data-field="content"]').fill('בְּרֵאשִׁית\nRead this passage aloud. <Do not render HTML>');
  await builder.locator('[data-field="answer"]').fill('PRIVATE RUBRIC');await builder.locator('[data-field="points"]').fill('3');await builder.locator('[data-field="allowHalfCredit"]').check();
  await builder.locator('[data-field="direction"][value="rtl"]').check();
  assert.equal(await builder.locator('[data-field="recordingMinutes"]').inputValue(),'3');
  assert.deepEqual(await builder.locator('[data-field="recordingMinutes"] option').allTextContents(),['3 minutes','5 minutes','10 minutes']);
  await builder.locator('[data-field="recordingMinutes"]').selectOption('10');assert.equal(await builder.evaluate(()=>quiz.questions[0].recordingMinutes),10);
  await builder.locator('[data-field="recordingMinutes"]').selectOption('5');
  await builder.locator('[data-picture-file]').setInputFiles({name:'picture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=','base64')});
  await builder.locator('.quiz-picture img').waitFor();await builder.locator('#save').click();await builder.getByText('Draft saved.',{exact:true}).waitFor();
  await builder.reload();await builder.locator('#library [data-id]').click();await builder.getByText('Draft loaded.',{exact:true}).waitFor();
  assert.equal(await builder.locator('[data-field="content"]').inputValue(),quiz.questions[0].content);assert.equal(quiz.questions[0].type,'recording');assert(quiz.questions[0].image);assert.equal(quiz.questions[0].recordingMinutes,5);assert.equal(await builder.locator('[data-field="recordingMinutes"]').inputValue(),'5');
  await builder.locator('#type').selectOption('text');await builder.locator('#add').click();await builder.locator('[data-index="1"] [data-field="prompt"]').fill('What did you learn?');
  await builder.locator('#checkpoint').selectOption('1');await builder.locator('#save').click();await builder.getByText('Draft saved.',{exact:true}).waitFor();
  for(const width of [1200,390]){await builder.setViewportSize({width,height:900});assert(await builder.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await builder.screenshot({path:path.join(output,'builder-'+width+'.png'),fullPage:true});}
  const student=await context.newPage();
  // Keep the real encoder, but simulate a browser clearing its MIME label on
  // stop. The actual captured chunks must still supply the correct container.
  await student.addInitScript(()=>{
   const descriptor=Object.getOwnPropertyDescriptor(MediaRecorder.prototype,'mimeType');
   Object.defineProperty(MediaRecorder.prototype,'mimeType',{...descriptor,get(){return this.state==='inactive'?'':descriptor.get.call(this);}});
  });
  await student.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+classId);await student.locator('#start').click();
  const first=student.locator('[data-recorder="0"]');await first.getByText(/Maximum: 5 minutes/).waitFor();
  for(const width of [1200,390]){await student.setViewportSize({width,height:900});assert(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await student.locator('[data-question="0"]').screenshot({path:path.join(output,'student-'+width+'.png')});}
  await first.locator('[data-recording-start]').click();await first.locator('[data-recording-stop]').waitFor();await student.waitForTimeout(1200);
  failUploads=true;await first.locator('[data-recording-stop]').click();await first.getByText(/Temporary upload failure/).waitFor();
  const reference=await first.locator('input').inputValue();assert.match(reference,/^recording:/);assert.equal(saves,0);
  // An unsaved take from the old code may already have a quoted/spaced codec
  // label. Recover and upload those real audio bytes without another recording.
  await student.evaluate(async reference=>{
   await new Promise((resolve,reject)=>{
    const open=indexedDB.open('penina-quiz-recordings',1);open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
     const database=open.result,tx=database.transaction('audio','readwrite'),store=tx.objectStore('audio'),key=DRAFT+':'+saved.id+':'+reference,read=store.get(key);
     read.onsuccess=()=>{
      const value=read.result;value.audio=value.audio.replace(/^data:audio\/(mp4|webm|ogg);base64,/,(_,format)=>'data:audio/'+format+'; codecs="'+(format==='mp4'?'mp4a.40.2':'opus')+'";base64,');
      if(!value.audio.includes('; codecs="'))return reject(Error('Expected a supported real audio container'));
      store.put(value,key);
     };
     tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
   });
  },reference);
  await student.reload();await first.locator('[data-recording-play]').waitFor();assert.equal(await first.locator('input').inputValue(),reference);
  await first.locator('[data-recording-play]').click();await student.waitForFunction(()=>document.querySelector('[data-recorder] audio').readyState>=2,{},{timeout:8000}).catch(async error=>{console.error('Playback:',await first.innerText(),await first.locator('audio').evaluate(a=>({src:a.src.slice(0,150),error:a.error?.message,ready:a.readyState,network:a.networkState})));throw error;});
  failUploads=false;await student.locator('#next').click();await student.locator('#checkpointPage').waitFor();assert.equal(saves,1);
  await student.locator('#reviewEarlier').click();await first.locator('[data-recording-start]').click();await first.locator('[data-recording-stop]').waitFor();await student.waitForTimeout(1000);
  await student.locator('#next').click();await student.locator('#checkpointPage').waitFor();assert.equal(saves,2,'Next stops and saves the replacement');
  let replacement=await first.locator('input').inputValue();assert.notEqual(replacement,reference);
  // A failed redo retains the saved take; successful retry promotes the redo.
  await student.locator('#reviewEarlier').click();
  async function failedRedo(){
   failUploads=true;
   await first.locator('[data-recording-start]').click();await first.locator('[data-recording-stop]').waitFor();await student.waitForTimeout(1000);
   await first.locator('[data-recording-stop]').click();await first.getByText(/Temporary upload failure/).waitFor();
   await first.locator('[data-recording-previous]').waitFor();
   const failed=await first.locator('input').inputValue();assert.notEqual(failed,replacement);return failed;
  }
  const retried=await failedRedo();failUploads=false;
  await first.locator('[data-recording-retry]').click();await first.getByText('Recording saved. Listen below or record again.',{exact:true}).waitFor();
  assert(await first.locator('[data-recording-previous]').isHidden());replacement=retried;assert.equal(saves,3);
  // Repeated failures and reloads keep pointing back to the last saved answer,
  // never to another unsaved redo. Recovery permits a normal quiz submission.
  await failedRedo();await student.reload();await first.locator('[data-recording-previous]').waitFor();
  for(const width of [1200,390]){await student.setViewportSize({width,height:900});assert(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await first.screenshot({path:path.join(output,'recovery-'+width+'.png')});}
  await failedRedo();await student.reload();await first.locator('[data-recording-previous]').waitFor();
  await first.locator('[data-recording-previous]').click();await first.getByText(/Using your previous saved recording/).waitFor();
  assert.equal(await first.locator('input').inputValue(),replacement);assert(await first.locator('[data-recording-retry]').isHidden());
  await first.locator('[data-recording-play]').click();await student.waitForFunction(()=>document.querySelector('[data-recorder] audio').readyState>=2);
  // Nothing new needs uploading when the student keeps the saved take.
  await student.locator('#next').click();await student.locator('#checkpointPage').waitFor();assert.equal(saves,3);failUploads=false;
  await student.locator('#confirmCheckpoint').click();await student.locator('[name="q1-0"]').fill('I learned to read clearly.');assert(await first.locator('[data-recording-start]').isDisabled());
  await student.reload();await student.locator('[name="q1-0"]').waitFor();assert.equal(await first.locator('input').inputValue(),replacement);assert(await student.locator('#previous').isDisabled());
  await student.locator('#next').click();await student.locator('#reviewed').check();await student.locator('#submit').click();await student.locator('#receipt').waitFor();
  assert.equal(records.length,1);assert.equal(records[0].grading.pending,2);assert.equal(records[0].answers[0][0],replacement);
  await student.locator('#answerFeedback [data-recording-play]').click();await student.waitForFunction(()=>document.querySelector('#answerFeedback audio').readyState>=2);
  assert(!await student.locator('#answerFeedback').innerText().then(s=>s.includes(replacement)||s.includes('PRIVATE RUBRIC')));
  const teacher=await context.newPage();await teacher.goto(origin+'/Penina-Quizzes/custom/teacher.html?quiz='+quizId);await teacher.locator('#reports details summary').click();
  await teacher.locator('#reports [data-recording-play]').click();await teacher.waitForFunction(()=>document.querySelector('#reports audio').readyState>=2);
  await teacher.locator('[name="manual0"]').fill('2.5');await teacher.locator('[name="manual1"]').fill('1');await teacher.locator('[name="explanation0"]').fill('Speak more slowly.');await teacher.getByRole('button',{name:'Save corrections',exact:true}).click();await teacher.locator('.saveStatus').filter({hasText:'Corrections saved.'}).waitFor();
  assert.deepEqual(correction.scores,[2.5,1]);assert.equal(records[0].grading.total,3.5);assert.equal(correction.explanations[0],'Speak more slowly.');
  for(const width of [1200,390]){await teacher.setViewportSize({width,height:900});assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await teacher.locator('.review-question').first().screenshot({path:path.join(output,'teacher-'+width+'.png')});}
  await teacher.locator('#recordingRetention').waitFor();
  assert.match(await teacher.locator('#recordingRetention').innerText(),/quiz owner receives email reminders 10 and 5 days/);
  for(const width of [1200,390]){await teacher.setViewportSize({width,height:900});await teacher.locator('#recordingRetention').screenshot({path:path.join(output,'retention-'+width+'.png')});}
  const recordingsBeforeDeletion=audio.size;acceptDialogs=false;await teacher.locator('#deleteRecordings').click();
  await teacher.locator('#recordingRetentionStatus').filter({hasText:'Deletion canceled.'}).waitFor();assert.equal(audio.size,recordingsBeforeDeletion);
  acceptDialogs=true;await teacher.locator('#deleteRecordings').click();await teacher.locator('#recordingRetentionStatus').filter({hasText:'Deleted'}).waitFor();
  assert.equal(audio.size,0);assert.equal(records[0].grading.total,3.5);assert.equal(correction.explanations[0],'Speak more slowly.');
  await teacher.locator('#reports details summary').click();await teacher.locator('.recording-deleted').waitFor();assert.equal(await teacher.locator('#reports [data-recording-play]').count(),0);
  // A real recording is stopped and uploaded before the timer submits.
  quiz={...quiz,durationMinutes:1,forwardOnlyFrom:null,questions:[quiz.questions[0]]};
  const timed=await context.newPage();await timed.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+'c'.repeat(32));await timed.locator('#start').click();await timed.locator('[data-recording-start]').click();await timed.locator('[data-recording-stop]').waitFor();await timed.waitForTimeout(1000);
  await timed.evaluate(()=>{saved.attempt.deadline=Date.now()-1;tick();});for(const attempt of attempts.values())attempt.deadline=Date.now()-1;
  await timed.locator('#receipt').waitFor();assert.equal(records.length,2);assert.match(records[1].answers[0][0],/^recording:/);
  // Denied microphone access leaves the student able to retry without a false answer.
  const denied=await context.newPage();await denied.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await denied.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+'d'.repeat(32));await denied.locator('#start').click();await denied.locator('[data-recording-start]').click();await denied.getByText(/Microphone access was denied/).waitFor();assert.equal(await denied.locator('[name="q0-0"]').inputValue(),'');assert(!await denied.locator('[data-recording-start]').isDisabled());
  // Preview recordings never call submission or recording storage endpoints.
  const before=saves,submissionsBefore=records.length;const popupPromise=context.waitForEvent('page');await builder.locator('#preview').click();const preview=await popupPromise;
  await preview.locator('#start').click();await preview.locator('[data-recording-start]').click();await preview.locator('[data-recording-stop]').waitFor();await preview.waitForTimeout(1000);await preview.locator('[data-recording-stop]').click();await preview.getByText('Preview recording ready. Listen below.').waitFor();await preview.reload();await preview.locator('[data-recording-play]').click();await preview.waitForFunction(()=>document.querySelector('[data-recorder] audio').readyState>=2);assert.equal(saves,before);assert.equal(records.length,submissionsBefore);
  // Advance wall-clock time while using the real recorder to exercise each
  // question's stop threshold without waiting ten minutes in the test.
  quiz={...quiz,durationMinutes:null,forwardOnlyFrom:null,questions:[{...quiz.questions[0],recordingMinutes:10},{...quiz.questions[0],recordingMinutes:3}]};
  const limits=await context.newPage();await limits.addInitScript(()=>{const now=Date.now;window.recordingTestOffset=0;Date.now=()=>now()+window.recordingTestOffset;});
  await limits.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+'e'.repeat(32));await limits.locator('#start').click();
  await limits.locator('[data-recorder="0"] [data-recording-start]').click();await limits.locator('[data-recorder="0"] [data-recording-stop]').waitFor();await limits.waitForTimeout(1000);
  await limits.evaluate(()=>{window.recordingTestOffset=181000;});await limits.waitForTimeout(400);assert(await limits.locator('[data-recorder="0"] [data-recording-stop]').isVisible(),'ten-minute question continues past three minutes');
  assert.match(await limits.locator('[data-recorder="0"] [data-recording-status]').innerText(),/\/ 10:00/);
  await limits.evaluate(()=>{window.recordingTestOffset=601000;});await limits.locator('[data-recorder="0"] [data-recording-status]').filter({hasText:'Recording saved.'}).waitFor();
  assert.equal([...audio.values()].at(-1).durationMs,600000);
  await limits.locator('#next').click();await limits.locator('[data-recorder="1"]').getByText(/Maximum: 3 minutes\./).waitFor();
  await limits.locator('[data-recorder="1"] [data-recording-start]').click();await limits.locator('[data-recorder="1"] [data-recording-stop]').waitFor();await limits.waitForTimeout(1000);
  await limits.evaluate(()=>{window.recordingTestOffset+=181000;});await limits.locator('[data-recorder="1"] [data-recording-status]').filter({hasText:'Recording saved.'}).waitFor();assert.equal([...audio.values()].at(-1).durationMs,180000);
  if(process.env.RECORDING_LONG_AUDIO){
   // Seed a stopped recording in the same recovery store used after a reload.
   // The optional fixture is a real MP4 audio file >2 MB and longer than 3 minutes.
   const bytes=fs.readFileSync(process.env.RECORDING_LONG_AUDIO);assert(bytes.length>2000000);
   quiz={...quiz,questions:[{...quiz.questions[0],recordingMinutes:10}]};
   const long=await context.newPage();await long.goto(origin+'/Penina-Quizzes/custom/?quiz='+quizId+'&class='+'f'.repeat(32));await long.locator('#start').click();
   const reference='recording:'+'f'.repeat(32),source='data:audio/mp4;base64,'+bytes.toString('base64');
   const id=await long.evaluate(async({audio,reference})=>{
    await new Promise((resolve,reject)=>{const open=indexedDB.open('penina-quiz-recordings',1);open.onupgradeneeded=()=>open.result.createObjectStore('audio');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const database=open.result,tx=database.transaction('audio','readwrite');tx.objectStore('audio').put({audio,durationMs:200000},DRAFT+':'+saved.id+':'+reference);tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);};});
    document.querySelector('[name="q0-0"]').value=reference;snapshot();recorder.refresh();return saved.id;
   },{audio:source,reference});
   failPart=1;await long.locator('#next').click();await long.locator('#status').filter({hasText:'Temporary upload failure'}).waitFor();
   const key=id+':0:'+reference;assert.equal(audioParts.get(key).size,1);assert(!audio.has(key));
   await long.reload();await long.locator('#next').click();await long.locator('#review').waitFor();assert(audio.get(key).chunked);
   await long.locator('#previous').click();await long.locator('[data-recording-play]').click();await long.waitForFunction(()=>document.querySelector('[data-recorder] audio').readyState>=2);
   assert.equal(await long.locator('[data-recorder] audio').evaluate(a=>a.src),source,'all uploaded bytes return intact');
   await long.locator('#next').click();await long.locator('#reviewed').check();await long.locator('#submit').click();await long.locator('#receipt').waitFor();
   const review=await context.newPage();await review.goto(origin+'/Penina-Quizzes/custom/teacher.html?quiz='+quizId);const card=review.locator('#submission-'+id);
   await card.locator('summary').click();await card.locator('[data-recording-play]').click();await review.waitForFunction(id=>document.querySelector('#submission-'+id+' audio').readyState>=2,id);
   await card.locator('audio').evaluate(audio=>audio.play());await review.waitForFunction(id=>document.querySelector('#submission-'+id+' audio').currentTime>0.1,id);
   assert.equal(await card.locator('audio').evaluate(a=>a.src),source);assert(await card.locator('audio').evaluate(a=>a.duration>199 && a.duration<201));await card.locator('audio').evaluate(a=>a.pause());
   console.log('Passed real 200-second audio file: multi-part upload, interrupted part recovery after reload, byte-exact restore, student submission, and teacher playback.');
  }
  assert.deepEqual(errors,[]);console.log('Passed configurable per-question limits, dropdown options 3/5/10 minutes and automatic stop at 3 and 10 minutes, continuing beyond the old 3-minute cap, authoring, save/reload, real recording/playback, cleared recorder MIME labels, quoted-label recovery, failed-redo retries and fallback after reload, checkpoint/reload, submission, teacher grading, timer expiry, denied permission, isolated preview, and responsive layout.');console.log('Screenshots: '+output);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
