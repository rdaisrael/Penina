const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

async function checkSetup(browser,viewport){
 const page=await browser.newPage({viewport}),requests=[],errors=[];
 try{
  const clothing='vocabulary-cards/sixth/clothing--'+Buffer.from("EJ's Clothing").toString('base64url')+'.html';
  const first='vocabulary-cards/sixth/first.html',knowledge='knowledge-cards/sixth/plants.json';
  const sets=[{pathname:first,title:'First list',hasGames:true},{pathname:clothing,title:"EJ's Clothing",hasGames:false}].map(set=>({...set,url:'#',publishedAt:'2026-11-01T12:00:00Z'}));
  const knowledgeSets=[{pathname:knowledge,title:'Plant knowledge',kind:'knowledge',hasPractice:true,hasGames:true,url:'#',publishedAt:'2026-11-01T12:00:00Z'}];
  const missingChoices='“EJ\'s Clothing” has no teacher-approved answer choices in English. Choose another answer language, or approve choices for this wordlist and publish it again.';
  page.on('pageerror',error=>errors.push(error.message));
  // Exercise the actual library UI with local files and synthetic API responses.
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='live.test')return route.abort();
   if(url.pathname==='/api/flashcard-sets'){
    if(url.searchParams.get('kind')==='knowledge')return route.fulfill({json:{sets:knowledgeSets}});
    if(route.request().method()==='POST')assert.equal(route.request().postDataJSON().action,'authenticate','Live priorities need no separate save');
    return route.fulfill({json:{sets,knowledgeSets,page:{name:'Local class'},excludedWordlists:[clothing],wordlistEmphasis:{[first]:1,[clothing]:2,[knowledge]:1},authenticated:true}});
   }
   if(url.pathname==='/api/game-scores'){
    const body=route.request().postDataJSON();requests.push(body);
    return route.fulfill({status:body.language==='english'?400:201,json:body.language==='english'?{error:missingChoices}:{code:'123456',hostToken:'local-test'}});
   }
   if(url.pathname.endsWith('/live/'))return route.fulfill({contentType:'text/html',body:'<h1>Local test lobby</h1>'});
   const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
   return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
  });
  await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/?page=sixth');
  await page.locator('.knowledge-library .set').waitFor();
  await page.getByRole('button',{name:'Open teacher tools',exact:true}).click();
  const live=page.locator('.teacher-tool-section').filter({has:page.locator('#teacher-live-heading')});
  const priority=title=>live.getByRole('combobox',{name:'Priority for '+title,exact:true});
  const firstBox=live.getByRole('checkbox',{name:'First list',exact:true});
  const clothingBox=live.getByRole('checkbox',{name:"EJ's Clothing",exact:true});
  assert.equal(await priority('First list').inputValue(),'1');
  assert.equal(await priority("EJ's Clothing").inputValue(),'2');
  assert.equal(await priority("EJ's Clothing").isDisabled(),true);
  await priority('First list').selectOption('3');
  await priority('Plant knowledge · Knowledge').selectOption('2');
  await clothingBox.check();
  await firstBox.uncheck();
  // A knowledge-library refresh must preserve draft choices, including exclusions.
  await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('penina-knowledge-library-loaded',{detail})),knowledgeSets);
  assert.equal(await firstBox.isChecked(),false);
  assert.equal(await priority('First list').isDisabled(),true);
  assert.equal(await priority('First list').inputValue(),'3');
  assert.equal(await clothingBox.isChecked(),true);
  assert.equal(await priority('Plant knowledge · Knowledge').inputValue(),'2');
  await firstBox.check();
  assert.equal(await priority('First list').isEnabled(),true);
  assert.equal(await priority('First list').inputValue(),'3');
  const practice=page.locator('.teacher-tool-section').filter({has:page.locator('#teacher-games-heading')});
  assert.equal(await practice.getByRole('combobox',{name:'Emphasis for First list',exact:true}).inputValue(),'1');
  assert.equal(await practice.getByRole('combobox',{name:'Emphasis for Plant knowledge · Knowledge',exact:true}).inputValue(),'1');
  assert.equal(await live.evaluate(section=>section.scrollWidth<=section.clientWidth),true,'list priorities fit the viewport');
  await priority('First list').scrollIntoViewIfNeeded();
  if(process.env.LIVE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.LIVE_SCREENSHOT_DIR,`penina-live-priority-${viewport.width}.png`)});
  await live.getByRole('button',{name:'Start Live Game',exact:true}).click();
  const setup=page.locator('.live-setup');
  assert.deepEqual(await setup.locator('.live-wordlist-title').allTextContents(),['First list',"EJ's Clothing",'Plant knowledge']);
  assert.deepEqual(await setup.locator('.live-wordlist-priority').allTextContents(),['3× priority','2× priority','2× priority']);
  await setup.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await priority('First list').inputValue(),'3');
  assert.equal(await priority('Plant knowledge · Knowledge').inputValue(),'2');
  await live.getByRole('button',{name:'Start Live Game',exact:true}).click();
  await setup.getByRole('button',{name:'Open lobby →',exact:true}).click();
  await page.waitForFunction(message=>document.querySelector('.live-setup-error')?.textContent===message,missingChoices);
  const expectedPriorities={[first]:3,[clothing]:2,[knowledge]:2};
  assert.deepEqual(requests[0].pathnames,[first,clothing,knowledge]);assert.deepEqual(requests[0].wordlistEmphasis,expectedPriorities);
  assert.equal(await setup.isVisible(),true);
  assert.equal(await setup.getByRole('button',{name:'Open lobby →',exact:true}).isEnabled(),true);
  assert.deepEqual(await setup.locator('.live-wordlist-priority').allTextContents(),['3× priority','2× priority','2× priority']);
  await setup.getByRole('combobox',{name:'Answer language',exact:true}).selectOption('hebrew');
  await setup.getByRole('button',{name:'Open lobby →',exact:true}).click();
  await page.waitForURL('**/live/?host=1&code=123456');
  assert.deepEqual(requests[1].pathnames,[first,clothing,knowledge]);assert.deepEqual(requests[1].wordlistEmphasis,expectedPriorities);
  assert.equal(requests[1].language,'hebrew');
  assert.deepEqual(errors,[]);
  console.log(`Passed upfront Live priorities, cancellation, exclusion, refresh, and retry at ${viewport.width}×${viewport.height}.`);
 }finally{await page.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  for(const viewport of [{width:1024,height:768},{width:390,height:844}])await checkSetup(browser,viewport);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
