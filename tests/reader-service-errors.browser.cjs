// Local-only browser checks; all external requests are blocked.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const core = require('../PeninaPlus-Reader/reader-core');
const repo = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_EXECUTABLE});
    try {
        const page = await browser.newPage({viewport: {width: 1200, height: 1000}});
        const errors = [], calls = [];
        let failure = null;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'reader.test') return route.abort();
            if (url.pathname === '/api/generate') {
                const request = route.request().postDataJSON();
                calls.push(request);
                assert.equal(route.request().headers().accept, 'text/event-stream');
                if (failure) return route.fulfill(failure);
                const text = request.sourceText || 'ספר\nהילד קורא ספר.';
                const words = core.words(text).map(([word]) => ({word, mastered: false, translation: 'meaning', match: '', form: ''}));
                const analysis = core.validateAnalysis({text, words}, request.readerVocabulary);
                const result = {text, readerResult: core.buildResult(text, analysis)};
                return route.fulfill({contentType: 'text/event-stream', body:
                    'data: ' + JSON.stringify({type:'progress',stage:'analysis-repair'}) + '\n\n: keep-alive\n\n' +
                    'data: ' + JSON.stringify({type:'result',status:200,data:result}) + '\n\n'});
            }
            try {await route.fulfill({path: path.join(repo, decodeURIComponent(url.pathname))});}
            catch {await route.abort();}
        });
        await page.goto('http://reader.test/PeninaPlus-Reader/index.html');
        await page.locator('#vocab-file-a').setInputFiles(path.join(repo, 'PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
        await page.waitForFunction(() => uploadedVocabA !== null);
        await page.locator('#theme').fill('ספר');
        await page.locator('#include-worksheet').uncheck();
        await page.locator('#generate-btn').click();
        await page.waitForFunction(() => document.getElementById('reader-status').textContent.startsWith('Reading ready.'));
        const savedStory = await page.evaluate(() => currentRawStory);
        await page.locator('#include-worksheet').check();
        for (const [status, expected] of [[502, 'gateway error (HTTP 502)'], [504, 'timed out on the server (HTTP 504)'], [524, 'timed out at the gateway (HTTP 524)']]) {
            failure = {status, contentType: 'text/html', body: '<html>Service error</html>'};
            const previousCalls = calls.length;
            await page.locator('#generate-btn').click();
            await page.waitForFunction(expected => document.getElementById('reader-status').textContent.includes(expected), expected);
            assert.equal(calls.length, previousCalls + 1, 'failed reading never starts an automatic worksheet');
            assert.equal(await page.locator('#generate-btn').isEnabled(), true);
            assert.equal(await page.locator('#include-worksheet').isEnabled(), true);
            assert.equal(await page.locator('#theme').inputValue(), 'ספר');
            assert.equal(await page.evaluate(() => uploadedVocabA !== null), true);
            assert.equal(await page.evaluate(() => currentRawStory), savedStory);
            await page.locator('#generate-questions-btn').click();
            await page.waitForFunction(expected => {
                const status = document.getElementById('reader-status').textContent;
                return status.startsWith('Worksheet error:') && status.includes(expected);
            }, expected);
            assert.equal(await page.locator('#generate-questions-btn').isEnabled(), true);
            assert.equal(await page.locator('#question-count').isEnabled(), true);
        }
        await page.locator('#pathway-b-radio').check();
        await page.locator('#vocab-file-b').setInputFiles(path.join(repo, 'PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
        await page.waitForFunction(() => uploadedVocabB !== null);
        await page.locator('#supplied-title').fill('ספר');
        await page.locator('#supplied-text').fill('הילד קורא ספר.');
        const message = 'The Hebrew vowel service is temporarily unavailable. Please try again.';
        failure = {status: 503, json: {error: message}};
        await page.locator('#generate-btn').click();
        await page.waitForFunction(message => document.getElementById('reader-status').textContent === 'Error: ' + message, message);
        assert.equal(calls.at(-1).sourceText, 'ספר\nהילד קורא ספר.');
        assert.equal(await page.locator('#supplied-title').inputValue(), 'ספר');
        assert.equal(await page.locator('#supplied-text').inputValue(), 'הילד קורא ספר.');
        assert.equal(await page.evaluate(() => uploadedVocabB !== null), true);
        failure = null;
        await page.locator('#include-worksheet').uncheck();
        await page.locator('#generate-btn').click();
        await page.waitForFunction(() => document.getElementById('reader-status').textContent.startsWith('Reading ready.'));
        assert.deepEqual(errors, []);
        console.log('Reader browser checks passed: new and supplied text, gateway/timeouts, worksheet errors, inputs retained, and successful retry.');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
