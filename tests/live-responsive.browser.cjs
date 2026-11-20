const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
const viewports=[{width:320,height:568},{width:375,height:600},{width:390,height:664},{width:430,height:760},
 {width:768,height:1024},{width:1024,height:768},{width:1280,height:650},{width:1440,height:900},
 {width:740,height:360},{width:844,height:390}];
const questions=[
 {term:'בַּיִת',options:['House','Water','Book','Light']},
 {kind:'knowledge',term:'Why did the people gather at the city gate?',options:["To hear the king’s announcement",'To buy food for the journey','To welcome visitors to the city','To prepare for the festival']},
 {kind:'knowledge',term:'Why did the people gather at the city gate, and what did they expect to hear from the king?',options:["To hear the king’s announcement",'To buy food for the journey','To welcome visitors to the city','To prepare for the festival']},
 {kind:'knowledge',term:'מדוע התאספו האנשים בשער העיר?',options:['כדי לשמוע את דברי המלך','כדי לקנות אוכל למסע','כדי לקבל את פני האורחים','כדי להתכונן לחג']},
 {kind:'vocabulary',term:'בַּיִת הַסֵּפֶר '.repeat(8).trim(),options:['School','Street','Garden','House']}
];
const base={phase:'question',round:1,index:1,version:2,className:'Sixth Grade Knowledge',playerCount:24,answeredCount:0,total:20,paused:false,
 me:{name:'AB',avatar:1,score:500,streak:4,choice:null},players:[]};
