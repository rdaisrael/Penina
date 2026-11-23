const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const core=require('../PeninaPlus-Binyan-Builder/core');
const reader=require('../PeninaPlus-Reader/reader-core');
const repo=path.resolve(__dirname,'..');
const output=fs.mkdtempSync('/private/tmp/binyan-builder-');
function fixture(req){
 const eligible=core.eligibleRoots(req),root=pair=>eligible[pair][0],ref=pair=>core.catalogue.reference(root(pair),pair,req.patternMode);
 const answer=(pair,person)=>ref(pair).forms[person][0];
 return {lessons:req.mode==='learn'?req.pairs.map(pair=>({pair,root:root(pair),meaning:ref(pair).meaning,explanation:'Notice how the ending changes with the person or form.',forms:core.persons(pair).map(person=>({person,answer:answer(pair,person)}))})):[],questions:core.plan(req).map(q=>({...q,root:root(q.pair),meaning:ref(q.pair).meaning,answer:answer(q.pair,q.person),sentence:['sentence','writing'].includes(q.exercise)?`${core.subject(q.person)} ___ בַּמַּחְבֶּרֶת.`:'',alternative:q.exercise==='choice'?core.alternativeAnswers({...q,root:root(q.pair)},req.patternMode).find(form=>core.normalize(form)!==core.normalize(answer(q.pair,q.person))):''}))};
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let fail=false,delay=0,lastRequest=null,httpFailure=null;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='binyan.test')return route.abort();
  if(url.pathname==='/api/generate'){
   const req=core.validateRequest(route.request().postDataJSON());lastRequest=req;
   if(delay)await new Promise(r=>setTimeout(r,delay));
   if(httpFailure)return route.fulfill(httpFailure);
   const data=fixture(req);
   for(const q of data.questions){q.words=reader.words(q.sentence).map(([word])=>({word,mastered:true,translation:reader.normalizeWord(word)==='במחברת'?'in the notebook':'subject',match:reader.normalizeWord(word)==='במחברת'?'מחברת':'__pronoun__',form:'',prefix:reader.normalizeWord(word)==='במחברת'?'ב':'',isName:false}));q.phrases=[];}
   return route.fulfill({status:fail?502:200,contentType:'application/json',body:JSON.stringify(fail?{error:'Test service unavailable'}:data)}).catch(()=>{});
  }
  const file=path.join(repo,decodeURIComponent(url.pathname),url.pathname.endsWith('/')?'index.html':'');
  try{await route.fulfill({path:file});}catch{await route.abort();}
 });
 await page.goto('http://binyan.test/PeninaPlus-Binyan-Builder/');
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#generate').isDisabled(),true);
 for(const id of ['binyan','group','tense'])assert.equal(await page.locator('#'+id).isEnabled(),true,`Learn ${id} works before upload`);
 assert.deepEqual(await page.locator('#binyan option').evaluateAll(options=>options.map(o=>o.value)),core.binyanim);
 for(const binyan of core.binyanim){
  await page.locator('#binyan').selectOption(binyan);
  assert.equal(await page.locator('#group').inputValue(),`${binyan} — כל הגזרות`);
  assert.equal(await page.locator('#tense option').count(),['פועל','הופעל'].includes(binyan)?3:6);
 }
 await page.locator('#binyan').selectOption('פיעל');
 await page.locator('#group').selectOption('פיעל ל-ה');
 await page.locator('#tense').selectOption('הווה');
 assert.equal(await page.locator('#generate').isDisabled(),true,'choosing patterns alone cannot build without vocabulary');
 await page.locator('input[value=practice]').check();
 for(const id of ['binyan','group','tense'])assert.equal(await page.locator('#'+id).isDisabled(),true,`Practice ${id} waits for marked squares`);
 await page.locator('input[value=learn]').check();
 assert.equal(await page.locator('#binyan option').count(),7,'switching back to Learn restores its options without upload');
 await page.locator('#binyan').selectOption('פיעל');
 await page.locator('#group').selectOption('פיעל ל-ה');
 await page.locator('#tense').selectOption('הווה');
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.locator('#sample').click();
 await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('6 roots'));
 assert.equal(await page.locator('#generate').isDisabled(),true,'upload cannot enable a combination with no verified roots');
 assert.match(await page.locator('#generation-status').innerText(),/No suitable roots verified/);
 assert.equal(await page.locator('#binyan').inputValue(),'פיעל','upload preserves the binyan chosen beforehand');
 assert.equal(await page.locator('#group').inputValue(),'פיעל ל-ה','upload preserves the chosen root type');
 assert.equal(await page.locator('#tense').inputValue(),'הווה','upload preserves the chosen tense');
 await page.locator('#binyan').selectOption('פעל');await page.locator('#tense').selectOption('עבר');
 assert.equal(await page.locator('#group').inputValue(),'פעל — כל הגזרות','a new binyan defaults to all root types');
 assert.equal(await page.locator('#binyan option').count(),7);
 assert.equal(await page.locator('#group option').count(),6);
 assert.equal(await page.locator('#tense option').count(),6);
 assert.equal(await page.locator('#add-pair').isVisible(),false,'single-pattern needs no Add action');
 await page.locator('#group').selectOption('פעל שלם');
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
 assert.equal(await page.locator('#student-sheet .exercise-section').evaluateAll(sections=>new Set(sections.map(section=>section.dataset.section)).size),4);
 assert.equal(await page.locator('#student-sheet .choice-options').count()>0,true);
 assert.equal(await page.locator('#student-sheet .word-bank').count(),0);
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
 fail=false;
 for(const [status,message] of [[422,'Could not verify Piel. No unverified worksheet was created.'],[503,'Dicta did not return grammatical analysis. Please try again.']]){
  httpFailure={status,contentType:'application/json',body:JSON.stringify({error:message})};
  await page.locator('#generate').click();
  await page.waitForFunction(message=>document.getElementById('generation-status').textContent===message,message);
  assert.equal(await page.locator('#student-sheet').innerHTML(),before,'specific validation/service failures preserve the previous worksheet');
  assert.equal(await page.locator('#generate').isEnabled(),true);
 }
 for(const [status,message] of [[502,'gateway error (HTTP 502)'],[504,'timed out on the server (HTTP 504)'],[200,'unreadable response (HTTP 200)']]){
  httpFailure={status,contentType:'text/html',body:'<!doctype html><title>Gateway response</title><p>Upstream response</p>'};
  await page.locator('#generate').click();
  await page.waitForFunction(message=>document.getElementById('generation-status').textContent.includes(message),message);
  assert.equal(await page.locator('#student-sheet').innerHTML(),before,'non-JSON failures preserve the previous worksheet');
  assert.equal(await page.locator('#generate').isEnabled(),true,'failed request can be retried');
 }
 httpFailure=null;
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
 assert.equal(await page.locator('#group').inputValue(),'פעל — כל הגזרות');
 assert.doesNotMatch(await page.locator('#generation-status').innerText(),/Practice needs X marks/,'old disabled reason cleared');
 assert.deepEqual(await page.locator('#binyan option').evaluateAll(options=>options.map(o=>o.value)),core.binyanim);
 for(const binyan of core.binyanim){
  await page.locator('#binyan').selectOption(binyan);
  assert.equal(await page.locator('#group').inputValue(),`${binyan} — כל הגזרות`);
  assert.equal(await page.locator('#tense option').count(),['פועל','הופעל'].includes(binyan)?3:6);
  const selected=`${binyan} — כל הגזרות|${await page.locator('#tense').inputValue()}`;
  const available=core.eligibleRoots(core.validateRequest({mode:'learn',pairs:[selected],count:12,exercises:Object.keys(core.exerciseTypes),vocabulary:{verbs:['אכל','שתה','הלך'],binyanim:[]}}))[selected];
  assert.equal(await page.locator('#generate').isEnabled(),available.length>0,`${binyan} needs a dictionary-backed uploaded root`);
  assert.ok((await page.locator('#binyan option:checked').innerText()).includes(binyan),'label names selected binyan');
 }
 await page.locator('#binyan').selectOption('פעל');await page.locator('#group').selectOption('פעל שלם');
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
 // Current Reader multi-sheet vocabulary reaches generation and controls notes.
 const current=new ExcelJS.Workbook(),verbs=current.addWorksheet('Verbs');
 verbs.addRow(['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי']);
 verbs.addRow(['כתב','פעל שלם','X','X']);
 const supporting={Nouns:['מחברת','nouns'],Adjectives:['גדול','adjs'],Prepositions:['על','preps'],Adverbs:['היום','adverbs'],Conjunctions:['אבל','conjunctions'],'Question Words':['מתי','questionWords'],'Phrases & Expressions':['בית ספר','expressions']};
 for(const [name,[term]] of Object.entries(supporting)){const sheet=current.addWorksheet(name);sheet.addRow(['Known words']);sheet.addRow([term]);}
 const uploadCurrent=async()=>{
  await page.locator('#vocabulary').setInputFiles({name:'Reader-vocabulary.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await current.xlsx.writeBuffer())});
  await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('1 roots'));
  await page.locator('#group').selectOption('פעל שלם');await page.locator('#tense').selectOption('הווה');
  await page.locator('#count').selectOption('30');
  await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('preview-label').textContent==='Ready to review');
 };
 await uploadCurrent();
 for(const [term,key] of Object.values(supporting))assert.ok(lastRequest.vocabulary[key].includes(term),key);
 assert.equal(await page.locator('#student-sheet .vocabulary-marker').count(),0,'familiar notebook needs no note');
 current.getWorksheet('Nouns').getCell('A2').value='ספר';await uploadCurrent();
 assert.equal(await page.locator('#student-sheet .question').count(),30);
 assert.ok(await page.locator('#student-sheet .worksheet-page').count()>1,'long worksheet paginated');
 assert.equal(await page.locator('#student-sheet .vocabulary-marker').count(),30);
 const checkPages=async()=>assert.deepEqual(await page.locator('#student-sheet .worksheet-page').evaluateAll(pages=>pages.flatMap((page,i)=>{
  const problems=[];
  if(page.scrollHeight>page.clientHeight+1)problems.push(`page ${i+1} overflow`);
  const markers=[...page.querySelectorAll('.vocabulary-marker')].map(n=>n.dataset.noteId);
  const notes=[...page.querySelectorAll('.page-notes .vocabulary-note')].map(n=>n.dataset.noteId);
  if(markers.some(id=>!notes.includes(id))||notes.some(id=>!markers.includes(id)))problems.push(`page ${i+1} notes mismatch`);
  return problems;
 })),[]);
 await checkPages();
 await page.locator('#print-target').selectOption('student');await page.emulateMedia({media:'print'});await checkPages();
 await page.pdf({path:path.join(output,'page-notes.pdf'),preferCSSPageSize:true});
 await page.emulateMedia({media:'screen'});
 await page.locator('#student-sheet').screenshot({path:path.join(output,'page-notes.png')});
 await page.locator('#footnotes').selectOption('end');
 assert.equal(await page.locator('#student-sheet .page-notes .vocabulary-note').count(),0);
 assert.equal(await page.locator('#student-sheet .vocabulary-note').count(),1,'end glossary deduplicated');
 assert.ok(await page.locator('#student-sheet .worksheet-page:last-child .vocabulary-note').count()>0);
 await page.locator('#footnotes').selectOption('none');
 assert.equal(await page.locator('#student-sheet .vocabulary-marker').count(),0);
 await page.locator('#footnotes').selectOption('page');await checkPages();
 await page.locator('#font').selectOption('Arial');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sentence-line')).fontFamily.includes('Arial'));
 await checkPages();
 await page.setViewportSize({width:390,height:844});
 // Resize events scale the print-sized pages on the next browser frame.
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'paginated mobile preview fits');
 await page.locator('#student-sheet').screenshot({path:path.join(output,'mobile-notes.png')});
 // Marked squares, not the cross-product of learned binyanim and tenses.
 const marked=new ExcelJS.Workbook(),markedVerbs=marked.addWorksheet('Verbs');
 markedVerbs.addRow(['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי']);
 markedVerbs.addRow(['כתב','פעל שלם','X']);
 markedVerbs.addRow(['למד','פיעל שלם','','X']);
 markedVerbs.addRow(['קום','הפעיל ע"ו','','','X']);
 await page.locator('#vocabulary').setInputFiles({name:'marked-squares.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await marked.xlsx.writeBuffer())});
 await page.waitForFunction(()=>document.getElementById('upload-status').textContent.startsWith('marked-squares.xlsx:'));
 await page.locator('input[value=practice]').check();
 assert.deepEqual(await page.locator('#binyan option').evaluateAll(options=>options.map(o=>o.value)),['פעל','פיעל','הפעיל']);
 for(const [binyan,group,tense] of [['פעל','פעל שלם','עבר'],['פיעל','פיעל שלם','הווה'],['הפעיל','הפעיל ע"ו','עתיד']]){
  await page.locator('#binyan').selectOption(binyan);
  assert.deepEqual(await page.locator('#group option').evaluateAll(options=>options.map(o=>o.value)),[group]);
  assert.deepEqual(await page.locator('#tense option').evaluateAll(options=>options.map(o=>o.value)),[tense]);
 }
 await page.locator('input[value=learn]').check();
 await page.locator('#binyan').selectOption('נפעל');
 assert.equal(await page.locator('#generate').isEnabled(),true,'unmarked binyan is available in Learn');
 await page.locator('#mix-patterns').check();
 assert.equal(await page.locator('.pair-chip').count(),1);
 await page.locator('input[value=practice]').check();
 assert.equal(await page.locator('.pair-chip').count(),0,'switching to Practice discards unmarked Learn selections');
 assert.equal(await page.locator('#generate').isDisabled(),true);
 await page.locator('#mix-patterns').uncheck();
 assert.equal(await page.locator('#generate').isEnabled(),true,'Practice uses the visible marked square');
 // Standard, exceptional and unverified combinations remain distinct in the UI
 // and in the request, including after Learn/Practice switching.
 const catalogueBook=new ExcelJS.Workbook(),catalogueSheet=catalogueBook.addWorksheet('Verbs');
 catalogueSheet.addRow(['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי']);
 catalogueSheet.addRow(['למד','פיעל שלם','','X']);
 catalogueSheet.addRow(['לבש','פעל שלם','','','','','X']);
 catalogueSheet.addRow(['ברך']);catalogueSheet.addRow(['אבג']);
 await page.locator('#vocabulary').setInputFiles({name:'catalogue.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await catalogueBook.xlsx.writeBuffer())});
 await page.waitForFunction(()=>document.getElementById('upload-status').textContent.startsWith('catalogue.xlsx:'));
 await page.locator('input[value=learn]').check();
 await page.locator('#binyan').selectOption('פיעל');await page.locator('#group').selectOption('פיעל שלם');await page.locator('#tense').selectOption('הווה');
 for(const checkbox of await page.locator('input[name=exercise]').all())await checkbox.uncheck();
 await page.locator('input[name=exercise][value=conjugate]').check();await page.locator('#count').selectOption('6');
 await page.locator('#reference-details summary').click();
 const rootLists=await page.locator('#reference-roots').innerText();
 assert.match(rootLists,/Standard: למד/);assert.match(rootLists,/Exceptions: ברך/);
 assert.match(rootLists,/Not verified for this combination: לבש · אבג/);
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('preview-label').textContent==='Ready to review');
 assert.equal(lastRequest.patternMode,'standard');assert.match(await page.locator('#student-sheet .worksheet-heading').innerText(),/Standard pattern/);
 assert.match(await page.locator('#student-sheet .lesson').innerText(),/למד/);
 for(const sheet of ['student-sheet','answer-sheet'])assert.match(await page.locator(`#${sheet} .reference-sources`).innerText(),/CC BY-SA 4.0/);
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(output,'standard-reference.png'),fullPage:true});
 await page.locator('#pattern-mode').selectOption('exception');
 assert.match(await page.locator('#preview-label').innerText(),/Previous/);
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('preview-label').textContent==='Ready to review');
 assert.equal(lastRequest.patternMode,'exception');assert.match(await page.locator('#student-sheet .worksheet-heading').innerText(),/Exceptions/);
 assert.match(await page.locator('#student-sheet .lesson').innerText(),/ברכ/);
 assert.match(await page.locator('#student-sheet .pattern-note').innerText(),/differ/);
 await page.screenshot({path:path.join(output,'exceptions-reference.png'),fullPage:true});
 await page.locator('input[value=practice]').check();
 await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelectorAll('#student-sheet .lesson').length===0);
 assert.equal(lastRequest.patternMode,'exception');assert.equal(lastRequest.mode,'practice');
 await page.locator('input[value=learn]').check();await page.locator('#pattern-mode').selectOption('standard');
 await page.locator('#binyan').selectOption('פעל');await page.locator('#group').selectOption('פעל שלם');await page.locator('#tense').selectOption('שם פעולה');
 await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('preview-label').textContent==='Ready to review');
 assert.deepEqual(lastRequest.pairs,['פעל שלם|שם פעולה']);
 assert.match(await page.locator('#student-sheet').innerText(),/Verbal noun/);assert.doesNotMatch(await page.locator('#student-sheet').innerText(),/Infinitive/);
 await page.screenshot({path:path.join(output,'verbal-nouns.png'),fullPage:true});
 await page.locator('#vocabulary').setInputFiles({name:'bad.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('bad')});
 await page.waitForFunction(()=>document.getElementById('upload-status').classList.contains('error'));
 assert.equal(await page.locator('#generate').isDisabled(),true,'invalid upload clears vocabulary');
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile horizontal overflow');
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed:',output);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
