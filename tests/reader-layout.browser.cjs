// Run with Node and Playwright installed; optional PLAYWRIGHT_MODULE and CHROME_EXECUTABLE overrides.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const outputDir=fs.mkdtempSync(path.join(require('os').tmpdir(),'reader-layout-'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='reader.test')return route.abort();
  const file=path.join(repo,decodeURIComponent(url.pathname));
  try{await route.fulfill({path:file});}catch{await route.abort();}
 });
 await page.goto('http://reader.test/PeninaPlus-Reader/index.html');
 await page.evaluate(()=>document.fonts.ready);
 assert.deepEqual(await page.locator('#footnote-display option').allTextContents(),['Each occurance','First occurance only','No Footnotes']);
 await page.locator('#pathway-b-radio').check();
 assert.equal(await page.locator('#vocab-upload-b').isVisible(),true);
 assert.equal(await page.locator('#vocab-complete-b').isVisible(),false);
 assert.equal(await page.locator('input[name="vocab-mode-b"]:checked').inputValue(),'upload');
 await page.evaluate(()=>{
  document.getElementById('story-viewport').style.display='block';
  const paragraph='הילד קורא ספר בבית. הספר מספר על הר גבוה ועל עיר רחוקה. הילדה לומדת בבית וקוראת ספר חדש. ';
  const text='סיפור בדיקה\n'+Array(12).fill(paragraph).join('\n\n');
  const words=ReaderCore.words(text).map(([word])=>({word,mastered:false,translation:'A contextual meaning for '+word,match:'',form:'',prefix:''}));
  const profile={mode:'complete',words:[],verbs:[],nouns:[],adjs:[],forms:[]};
  const result=ReaderCore.buildResult(text,ReaderCore.validateAnalysis({text,words},profile));
  parseAndRenderOutput({text:result.text,readerResult:result});
 });
 await page.locator('input[name="footnote-placement"][value="page"]').check();
 async function check(label){
  const state=await page.evaluate(()=>({
   count:document.querySelectorAll('.reader-page').length,
   words:document.querySelectorAll('.reader-page-content .heb-word:not(.footnote-marker)').length,
   expected:currentResult.words.length,
   pages:Array.from(document.querySelectorAll('.reader-page')).map(p=>({height:p.clientHeight,scroll:p.scrollHeight,ids:[...new Set(Array.from(p.querySelectorAll('.footnote-marker')).filter(m=>m.style.display!=='none').map(m=>m.dataset.fn))],notes:Array.from(p.querySelectorAll('.footnote-entry')).map(n=>n.dataset.noteId)}))
  }));
  assert.equal(state.words,state.expected,label+' preserves words');
  assert.ok(state.count>1,label+' multiple pages');
  for(const p of state.pages){assert.ok(p.scroll<=p.height+1,label+' no overflow '+JSON.stringify(p));assert.deepEqual(p.ids,p.notes,label+' note references');}
  console.log(label, state.count+' pages, all '+state.words+' words retained, notes fit');
 }
 await check('first');
 await page.locator('#footnote-display').selectOption('all');await check('each');
 await page.evaluate(()=>{document.querySelectorAll('details').forEach(d=>d.open=true);document.getElementById('font-size').value='44';});await page.locator('#font-size').dispatchEvent('input');await check('larger font');
 await page.locator('#margin-choice').selectOption('right');await check('wide margin');
 await page.locator('#footnote-display').selectOption('none');await check('no notes');
 await page.locator('#footnote-display').selectOption('all');
 await page.locator('#toggle-line-numbers').check();await page.waitForTimeout(100);
 assert.ok(await page.locator('.reader-page:last-child .line-number').count()>0);
 await page.screenshot({path:path.join(outputDir,'reader-layout-controls.png'),fullPage:false});
 await page.locator('.reader-page').first().screenshot({path:path.join(outputDir,'reader-layout-page.png')});
 const previewPages=await page.locator('.reader-page').count();
 await page.emulateMedia({media:'print'});
 await page.evaluate(()=>renderStoryToScreen());await check('print');
 assert.equal(await page.locator('.reader-page').count(),previewPages,'print matches preview');
 await page.pdf({path:path.join(outputDir,'reader-layout.pdf'),preferCSSPageSize:true});
 await page.emulateMedia({media:'screen'});
 await page.locator('#toggle-line-numbers').uncheck();
 await page.locator('input[name="footnote-placement"][value="end"]').check();
 assert.equal(await page.locator('.reader-page').count(),0);
 assert.equal(await page.locator('.generated-footnotes').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed. Artifacts:',outputDir);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
