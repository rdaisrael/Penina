// Local browser regression: real audio decoding/encoding and microphone capture,
// with in-memory storage and all external requests blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),model=require(root+'/lib/quiz-builder-model'),audio=require(root+'/Penina-Quizzes/question-audio');
let saved,failUploads=false,uploads=0;const takes=new Map();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};let data={role:'teacher',name:'Local Teacher',userId:7};
   if(url.searchParams.get('game')==='quiz-builder'){
    if(body.action==='list')data={email:'local@example.test',quizzes:saved?[{id:saved.id,title:saved.title,count:saved.questions.length,published:!!saved.published}]:[]};
    else if(body.action==='save'){saved={...model.validateQuiz(body.quiz),id:'custom-local',published:false};data={quiz:saved};}
    else if(body.action==='load')data={quiz:saved};
    else if(body.action==='publish'){model.validateQuiz(saved,true);saved.published=true;data={quiz:saved};}
    else if(body.action==='question-audio-save'){
     if(failUploads)throw Error('Temporary upload failure');
     const take=takes.get(body.audioId)||{parts:[]};takes.set(body.audioId,take);take.parts[body.part]=body.audio;take.totalBytes=body.totalBytes;uploads++;
     if(body.part===Math.ceil(body.totalBytes/audio.PART_BYTES)-1){
      const bytes=Buffer.concat(take.parts.map(part=>Buffer.from(part,'base64')));assert.equal(bytes.length,body.totalBytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),body.audioId);
      take.teacherAudio={id:body.audioId,durationMs:audio.inspect(bytes)};data={saved:true,teacherAudio:take.teacherAudio};
     }else data={partSaved:true,part:body.part};
    }else if(body.action==='question-audio-load'){
     const take=takes.get(body.audioId);assert(take?.teacherAudio);data={id:body.audioId,part:body.part,totalBytes:take.totalBytes,audio:take.parts[body.part]};
    }else throw Error('Unexpected action '+body.action);
   }
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
  }
  let file=path.resolve(root,'.'+url.pathname);if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
