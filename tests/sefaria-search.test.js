const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearch } = require('./helpers/sefaria-harness');
const handler = require('../api/sefaria-search');

const target = (corpus, book, scope, value) => ({ corpus, book, scope, value });
const text = (ref, he, en = []) => ({ ref, heRef: ref, he, text: en });
const response = (data, ok = true) => ({ ok, json: async () => data });
const results = (refs, total = refs.length) => ({ hits: { total, hits: refs.map(ref => ({ _source: { ref } })) } });
const quote = 'ויאמר האיש אל חברו שלום וברכה ביום הזה';

function setup({ texts = {}, indexes = {}, search = () => results([]), semantic } = {}) {
    const calls = [];
    const api = createSearch(async (url, options = {}) => {
        const decoded = decodeURIComponent(url);
        calls.push({ url: decoded, body: options.body && JSON.parse(options.body) });
        if (url === '/api/sefaria-search') return response(await search(JSON.parse(options.body)));
        if (decoded.includes('/api/name/')) return response({ index: decoded.split('/api/name/')[1] });
        if (decoded.includes('/api/v2/raw/index/')) {
            const book = decoded.split('/api/v2/raw/index/')[1];
            return response(indexes[book] || { title: book, categories: ['Tanakh', 'Torah'] });
        }
        const ref = decoded.split('/api/texts/')[1]?.split('?')[0];
        if (!(ref in texts)) throw new Error('Fixture has no text for ' + ref);
        return response(texts[ref]);
    }, semantic);
    return { ...api, calls };
}

test('Tanakh: selected chapter matches vocalized Hebrew and preserves English', async () => {
    const { search, calls } = setup({ texts: { 'Genesis 1': text('Genesis 1', ['וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי אוֹר'], ['God said, Let there be light.']) } });
    const found = await search('אוֹר', 'Tanakh', [target('Tanakh', 'Genesis', 'chapter', '1')], [], 'light');
    assert.match(found.he, /אוֹר/);
    assert.match(found.en, /light/);
    assert(!calls.some(c => c.url.includes('ven=')));
    assert(!calls.some(c => c.body));
});

test('Tanakh: missing chapter match searches the selected book on the server', async () => {
    const { search, calls } = setup({
        texts: { 'Genesis 1': text('Genesis 1', ['אין כאן דבר מתאים']), 'Genesis 2:1': text('Genesis 2:1', quote) },
        indexes: { Genesis: { title: 'Genesis', categories: ['Tanakh', 'Torah'] } },
        search: body => body.filters[0] === 'Tanakh/Torah/Genesis' ? results(['Genesis 2:1']) : results(['Exodus 1:1'])
    });
    assert.equal((await search('שלום', 'Tanakh', [target('Tanakh', 'Genesis', 'chapter', '1')])).ref, 'Genesis 2:1');
    assert.deepEqual(calls.find(c => c.body).body.filters, ['Tanakh/Torah/Genesis']);
});

test('Tanakh: selected book miss widens to Tanakh', async () => {
    const { search, calls } = setup({ texts: { 'Exodus 1:1': text('Exodus 1:1', quote) },
        search: body => results(body.filters[0] === 'Tanakh' ? ['Exodus 1:1'] : []) });
    assert.equal((await search('שלום', 'Tanakh', [target('Tanakh', 'Genesis', 'whole', '')])).ref, 'Exodus 1:1');
    assert.deepEqual(calls.filter(c => c.body).map(c => c.body.filters[0]), ['Tanakh/Torah/Genesis', 'Tanakh']);
});

test('Search continues past a full first page and deduplicates editions of the same ref', async () => {
    const { search, calls } = setup({
        texts: { 'Genesis 1:1': text('Genesis 1:1', 'אין כאן דבר מתאים'), 'Genesis 2:1': text('Genesis 2:1', quote) },
        search: body => body.start === 0 ? results(Array(50).fill('Genesis 1:1'), 51) : results(['Genesis 2:1'], 51)
    });
    assert.equal((await search('שלום', 'Tanakh')).ref, 'Genesis 2:1');
    assert.equal(calls.filter(c => c.url.includes('/texts/Genesis 1:1')).length, 1);
    assert.deepEqual(calls.filter(c => c.body).map(c => c.body.start), [0, 50]);
});

test('Talmud: selected daf quote keeps source English for meaning validation', async () => {
    const { search } = setup({ texts: { 'Berakhot 2a': text('Berakhot 2a', quote, ['He greeted his friend with peace.']) } });
    const found = await search('שלום', 'Talmud', [target('Talmud', 'Berakhot', 'daf', '2a')], [], 'peace');
    assert.equal(found.ref, 'Berakhot 2a');
    assert.equal(found.en, ''); // The separate English translation step still supplies the displayed English.
    assert.match(found.sourceEnglish, /peace/);
});

