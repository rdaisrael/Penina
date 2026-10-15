// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const app = require('../PeninaPlus-vocab-builder/offline-study-cards');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const cards = app.toCards([
            { term: 'מילה', englishTermTranslation: 'A short definition', contextQuote: 'A short quote' },
            { term: 'מילה '.repeat(100), hebrewTermTranslation: 'הגדרה '.repeat(120), englishTermTranslation: 'Long definition text. '.repeat(100), contextQuote: 'מקור '.repeat(180), hebrewContextTranslation: 'תרגום '.repeat(100), englishContextTranslation: 'Long context translation. '.repeat(100), englishCitation: 'Source '.repeat(30) }
        ]);
        await page.route('**/*', route => route.abort());
        await page.setContent(app.makeApp('Fixed size study cards', cards));
        for (const width of [1200, 390, 880, 1600]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const index of [0, 1, 0]) {
                for (const side of [0, 1]) {
                    await page.evaluate(({ cardIndex, side }) => { index = cardIndex; sideIndex = side; render(); }, { cardIndex: index, side });
                    const state = await page.evaluate(() => {
                        const measure = id => {
                            const el = document.getElementById(id), box = el.parentElement;
                            return { height: el.scrollHeight, width: el.scrollWidth, availableHeight: box.clientHeight, availableWidth: box.clientWidth, font: parseFloat(getComputedStyle(el).fontSize) };
                        };
                        return { cardHeight: document.getElementById('card').offsetHeight, contextHeight: document.getElementById('cardContext').offsetHeight, main: measure('mainText'), context: measure('contextText') };
                    });
                    assert.equal(state.cardHeight, 323);
                    assert.equal(state.contextHeight, 260);
                    for (const text of [state.main, state.context]) {
                        assert(text.height <= text.availableHeight, JSON.stringify({ width, index, side, state }));
                        assert(text.width <= text.availableWidth, JSON.stringify({ width, index, side, state }));
                    }
                    if (index === 0) assert(state.main.font >= 28, 'Short text restores normal font');
                    if (index === 1) assert(state.main.font < 28, 'Long text shrinks');
                }
            }
        }
        assert.deepEqual(errors, []);
        console.log('Fixed card/context sizes and text fitting passed at desktop, tablet, and mobile widths.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
