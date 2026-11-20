// Real standalone Gamify renderers, local HTML, no external requests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const games=require('../PeninaPlus-vocab-builder/offline-study-cards');
const prompts={vocabulary:'בַּיִת',knowledge:'Why did the people gather at the city gate, and what did they expect to hear from the king?',long:Array(14).fill('Read the passage carefully and explain how the events support the conclusion.').join('\n\n')};
function cards(kind){return Array.from({length:6},(_,i)=>{
 const term=prompts[kind]+' '+i;
 const suffix=kind==='long'?' '+Array(12).fill('Consider the evidence in the passage.').join(' '):'',definition='Correct'+suffix;
 return {term,english:definition,...(kind!=='vocabulary'?{kind:'knowledge',sourceId:'card-'+i}:{}),alternativeAnswers:{english:{term,definition,answers:['Other answer','Different answer','Another answer','Wrong answer'].map(answer=>answer+suffix)}}};
});}
const selectors={
 quiz:'.game-options,.game-options .game-tile',
 lines:'.game-columns,.game-columns .game-tile',
 cards:'.game-card-grid,.game-card-grid .game-tile',
 asteroids:'.asteroids-arena,.asteroids-options,.asteroids-options button',
 chomp:'#chomp-game .arena,#chomp-game .choices,#chomp-game .choices button',
 flappy:'#fv-world,#fv-flap',
 snowblaster:'.sb-world,.sb-controls'
};
const textSelector={quiz:'#gameBoard>h3',lines:'.game-term .game-tile-copy',cards:'.game-term .game-tile-copy',asteroids:'.asteroids-term',chomp:'#chomp-game .word',flappy:'#fv-clue',snowblaster:'.sb-prompt'};
async function open(browser,viewport,html,{denyFullscreen=false}={}){
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 if(denyFullscreen)await page.addInitScript(()=>{Element.prototype.requestFullscreen=()=>Promise.reject(Error('Unavailable'));});
 await page.addInitScript(()=>{requestAnimationFrame=()=>1;cancelAnimationFrame=()=>{};Math.random=()=>.5;});
 await page.route('**/*',route=>route.request().url().startsWith('http://localhost/')?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto('http://localhost/#gamify');
 return {page,errors};
}
async function launch(page,game){
 if(!(await page.locator('#gamesDialog').isVisible()))await page.locator('#gamify').click();
 await page.locator('[data-game="'+game+'"]').click();
 if(await page.locator('#gameInitials').isVisible())await page.locator('#gameInitials').fill('AB');
 await page.locator('#gameLaunch').click();
 if(game==='flappy')await page.getByRole('button',{name:'Start flying →'}).click();
 if(game==='snowblaster')await page.getByRole('button',{name:'Start blasting',exact:true}).click();
 await page.locator(textSelector[game]).first().waitFor();
}
async function checkAsteroidsFrame(page,fullscreen){
 const dims=await page.evaluate(()=>{
  const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
  const dialog=document.getElementById('gamesDialog');
  return {w:innerWidth,h:innerHeight,arena:rect('.asteroids-arena'),controls:rect('.asteroids-controls'),
   toggle:rect('#gameFullscreen'),again:rect('#gameAgain'),back:rect('#gameBack'),
   guidance:rect('.asteroids-rules'),scroll:dialog.scrollHeight-dialog.clientHeight,close:rect('#gameClose')};
 });
 const {arena,controls,toggle}=dims;
 assert(dims.scroll<=1 && arena.height>0 && controls.bottom<=dims.h+1,'flight area and controls fit');
 assert(toggle.right<=arena.right && arena.right-toggle.right<12 && arena.bottom-toggle.bottom<12,'toggle stays in the navy corner');
 assert.equal(dims.close.height,0);
 if(fullscreen){
  assert(Math.abs(arena.top)<1 && Math.abs(arena.width-dims.w)<1 && Math.abs(controls.bottom-dims.h)<1,'fullscreen spans only the arena and flight buttons');
  assert.equal(dims.again.height,0);
 }else{
  assert(dims.again.bottom<=dims.h && dims.again.top>=controls.bottom);
  assert(dims.again.left>=dims.guidance.right || dims.again.top>=dims.guidance.bottom-1);
  assert(Math.abs(dims.again.top-dims.back.top)<1 && dims.back.left>=dims.again.right,'navigation stays together, in order');
 }
}
async function checkPlayFrame(page,game,fullscreen){
 if(game==='asteroids')return checkAsteroidsFrame(page,fullscreen);
 const state=await page.evaluate(()=>{
  const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
  const dialog=document.getElementById('gamesDialog'),surface=document.getElementById('gameSurface');
  return {w:innerWidth,h:innerHeight,frame:rect('gamePlay'),again:rect('gameAgain'),back:rect('gameBack'),
   close:rect('gameClose'),toggle:rect('gameFullscreen'),board:rect('gameBoard'),
   over:[dialog,surface,document.getElementById('gamePlay')].map(el=>[el.scrollHeight-el.clientHeight,el.scrollWidth-el.clientWidth])};
 });
 const fits=r=>r.top>=-1&&r.bottom<=state.h+1&&r.left>=-1&&r.right<=state.w+1;
 assert(state.over.every(([h,w])=>h<=1&&w<=1),game+' frame fits without scrolling '+JSON.stringify(state));
 assert(fits(state.board)&&fits(state.toggle)&&state.toggle.height>0&&state.close.height===0,game+' board and fullscreen control remain on screen');
 assert(state.frame.right-state.toggle.right<30,game+' toggle is on the right');
 if(fullscreen){
  assert.equal(state.back.height,0);
  assert(Math.abs(state.frame.bottom-state.toggle.bottom)<18,game+' toggle is in the bottom corner');
 }else{
  assert(fits(state.back)&&state.back.height>0);
  assert(state.again.height>0&&fits(state.again)&&Math.abs(state.again.top-state.back.top)<1&&state.again.right<=state.back.left);
 }
}
async function geometry(page,game){return page.locator('#gamesDialog').evaluate((dialog,selector)=>({
 top:dialog.getBoundingClientRect().top,height:dialog.getBoundingClientRect().height,scroll:dialog.scrollTop,
 boxes:[...dialog.querySelectorAll(selector)].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})
}),selectors[game]);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1200,height:900}]){
   for(const game of Object.keys(selectors)){
    let baseline;
    for(const kind of ['vocabulary','knowledge','long']){
     const {page,errors}=await open(browser,viewport,games.makeClassGames('Layout check',cards(kind),{homeUrl:'/class'}));
     try{
      await launch(page,game);
      const current=await geometry(page,game);
      assert(current.boxes.length,game+' has visible controls');
      if(baseline)assert.deepEqual(current,baseline,game+' keeps the same frame/controls for '+kind+' at '+viewport.width);else baseline=current;
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),game+' has no page overflow');
      if(['quiz','cards','lines'].includes(game)){
       const progress=page.locator('#gameProgress'),original=await progress.innerText();
       const counts=game==='quiz'?'1000 of 1000 terms mastered · 1999 attempts':'48 of 120 pairs matched · 109 attempts · Round 20 · 3 attempts remaining · 999.9 seconds';
       await progress.evaluate((node,text)=>node.textContent=text,counts);
       assert.deepEqual(await geometry(page,game),current,game+' longer progress counts do not move answers');
       await progress.evaluate((node,text)=>node.textContent=text,original);
      }
      if(kind==='long'){
       const pane=page.locator(textSelector[game]).first();
       assert(await pane.evaluate(node=>node.scrollHeight>node.clientHeight),game+' long questions can scroll');
       await pane.evaluate(node=>node.scrollTop=node.scrollHeight);
       assert(await pane.evaluate(node=>node.scrollTop>0),game+' long questions remain accessible');
       assert.deepEqual(await geometry(page,game),current,game+' reading does not move controls');
       if(viewport.width===390&&['cards','lines'].includes(game)){
        await pane.scrollIntoViewIfNeeded();await pane.evaluate(node=>node.scrollTop=0);
        const cdp=await page.context().newCDPSession(page),box=await pane.boundingBox(),x=box.x+box.width/2,y=box.y+box.height-15;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        for(let dy=10;dy<=60;dy+=10)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.equal(await page.locator('.game-tile.selected,.game-tile.matched').count(),0,game+' scrolling does not select a tile');
        assert(await pane.evaluate(node=>node.scrollTop>0),game+' touch scroll reaches long text');
        await pane.tap();
        assert.equal(await page.locator('.game-tile.selected').count(),1,game+' deliberate tap still selects a tile');
       }
      }
      if(kind==='long'){
       await page.getByRole('button',{name:['lines','cards'].includes(game)?'Read board':'Read full card'}).click();
       const pages=page.locator('.asteroids-pages');
       await page.getByRole('button',{name:'Next',exact:true}).click();
       assert(await pages.evaluate(n=>n.scrollLeft>0),'read long text a page at a time');
       await page.getByRole('button',{name:'Back to game'}).click();
      }
      if(kind==='vocabulary'){
       await checkPlayFrame(page,game,false);
       const playing=await page.locator(textSelector[game]).first().elementHandle();
       await page.getByRole('button',{name:'Full screen',exact:true}).click();
       await page.waitForFunction(()=>document.fullscreenElement===document.getElementById('gameSurface'));
       await checkPlayFrame(page,game,true);
       if(game==='asteroids'){
        const fuel=page.locator('#asteroidFuel');
        await page.locator('.asteroids-options button').filter({hasText:'Correct'}).click();
        assert.equal(await fuel.textContent(),'10');
        await checkAsteroidsFrame(page,true);
       }
       await page.getByRole('button',{name:'Exit',exact:true}).click();
       await page.waitForFunction(()=>!document.fullscreenElement);
       assert(await playing.evaluate(node=>node.isConnected),game+' stays mounted through fullscreen');
       await checkPlayFrame(page,game,false);
       await page.getByRole('button',{name:'Play again',exact:true}).click();
       await page.locator('#gameLaunch').click();
       await page.getByRole('button',{name:'Choose another game'}).click();
       assert(await page.locator('#gameClose').isVisible());
      }
      assert.deepEqual(errors,[]);
     }finally{await page.close();}
    }
    console.log('Passed '+game+' stable vocabulary/Knowledge/long layout at '+viewport.width);
   }
  }
  for(const game of Object.keys(selectors)){
   const {page,errors}=await open(browser,{width:568,height:320},games.makeClassGames('Landscape',cards('vocabulary')),{denyFullscreen:true});
   try{
    await launch(page,game);
    await checkPlayFrame(page,game,false);
    await page.getByRole('button',{name:'Full screen',exact:true}).tap();
    await page.getByRole('button',{name:'Exit',exact:true}).waitFor();
    await checkPlayFrame(page,game,true);
    await page.setViewportSize({width:320,height:568});
    await checkPlayFrame(page,game,true);
    await page.getByRole('button',{name:'Exit',exact:true}).tap();
    await checkPlayFrame(page,game,false);
    assert.deepEqual(errors,[]);
   }finally{await page.close();}
  }
  // Exercise actual Quick Quiz advancement, not just initial mounts.
  const mixed=[...cards('vocabulary'),...cards('long')],{page,errors}=await open(browser,{width:390,height:844},games.makeClassGames('Mixed run',mixed,{homeUrl:'/class'}));
  try{
   await launch(page,'quiz');
   const before=await geometry(page,'quiz');assert.equal(before.scroll,0,'the quiz starts in view');
   for(let i=0;i<4;i++){
    const old=await page.locator('#gameBoard>h3').innerText();
    await page.locator('.game-options').getByRole('button',{name:/^Correct(?: |$)/}).click();
    await page.waitForFunction(old=>document.querySelector('#gameBoard>h3').innerText!==old,old,{polling:50});
    assert.deepEqual(await geometry(page,'quiz'),before,'advancing a mixed quiz keeps answer positions');
   }
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