function wav(seconds){return Buffer.from(audio.encode(Float32Array.from({length:seconds*audio.RATE},(_,i)=>Math.sin(2*Math.PI*440*i/audio.RATE)*.1)));}
(async()=>{
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1200,height:900},permissions:['microphone']}),errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
  const page=await context.newPage();await page.goto(origin+'/Penina-Quizzes/builder/');await page.getByText('Connected as local@example.test').waitFor();
  const question=i=>page.locator('#questions [data-index="'+i+'"]'),file=(seconds,name='audio.wav')=>({name,mimeType:'audio/wav',buffer:wav(seconds)});
  const types=['text','choice','multi','gaps','order','match','picture','recording','section'];
  for(let i=0;i<types.length;i++){
   await page.locator('#type').selectOption(types[i]);await page.locator('#add').click();
   assert.equal(await question(i).locator('[data-picture-file]').count(),1);assert.equal(await question(i).locator('[data-teacher-audio-file]').count(),1);assert.equal(await question(i).locator('[data-teacher-audio-record]').count(),1);
   await question(i).locator('[data-field="prompt"]').fill(types[i]==='gaps'?'The answer is <<A>>.':'Listen and answer '+types[i]);
   await question(i).locator('[data-picture-file]').setInputFiles({name:'picture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=','base64')});
   await question(i).locator('.quiz-picture img').waitFor();await page.waitForFunction(()=>!busy);
   await question(i).locator('[data-teacher-audio-file]').setInputFiles(file(1));await question(i).getByText('Recording attached. Save your draft to keep it with this question.').waitFor();await page.waitForFunction(()=>!busy);
  }
  assert.equal(await page.evaluate(()=>quiz.questions.filter(q=>q.image && q.teacherAudio).length),types.length);
  const firstId=await page.evaluate(()=>quiz.questions[0].teacherAudio.id);
  await question(0).locator('[data-question-audio-load]').click();await page.waitForFunction(()=>document.querySelector('[data-index="0"] .question-audio audio').readyState>=2);
  assert.equal(await question(0).locator('.question-audio audio').evaluate(el=>el.duration),1);
  // Rejected media leaves the previous recording intact.
  const overlong=wav(300);const extended=Buffer.concat([overlong,Buffer.alloc(audio.RATE*2)]);extended.writeUInt32LE(extended.length-8,4);extended.writeUInt32LE(extended.length-44,40);
  await question(0).locator('[data-teacher-audio-file]').setInputFiles({name:'too-long.wav',mimeType:'audio/wav',buffer:extended});await question(0).getByText(/longer than 5 minutes/).waitFor();assert.equal(await page.evaluate(()=>quiz.questions[0].teacherAudio.id),firstId);
  await question(0).locator('[data-teacher-audio-file]').setInputFiles({name:'invalid.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('Not audio')});await question(0).getByText(/could not be read/).waitFor();assert.equal(await page.evaluate(()=>quiz.questions[0].teacherAudio.id),firstId);
  // A failed replacement remains playable and retryable, without changing the saved attachment.
  failUploads=true;await question(0).locator('[data-teacher-audio-file]').setInputFiles(file(2));await question(0).getByText(/Temporary upload failure/).waitFor();await page.waitForFunction(()=>!busy);
  assert.equal(await page.evaluate(()=>quiz.questions[0].teacherAudio.id),firstId);await question(0).locator('[data-teacher-audio-preview]').waitFor();
  assert(await page.locator('#duplicate').isDisabled());assert(await question(0).locator('[data-action="change-type"]').isDisabled());
  await page.locator('#save').click();await page.locator('#status').filter({hasText:'Finish uploading or discard'}).waitFor();
  failUploads=false;await question(0).locator('[data-teacher-audio-retry]').click();await question(0).getByText(/Recording attached/).waitFor();await page.waitForFunction(()=>!busy);assert.notEqual(await page.evaluate(()=>quiz.questions[0].teacherAudio.id),firstId);
  // Real browser microphone capture and playback, including the automatic stop.
  await question(1).locator('[data-teacher-audio-record]').click();await question(1).locator('[data-teacher-audio-stop]').waitFor();assert(await page.locator('#save').isDisabled());
  await page.waitForTimeout(1100);await question(1).locator('[data-teacher-audio-stop]').click();await question(1).getByText(/Recording attached/).waitFor();await page.waitForFunction(()=>!busy);
  await question(1).locator('[data-question-audio-load]').click();await page.waitForFunction(()=>document.querySelector('[data-index="1"] .question-audio audio').readyState>=2);
  await page.evaluate(()=>{window.originalNow=Date.now;window.audioTimeOffset=0;Date.now=()=>originalNow()+audioTimeOffset;});
  await question(2).locator('[data-teacher-audio-record]').click();await question(2).locator('[data-teacher-audio-stop]').waitFor();await page.waitForTimeout(1100);await page.evaluate(()=>{audioTimeOffset=301000;});
  await question(2).getByText(/Recording attached/).waitFor();await page.waitForFunction(()=>!busy);await page.evaluate(()=>{Date.now=originalNow;});
  await page.evaluate(()=>{window.originalGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await question(3).locator('[data-teacher-audio-record]').click();await question(3).getByText(/Microphone access was denied/).waitFor();await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=originalGetUserMedia;});
  // Five minutes uploads in several bounded requests and is decoded exactly.
  const before=uploads;await question(4).locator('[data-teacher-audio-file]').setInputFiles(file(300));await question(4).getByText(/Recording attached/).waitFor({timeout:30000});await page.waitForFunction(()=>!busy);assert.equal(uploads-before,7);
  await question(4).locator('[data-question-audio-load]').click();await page.waitForFunction(()=>document.querySelector('[data-index="4"] .question-audio audio').readyState>=2);assert.equal(await question(4).locator('.question-audio audio').evaluate(el=>el.duration),300);
  await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();const savedMedia=JSON.stringify(saved.questions.map(q=>({image:q.image,teacherAudio:q.teacherAudio})));
  await page.reload();await page.locator('#library [data-id]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(quiz.questions.map(q=>({image:q.image,teacherAudio:q.teacherAudio})))),savedMedia);
  await page.locator('#duplicate').click();assert.equal(await page.evaluate(()=>JSON.stringify(quiz.questions.map(q=>({image:q.image,teacherAudio:q.teacherAudio})))),savedMedia);
  const opened=context.waitForEvent('page');await page.locator('#preview').click();const student=await opened;await student.locator('#start').click();
  assert.equal(await student.locator('#questions .question-audio').count(),types.length);assert.equal(await student.locator('#questions .quiz-picture').count(),types.length);
  await student.locator('[data-question="0"] [data-question-audio-load]').click();await student.waitForFunction(()=>document.querySelector('[data-question="0"] .question-audio audio').readyState>=2);
  await student.locator('[data-question="0"] .question-audio audio').evaluate(el=>el.play());await student.waitForFunction(()=>document.querySelector('[data-question="0"] .question-audio audio').currentTime>0);
  assert.equal(await student.locator('[name="q0-0"]').inputValue(),'','teacher audio never fills a student answer');
  const output='/private/tmp/penina-question-media';fs.mkdirSync(output,{recursive:true});
  for(const width of [1200,390]){
   await page.setViewportSize({width,height:900});await student.setViewportSize({width,height:900});
   for(const target of [page,student])assert(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await question(0).screenshot({path:path.join(output,'builder-'+width+'.png')});await student.locator('[data-question="0"]').screenshot({path:path.join(output,'student-'+width+'.png')});
  }
  await question(0).locator('[data-teacher-audio-remove]').click();assert.equal(await question(0).locator('.question-audio').count(),0);assert.equal(await page.evaluate(()=>quiz.questions[1].teacherAudio!==undefined),true);
  assert.deepEqual(errors,[]);console.log('Passed all question media controls, upload/decoding, real microphone capture/playback, automatic stop, denial, five-minute multipart audio, failed replacement/retry, save/load/duplicate, student preview, removal, and desktop/mobile layout. Screenshots: '+output);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
