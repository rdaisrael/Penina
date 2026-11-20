// Actual Live client and handler; only local assets and in-memory game storage.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harness=require('./helpers/live-harness'),root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
async function open(browser,viewport,seconds=0){
 const h=harness({database:true,now:100000}),made=await h.create({seconds}),{code,hostToken}=made.body;
 const studentToken=(await h.join(code)).body.studentToken;
 await h.request('start',{code,version:0},hostToken);
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),control={pollStatus:0},posts=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.testNow=100000;Date.now=()=>window.testNow;window.setInterval=()=>0;
  const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>fn.name==='poll'?0:timeout(fn,ms,...args);
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='live.test')return route.abort();
  if(url.pathname==='/api/game-scores'){
   const body=route.request().method()==='POST'?route.request().postDataJSON():{code};
   if(!body.action&&control.pollStatus){const status=control.pollStatus;control.pollStatus=0;return route.fulfill({status,json:{error:status===401?'Rejoin this game.':'Temporary refresh failure'}});}
   if(body.action==='answer')posts.push(body);
   const response=await h.request(body.action,body,(route.request().headers().authorization||'').replace(/^Bearer /,''));
   return route.fulfill({status:response.code,json:response.body});
  }
  if(url.pathname.endsWith('/live.js'))return route.fulfill({contentType:'text/javascript',body:source.slice(0,source.indexOf(' auth=stored(storageKey())'))+' window.liveTest={present,poll,act,syncClock,updateClock,connect:value=>{auth=value;},getSnapshot:()=>snapshot};})();'});
  const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
  if(url.pathname.endsWith('/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace(/<script src="(?!(?:live\.js|student-display\.js|\.\.\/\.\.\/game-fullscreen\.js|\/PeninaPlus-knowledge-builder\/cards\.js))[^"]+"><\/script>/g,'')});
  return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
 });
 await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code='+code);
 await page.evaluate(async token=>{window.liveTest.connect(token);await window.liveTest.poll();},studentToken);
 const state=()=>page.evaluate(()=>window.liveTest.getSnapshot());
 const correct=async()=>{const data=await state();return data.question.options.indexOf(h.cards.find(card=>card.term===data.question.term).english);};
 const hostAction=async action=>{const data=(await h.request(null,{code},hostToken)).body;h.advance(1);assert.equal((await h.request(action,{code,version:data.version},hostToken)).code,200);await page.evaluate(()=>window.liveTest.poll());};
 const verifyCorrect=async choice=>{
  await page.waitForFunction(choice=>window.liveTest.getSnapshot().me.choice===choice,choice);
  assert.equal(posts.length,1,'a completed tap submits once');
  await hostAction('reveal');
  assert.equal(await page.locator('.answer.selected.correct').count(),1);
  assert.equal((await state()).me.score,125,'the handler scores the expected answer');
  assert.deepEqual(errors,[]);
 };
 return {page,h,code,control,posts,errors,state,correct,hostAction,verifyCorrect};
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE}),failures=[];
 try{
  for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
   for(const scenario of ['refresh failure','clock correction','join during tap','previous wrong overlay','fatal access error']){
    const c=await open(browser,viewport,scenario==='clock correction'?5:0),{page}=c;
    try{
     const correct=await c.correct(),button=page.locator('[data-choice="'+correct+'"]');
     if(scenario==='refresh failure'){
      const original=await button.elementHandle();c.control.pollStatus=503;await page.evaluate(()=>window.liveTest.poll());
      assert(await button.isEnabled(),'a failed refresh must not block an otherwise open answer');
      assert(await original.evaluate(node=>node.isConnected),'reconnection status must not replace an answer mid-tap');
      await button.tap();await c.verifyCorrect(correct);
     }else if(scenario==='clock correction'){
      await page.evaluate(()=>{window.liveTest.syncClock({serverReceivedAt:105000,serverNow:105000},100000,100000);window.liveTest.updateClock();});
      assert(await button.isDisabled(),'an expired local countdown closes buttons');
      await page.evaluate(()=>window.liveTest.poll());
      assert(await button.isEnabled(),'a fresh clock sample must reopen a still-active question');
      await button.tap();await c.verifyCorrect(correct);
     }else if(scenario==='join during tap'){
      const original=await button.elementHandle(),box=await button.boundingBox(),cdp=await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
      await c.h.join(c.code,'CD');await page.evaluate(()=>window.liveTest.poll());
      assert(await original.evaluate(node=>node.isConnected),'a classmate joining must not cancel the current tap');
      // Late scoring from a previous question should update the HUD in place too.
      await page.evaluate(()=>{const data=window.liveTest.getSnapshot();window.liveTest.present({...data,me:{...data.me,score:100,streak:1}});});
      assert(await original.evaluate(node=>node.isConnected),'a score update must not cancel the current tap');
      assert.equal(await page.locator('[data-player-score]').innerText(),'100');
      assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'1');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await c.verifyCorrect(correct);
     }else if(scenario==='previous wrong overlay'){
      await page.locator('[data-choice="'+((correct+1)%4)+'"]').tap();
      await page.waitForFunction(()=>window.liveTest.getSnapshot().me.choice!==null);
      await c.hostAction('reveal');assert.equal(await page.locator('.wrong-answer-mark').count(),1);
      await c.hostAction('next');
      assert.equal(await page.locator('.wrong-answer-mark').count(),0,'the previous Incorrect message must not cover the new question');
     }else{
      c.control.pollStatus=401;await page.evaluate(()=>window.liveTest.poll());
      assert(await button.isDisabled(),'expired access still closes the controls');
      await page.evaluate(choice=>window.liveTest.act('answer',{choice}),correct);
      assert.equal(c.posts.length,0,'expired access cannot send answers');
     }
     assert.deepEqual(c.errors,[]);console.log('Passed '+scenario+' at '+viewport.width);
    }catch(error){failures.push(`${scenario} at ${viewport.width}: ${error.message}`);console.error(failures.at(-1));}
    finally{await page.close();}
   }
  }
  assert.deepEqual(failures,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
