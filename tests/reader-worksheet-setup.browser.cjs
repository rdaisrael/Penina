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
     const text='ספר\nספר';
     const analysis=core.validateAnalysis({text,words:[0,1].map(()=>({word:'ספר',mastered:true,translation:'book',match:'ספר',form:''}))},request.readerVocabulary);
     data=failStory?{error:'Test reading failure'}:{text,readerResult:core.buildResult(text,analysis)};
    } else {
     const count=Number(request.prompt.match(/exactly (\d+) questions/)[1]);
     data={text:'Book\n'+Array.from({length:count},(_,i)=>`${i+1}. What is the story about?\n[LINE]\n[LINE]`).join('\n')};
    }
    return route.fulfill({json:data});
   }
   try{await route.fulfill({path:path.join(repo,decodeURIComponent(url.pathname))});}catch{await route.abort();}
  });
  await page.goto('http://reader.test/PeninaPlus-Reader/index.html');
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
  await page.locator('#include-worksheet').uncheck();
  await page.locator('#generate-btn').click();
  await page.waitForFunction(()=>document.getElementById('reader-status').textContent.startsWith('Reading ready.'));
  assert.equal(calls.length,3,'unchecked option generates only the reading');
  assert.equal(await page.locator('#questions-viewport').isVisible(),false);
  failStory=true;
  await page.locator('#include-worksheet').check();
  await page.locator('#generate-btn').click();
  await page.waitForFunction(()=>document.getElementById('reader-status').textContent.startsWith('Error:'));
  assert.equal(calls.length,4,'failed reading never starts a worksheet');
  assert.deepEqual(errors,[]);
  console.log('Worksheet setup checks passed: visible before generation, selected count/language, automatic generation, unchecked option, and reading failure.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
