// Local generated Gamify pages; native browser taps/keys and actual game handlers.
// Animation is stepped deterministically. Two test-only hooks reach arcade states
// without playing full rounds; they do not replace grading or collision code.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const app=require('../PeninaPlus-vocab-builder/offline-study-cards');
const longAnswer='Correct '+Array(12).fill('The answer follows from the evidence.').join(' ');
const card=(term,definition,kind='knowledge',answers=['Other A','Other B','Other C','Other D'])=>({term,english:definition,...(kind==='knowledge'?{kind}:{}),alternativeAnswers:{english:{term,definition,answers}}});
const mixed=[card('בַּיִת','house','vocabulary'),card('Why did they gather?','To hear the announcement'),card('What does the evidence show?',longAnswer)];
async function open(browser,viewport,cards=mixed){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  Math.random=()=>.5;let time=0,id=0;const frames=new Map();
  performance.now=()=>time;requestAnimationFrame=fn=>{frames.set(++id,fn);return id};cancelAnimationFrame=id=>frames.delete(id);
  window.stepFrames=(count,ms=16)=>{for(let i=0;i<count;i++){time+=ms;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(time));}};
 });
 let html=app.makeClassGames('Input regression',cards,{homeUrl:'/class'});
 html=html.replace('return ()=>{destroyed=true;stop();',`window.flappyCheck={get:()=>({state,index,score,vy,readTime,answers}),lane:lane=>{x=el('bird').offsetLeft+37;y=lane*156+30;readTime=0;vy=0;tick(last+16);}};return ()=>{destroyed=true;stop();`);
 html=html.replace('return ()=>{dead=true;cancelAnimationFrame(raf);',`window.snowCheck={get:()=>({state,score,blasts}),hit,recharge:()=>{blasts=0;recharge();}};return ()=>{dead=true;cancelAnimationFrame(raf);`);
 await page.route('**/*',r=>r.request().url().startsWith('http://localhost/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.goto('http://localhost/#gamify');return {page,errors};
}
async function launch(page,game){
 await page.locator('[data-game="'+game+'"]').click();
 if(await page.locator('#gameInitials').isVisible())await page.locator('#gameInitials').fill('AB');
 await page.locator('#gameLaunch').click();
 if(game==='flappy')await page.getByRole('button',{name:'Start flying →'}).click();
 if(game==='snowblaster')await page.getByRole('button',{name:'Start blasting',exact:true}).click();
}
async function swipe(page,node){
 await node.scrollIntoViewIfNeeded();const b=await node.boundingBox(),x=b.x+b.width/2,y=b.y+b.height-10;
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let dy=10;dy<=Math.min(70,b.height-20);dy+=10)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});const failures=[];
 async function check(name,viewport,cards,run){let page;try{const opened=await open(browser,viewport,cards);page=opened.page;await run(page);assert.deepEqual(opened.errors,[]);console.log('PASS '+name+' '+viewport.width);}catch(error){failures.push(name+' '+viewport.width+': '+error.message);console.error('FAIL '+failures.at(-1));}finally{await page?.close();}}
 try{
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1200,height:900}]){
   for(const game of ['quiz','asteroids','chomp'])await check(game+' native answers and scrolling',viewport,[card('A longer Knowledge question',longAnswer)],async page=>{
    await launch(page,game);const scope={quiz:'.game-options',asteroids:'.asteroids-options',chomp:'#chomp-game .choices'}[game];
    const correct=page.locator(scope).getByRole('button',{name:longAnswer,exact:true});
    await swipe(page,correct);
    assert.equal(await correct.isDisabled(),false,'scrolling must not answer');
    assert(await correct.evaluate(n=>n.scrollTop>0),'long answer scrolls');
    // A cancelled touch is not an answer either.
    const cdp=await page.context().newCDPSession(page),box=await correct.boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();
    if(game==='quiz')assert.match(await page.locator('#gameProgress').innerText(),/0 attempts/);
    if(game==='chomp')assert.equal(await page.locator('#cc-accuracy').innerText(),'—');
    await correct.tap();
    if(game==='quiz'){assert.equal(await page.locator('#gameFeedback').innerText(),'Correct! Great work.');assert.match(await page.locator('#gameProgress').innerText(),/1 attempts/);}
    if(game==='asteroids')assert.match(await page.locator('#gameFeedback').innerText(),/^Correct!/);
    if(game==='chomp')assert.equal(await page.locator('#cc-accuracy').innerText(),'1 / 1');
   });
   for(const game of ['cards','lines'])await check(game+' equivalent visible answers',viewport,[card('Question A','café'),card('Question B','cafe\u0301'),card('Question C','a  house'),card('Question D','a house')],async page=>{
    await launch(page,game);
    await page.getByRole('button',{name:'Term: Question A',exact:true}).tap();
    await page.getByRole('button',{name:'Definition: cafe\u0301',exact:true}).tap();
    assert.equal(await page.locator('#gameFeedback').innerText(),'Correct match!','canonical Unicode is the same answer');
    const term=page.getByRole('button',{name:'Term: Question B',exact:true});await term.focus();await page.keyboard.press('Enter');
    const answer=page.getByRole('button',{name:'Definition: café',exact:true});await answer.focus();await page.keyboard.press('Space');
    assert.equal(await answer.isDisabled(),true,'keyboard selection grades the other identical answer correctly');
    await page.getByRole('button',{name:'Term: Question C',exact:true}).tap();
    await page.locator('.game-definition').filter({hasText:/^a house$/}).tap();
    assert.equal(await page.locator('#gameFeedback').innerText(),'Correct match!','collapsed display whitespace is equivalent');
   });
   await check('Connect the Words drag ownership',viewport,[card('Question A','Answer A'),card('Question B','Answer B')],async page=>{
    await launch(page,'lines');const a=page.getByRole('button',{name:'Term: Question A',exact:true}),b=page.getByRole('button',{name:'Term: Question B',exact:true}),answer=page.getByRole('button',{name:'Definition: Answer A',exact:true});
    await a.scrollIntoViewIfNeeded();const start=await a.locator('.game-dot').boundingBox(),end=await answer.locator('.game-dot').boundingBox();
    await page.mouse.move(start.x+9,start.y+9);await page.mouse.down();await page.mouse.move(end.x+9,end.y+9,{steps:8});
    // A stray/second pointer must not finish the first pointer's drag.
    await b.evaluate((node,end)=>node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:999,isPrimary:false,clientX:end.x+9,clientY:end.y+9})),end);
    assert.match(await page.locator('#gameProgress').innerText(),/0 attempts/,'unrelated pointerup does not grade a match');
    await page.mouse.up();assert.equal(await a.isDisabled(),true);assert.equal(await b.isDisabled(),false);assert.match(await page.locator('#gameProgress').innerText(),/1 attempts/);
    assert.equal(await page.locator('.game-link.dragging').count(),0);
    // Lost capture cancels without leaving a ghost line or recording an answer.
    await b.scrollIntoViewIfNeeded();const next=await b.locator('.game-dot').boundingBox();
    await b.evaluate(n=>n.addEventListener('pointerdown',e=>window.dragPointer=e.pointerId,{once:true}));
    await page.mouse.move(next.x+9,next.y+9);await page.mouse.down();await page.mouse.move(next.x+30,next.y+20);
    await b.evaluate(n=>n.releasePointerCapture(window.dragPointer));await page.mouse.move(next.x+31,next.y+21);await page.mouse.up();
    assert.equal(await page.locator('.game-link.dragging').count(),0);assert.match(await page.locator('#gameProgress').innerText(),/1 attempts/);
   });
   await check('Connect native touch drag and cancellation',viewport,[card('Question A','Answer A')],async page=>{
    await launch(page,'lines');const term=page.getByRole('button',{name:'Term: Question A',exact:true}),answer=page.getByRole('button',{name:'Definition: Answer A',exact:true});
    await term.scrollIntoViewIfNeeded();const a=await term.locator('.game-dot').boundingBox(),b=await answer.locator('.game-dot').boundingBox(),cdp=await page.context().newCDPSession(page);
    for(const cancel of [true,false]){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+9,y:a.y+9}]});
     for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+9+(b.x-a.x)*i/8,y:a.y+9+(b.y-a.y)*i/8}]});
     await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
     assert.equal(await page.locator('.game-link.dragging').count(),0);
     assert.equal(await term.isDisabled(),!cancel);
     assert.match(await page.locator('#gameProgress').innerText(),cancel?/0 attempts/:/1 attempts/);
    }
    await cdp.detach();assert.equal(await page.locator('.game-link:not(.dragging)').count(),1);
   });
   await check('Flappy scrolling and lane grading',viewport,[card('Read the passage',longAnswer)],async page=>{
    await launch(page,'flappy');const answer=page.locator('#fv-gate .answer').filter({hasText:longAnswer});
    const before=await page.evaluate(()=>flappyCheck.get());await swipe(page,answer);
    const after=await page.evaluate(()=>flappyCheck.get());assert.equal(after.vy,before.vy,'scrolling an answer must not flap');assert.equal(after.readTime,before.readTime);
    assert(await answer.evaluate(n=>n.scrollTop>0),'full answer is readable');
    await answer.tap();assert.equal((await page.evaluate(()=>flappyCheck.get())).vy,-140,'deliberate world tap still flaps');
    await page.locator('#fv-flap').tap();assert.equal((await page.evaluate(()=>flappyCheck.get())).vy,-140);
    await page.evaluate(correct=>flappyCheck.lane(flappyCheck.get().answers.indexOf(correct)),longAnswer);
    assert.equal((await page.evaluate(()=>flappyCheck.get())).score,100,'correct lane awards points');
    await page.evaluate(correct=>flappyCheck.lane(flappyCheck.get().answers.findIndex(a=>a!==correct)),longAnswer);
    assert.equal((await page.evaluate(()=>flappyCheck.get())).score,0,'wrong lane deducts once');
    await page.getByRole('button',{name:'Try this word again →'}).tap();assert.equal((await page.evaluate(()=>flappyCheck.get())).state,'flight');
   });
   await check('Snowblaster long targets and recharge',viewport,[card('Read the passage',longAnswer)],async page=>{
    await launch(page,'snowblaster');const target=page.locator('.sb-target').filter({hasText:longAnswer}),label=target.locator('span');
    const box=await target.boundingBox(),world=await page.locator('.sb-world').boundingBox();assert(box.height<world.height/2,'answer target must fit within the play area');
    await swipe(page,label);assert(await label.evaluate(n=>n.scrollTop>0),'long label can scroll');assert.equal((await page.evaluate(()=>snowCheck.get())).blasts,2,'scrolling does not fire');
    await label.tap();assert.equal((await page.evaluate(()=>snowCheck.get())).blasts,1,'deliberate label tap fires');
    assert.equal((await page.evaluate(()=>snowCheck.get())).score,200,'a shot is not graded before collision');
    await page.evaluate(()=>snowCheck.recharge());const options=page.locator('.sb-recharge .asteroids-options');
    await options.getByRole('button',{name:'Other A',exact:true}).tap();assert.equal(await options.getByRole('button',{name:longAnswer,exact:true}).isEnabled(),true);
    await options.getByRole('button',{name:longAnswer,exact:true}).focus();await page.keyboard.press('Space');
    assert.equal((await page.evaluate(()=>snowCheck.get())).state,'falling');assert.equal((await page.evaluate(()=>snowCheck.get())).blasts,1);
    // Controlled collision entry: actual hit() grades against the displayed target.
    await page.evaluate(correct=>snowCheck.hit([...document.querySelectorAll('.sb-target')].findIndex(n=>n.dataset.answer===correct)),longAnswer);
    assert.equal((await page.evaluate(()=>snowCheck.get())).score,300);assert.match(await page.locator('.sb-status').innerText(),/^Melted!/);
   });
  }
  // Mix vocabulary/Knowledge and vary one through five saved distractors. Native
  // answers, first/second misses, retries and close/reopen use real timers.
  await check('Mixed quiz retries and cancelled old feedback',{width:390,height:844},[...mixed,...[1,2,3,5].map(n=>card('Knowledge '+n,'Answer '+n,'knowledge',Array.from({length:n},(_,i)=>'Wrong '+n+' '+i)))],async page=>{
   await launch(page,'quiz');const prompt=page.locator('#gameBoard>h3');let misses=0;
   for(let i=0;i<8;i++){
    const text=await prompt.innerText(),rows=app.practiceRows([...mixed,...[1,2,3,5].map(n=>card('Knowledge '+n,'Answer '+n,'knowledge',Array.from({length:n},(_,i)=>'Wrong '+n+' '+i)))],'english'),row=rows.find(r=>r.term===text);
    const options=page.locator('.game-options');assert.equal(await options.locator('button').count(),row.answers.length+1);
    if(i===0){for(const wrong of row.answers.slice(0,2)){await options.getByRole('button',{name:wrong,exact:true}).tap();misses++;await page.locator('#gameMistake').waitFor({state:'detached'});} }
    else await options.getByRole('button',{name:row.definition,exact:true}).tap();
    if(i<7)await page.waitForFunction(t=>document.querySelector('#gameBoard>h3').innerText!==t,text,{polling:30});
   }
   assert.equal(misses,2);await page.locator('#gameBack').click();await page.locator('#gameClose').click();await page.locator('#gamify').click();await launch(page,'quiz');
   const fresh=await prompt.innerText();await page.waitForTimeout(1500);assert.equal(await prompt.innerText(),fresh);assert.match(await page.locator('#gameProgress').innerText(),/0 attempts/);
  });
 }finally{await browser.close();}
 if(failures.length)throw new Error(failures.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1});
