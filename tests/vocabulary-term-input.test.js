const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('        function containsHebrew(text)'), html.indexOf('        function lineStartsWithEnglishProblem(')), context);

test('Hebrew slash-separated terms work with spaces, vowels and keyboard direction marks', () => {
    for (const term of ['ספר/ספרים', 'ספר / ספרים', 'סֵפֶר / סְפָרִים', '\u200fספר / ספרים\u200e', 'בית ספר']) {
        assert.equal(context.getVocabularyInputProblems(term).length, 0, term);
        assert.equal(context.parseVocabularyLine(term).english, null);
        assert.ok(context.parseVocabularyLine(term).hebrew.includes(term.includes('/') ? '/' : 'בית'));
    }
});

test('terms no longer accept comma or tab definitions, including Hebrew definitions', () => {
    for (const term of ['ספר, book', 'ספר\tbook', 'ספר, ספרים', 'ספר\tספרים', 'ספר / book', 'ספר/', '/ספר', 'ספר // ספרים']) {
        assert.equal(context.getVocabularyInputProblems(term).length, 1, term);
    }
    assert.equal(context.getVocabularyInputProblems('ספר\nספר, book')[0].line, 2);
});

test('spreadsheet upload comes before the title and warning describes slash terms', () => {
    assert.ok(html.indexOf('id="vocabulary-workbook-input"') < html.indexOf('id="list-title"'));
    const warning = vm.runInContext('VOCAB_INPUT_WARNING_TEXT', context);
    assert.match(warning, /Hebrew or English keyboard/);
    assert.match(warning, /Do not use commas or tabs/);
    assert.ok(!html.includes('may then be followed by tab or comma'));
});
