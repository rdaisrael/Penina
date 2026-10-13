const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ExcelJS=require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');
const path=require('node:path');
const assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
async function fixture(name,rows){
 const wb=new ExcelJS.Workbook();wb.addWorksheet(name).addRows(rows);
 return {name:`${name}.xlsx`,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await wb.xlsx.writeBuffer())};
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='reader.test')return route.abort();
   try{await route.fulfill({path:path.join(repo,decodeURIComponent(url.pathname))});}catch{await route.abort();}
  });
  await page.goto('http://reader.test/PeninaPlus-Reader/index.html');
  const nouns=await fixture('Nouns',[['Clothing','Animals'],['חולצה','כלב'],[null,'חתול']]);
  const adjs=await fixture('Adjectives',[['שם תואר'],['גדול']]);
  await page.locator('#vocab-file-a').setInputFiles([nouns,adjs]);
  await page.waitForFunction(()=>document.getElementById('vocab-upload-status-a').textContent.includes('3 nouns'));
  assert.equal(await page.locator('#noun-categories-a input:checked').count(),2);
  await page.locator('#noun-categories-a input[value="Clothing"]').uncheck();
  assert.deepEqual(await page.evaluate(()=>uploadedVocabA.nouns),['כלב','חתול']);
  assert.deepEqual(await page.evaluate(()=>uploadedVocabA.adjs),['גדול']);
  await page.locator('#noun-categories-a summary').last().click();
  assert.ok((await page.locator('#noun-categories-a').innerText()).includes('כלב · חתול'));
  await page.locator('#noun-categories-a').screenshot({path:'/private/tmp/penina-workbook-template/category-controls.png'});
  await page.locator('#pathway-b-radio').check();
  await page.locator('#vocab-file-b').setInputFiles(nouns);
  await page.waitForFunction(()=>document.getElementById('vocab-upload-status-b').textContent.includes('3 nouns'));
  await page.locator('#noun-categories-b input[value="Animals"]').uncheck();
  assert.deepEqual(await page.evaluate(()=>uploadedVocabB.nouns),['חולצה']);
  assert.deepEqual(await page.evaluate(()=>uploadedVocabA.nouns),['כלב','חתול']);
  await page.locator('#vocab-file-b').setInputFiles(path.join(repo,'PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
  await page.waitForFunction(()=>document.getElementById('vocab-upload-status-b').textContent.includes('14 nouns'));
  assert.equal(await page.locator('#noun-categories-b input').count(),1);
  assert.deepEqual(await page.locator('#noun-categories-b input').evaluateAll(inputs=>inputs.map(x=>x.value)),['General']);
  await page.locator('#vocab-file-b').setInputFiles({name:'broken.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
  await page.waitForFunction(()=>document.getElementById('vocab-upload-status-b').textContent.includes('could not be opened'));
  assert.equal(await page.evaluate(()=>uploadedVocabB),null);
  assert.equal(await page.locator('#noun-categories-b').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: batch uploads, category selection, previews, independent pathways, legacy replacement and error clearing.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