test('Talmud: perek follows Sefaria segment boundaries and caches only requested pages', async () => {
    const { search, calls } = setup({
        indexes: { Berakhot: { title: 'Berakhot', categories: ['Talmud','Bavli','Seder Zeraim'], alt_structs: { Chapters: { nodes: [{ wholeRef: 'Berakhot 2a:2-2b:1' }] } } } },
        texts: { 'Berakhot 2a': text('Berakhot 2a', ['מבחוץ '+quote, 'אין כאן דבר מתאים']),
            'Berakhot 2b': text('Berakhot 2b', ['מבפנים '+quote, 'מבחוץ '+quote]) }
    });
    const targets = [target('Talmud', 'Berakhot', 'perek', '0')];
    const found = await search('שלום', 'Talmud', targets);
    assert.equal(found.ref, 'Berakhot 2b');
    assert.match(found.he, /מבפנים/);
    assert(!found.he.includes('מבחוץ'));
    await search('שלום', 'Talmud', targets);
    assert.equal(calls.filter(c => c.url.includes('/texts/')).length, 2);
    assert(!calls.some(c => c.body));
});

test('Talmud: perek miss widens to masechta, then only Bavli', async () => {
    const { search, calls } = setup({
        indexes: { Berakhot: { title:'Berakhot',categories:['Talmud','Bavli','Seder Zeraim'],alt_structs:{Chapters:{nodes:[{wholeRef:'Berakhot 2a:1-1'}]}} } },
        texts: { 'Berakhot 2a': text('Berakhot 2a', ['אין כאן דבר מתאים']), 'Shabbat 3a:1': text('Shabbat 3a:1', quote) },
        search: body => results(body.filters[0] === 'Talmud/Bavli' ? ['Jerusalem Talmud Berakhot 1:1:1', 'Shabbat 3a:1'] : [])
    });
    assert.equal((await search('שלום', 'Talmud', [target('Talmud','Berakhot','perek','0')])).ref,'Shabbat 3a:1');
    assert.deepEqual(calls.filter(c => c.body).map(c => c.body.filters[0]), ['Talmud/Bavli/Seder Zeraim/Berakhot','Talmud/Bavli']);
});

test('Selected source tries later occurrences when the first has the wrong meaning', async () => {
    const { search } = setup({ texts: { 'Genesis 1': text('Genesis 1', [quote+' ראשון',quote+' שני'],['incorrect meaning','incorrect meaning']) },
        semantic: async prompt => prompt.includes('ראשון') ? 'NO' : 'YES' });
    const found = await search('שלום','Tanakh',[target('Tanakh','Genesis','chapter','1')],[],'peace');
    assert.match(found.he,/שני/);
});

test('Regeneration skips excluded references', async () => {
    const { search } = setup({ texts:{'Genesis 2:1':text('Genesis 2:1',quote)},search:()=>results(['Genesis 1:1','Genesis 2:1']) });
    assert.equal((await search('שלום','Tanakh',[],['Genesis 1:1'])).ref,'Genesis 2:1');
});

test('No matching word returns null; a request failure reports an incomplete search', async () => {
    assert.equal(await setup().search('זזזזז','Tanakh'),null);
    const { search } = createSearch(async () => { throw new Error('offline'); });
    await assert.rejects(search('שלום','Talmud'), /could not complete/);
});

test('Sefaria HTTP/API errors cannot be reported as a word not found', async () => {
    for (const reply of [response({},false),response({error:'bad query'}),response({timed_out:true,hits:{hits:[]}})]) {
        const { search } = createSearch(async () => reply);
        await assert.rejects(search('שלום','Tanakh'),/could not complete/);
    }
});

test('Flexible-gap phrases match while ordinary phrases require adjacent words', async () => {
    const texts={'Genesis 1':text('Genesis 1',['ויאמר האיש שלום לכל האנשים וברכה ביום הזה'])};
    assert(await setup({texts}).search('שלום ... וברכה','Tanakh',[target('Tanakh','Genesis','chapter','1')]));
    assert.equal(await setup({texts}).search('שלום וברכה','Tanakh',[target('Tanakh','Genesis','chapter','1')]),null);
});

test('Proxy rejects non-POST requests and preserves filters and pagination', async () => {
    const originalFetch=global.fetch;
    const res={ status(code){this.code=code;return this},json(data){this.data=data;return this} };
    try {
        await handler({method:'GET'},res);
        assert.equal(res.code,405);
        const body={query:'שלום',filters:['Tanakh/Torah/Genesis'],size:50,start:50};
        global.fetch=async (url,options)=>{assert.equal(url,'https://www.sefaria.org/api/search-wrapper');assert.deepEqual(JSON.parse(options.body),body);return response(results(['Genesis 1:1']))};
        await handler({method:'POST',body},res);
        assert.equal(res.code,200);
        assert.equal(res.data.hits.hits[0]._source.ref,'Genesis 1:1');
    } finally {global.fetch=originalFetch}
});

test('Hebrew maqaf remains a word boundary in both quotes and search phrases', async () => {
    const texts={'Genesis 1':text('Genesis 1',['וַיֹּאמֶר אֱלֹהִים יְהִי־אוֹר ויהי כן ביום הזה'])};
    const targets=[target('Tanakh','Genesis','chapter','1')];
    for(const word of ['אור','יהי אור','יְהִי־אוֹר']) {
        const found=await setup({texts}).search(word,'Tanakh',targets);
        assert(found,word);
        assert.match(found.he,/יְהִי־אוֹר/);
    }
});
