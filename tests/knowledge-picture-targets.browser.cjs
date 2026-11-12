// Local-only browser regression. API responses are fixtures; external requests are blocked.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'penina-picture-targets-'));
let studentHtml = '';
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/student.html') {res.setHeader('Content-Type', 'text/html'); return res.end(studentHtml);}
    if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({pages: [], role: 'teacher', userId: 1}));
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.statusCode = 404;
        return res.end();
    }
    res.setHeader('Content-Type', ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
});
(async () => {
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_EXECUTABLE});
        const context = await browser.newContext({viewport: {width: 1200, height: 1000}});
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/PeninaPlus-knowledge-builder/');
        await page.waitForFunction(() => !document.querySelector('.app').inert);
        assert.equal(await page.locator('#reuse-pictures').isVisible(), false);
        const source = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 480; canvas.height = 240;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f1f6ea'; ctx.fillRect(0, 0, 480, 240);
            ctx.fillStyle = '#30845d'; ctx.fillRect(110, 40, 100, 100);
            ctx.fillStyle = '#ab7437'; ctx.fillRect(290, 100, 90, 100);
            ctx.fillStyle = '#253a2c'; ctx.font = '24px Arial';
            ctx.fillText('Leaf', 135, 175); ctx.fillText('Root', 304, 74);
            return canvas.toDataURL('image/png');
        });
        const upload = {name: 'plant.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1], 'base64')};
        await page.locator('#picture-file').setInputFiles(upload);
        await page.waitForFunction(() => document.querySelector('#editor-message').textContent.startsWith('Picture added.'));
        await page.locator('#picture-alt').fill('Plant diagram');
        await page.locator('#add-target').click();
        await page.locator('#target-surface').press('ArrowLeft');
        await page.locator('#question').fill('Which part collects sunlight?');
        await page.locator('#answer').fill('The leaf');
        await page.locator('#save-card').click();
        async function readSaved() {
            return page.evaluate(() => new Promise((resolve, reject) => {
                const request = indexedDB.open('penina-knowledge-builder', 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result, read = db.transaction('drafts').objectStore('drafts').get('current');
                    read.onsuccess = () => {db.close(); resolve(read.result);};
                    read.onerror = () => {db.close(); reject(read.error);};
                };
            }));
        }
        const markers = page.locator('#target-surface .target-marker');
        assert.equal(await markers.count(),1);
        assert.equal(await markers.first().textContent(),'','single target keeps its crosshair');
        assert.equal(await markers.first().evaluate(el=>getComputedStyle(el,'::before').display),'block');
        for(let i=1;i<5;i++)await page.locator('#add-target').click();
        assert.deepEqual(await markers.allTextContents(),['A','B','C','D','E']);
        assert.equal(await page.locator('#add-target').isDisabled(),true);
        assert.equal(await markers.first().evaluate(el=>getComputedStyle(el,'::before').display),'none');
        const before=(await readSaved()).editor.picture.targets;
        await page.locator('#target-select').selectOption('1');
        await page.locator('#target-surface').press('ArrowRight');
        const after=(await readSaved()).editor.picture.targets;
        assert.equal(after[1].x,before[1].x+.005);
        [0,2,3,4].forEach(i=>assert.deepEqual(after[i],before[i]));
        await page.locator('#remove-target').click();
        assert.deepEqual(await markers.allTextContents(),['A','B','C','D']);
        assert.deepEqual((await readSaved()).editor.picture.targets,after.filter((_,i)=>i!==1));
        for(let i=0;i<3;i++)await page.locator('#remove-target').click();
        assert.equal(await markers.count(),1);
        assert.equal(await markers.first().textContent(),'');
        assert.equal(await page.locator('#target-select-label').isVisible(),false);
        assert.equal((await readSaved()).editor.picture.targets,undefined);
        for(let i=1;i<5;i++)await page.locator('#add-target').click();
        await page.locator('#save-card').click();
        let saved=await readSaved();
        assert.equal(saved.deck.cards[0].picture.targets.length,5);
        const expected=structuredClone(saved.deck.cards[0].picture.targets);
        for(const width of [1200,390]) {
            await page.setViewportSize({width,height:1000});
            await page.locator('#picture-editor').scrollIntoViewIfNeeded();
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await page.locator('#picture-editor').screenshot({path:path.join(output,`targets-${width}.png`)});
        }
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('.app').inert);
        assert.deepEqual(await markers.allTextContents(),['A','B','C','D','E']);
        await page.locator('nav [data-stage="study"]').click();
        assert.deepEqual(await page.locator('#card-content .target-marker').allTextContents(),['A','B','C','D','E']);
        await page.locator('#card-content .picture-button').click();
        assert.deepEqual(await page.locator('#enlarged-picture .target-marker').allTextContents(),['A','B','C','D','E']);
        await page.keyboard.press('Escape');
        await page.locator('#study-stage [data-stage="print"]').click();
        assert.deepEqual(await page.locator('#print-pages .target-marker').allTextContents(),['A','B','C','D','E']);
        await page.locator('nav [data-stage="share"]').click();
        await page.locator('#share-stage [data-stage="sheet"]').click();
        assert.deepEqual(await page.locator('#knowledge-sheet .target-marker').allTextContents(),['A','B','C','D','E']);
        await page.locator('nav [data-stage="share"]').click();
        const xlsxDownload=page.waitForEvent('download');
        await page.locator('#download-spreadsheet').click();
        const workbook=new (require('exceljs').Workbook)();
        await workbook.xlsx.readFile(await (await xlsxDownload).path());
        const sheet=workbook.getWorksheet('Knowledge Cards');
        expected.forEach((target,i)=>{
            assert.equal(sheet.getRow(1).getCell(6+i*2).value,`Target ${'ABCDE'[i]} X (%)`);
            assert.equal(sheet.getRow(2).getCell(6+i*2).value,Math.round(target.x*10000)/100);
            assert.equal(sheet.getRow(2).getCell(7+i*2).value,Math.round(target.y*10000)/100);
        });
        assert.equal(sheet.getImages().length,1);
        const draftDownload=page.waitForEvent('download');
        await page.locator('#share-download-draft').click();
        const exported=JSON.parse(fs.readFileSync(await (await draftDownload).path(),'utf8'));
        assert.deepEqual(exported.cards[0].picture.targets,expected);
        studentHtml=require('../lib/knowledge-publication').makeStudentApp(exported);
        const student=await context.newPage();
        student.on('pageerror',error=>errors.push(error.message));
        await student.goto(origin+'/student.html');
        assert.deepEqual(await student.locator('#card-content .target-marker').allTextContents(),['A','B','C','D','E']);
        assert.equal(await student.locator('#card-content .target-marker').first().evaluate(el=>getComputedStyle(el,'::before').display),'none');
        await student.locator('#card-content .picture-button').click();
        assert.deepEqual(await student.locator('#enlarged-picture .target-marker').allTextContents(),['A','B','C','D','E']);
        await student.close();
        await page.locator('nav [data-stage="edit"]').click();
        await page.locator('#new-card').click();
        await page.locator('#reuse-pictures summary').click();
        await page.locator('.reuse-picture').click();
        assert.equal(await markers.count(),0,'reusing the image starts with independent targets');
        await page.locator('#add-target').click();
        assert.equal(await markers.first().textContent(),'');
        assert.deepEqual((await readSaved()).deck.cards[0].picture.targets,expected);
        await page.locator('#new-list').click();
        await page.locator('#confirm-dialog [value="confirm"]').click();
        await page.waitForFunction(()=>document.querySelector('#card-count').textContent==='0');
        await page.locator('#draft-file').setInputFiles({name:'targets.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
        await page.waitForFunction(()=>document.querySelector('#editor-message').textContent==='Opened 1 cards.');
        assert.deepEqual(await markers.allTextContents(),['A','B','C','D','E']);
        assert.deepEqual(errors,[]);
        console.log('Passed: five-target limit, A–E labels, selection/movement/removal, single crosshair, desktop/mobile, save/reload/import, reuse independence, flashcards/enlargement/print/sheets, student export, and XLSX coordinates.');
        console.log('Screenshots: '+output);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
