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
 assert.equal(await page.locator('#bold-words').isChecked(),false);
 assert.equal(await page.locator('#highlight-words').isChecked(),false);
 await page.evaluate(()=>{document.getElementById('bold-words').checked=true;document.getElementById('highlight-words').checked=true;});
 assert.equal(await page.locator('#question-count').inputValue(),'10');
 const backup=process.env.READER_BACKUP ? JSON.parse(fs.readFileSync(process.env.READER_BACKUP,'utf8')) : null;
 await page.evaluate(backup=>{
  document.getElementById('story-viewport').style.display='block';
  document.getElementById('questions-viewport').style.display='block';
  let result, worksheet;
  if(backup){
   const saved=backup.readerResult;
   const data={text:saved.text,words:saved.words};
   result=ReaderCore.buildResult(saved.text,ReaderCore.validateAnalysis(data,saved.vocabulary));
   worksheet=backup.worksheet;
  }else{
   const text='סיפור בדיקה\n'+Array(8).fill('הילד קורא ספר בבית. הספר מספר על הר גבוה ועל עיר רחוקה. הילדה לומדת בבית וקוראת ספר חדש.').join('\n');
   const words=ReaderCore.words(text).map(([word])=>({word,mastered:false,translation:'meaning',match:'',form:'',prefix:''}));
   result=ReaderCore.buildResult(text,ReaderCore.validateAnalysis({text,words},{mode:'complete',words:['ספר'],verbs:[],nouns:[],adjs:[],forms:[]}));
   worksheet={lang:'English',placement:'sections',worksheet:{title:'Questions',questions:Array.from({length:10},(_,i)=>({number:i+1,text:'What happened in the story?',lines:2,section:i<8?i+1:0}))}};
  }
  parseAndRenderOutput({text:result.text,readerResult:result});
  currentWorksheet=worksheet;
  document.getElementById('questions-viewport').style.display='block';
  document.querySelector('input[name="footnote-placement"][value="page"]').checked=true;
  renderStoryToScreen();
 },backup);
 async function check(label){
  const state=await page.evaluate(()=>{
   const out=document.getElementById('questions-output');
   return {words:out.querySelectorAll('.reader-token').length,expected:currentResult.words.length,
    questions:out.querySelectorAll('.worksheet-question').length,expectedQuestions:currentWorksheet.worksheet.questions.length,
    titleDir:getComputedStyle(out.querySelector('.story-title')).direction,
    pages:[...out.querySelectorAll('.reader-page')].map(p=>({height:p.clientHeight,scroll:p.scrollHeight,
     ids:[...new Set([...p.querySelectorAll('.footnote-marker')].filter(m=>m.style.display!=='none').map(m=>m.dataset.fn))],
     notes:[...p.querySelectorAll('.footnote-entry')].map(n=>n.dataset.noteId)}))};
  });
  assert.equal(state.words,state.expected,label+' words');
  assert.equal(state.questions,state.expectedQuestions,label+' questions');
  assert.equal(state.titleDir,'rtl');assert.ok(state.pages.length>1);
  for(const p of state.pages){assert.ok(p.scroll<=p.height+1,label+' overflow '+JSON.stringify(p));assert.deepEqual(p.ids,p.notes);}
  console.log(label, state.pages.length+' pages; all words/questions retained, footnotes fit');
 }
 await check('integrated');
 const emphasis=await page.evaluate(()=>[...document.querySelectorAll('#questions-output .reader-token')].some(t=>[...t.querySelectorAll('*')].some(e=>getComputedStyle(e).fontWeight==='700' && getComputedStyle(e).color==='rgb(30, 144, 255)')));
 assert.ok(emphasis,'mastered words visibly bold and blue');
 const orphan=await page.evaluate(()=>[...document.querySelectorAll('#questions-output .section-questions')].some(q=>q.previousElementSibling?.matches('.worksheet-reading-section') && q.closest('.reader-page')!==q.previousElementSibling.closest('.reader-page')));
 assert.equal(orphan,false);
 await page.locator('#footnote-display').selectOption('first');await check('first references');
 await page.locator('#footnote-display').selectOption('none');await check('no notes');
 await page.locator('#footnote-display').selectOption('all');
 await page.emulateMedia({media:'print'});
 await page.evaluate(()=>{document.body.classList.add('print-story-worksheet');renderStoryToScreen();});
 await check('print');
 await page.pdf({path:path.join(outputDir,'integrated.pdf'),preferCSSPageSize:true,printBackground:true});
 await page.emulateMedia({media:'screen'});
 await page.locator('#questions-output .reader-page').first().screenshot({path:path.join(outputDir,'integrated.png')});
 await page.locator('input[name="footnote-placement"][value="end"]').check();
 assert.equal(await page.locator('#questions-output .reader-page').count(),0);
 assert.equal(await page.locator('#questions-output .generated-footnotes').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed. Artifacts:',outputDir);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
