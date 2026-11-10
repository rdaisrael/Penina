const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');

// Local files and synthetic responses only; no live game or external requests.
async function check(browser,viewport,timed){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'});
 let finishSave;
 const saved=new Promise(resolve=>{finishSave=resolve;});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='live.test')return route.abort();
   if(url.pathname==='/api/game-scores'){
    const answer=route.request().postDataJSON();
    await saved;
    return route.fulfill({json:{saved:true,round:answer.round,index:answer.index,choice:answer.choice}});
   }
   if(url.pathname.endsWith('/live.js'))return route.fulfill({contentType:'text/javascript',body:source.slice(0,source.indexOf(' auth=stored(storageKey())'))+' window.liveTest={present,getSnapshot:()=>snapshot};})();'});
   const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
   if(url.pathname.endsWith('/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace(/<script src="(?!live.js)[^"]+"><\/script>/g,'')});
   if(fs.existsSync(file))return route.fulfill({path:file});
   return route.abort();
  });
  // Hold clock ticks to check the immediate render, before a later tick can repair it.
  const now=Date.now();
  await page.addInitScript(now=>{window.setInterval=()=>0;Date.now=()=>now;},now);
  await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code=123456');
  const question={phase:'question',round:1,index:1,version:2,className:'Demo',playerCount:20,answeredCount:0,total:5,paused:false,deadline:timed?now+10000:null,question:{term:'בית',options:['House','Water','Book','Light']},me:{name:'AB',avatar:1,score:0,choice:null}};
  await page.evaluate(data=>window.liveTest.present(data),question);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const measure=()=>page.evaluate(()=>({
   scroll:window.scrollY,height:document.documentElement.scrollHeight,
   boxes:[...document.querySelectorAll('.question,.answers,.answer,footer')].map(el=>{
    const {x,y,width,height}=el.getBoundingClientRect();return {x,y,width,height};
   }),
   clock:document.querySelector('[data-clock]')?.textContent??null
  }));
  const before=await measure();
  const label=`${viewport.width}×${viewport.height}, ${timed?'timed':'manual'}`;
  await page.locator('[data-choice="3"]').tap();
  assert.equal(await page.locator('.answer.selected').getAttribute('data-choice'),'3');
  assert.equal(await page.locator('.answer:disabled').count(),4);
  assert.deepEqual(await measure(),before,label+': choosing an answer must preserve the layout and countdown');
  assert.equal(await page.getByRole('status').filter({hasText:'Your first answer is final'}).count(),0,'instructions are no longer announced after answering');
  finishSave();
  await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice===3);
  assert.deepEqual(await measure(),before,label+': acknowledgement must preserve the layout and countdown');
  await page.evaluate(data=>window.liveTest.present({...data,version:3,answeredCount:12}),question);
  assert.deepEqual(await measure(),before,label+': stale refresh must preserve layout');
  assert.equal(await page.locator('.answer.selected').getAttribute('data-choice'),'3');
  await page.evaluate(data=>window.liveTest.present({...data,index:2,version:4}),question);
  assert.equal(await page.locator('.answer:disabled').count(),0);
  assert.equal(await page.getByRole('status').filter({hasText:'Your first answer is final'}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('Passed '+label);
 }finally{finishSave();await page.close();}
}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of [{width:375,height:667},{width:390,height:844},{width:1024,height:768},{width:1440,height:900}]){
   for(const timed of [true,false])await check(browser,viewport,timed);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
