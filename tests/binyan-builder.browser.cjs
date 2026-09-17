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
function fixture(req){return {lessons:req.mode==='learn'?req.pairs.map(pair=>({pair,root:'כתב',meaning:'write',explanation:'Start with the root כתב. Notice how the ending changes with the person or form.',forms:core.persons(pair).map(person=>({person,answer:answer(pair,person)}))})):[],questions:core.plan(req).map(q=>({...q,root:'כתב',meaning:'write',hint:'Use the model and check the ending.',answer:answer(q.pair,q.person),sentence:['sentence','bank','writing'].includes(q.exercise)?`${core.subject(q.person)} ___ בַּמַּחְבֶּרֶת.`:'',alternative:q.exercise==='choice'?answer(core.alternativeTarget(q).pair,core.alternativeTarget(q).person):''}))};}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let fail=false,delay=0,lastRequest=null;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='binyan.test')return route.abort();
  if(url.pathname==='/api/generate'){
   const req=core.validateRequest(route.request().postDataJSON());lastRequest=req;
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
 assert.equal(await page.locator('#generate').isEnabled(),true,'upload immediately enables single-pattern build');
 assert.equal(await page.locator('#group').inputValue(),'פעל שלם','default is the supported regular Paal group');
 assert.equal(await page.locator('#binyan option').count(),1);
 assert.equal(await page.locator('#group option').count(),2);
 assert.equal(await page.locator('#tense option').count(),5);
 assert.equal(await page.locator('#add-pair').isVisible(),false,'single-pattern needs no Add action');
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('generation-status').textContent.startsWith('Worksheet ready.'));
 assert.deepEqual(lastRequest.pairs,['פעל שלם|עבר']);
 await page.locator('#tense').selectOption('הווה');
 assert.match(await page.locator('#preview-label').innerText(),/Previous/);
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('preview-label').textContent==='Ready to review');
 assert.deepEqual(lastRequest.pairs,['פעל שלם|הווה'],'dropdown change directly updates generated selection');
 await page.locator('#group').selectOption('פעל שלם');await page.locator('#tense').selectOption('עבר');await page.locator('#mix-patterns').check();
 assert.equal(await page.locator('.pair-chip').count(),1,'mixing retains the current selection');
 await page.locator('#tense').selectOption('הווה');await page.locator('#add-pair').click();
 assert.equal(await page.locator('.pair-chip').count(),2);
 await page.locator('#title').fill('Paal practice — mixed exercises');
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('generation-status').textContent.startsWith('Worksheet ready.'));
 assert.equal(await page.locator('#student-sheet .question').count(),12);
 assert.equal(await page.locator('#student-sheet .lesson').count(),2);
 assert.equal(await page.locator('#student-sheet img').count(),0,'title escaped');
 assert.equal(await page.locator('#student-sheet .exercise-section').count(),5);
 assert.equal(await page.locator('#student-sheet .choice-options').count()>0,true);
 assert.equal(await page.locator('#student-sheet .word-bank').count(),1);
 assert.equal(await page.locator('#student-sheet .writing-lines').count()>0,true);
 assert.equal(await page.locator('#student-sheet .sample-label').count(),0);
 assert.equal(await page.locator('#answer-sheet .sample-label').count()>0,true);
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
 // Construct the reported workbook shape: three roots and no X-marked categories.
 const ExcelJS=require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Vocabulary');
 sheet.addRow(['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי','','שם עצם','','שם תואר']);
 ['אכל','שתה','הלך'].forEach(root=>sheet.addRow([root]));
 await page.locator('#vocabulary').setInputFiles({name:'roots-only.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
 await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('3 roots'));
 assert.equal(await page.locator('#generate').isDisabled(),true,'practice still requires learned marks');
 assert.match(await page.locator('#generation-status').innerText(),/Practice needs X marks/);
 await page.locator('input[value=learn]').check();await page.locator('#mix-patterns').uncheck();
 assert.equal(await page.locator('#generate').isEnabled(),true,'roots-only workbook works in Learn without X marks');
 assert.equal(await page.locator('#group').inputValue(),'פעל שלם');
 assert.doesNotMatch(await page.locator('#generation-status').innerText(),/Practice needs X marks/,'old disabled reason cleared');
 await page.locator('#mix-patterns').check();
 await page.locator('#count').selectOption('6');
 for(const tense of ['הווה','עתיד','שם הפועל','ציווי']){await page.locator('#tense').selectOption(tense);await page.locator('#add-pair').click();}
 await page.locator('#group').selectOption('פעל ל-ה');await page.locator('#add-pair').click();await page.locator('#tense').selectOption('עבר');await page.locator('#add-pair').click();
 assert.equal(await page.locator('#generate').isDisabled(),true,'seven combinations cannot fit six questions');
 assert.match(await page.locator('#generation-status').innerText(),/at least one per selected combination/);
 await page.locator('#mix-patterns').uncheck();
 assert.equal(await page.locator('#generate').isEnabled(),true,'single selection ignores previously mixed list');
 for(const checkbox of await page.locator('input[name=exercise]').all())await checkbox.uncheck();
 assert.equal(await page.locator('#generate').isDisabled(),true);
 assert.match(await page.locator('#generation-status').innerText(),/exercise type/);
 await page.locator('input[name=exercise][value=sentence]').check();
 assert.equal(await page.locator('#generate').isEnabled(),true);
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