async function open(browser,viewport,host=false,denyFullscreen=false){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='live.test')return route.abort();
  if(url.pathname==='/api/game-scores'){
   const answer=route.request().postDataJSON();
   return route.fulfill({json:{saved:true,round:answer.round,index:answer.index,choice:answer.choice}});
  }
  if(url.pathname.endsWith('/live.js'))return route.fulfill({contentType:'text/javascript',body:source.slice(0,source.indexOf(' auth=stored(storageKey())'))+' window.liveTest={present,joinForm,getSnapshot:()=>snapshot};})();'});
  const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
  if(url.pathname.endsWith('/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace(/<script src="(?!(?:live\.js|\/PeninaPlus-knowledge-builder\/cards\.js|qrcode\.js|student-display\.js|\.\.\/\.\.\/game-fullscreen\.js))[^"]+"><\/script>/g,'')});
  if(fs.existsSync(file))return route.fulfill({path:file});
  return route.abort();
 });
 if(denyFullscreen)await page.addInitScript(()=>{Element.prototype.requestFullscreen=()=>Promise.reject(Error('Unavailable'));});
 const now=Date.now();
 await page.addInitScript(now=>{Date.now=()=>now;window.setInterval=()=>0;},now);
 await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code=123456'+(host?'&host=1':''));
 return {page,errors,now};
}
const measure=page=>page.evaluate(()=>({
 scroll:scrollY,width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
 boxes:[...document.querySelectorAll('.question-content,.answer')].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node.querySelector('.question,.text'));return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,font:parseFloat(s.fontSize)};})
}));
// Scroll offsets can round by one pixel when fractional text lines receive focus.
const sameScroll=(actual,expected,message)=>assert(actual.every((value,i)=>Math.abs(value-expected[i])<=1),message+': '+JSON.stringify({actual,expected}));
async function checkFrame(page){
 const frame=await page.evaluate(()=>{
  const shell=document.querySelector('.live-shell').getBoundingClientRect();
  const toggle=document.getElementById('live-fullscreen').getBoundingClientRect();
  return {height:innerHeight,width:innerWidth,docHeight:document.documentElement.scrollHeight,
   docWidth:document.documentElement.scrollWidth,gapRight:shell.right-toggle.right,gapBottom:shell.bottom-toggle.bottom};
 });
 assert(frame.docHeight<=frame.height+1&&frame.docWidth<=frame.width+1,'the game fits the viewport '+JSON.stringify(frame));
 assert(frame.gapRight>=0&&frame.gapRight<=24&&frame.gapBottom>=0&&frame.gapBottom<=24,'fullscreen is at the bottom right');
}
async function checkLiveType(page,host,kind){
 const layout=await measure(page);
 const compactLandscape=layout.width>layout.height&&layout.height<=520;
 const vocabulary=kind!=='knowledge';
 const baseTerm=compactLandscape?(host?19:18):!host&&layout.width<=600?19:Math.min(28,Math.max(22,layout.width*.025));
 const baseAnswer=compactLandscape&&!host?18:Math.min(22,Math.max(18,layout.width*.02));
 assert(Math.abs(layout.boxes[0].font-baseTerm*(vocabulary?3:1))<.01,'question size matches the card type');
 assert(layout.boxes.slice(1).every(box=>Math.abs(box.font-baseAnswer*(vocabulary?2:1))<.01),'answer size matches the card type');
 const overflows=await page.locator('.question-content,.answer .text').evaluateAll(nodes=>
  nodes.some(n=>n.scrollHeight>n.clientHeight+1||n.scrollWidth>n.clientWidth+1));
 assert.equal(await page.locator('#read-card').isVisible(),overflows,'a paged reading view is available for oversized text');
 return overflows;
}
async function checkTeacherRound(page){
 await checkFrame(page);
 await checkLiveType(page,true,'knowledge');
 const qr=page.getByRole('link',{name:'Open student join page for game 123456'});
 assert.equal(await qr.count(),1);
 assert(await qr.evaluate(node=>{
  const r=node.getBoundingClientRect(),standings=document.querySelector('.live-standings').getBoundingClientRect();
  return r.width>0&&r.top>=0&&r.bottom+4<=standings.top&&r.right<=innerWidth&&
   [r.left+1,r.right-1].every(x=>[r.top+1,r.bottom-1].every(y=>node.contains(document.elementFromPoint(x,y))));
 }),'the entire QR code is visible and clickable above standings');
 const controls=page.locator('.teacher-round .answer,.teacher-round .actions button');
 assert(await controls.evaluateAll(nodes=>nodes.every(node=>{
  const r=node.getBoundingClientRect();
  return r.height>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;
 })),'all answers and teacher actions fit without scrolling');
}
async function check(browser,viewport){
 const {page,errors,now}=await open(browser,viewport);let index=1,anchors;
 try{
  for(const question of questions)for(const timed of [false,true]){
   const state={...base,index:index++,question,deadline:timed?now+10000:null};
   await page.evaluate(data=>window.liveTest.present(data),state);
   await checkFrame(page);
   const layout=await measure(page),label=`${viewport.width}×${viewport.height} ${question.kind||'vocabulary'} ${timed?'timed':'manual'}`;
   assert.equal(layout.scroll,0,label+': a new question starts at the top');
   assert(layout.pageWidth<=layout.width,label+': no horizontal scrolling');
   assert(layout.boxes.every(b=>b.top>=0&&b.bottom<=layout.height),label+': normal question and all answers fit '+JSON.stringify(layout.boxes));
   assert(layout.boxes.every(b=>b.font>=18),label+': text remains readable');
   assert(layout.boxes.slice(1).every(b=>b.height>=48),label+': comfortable tap targets');
   assert.equal(await page.locator('.answer').count(),4);
   const bounds=layout.boxes.map(({font,...box})=>box);
   if(anchors)assert.deepEqual(bounds,anchors,label+': mixed question types keep the same positions');else anchors=bounds;
   const needsReader=await checkLiveType(page,false,question.kind);
   if(!question.kind)assert.equal(needsReader,false,label+': short vocabulary and definitions fit directly on the board');
   await page.locator('[data-choice="3"]').tap();
   await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
   assert.deepEqual(await measure(page),layout,label+': selection and saving do not move content');
   await page.evaluate(data=>window.liveTest.present({...data,answeredCount:10}),state);
   assert.deepEqual(await measure(page),layout,label+': routine refresh keeps the page stable');
   const reveal={...state,phase:'reveal',question:{...question,correct:3},distribution:[2,1,0,21],me:{...state.me,choice:3,score:675,streak:5,bonuses:{first:25,streak:50}}};
   await page.evaluate(data=>window.liveTest.present(data),reveal);
   assert.deepEqual(await measure(page),layout,label+': revealing results and bonuses does not move answers');
   await page.evaluate(()=>{const error=document.getElementById('error');error.textContent='Connection interrupted';error.hidden=false;});
   assert.deepEqual(await measure(page),layout,label+': connection errors do not push the game down');
   await page.evaluate(()=>document.getElementById('error').hidden=true);
  }
  const long={...base,index:index++,deadline:now+10000,question:{kind:'knowledge',term:Array(12).fill('Read the passage carefully and explain how the events support the conclusion.').join('\n\n'),options:questions[1].options.map(text=>text+'. '+Array(30).fill('Consider the evidence given in the passage.').join(' '))}};
  await page.evaluate(data=>window.liveTest.present(data),long);
  const longLayout=await measure(page);
  assert.deepEqual(longLayout.boxes.map(({font,...box})=>box),anchors,'long material keeps the same frame and answer positions');
  assert(longLayout.boxes.every(b=>b.font>=18),'long material is not shrunk to fit');
  assert(longLayout.pageWidth<=viewport.width,'long material wraps within the screen');
  await page.getByRole('button',{name:'Read full card'}).click();
  const reader=page.locator('#card-reader[open]');
  const readerSizes=await reader.locator('.reader-pages .question,.reader-pages>p').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
  const narrowPortrait=viewport.width<=600 && !(viewport.width>viewport.height && viewport.height<=520);
  assert.deepEqual(readerSizes,[narrowPortrait?19:18,18,18,18,18],'Knowledge reader uses the original text sizes');
  await reader.getByRole('button',{name:'Next',exact:true}).click();
  assert(await reader.locator('.reader-pages').evaluate(node=>node.scrollLeft>0),'long text can be read a page at a time');
  await page.evaluate(data=>window.liveTest.present({...data,answeredCount:5}),long);
  assert(await reader.isVisible(),'routine refresh leaves the reader open');
  assert.equal(await page.evaluate(()=>window.liveTest.getSnapshot().me.choice),null,'reading does not submit an answer');
  await reader.getByRole('button',{name:'Back to game'}).click();
  const questionPane=page.locator('.question-content'),answerText=page.locator('[data-choice="3"] .text');
  assert(await questionPane.evaluate(node=>node.scrollHeight>node.clientHeight),'long question scrolls inside its frame');
  await questionPane.evaluate(node=>node.scrollTop=node.scrollHeight);
  await answerText.evaluate(node=>node.scrollTop=node.scrollHeight);
  const scrolls=()=>page.evaluate(()=>[document.querySelector('.question-content').scrollTop,document.querySelector('[data-choice="3"] .text').scrollTop]);
  const positions=await scrolls(),scrolled=await measure(page);assert(positions[0]>0&&positions[1]>0);
  const cdp=await page.context().newCDPSession(page),box=await answerText.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let dy=10;dy<=60;dy+=10)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>window.liveTest.getSnapshot().me.choice),null,'scrolling inside a long answer does not select it');
  await answerText.evaluate(node=>node.scrollTop=node.scrollHeight);
  await page.evaluate(data=>window.liveTest.present({...data,answeredCount:8}),long);
  assert.deepEqual(await measure(page),scrolled,'refresh does not reset reading position');
  sameScroll(await scrolls(),positions,'refresh preserves internal reading positions');
  await page.locator('[data-choice="3"]').tap();
  await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
  assert.deepEqual(await measure(page),scrolled,'answering long material preserves scroll');
  sameScroll(await scrolls(),positions,'saving preserves internal reading positions');
  await page.evaluate(data=>window.liveTest.present(data),{...long,phase:'reveal',question:{...long.question,correct:3},distribution:[0,0,0,24],me:{...long.me,choice:3,score:625,bonuses:{first:25}}});
  assert.deepEqual(await measure(page),scrolled,'long answer reveal preserves the frame');
  sameScroll(await scrolls(),positions,'long answer reveal preserves reading positions');
  await page.evaluate(data=>window.liveTest.present(data),{...base,index:index++,question:questions[1]});
  assert.equal((await measure(page)).scroll,0,'the next question is visible after a long one');
  assert.deepEqual(await scrolls(),[0,0],'new content starts at the top inside its frame');
  if(process.env.LIVE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.LIVE_SCREENSHOT_DIR,`live-responsive-${viewport.width}x${viewport.height}.png`),fullPage:true});
  const button=await page.locator('[data-choice="0"]').elementHandle();
  await page.setViewportSize({width:viewport.height,height:viewport.width});
  assert(await button.evaluate(node=>node.isConnected),'rotation keeps the current answer buttons');
  assert((await measure(page)).pageWidth<=viewport.height,'rotation does not introduce horizontal overflow');
  // Use keyboard activation as well as the touch checks above.
  await page.locator('[data-choice="0"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===0);
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  assert.equal(await page.evaluate(()=>window.liveTest.getSnapshot().me.choice),0);
  await checkFrame(page);
  await page.getByRole('button',{name:'Exit',exact:true}).click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  assert.deepEqual(errors,[]);
  console.log(`Passed normal/long vocabulary and Knowledge layouts at ${viewport.width}×${viewport.height}`);
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of viewports)await check(browser,viewport);
  for(const viewport of [{width:320,height:568},{width:568,height:320},{width:768,height:1024}]){
   const {page}=await open(browser,viewport,false,true);
   try{
    await page.evaluate(()=>window.liveTest.joinForm());
    await checkFrame(page);
    await page.locator('input[name=name]').fill('AB');
    await page.locator('input[name=schoolEmail]').fill('ab@school.example');
    await page.getByRole('button',{name:'Choose character'}).click();
    await checkFrame(page);
    await page.locator('label').filter({has:page.locator('[value="14"]')}).click();
    assert(await page.locator('[name=avatar][value="14"]').isChecked());
    await page.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal(await page.locator('input[name=name]').inputValue(),'AB');
    await page.getByRole('button',{name:'Full screen',exact:true}).click();
    await page.getByRole('button',{name:'Exit',exact:true}).waitFor();
    const state={...base,question:questions[0]};
    for(const phase of ['lobby','question','reveal','ended','lobby']){
     await page.evaluate(data=>window.liveTest.present(data),{...state,phase,question:{...state.question,correct:0},
      scores:[{name:'AB',score:500,avatar:14}],distribution:[1,0,0,0]});
     await checkFrame(page);
     assert(await page.getByRole('button',{name:'Exit',exact:true}).isVisible());
    }
   }finally{await page.close();}
  }
  for(const viewport of viewports){
   const fallback=viewport.width<900;
   const {page,errors,now}=await open(browser,viewport,true,fallback);
   try{
    const players=Array.from({length:32},(_,i)=>({name:'S'+i,avatar:i%14+1,score:100-i}));
    const game={...base,players,playerCount:players.length,scores:players,question:{...questions[1],correct:0},deadline:now+10000,distribution:[32,0,0,0]};
    const present=phase=>page.evaluate(data=>window.liveTest.present(data),{...game,phase});
    await present('lobby');
    await checkFrame(page);
    assert(await page.locator('#qr svg').isVisible());
    await page.getByRole('button',{name:'Full screen',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.classList.contains('game-fullscreen'));
    assert.equal(await page.evaluate(()=>!!document.fullscreenElement),!fallback);
    await present('question');
    await checkTeacherRound(page);
    const before=await measure(page);
    await present('reveal');
    await checkTeacherRound(page);
    assert.deepEqual(await measure(page),before,'the reveal keeps the question column in place');
    await page.getByRole('button',{name:'Exit',exact:true}).click();
    await page.waitForFunction(()=>!document.documentElement.classList.contains('game-fullscreen'));
    await checkTeacherRound(page);
    await present('ended');
    await checkFrame(page);
    assert(await page.getByRole('button',{name:'Full screen',exact:true}).isVisible());
    assert.deepEqual(errors,[]);
   }finally{await page.close();}
  }
  const zoomed=await open(browser,{width:1024,height:768});
  try{
   await zoomed.page.evaluate(data=>window.liveTest.present(data),{...base,question:questions[1]});
   await zoomed.page.evaluate(()=>document.documentElement.style.zoom='2');
   const layout=await measure(zoomed.page);
   assert(layout.pageWidth<=layout.width,'enlarged content wraps within the page');
   await zoomed.page.locator('[data-choice="3"]').scrollIntoViewIfNeeded();
   await zoomed.page.locator('[data-choice="3"]').tap();
   await zoomed.page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
   assert.deepEqual(zoomed.errors,[]);
  }finally{await zoomed.page.close();}
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
