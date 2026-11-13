// Local-only regression check. All API/storage responses are in-memory fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
const study=require('../PeninaPlus-vocab-builder/offline-study-cards');
const {makeSheet}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
const {createHandler}=require('../lib/knowledge-sets');
const picture={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAARgAAAC0CAIAAADARaT6AAAEfklEQVR4nO3V0YkkRxBF0fVHfsgreazPAv0K0SB2U9CqnImZF1F54BiQHf0u9eP660/gk37EXwAPICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoICQoIKSOfvvj9/fiL2QhpI6ENI6Q3vnfQX/R3IU0jpB+8clyqtYvpHGE9I8v7ecDGQhpnKND+uZ+7vcgpHEODSme0PsqhDTOcSHFs7nThpDGOSukeC038xDSOKeEFI9kKychjXNESPE2viI2Wnl+SPHRC+kEDw8pvnghHeLJIcXnLqRzPDak+NaFdJRnhhQfupBO88CQ4isX0oGENFL8yCyeFlJ84kI6k5BGit+ZxaNCiu9bSMcS0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7MQ0kjxU7N4VEjXMS3F78xCSCPF78ziaSFdZ7QUPzILIY0UPzKLB4Z0HdBS/MIsnhnS9fSW4udl8diQrke3FL8tiyeHdD23pfhhWTw8pOuhLcWvyuL5IV1PbCl+UhZHhHSNaunOa+P3ZHFKSC/xSG7mIaRxzgrpatzS1iPjZ2RxXEgv8WzeVyGkcQ4N6aVhQjcfFj8di6ND+leTfu6/J34xFkL6Rbaf+8/45t8V/1/6E9I7qf19wzdNV7WE1NGHp/yl/SjqDSF1tLvgb+5HUf8lpI7uDzeekJxehNTRncnGs5HTz4TUUTwGLe0SUkfxEuS0S0gdxRvQ0i4hdRQPQEu7hNRRfP1a2iWkjuLT19IuIXUU372Wdgmpo/jotbRLSB3FF6+lXULqKD53Ie0SUkfxuWtpl5A6im9dSLuE1FF861raJaSO4kMX0i4hdRQfupB2Camj+NCFtEtIHcWHLqRdQuooPnQh7RJSR/GhC2mXkDqKD11Iu4TUUXzoQtolpI7iQxfSLiF1FB+6kHYJqaP40FW0S0gdxbcupF1C6ii+dRXtElJH8bkLaZeQOorPXUW7hNRRfPEq2iWkjuKjV9EuIXUU372Kdgmpo/j0VbRLSB3F16+iXULqKB6AinYJqaN4AxLaJaSO7iw1XouKfiakju6PNZ6NhF6E1NHuZCUUJ6SOPjxc/aQIqaPPL1g/30xIHZVPWTlfTUgdWfY4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpA6EtI4QupISOMIqSMhjSOkjoQ0jpCggJCggJCggJCggJCggJCggJCggJCggJCggJCggJCggJCggJCggJCgwN/TDp0llGfEZAAAAABJRU5ErkJggg==',alt:'Diagram',target:{x:.25,y:.75}};
const decks=[{format:'penina-knowledge-cards',version:1,title:'Test #1',cards:[{id:'leaf',question:'What is the marked part of this plant?',answer:'Leaf',additionalInformation:'Leaves use sunlight to make food.',picture,distractors:{english:['Root','Stem','Seed','Flower'],hebrew:['שורש','גבעול','זרע','פרח']}}]},
 {format:'penina-knowledge-cards',version:1,title:'Test #2',cards:[{id:'leaf',question:'What do roots absorb?',answer:'Water',additionalInformation:'מים',distractors:{english:['Sunlight','Food','Seeds','Flowers']}}]}];
const records=decks.map((deck,i)=>({deck,pathname:'knowledge-cards/local/test'+(i+1)+'.json',url:'mock:'+i,uploadedAt:'2026-11-11T12:00:00Z'}));
const vocabCards=study.toCards([{term:'ספר',englishTermTranslation:'book',hebrewTermTranslation:'ספר',contextQuote:'זה ספר',englishContextTranslation:'This is a book',englishCitation:'A source',alternativeAnswers:{english:{term:'ספר',definition:'book',answers:['pencil','pen','desk','chair']}}}]);
const vocabUrl='/api/flashcard-sets?grade=local&view=vocab',vocabSet={title:'Vocabulary',pathname:'vocabulary-cards/local/vocab.html',publishedAt:'2026-11-11T12:00:00Z',url:vocabUrl,downloadUrl:vocabUrl+'&download=1',printUrl:vocabUrl+'#print',sheetUrl:vocabUrl+'&sheet=1',sheetDownloadUrl:vocabUrl+'&sheet=1&action=download',sheetPrintUrl:vocabUrl+'&sheet=1&action=print'};
const pageInfo={id:'local',name:'Local Class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=local'};
const knowledge=createHandler({storage:{list:async()=>({blobs:records,hasMore:false})},fetch:async url=>({ok:true,json:async()=>records.find(r=>r.url===url).deck}),pageStore:{getPage:async()=>pageInfo,publicPage:p=>p}});
let vocabularyFirst=false;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),query=Object.fromEntries(url.searchParams);
 const reply={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));},send:value=>res.end(value)};
 try{
  if(url.pathname==='/api/flashcard-sets'){
   if(query.kind==='knowledge'){
    if(vocabularyFirst && !query.view)await new Promise(resolve=>setTimeout(resolve,80));
    return await knowledge({method:'GET',query},reply);
   }
   if(query.view){res.setHeader('Content-Type','text/html');return res.end(query.sheet?makeSheet('Vocabulary',vocabCards):study.makeApp('Vocabulary',vocabCards,{hideGames:true}));}
   if(!vocabularyFirst)await new Promise(resolve=>setTimeout(resolve,80));
   return reply.json({page:pageInfo,sets:[vocabSet],knowledgeSets:records.map(r=>({pathname:r.pathname,title:r.deck.title,publishedAt:r.uploadedAt,kind:'knowledge',hasGames:true}))});
  }
  if(url.pathname.startsWith('/api/'))return reply.json({});
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){reply.status(500).json({error:error.message});}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,libraryUrl=origin+pageInfo.url;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  const context=await browser.newContext({viewport:{width:1200,height:950}}),errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>{window.print=()=>{window.printCount=(window.printCount||0)+1;};});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();
  async function openLibrary(){await page.goto(libraryUrl);await page.locator('#sets .set').waitFor();await page.locator('.knowledge-library .set').last().waitFor();}
  async function combine(selectors){
   for(const selector of selectors)await page.locator(selector).check();
   await page.locator('#view-combined').click();await page.locator('#input-dialog-value').fill('Combined Study');
   await page.locator('#input-dialog-confirm').click();await page.waitForURL('blob:**');await page.locator('#mainText').waitFor();
  }
  await openLibrary();
  for(const width of [1200,390]){
   await page.setViewportSize({width,height:950});
   for(const card of await page.locator('.set').all()){
    assert.equal(await card.locator('.combine-select').count(),1);
    assert.deepEqual(await card.locator('.set-action-group h3').allTextContents(),['Flashcards','Sheets']);
    assert.deepEqual(await card.locator('.set-action:visible').allTextContents(),['View','Print/PDF','View','Print/PDF']);
    assert.deepEqual(await card.locator('.set-action[hidden]').allTextContents(),['Download','Print','Download PDF','Print']);
    for(const name of ['Flashcards','Sheets'])assert.equal(await card.getByRole('link',{name:'Print/PDF '+name,exact:true}).getAttribute('href'),await card.locator(`[aria-label="Print ${name}"]`).getAttribute('href'));
    assert(!/\d+ cards/.test(await card.textContent()));
    assert(await card.locator('time').textContent());
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'library overflow');
   await page.screenshot({path:'/tmp/penina-library-'+width+'.png',fullPage:true});
  }
  const knowledgeBox='.knowledge-library .set:first-child .combine-select';
  await page.locator(knowledgeBox).check();await page.locator('#search').fill('Vocabulary');
  await page.locator('#sets .combine-select').check();assert.equal(await page.locator('#combine-count').textContent(),'2 sets selected');
  await page.locator('#search').fill('');assert(await page.locator(knowledgeBox).isChecked());
  await combine([]);
  const mixed=JSON.parse(await page.locator('#peninaCardData').textContent());
  assert.equal(mixed.length,2);assert.equal(mixed[0].english,'book');assert.equal(mixed[0].contextQuote,'זה ספר');
  assert.equal(mixed[1].sourceId,records[0].pathname+'#leaf');assert.deepEqual(mixed[1].picture,picture);assert.deepEqual(mixed[1].distractors,decks[0].cards[0].distractors);
  await page.locator('#next').click();await page.locator('#mainText img').waitFor();
  assert.equal(await page.locator('#sideLabel').isVisible(),false);assert.equal(await page.locator('#mainText img').getAttribute('src'),picture.src);
  assert.equal(await page.locator('.study-picture-target').count(),1);
  await page.locator('#flip').click();await page.waitForFunction(()=>document.getElementById('mainText').textContent==='Leaf');assert.equal(await page.locator('#sideLabel').isVisible(),false);
  assert.equal(await page.locator('#englishContext').textContent(),decks[0].cards[0].additionalInformation);
  await page.locator('#translationFirst').click();assert.equal(await page.locator('#mainText').textContent(),'Leaf');
  await page.locator('#termFirst').click();
  await page.locator('#previous').click();assert.equal(await page.locator('#sideLabel').isVisible(),true);assert.equal(await page.locator('#sideLabel').textContent(),'Term');
  await page.locator('#next').click();assert.equal(await page.locator('#sideLabel').isVisible(),false);
  for(const width of [1200,390]){
   await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'combined overflow');
   await page.screenshot({path:'/tmp/penina-combined-'+width+'.png',fullPage:true});
  }
  await page.locator('#paperCards').click();assert.equal(await page.locator('.paper-sheet').count(),2);
  assert.equal(await page.locator('.paper-card-knowledge img').count(),1);
  assert.match(await page.locator('#printPages').textContent(),/Leaves use sunlight/);
  await page.locator('#printNow').click();assert.equal(await page.evaluate(()=>window.printCount),1);
  // Check the other request completion order and a knowledge-only combination.
  vocabularyFirst=true;await openLibrary();
  await combine(['.knowledge-library .set:nth-child(1) .combine-select','.knowledge-library .set:nth-child(2) .combine-select']);
  const knowledgeOnly=JSON.parse(await page.locator('#peninaCardData').textContent());
  assert.equal(knowledgeOnly.length,2);assert(knowledgeOnly.every(card=>card.kind==='knowledge'));assert.notEqual(knowledgeOnly[0].sourceId,knowledgeOnly[1].sourceId);
  await openLibrary();
  const card=page.locator('.knowledge-library .set').first();
  // The original standalone knowledge flashcard download still carries the full deck.
  const cardDownloadPromise=page.waitForEvent('download');
  await card.locator('[aria-label="Download Flashcards"]').evaluate(link=>link.click());
  const cardDownload=await cardDownloadPromise,exported=fs.readFileSync(await cardDownload.path(),'utf8');
  assert.deepEqual(JSON.parse(exported.match(/id="peninaKnowledgeData" type="application\/json">([\s\S]*?)<\/script>/)[1]).deck.cards[0].picture,picture);
  const studyUrl=await card.getByRole('link',{name:'View Flashcards',exact:true}).getAttribute('href');
  const knowledgePage=await context.newPage(),wordPage=await context.newPage();
  await knowledgePage.goto(origin+studyUrl);await knowledgePage.locator('#study-stage').waitFor({state:'visible'});
  await wordPage.goto(origin+vocabUrl);await wordPage.locator('#card').waitFor();
  assert.equal(await knowledgePage.locator('.brand,.bg-pattern,.copyright,.about,.app-header').count(),0);
  assert.equal(await knowledgePage.locator('.workflow-nav').isVisible(),false);
  assert.equal(await knowledgePage.locator('#study-title').textContent(),decks[0].title);
  async function appearance(target,selector){return target.locator(selector).evaluate(el=>{
   const style=getComputedStyle(el),box=el.getBoundingClientRect();
   return Object.fromEntries(['backgroundColor','backgroundImage','fontFamily','fontSize','fontWeight','borderRadius','borderColor','padding','gap','display','boxShadow'].map(key=>[key,style[key]]).concat([['width',box.width],['height',box.height]]));
  });}
  for(const width of [1200,880,390]){
   await knowledgePage.setViewportSize({width,height:950});await wordPage.setViewportSize({width,height:950});
   for(const [knowledgeSelector,vocabularySelector] of [
    ['body','body'],['.app','.app'],['#study-stage .stage','.stage'],['#flashcard','#card'],
    ['#study-stage .topbar','.topbar'],['#study-stage .progress','.progress'],
    ['#study-stage .controls','.controls'],['#study-stage .ratings','.ratings'],
    ['#shuffle','#shuffle'],['#flip','#flip'],['#study-stage .know','.know'],['#study-stage .almost','.almost'],['#study-stage .learning','.learning']
   ]){
    const actual=await appearance(knowledgePage,knowledgeSelector),expected=await appearance(wordPage,vocabularySelector);
    // A saved-practice button may make the sidebar longer; card and control sizes must match.
    if(['body','.app'].includes(knowledgeSelector)){delete actual.height;delete expected.height;}
    if(knowledgeSelector==='#flashcard'){delete actual.padding;delete expected.padding;} // Knowledge cards give the picture and text more room.
    assert.deepEqual(actual,expected,knowledgeSelector+' appearance at '+width);
   }
   assert.equal(await knowledgePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'knowledge viewer overflow');
   assert.equal(await knowledgePage.locator('#study-side-label, #flashcard > .label').count(),0);
   assert.equal(await knowledgePage.locator('.student-question-copy').evaluate(el=>el.clientHeight),244);
   if(width>=880)assert((await knowledgePage.locator('#card-content .picture-button img').boundingBox()).height>160,'initial picture is taller than the previous 160px limit');
   const pictureBox=await knowledgePage.locator('#card-content .picture-button img').boundingBox();
   const textBox=await knowledgePage.locator('.student-question-copy').boundingBox();
   assert(pictureBox.x+pictureBox.width<=textBox.x,'picture and wording do not overlap');
   assert(await knowledgePage.locator('.student-question-copy .card-text').evaluate(el=>el.scrollHeight<=el.parentElement.clientHeight+1 && el.scrollWidth<=el.parentElement.clientWidth+1),'question fits the larger text area');
   await knowledgePage.screenshot({path:'/tmp/penina-knowledge-viewer-'+width+'.png',fullPage:true});
   await wordPage.screenshot({path:'/tmp/penina-wordlist-viewer-'+width+'.png',fullPage:true});
  }
  await knowledgePage.getByRole('button',{name:'Enlarge picture',exact:true}).click();await knowledgePage.locator('#picture-dialog').waitFor({state:'visible'});
  assert.equal(await knowledgePage.locator('#enlarged-picture img').getAttribute('src'),picture.src);assert.equal(await knowledgePage.locator('#enlarged-picture .target-marker').count(),1);
  assert.equal(await knowledgePage.locator('#picture-dialog input[type=range]').count(),0);
  const initialPictureWidth=(await knowledgePage.locator('#enlarged-picture img').boundingBox()).width;
  await knowledgePage.locator('#enlarged-picture').click();
  assert(await knowledgePage.locator('#picture-dialog').isVisible(),'picture clicks enlarge without closing');
  assert((await knowledgePage.locator('#enlarged-picture img').boundingBox()).width>=initialPictureWidth);
  await knowledgePage.locator('#close-picture').click();
  await knowledgePage.locator('#picture-dialog').waitFor({state:'hidden'});
  assert.equal(await knowledgePage.locator('#side-number').textContent(),'1 / 2','enlargement does not flip the card');
  await knowledgePage.locator('#flip').click();assert.match(await knowledgePage.locator('#flashcard').getAttribute('aria-label'),/^Answer side/);
  assert.equal(await knowledgePage.locator('#card-content').textContent(),'Leaf');assert.equal(await knowledgePage.locator('#additional-panel').isVisible(),true);
  assert.equal(await knowledgePage.locator('#additional-text').textContent(),decks[0].cards[0].additionalInformation);
  assert.equal(await knowledgePage.locator('#answer-first, #question-first, .orders').count(),0);
  for(const action of ['reset-study','next','previous','shuffle']) {
   await knowledgePage.locator('#'+action).click();
   assert.match(await knowledgePage.locator('#flashcard').getAttribute('aria-label'),/^Question side/,action+' returns to the question');
   assert.equal(await knowledgePage.locator('#side-number').textContent(),'1 / 2');
   assert.equal(await knowledgePage.locator('#card-content img').count(),1);
   assert.equal(await knowledgePage.locator('#additional-panel').isVisible(),false);
   await knowledgePage.locator('#flip').click();
   assert.match(await knowledgePage.locator('#flashcard').getAttribute('aria-label'),/^Answer side/);
  }
  await knowledgePage.locator('#flip').click();
  await knowledgePage.locator('#student-practice').click();await knowledgePage.locator('#quiz-options button').first().waitFor();
  assert.equal(await knowledgePage.locator('#quiz-prompt img').getAttribute('src'),picture.src);
  const choices=await knowledgePage.locator('#quiz-options button').allTextContents();assert(choices.includes('Leaf'));assert(choices.filter(choice=>decks[0].cards[0].distractors.english.includes(choice)).length>=3);
  await knowledgePage.getByRole('button',{name:'Back to Flashcards',exact:true}).click();
  await knowledgePage.getByRole('button',{name:'Print Paper Flashcards',exact:true}).click();await knowledgePage.locator('#print-stage').waitFor({state:'visible'});
  for(const count of ['4','2','1']){
   await knowledgePage.locator('#cards-per-page').selectOption(count);
   assert.equal(await knowledgePage.locator('#print-pages .paper-sheet').count(),2);
   assert.equal(await knowledgePage.locator('#print-pages img').getAttribute('src'),picture.src);
   assert.match(await knowledgePage.locator('#print-pages').textContent(),/Leaves use sunlight/);
  }
  await knowledgePage.locator('#print-now').click();assert.equal(await knowledgePage.evaluate(()=>window.printCount),1);
  await knowledgePage.emulateMedia({media:'print'});
  assert.equal(await knowledgePage.locator('.home-link').isVisible(),false);
  assert.equal(await knowledgePage.locator('#study-stage').isVisible(),false);
  assert.equal(await knowledgePage.locator('#print-pages').isVisible(),true);
  await knowledgePage.emulateMedia({media:'screen'});
  // The downloaded artifact uses the same layout without any external assets.
  await knowledgePage.setContent(exported,{waitUntil:'load'});
  await knowledgePage.locator('#study-stage').waitFor({state:'visible'});
  assert.equal(await knowledgePage.locator('#flashcard').evaluate(el=>el.getBoundingClientRect().height),323);
  assert.equal(await knowledgePage.locator('.brand,.copyright,.bg-pattern').count(),0);
  // Long answers and additional information must fit the same fixed boxes.
  const originalAnswer=decks[0].cards[0].answer,originalInformation=decks[0].cards[0].additionalInformation;
  decks[0].cards[0].answer='Long answer with more detail. '.repeat(20);
  decks[0].cards[0].additionalInformation='Additional explanation that stays below the card. '.repeat(30);
  await knowledgePage.goto(origin+studyUrl);await knowledgePage.locator('#study-stage').waitFor({state:'visible'});
  await knowledgePage.locator('#flip').click();
  for(const selector of ['.student-question-copy .card-text','#additional-text'])assert(await knowledgePage.locator(selector).evaluate(el=>el.scrollHeight<=el.parentElement.clientHeight+1&&el.scrollWidth<=el.parentElement.clientWidth+1),'text fits '+selector);
  assert.equal(await knowledgePage.locator('#flashcard').evaluate(el=>el.getBoundingClientRect().height),323);
  decks[0].cards[0].answer=originalAnswer;decks[0].cards[0].additionalInformation=originalInformation;
  await knowledgePage.close();await wordPage.close();
  const sheetView=await card.getByRole('link',{name:'View Sheets',exact:true}).getAttribute('href');
  const sheetDownload=await card.locator('[aria-label="Download Sheets (PDF)"]').getAttribute('href');
  const sheetPrint=await card.getByRole('link',{name:'Print/PDF Sheets',exact:true}).getAttribute('href');
  const sheet=await context.newPage();await sheet.goto(origin+sheetView);await sheet.locator('.sheet img').waitFor();
  assert.deepEqual(await sheet.locator('thead th').allTextContents(),['Question','Answer','Additional Information']);
  assert.equal(await sheet.locator('.study-picture-target').count(),1);
  const pdfPromise=sheet.waitForEvent('download');await sheet.goto(origin+sheetDownload);const pdf=await pdfPromise;
  assert.equal(pdf.suggestedFilename(),'Test #1 - Sheets.pdf');const bytes=fs.readFileSync(await pdf.path());assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  await pdf.saveAs('/tmp/penina-knowledge-sheets.pdf');
  await sheet.goto(origin+sheetPrint);await sheet.waitForFunction(()=>window.printCount===1);assert.equal(await sheet.locator('.sheet img').evaluate(image=>image.complete&&image.naturalWidth>0),true);
  assert.deepEqual(errors,[]);
  console.log('Passed matching desktop/mobile list layouts, persistent mixed selection, both load orders, mixed/knowledge-only combinations, picture/marker/answer retention, flashcard download, PDF download, sheet printing, shared viewer styling and larger unlabeled knowledge-card content at three widths, picture pop-out, question-first navigation, saved practice and all knowledge print layouts.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
