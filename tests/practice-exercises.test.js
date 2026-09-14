const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const practice = require('../PeninaPlus-vocab-builder/practice-exercises');
const html = fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/index.html'), 'utf8');
const source = () => [{ item: { hebrew: 'סוס', english: 'horse' }, modernHebrewTranslation: 'סוס מבוית' }];
const alternatives = ['donkey', 'camel', 'goat', 'sheep'];
const answerResult = (id = 0) => ({ id, cells: alternatives.map((answer, slot) => ({ slot, answer })) });

test('language can switch before interaction; edits and selections lock without touching lesson rows', () => {
    for (const interact of [session => session.edit(0, 0, 'donkey'), session => session.select(0, 0, true)]) {
        const rows = source(), session = practice.createSession(rows);
        assert.equal(session.choose('constructor'), false);
        assert.equal(session.choose('hebrew'), true);
        assert.equal(session.choose('english'), true);
        interact(session);
        const snapshot = JSON.stringify(session.rows);
        assert.equal(session.choose('hebrew'), false);
        assert.equal(session.choose('english'), false);
        assert.equal(JSON.stringify(session.rows), snapshot);
        assert.equal(rows[0].alternativeAnswers, undefined);
        const fresh = practice.createSession(rows);
        assert.equal(fresh.choose('hebrew'), true);
        assert.equal(fresh.locked, false);
    }
});

test('saved answers are copied, separated by language, and invalidated when term or definition changes', () => {
    const rows = source();
    rows[0].alternativeAnswers = { english: { term: 'סוס', definition: 'horse', answers: alternatives } };
    const session = practice.createSession(rows);
    session.choose('english');
    assert.deepEqual(session.rows[0].answers, alternatives);
    session.edit(0, 0, 'cow');
    assert.equal(rows[0].alternativeAnswers.english.answers[0], 'donkey');
    assert.deepEqual(practice.sourceRows(rows, 'hebrew')[0].answers, ['', '', '', '']);
    rows[0].item.english = 'stallion';
    assert.deepEqual(practice.sourceRows(rows, 'english')[0].answers, ['', '', '', '']);
    rows[0].item.english = 'horse'; rows[0].item.hebrew = 'סוסה';
    assert.deepEqual(practice.sourceRows(rows, 'english')[0].answers, ['', '', '', '']);
    rows[0].item.english = 'N';
    assert.equal(practice.sourceRows(rows, 'english')[0].definition, 'סוס מבוית');
});

test('selective regeneration preserves unchecked cells and does not mutate the source on failure', () => {
    const session = practice.createSession(source()); session.choose('english');
    session.rows[0].answers = alternatives.slice();
    session.select(0, 1, true); session.select(0, 3, true); session.select(0, 3, false);
    const requests = session.requests();
    assert.deepEqual(requests[0].slots, [1]);
    const output = practice.mergeGeneration(session.rows, requests, [{ id: 0, cells: [{ slot: 1, answer: ' cow ' }] }], 'english');
    assert.deepEqual(output[0].answers, ['donkey', 'cow', 'goat', 'sheep']);
    assert.deepEqual(session.rows[0].answers, alternatives);
    for (const answer of ['camel', 'goat', 'HORSE!', 'סוס', '', '!!!', 'x'.repeat(501)]) {
        assert.throws(() => practice.mergeGeneration(session.rows, requests, [{ id: 0, cells: [{ slot: 1, answer }] }], 'english'));
        assert.deepEqual(session.rows[0].answers, alternatives);
    }
    session.rows[0].answers[0] = 'Needs review סוס';
    assert.equal(practice.mergeGeneration(session.rows, requests, [{ id: 0, cells: [{ slot: 1, answer: 'cow' }] }], 'english')[0].answers[0], 'Needs review סוס');
});

test('generation rejects incomplete, duplicate, unrequested and malformed AI cells atomically', () => {
    const session = practice.createSession([...source(), ...source()]); session.choose('english');
    const requests = session.requests(true);
    const malformed = [null, [], [answerResult()], [answerResult(), answerResult()],
        [answerResult(), null], [answerResult(), { id: 1, cells: [null, null, null, null] }],
        [answerResult(), { id: 1, cells: [0, 0, 2, 3].map(slot => ({ slot, answer: alternatives[slot] })) }],
        [answerResult(), { id: 1, cells: [0, 1, 2, 4].map(slot => ({ slot, answer: 'cow' })) }]];
    for (const result of malformed) {
        assert.throws(() => practice.mergeGeneration(session.rows, requests, result, 'english'));
        assert(session.rows.every(row => row.answers.every(answer => answer === '')));
    }
    const output = practice.mergeGeneration(session.rows, requests, [answerResult(1), answerResult(0)], 'english');
    assert.deepEqual(output.map(row => row.answers), [alternatives, alternatives]);
});

