// Generated local apps only. All external requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=process.env.PENINA_ROOT||path.resolve(__dirname,'..');
const {makeStudentApp}=require(path.join(root,'lib/knowledge-publication'));
const study=require(path.join(root,'PeninaPlus-vocab-builder/offline-study-cards'));
const question='רֹאשׁ הַשָּׁנָה is known as a day of what?';
const english='How many books are opened on רֹאשׁ הַשָּׁנָה?';
const format=(text,direction='auto',align='start',bold=false)=>({paragraphs:[{direction,align,runs:[{text,bold}]}]});
const cards=[
 {id:'hebrew',question,answer:'Judgment'},
 {id:'english',question:english,answer:'Three'},
 {id:'default-format',question,answer:'Judgment',textFormatting:{question:format(question),answer:format('Judgment')}},
 {id:'direction-only',question,answer:'Judgment',textFormatting:{question:format(question,'ltr'),answer:format('Judgment','ltr')}},
 {id:'rtl',question:'מה התשובה?',answer:'תשובה',textFormatting:{question:format('מה התשובה?','rtl'),answer:format('תשובה','rtl')}},
 {id:'left',question:english,answer:'Three',textFormatting:{question:format(english,'ltr','left')}},
 {id:'right',question:'מה התשובה?',answer:'תשובה',textFormatting:{question:format('מה התשובה?','rtl','right')}},
 {id:'bold',question:'Which answer?',answer:'Correct',textFormatting:{question:{paragraphs:[{direction:'ltr',align:'start',runs:[{text:'Which ',bold:false},{text:'answer?',bold:true}]}]}}}
];
const deck={format:'penina-knowledge-cards',version:1,title:'Knowledge typography',cards};
async function style(locator){return locator.evaluate(node=>{const s=getComputedStyle(node.querySelector('[data-rich-paragraph]')||node);return{weight:s.fontWeight,align:s.textAlign,family:s.fontFamily,direction:s.direction};});}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  const sizingPage=await browser.newPage({viewport:{width:1100,height:900}});
  try {
   const lines=['When did they come to סְדוֹם?', 'מָתַי הֵם בָּאוּ?'];
   const question=lines.join('\n');
   const sized={id:'sizing',question,answer:lines[0],textFormatting:{question:{paragraphs:
    lines.map((text,i)=>({direction:i?'rtl':'ltr',align:'start',runs:[{text,bold:!i}]}))}}};
   await sizingPage.setContent(makeStudentApp({...deck,cards:[sized]}));
   const text=sizingPage.locator('#card-content .card-text');
   // Choose a column that fits each authored line at about 75% of the usual size.
   async function fitAt(widthRatio) {
    return text.evaluate((el,ratio)=>{
     el.parentElement.style.width='';el.style.fontSize='';el.style.minWidth='max-content';
     const base=parseFloat(getComputedStyle(el).fontSize), natural=el.scrollWidth;
     el.style.minWidth='';el.parentElement.style.width=Math.floor(natural*ratio)+'px';
     window.dispatchEvent(new Event('resize'));
     const css=getComputedStyle(el);
     return {base,size:parseFloat(css.fontSize),lines:Math.round(el.getBoundingClientRect().height/parseFloat(css.lineHeight))};
    },widthRatio);
   }
   const front=await fitAt(.75);
   assert(front.size<front.base && front.size>=16);assert.equal(front.lines,2);
   assert.deepEqual(await text.locator('[data-rich-paragraph]').allTextContents(),lines);
   await sizingPage.locator('#flip').click();
   const back=await fitAt(.75);
   assert(back.size<back.base && back.size>=16);assert.equal(back.lines,1);
   const narrow=await fitAt(.15);assert.equal(narrow.size,16);assert(narrow.lines>1);
   const wide=await fitAt(1.1);assert.equal(wide.size,wide.base);assert.equal(wide.lines,1);
  } finally {await sizingPage.close();}
  for(const width of [1250,390])for(const combined of [false,true]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
   await page.route('**/*',route=>route.abort());page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.setContent(combined?study.makeApp(deck.title,study.fromKnowledgeDeck(deck),{hideGames:true}):makeStudentApp(deck));
    const copy=page.locator(combined?'#mainText':'#card-content .card-text');
    await copy.waitFor();
    const family=(await style(copy)).family;
    for(let i=0;i<cards.length;i++){
     const current=await style(copy);
     assert.equal(current.weight,'400',`${cards[i].id}: regular question text`);
     assert.equal(current.family,family,'formatting does not replace the font family');
     assert.equal(current.align,i===5?'left':i===6?'right':'center',`${cards[i].id}: center unless explicitly aligned`);
     if(i===3)assert.equal(current.direction,'ltr');
     if(i===4||i===6)assert.equal(current.direction,'rtl');
     if(i===7)assert.equal(await copy.locator('strong').evaluate(node=>getComputedStyle(node).fontWeight),'700','selected bold remains visible');
     if(process.env.STUDY_SCREENSHOT_DIR&&i<2&&!combined){fs.mkdirSync(process.env.STUDY_SCREENSHOT_DIR,{recursive:true});await page.locator('#flashcard').screenshot({path:path.join(process.env.STUDY_SCREENSHOT_DIR,`knowledge-${width}-${cards[i].id}.png`)});}
     await page.locator('#flip').click();
     await page.waitForFunction(combined=>document.getElementById(combined?'sideNumber':'side-number').textContent==='2 / 2',combined);
     const answer=await style(copy);assert.equal(answer.weight,'400');assert.equal(answer.align,'center');
     await page.locator('#next').click();
    }
    if(combined){
     await page.locator('#paperCards').click();
     for(const selector of ['.paper-card-knowledge .paper-term','.paper-card-knowledge .paper-translation']){
      const copies=page.locator(selector);assert.equal(await copies.count(),cards.length);
      for(let i=0;i<cards.length;i++)assert.equal((await style(copies.nth(i))).weight,'400','printed Knowledge text is regular');
     }
    }else{
     await page.locator('#study-stage [data-stage="print"]').click();
     const copies=page.locator('#print-pages .card-text');assert.equal(await copies.count(),cards.length*2);
     for(const copy of await copies.all())assert.equal((await style(copy)).weight,'400','printed Knowledge text is regular');
    }
    assert.deepEqual(errors,[]);console.log(`Passed ${combined?'combined':'student'} Knowledge typography at ${width}px.`);
   }finally{await page.close();}
  }
  console.log('Passed regular Knowledge text, centering, explicit alignment, direction, bold and printing on desktop/mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
