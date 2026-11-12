// Local-only browser regression. API responses are fixtures; external requests are blocked.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'penina-picture-reuse-'));
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
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
        const original = (await readSaved()).deck.cards[0].picture;
        async function reuse() {
            await page.locator('#reuse-pictures summary').click();
            assert.equal(await page.locator('.reuse-picture').count(), 1, 'duplicates share one thumbnail');
            await page.locator('.reuse-picture').click();
            assert.equal(await page.locator('#target-surface img').getAttribute('src'), source);
            assert.equal(await page.locator('#target-surface .target-marker').count(), 0, 'each reuse starts without the previous question target');
        }
        await page.locator('#new-card').click();
        await reuse();
        assert.equal(await page.locator('#picture-alt').inputValue(), 'Plant diagram');
        await page.locator('#picture-alt').fill('Root question diagram');
        await page.locator('#add-target').click();
        await page.locator('#target-surface').press('ArrowRight');
        await page.locator('#question').fill('Which part absorbs water?');
        await page.locator('#answer').fill('The root');
        await page.locator('#save-card').click();
        await page.locator('#new-card').click();
        await reuse();
        await page.locator('#question').fill('What does this picture show?');
        await page.locator('#answer').fill('Parts of a plant');
        await page.locator('#save-card').click();
        let saved = await readSaved();
        assert.equal(saved.deck.cards.length, 3);
        assert(saved.deck.cards.every(card => card.picture.src === source));
        assert.deepEqual(saved.deck.cards[0].picture, original, 'reusing and editing leave the original picture unchanged');
        assert.equal(saved.deck.cards[1].picture.alt, 'Root question diagram');
        assert(saved.deck.cards[1].picture.target.x > original.target.x);
        assert.equal(saved.deck.cards[2].picture.target, null);
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('.app').inert);
        await page.locator('#new-card').click();
        await page.locator('#reuse-pictures summary').click();
        assert.equal(await page.locator('.reuse-picture').count(), 1, 'restored drafts retain reusable pictures');
        for (const width of [1200, 390]) {
            await page.setViewportSize({width, height: 1000});
            const chooser = await page.locator('#reuse-pictures').boundingBox();
            const question = await page.locator('label[for="question"]').boundingBox();
            assert(chooser.y + chooser.height <= question.y, 'picture selection precedes Question');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
            await page.locator('#reuse-pictures').scrollIntoViewIfNeeded();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.screenshot({path: path.join(output, `chooser-${width}.png`)});
        }
        await page.locator('.reuse-picture').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#target-surface img').getAttribute('src'), source, 'keyboard selection works');
        saved = await readSaved();
        assert.equal(saved.editor.picture.src, source, 'unfinished reused picture is autosaved');
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('.app').inert);
        assert.equal(await page.locator('#target-surface img').getAttribute('src'), source);
        await page.locator('#remove-picture').click();
        await page.locator('#question').fill('A question without a picture');
        await page.locator('#answer').fill('An answer');
        await page.locator('#save-card').click();
        assert.equal((await readSaved()).deck.cards[3].picture, null);
        assert.deepEqual((await readSaved()).deck.cards[0].picture, original, 'removing a reused image leaves earlier cards intact');
        const downloaded = page.waitForEvent('download');
        await page.locator('#download-draft').click();
        const exported = JSON.parse(fs.readFileSync(await (await downloaded).path(), 'utf8'));
        assert.equal(exported.cards.length, 4);
        await page.locator('#new-list').click();
        await page.locator('#confirm-dialog [value="confirm"]').click();
        await page.waitForFunction(() => document.querySelector('#card-count').textContent === '0');
        assert.equal(await page.locator('#reuse-pictures').isVisible(), false, 'a new list has no old pictures');
        await page.locator('#draft-file').setInputFiles({name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
        await page.waitForFunction(() => document.querySelector('#editor-message').textContent === 'Opened 4 cards.');
        await page.locator('#new-card').click();
        await reuse();
        assert.deepEqual(errors, []);
        console.log('Passed: second/third reuse, independent targets/descriptions, deduplication, keyboard selection, desktop/mobile layout, autosave/reload, removal, draft export/import, and new-list reset.');
        console.log('Screenshots: ' + output);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
