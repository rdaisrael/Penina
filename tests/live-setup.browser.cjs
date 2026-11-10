const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1024,height:768}}),requests=[],errors=[];
  const clothing='vocabulary-cards/sixth/clothing--'+Buffer.from("EJ's Clothing").toString('base64url')+'.html';
  const first='vocabulary-cards/sixth/first.html';
  const sets=[{pathname:first,title:'First list',hasGames:true},{pathname:clothing,title:"EJ's Clothing",hasGames:false}].map(set=>({...set,url:'#',publishedAt:'2026-11-01T12:00:00Z'}));
  const missingChoices='“EJ\'s Clothing” has no teacher-approved answer choices in English. Choose another answer language, or approve choices for this wordlist and publish it again.';
  page.on('pageerror',error=>errors.push(error.message));
  // Exercise the actual library UI with local files and synthetic API responses.
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='live.test')return route.abort();
   if(url.pathname==='/api/flashcard-sets')return route.fulfill({json:{sets,page:{name:'Local class'},excludedWordlists:[clothing],wordlistEmphasis:{[first]:1,[clothing]:2},authenticated:true}});
   if(url.pathname==='/api/game-scores'){
    const body=route.request().postDataJSON();requests.push(body);
    return route.fulfill({status:body.language==='english'?400:201,json:body.language==='english'?{error:missingChoices}:{code:'123456',hostToken:'local-test'}});
   }
   if(url.pathname.endsWith('/live/'))return route.fulfill({contentType:'text/html',body:'<h1>Local test lobby</h1>'});
   const file=path.join(root,url.pathname,url.pathname.endsWith('/')?'index.html':'');
   return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
  });
  await page.goto('http://live.test/PeninaPlus-vocab-builder/flash-cards/?page=sixth');
  await page.getByRole('button',{name:'Open teacher tools',exact:true}).click();
  const live=page.locator('.teacher-tool-section').filter({has:page.locator('#teacher-live-heading')});
  await live.getByRole('checkbox',{name:"EJ's Clothing",exact:true}).check();
  await live.getByRole('button',{name:'Start Live Game',exact:true}).click();
  const setup=page.locator('.live-setup');
  assert.deepEqual(await setup.locator('.live-wordlist-title').allTextContents(),['First list',"EJ's Clothing"]);
  await setup.getByRole('combobox',{name:'Emphasis for First list',exact:true}).selectOption('3');
  await setup.getByRole('button',{name:'Open lobby →',exact:true}).click();
  await page.waitForFunction(message=>document.querySelector('.live-setup-error')?.textContent===message,missingChoices);
  assert.deepEqual(requests[0].pathnames,[first,clothing]);assert.deepEqual(requests[0].wordlistEmphasis,{[first]:3,[clothing]:2});
  assert.equal(await setup.isVisible(),true);
  assert.equal(await setup.getByRole('button',{name:'Open lobby →',exact:true}).isEnabled(),true);
  assert.deepEqual(await setup.locator('.live-wordlist-title').allTextContents(),['First list',"EJ's Clothing"]);
  await setup.getByRole('combobox',{name:'Answer language',exact:true}).selectOption('hebrew');
  await setup.getByRole('button',{name:'Open lobby →',exact:true}).click();
  await page.waitForURL('**/live/?host=1&code=123456');
  assert.deepEqual(requests[1].pathnames,[first,clothing]);assert.deepEqual(requests[1].wordlistEmphasis,{[first]:3,[clothing]:2});
  assert.equal(requests[1].language,'hebrew');
  assert.deepEqual(errors,[]);
  console.log('Passed: checked EJ\'s Clothing stays in setup, errors name it, and retry preserves both lists.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
