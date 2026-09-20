const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/index.html'), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const renderer = section('        function escapeVocabularyHtml(', '        function replaceRenderedRow(');

test('terms, definitions and citations render imported markup as literal text', () => {
    const context = {
        highlightHebrewContext: () => '<span>safe context</span>',
        highlightModernHebrewContext: () => '', highlightEnglishContext: () => '',
        englishTranslationEnabled: () => true, hebrewTranslationEnabled: () => true
    };
    vm.createContext(context);
    vm.runInContext(renderer, context);
    const attack = '<img src=x onerror="window.auditMarker=1">';
    const output = context.renderVocabularyRow({ item: { hebrew: attack, english: attack },
        modernHebrewTranslation: attack, hebrewCitation: attack, englishCitation: attack }, 0);
    assert.equal((output.match(/&lt;img/g) || []).length, 5);
    assert(!output.includes('<img'));
    assert(output.includes('<span>safe context</span>'));
});

test('HTML-only drafts restore inputs without inserting their saved markup or retaining old rows', () => {
    const elements = {};
    const element = id => elements[id] ||= { style: {}, classList: { add() {}, remove() {} } };
    const context = {
        document: { getElementById: element, documentElement: { style: { setProperty() {} } } },
        setControlValue() {}, getControlValue: () => '', sourceTypeSelect: { dispatchEvent() {} },
        Event: class {}, renderChips() {}, updateFontSizeVariables() {}, updateMargin() {},
        updateViewModeLock() {}, applyTitleText() {}, setVocabularyWorkbookStatus() {},
        updateWorkbookExportAvailability() {}, refreshOriginalHebrewDatasets() {},
        updateTextDisplay() {}, updateVocabInputWarning() {},
        vocabTbody: { innerHTML: 'previous lesson' }, pageContainer: { style: { display: 'block' } }
    };
    vm.createContext(context);
    vm.runInContext(section('        function applyDraftPayload(', '        function clearVocabularyForm('), context);
    context.applyDraftPayload({ draftType: 'PeninaPlusVocabularyBuilderDraft', inputs: {},
        generatedDocument: { tableBodyHtml: '<img src=x onerror="window.auditMarker=1">', pageVisible: true } });
    assert.equal(context.vocabTbody.innerHTML, '');
    assert.equal(context.pageContainer.style.display, 'none');
});

async function generate(source, overrides) {
    const elements = {}, prompts = [];
    const element = id => elements[id] ||= {
        value: { 'list-title': 'Audit', 'word-list': 'סוס', 'source-type': source }[id] || '',
        checked: false, style: {}, classList: { add() {}, remove() {} }
    };
    const context = {
        document: { getElementById: element }, searchStatusNotice: null,
        englishTranslationEnabled: () => true, hebrewTranslationEnabled: () => false,
        contextQuotesEnabled: () => true, updateViewModeLock() {}, getVocabularyInputProblems: () => [],
        generateBtn: {}, generatedRows: [], updateWorkbookExportAvailability() {},
        yieldToBrowser: async () => {}, vocabTbody: {}, pageContainer: { style: {} }, applyTitleText() {},
        importedVocabularyRows: [{ term: 'סוס', englishTermTranslation: 'horse', ...overrides }],
        addNikkudWithDicta: async text => text, containsHebrew: text => /[א-ת]/.test(text),
        isLikelyHebrewAbbreviation: () => false, getSelectedSourceTargets: () => [],
        performSefariaSearch: async () => ({ he: 'סוס רץ', en: 'A horse runs', ref: 'Genesis 1:1' }),
        formatSefariaCitation: () => ({ hebrew: 'בראשית', english: 'Genesis' }),
        getCitationWithoutAiLabel: text => text, renderVocabularyRow: () => '<tr>ok</tr>',
        refreshOriginalHebrewDatasets() {}, updateTextDisplay() {}, alert() {},
        markEnglishCitationAsAiTranslationForRow() {}, escapeVocabularyHtml: text => String(text),
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            assert.equal(url, '/api/translate');
            prompts.push(...body.prompts);
            return { ok: true, json: async () => ({ results: body.prompts.map(() => ({ ok: true, text: 'A horse runs' })) }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(section('        function isNoGenerationMarker(', '        async function exportVocabularyWorkbook(')
        + section('        async function handleGenerateVocabularyClick()', '        // --- SEARCH LOGIC:'), context);
    await context.handleGenerateVocabularyClick();
    assert.equal(context.vocabTbody.innerHTML, '<tr>ok</tr>');
    assert.equal(context.generatedRows.length, 1);
    return { row: context.generatedRows[0], prompts };
}

test('Modern Hebrew context translates even when its English term definition is suppressed', async () => {
    const { row, prompts } = await generate('Modern Hebrew', { englishTermTranslation: 'N', contextQuote: 'סוס רץ' });
    assert.equal(row.item.english, null);
    assert.equal(row.englishContext, 'A horse runs');
    assert.equal(prompts.length, 1);
    assert(!prompts[0].includes('null'));
});

test('Sefaria respects suppressed English context while retaining ordinary translations and overrides', async () => {
    for (const source of ['Tanakh', 'Talmud']) {
        const suppressed = await generate(source, { englishContextTranslation: 'N' });
        assert.equal(suppressed.row.englishContext, '');
        assert.equal(suppressed.prompts.length, 0);
        assert.equal((await generate(source, {})).row.englishContext, 'A horse runs');
        assert.equal((await generate(source, { englishContextTranslation: 'Teacher translation' })).row.englishContext, 'Teacher translation');
    }
});


test('display choices never disable generation and can be toggled without altering rows', () => {
    const elements = Object.fromEntries(['english-translation', 'hebrew-translation', 'context-quotes'].map(id => [id, { checked: false }]));
    elements['source-type'] = { value: 'Talmud' };
    elements['view-mode'] = {};
    elements['context-source-controls'] = {};
    const classes = new Set();
    const context = { document: {
        getElementById: id => elements[id], body: {},
        documentElement: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } }
    } };
    vm.createContext(context);
    vm.runInContext(section('        function contextQuotesEnabled()', '        function updateFontSizeVariables('), context);
    assert.equal(context.contextQuotesEnabled(), true);
    assert.equal(context.englishTranslationEnabled(), true);
    assert.equal(context.hebrewTranslationEnabled(), true);
    context.updateViewModeLock();
    assert.equal(context.document.body.className, 'mode-basic');
    assert.equal(elements['context-source-controls'].hidden, false);
    assert(classes.has('hide-english-translation'));
    assert(classes.has('hide-hebrew-translation'));
    for (const id of ['english-translation', 'hebrew-translation', 'context-quotes']) elements[id].checked = true;
    context.updateViewModeLock();
    assert.equal(context.document.body.className, 'mode-full');
    assert.equal(classes.size, 0);
});
