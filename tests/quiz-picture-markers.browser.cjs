// Local-only browser regression: in-memory API fixtures; all external requests blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),model=require(root+'/lib/quiz-builder-model');
let saved;
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')){
 let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};let data={role:'teacher',name:'Local Teacher',userId:7};
 if(url.searchParams.get('game')==='quiz-builder'){
 if(body.action==='list')data={email:'local@example.test',quizzes:saved?[{id:saved.id,title:saved.title,count:saved.questions.length,published:false}]:[]};
 else if(body.action==='save'){saved={...model.validateQuiz(body.quiz),id:'custom-local',published:false};data={quiz:saved};}
 else if(body.action==='load')data={quiz:saved};else throw Error('Unexpected action '+body.action);
 }
 res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
 }
 let file=path.resolve(root,'.'+url.pathname);if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
 let browser;
 try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1200,height:1000}}),errors=[];await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(origin+'/Penina-Quizzes/builder/');await page.getByText('Connected as local@example.test').waitFor();
 await page.locator('#title').fill('Marker check');await page.locator('#type').selectOption('picture');await page.locator('#add').click();
 const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=700;canvas.height=450;const c=canvas.getContext('2d');c.fillStyle='#eef4ea';c.fillRect(0,0,700,450);for(let i=0;i<5;i++){c.fillStyle=['#356b52','#d09c4b','#6885ad','#b46b76','#7c6d99'][i];c.fillRect(30+i*130,70+i*30,90,130);}return canvas.toDataURL('image/png').split(',')[1];});
 const question=i=>page.locator('#questions [data-index="'+i+'"]');
 await question(0).locator('[data-picture-file]').setInputFiles({name:'diagram.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await question(0).locator('[data-picture-target] img').waitFor();await page.waitForFunction(()=>!busy);
 await question(0).locator('[data-field="prompt"]').fill('Identify the first shape.');await question(0).locator('[data-field="answer"]').fill('Green shape');
 await question(0).locator('[data-picture-target]').click({position:{x:50,y:80}});
 for(let i=1;i<5;i++){
 await question(0).locator('[data-action="add-marker"]').click();
 assert.equal(await page.locator('#questions .question').count(),1,'adding markers keeps one question');
 assert.equal(await question(0).locator('.picture-marker').count(),i+1);
 assert.equal(await question(0).locator('[data-picture-marker]').inputValue(),String(i));
 await question(0).locator('[data-picture-answer="'+i+'"]').fill('Answer '+(i+1));
 await question(0).locator('[data-picture-target]').click({position:{x:80+i*60,y:120+i*20}});
 }
 assert.equal(await question(0).locator('[data-action="add-marker"]').isDisabled(),true,'five markers disables adding a sixth');
 const first=await page.evaluate(()=>structuredClone(quiz.questions[0]));
 await question(0).locator('[data-picture-marker]').selectOption('1');await question(0).locator('[data-picture-target]').press('ArrowRight');
 const moved=await page.evaluate(()=>quiz.questions[0].image.markers);
 assert.equal(moved[1].x,first.image.markers[1].x+.01);assert.deepEqual(moved.filter((_,i)=>i!==1),first.image.markers.filter((_,i)=>i!==1));
 await question(0).locator('[data-field="points"]').fill('2');await question(0).locator('[data-field="scoringMode"][value="response"]').check();
 assert.match(await page.locator('#summary').textContent(),/10 regular points/);
 await question(0).locator('[data-field="scoringMode"][value="total"]').check();assert.match(await page.locator('#summary').textContent(),/2 regular points/);
 await question(0).locator('[data-field="scoringMode"][value="response"]').check();
 const markerAnswers=await page.evaluate(()=>structuredClone(quiz.questions[0].pictureAnswers));
 async function preview(mode){
 const opened=context.waitForEvent('page');await page.locator('#preview').click();const student=await opened;student.on('pageerror',e=>errors.push(e.message));
 await student.locator('#start').click();const inputs=student.locator('#questions textarea');
 assert.equal(await inputs.count(),mode==='markers'?5:1);assert.equal(await student.locator('#questions .picture-marker').count(),5);
 for(let i=0;i<await inputs.count();i++)await inputs.nth(i).fill('Student response '+(i+1));
 await student.reload();await student.locator('#exam').waitFor();assert.equal(await inputs.nth(0).inputValue(),'Student response 1');
 await student.locator('#next').click();await student.locator('#reviewed').check();await student.locator('#submit').click();await student.locator('#receipt').waitFor();
 assert.match(await student.locator('#answerFeedback').textContent(),/Teacher will correct/);
 if(mode==='markers')assert.match(await student.locator('#answerFeedback').textContent(),/Marker 5: Student response 5/);
 await student.close();
 }
 await preview('markers');
 await question(0).locator('[data-picture-response]').selectOption('shared');
 assert.match(await page.locator('#summary').textContent(),/2 regular points/);assert.equal(await question(0).locator('[data-picture-answer]').count(),0);
 await question(0).locator('[data-field="answer"]').fill('Describe all five shapes');await preview('shared');
 await question(0).locator('[data-picture-response]').selectOption('markers');assert.deepEqual(await page.evaluate(()=>quiz.questions[0].pictureAnswers),markerAnswers);
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();assert.equal(saved.questions.length,1);assert.equal(saved.questions[0].image.markers.length,5);model.validateQuiz(saved,true);
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>quiz.questions[0].pictureAnswers),markerAnswers);
 for(const width of [1200,390,320]){await page.setViewportSize({width,height:1000});await question(0).locator('.picture-actions').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'/tmp/penina-markers-'+width+'.png'});}
 await question(0).locator('[data-action="copy"]').click();await question(1).locator('[data-picture-marker]').selectOption('1');await question(1).locator('[data-action="remove-marker"]').click();
 assert.equal(await question(1).locator('.picture-marker').count(),4);assert.equal(await question(0).locator('.picture-marker').count(),5);
 assert.deepEqual(await page.evaluate(()=>quiz.questions[1].pictureAnswers),markerAnswers.filter((_,i)=>i!==1));
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 await page.evaluate(()=>{quiz.published=true;render();});assert.equal(await question(0).locator('[data-action="add-marker"]').isDisabled(),true);
 // Older imported lettered targets start with a shared answer, then can opt into marker answers.
 saved={...saved,questions:[{type:'text',pictureQuestion:true,prompt:'Imported picture',answer:'Shared answer',points:2,direction:'ltr',image:{src:saved.questions[0].image.src,alt:'Imported',marker:null,targets:[{x:.2,y:.3},{x:.7,y:.8}]}}]};
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 assert.equal(await question(0).locator('[data-picture-response]').inputValue(),'shared');
 await question(0).locator('[data-picture-response]').selectOption('markers');assert.equal(await question(0).locator('[data-picture-answer]').count(),2);
 assert.equal(await question(0).locator('[data-picture-answer="0"]').inputValue(),'Shared answer');
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 // Regression: the live saved draft had a one-marker legacy group in question 16.
 const legacyImage={src:saved.questions[0].image.src,alt:'Legacy',marker:null,markers:[{x:.2,y:.3}]};
 saved.questions=[...Array.from({length:15},(_,i)=>({type:'text',prompt:'Existing question '+(i+1),answer:'Existing answer '+(i+1),points:1,direction:'ltr'})),{type:'text',pictureQuestion:true,pictureGroup:'saved-picture',markerIndex:0,prompt:'Where is Rashi?',answer:'Rashi',points:1,extraCredit:true,direction:'ltr',image:legacyImage}];
 const earlierQuestions=structuredClone(saved.questions.slice(0,15));
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 assert.equal(await question(15).getByRole('button',{name:'＋ Add marker',exact:true}).count(),1);
 for(let i=1;i<5;i++){
 await question(15).getByRole('button',{name:'＋ Add marker',exact:true}).click();
 assert.equal(await page.locator('#questions .question').count(),16,'legacy draft must stay at 16 questions after every added marker');
 assert.equal(await question(15).locator('.picture-marker').count(),i+1);
 }
 assert.equal(await question(15).locator('[data-action="add-marker"]').isDisabled(),true);
 assert.equal(await question(15).locator('[data-picture-answer="0"]').inputValue(),'Rashi');
 assert.equal(await question(15).locator('[data-field="prompt"]').inputValue(),'Where is Rashi?');
 await question(15).locator('[data-field="scoringMode"][value="response"]').check();
 assert.match(await page.locator('#summary').textContent(),/16 questions · 15 regular points · 5 extra-credit points/);
 await question(15).locator('[data-picture-response]').selectOption('shared');
 assert.match(await page.locator('#summary').textContent(),/16 questions · 15 regular points · 1 extra-credit points/);
 await question(15).locator('[data-picture-response]').selectOption('markers');
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 assert.equal(saved.questions.length,16);assert.deepEqual(saved.questions.slice(0,15).map(q=>[q.prompt,q.answer]),earlierQuestions.map(q=>[q.prompt,q.answer]));
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 assert.equal(await page.locator('#questions .question').count(),16);assert.equal(await question(15).locator('.picture-marker').count(),5);
 assert.equal(await question(15).locator('[data-picture-answer="0"]').inputValue(),'Rashi');
 // Already-authored legacy groups retain their existing questions, never append another.
 saved.questions=[{type:'text',pictureQuestion:true,prompt:'Legacy marker',answer:'Legacy answer',points:1,direction:'ltr',image:{src:legacyImage.src,alt:'Legacy',marker:{x:.2,y:.3}}}];
 require(root+'/Penina-Quizzes/picture').addMarker(saved.questions,saved.questions[0]);
 saved.questions[1].prompt='Second existing prompt';saved.questions[1].answer='Second existing answer';
 const secondLegacy=structuredClone(saved.questions[1]);
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 await question(0).locator('[data-action="add-marker"]').click();assert.equal(await page.locator('#questions .question').count(),2);
 assert.equal(await question(0).locator('.picture-marker').count(),3);assert.equal(await question(1).locator('.picture-marker').count(),2);
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 assert.equal(saved.questions[1].prompt,secondLegacy.prompt);assert.equal(saved.questions[1].answer,secondLegacy.answer);assert.deepEqual(saved.questions[1].image,secondLegacy.image);assert.equal(saved.questions[1].markerIndex,1);
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 await question(1).locator('[data-picture-marker]').selectOption('0');await question(1).locator('[data-picture-target]').press('ArrowRight');
 assert.equal(await page.evaluate(()=>quiz.questions[1].image.markers[0].x),secondLegacy.image.markers[0].x+.01);
 assert.equal(await page.evaluate(()=>quiz.questions[0].image.markers[0].x),secondLegacy.image.markers[0].x,'editing an existing question keeps the other question independent');
 // Generated written and multiple-choice questions with an image must expose controls too.
 for(const type of ['text','choice']){
 saved.questions=[{type,prompt:'Generated picture question',answer:type==='text'?'Blue':['Blue'],...(type==='choice'?{choices:['Blue','Red']}:{ }),points:1,direction:'ltr',image:{src:saved.questions[0].image.src,alt:'Generated picture',marker:null}}];
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 for(let i=0;i<5;i++)await question(0).locator('[data-action="add-marker"]').click();
 assert.equal(await question(0).locator('.picture-marker').count(),5,type+' image exposes five markers');
 assert.equal(await question(0).locator('[data-action="add-marker"]').isDisabled(),true);
 assert.equal(await page.evaluate(()=>quiz.questions[0].type),type,'marker edits keep the question format');
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 }
 // The change-type popup supports marker placement before applying, including cancel without mutation.
 saved.questions[0].image={src:saved.questions[0].image.src,alt:'Conversion picture',marker:null};
 await page.reload();await page.locator('#library [data-id="custom-local"]').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
 const beforeConversion=await page.evaluate(()=>JSON.stringify(quiz.questions[0]));
 async function markInPopup(){
 await question(0).locator('[data-action="change-type"]').click();await page.locator('#conversionType').selectOption('picture');
 const preview=page.locator('#conversionPreview');
 for(let i=0;i<5;i++)await preview.locator('[data-action="add-marker"]').click();
 assert.equal(await preview.locator('.picture-marker').count(),5);assert.equal(await preview.locator('[data-action="add-marker"]').isDisabled(),true);
 await preview.locator('[data-picture-marker]').selectOption('1');await preview.locator('[data-picture-target]').press('ArrowRight');
 assert.equal(await page.evaluate(()=>JSON.stringify(quiz.questions[0])),beforeConversion,'preview keeps the original unchanged');
 }
 await markInPopup();await page.locator('#cancelQuestionType').click();assert.equal(await page.evaluate(()=>JSON.stringify(quiz.questions[0])),beforeConversion);
 await markInPopup();
 for(const width of [1200,390,320]){await page.setViewportSize({width,height:1000});assert(await page.locator('#conversionDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:'/tmp/penina-conversion-markers-'+width+'.png'});}
 await page.locator('#replaceQuestionType').click();await page.getByText('Question type changed. Review the question and answer key, then save your draft.',{exact:true}).waitFor();
 assert.equal(await question(0).locator('.picture-marker').count(),5);assert.equal(await question(0).locator('[data-picture-response]').inputValue(),'shared');
 await question(0).locator('[data-picture-response]').selectOption('markers');assert.equal(await question(0).locator('[data-picture-answer]').count(),5);
 await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();model.validateQuiz(saved,true);
 assert.deepEqual(errors,[]);console.log('Passed: legacy 16-question draft stays at 16 through five markers and save/reload; authored legacy groups preserve their existing questions; five markers within one question, shared/per-marker answers, total/per-response points, selected-marker movement, save/reload, student preview and answer recovery/submission, independent duplication/removal, published lock, generated-question controls, conversion-popup add/move/cancel/apply, and desktop/mobile layout. Screenshots: /tmp/penina-markers-{1200,390,320}.png');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
