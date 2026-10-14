const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const core=require('../PeninaPlus-Reader/reader-core');
const repo=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[],calls=[];let failStory=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='reader.test')return route.abort();
   if(url.pathname==='/api/generate') {
    const request=route.request().postDataJSON();calls.push(request);
    let data;
    if(request.readerVocabulary) {
     const text='ספר\nספר\n\nספר\n\nספר';
     const analysis=core.validateAnalysis({text,words:[0,1,2,3].map(()=>({word:'ספר',mastered:true,translation:'book',match:'ספר',form:''}))},request.readerVocabulary);
     data=failStory?{error:'Test reading failure'}:{text,readerResult:core.buildResult(text,analysis)};
    } else {
     const count=Number(request.prompt.match(/exactly (\d+) questions/)[1]);
     const targets=request.prompt.match(/question-number order: (\[[0-9,]+\])/);
     const sections=targets?JSON.parse(targets[1]):null;
     data={text:'Book\n'+Array.from({length:count},(_,i)=>`${i+1}. ${sections ? '[SECTION '+sections[i]+'] ' : ''}What is the story about?\n[LINE]\n[LINE]`).join('\n')};
    }
    return route.fulfill({json:data});
   }
   try{await route.fulfill({path:path.join(repo,decodeURIComponent(url.pathname))});}catch{await route.abort();}
  });
  await page.goto('http://reader.test/PeninaPlus-Reader/index.html');
  assert.equal(await page.locator('#questions-lang').inputValue(),'English');
  assert.equal(await page.locator('#question-count').inputValue(),'10');
  for (const [id,value] of [['font-size','16'],['kerning','1'],['line-spacing','1.5'],['paragraph-spacing','2']])
   assert.equal(await page.locator('#'+id).inputValue(),value);
  assert.equal(await page.locator('#theme').evaluate(el=>getComputedStyle(el).textAlign),'left');
  assert.equal((await page.locator('#vocab-upload-a a[download]').textContent()).trim(),'Download Workbook Template');
  assert.ok(await page.evaluate(()=>document.querySelector('#questions-lang').compareDocumentPosition(document.querySelector('#question-count')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.ok(await page.evaluate(()=>document.querySelector('#question-count').compareDocumentPosition(document.querySelector('#question-placement')) & Node.DOCUMENT_POSITION_FOLLOWING));
  await page.locator('#comprehension-section').screenshot({path:'/private/tmp/reader-question-options.png'});
  assert.equal(await page.locator('#comprehension-section').isVisible(),true);
  assert.equal(await page.locator('#question-count').isVisible(),true);
  assert.equal(await page.locator('#generate-questions-btn').isDisabled(),true);
  assert.ok(await page.evaluate(()=>!!(document.getElementById('comprehension-section').compareDocumentPosition(document.getElementById('generate-btn')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.locator('#vocab-file-a').setInputFiles(path.join(repo,'PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
  await page.waitForFunction(()=>uploadedVocabA!==null);
  await page.locator('#theme').fill('ספר');
  await page.locator('#include-worksheet').check();
  await page.locator('#question-count').selectOption('2');
  await page.locator('#questions-lang').selectOption('English');
  await page.locator('#generate-btn').click();
  await page.waitForFunction(()=>document.getElementById('reader-status').textContent==='Worksheet ready.');
  assert.equal(calls.length,2);
  assert.match(calls[1].prompt,/in English with exactly 2 questions/);
  assert.equal(await page.locator('.worksheet-question-gap').count(),2);
  assert.equal(await page.locator('#questions-output .worksheet-reading-section').count(),3);
  assert.equal(await page.locator('#questions-output .section-questions').count(),2);
  assert.equal(await page.locator('#story-output .section-questions').count(),0);
  assert.equal(await page.locator('#print-worksheet-btn').textContent(),'Print Reading with Questions');
  assert.equal(await page.locator('#print-story-worksheet-btn').isVisible(),false);
  assert.ok(!(await page.locator('#questions-output').innerText()).includes('[SECTION'));
  assert.equal(await page.locator('#story-output').evaluate(el=>el.style.fontSize),'16pt');
  assert.equal(await page.locator('#story-output').evaluate(el=>el.style.letterSpacing),'1px');
  assert.equal(await page.locator('#story-output .story-body').first().evaluate(el=>getComputedStyle(el).lineHeight),'32px');
  assert.equal(await page.locator('#story-output .paragraph-break').first().evaluate(el=>Math.round(el.getBoundingClientRect().height)),43);
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#save-json-btn').click();
  const download=await downloadPromise;
  const backup=JSON.parse(require('node:fs').readFileSync(await download.path(),'utf8'));
  assert.equal(backup.format,'penina-reader-backup');
  assert.equal(backup.worksheet.lang,'English');
  assert.equal(backup.readerResult.words.length,4);
  assert.equal(backup.settings.find(s=>s.id==='font-size').value,'16');
  await page.evaluate(()=>{window.print=()=>{window.capturedPrintMode=document.body.className;};});
  await page.locator('#download-pdf-btn').click();
  assert.match(await page.evaluate(()=>window.capturedPrintMode),/print-worksheet-only/);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await page.locator('#print-controls-container').screenshot({path:'/private/tmp/reader-export-controls.png'});
  await page.emulateMedia({media:'print'});
  await page.evaluate(()=>document.body.classList.add('print-worksheet-only'));
  assert.equal(await page.locator('#story-viewport').isVisible(),false);
  assert.equal(await page.locator('#questions-viewport').isVisible(),true);
  await page.evaluate(()=>document.body.classList.remove('print-worksheet-only'));
  await page.emulateMedia({media:'screen'});
  await page.locator('#questions-output').screenshot({path:'/tmp/reader-section-questions.png'});
  await page.locator('input[name="question-placement"][value="end"]').check();
  await page.locator('#generate-questions-btn').click();
  await page.waitForFunction(()=>!document.getElementById('generate-questions-btn').disabled);
  assert.equal(await page.locator('#questions-output .worksheet-reading-section').count(),0);
  assert.equal(await page.locator('#print-story-worksheet-btn').isVisible(),true);
  await page.locator('#download-pdf-btn').click();
  assert.match(await page.evaluate(()=>window.capturedPrintMode),/print-story-worksheet/);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await page.locator('#include-worksheet').uncheck();
  await page.locator('#generate-btn').click();
  await page.waitForFunction(()=>document.getElementById('reader-status').textContent.startsWith('Reading ready.'));
  assert.equal(calls.length,4,'unchecked option generates only the reading');
  assert.equal(await page.locator('#questions-viewport').isVisible(),false);
  failStory=true;
  await page.locator('#include-worksheet').check();
  await page.locator('#generate-btn').click();
  await page.waitForFunction(()=>document.getElementById('reader-status').textContent.startsWith('Error:'));
  assert.equal(calls.length,5,'failed reading never starts a worksheet');
  assert.deepEqual(errors,[]);
  console.log('Worksheet setup checks passed: visible before generation, selected count/language, automatic generation, unchecked option, and reading failure.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
