const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDictaRequest, readDictaResponse } = require('../lib/dicta-nikkud');
const fixture = require('./fixtures/dicta-nikkud-public.json');
const reader = fs.readFileSync(path.join(__dirname, '../PeninaPlus-Reader/index.html'), 'utf8');

function renderer(settings = {}) {
    const fields = new Map();
    const document = { getElementById(id) {
        if (!fields.has(id)) fields.set(id, {
            checked: false,
            value: id === 'font-choice' ? 'Arial' : '#a52a2a',
            ...settings[id]
        });
        return fields.get(id);
    } };
    const context = vm.createContext({AbortSignal, document, ReaderCore: require('../PeninaPlus-Reader/reader-core') });
    vm.runInContext(reader.slice(reader.indexOf('        const readerDictaOptions'),
        reader.indexOf('        let currentRawStory')), context);
    vm.runInContext(reader.slice(reader.indexOf('        function processTextChunk'),
        reader.indexOf('        function applyStyles')), context);
    return { context, render: text => context.processTextChunk(text, [], false) };
}

test('legacy clients retain their existing request and text-only response', () => {
    assert.deepEqual(createDictaRequest({ text: 'שלום', apiKey: 'test', genre: 'modern' }), {
        task: 'nakdan', apiKey: 'test', genre: 'modern', data: 'שלום',
        useTokenization: true, matchpartial: true
    });
    assert.deepEqual(Object.keys(readDictaResponse(fixture.response)), ['text']);
});

test('reader requests native marks and morphology without enabling special style rules', () => {
    const { context } = renderer();
    const options = vm.runInContext('readerDictaOptions', context);
    const request = createDictaRequest({ text: fixture.input, genre: 'modern', options });
    assert.equal(request.keepqq, true);
    assert.equal(request.addmorph, true);
    assert.equal(request.keepmetagim, undefined);
    assert.equal(request.matchpartial, true);
    assert.equal(request.nodageshdefmem, false);
    assert.equal(request.patachma, false);
    assert.equal((reader.match(/dictaOptions: readerDictaOptions/g) || []).length, 3);
});

test('client options cannot replace credentials, input, genre or tokenization', () => {
    const request = createDictaRequest({ text: 'שלום', apiKey: 'server', genre: 'modern',
        options: { apiKey: 'other', data: 'other', genre: 'poetry', useTokenization: false, matchpartial: false } });
    assert.equal(request.apiKey, 'server');
    assert.equal(request.data, 'שלום');
    assert.equal(request.genre, 'modern');
    assert.equal(request.useTokenization, true);
    assert.equal(request.matchpartial, true);
    assert.throws(() => createDictaRequest({ options: { keepqq: 'true' } }), /boolean/);
});

test('captured live response keeps distinct kamatz types, dagesh, and complete analysis', () => {
    const result = readDictaResponse(fixture.response, { includeAnalysis: true });
    assert.equal(result.text, 'כׇּל יֶלֶד לוֹמֵד חׇכְמָה. הַיַּלְדָּה חֲכָמָה מְאוֹד.');
    assert.equal(result.dictaTokens, fixture.response.data);
    assert.ok(result.dictaTokens[0].nakdan.options.length > 1);
    assert.ok(result.dictaTokens[0].nakdan.options[0].lex);
    assert.ok(result.dictaTokens[0].nakdan.options[0].morph);
    assert.equal(typeof result.dictaTokens[0].nakdan.fconfident, 'boolean');
});

test('parser preserves separators and unknown words while removing only prefix delimiters', () => {
    const payload = { data: [
        { str: 'ובספר', sep: false, nakdan: { options: [{ w: 'וּ|בַסֵּפֶר' }] } },
        { str: '\n', sep: true }, { str: 'מילה', sep: false },
        { str: '[1]', sep: true, nakdan: { word: '[1]' } }
    ] };
    assert.equal(readDictaResponse(payload).text, 'וּבַסֵּפֶר\nמילה[1]');
    for (const invalid of [null, {}, { data: [] }, { data: [null] },
        { data: [{ str: 'כל', nakdan: { options: [{}] } }] }]) {
        assert.throws(() => readDictaResponse(invalid), /Dicta/);
    }
});

test('renderer never guesses kamatz katan from unpointed spelling', () => {
    const { render } = renderer();
    for (const word of ['חֲכָמָה', 'כָּל', 'חָכְמָה']) {
        assert.ok(!render(word).includes('\u05c7'), word);
    }
    assert.ok(render('חׇכְמָה').includes('חׇ'));
});

test('color toggles preserve the vowel distinction and dagesh', () => {
    for (const enabled of [true, false]) {
        const { render } = renderer({ 'en-kamatz-katan': { checked: enabled } });
        const html = render('כׇּל');
        assert.ok(html.includes('כׇּ'));
        assert.equal(html.includes('color: #a52a2a'), enabled);
        assert.ok(!render('חֲכָמָה').includes('color: #a52a2a'));
        assert.ok(render('הַסֵּפֶר').includes('סֵּ'));
        assert.ok(render('הָֽאִישׁ').includes('\u05bd'));
    }
});

test('dyslexia font tuck preserves an explicit kamatz katan', () => {
    const { render } = renderer({ 'font-choice': { value: 'Dyslexic-Kriah' } });
    assert.ok(render('ךׇ').includes('&nbsp;ׇ'));
});

test('story formatter preserves supplied name vocalization', () => {
    const { context } = renderer();
    const html = context.formatStory('כותרת\nדָנְיָאֵל', []);
    assert.ok(html.includes('נְ'));
    assert.ok(html.includes('יָ'));
});

test('API handler forwards the verified options and retains metadata in its response', async () => {
    const calls = [];
    const context = vm.createContext({AbortSignal,
        require(name) {
            if (name === '../lib/openai-text') return { generateOpenAIText() { throw new Error('Supplied text must bypass OpenAI'); } };
            if (name === '../lib/reader-response') return require('../lib/reader-response');
            if (name === '../lib/dicta-nikkud') return { createDictaRequest, readDictaResponse };
            throw new Error('Unexpected module: ' + name);
        },
        module: { exports: {} }, process: { env: { DICTA_API_KEY: 'test-only' } }, console,
        fetch: async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return { ok: true, json: async () => fixture.response };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../api/generate.js'), 'utf8'), context);
    const result = {};
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
    await context.module.exports({ method: 'POST', body: {
        suppliedText: fixture.input, dictaGenre: 'modern',
        dictaOptions: { keepqq: true, addmorph: true, keepmetagim: true }
    } }, res);
    assert.equal(result.status, 200);
    assert.equal(calls[0].url, 'https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud');
    assert.equal(calls[0].body.keepqq, true);
    assert.equal(calls[0].body.apiKey, 'test-only');
    assert.ok(result.body.text.includes('כׇּל'));
    assert.ok(result.body.dictaTokens.length);
});
