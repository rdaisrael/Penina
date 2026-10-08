const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/index.html'), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
function harness() {
    const elements = {};
    const element = id => elements[id] ||= { value: 'old', style: {}, innerHTML: 'old', classList: { remove() {} } };
    const c = {
        document: { getElementById: element, querySelectorAll: () => [], documentElement: { style: { setProperty() {} } } },
        setControlValue: (id, value) => { element(id).value = value; }, getControlValue: id => element(id).value,
        sourceTypeSelect: { dispatchEvent() {} }, Event: class {}, renderChips() {},
        updateFontSizeVariables() {}, updateMargin() {}, updateViewModeLock() {}, updateTextDisplay() {},
        updateVocabInputWarning() {}, applyTitleText: text => { c.title = text; },
        updateWorkbookExportAvailability: () => { c.exportDisabled = !c.generatedRows.length; },
        setPublishStudyCardsStatus: text => { c.publishStatus = text; },
        setVocabularyWorkbookStatus: text => { c.status = text; },
        readFileAsBase64: async file => file.name,
        fetch: async () => ({ ok: true, json: async () => ({ rows: [{ term: 'חדש' }] }) }),
        importedVocabularyRows: [{ term: 'ישן' }], generatedRows: [{ item: { hebrew: 'ישן' } }],
        selectedSourceTargets: ['old source'], generateBtn: { disabled: true, vocabularyGeneration: {} },
        vocabularyWorkbookInput: { value: 'sheet.xlsx' }, vocabTbody: element('table'),
        pageContainer: { style: { display: 'block' } }, searchStatusNotice: { style: {} }
    };
    vm.createContext(c);
    vm.runInContext('let vocabularyUploadVersion = 0;\n'
        + section('        async function importVocabularyWorkbookFile(', '        async function importVocabularyUploadFile(')
        + section('        function clearVocabularyForm()', '        function setupDraftFileButtons()'), c);
    return { c, element };
}
test('a successful spreadsheet replaces all previous form content and generated output', async () => {
    const { c, element } = harness();
    await c.importVocabularyWorkbookFile({ name: 'new.xlsx' });
    assert.equal(element('word-list').value, 'חדש');
    assert.equal(element('list-title').value, '');
    assert.equal(element('source-type').value, 'Tanakh');
    assert.equal(c.selectedSourceTargets.length, 0);
    assert.equal(c.generatedRows.length, 0);
    assert.equal(c.vocabTbody.innerHTML, '');
    assert.equal(c.pageContainer.style.display, 'none');
    assert.equal(c.exportDisabled, true);
    assert.equal(c.publishStatus, '');
    assert.equal(c.generateBtn.vocabularyGeneration, null);
    assert.equal(c.generateBtn.disabled, false);
    assert.equal(c.vocabularyWorkbookInput.value, '');
    assert.match(c.status, /new.xlsx loaded: 1 term/);
});
test('failed or empty uploads preserve the current draft consistently', async () => {
    for (const response of [{ ok: false, json: async () => ({ error: 'Bad file' }) }, { ok: true, json: async () => ({ rows: [] }) }]) {
        const { c, element } = harness();
        c.fetch = async () => response;
        await c.importVocabularyWorkbookFile({ name: 'bad.xlsx' });
        assert.equal(c.importedVocabularyRows[0].term, 'ישן');
        assert.equal(c.generatedRows.length, 1);
        assert.equal(element('list-title').value, 'old');
        assert.match(c.status, /Bad file|no vocabulary/);
    }
});
test('an earlier upload finishing late cannot replace the latest spreadsheet', async () => {
    const { c, element } = harness();
    let finish;
    c.readFileAsBase64 = file => file.name === 'old.xlsx' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(file.name);
    const old = c.importVocabularyWorkbookFile({ name: 'old.xlsx' });
    await c.importVocabularyWorkbookFile({ name: 'new.xlsx' });
    finish('old.xlsx');
    await old;
    assert.equal(element('word-list').value, 'חדש');
    assert.match(c.status, /new.xlsx/);
});
test('Clear Form prevents a pending upload from restoring content', async () => {
    const { c, element } = harness();
    let finish;
    c.readFileAsBase64 = () => new Promise(resolve => { finish = resolve; });
    const pending = c.importVocabularyWorkbookFile({ name: 'old.xlsx' });
    c.clearVocabularyForm();
    finish('old.xlsx');
    await pending;
    assert.equal(element('word-list').value, '');
    assert.equal(c.status, '');
});
test('clearing while generation is paused prevents old output from reappearing', async () => {
    const { c, element } = harness();
    Object.assign(c, { englishTranslationEnabled: () => true, hebrewTranslationEnabled: () => true,
        contextQuotesEnabled: () => true, getVocabularyInputProblems: () => [] });
    let resume;
    c.yieldToBrowser = () => new Promise(resolve => { resume = resolve; });
    vm.runInContext(section('        async function handleGenerateVocabularyClick()', '        // --- SEARCH LOGIC:'), c);
    const pending = c.handleGenerateVocabularyClick();
    c.clearVocabularyForm();
    resume();
    await pending;
    assert.equal(c.vocabTbody.innerHTML, '');
    assert.equal(c.pageContainer.style.display, 'none');
    assert.equal(c.generateBtn.disabled, false);
});
