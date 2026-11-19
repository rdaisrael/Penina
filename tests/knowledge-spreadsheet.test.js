const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const ExcelJS = require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');
const JSZip = require('jszip');
const {HEADERS, LEGACY_HEADERS, parseWorkbook, readExcel} = require('../PeninaPlus-knowledge-builder/knowledge-spreadsheet');
const {normalizeDeck, practiceCards} = require('../PeninaPlus-knowledge-builder/cards');
const {generate} = require('../lib/knowledge-distractors');
const {fromKnowledgeDeck, practiceRows} = require('../PeninaPlus-vocab-builder/offline-study-cards');
const template = require.resolve('../PeninaPlus-knowledge-builder/Penina-Knowledge-Template.xlsx');
function workbook(rows, headers = HEADERS) {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Questions').addRows([headers, ...rows]); return book;
}
const row = (answers = []) => ['', 'What is the capital?', 'Paris', ...Array.from({length:3}, (_, i) => answers[i] || ''), 'More information'];

test('download contains only the new headers, and filling it produces an importable Excel file', async () => {
    const bytes = fs.readFileSync(template), book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
    assert.equal(book.worksheets.length, 1);
    const sheet = book.worksheets[0]; assert.deepEqual(sheet.getRow(1).values.slice(1), HEADERS);
    assert.equal(sheet.getImages().length, 0); assert.equal(book.media.length, 0);
    sheet.eachRow((record, number) => {if (number > 1) record.eachCell(cell => assert.equal(cell.value, null));});
    assert.equal(sheet.views[0].ySplit, 1);
    await assert.rejects(readExcel(bytes, ExcelJS, JSZip), /empty/);
    sheet.getRow(2).values = row(['London', 'Rome', 'Madrid']);
    const imported = await readExcel(await book.xlsx.writeBuffer(), ExcelJS, JSZip, {title:'Cities'});
    assert.equal(imported.title, 'Cities'); assert.equal(imported.cards[0].answer, 'Paris');
    assert.deepEqual(imported.cards[0].distractors.english, ['London', 'Rome', 'Madrid']);
    assert.equal(imported.cards[0].additionalInformation, 'More information');
});
test('one to five supplied distractors survive normalization and reach practice, including combined sets', () => {
    for (let count = 1; count <= 5; count++) {
        const answers = ['London','Rome','Madrid','Berlin','Athens'].slice(0, count);
        const deck = parseWorkbook(workbook([['', 'Capital?', 'Paris', ...Array.from({length:5}, (_, i) => answers[i] || ''), 'A', 'More information']], LEGACY_HEADERS));
        assert.deepEqual(normalizeDeck(deck).cards[0].distractors.english, answers);
        assert.equal(practiceCards(deck, 'english').length, 1);
        assert.deepEqual(practiceRows(fromKnowledgeDeck(deck, 'set'), 'english')[0].answers, answers);
    }
});
test('questions and correct answers alone import for later generation; Hebrew and numeric answers are preserved', () => {
    const imported = parseWorkbook(workbook([row()]));
    assert.deepEqual(imported.cards[0].distractors, {}); assert.equal(practiceCards(imported, 'english').length, 0);
    const numeric = ['', 'כמה?', 0, 1, 2, '', 'מידע'];
    const deck = parseWorkbook(workbook([numeric]), {language:'hebrew'});
    assert.equal(deck.cards[0].answer, '0'); assert.deepEqual(deck.cards[0].distractors.hebrew, ['1','2','']);
    assert.equal(practiceCards(deck, 'hebrew').length, 0, 'an unfinished bank retains its empty slot for generation');
});
test('legacy A–F letter mapping supports every correct position, gaps and reordered columns', async () => {
    for (let index = 0; index < 6; index++) {
        const choices = ['alpha','beta','gamma','delta','epsilon','zeta'];
        const values = ['', 'Choose', ...choices, 'abcdef'[index], 'Info'];
        const book = workbook([values], LEGACY_HEADERS);
        const deck = await readExcel(await book.xlsx.writeBuffer(), ExcelJS, JSZip);
        assert.equal(deck.cards[0].answer, choices[index]);
        assert.deepEqual(deck.cards[0].distractors.english, choices.filter((_, i) => i !== index));
    }
    const indices = [1,8,0,2,3,4,5,6,7,9];
    const values = ['', 'Pick', 0, '', 'Correct', '', 'Wrong', '', 'c', 'Info'];
    const deck = parseWorkbook(workbook([indices.map(i => values[i])], indices.map(i => LEGACY_HEADERS[i])));
    assert.equal(deck.cards[0].answer, 'Correct'); assert.deepEqual(deck.cards[0].distractors.english, ['0','Wrong']);
});
test('invalid rows, duplicate choices and unknown columns fail instead of partially importing', async () => {
    for (const [values, error] of [
        [['', '', 'answer'], /Enter a question/],
        [['', 'Question', ''], /Enter the answer text/],
        [row(['PARIS!']), /different incorrect/],
        [row(['London','LONDON']), /different incorrect/],
        [row(['x'.repeat(501)]), /500 characters/],
        [['https://example.invalid/image.png', 'Question','Answer'], /Picture cell/],
        [['', {formula:'1+1',result:2}, 'Answer'], /not formulas/]
    ]) assert.throws(() => parseWorkbook(workbook([row(), values])), error);
    assert.throws(() => parseWorkbook(workbook([['', 'Question','A','','','','','','B','']], LEGACY_HEADERS)), /choice is blank/);
    assert.throws(() => parseWorkbook(workbook([['', 'Question','A','','','','','','X','']], LEGACY_HEADERS)), /one letter/);
    assert.throws(() => parseWorkbook(workbook([row()], [...HEADERS, 'Extra'])), /Unrecognized column/);
    assert.throws(() => parseWorkbook(workbook([row()], [...HEADERS.slice(0,-1), 'Question'])), /one column/);
    await assert.rejects(readExcel(Buffer.from('broken'), ExcelJS, JSZip), /could not be opened/);
});
test('blank rows are ignored, all sheets import, and the 500-card limit is enforced', () => {
    const book = workbook([[], row()]); book.addWorksheet('More').addRows([HEADERS, row(['London'])]);
    assert.equal(parseWorkbook(book).cards.length, 2);
    assert.equal(parseWorkbook(workbook(Array.from({length:500}, () => row()))).cards.length, 500);
    assert.throws(() => parseWorkbook(workbook(Array.from({length:501}, () => row()))), /500 cards/);
});
test('embedded floating pictures survive the actual XLSX round trip and misplaced pictures are rejected', async () => {
    const book = workbook([row(['London'])]);
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const imageId = book.addImage({base64,extension:'png'});
    book.worksheets[0].addImage(imageId, {tl:{col:0,row:1},ext:{width:20,height:20}});
    const deck = await readExcel(await book.xlsx.writeBuffer(), ExcelJS, JSZip);
    assert.equal(deck.cards[0].picture.src, `data:image/png;base64,${base64}`);
    book.worksheets[0].addImage(imageId, {tl:{col:1,row:1},ext:{width:20,height:20}});
    assert.throws(() => parseWorkbook(book), /Picture column/);
});
test('generation accepts variable imported banks and validates the fifth replacement slot', async () => {
    for (const count of [1,3,5]) {
        const input = {language:'english',rows:[{id:0,term:'Capital of France?',definition:'Paris',answers:Array(count).fill(''),slots:Array.from({length:count},(_,i)=>i)}]};
        const answers = ['London','Rome','Madrid','Berlin','Athens'];
        const output = await generate(input, async () => JSON.stringify({rows:[{id:0,cells:input.rows[0].slots.map(slot=>({slot,answer:answers[slot]}))}]}));
        assert.equal(output.rows[0].cells.length, count);
        await assert.rejects(generate({...input,rows:[{...input.rows[0],slots:[count]}]},()=>assert.fail('No provider call expected')),error=>error.status===400);
    }
});
test('three-distractor imports create four-choice Quiz and Live questions through their existing paths', async () => {
    const deck = parseWorkbook(workbook([row(['London','Rome','Madrid'])]), {title:'Imported cities'});
    const cards = fromKnowledgeDeck(deck, 'knowledge-cards/sixth/upload.json');
    const {mergeCards} = require('../lib/quiz-vocabulary-library');
    const {rows, warnings} = mergeCards([{title:deck.title,cards}]);
    assert.deepEqual(warnings, []);
    const quiz = await require('../lib/quiz-vocabulary').questions({rows,types:['choice'],autoCount:true});
    assert.equal(quiz[0].choices.length, 4); assert.deepEqual(quiz[0].answer, ['Paris']);
    const h = require('./helpers/live-harness')();
    const pathname = 'knowledge-cards/sixth/upload.json';
    h.storage.set(pathname, {body:JSON.stringify(deck)});
    const created = await h.create({pathnames:[pathname]});
    assert.equal(created.code, 201, JSON.stringify(created.body));
    const {code, hostToken} = created.body;
    await h.join(code);
    assert.equal((await h.request('start',{code,version:0},hostToken)).code, 200);
    const active = (await h.request(null,{code},hostToken)).body;
    assert.equal(active.question.options.length, 4);
    assert.deepEqual([...active.question.options].sort(), ['Paris','London','Rome','Madrid'].sort());
});

