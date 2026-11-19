const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {generate} = require('../lib/knowledge-distractors');

function row(id, definition) {
    return {id, term: 'What happened in סְדוֹם?', definition, answers: ['', ''], slots: [0, 1]};
}

test('whole binary answers generate only their opposite, honoring language, case and nekudot', async () => {
    const {binaryDistractor} = require('../PeninaPlus-knowledge-builder/cards');
    for (const [correct, opposite] of [
        ['Yes', 'No'], ['no', 'yes'], ['TRUE.', 'FALSE.'], ['False', 'True'],
        ['correct', 'incorrect'], ['Incorrect', 'Correct'], ['כן', 'לא'], ['לֹא', 'כֵּן'],
        ['אֱמֶת', 'שֶׁקֶר'], ['שקר', 'אמת'], ['נָכוֹן', 'לֹא נָכוֹן'], ['לא־נכון', 'נכון'],
    ]) {
        const original = {...row(4, correct), answers: ['', '', ''], slots: [0, 1, 2]};
        const generatePair = input => generate({language: 'english', useTeacherHebrew: true, rows: [input]}, () => {
            throw Error('A binary card should not need the AI provider');
        });
        const expected = {rows: [{id: 4, cells: [{slot: 0, answer: opposite}]}]};
        assert.deepEqual(await generatePair(original), expected);
        assert.deepEqual(await generatePair({...original, answers: [opposite], slots: [0]}), expected);
    }
    assert.equal(binaryDistractor('No', 'hebrew'), 'כן');
    assert.equal(binaryDistractor('שֶׁקֶר', 'english'), 'True');
    for (const ordinary of ['Yes, they did.', 'No one', 'True north', 'Correct the sentence', 'לא בערב', 'yes/no', 'y.e.s']) {
        assert.equal(binaryDistractor(ordinary), null, ordinary);
    }
});

test('a batch with binary and ordinary cards sends only the ordinary questions to the provider', async () => {
    const rows = [row(5, 'False'), row(9, 'Paris'), row(2, 'Yes')];
    const regular = {id: 9, cells: [{slot: 1, answer: 'Rome'}, {slot: 0, answer: 'Madrid'}]};
    const output = await generate({language: 'english', rows}, async prompt => {
        assert.deepEqual(JSON.parse(prompt.split('\n').at(-1)), [rows[1]]);
        return JSON.stringify({rows: [regular]});
    });
    assert.deepEqual(output.rows, [{id: 5, cells: [{slot: 0, answer: 'True'}]}, regular, {id: 2, cells: [{slot: 0, answer: 'No'}]}]);
});

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
        const sent = JSON.parse(prompt.split('\n').at(-1));
        assert.deepEqual(sent.map(row => row.choiceLanguage), ['english', 'mixed', 'hebrew', 'mixed', 'mixed', 'mixed']);
        assert.deepEqual(sent.map(({choiceLanguage, ...row}) => row), rows);
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
        ['הֵם אָכְלוּ', 'They drank'],
        ['הֵם אָכְלוּ', 'They שָׁתוּ'],
        ['They came בָּעֶרֶב', 'They came at noon'],
        ['They came בָּעֶרֶב', 'בַּבֹּקֶר'],
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

// Run the real control handlers against an in-memory form.
function practiceForm(fetch) {
    const controls = new Map();
    const element = () => ({
        children: [], dataset: {}, classList: {toggle() {}},
        append(...children) {
            this.children.push(...children);
            children.forEach(child => {if (typeof child === 'object') child.parent = this;});
        },
        replaceChildren(...children) { this.children = children; },
        replaceWith(next) {
            this.parent.children[this.parent.children.indexOf(this)] = next;
            next.parent = this.parent;
        },
        querySelectorAll() { return []; }, setAttribute() {}, addEventListener(event, fn) { this['on' + event] = fn; },
    });
    const html = fs.readFileSync(require.resolve('../PeninaPlus-knowledge-builder/index.html'), 'utf8');
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) controls.set(id, element());
    const options = html.match(/<select id="practice-language">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...options.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(match => match.slice(1)),
        [['english', 'English'], ['hebrew', 'Hebrew'], ['mixed', 'Mixed']]);
    const byId = id => controls.get(id);
    const document = {getElementById: byId, createElement: element, createTextNode: text => text};
    const window = {
        PeninaKnowledgeCards: require('../PeninaPlus-knowledge-builder/cards'),
        PeninaPracticeExercises: require('../PeninaPlus-vocab-builder/practice-exercises'),
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../PeninaPlus-knowledge-builder/knowledge-workflow'), 'utf8'),
        {window, document, fetch, AbortController, setTimeout, clearTimeout});
    return {byId, window};
}

