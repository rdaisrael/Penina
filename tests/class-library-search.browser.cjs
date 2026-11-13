// Local-only browser regression; all API data is supplied by in-memory fixtures.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHandler} = require('../lib/knowledge-sets');
const root = path.resolve(__dirname, '..');
const entry = {term: 'שָׁל֣וֹם', english: 'Peace; hello', hebrew: 'בְּרָכָה בִּפְגִישָׁה'};
const vocabulary = [
    {title: 'Week 1 Review', searchEntries: [entry]},
    {title: 'Books', searchEntries: [{term:'סֵפֶר',english:'Book',hebrew:'אוסף דפים כתובים'}]},
    {title: 'Hidden List', searchEntries: [{term:'סוֹד',english:'Hidden secret',hebrew:'סוד'}]}
].map((set, i) => ({...set, pathname: `vocabulary-cards/sixth/${i}.html`, publishedAt:'2026-11-13T12:00:00Z', url:'/api/flashcard-sets?view='+i}));
const deck = {format:'penina-knowledge-cards',version:1,title:'Plants',cards:[
    {id:'roots',question:'What do roots absorb?',answer:'Water'},
    {id:'leaves',question:'מה צבע העלים?',answer:'יָרוֹק'}
]};
const knowledgePath = 'knowledge-cards/sixth/plants.json';
const pageInfo = {id:'sixth',name:'Local Class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=sixth'};
const knowledge = createHandler({
    storage:{list:async()=>({blobs:[{pathname:knowledgePath,url:'mock:knowledge',uploadedAt:'2026-11-13T12:00:00Z'}]})},
    fetch:async url=>{assert.equal(url,'mock:knowledge');return {ok:true,json:async()=>deck};},
    pageStore:{getPage:async()=>pageInfo,publicPage:p=>p}
});
let vocabularyFirst = false;
let apiReads = 0;
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const reply = {setHeader:(key,value)=>res.setHeader(key,value),status(code){res.statusCode=code;return this;},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}};
    try {
        if (url.pathname === '/api/flashcard-sets') {
            apiReads++;
            const isKnowledge = url.searchParams.get('kind') === 'knowledge';
            if (isKnowledge === vocabularyFirst) await new Promise(resolve=>setTimeout(resolve,100));
            if (isKnowledge) return knowledge({method:'GET',query:Object.fromEntries(url.searchParams)},reply);
            return reply.json({page:pageInfo,sets:vocabulary,hiddenWordlists:[vocabulary[2].pathname]});
        }
        if (url.pathname.startsWith('/api/')) return reply.json({});
        let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (url.pathname.endsWith('/')) file = path.join(file,'index.html');
        if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) {res.statusCode=404;return res.end();}
        res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
    } catch (error) {reply.status(500).json({error:error.message});}
});

(async () => {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:'+server.address().port;
    const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
    try {
        const context = await browser.newContext({viewport:{width:1200,height:900}});
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        for (const route of ['?page=sixth','sixth-grade/','seventh-grade/','eighth-grade/']) {
            vocabularyFirst = !vocabularyFirst;
            await page.goto(origin+'/PeninaPlus-vocab-builder/flash-cards/'+route);
            await page.locator('#sets .set').last().waitFor();
            await page.locator('.knowledge-library .set').waitFor();
            const readsBeforeSearch = apiReads;
            const search = page.locator('#search');
            assert.match(await search.getAttribute('aria-label'), /Hebrew terms/);
            assert.equal(await page.locator('#sets .set').count(),2);
            await page.locator('#sets .combine-select').first().check();
            for (const query of ['week 1', 'שלום', 'שָׁלוֹם', 'PEACE', 'ברכה בפגישה']) {
                await search.fill(query);
                assert.deepEqual(await page.locator('#sets .set h2').allTextContents(),['Week 1 Review'],query);
                assert.equal(await page.locator('.knowledge-library .set').count(),0);
                assert(await page.locator('#sets .combine-select').isChecked());
                if (query !== 'week 1') {
                    assert.equal(await page.locator('#sets .search-matches strong').textContent(),entry.term);
                    assert.deepEqual(await page.locator('#sets .search-matches span').allTextContents(),[entry.english,entry.hebrew]);
                }
            }
            for (const [query,title] of [['BOOK','Books'],['ספר','Books'],['דפים','Books']]) {
                await search.fill(query);
                assert.deepEqual(await page.locator('#sets .set h2').allTextContents(),[title]);
            }
            for (const query of ['Plants','roots','Water','ירוק','צבע']) {
                await search.fill(query);
                assert.equal(await page.locator('#sets .set').count(),0);
                assert.deepEqual(await page.locator('.knowledge-library .set h2').allTextContents(),['Plants']);
                assert.equal(await page.locator('#status').isVisible(),false);
            }
            for (const query of ['no-such-term','secret','סוד','Hidden List']) {
                await search.fill(query);
                assert.equal(await page.locator('.set').count(),0,query);
                assert.match(await page.locator('#status').textContent(),/No vocabulary sets, terms, or definitions/);
            }
            await search.fill('');
            assert.equal(await page.locator('.set').count(),3);
            assert.equal(await page.locator('.search-matches').count(),0);
            assert.equal(await page.locator('#combine-count').textContent(),'1 set selected');
            assert(await page.locator('#sets .combine-select').first().isChecked());
            assert.equal(apiReads,readsBeforeSearch,'Typing only searches already-loaded content');
        }
        for (const width of [1200,390]) {
            await page.setViewportSize({width,height:900});
            await page.locator('#search').fill('שלום');
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
            await page.screenshot({path:`/tmp/penina-search-${width}.png`,fullPage:true});
        }
        // Re-rendering results treats definitions as text, including HTML-looking content.
        vocabulary[0].searchEntries = [{term:'<img src=x onerror=alert(1)>',english:'<script>unsafe text</script>',hebrew:''},...Array.from({length:4},(_,i)=>({term:'Extra '+i,english:'unsafe text',hebrew:''}))];
        await page.reload();
        await page.locator('#sets .set').last().waitFor();
        await page.locator('#search').fill('unsafe');
        assert.equal(await page.locator('#sets .search-matches img, #sets .search-matches script').count(),0);
        assert.equal(await page.locator('#sets .search-matches strong').first().textContent(),'<img src=x onerror=alert(1)>');
        assert.equal(await page.locator('#sets .search-matches li:visible').count(),3);
        await page.getByText('Show 2 more',{exact:true}).click();
        assert.equal(await page.locator('#sets .search-matches li:visible').count(),5);
        assert.deepEqual(errors,[]);
        console.log('Passed class search on all four page templates, titles, Hebrew with/without marks, both definitions, knowledge answers, hidden lists, selection retention, safe previews, and desktop/mobile layout.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
