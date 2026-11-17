// Actual combined flashcard HTML with local fixtures; no external requests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const study=require('../PeninaPlus-vocab-builder/offline-study-cards');
const viewports=[{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900},{width:844,height:390}];
const geometry=page=>page.evaluate(()=>({
 scroll:scrollY,pageHeight:document.documentElement.scrollHeight,pageWidth:document.documentElement.scrollWidth,
 boxes:[...document.querySelectorAll('.stage,#card,#contextSlot,#cardContext,.controls,.controls button,.ratings,.ratings button')].map(node=>{
  const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
 })
}));
const flip=async page=>{
 const side=await page.locator('#sideNumber').innerText();
 await page.keyboard.press('Space');
 await page.waitForFunction(side=>!animating&&document.getElementById('sideNumber').textContent!==side,side);
 // The flip deliberately rotates the card; measure after its CSS transition.
 await page.locator('#card').evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of viewports.filter(v=>!process.env.STUDY_VIEWPORT_WIDTH||v.width===Number(process.env.STUDY_VIEWPORT_WIDTH))){
   const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.abort());
   try{
    const src=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=180;c.height=360;const x=c.getContext('2d');x.fillStyle='#d8edda';x.fillRect(0,0,180,360);x.fillStyle='#275b31';x.fillRect(60,30,60,300);return c.toDataURL();});
    const vocabulary=study.toCards([
     {term:'בַּיִת',englishTermTranslation:'House',hebrewTermTranslation:'מקום מגורים',contextQuote:'זה הבית שלנו.',englishContextTranslation:'This is our house.'},
     {term:'מילה '.repeat(50),englishTermTranslation:'A longer vocabulary definition. '.repeat(30),contextQuote:'מקור '.repeat(80),englishContextTranslation:'A longer context. '.repeat(50)},
     {term:'סֵפֶר',englishTermTranslation:'Book'}
    ]);
    const knowledge=study.fromKnowledgeDeck({format:'penina-knowledge-cards',version:1,cards:[
     {id:'normal',question:'Why did the people gather at the city gate?',answer:'To hear the king’s announcement.',additionalInformation:'The gate was a public meeting place.'},
     {id:'long',question:Array(12).fill('Read the passage carefully and explain how the events support the conclusion.').join('\n\n')+' QUESTION END',answer:'Explain the evidence in the passage. '.repeat(50)+' ANSWER END',additionalInformation:'Here is more information about the events. '.repeat(60)+' INFORMATION END'},
     {id:'picture',question:'Which part of the picture is marked?',answer:'The stem.',picture:{src,alt:'A tall plant stem',target:{x:.5,y:.8}}},
     {id:'hebrew',question:'מדוע התאספו האנשים בשער העיר?',answer:'כדי לשמוע את דברי המלך',additionalInformation:'שער העיר היה מקום מפגש חשוב.',textFormatting:{question:{paragraphs:[{direction:'rtl',align:'right',runs:[{text:'מדוע ',bold:true},{text:'התאספו האנשים בשער העיר?'}]}]}}}
    ]});
    const cards=[vocabulary[0],knowledge[0],vocabulary[1],knowledge[1],knowledge[2],knowledge[3],vocabulary[2]].map((card,i)=>({...card,n:i+1}));
    await page.setContent(study.makeApp('Combined vocabulary and Knowledge',cards,{hideGames:true}));
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>window.scrollTo(0,document.querySelector('.stage').offsetTop-16));
    const baseline=await geometry(page);
    assert(baseline.pageWidth<=viewport.width,'no horizontal page scrolling');
    for(const termFirst of [true,false]){
     await page.evaluate(id=>document.getElementById(id).click(),termFirst?'termFirst':'translationFirst');
     for(let i=0;i<cards.length;i++){
      for(const side of [0,1]){
       assert.equal(await page.locator('#cardNumber').innerText(),'Card #'+(i+1));
       await page.locator('#card img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
       assert.deepEqual(await geometry(page),baseline,`${viewport.width}: card ${i+1}, side ${side}, order ${termFirst} keeps the frame and controls still`);
       if(cards[i].kind==='knowledge')assert.equal(await page.locator('#mainText').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),24,'Knowledge text stays at its reading size');
       if(side===0)await flip(page);
      }
      await page.keyboard.press('ArrowRight');
     }
    }
    await page.evaluate(()=>document.getElementById('termFirst').click());
    for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');
    const pane=page.locator('#card .card-content');
    assert(await pane.evaluate(node=>node.scrollHeight>node.clientHeight),'long questions scroll inside the card');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    // Start in the visible center of the reading area.
    const cdp=await page.context().newCDPSession(page),box=await pane.boundingBox(),x=box.x+box.width/2,y=(Math.max(0,box.y)+Math.min(box.y+box.height,viewport.height))/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let dy=10;dy<=70;dy+=10){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});await page.waitForTimeout(16);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.querySelector('#card .card-content').scrollTop>0);
    assert.equal(await page.locator('#sideNumber').innerText(),'1 / 2','touch scrolling does not flip the card');
    assert.deepEqual(await geometry(page),baseline,'reading long text does not move the page or controls');
    await pane.evaluate(node=>node.scrollTop=node.scrollHeight);
    assert(await pane.evaluate(node=>{const text=document.getElementById('mainText').lastChild,r=document.createRange();r.setStart(text,text.length-12);r.setEnd(text,text.length);return r.getBoundingClientRect().bottom<=node.getBoundingClientRect().bottom+1;}),'the final question line is reachable');
    await flip(page);
    assert.equal(await pane.evaluate(node=>node.scrollTop),0,'the other face starts at the top');
    const info=page.locator('#cardContext .context-body');
    assert(await info.evaluate(node=>node.scrollHeight>node.clientHeight),'long additional information scrolls inside its frame');
    assert.equal(await page.locator('#englishContext').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),17,'additional information stays readable');
    await info.evaluate(node=>node.scrollTop=node.scrollHeight);
    assert(await info.evaluate(node=>node.scrollTop>0));
    assert.deepEqual(await geometry(page),baseline,'long answers and information preserve the frame');
    await page.keyboard.press('ArrowRight');
    assert.equal(await pane.evaluate(node=>node.scrollTop),0,'the next card starts at the top');
    await page.locator('#card img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
    assert.equal(await page.locator('#card .study-picture-target').count(),1,'picture targets survive');
    assert.deepEqual(await geometry(page),baseline,'loaded pictures do not enlarge the card');
    if(process.env.STUDY_SCREENSHOT_DIR){fs.mkdirSync(process.env.STUDY_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.STUDY_SCREENSHOT_DIR,`mixed-flashcards-${viewport.width}.png`)});}
    await page.evaluate(()=>document.querySelector('[data-rating="known"]').click());
    assert.deepEqual(await geometry(page),baseline,'rating a card does not move controls');
    await page.evaluate(()=>document.getElementById('reset').click());
    assert.deepEqual(await geometry(page),baseline,'reset does not move controls');
    assert.deepEqual(errors,[]);
    console.log(`Passed mixed flashcards, flips, long content, touch scrolling, pictures, and ratings at ${viewport.width}×${viewport.height}`);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
