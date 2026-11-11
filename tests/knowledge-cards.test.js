const test = require('node:test');
const assert = require('node:assert/strict');
const {FORMAT, normalizeDeck, hasInformation, printSheets} = require('../PeninaPlus-knowledge-builder/cards');
const card = (id, overrides = {}) => ({id: String(id), question: 'What is shown?', answer: 'A leaf', additionalInformation: '', ...overrides});
const draft = cards => ({format: FORMAT, version: 1, title: 'Plants', cards});

test('draft round trip preserves question, answer, picture and proportional target', () => {
    const picture = {src: 'data:image/png;base64,aGVsbG8=', alt: 'A leaf', target: {x: .23, y: .81}};
    const input = draft([card(1, {picture, additionalInformation: '  A leaf collects sunlight.  '})]);
    const output = normalizeDeck(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(output.cards[0].picture, picture);
    assert.equal(output.cards[0].additionalInformation, 'A leaf collects sunlight.');
    assert.equal(output.cards[0].question, 'What is shown?');
    assert.equal(output.cards[0].answer, 'A leaf');
});
test('additional information is absent for empty or whitespace-only content', () => {
    assert.equal(hasInformation(card(1)), false);
    assert.equal(hasInformation(card(1, {additionalInformation: ' \n  '})), false);
    assert.equal(hasInformation(card(1, {additionalInformation: 'More details'})), true);
});
test('invalid imports cannot introduce missing sides, duplicate IDs, remote or active images', () => {
    for (const cards of [[card(1, {question: ' '})], [card(1, {answer: ''})], [card(1), card(1)], [null]]) assert.throws(() => normalizeDeck(draft(cards)));
    for (const src of ['https://example.test/image.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
        assert.throws(() => normalizeDeck(draft([card(1, {picture: {src}})])));
    }
    assert.throws(() => normalizeDeck({...draft([]), version: 2}));
    assert.throws(() => normalizeDeck(draft([card(1, {picture: {src: 'data:image/png;base64,YQ==', target: {x: -1, y: .5}}})])));
});
test('four-up duplex backs mirror each row, including incomplete last sheets', () => {
    const pages = printSheets([1, 2, 3, 4, 5].map(id => card(id)), 4);
    assert.deepEqual(pages.map(page => page.cards.map(value => value?.id || null)), [
        ['1', '2', '3', '4'], ['2', '1', '4', '3'], ['5', null, null, null], [null, '5', null, null]
    ]);
    assert.deepEqual(pages.map(page => page.side), ['front', 'back', 'front', 'back']);
});
test('one and two per page retain their vertical order; more than four is rejected', () => {
    for (const count of [1, 2]) {
        const pages = printSheets([1, 2, 3].map(id => card(id)), count);
        for (let i = 0; i < pages.length; i += 2) assert.deepEqual(pages[i].cards, pages[i + 1].cards);
        assert(pages.every(page => page.cards.length <= count));
    }
    for (const count of [0, 3, 6, 8]) assert.throws(() => printSheets([card(1)], count));
    assert.deepEqual(printSheets([], 4), []);
});
