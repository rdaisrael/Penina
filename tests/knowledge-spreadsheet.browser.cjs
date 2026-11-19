// Local-only browser validation. External requests are blocked; generation uses explicit fixtures.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const ExcelJS = require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');
const {HEADERS, LEGACY_HEADERS} = require('../PeninaPlus-knowledge-builder/knowledge-spreadsheet');
const root = path.resolve(__dirname, '..'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'penina-spreadsheet-'));
const generation = [], errors = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST' && url.pathname === '/api/flashcard-sets') {
            let text = ''; for await (const chunk of req) text += chunk;
            const body = JSON.parse(text); assert.equal(body.action, 'generate-distractors'); generation.push(body);
            return res.end(JSON.stringify({rows:body.rows.map(row=>({id:row.id,cells:row.slots.map(slot=>({slot,answer:`Generated incorrect answer ${slot + 1}`}))}))}));
        }
        return res.end(JSON.stringify({pages:[], role:'teacher',userId:1}));
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404; return res.end();}
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
});
(async () => {
    let browser;
    try {
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const origin = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context = await browser.newContext({viewport:{width:1250,height:1000}});
        await context.route('**/*', route=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin+'/PeninaPlus-knowledge-builder/');
        await page.waitForFunction(()=>!document.querySelector('.app').inert);
        const downloadPromise = page.waitForEvent('download'); await page.locator('.template-download').click();
        const downloaded = await downloadPromise, template = path.join(output,'template.xlsx'); await downloaded.saveAs(template);
        const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(template));
        assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1), HEADERS);
        await page.locator('#spreadsheet-file').setInputFiles(template);
        await page.waitForFunction(()=>document.querySelector('#spreadsheet-status').textContent.includes('template is empty'));
        assert.equal(await page.locator('#card-count').textContent(), '0');
        const source = await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=50;const ctx=canvas.getContext('2d');ctx.fillStyle='green';ctx.fillRect(0,0,100,50);return canvas.toDataURL('image/png');});
        const sheet = book.worksheets[0];
        sheet.getRow(2).values = ['', 'Capital of France?', 'Paris', 'London', '', '', 'A city.'];
        sheet.getRow(3).values = ['', 'What color?', 'Green', 'Red', 'Blue', 'Gold', 'A picture question.'];
        sheet.getRow(4).values = ['', 'Did they arrive?', 'Yes', '', '', '', ''];
        sheet.getRow(5).values = ['', 'Is this true?', 'אֱמֶת', '', '', '', ''];
        const imageId = book.addImage({base64:source,extension:'png'}); sheet.addImage(imageId,{tl:{col:0,row:2},ext:{width:100,height:50}});
        const filled = {name:'Filled template.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())};
        async function upload(file, confirm) {
            await page.locator('#spreadsheet-file').setInputFiles(file);
            if (confirm) {await page.locator('#confirm-dialog[open]').waitFor(); await page.locator(`#confirm-dialog [value="${confirm}"]`).click();}
            await page.waitForFunction(()=>!document.querySelector('.app').inert);
        }
        await upload(filled);
        assert.match(await page.locator('#spreadsheet-status').textContent(), /Imported 4 cards/);
        assert.equal(await page.locator('#answer').innerText(), 'Paris');
        await page.locator('#card-list button').nth(1).click();
        assert.equal(await page.locator('#target-surface img').getAttribute('src'), source);
        await page.locator('[data-stage="practice"]').click();
        assert.equal(await page.locator('.distractor-choices textarea').count(),8);
        await page.locator('#practice-language').selectOption('mixed');
        await page.locator('#generate-distractors').click();
        await page.waitForFunction(()=>document.querySelector('#practice-status').textContent.startsWith('Distractors generated.'));
        assert.equal(generation.length,1);assert.deepEqual(generation[0].rows[0].slots,[1,2]);
        assert.equal(generation[0].rows[0].answers.length,3);assert.equal(generation[0].rows.length,1);
        assert.equal(await page.locator('.distractor-choices textarea').first().inputValue(),'London');
        assert.equal(await page.locator('#distractor-2-0').inputValue(), 'No');
        assert.equal(await page.locator('#distractor-3-0').inputValue(), 'שֶׁקֶר');
        await page.locator('.distractor-card').nth(2).locator('input[type=checkbox]').check();
        await page.locator('#regenerate-selected').click();
        assert.equal(generation.length, 1);
        assert.equal(await page.locator('#distractor-2-0').inputValue(), 'No');
        await page.locator('#save-answers').click(); await page.locator('#preview-practice').click();
        assert.equal(await page.locator('#quiz-options button').count(),4);
        for (const answer of ['Paris', 'Green']) {
            await page.locator('#quiz-options').getByRole('button', {name:answer,exact:true}).click();
            await page.locator('#quiz-next').click();
        }
        assert.deepEqual((await page.locator('#quiz-options button').allTextContents()).sort(), ['No','Yes']);
        await page.locator('#quiz-options').getByRole('button', {name:'Yes',exact:true}).click();
        await page.locator('#quiz-next').click();
        assert.deepEqual((await page.locator('#quiz-options button').allTextContents()).sort(), ['אֱמֶת','שֶׁקֶר'].sort());
        await page.locator('[data-stage="practice"]').click();
        const binaryCard = page.locator('.distractor-card').nth(2);
        await page.locator('#correct-2').fill('They arrived at night');
        await page.locator('#correct-2').press('Tab');
        assert.equal(await binaryCard.locator('.distractor-choices textarea').count(),3);
        await page.locator('#correct-2').fill('Incorrect');
        await page.locator('#correct-2').press('Tab');
        assert.equal(await binaryCard.locator('.distractor-choices textarea').count(),1);
        await page.locator('#distractor-2-0').fill('Correct');
        await page.locator('#continue-share').click();
        assert.equal(await page.locator('#share-stage').isVisible(),true);
        await page.locator('[data-stage="practice"]').click();
        assert.equal(await page.locator('#distractor-2-0').inputValue(), 'Correct');
        await page.locator('[data-stage="edit"]').click();
        await upload(filled,'cancel'); assert.match(await page.locator('#spreadsheet-status').textContent(), /canceled/);
        const legacy = new ExcelJS.Workbook(); legacy.addWorksheet('Older format').addRows([LEGACY_HEADERS,['','Choose A–F','One','Two','Three','Four','Five','Six','f','Legacy information']]);
        const olderFile = {name:'Older.xlsx',mimeType:filled.mimeType,buffer:Buffer.from(await legacy.xlsx.writeBuffer())};
        await upload(olderFile,'confirm');
        assert.equal(await page.locator('#answer').innerText(),'Six');
        await page.locator('[data-stage="practice"]').click(); assert.equal(await page.locator('.distractor-choices textarea').count(),5);
        await page.locator('#preview-practice').click(); assert.equal(await page.locator('#quiz-options button').count(),6);
        await page.locator('[data-stage="share"]').click();
        const exportPromise=page.waitForEvent('download');await page.locator('#download-spreadsheet').click();
        const exported=await exportPromise,exportFile=path.join(output,'export.xlsx');await exported.saveAs(exportFile);
        const exportedBook=new ExcelJS.Workbook();await exportedBook.xlsx.load(fs.readFileSync(exportFile));
        const exportSheet=exportedBook.worksheets[0],headers=exportSheet.getRow(1).values;
        assert.equal(exportSheet.getRow(2).getCell(headers.indexOf('English Distractor 5')).value,'Five');
        assert.equal(exportSheet.getRow(2).getCell(headers.indexOf('Hebrew Distractor 1')).value,'');
        await page.locator('[data-stage="edit"]').click();
        await upload({name:'broken.xlsx',mimeType:filled.mimeType,buffer:Buffer.from('broken')});
        assert.match(await page.locator('#spreadsheet-status').textContent(),/could not be opened/);
        assert.equal(await page.locator('#card-count').textContent(),'1');assert.equal(await page.locator('#answer').innerText(),'Six');
        if (process.env.SOURCE_XLSX) {
            await upload(process.env.SOURCE_XLSX,'confirm');
            assert.match(await page.locator('#spreadsheet-status').textContent(),/Imported 237 cards/);
            assert.equal(await page.locator('#answer').innerText(),'12');
            assert.equal(await page.locator('#target-surface img').count(),1);
            const data=await page.locator('#target-surface img').getAttribute('src');assert.match(data,/^data:image\/png;base64,/);
            await page.locator('[data-stage="practice"]').click();
            assert.equal(await page.locator('.distractor-card').first().locator('.distractor-choices textarea').count(),3);
            await page.locator('#preview-practice').click();assert.equal(await page.locator('#quiz-options button').count(),4);
            await page.locator('[data-stage="edit"]').click();
        }
        for (const width of [1250,390]) {
            await page.setViewportSize({width,height:1000});
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow at ${width}px`);
            await page.screenshot({path:path.join(output,`upload-${width}.png`),fullPage:true});
        }
        assert.deepEqual(errors,[]);
        console.log('Passed local template download/upload, generation wiring, legacy choices, pictures, replacement/cancel/error handling, export and responsive layout. '+output);
    } finally {if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
