const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const core=require('../PeninaPlus-Binyan-Builder/core');
const repo=path.resolve(__dirname,'..');
const output=fs.mkdtempSync('/private/tmp/binyan-builder-');
const past=['כָּתַבְתִּי','כָּתַבְתָּ','כָּתַבְתְּ','כָּתַב','כָּתְבָה','כָּתַבְנוּ','כְּתַבְתֶּם','כְּתַבְתֶּן','כָּתְבוּ','כָּתְבוּ'];
const present=['כּוֹתֵב','כּוֹתֶבֶת','כּוֹתְבִים','כּוֹתְבוֹת'];
function answer(pair,person){return (pair.endsWith('הווה')?present:past)[core.persons(pair).indexOf(person)];}
function fixture(req){return {lessons:req.mode==='learn'?req.pairs.map(pair=>({pair,root:'כתב',meaning:'write',explanation:'Start with the root כתב. Notice how the ending changes with the person or form.',forms:core.persons(pair).map(person=>({person,answer:answer(pair,person)}))})):[],questions:core.plan(req).map(q=>({...q,root:'כתב',meaning:'write',hint:'Use the model and check the ending.',answer:answer(q.pair,q.person)}))};}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let fail=false,delay=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='binyan.test')return route.abort();
  if(url.pathname==='/api/binyan-worksheet'){
   const req=core.validateRequest(route.request().postDataJSON());
   if(delay)await new Promise(r=>setTimeout(r,delay));
   return route.fulfill({status:fail?502:200,contentType:'application/json',body:JSON.stringify(fail?{error:'Test service unavailable'}:fixture(req))}).catch(()=>{});
  }
  const file=path.join(repo,decodeURIComponent(url.pathname),url.pathname.endsWith('/')?'index.html':'');
  try{await route.fulfill({path:file});}catch{await route.abort();}
 });
 await page.goto('http://binyan.test/PeninaPlus-Binyan-Builder/');
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#generate').isDisabled(),true);
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.locator('#sample').click();
 await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('6 roots'));
 await page.locator('#group').selectOption('פעל שלם');await page.locator('#tense').selectOption('עבר');await page.locator('#add-pair').click();
 await page.locator('#tense').selectOption('הווה');await page.locator('#add-pair').click();
 assert.equal(await page.locator('.pair-chip').count(),2);
 await page.locator('#title').fill('My <img src=x> worksheet');
 await page.locator('#generate').click();await page.waitForSelector('#student-sheet .question');
 assert.equal(await page.locator('#student-sheet .question').count(),12);
 assert.equal(await page.locator('#student-sheet .lesson').count(),2);
 assert.equal(await page.locator('#student-sheet img').count(),0,'title escaped');
 assert.equal(await page.locator('#answer-sheet').isVisible(),false);
 await page.locator('#show-key').check();assert.equal(await page.locator('#answer-sheet').isVisible(),true);
 await page.screenshot({path:path.join(output,'worksheet.png'),fullPage:true});
 await page.locator('#print-target').selectOption('student');await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('#answer-sheet').isVisible(),false,'student print excludes answers even if key visible');
 await page.pdf({path:path.join(output,'student.pdf'),preferCSSPageSize:true});
 await page.emulateMedia({media:'screen'});await page.locator('#print-target').selectOption('key');await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('#student-sheet').isVisible(),false);assert.equal(await page.locator('#answer-sheet').isVisible(),true);
 await page.emulateMedia({media:'screen'});
 await page.locator('input[value=practice]').check();
 await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelectorAll('#student-sheet .lesson').length===0);
 assert.equal(await page.locator('#student-sheet .hint').count(),0);
 assert.equal(await page.locator('#group option[value="פועל שלם"]').count(),0);
 const before=await page.locator('#student-sheet').innerHTML();
 fail=true;await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('generation-status').textContent==='Test service unavailable');
 assert.equal(await page.locator('#student-sheet').innerHTML(),before,'failed request preserves result');
 fail=false;delay=500;await page.locator('#generate').click();await page.locator('#title').fill('Changed while loading');
 await page.waitForTimeout(700);assert.equal(await page.locator('#student-sheet').innerHTML(),before,'late response ignored');delay=0;
 await page.locator('#vocabulary').setInputFiles({name:'bad.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('bad')});
 await page.waitForFunction(()=>document.getElementById('upload-status').classList.contains('error'));
 assert.equal(await page.locator('#generate').isDisabled(),true,'invalid upload clears vocabulary');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile horizontal overflow');
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed:',output);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
