// Local application and generated artifacts only; external requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const root=process.env.PENINA_ROOT||path.resolve(__dirname,'..');
const {makeStudentApp}=require(path.join(root,'lib/knowledge-publication'));
const study=require(path.join(root,'PeninaPlus-vocab-builder/offline-study-cards'));
const sheets=require(path.join(root,'PeninaPlus-vocab-builder/vocabulary-sheets'));
const ExcelJS=require(path.join(root,'PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js'));
const output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-editing-')),errors=[];
let exported;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/student.html')return res.end(makeStudentApp(exported));
 if(url.pathname==='/combined.html')return res.end(study.makeApp('Formatted cards',study.fromKnowledgeDeck(exported)));
 if(url.pathname==='/games.html')return res.end(study.makeClassGames('Formatted cards',study.fromKnowledgeDeck(exported)));
 if(url.pathname==='/sheet.html')return res.end(sheets.makeSheet('Formatted cards',exported.cards,{kind:'knowledge',context:true}));
 if(url.pathname.endsWith('/live/live.js')){const source=fs.readFileSync(path.join(root,url.pathname),'utf8');res.setHeader('Content-Type','text/javascript');return res.end(source.slice(0,source.indexOf(' auth=stored(storageKey())'))+' window.liveTest={present};})();');}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pages:[],role:'teacher',userId:1}));}
 let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{let browser;try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1250,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/PeninaPlus-knowledge-builder/');await page.waitForFunction(()=>!document.querySelector('.app').inert);
 assert(await page.locator('#previous-card').isDisabled());assert(await page.locator('#next-card').isDisabled());
 const deck={format:'penina-knowledge-cards',version:1,title:'Formatting test',cards:[1,2,3].map(i=>({id:'c'+i,question:'Question '+i,answer:'Answer '+i,additionalInformation:'Information '+i,distractors:{english:['Wrong a','Wrong b','Wrong c','Wrong d','Wrong e']}}))};
 const hebrewFirst='וַיֵּצֵא — he left.', englishFirst='Translation: הוּא יָצָא';
 deck.cards[1].answer=hebrewFirst+'\n'+englishFirst;
 await page.locator('#draft-file').setInputFiles({name:'cards.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(deck))});
 await page.waitForFunction(()=>document.querySelector('#card-count').textContent==='3');
 assert.deepEqual(await page.locator('#card-form .form-actions button').evaluateAll(nodes=>nodes.map(n=>n.id)),['save-card','previous-card','next-card','delete-card']);
 assert(await page.locator('#previous-card').isDisabled());assert(!(await page.locator('#next-card').isDisabled()));
 await page.locator('#question').fill('Changed question');await page.locator('#next-card').click();assert.equal(await page.locator('#question').innerText(),'Question 2');
 await page.locator('#previous-card').click();assert.equal(await page.locator('#question').innerText(),'Changed question');
 await page.locator('#answer').fill('');await page.locator('#next-card').click();assert.equal(await page.locator('#question').innerText(),'Changed question');assert.match(await page.locator('#editor-message').innerText(),/both a question and an answer/);
 await page.locator('#answer').fill('Answer 1');await page.locator('#next-card').click();await page.locator('#next-card').click();assert(await page.locator('#next-card').isDisabled());
 await page.locator('#new-card').click();assert(await page.locator('#next-card').isDisabled());await page.locator('#previous-card').click();assert.equal(await page.locator('#question').innerText(),'Question 3');
 await page.locator('#new-card').click();await page.locator('#question').fill('New card');await page.locator('#answer').fill('New answer');await page.locator('#previous-card').click();assert.equal(await page.locator('#question').innerText(),'Question 3');assert.equal(await page.locator('#card-count').innerText(),'4');
 await page.locator('#previous-card').click(); // card 2: formatting-only edit retains its choices.
 async function select(id,start,end){await page.locator('#'+id).evaluate((el,{start,end})=>{el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);const locate=offset=>{for(const node of nodes){if(offset<=node.length)return[node,offset];offset-=node.length;}return[nodes.at(-1),nodes.at(-1).length];};const range=document.createRange();range.setStart(...locate(start));range.setEnd(...locate(end));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);},{start,end});}
 const toolbar=id=>page.locator('#'+id).locator('xpath=preceding-sibling::div[1]');
 await select('question',0,8);await toolbar('question').getByRole('button',{name:'Bold selected text',exact:true}).click();
 await toolbar('question').getByRole('button',{name:'Right-to-left paragraph',exact:true}).click();await toolbar('question').getByRole('button',{name:'Align right',exact:true}).click();
 assert.equal(await page.locator('#question strong,#question b').innerText(),'Question');
 await page.locator('#save-card').click();
 assert.equal(await page.evaluate(()=>new Promise(resolve=>{const req=indexedDB.open('penina-knowledge-builder',1);req.onsuccess=()=>{const get=req.result.transaction('drafts').objectStore('drafts').get('current');get.onsuccess=()=>resolve(get.result.deck.cards[1].distractors.english.length);};})),5,'formatting alone preserves reviewed choices');
 const go=stage=>page.locator('.workflow-nav [data-stage="'+stage+'"]').click();
 const layout=selector=>page.locator(selector+' [data-rich-paragraph]').evaluateAll(nodes=>nodes.map(node=>[
  node.textContent,getComputedStyle(node).direction,getComputedStyle(node).textAlign,node.querySelector('strong,b')?.textContent
 ]));
 await go('practice');await go('edit');
 await select('answer',0,'וַיֵּצֵא'.length);
 for(const action of ['bold','ltr','left'])await toolbar('answer').locator('[data-format="'+action+'"]').click();
 await select('answer',hebrewFirst.length+1,hebrewFirst.length+englishFirst.length);
 for(const action of ['rtl','right'])await toolbar('answer').locator('[data-format="'+action+'"]').click();
 await go('study');await page.locator('#flip').click();
 const expected=[[hebrewFirst,'ltr','left','וַיֵּצֵא'],[englishFirst,'rtl','right',undefined]];
 assert.deepEqual(await layout('#card-content'),expected);
 await go('practice');
 assert.deepEqual(await layout('#correct-1'),expected,'a formatting-only edit refreshes the previously visited distractor page');
 assert.equal(await page.locator('#distractor-1-0').inputValue(),'Wrong a');
 await select('correct-1',1000,1000);await page.keyboard.insertText('!');
 await page.locator('#save-answers').click();await go('study');await page.locator('#flip').click();
 assert.deepEqual(await layout('#card-content'),[expected[0],[englishFirst+'!','rtl','right',undefined]],'edits on the distractor page keep paragraph formatting');
 await go('edit');
 await page.locator('#answer').fill('תשובה\nSecond paragraph');await select('answer',0,50);await toolbar('answer').getByRole('button',{name:'Right-to-left paragraph',exact:true}).click();await toolbar('answer').getByRole('button',{name:'Align right',exact:true}).click();
 // Use real paragraph breaks so direction/alignment can differ within one card.
 await page.locator('#additional-information').fill('First paragraph');await page.locator('#additional-information').press('End');await page.locator('#additional-information').press('Enter');await page.keyboard.insertText('פסקה שנייה');
 await select('additional-information',0,100);await toolbar('additional-information').getByRole('button',{name:'Right-to-left paragraph',exact:true}).click();await toolbar('additional-information').getByRole('button',{name:'Align right',exact:true}).click();
 await select('additional-information',0,5);await toolbar('additional-information').getByRole('button',{name:'Bold selected text',exact:true}).click();await toolbar('additional-information').getByRole('button',{name:'Left-to-right paragraph',exact:true}).click();await toolbar('additional-information').getByRole('button',{name:'Align left',exact:true}).click();
 await page.waitForTimeout(450);await page.reload();await page.waitForFunction(()=>!document.querySelector('.app').inert);assert.equal(await page.locator('#question strong').innerText(),'Question');
 await page.locator('#save-card').click();
 // Reopening restores all paragraph and run formatting.
 await page.locator('#previous-card').click();await page.locator('#next-card').click();assert.equal(await page.locator('#question strong').innerText(),'Question');
 await toolbar('question').getByRole('button',{name:'Align left',exact:true}).click();assert.equal(await page.locator('#question [data-rich-paragraph]').evaluate(el=>el.style.textAlign),'left');await toolbar('question').getByRole('button',{name:'Align right',exact:true}).click();
 const pending=page.waitForEvent('download');await page.locator('#download-draft').click();const draft=await pending,filename=path.join(output,'formatted.json');await draft.saveAs(filename);exported=JSON.parse(fs.readFileSync(filename,'utf8'));
 const formatted=exported.cards[1];assert.equal(formatted.question,'Question 2');assert.equal(formatted.textFormatting.question.paragraphs[0].direction,'rtl');assert.equal(formatted.textFormatting.question.paragraphs[0].align,'right');
 assert.equal(formatted.answer,'תשובה\nSecond paragraph');assert(formatted.textFormatting.answer.paragraphs.every(p=>p.direction==='rtl'&&p.align==='right'));
 assert.equal(formatted.additionalInformation,'First paragraph\nפסקה שנייה');assert.deepEqual(formatted.textFormatting.additionalInformation.paragraphs.map(p=>[p.direction,p.align]),[['ltr','left'],['rtl','right']]);
 // Add back reviewed choices for the changed answer to exercise generated games.
 formatted.distractors={english:['Wrong a','Wrong b','Wrong c','Wrong d','Wrong e']};exported.cards=[formatted];
 await page.locator('[data-stage="share"]').first().click();const xlsxPromise=page.waitForEvent('download');await page.locator('#download-spreadsheet').click();const xlsx=await xlsxPromise,xlsxFile=path.join(output,'formatted.xlsx');await xlsx.saveAs(xlsxFile);const book=new ExcelJS.Workbook();await book.xlsx.load(fs.readFileSync(xlsxFile));const questionCell=book.worksheets[0].getRow(3).getCell(1);assert(questionCell.value.richText.some(run=>run.text==='Question'&&run.font.bold));assert.equal(questionCell.alignment.horizontal,'right');assert.equal(questionCell.alignment.readingOrder,'rtl');
 await page.locator('[data-stage="edit"]').first().click();
 for(const width of [1250,390]){await page.setViewportSize({width,height:1000});assert(await page.locator('.app').evaluate(el=>el.scrollWidth<=document.documentElement.clientWidth));await page.locator('#card-form').screenshot({path:path.join(output,'editor-'+width+'.png')});}
 await page.goto(origin+'/student.html');assert.equal(await page.locator('#card-content strong').innerText(),'Question');assert.equal(await page.locator('#card-content [data-rich-paragraph]').getAttribute('dir'),'rtl');await page.locator('#flip').click();assert.equal(await page.locator('#additional-text strong').innerText(),'First');
 await page.goto(origin+'/combined.html');assert.equal(await page.locator('#mainText strong').innerText(),'Question');await page.locator('#paperCards').click();assert(await page.locator('.paper-card strong').count()>=2);
 await page.goto(origin+'/sheet.html');assert.equal(await page.locator('.sheet td strong').first().innerText(),'Question');
 await page.goto(origin+'/games.html');
 // Every game uses the same formatted prompt, with unformatted answer choices.
 const games=await page.locator('[data-game]').evaluateAll(nodes=>nodes.map(n=>n.dataset.game));
 for(const game of games){
  await page.goto(origin+'/games.html');await page.locator('#gamify').click();await page.locator('[data-game="'+game+'"]').click();
  if(await page.locator('#gameInitials').isVisible())await page.locator('#gameInitials').fill('AB');await page.locator('#gameLaunch').click();
  if(game==='flappy')await page.getByRole('button',{name:'Start flying →',exact:true}).click();
  if(game==='snowblaster')await page.getByRole('button',{name:'Start blasting',exact:true}).click();
  const paragraph=page.locator('#gameBoard [data-rich-paragraph]').first();await paragraph.waitFor();assert.equal(await paragraph.locator('strong').innerText(),'Question',game);assert.equal(await paragraph.getAttribute('dir'),'rtl',game);assert.equal(await paragraph.evaluate(el=>el.style.textAlign),'right',game);
  assert((await page.locator('#gameBoard').innerText()).replace(/\s+/g,' ').includes('תשובה Second paragraph'),game+' includes the correct answer');
  assert.deepEqual(await page.locator('#gameBoard [data-rich-paragraph] strong').allTextContents(),['Question'],game+' styles the prompt only');
 }
 // Render the actual Live client for both roles at desktop and phone widths.
 for(const host of [false,true])for(const width of [1250,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/live/?code=123456&host='+(host?'1':'0'));
  const snapshot={phase:'question',round:1,index:1,version:2,code:'123456',className:'Formatting test',classUrl:'/class',playerCount:1,answeredCount:0,total:3,paused:false,deadline:null,seconds:0,serverNow:Date.now(),question:{term:formatted.question,questionFormatting:formatted.textFormatting.question,options:[formatted.answer,'Wrong A','Wrong B','Wrong C']},players:[],scores:[],me:{name:'AB',avatar:1,score:0,streak:0,choice:null}};
  await page.evaluate(data=>window.liveTest.present(data),snapshot);
  const paragraph=page.locator('.question [data-rich-paragraph]');assert.equal(await paragraph.locator('strong').innerText(),'Question');assert.equal(await paragraph.getAttribute('dir'),'rtl');assert.equal(await paragraph.evaluate(el=>getComputedStyle(el).textAlign),'right');assert.equal(await page.locator('.answers strong').count(),0);
  assert(await page.locator('#stage').evaluate(el=>el.scrollWidth<=document.documentElement.clientWidth));await page.locator('#stage').screenshot({path:path.join(output,'live-'+host+'-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);console.log('Passed card navigation, formatting, persistence and exports. Artifacts:',output);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