test('distractor questions keep card line breaks and paragraph formatting after edits and generation', async () => {
    const {byId, window} = practiceForm();
    const plain = 'Read the passage.\nמָה קָרָה?\nWho came to סְדוֹם?';
    const rich = 'Read the passage.\nמָה קָרָה?\n\nWho came to סְדוֹם? Explain <why>.';
    const format = {paragraphs: [
        {direction: 'ltr', align: 'left', runs: [{text: 'Read the passage.'}]},
        {direction: 'rtl', align: 'right', runs: [{text: 'מָה '}, {text: 'קָרָה?', bold: true}]},
        {direction: 'auto', align: 'start', runs: []},
        {direction: 'auto', align: 'start', runs: [{text: 'Who came to '}, {text: 'סְדוֹם', bold: true}, {text: '? Explain <why>.'}]},
    ]};
    const cards = [
        {id: 'plain', question: plain, answer: 'Yes'},
        {id: 'rich', question: rich, answer: 'No', textFormatting: {question: format}},
    ];
    const workflow = window.PeninaKnowledgeWorkflow.mount({getDeck: () => ({cards}), changed() {}});
    workflow.enter('practice');
    const heading = index => byId('practice-rows').children[index].children[0];
    const question = index => heading(index).children[1];
    assert.equal(heading(0).children[0].textContent, '1.');
    assert.equal(question(0).className, 'card-text');
    assert.equal(question(0).dir, 'auto');
    assert.equal(question(0).innerHTML, plain);
    const expected = window.PeninaKnowledgeCards.formattedTextHTML(rich, format);
    assert.equal(question(1).innerHTML, expected);
    await byId('generate-distractors').onclick();
    assert.equal(question(1).innerHTML, expected);
    assert.equal(byId('save-answers').onclick(), true);
    format.paragraphs[0].align = 'center';
    workflow.enter('practice');
    assert.notEqual(question(1).innerHTML, expected);
    assert.equal(question(1).innerHTML, window.PeninaKnowledgeCards.formattedTextHTML(rich, format));
});

test('the Mixed dropdown option generates, regenerates, saves, and previews the English choices', async () => {
    const calls = [];
    const suggestions = ['They came בַּבֹּקֶר', 'They came at dawn', 'בַּבֹּקֶר'];
    const fetch = async (url, options) => {
        assert.equal(url, '/api/flashcard-sets');
        const body = JSON.parse(options.body);
        calls.push(body);
        const result = await generate(body, async () => JSON.stringify({rows: body.rows.map(({id, slots}) =>
            ({id, cells: slots.map(slot => ({slot, answer: suggestions[id]}))}))}));
        return {ok: true, json: async () => result};
    };
    const {byId, window} = practiceForm(fetch);
    const card = {id: 'evening', question: 'When did they come?', answer: 'They came בָּעֶרֶב',
        distractors: {english: ['They came בַּלַּיְלָה', ''], hebrew: ['בבוקר', 'בלילה']}};
    const cards = [card,
        {id: 'english', question: 'When did they arrive in סְדוֹם?', answer: 'They came at night', distractors: {english: ['']}},
        {id: 'hebrew', question: 'When did they arrive?', answer: 'בָּעֶרֶב', distractors: {english: ['']}},
    ];
    let stage;
    const workflow = window.PeninaKnowledgeWorkflow.mount({getDeck: () => ({cards}), changed() {}, setStage(next) {stage = next;}});
    workflow.enter('practice');
    const select = byId('practice-language');
    const choose = value => {select.value = value; select.onchange({target: select});};
    assert.equal(select.value, 'english');
    choose('mixed');
    assert.equal(byId('mixed-language-help').hidden, false);
    await byId('generate-distractors').onclick();
    const pendingRows = byId('practice-rows').children;
    choose('english');
    choose('mixed');
    assert.equal(byId('practice-rows').children, pendingRows);
    assert.equal(card.distractors.english[1], '');
    assert.equal(byId('save-answers').onclick(), true);
    assert.deepEqual(cards.map(card => card.distractors.english.at(-1)), suggestions);
    byId('practice-rows').querySelectorAll = () => [{dataset: {row: '0', slot: '1'}}];
    suggestions[0] = 'They came בַּצָּהֳרַיִם';
    await byId('regenerate-selected').onclick();
    assert.equal(byId('save-answers').onclick(), true);
    assert.deepEqual(calls.map(call => [call.language, call.useTeacherHebrew, call.rows.map(row => [row.id, row.slots])]),
        [['english', true, [[0, [1]], [1, [0]], [2, [0]]]], ['english', true, [[0, [1]]]]]);
    assert.equal(card.distractors.english[0], 'They came בַּלַּיְלָה');
    assert.deepEqual(cards.map(card => card.distractors.english.at(-1)), suggestions);
    assert.deepEqual(card.distractors.hebrew, ['בבוקר', 'בלילה']);
    assert.equal(card.answer, 'They came בָּעֶרֶב');
    byId('preview-practice').onclick();
    assert.equal(stage, 'quiz');
    assert.equal(byId('quiz-language').value, 'english');

    choose('hebrew');
    suggestions[0] = 'בצהריים';
    await byId('regenerate-selected').onclick();
    choose('english'); // Switching banks saves the Hebrew edit.
    assert.equal(select.value, 'english');
    assert.equal(byId('mixed-language-help').hidden, true);
    assert.equal(card.distractors.hebrew[1], 'בצהריים');
    assert.equal(card.distractors.english[1], 'They came בַּצָּהֳרַיִם');
    suggestions[0] = 'They came at noon';
    await byId('regenerate-selected').onclick();
    assert.equal(byId('save-answers').onclick(), true);
    assert.equal(card.distractors.english[1], 'They came at noon');
    assert.deepEqual(calls.slice(-2).map(call => [call.language, call.useTeacherHebrew]), [['hebrew', false], ['english', false]]);
});

