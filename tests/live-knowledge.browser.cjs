const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const liveHarness=require('./helpers/live-harness');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');

// Real client and game handler, with local assets and in-memory storage only.
// CDP sends actual touch gestures so browser scroll/click cancellation is exercised.
async function check(browser,viewport){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'});
 const cdp=await page.context().newCDPSession(page),errors=[],submissions=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const src=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#edf4ee';ctx.fillRect(0,0,800,500);
   ctx.fillStyle='#286638';ctx.fillRect(100,100,200,300);ctx.fillStyle='#9b5832';ctx.fillRect(500,100,200,300);
   return canvas.toDataURL('image/png');
  });
  const prompt='Read the whole question before choosing your answer. Explain which of the listed descriptions answers this question, paying attention to the marked part and the information discussed in class.';
  const cards=Array.from({length:4},(_,i)=>({
   id:'fact-'+i,question:prompt+(i<2?' Question '+i:'.'),answer:'Correct description '+i,
   distractors:{english:Array.from({length:[1,2,3,5][i]},(_,n)=>'Different description '+i+' '+n)},
   ...(i%2?{textFormatting:{question:{paragraphs:[{runs:[{text:prompt,bold:true},{text:i<2?' Question '+i:'.'}],direction:'ltr',align:'left'}]}}}:{}),
   ...(i>=2?{picture:{src,alt:'Diagram '+i,target:{type:'arrow',x:i===2?.25:.75,y:.5,tail:{x:.5,y:.9}}}}:{})
  }));
  const h=liveHarness({database:true}),pathname='knowledge-cards/sixth/touch-check.json';
  h.storage.set(pathname,{body:JSON.stringify({format:'penina-knowledge-cards',version:1,title:'Knowledge touch check',cards}),uploadedAt:new Date().toISOString()});
  const made=await h.create({pathnames:[pathname],count:5,seconds:0});assert.equal(made.code,201);
  const {code,hostToken}=made.body,joined=await h.join(code),studentToken=joined.body.studentToken;
  assert.equal((await h.request('start',{code,version:0},hostToken)).code,200);
  await page.addInitScript(({code,studentToken})=>sessionStorage.setItem('penina-live-student-'+code,studentToken),{code,studentToken});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='live.test')return route.abort();
   if(url.pathname==='/api/game-scores'){
    const body=route.request().method()==='POST'?route.request().postDataJSON():{code:url.searchParams.get('code')};
    if(body.action==='answer')submissions.push(body);
    const token=(route.request().headers().authorization||'').replace(/^Bearer /,'');
    const response=await h.request(body.action,body,token);
    return route.fulfill({status:response.code,json:response.body});
   }
   if(url.pathname.endsWith('/live.js'))return route.fulfill({contentType:'text/javascript',body:source.replace(' auth=stored(storageKey())'," window.liveTest={poll,getSnapshot:()=>snapshot}; auth=stored(storageKey())")});
   const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
   if(url.pathname.endsWith('/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace(/<script src="(?!(?:live\.js|student-display\.js|\.\.\/\.\.\/game-fullscreen\.js|\/PeninaPlus-knowledge-builder\/cards\.js))[^"]+"><\/script>/g,'')});
   if(fs.existsSync(file))return route.fulfill({path:file});
   return route.abort();
  });
  await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code='+code);
  await page.waitForSelector('[data-choice]');
  let score=0;
  for(let index=0;index<cards.length;index++){
   await page.waitForFunction(index=>window.liveTest.getSnapshot()?.index===index,index);
   const state=await page.evaluate(()=>window.liveTest.getSnapshot());
   const card=cards.find(card=>card.question===state.question.term&&card.picture?.alt===state.question.picture?.alt);
   assert(card,'each saved picture/question must retain its own answer');
   assert.equal(state.question.kind,'knowledge');
   assert(await page.locator('.question').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)<=28),'Knowledge questions use reading-sized type');
   assert.equal(state.question.options.length,Math.min(4,card.distractors.english.length+1));
   assert.equal(await page.locator('.question strong').count(),card.textFormatting?1:0);
   assert.equal(await page.locator('.live-picture .picture-arrow').count(),card.picture?1:0);
   const correct=state.question.options.indexOf(card.answer);assert(correct>=0);
   const wrong=state.question.options.findIndex(option=>option!==card.answer);
   const first=page.locator('[data-choice="'+wrong+'"]');
   await first.evaluate(node=>node.scrollIntoView({block:'center'}));
   const box=await first.boundingBox(),x=box.x+box.width/2,y=Math.min(viewport.height-40,box.y+box.height/2);
   const before=submissions.length;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let dy=20;dy<=140;dy+=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(submissions.length,before,'scrolling from an answer must not submit that answer');
   assert.equal(await page.locator('.answer.selected').count(),0);
   // A routine refresh between finger-down and release must preserve the target.
   const answer=page.locator('[data-choice="'+correct+'"]');
   await answer.evaluate(node=>node.scrollIntoView({block:'center'}));
   const target=await answer.boundingBox(),tx=target.x+target.width/2,ty=target.y+target.height/2;
   const measure=()=>page.evaluate(()=>({scroll:scrollY,height:document.documentElement.scrollHeight,
    boxes:[...document.querySelectorAll('.question,.answers,.answer')].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})}));
   const beforeTap=await measure();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
   await page.evaluate(()=>window.liveTest.poll());
   assert.equal(submissions.length,before,'touch-down alone must not submit');
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForFunction(choice=>window.liveTest.getSnapshot()?.me.choice===choice,correct);
   assert.equal(submissions.length,before+1,'one completed tap saves one answer');
   assert.equal(await page.locator('.answer.selected').getAttribute('data-choice'),String(correct));
   assert.deepEqual(await measure(),beforeTap,'selection and acknowledgement keep the page in place');
   const stored=await h.request(null,{code},studentToken);assert.equal(stored.body.me.choice,correct);
   const hostState=await h.request(null,{code},hostToken);
   assert.equal((await h.request('reveal',{code,version:hostState.body.version},hostToken)).code,200);
   await page.evaluate(()=>window.liveTest.poll());
   await page.waitForFunction(()=>window.liveTest.getSnapshot()?.phase==='reveal');
   assert.equal(await page.locator('.answer.selected.correct').count(),1);
   score+=125;assert.equal((await h.request(null,{code},studentToken)).body.me.score,score);
   const reveal=await h.request(null,{code},hostToken);
   assert.equal((await h.request('next',{code,version:reveal.body.version},hostToken)).code,200);
   await page.evaluate(()=>window.liveTest.poll());
  }
  await page.waitForFunction(()=>window.liveTest.getSnapshot()?.phase==='ended');
  assert.deepEqual(errors,[]);
  console.log('Passed Knowledge touch, formatting, pictures, answer mapping, and scoring at '+viewport.width+'×'+viewport.height);
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{for(const viewport of [{width:390,height:844},{width:1024,height:768}])await check(browser,viewport);}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