test('a binary spreadsheet card with one filled cell reaches practice, Quiz and Live with exactly two choices', async () => {
    const deck = parseWorkbook(workbook([
        ['', 'Did they arrive?', 'Yes', '', 'No', '', ''],
        ['', 'Is it correct?', 'Correct', '', '', '', ''],
    ]));
    assert.deepEqual(deck.cards[0].distractors.english, ['No']);
    assert.deepEqual(practiceCards(normalizeDeck(deck), 'english').map(card => card.id), [deck.cards[0].id]);
    const pathname = 'knowledge-cards/sixth/binary.json';
    const cards = fromKnowledgeDeck(deck, pathname);
    assert.deepEqual(practiceRows(cards, 'english').map(row => row.answers), [['No']]);
    const {rows} = require('../lib/quiz-vocabulary-library').mergeCards([{title: deck.title, cards: [cards[0]]}]);
    const [question] = await require('../lib/quiz-vocabulary').questions({rows, types: ['choice'], autoCount: true});
    assert.deepEqual(question.choices.slice().sort(), ['No', 'Yes']);
    const h = require('./helpers/live-harness')();
    h.storage.set(pathname, {body: JSON.stringify(deck)});
    const created = await h.create({pathnames: [pathname]});
    assert.equal(created.code, 201, JSON.stringify(created.body));
    const {code, hostToken} = created.body;
    await h.join(code);
    assert.equal((await h.request('start', {code, version: 0}, hostToken)).code, 200);
    const live = (await h.request(null, {code}, hostToken)).body;
    assert.deepEqual(live.question.options.slice().sort(), ['No', 'Yes']);
});