test('the editor generates and saves a binary card alongside a regular card, and preview scores both', async () => {
    const cards = [
        {id: 'first', question: 'Did they arrive?', answer: 'Yes', additionalInformation: ''},
        {id: 'second', question: 'When?', answer: 'Evening', additionalInformation: ''},
    ];
    let requests = 0;
    const {byId, window} = practiceForm(async (_, {body}) => {
        requests++;
        const request = JSON.parse(body);
        assert.deepEqual(request.rows.map(row => row.id), [1]);
        const result = await generate(request, () => JSON.stringify({rows: [{id: 1, cells:
            ['Dawn', 'Morning', 'Noon'].map((answer, slot) => ({slot, answer}))}]}));
        return {ok: true, json: async () => result};
    });
    const workflow = window.PeninaKnowledgeWorkflow.mount({getDeck: () => ({cards}), changed() {},
        renderQuestion: card => card.question, setStage: stage => workflow.enter(stage)});
    workflow.enter('practice');
    const form = byId('practice-rows');
    const choices = row => form.children[row].children.at(-1).children;
    assert.equal(choices(0).length, 1);
    assert.equal(choices(1).length, 3);
    await byId('generate-distractors').onclick();
    form.querySelectorAll = () => [{dataset: {row: 0, slot: 0}}];
    await byId('regenerate-selected').onclick();
    assert.equal(requests, 1);
    assert.equal(byId('save-answers').onclick(), true);
    assert.deepEqual(Array.from(cards[0].distractors.english), ['No']);
    byId('preview-practice').onclick();
    const buttons = () => byId('quiz-options').children;
    assert.deepEqual(buttons().map(b => b.textContent).sort(), ['No', 'Yes']);
    buttons().find(b => b.textContent === 'Yes').onclick();
    byId('quiz-next').onclick();
    assert.equal(buttons().length, 4);
    buttons().find(b => b.textContent === 'Evening').onclick();
    byId('quiz-next').onclick();
    assert.match(byId('quiz-status').textContent, /2 of 2 correct/);

    workflow.enter('practice');
    const correct = form.children[0].children[2];
    const editCorrect = value => {correct.value = value; correct.oninput(); correct.onchange();};
    editCorrect('They did');
    assert.equal(choices(0).length, 3);
    editCorrect('False');
    assert.equal(choices(0).length, 1);
    const input = choices(0)[0].children[1];
    input.value = 'True'; input.oninput();
    assert.equal(workflow.leave('practice'), true);
    assert.deepEqual(Array.from(cards[0].distractors.english), ['True']);

    // A teacher can trim an older reviewed bank down to its single opposite.
    cards[0].distractors.english = ['Extra choice', 'True', 'Another choice'];
    workflow.enter('practice');
    for (const slot of [0, 2]) {
        const extra = choices(0)[slot].children[1];
        extra.value = ''; extra.oninput();
    }
    await byId('generate-distractors').onclick();
    assert.equal(requests, 1);
    assert.equal(byId('save-answers').onclick(), true);
    assert.deepEqual(Array.from(cards[0].distractors.english), ['True']);
    assert.equal(choices(0).length, 1);
});
