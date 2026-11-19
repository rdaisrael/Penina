const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {generate} = require('../lib/knowledge-distractors');

function row(id, definition) {
    return {id, term: 'What happened in סְדוֹם?', definition, answers: ['', ''], slots: [0, 1]};
}

test('one English generation batch follows each correct answer, including its script and nekudot', async () => {
    const rows = [
        row(0, 'They came in the evening'),
        row(1, 'They came בָּעֶרֶב'),
        row(2, 'הֵם אָכְלוּ'),
        row(3, 'They went to סדום'),
        row(4, 'אַבְרָהָם visited סדום'),
        row(5, 'הוּא יָצָא – he left'),
    ];
    const choices = [
        ['They came at noon', 'They came at dawn'],
        ['They came בַּבֹּקֶר', 'They came בַּלַּיְלָה'],
        ['הֵם שָׁתוּ', 'הֵם יָשְׁבוּ'],
        ['They went to מצרים', 'They went to חברון'],
        ['אַבְרָהָם left סדום', 'אַבְרָהָם visited חברון'],
        ['הוּא נִכְנַס – he entered', 'הוּא יָשַׁב – he sat'],
    ];
    const expected = {rows: rows.map(({id, slots}) => ({id, cells: slots.map(slot => ({slot, answer: choices[id][slot]}))}))};
    const original = structuredClone(rows);
    const result = await generate({language: 'english', useTeacherHebrew: true, rows}, async prompt => {
        assert.match(prompt, /correct answer .*wording model for that row alone/);
        assert.match(prompt, /nekudot/);
        assert(prompt.includes(JSON.stringify(rows)));
        return JSON.stringify(expected);
    });
    assert.deepEqual(result, expected);
    assert.deepEqual(rows, original);
});

test('wording checks apply to regenerated cells and leave the other choices alone', async () => {
    const rows = [{...row(7, 'מֹשֶׁה went to מצרים'), answers: ['Teacher choice', 'מֹשֶׁה stayed in מצרים'], slots: [1]}];
    const regenerate = (answer, options = {useTeacherHebrew: true}) =>
        generate({language: 'english', rows, ...options}, async () => JSON.stringify({rows: [{id: 7, cells: [{slot: 1, answer}]}]}));
    const answer = 'מֹשֶׁה returned from מצרים';
    assert.equal((await regenerate(answer)).rows[0].cells[0].answer, answer);
    for (const invalid of [
        'Moses returned from Egypt', 'מֹשֶׁה חָזַר', 'משה returned from מצרים',
        'מֶשֶׁה returned from מצרים', 'מֹשֶׁה returned from מִצְרַיִם',
        rows[0].definition, ...rows[0].answers,
    ]) {
        await assert.rejects(regenerate(invalid), {status: 502}, invalid);
    }
    for (const options of [{}, {useTeacherHebrew: false}]) {
        await assert.rejects(regenerate(answer, options), {status: 502});
        assert.equal((await regenerate('Moses returned from Egypt', options)).rows[0].cells[0].slot, 1);
    }
    const hebrew = await regenerate('הם חזרו', {language: 'hebrew', useTeacherHebrew: true});
    assert.equal(hebrew.rows[0].cells[0].answer, 'הם חזרו');
});

test('choices cannot borrow Hebrew or vowel points from the question or neighboring cards', async () => {
    for (const [correct, invalid] of [
        ['They came at night', 'They came בָּעֶרֶב'],
        ['They came בערב', 'They came בַּבֹּקֶר'],
        ['They came בָּעֶרֶב', 'They came בבוקר'],
        ['הֵם אָכְלוּ', 'הֵם שתו'],
    ]) {
        const rows = [{...row(0, correct), slots: [0]}, row(1, 'They came בָּעֶרֶב')];
        await assert.rejects(generate({language: 'english', useTeacherHebrew: true, rows}, async () =>
            JSON.stringify({rows: [
                {id: 1, cells: [{slot: 0, answer: 'They came בַּבֹּקֶר'}, {slot: 1, answer: 'They came בַּלַּיְלָה'}]},
                {id: 0, cells: [{slot: 0, answer: invalid}]},
            ]})), {status: 502});
    }
});

test('the practice editor generates, selectively regenerates, and saves to the English bank', async () => {
    // Run the real control handlers and generation endpoint logic against an in-memory form.
    const controls = new Map();
    const element = () => ({
        children: [], dataset: {}, classList: {toggle() {}},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        querySelectorAll() { return []; }, setAttribute() {}, addEventListener() {},
    });
    const html = fs.readFileSync(require.resolve('../PeninaPlus-knowledge-builder/index.html'), 'utf8');
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) controls.set(id, element());
    assert.match(html, /id="generate-english"[^<]*<\/button>\s*<label><input id="use-teacher-hebrew" type="checkbox"> Use Hebrew terms the way I wrote them<\/label>/);
    const byId = id => controls.get(id);
    const document = {getElementById: byId, createElement: element, createTextNode: text => text};
    const window = {
        PeninaKnowledgeCards: require('../PeninaPlus-knowledge-builder/cards'),
        PeninaPracticeExercises: require('../PeninaPlus-vocab-builder/practice-exercises'),
    };
    const calls = [];
    let suggestion = 'They came בַּבֹּקֶר';
    const fetch = async (url, options) => {
        assert.equal(url, '/api/flashcard-sets');
        const body = JSON.parse(options.body);
        calls.push(body);
        const result = await generate(body, async () => JSON.stringify({rows: [{id: 0, cells: [{slot: 1, answer: suggestion}]}]}));
        return {ok: true, json: async () => result};
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../PeninaPlus-knowledge-builder/knowledge-workflow'), 'utf8'),
        {window, document, fetch, AbortController, setTimeout, clearTimeout});
    const card = {id: 'evening', question: 'When did they come?', answer: 'They came בָּעֶרֶב',
        distractors: {english: ['They came בַּלַּיְלָה', ''], hebrew: ['בבוקר', 'בלילה']}};
    const workflow = window.PeninaKnowledgeWorkflow.mount({getDeck: () => ({cards: [card]}), changed() {}});
    workflow.enter('practice');
    byId('use-teacher-hebrew').checked = true;
    await byId('generate-english').onclick();
    assert.equal(byId('save-answers').onclick(), true);
    assert.equal(card.distractors.english[1], suggestion);
    byId('practice-rows').querySelectorAll = () => [{dataset: {row: '0', slot: '1'}}];
    suggestion = 'They came בַּצָּהֳרַיִם';
    await byId('regenerate-selected').onclick();
    assert.equal(byId('save-answers').onclick(), true);
    assert.deepEqual(calls.map(call => [call.language, call.useTeacherHebrew, call.rows[0].slots]),
        [['english', true, [1]], ['english', true, [1]]]);
    assert.equal(card.distractors.english[0], 'They came בַּלַּיְלָה');
    assert.equal(card.distractors.english[1], suggestion);
    assert.deepEqual(card.distractors.hebrew, ['בבוקר', 'בלילה']);
    assert.equal(card.answer, 'They came בָּעֶרֶב');
});
