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
 {kind:'knowledge',term:'מדוע התאספו האנשים בשער העיר?',options:['כדי לשמוע את דברי המלך','כדי לקנות אוכל למסע','כדי לקבל את פני האורחים','כדי להתכונן לחג']}
];
const base={phase:'question',round:1,index:1,version:2,className:'Sixth Grade Knowledge',playerCount:24,answeredCount:0,total:20,paused:false,
 me:{name:'AB',avatar:1,score:500,streak:4,choice:null},players:[]};
async function open(browser,viewport,host=false){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='live.test')return route.abort();
  if(url.pathname==='/api/game-scores'){
   const answer=route.request().postDataJSON();
   return route.fulfill({json:{saved:true,round:answer.round,index:answer.index,choice:answer.choice}});
  }
  if(url.pathname.endsWith('/live.js'))return route.fulfill({contentType:'text/javascript',body:source.slice(0,source.indexOf(' auth=stored(storageKey())'))+' window.liveTest={present,getSnapshot:()=>snapshot};})();'});
  const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
  if(url.pathname.endsWith('/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace(/<script src="(?!(?:live\.js|\/PeninaPlus-knowledge-builder\/cards\.js|qrcode\.js))[^"]+"><\/script>/g,'')});
  if(fs.existsSync(file))return route.fulfill({path:file});
  return route.abort();
 });
 const now=Date.now();
 await page.addInitScript(now=>{Date.now=()=>now;window.setInterval=()=>0;},now);
 await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code=123456'+(host?'&host=1':''));
 return {page,errors,now};
}
const measure=page=>page.evaluate(()=>({
 scroll:scrollY,width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
 boxes:[...document.querySelectorAll('.question,.answer')].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,font:parseFloat(s.fontSize)};})
}));
async function check(browser,viewport){
 const {page,errors,now}=await open(browser,viewport);let index=1;
 try{
  for(const question of questions)for(const timed of [false,true]){
   const state={...base,index:index++,question,deadline:timed?now+10000:null};
   await page.evaluate(data=>window.liveTest.present(data),state);
   const layout=await measure(page),label=`${viewport.width}×${viewport.height} ${question.kind||'vocabulary'} ${timed?'timed':'manual'}`;
   assert.equal(layout.scroll,0,label+': a new question starts at the top');
   assert(layout.pageWidth<=layout.width,label+': no horizontal scrolling');
   assert(layout.boxes.every(b=>b.top>=0&&b.bottom<=layout.height),label+': normal question and all answers fit '+JSON.stringify(layout.boxes));
   assert(layout.boxes.every(b=>b.font>=18),label+': text remains readable');
   assert(layout.boxes.slice(1).every(b=>b.height>=48),label+': comfortable tap targets');
   assert.equal(await page.locator('.answer').count(),4);
   await page.locator('[data-choice="3"]').tap();
   await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
   assert.deepEqual(await measure(page),layout,label+': selection and saving do not move content');
   await page.evaluate(data=>window.liveTest.present({...data,answeredCount:10}),state);
   assert.deepEqual(await measure(page),layout,label+': routine refresh keeps the page stable');
  }
  const long={...base,index:index++,deadline:now+10000,question:{kind:'knowledge',term:Array(12).fill('Read the passage carefully and explain how the events support the conclusion.').join('\n\n'),options:questions[1].options.map(text=>text+'. '+Array(3).fill('Consider the evidence given in the passage.').join(' '))}};
  await page.evaluate(data=>window.liveTest.present(data),long);
  const longLayout=await measure(page);
  assert(longLayout.boxes.some(b=>b.bottom>viewport.height),'long material can extend below the screen');
  assert(longLayout.boxes.every(b=>b.font>=18),'long material is not shrunk to fit');
  assert(longLayout.pageWidth<=viewport.width,'long material wraps within the screen');
  await page.locator('[data-choice="3"]').scrollIntoViewIfNeeded();
  const scrolled=await measure(page);assert(scrolled.scroll>0);
  await page.evaluate(data=>window.liveTest.present({...data,answeredCount:8}),long);
  assert.deepEqual(await measure(page),scrolled,'refresh does not reset reading position');
  await page.locator('[data-choice="3"]').tap();
  await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
  assert.deepEqual(await measure(page),scrolled,'answering long material preserves scroll');
  await page.evaluate(data=>window.liveTest.present(data),{...base,index:index++,question:questions[1]});
  assert.equal((await measure(page)).scroll,0,'the next question is visible after a long one');
  if(process.env.LIVE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.LIVE_SCREENSHOT_DIR,`live-responsive-${viewport.width}x${viewport.height}.png`),fullPage:true});
  const button=await page.locator('[data-choice="0"]').elementHandle();
  await page.setViewportSize({width:viewport.height,height:viewport.width});
  assert(await button.evaluate(node=>node.isConnected),'rotation keeps the current answer buttons');
  assert((await measure(page)).pageWidth<=viewport.height,'rotation does not introduce horizontal overflow');
  // Use keyboard activation as well as the touch checks above.
  await page.locator('[data-choice="0"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===0);
  assert.deepEqual(errors,[]);
  console.log(`Passed normal/long vocabulary and Knowledge layouts at ${viewport.width}×${viewport.height}`);
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of viewports)await check(browser,viewport);
  const {page,errors,now}=await open(browser,{width:1024,height:768},true);
  try{
   await page.evaluate(data=>window.liveTest.present(data),{...base,question:questions[1],deadline:now+10000});
   assert((await measure(page)).boxes.every(b=>b.bottom<=768),'teacher question and answers fit on iPad');
   assert.equal(await page.locator('.live-join-qr').count(),1,'teacher join QR remains available');
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
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