test('Submit requires four distinct answers in the selected language and a definition', () => {
    const session = practice.createSession(source()); session.choose('english');
    assert.throws(() => session.submit(), /every cell/);
    session.rows[0].answers = alternatives.slice();
    assert.deepEqual(session.submit()[0], { version: 1, term: 'סוס', definition: 'horse', answers: alternatives });
    session.rows[0].answers[1] = 'DONKEY!'; assert.throws(() => session.submit(), /different/);
    session.rows[0].answers = ['חמור', 'גמל', 'עז', 'כבש'];
    assert.throws(() => session.submit(), /English/);
    session.language = 'hebrew'; assert.equal(session.submit().length, 1);
    session.rows[0].answers[1] = 'חֲמוֹר'; assert.throws(() => session.submit(), /different/);
    session.rows[0].definition = ''; assert.throws(() => session.submit(), /definition/);
});

// A small DOM test double runs the real modal event handlers without a browser or server.
function modal(fetchImpl, rows = source(), extraGlobals = {}) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.append(child); return child; }
        replaceChildren(...children) { this.children = children; }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(name, fn) { this.events[name] = fn; }
        fire(name) { return this.events[name]?.({ preventDefault() {} }); }
        focus() { this.focused = true; }
        showModal() { this.open = true; }
        close() { this.open = false; }
        querySelector(selector) { return this.querySelectorAll(selector)[0]; }
        querySelectorAll(selector) {
            const matches = el => selector.split(',').some(part => {
                part = part.trim();
                return part[0] === '#' ? el.id === part.slice(1) : part === '[data-language]' ? !!el.dataset.language : el.tag === part;
            });
            return this.children.flatMap(child => typeof child === 'string' ? [] : [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        set innerHTML(value) {
            this.markup = value;
            const stack = [this];
            for (const token of value.matchAll(/<\/?([\w-]+)([^>]*)>/g)) {
                if (token[0][1] === '/') { stack.pop(); continue; }
                const el = new Element(token[1]);
                el.id = token[2].match(/id="([^"]+)"/)?.[1];
                el.dataset.language = token[2].match(/data-language="([^"]+)"/)?.[1];
                stack.at(-1).append(el); stack.push(el);
            }
        }
    }
    const document = { body: new Element('body'), createElement: tag => new Element(tag), createTextNode: text => text };
    const button = new Element('button');
    let api = practice;
    if (Object.keys(extraGlobals).length) {
        const context = { module: { exports: {} }, AbortController, setTimeout, clearTimeout, ...extraGlobals };
        vm.runInNewContext(fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/practice-exercises'), 'utf8'), context);
        api = context.module.exports;
    }
    const saved = [];
    const { dialog } = api.mount({ button, document, fetchImpl, getRows: () => rows, onSubmit: (...args) => saved.push(args) });
    button.fire('click');
    return { button, dialog, saved, find: selector => dialog.querySelector(selector) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('modal locks on generation, renders editable cells, submits, and reopens unlocked', async () => {
    let resolveFetch, request;
    const ui = modal((url, options) => { request = { url, options }; return new Promise(resolve => { resolveFetch = resolve; }); });
    const choices = ui.dialog.querySelectorAll('[data-language]');
    choices[0].fire('click');
    assert.equal(ui.dialog.querySelectorAll('textarea').length, 4);
    ui.find('#practice-generate').fire('click');
    assert(choices.every(choice => choice.disabled));
    assert.equal(ui.find('form').attributes['aria-busy'], 'true');
    assert.equal(request.url, '/api/vocabulary-alternatives');
    assert.deepEqual(JSON.parse(request.options.body).rows[0].slots, [0, 1, 2, 3]);
    resolveFetch({ ok: true, json: async () => ({ rows: [answerResult()] }) }); await tick();
    assert.deepEqual(ui.dialog.querySelectorAll('textarea').map(input => input.value), alternatives);
    assert(choices.every(choice => choice.disabled));
    const inputs = ui.dialog.querySelectorAll('textarea');
    inputs[0].value = 'cow'; inputs[0].fire('input');
    ui.find('form').fire('submit');
    assert.equal(ui.saved[0][0], 'english'); assert.equal(ui.saved[0][1][0].answers[0], 'cow');
    assert.equal(ui.dialog.open, false); assert.equal(ui.button.focused, true);
    ui.button.fire('click'); assert(choices.every(choice => !choice.disabled));
    assert.equal(ui.find('form').hidden, true);
});

test('Cancel aborts, discards changes, and stale responses/timeouts cannot alter a reopened session', async () => {
    const pending = [], timers = [];
    const ui = modal((url, options) => new Promise(resolve => pending.push({ options, resolve })), source(), {
        setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}
    });
    const chooseEnglish = () => ui.dialog.querySelectorAll('[data-language]')[0].fire('click');
    chooseEnglish(); ui.find('#practice-generate').fire('click');
    ui.dialog.fire('cancel'); assert.equal(pending[0].options.signal.aborted, true);
    ui.button.fire('click'); chooseEnglish(); ui.find('#practice-generate').fire('click');
    timers[0](); assert.equal(pending[1].options.signal.aborted, false);
    pending[0].resolve({ ok: true, json: async () => ({ rows: [answerResult()] }) }); await tick();
    assert(ui.dialog.querySelectorAll('textarea').every(input => input.value === ''));
    pending[1].resolve({ ok: true, json: async () => ({ rows: [answerResult()] }) }); await tick();
    assert.deepEqual(ui.dialog.querySelectorAll('textarea').map(input => input.value), alternatives);
    ui.find('#practice-cancel').fire('click'); assert.equal(ui.saved.length, 0);
});

test('failed later batch leaves all answers unchanged and restores controls for retry', async () => {
    let calls = 0;
    const ui = modal(async (url, options) => {
        calls++;
        if (calls === 2) return { ok: false, json: async () => ({ error: 'Try again later.' }) };
        return { ok: true, json: async () => ({ rows: JSON.parse(options.body).rows.map(row => answerResult(row.id)) }) };
    }, Array.from({ length: 9 }, () => source()[0]));
    ui.dialog.querySelectorAll('[data-language]')[0].fire('click');
    ui.find('#practice-generate').fire('click'); await tick();
    assert.equal(calls, 2);
    assert(ui.dialog.querySelectorAll('textarea').every(input => input.value === ''));
    assert.equal(ui.find('#practice-error').textContent, 'Try again later.');
    assert.equal(ui.find('#practice-generate').disabled, false);
    assert(ui.dialog.querySelectorAll('[data-language]').every(choice => choice.disabled));
});

test('HTML integrates the purple button immediately before offline cards and loads valid scripts', () => {
    assert.match(html, /id="create-practice-exercises-btn"[^>]*>Create Additional Practice Exercises<\/button>\s*<button[^>]*id="download-offline-study-cards-btn"/);
    assert.match(html, /<link rel="stylesheet" href="practice-exercises.css">/);
    assert(html.indexOf('src="practice-exercises.js"') < html.indexOf('PeninaPracticeExercises.mount'));
    assert.match(fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/practice-exercises.css'), 'utf8'), /#create-practice-exercises-btn\s*\{[^}]*background: #7a3df0/);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/\bsrc=/.test(script[1])) new vm.Script(script[2]);
    }
    const ui = modal(() => assert.fail('Unexpected network call'));
    assert.equal(ui.dialog.attributes['aria-labelledby'], 'practice-title');
    for (const heading of ['Term', 'Definition', ...[1, 2, 3, 4].map(n => `Alternate Answer ${n}`)]) {
        assert(ui.dialog.markup.includes(`scope="col">${heading}</th>`));
    }
});

test('real HTML submit integration survives JSON draft export and import with both languages', () => {
    const fields = new Map();
    const element = id => {
        if (!fields.has(id)) fields.set(id, { value: '', style: {}, classList: { add() {} } });
        return fields.get(id);
    };
    let mounted;
    const context = vm.createContext({ PeninaPracticeExercises: { mount: options => { mounted = options; } },
        createPracticeExercisesButton: {}, syncGeneratedRowFromDom() {}, document: { getElementById: element, documentElement: { style: { setProperty() {} } }, body: {} },
        getControlValue: () => '', getSelectedSourceTargets: () => [], importedVocabularyRows: [], pageContainer: element('page'), docTitle: element('title'), vocabTbody: element('tbody'),
        setControlValue() {}, sourceTypeSelect: { dispatchEvent() {} }, Event: class {}, renderChips() {}, updateFontSizeVariables() {}, updateMargin() {}, updateViewModeLock() {},
        applyTitleText() {}, setVocabularyWorkbookStatus() {}, updateWorkbookExportAvailability() {}, renderVocabularyRow: () => '<tr></tr>', refreshOriginalHebrewDatasets() {}, updateTextDisplay() {}, updateVocabInputWarning() {}
    });
    vm.runInContext(html.slice(html.indexOf('        let generatedRows = [];'), html.indexOf('        const semanticContextValidationCache')), context);
    context.rows = source(); vm.runInContext('generatedRows = rows', context);
    for (const language of ['english', 'hebrew']) {
        const session = practice.createSession(mounted.getRows()); session.choose(language);
        session.rows[0].answers = language === 'english' ? alternatives.slice() : ['חמור', 'גמל', 'עז', 'כבש'];
        mounted.onSubmit(language, session.submit());
    }
    vm.runInContext(html.slice(html.indexOf('        function buildDraftPayload()'), html.indexOf('        function safeDraftFileName')), context);
    const exported = JSON.parse(JSON.stringify(context.buildDraftPayload()));
    assert.equal(exported.generatedRows[0].alternativeAnswers.hebrew.answers[0], 'חמור');
    vm.runInContext(html.slice(html.indexOf('        function applyDraftPayload('), html.indexOf('        function clearVocabularyForm()')), context);
    context.applyDraftPayload(exported);
    assert.deepEqual(practice.sourceRows(mounted.getRows(), 'english')[0].answers, alternatives);
    assert.deepEqual(practice.sourceRows(mounted.getRows(), 'hebrew')[0].answers, ['חמור', 'גמל', 'עז', 'כבש']);
});
